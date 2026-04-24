alter table public.face_match_jobs
  add column if not exists lock_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists reclaim_count integer not null default 0,
  add column if not exists requeue_count integer not null default 0,
  add column if not exists last_requeued_at timestamptz,
  add column if not exists last_requeue_reason text;

update public.face_match_jobs
set lease_expires_at = coalesce(locked_at, updated_at, created_at)
where status = 'processing'
  and lease_expires_at is null;

create index if not exists face_match_jobs_status_lease_expires_idx
  on public.face_match_jobs (status, lease_expires_at);

drop function if exists app.claim_face_match_jobs(text, integer);
drop function if exists public.claim_face_match_jobs(text, integer);
drop function if exists app.complete_face_match_job(uuid);
drop function if exists public.complete_face_match_job(uuid);
drop function if exists app.fail_face_match_job(uuid, text, text, boolean, integer);
drop function if exists public.fail_face_match_job(uuid, text, text, boolean, integer);

create or replace function app.claim_face_match_jobs(
  p_locked_by text,
  p_batch_size integer default 25,
  p_lease_seconds integer default 900
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
  lock_token uuid,
  lease_expires_at timestamptz,
  reclaimed boolean,
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
  v_lease_seconds integer := greatest(60, least(coalesce(p_lease_seconds, 900), 3600));
begin
  if v_locked_by is null then
    raise exception 'face_match_job_locked_by_required' using errcode = '23514';
  end if;

  return query
  with claimable as (
    select
      j.id,
      (j.status = 'processing') as was_reclaimed
    from public.face_match_jobs j
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
  ),
  updated as (
    update public.face_match_jobs j
    set
      status = 'processing',
      locked_at = v_now,
      locked_by = v_locked_by,
      lock_token = gen_random_uuid(),
      lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
      started_at = v_now,
      reclaim_count = case when c.was_reclaimed then j.reclaim_count + 1 else j.reclaim_count end,
      updated_at = v_now
    from claimable c
    where j.id = c.id
    returning
      j.*,
      c.was_reclaimed
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
    u.lock_token,
    u.lease_expires_at,
    u.was_reclaimed,
    u.started_at,
    u.completed_at,
    u.last_error_code,
    u.last_error_message,
    u.last_error_at,
    u.created_at,
    u.updated_at
  from updated u
  order by coalesce(u.run_after, u.lease_expires_at, u.locked_at, u.created_at) asc, u.created_at asc;
end;
$$;

create or replace function app.complete_face_match_job(
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
  v_now timestamptz := now();
  v_job public.face_match_jobs;
begin
  select *
  into v_job
  from public.face_match_jobs j
  where j.id = p_job_id
  for update;

  if not found then
    return query
    select
      p_job_id,
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
      v_job.completed_at,
      v_job.updated_at,
      'not_processing'::text;
    return;
  end if;

  if v_job.lock_token is distinct from p_lock_token then
    return query
    select
      v_job.id,
      v_job.status,
      v_job.completed_at,
      v_job.updated_at,
      'lost_lease'::text;
    return;
  end if;

  return query
  update public.face_match_jobs j
  set
    status = 'succeeded',
    completed_at = v_now,
    locked_at = null,
    locked_by = null,
    lock_token = null,
    lease_expires_at = null,
    updated_at = v_now
  where j.id = p_job_id
  returning
    j.id,
    j.status,
    j.completed_at,
    j.updated_at,
    'completed'::text;
end;
$$;

create or replace function app.fail_face_match_job(
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
    update public.face_match_jobs j
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
  update public.face_match_jobs j
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

create or replace function app.requeue_face_match_job(
  p_tenant_id uuid,
  p_project_id uuid,
  p_workspace_id uuid,
  p_job_type text,
  p_dedupe_key text,
  p_scope_asset_id uuid default null,
  p_scope_consent_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_max_attempts integer default 5,
  p_run_after timestamptz default null,
  p_requeue_reason text default null
)
returns table (
  job_id uuid,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  enqueued boolean,
  requeued boolean,
  already_processing boolean,
  already_queued boolean
)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_now timestamptz := now();
  v_run_after timestamptz := coalesce(p_run_after, v_now);
  v_dedupe_key text := nullif(trim(p_dedupe_key), '');
  v_requeue_reason text := nullif(left(trim(coalesce(p_requeue_reason, '')), 500), '');
  v_workspace_id uuid := coalesce(p_workspace_id, app.default_project_workspace_id(p_tenant_id, p_project_id));
  v_existing public.face_match_jobs;
begin
  if p_tenant_id is null or p_project_id is null then
    raise exception 'face_match_job_missing_scope' using errcode = '23514';
  end if;

  if v_workspace_id is null then
    raise exception 'project_workspace_required' using errcode = '23514';
  end if;

  if v_dedupe_key is null then
    raise exception 'face_match_job_missing_dedupe_key' using errcode = '23514';
  end if;

  select *
  into v_existing
  from public.face_match_jobs j
  where j.tenant_id = p_tenant_id
    and j.project_id = p_project_id
    and j.workspace_id = v_workspace_id
    and j.dedupe_key = v_dedupe_key
  for update;

  if not found then
    return query
    insert into public.face_match_jobs as j (
      tenant_id,
      project_id,
      workspace_id,
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
      v_workspace_id,
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
    returning
      j.id,
      j.status,
      j.attempt_count,
      j.max_attempts,
      j.run_after,
      true,
      false,
      false,
      false;
    return;
  end if;

  if v_existing.status = 'processing'
     and coalesce(v_existing.lease_expires_at, v_existing.locked_at, v_existing.updated_at, v_existing.created_at) > v_now then
    return query
    select
      v_existing.id,
      v_existing.status,
      v_existing.attempt_count,
      v_existing.max_attempts,
      v_existing.run_after,
      false,
      false,
      true,
      false;
    return;
  end if;

  if v_existing.status = 'queued' and v_existing.run_after <= v_now then
    return query
    select
      v_existing.id,
      v_existing.status,
      v_existing.attempt_count,
      v_existing.max_attempts,
      v_existing.run_after,
      false,
      false,
      false,
      true;
    return;
  end if;

  return query
  update public.face_match_jobs j
  set
    workspace_id = v_workspace_id,
    scope_asset_id = p_scope_asset_id,
    scope_consent_id = p_scope_consent_id,
    job_type = p_job_type,
    payload = coalesce(p_payload, '{}'::jsonb),
    max_attempts = p_max_attempts,
    run_after = v_run_after,
    status = 'queued',
    attempt_count = 0,
    locked_at = null,
    locked_by = null,
    lock_token = null,
    lease_expires_at = null,
    started_at = null,
    completed_at = null,
    last_error_code = null,
    last_error_message = null,
    last_error_at = null,
    requeue_count = j.requeue_count + 1,
    last_requeued_at = v_now,
    last_requeue_reason = v_requeue_reason,
    updated_at = v_now
  where j.id = v_existing.id
  returning
    j.id,
    j.status,
    j.attempt_count,
    j.max_attempts,
    j.run_after,
    false,
    true,
    false,
    false;
end;
$$;

create or replace function public.claim_face_match_jobs(
  p_locked_by text,
  p_batch_size integer default 25,
  p_lease_seconds integer default 900
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
  lock_token uuid,
  lease_expires_at timestamptz,
  reclaimed boolean,
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
    p_batch_size,
    p_lease_seconds
  );
$$;

create or replace function public.complete_face_match_job(
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
  from app.complete_face_match_job(p_job_id, p_lock_token);
$$;

create or replace function public.fail_face_match_job(
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
  from app.fail_face_match_job(
    p_job_id,
    p_lock_token,
    p_error_code,
    p_error_message,
    p_retryable,
    p_retry_delay_seconds
  );
$$;

create or replace function public.requeue_face_match_job(
  p_tenant_id uuid,
  p_project_id uuid,
  p_workspace_id uuid,
  p_job_type text,
  p_dedupe_key text,
  p_scope_asset_id uuid default null,
  p_scope_consent_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_max_attempts integer default 5,
  p_run_after timestamptz default null,
  p_requeue_reason text default null
)
returns table (
  job_id uuid,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  enqueued boolean,
  requeued boolean,
  already_processing boolean,
  already_queued boolean
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.requeue_face_match_job(
    p_tenant_id,
    p_project_id,
    p_workspace_id,
    p_job_type,
    p_dedupe_key,
    p_scope_asset_id,
    p_scope_consent_id,
    p_payload,
    p_max_attempts,
    p_run_after,
    p_requeue_reason
  );
$$;

revoke all on function app.claim_face_match_jobs(text, integer, integer) from public;
revoke all on function app.complete_face_match_job(uuid, uuid) from public;
revoke all on function app.fail_face_match_job(uuid, uuid, text, text, boolean, integer) from public;
revoke all on function app.requeue_face_match_job(uuid, uuid, uuid, text, text, uuid, uuid, jsonb, integer, timestamptz, text) from public;

revoke all on function public.claim_face_match_jobs(text, integer, integer) from public;
revoke all on function public.complete_face_match_job(uuid, uuid) from public;
revoke all on function public.fail_face_match_job(uuid, uuid, text, text, boolean, integer) from public;
revoke all on function public.requeue_face_match_job(uuid, uuid, uuid, text, text, uuid, uuid, jsonb, integer, timestamptz, text) from public;

grant execute on function public.claim_face_match_jobs(text, integer, integer) to service_role;
grant execute on function public.complete_face_match_job(uuid, uuid) to service_role;
grant execute on function public.fail_face_match_job(uuid, uuid, text, text, boolean, integer) to service_role;
grant execute on function public.requeue_face_match_job(uuid, uuid, uuid, text, text, uuid, uuid, jsonb, integer, timestamptz, text) to service_role;

create or replace function app.get_project_matching_progress(
  p_tenant_id uuid,
  p_project_id uuid,
  p_pipeline_mode text,
  p_materializer_version text
)
returns table (
  total_images bigint,
  processed_images bigint,
  is_matching_in_progress boolean
)
language sql
security definer
set search_path = public, app, extensions
as $$
  with uploaded_photos as (
    select a.id
    from public.assets a
    where a.tenant_id = p_tenant_id
      and a.project_id = p_project_id
      and a.asset_type = 'photo'
      and a.status = 'uploaded'
      and a.archived_at is null
  ),
  materialized_processed as (
    select count(distinct m.asset_id)::bigint as processed_count
    from public.asset_face_materializations m
    inner join uploaded_photos p
      on p.id = m.asset_id
    where m.tenant_id = p_tenant_id
      and m.project_id = p_project_id
      and m.asset_type = 'photo'
      and m.materializer_version = p_materializer_version
  ),
  raw_processed as (
    select count(*)::bigint as processed_count
    from uploaded_photos p
    where exists (
      select 1
      from public.face_match_jobs j
      where j.tenant_id = p_tenant_id
        and j.project_id = p_project_id
        and j.job_type = 'photo_uploaded'
        and j.scope_asset_id = p.id
        and j.status in ('succeeded', 'dead')
    )
      and not exists (
        select 1
        from public.face_match_jobs j
        where j.tenant_id = p_tenant_id
          and j.project_id = p_project_id
          and j.job_type = 'photo_uploaded'
          and j.scope_asset_id = p.id
          and (
            j.status = 'queued'
            or (
              j.status = 'processing'
              and coalesce(j.lease_expires_at, j.locked_at, j.updated_at, j.created_at) > now()
            )
          )
      )
  ),
  active_jobs as (
    select exists(
      select 1
      from public.face_match_jobs j
      where j.tenant_id = p_tenant_id
        and j.project_id = p_project_id
        and (
          j.status = 'queued'
          or (
            j.status = 'processing'
            and coalesce(j.lease_expires_at, j.locked_at, j.updated_at, j.created_at) > now()
          )
        )
        and j.job_type in ('photo_uploaded', 'consent_headshot_ready', 'materialize_asset_faces', 'compare_materialized_pair')
    ) as is_active
  )
  select
    (select count(*)::bigint from uploaded_photos) as total_images,
    case
      when p_pipeline_mode in ('materialized_apply', 'materialized_shadow')
        then coalesce((select processed_count from materialized_processed), 0)
      else coalesce((select processed_count from raw_processed), 0)
    end as processed_images,
    coalesce((select is_active from active_jobs), false) as is_matching_in_progress;
$$;

create or replace function public.get_project_matching_progress(
  p_tenant_id uuid,
  p_project_id uuid,
  p_pipeline_mode text,
  p_materializer_version text
)
returns table (
  total_images bigint,
  processed_images bigint,
  is_matching_in_progress boolean
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.get_project_matching_progress(
    p_tenant_id,
    p_project_id,
    p_pipeline_mode,
    p_materializer_version
  );
$$;
