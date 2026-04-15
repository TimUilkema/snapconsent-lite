create or replace function app.activate_recurring_profile_headshot_upload(
  p_headshot_id uuid
)
returns table (
  headshot_id uuid,
  tenant_id uuid,
  profile_id uuid,
  uploaded_at timestamptz,
  superseded_headshot_id uuid
)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_headshot public.recurring_profile_headshots;
  v_previous public.recurring_profile_headshots;
  v_now timestamptz := now();
begin
  select *
  into v_headshot
  from public.recurring_profile_headshots rph
  where rph.id = p_headshot_id
  for update;

  if not found then
    raise exception 'recurring_profile_headshot_not_found' using errcode = 'P0002';
  end if;

  if auth.uid() is not null and not app.current_user_can_manage_recurring_profiles(v_headshot.tenant_id) then
    raise exception 'recurring_profile_management_forbidden' using errcode = '42501';
  end if;

  select *
  into v_previous
  from public.recurring_profile_headshots rph
  where rph.tenant_id = v_headshot.tenant_id
    and rph.profile_id = v_headshot.profile_id
    and rph.id <> v_headshot.id
    and rph.superseded_at is null
    and rph.upload_status = 'uploaded'
  order by rph.created_at desc
  limit 1
  for update;

  if found then
    update public.recurring_profile_headshots
    set
      superseded_at = v_now,
      updated_at = v_now
    where id = v_previous.id;
  end if;

  update public.recurring_profile_headshots
  set
    upload_status = 'uploaded',
    uploaded_at = coalesce(uploaded_at, v_now),
    superseded_at = null,
    updated_at = v_now
  where id = v_headshot.id
  returning
    recurring_profile_headshots.id,
    recurring_profile_headshots.tenant_id,
    recurring_profile_headshots.profile_id,
    recurring_profile_headshots.uploaded_at,
    v_previous.id
  into headshot_id, tenant_id, profile_id, uploaded_at, superseded_headshot_id;

  return next;
end;
$$;

