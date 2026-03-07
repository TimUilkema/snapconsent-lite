create or replace function app.enqueue_face_match_job(
  p_tenant_id uuid,
  p_project_id uuid,
  p_job_type text,
  p_dedupe_key text,
  p_scope_asset_id uuid default null,
  p_scope_consent_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_max_attempts integer default 5,
  p_run_after timestamptz default null
)
returns table (
  job_id uuid,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  enqueued boolean
)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_now timestamptz := now();
  v_run_after timestamptz := coalesce(p_run_after, v_now);
  v_dedupe_key text := nullif(trim(p_dedupe_key), '');
begin
  if p_tenant_id is null or p_project_id is null then
    raise exception 'face_match_job_missing_scope' using errcode = '23514';
  end if;

  if v_dedupe_key is null then
    raise exception 'face_match_job_missing_dedupe_key' using errcode = '23514';
  end if;

  return query
  with upserted as (
    insert into public.face_match_jobs (
      tenant_id,
      project_id,
      scope_asset_id,
      scope_consent_id,
      job_type,
      dedupe_key,
      payload,
      max_attempts,
      run_after,
      status,
      attempt_count,
      created_at,
      updated_at
    )
    values (
      p_tenant_id,
      p_project_id,
      p_scope_asset_id,
      p_scope_consent_id,
      p_job_type,
      v_dedupe_key,
      coalesce(p_payload, '{}'::jsonb),
      p_max_attempts,
      v_run_after,
      'queued',
      0,
      v_now,
      v_now
    )
    on conflict (tenant_id, project_id, dedupe_key)
    do update
      set updated_at = v_now
    returning
      public.face_match_jobs.id,
      public.face_match_jobs.status,
      public.face_match_jobs.attempt_count,
      public.face_match_jobs.max_attempts,
      public.face_match_jobs.run_after,
      (xmax = 0) as was_inserted
  )
  select
    u.id,
    u.status,
    u.attempt_count,
    u.max_attempts,
    u.run_after,
    u.was_inserted
  from upserted u;
end;
$$;

create or replace function app.claim_face_match_jobs(
  p_locked_by text,
  p_batch_size integer default 25
)
returns table (
  job_id uuid,
  tenant_id uuid,
  project_id uuid,
  scope_asset_id uuid,
  scope_consent_id uuid,
  job_type text,
  dedupe_key text,
  payload jsonb,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
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
  v_batch_size integer := greatest(1, least(coalesce(p_batch_size, 25), 200));
begin
  if v_locked_by is null then
    raise exception 'face_match_job_locked_by_required' using errcode = '23514';
  end if;

  return query
  with claimable as (
    select j.id
    from public.face_match_jobs j
    where j.status = 'queued'
      and j.run_after <= v_now
    order by j.run_after asc, j.created_at asc
    for update skip locked
    limit v_batch_size
  ),
  updated as (
    update public.face_match_jobs j
    set
      status = 'processing',
      locked_at = v_now,
      locked_by = v_locked_by,
      started_at = v_now,
      updated_at = v_now
    from claimable c
    where j.id = c.id
    returning j.*
  )
  select
    u.id,
    u.tenant_id,
    u.project_id,
    u.scope_asset_id,
    u.scope_consent_id,
    u.job_type,
    u.dedupe_key,
    u.payload,
    u.status,
    u.attempt_count,
    u.max_attempts,
    u.run_after,
    u.locked_at,
    u.locked_by,
    u.started_at,
    u.completed_at,
    u.last_error_code,
    u.last_error_message,
    u.last_error_at,
    u.created_at,
    u.updated_at
  from updated u
  order by u.run_after asc, u.created_at asc;
end;
$$;

create or replace function app.complete_face_match_job(
  p_job_id uuid
)
returns table (
  job_id uuid,
  status text,
  completed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_now timestamptz := now();
begin
  return query
  update public.face_match_jobs j
  set
    status = 'succeeded',
    completed_at = v_now,
    locked_at = null,
    locked_by = null,
    updated_at = v_now
  where j.id = p_job_id
    and j.status = 'processing'
  returning
    j.id,
    j.status,
    j.completed_at,
    j.updated_at;
end;
$$;

create or replace function app.fail_face_match_job(
  p_job_id uuid,
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
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_job public.face_match_jobs;
  v_now timestamptz := now();
  v_next_attempt integer;
  v_retry_delay_seconds integer;
  v_retryable boolean;
begin
  select *
  into v_job
  from public.face_match_jobs j
  where j.id = p_job_id
    and j.status = 'processing'
  for update;

  if not found then
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
    update public.face_match_jobs j
    set
      status = 'queued',
      attempt_count = v_next_attempt,
      run_after = v_now + make_interval(secs => v_retry_delay_seconds),
      locked_at = null,
      locked_by = null,
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
      j.updated_at;
  else
    return query
    update public.face_match_jobs j
    set
      status = 'dead',
      attempt_count = v_next_attempt,
      locked_at = null,
      locked_by = null,
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
      j.updated_at;
  end if;
end;
$$;

create or replace function public.enqueue_face_match_job(
  p_tenant_id uuid,
  p_project_id uuid,
  p_job_type text,
  p_dedupe_key text,
  p_scope_asset_id uuid default null,
  p_scope_consent_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_max_attempts integer default 5,
  p_run_after timestamptz default null
)
returns table (
  job_id uuid,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  enqueued boolean
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.enqueue_face_match_job(
    p_tenant_id,
    p_project_id,
    p_job_type,
    p_dedupe_key,
    p_scope_asset_id,
    p_scope_consent_id,
    p_payload,
    p_max_attempts,
    p_run_after
  );
$$;

create or replace function public.claim_face_match_jobs(
  p_locked_by text,
  p_batch_size integer default 25
)
returns table (
  job_id uuid,
  tenant_id uuid,
  project_id uuid,
  scope_asset_id uuid,
  scope_consent_id uuid,
  job_type text,
  dedupe_key text,
  payload jsonb,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
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
  from app.claim_face_match_jobs(
    p_locked_by,
    p_batch_size
  );
$$;

create or replace function public.complete_face_match_job(
  p_job_id uuid
)
returns table (
  job_id uuid,
  status text,
  completed_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.complete_face_match_job(p_job_id);
$$;

create or replace function public.fail_face_match_job(
  p_job_id uuid,
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
  updated_at timestamptz
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.fail_face_match_job(
    p_job_id,
    p_error_code,
    p_error_message,
    p_retryable,
    p_retry_delay_seconds
  );
$$;

revoke all on function app.enqueue_face_match_job(uuid, uuid, text, text, uuid, uuid, jsonb, integer, timestamptz) from public;
revoke all on function app.claim_face_match_jobs(text, integer) from public;
revoke all on function app.complete_face_match_job(uuid) from public;
revoke all on function app.fail_face_match_job(uuid, text, text, boolean, integer) from public;

revoke all on function public.enqueue_face_match_job(uuid, uuid, text, text, uuid, uuid, jsonb, integer, timestamptz) from public;
revoke all on function public.claim_face_match_jobs(text, integer) from public;
revoke all on function public.complete_face_match_job(uuid) from public;
revoke all on function public.fail_face_match_job(uuid, text, text, boolean, integer) from public;

grant execute on function public.enqueue_face_match_job(uuid, uuid, text, text, uuid, uuid, jsonb, integer, timestamptz) to service_role;
grant execute on function public.claim_face_match_jobs(text, integer) to service_role;
grant execute on function public.complete_face_match_job(uuid) to service_role;
grant execute on function public.fail_face_match_job(uuid, text, text, boolean, integer) to service_role;