create or replace function public.activate_recurring_profile_headshot_upload(
  p_headshot_id uuid
)
returns table (
  headshot_id uuid,
  tenant_id uuid,
  profile_id uuid,
  uploaded_at timestamptz,
  superseded_headshot_id uuid
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.activate_recurring_profile_headshot_upload(p_headshot_id);
$$;

create or replace function app.claim_recurring_profile_headshot_repair_jobs(
  p_locked_by text,
  p_batch_size integer default 25,
  p_lease_seconds integer default 900
)
returns table (
  job_id uuid,
  tenant_id uuid,
  profile_id uuid,
  headshot_id uuid,
  dedupe_key text,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  locked_at timestamptz,
  locked_by text,
  lock_token uuid,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_error_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_now timestamptz := now();
  v_locked_by text := nullif(trim(p_locked_by), '');
  v_batch_size integer := greatest(1, least(coalesce(p_batch_size, 25), 100));
  v_lease_seconds integer := greatest(60, least(coalesce(p_lease_seconds, 900), 3600));
begin
  if v_locked_by is null then
    raise exception 'recurring_profile_headshot_repair_locked_by_required' using errcode = '23514';
  end if;

  return query
  with claimable as (
    select j.id
    from public.recurring_profile_headshot_repair_jobs j
    where (
      j.status = 'queued'
      and j.run_after <= v_now
    ) or (
      j.status = 'processing'
      and coalesce(j.lease_expires_at, j.locked_at, j.updated_at, j.created_at) <= v_now
    )
    order by
      case when j.status = 'queued' then 0 else 1 end asc,
      coalesce(j.run_after, j.lease_expires_at, j.locked_at, j.updated_at, j.created_at) asc,
      j.created_at asc
    for update skip locked
    limit v_batch_size
  )
  update public.recurring_profile_headshot_repair_jobs j
  set
    status = 'processing',
    locked_at = v_now,
    locked_by = v_locked_by,
    lock_token = gen_random_uuid(),
    lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
    updated_at = v_now
  from claimable c
  where j.id = c.id
  returning
    j.id,
    j.tenant_id,
    j.profile_id,
    j.headshot_id,
    j.dedupe_key,
    j.status,
    j.attempt_count,
    j.max_attempts,
    j.run_after,
    j.locked_at,
    j.locked_by,
    j.lock_token,
    j.lease_expires_at,
    j.completed_at,
    j.last_error_code,
    j.last_error_message,
    j.last_error_at,
    j.created_at,
    j.updated_at;
end;
$$;

create or replace function app.complete_recurring_profile_headshot_repair_job(
  p_job_id uuid,
  p_lock_token uuid
)
returns table (
  job_id uuid,
  status text,
  completed_at timestamptz,
  updated_at timestamptz,
  outcome text
)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_job public.recurring_profile_headshot_repair_jobs;
  v_now timestamptz := now();
begin
  select *
  into v_job
  from public.recurring_profile_headshot_repair_jobs j
  where j.id = p_job_id
  for update;

  if not found then
    return query
    select p_job_id, null::text, null::timestamptz, v_now, 'missing'::text;
    return;
  end if;

  if v_job.status <> 'processing' then
    return query
    select v_job.id, v_job.status, v_job.completed_at, v_job.updated_at, 'not_processing'::text;
    return;
  end if;

  if v_job.lock_token is distinct from p_lock_token then
    return query
    select v_job.id, v_job.status, v_job.completed_at, v_job.updated_at, 'lost_lease'::text;
    return;
  end if;

  return query
  update public.recurring_profile_headshot_repair_jobs j
  set
    status = 'succeeded',
    completed_at = v_now,
    locked_at = null,
    locked_by = null,
    lock_token = null,
    lease_expires_at = null,
    updated_at = v_now
  where j.id = p_job_id
  returning j.id, j.status, j.completed_at, j.updated_at, 'completed'::text;
end;
$$;

create or replace function app.fail_recurring_profile_headshot_repair_job(
  p_job_id uuid,
  p_lock_token uuid,
  p_error_code text default null,
  p_error_message text default null,
  p_retryable boolean default true,
  p_retry_delay_seconds integer default null
)
returns table (
  job_id uuid,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  last_error_code text,
  last_error_message text,
  last_error_at timestamptz,
  updated_at timestamptz,
  outcome text
)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_job public.recurring_profile_headshot_repair_jobs;
  v_now timestamptz := now();
  v_next_attempt integer;
  v_retry_delay_seconds integer;
  v_retryable boolean;
begin
  select *
  into v_job
  from public.recurring_profile_headshot_repair_jobs j
  where j.id = p_job_id
  for update;

  if not found then
    return query
    select
      p_job_id,
      null::text,
      null::integer,
      null::integer,
      null::timestamptz,
      null::text,
      null::text,
      null::timestamptz,
      v_now,
      'missing'::text;
    return;
  end if;

  if v_job.status <> 'processing' then
    return query
    select
      v_job.id,
      v_job.status,
      v_job.attempt_count,
      v_job.max_attempts,
      v_job.run_after,
      v_job.last_error_code,
      v_job.last_error_message,
      v_job.last_error_at,
      v_job.updated_at,
      'not_processing'::text;
    return;
  end if;

  if v_job.lock_token is distinct from p_lock_token then
    return query
    select
      v_job.id,
      v_job.status,
      v_job.attempt_count,
      v_job.max_attempts,
      v_job.run_after,
      v_job.last_error_code,
      v_job.last_error_message,
      v_job.last_error_at,
      v_job.updated_at,
      'lost_lease'::text;
    return;
  end if;

  v_next_attempt := v_job.attempt_count + 1;
  v_retryable := coalesce(p_retryable, true) and v_next_attempt < v_job.max_attempts;

  if v_retryable then
    if p_retry_delay_seconds is not null and p_retry_delay_seconds > 0 then
      v_retry_delay_seconds := p_retry_delay_seconds;
    else
      v_retry_delay_seconds := greatest(
        15,
        least(3600, (power(2::numeric, least(v_next_attempt, 10)) * 10)::integer)
      );
    end if;

    return query
    update public.recurring_profile_headshot_repair_jobs j
    set
      status = 'queued',
      attempt_count = v_next_attempt,
      run_after = v_now + make_interval(secs => v_retry_delay_seconds),
      locked_at = null,
      locked_by = null,
      lock_token = null,
      lease_expires_at = null,
      last_error_code = nullif(trim(coalesce(p_error_code, '')), ''),
      last_error_message = left(coalesce(p_error_message, ''), 2000),
      last_error_at = v_now,
      updated_at = v_now
    where j.id = p_job_id
    returning
      j.id,
      j.status,
      j.attempt_count,
      j.max_attempts,
      j.run_after,
      j.last_error_code,
      j.last_error_message,
      j.last_error_at,
      j.updated_at,
      'retried'::text;
  end if;

  return query
  update public.recurring_profile_headshot_repair_jobs j
  set
    status = 'dead',
    attempt_count = v_next_attempt,
    locked_at = null,
    locked_by = null,
    lock_token = null,
    lease_expires_at = null,
    completed_at = v_now,
    last_error_code = nullif(trim(coalesce(p_error_code, '')), ''),
    last_error_message = left(coalesce(p_error_message, ''), 2000),
    last_error_at = v_now,
    updated_at = v_now
  where j.id = p_job_id
  returning
    j.id,
    j.status,
    j.attempt_count,
    j.max_attempts,
    j.run_after,
    j.last_error_code,
    j.last_error_message,
    j.last_error_at,
    j.updated_at,
    'dead'::text;
end;
$$;

create or replace function public.claim_recurring_profile_headshot_repair_jobs(
  p_locked_by text,
  p_batch_size integer default 25,
  p_lease_seconds integer default 900
)
returns table (
  job_id uuid,
  tenant_id uuid,
  profile_id uuid,
  headshot_id uuid,
  dedupe_key text,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  locked_at timestamptz,
  locked_by text,
  lock_token uuid,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_error_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.claim_recurring_profile_headshot_repair_jobs(p_locked_by, p_batch_size, p_lease_seconds);
$$;

create or replace function public.complete_recurring_profile_headshot_repair_job(
  p_job_id uuid,
  p_lock_token uuid
)
returns table (
  job_id uuid,
  status text,
  completed_at timestamptz,
  updated_at timestamptz,
  outcome text
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.complete_recurring_profile_headshot_repair_job(p_job_id, p_lock_token);
$$;

create or replace function public.fail_recurring_profile_headshot_repair_job(
  p_job_id uuid,
  p_lock_token uuid,
  p_error_code text default null,
  p_error_message text default null,
  p_retryable boolean default true,
  p_retry_delay_seconds integer default null
)
returns table (
  job_id uuid,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  last_error_code text,
  last_error_message text,
  last_error_at timestamptz,
  updated_at timestamptz,
  outcome text
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.fail_recurring_profile_headshot_repair_job(
    p_job_id,
    p_lock_token,
    p_error_code,
    p_error_message,
    p_retryable,
    p_retry_delay_seconds
  );
$$;

revoke all on function app.activate_recurring_profile_headshot_upload(uuid) from public;
revoke all on function app.claim_recurring_profile_headshot_repair_jobs(text, integer, integer) from public;
revoke all on function app.complete_recurring_profile_headshot_repair_job(uuid, uuid) from public;
revoke all on function app.fail_recurring_profile_headshot_repair_job(uuid, uuid, text, text, boolean, integer) from public;

grant execute on function public.activate_recurring_profile_headshot_upload(uuid) to authenticated, service_role;
grant execute on function public.claim_recurring_profile_headshot_repair_jobs(text, integer, integer) to service_role;
grant execute on function public.complete_recurring_profile_headshot_repair_job(uuid, uuid) to service_role;
grant execute on function public.fail_recurring_profile_headshot_repair_job(uuid, uuid, text, text, boolean, integer) to service_role;
