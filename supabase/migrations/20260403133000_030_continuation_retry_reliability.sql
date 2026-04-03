update public.face_match_fanout_continuations
set
  max_attempts = greatest(max_attempts, 50),
  updated_at = now()
where status in ('queued', 'processing')
  and max_attempts < 50;

create or replace function app.enqueue_face_match_fanout_continuation(
  p_tenant_id uuid,
  p_project_id uuid,
  p_direction text,
  p_source_asset_id uuid,
  p_source_consent_id uuid default null,
  p_source_materialization_id uuid default null,
  p_source_materializer_version text default null,
  p_compare_version text default null,
  p_boundary_snapshot_at timestamptz default null,
  p_boundary_sort_at timestamptz default null,
  p_boundary_asset_id uuid default null,
  p_boundary_consent_id uuid default null,
  p_dispatch_mode text default 'normal',
  p_max_attempts integer default 50,
  p_run_after timestamptz default null,
  p_reset_terminal boolean default false
)
returns table (
  continuation_id uuid,
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
  v_existing public.face_match_fanout_continuations;
  v_reset_terminal boolean := coalesce(p_reset_terminal, false);
  v_can_reset_retryable_dead boolean := false;
begin
  if p_tenant_id is null
     or p_project_id is null
     or p_source_asset_id is null
     or p_source_materialization_id is null
     or nullif(trim(coalesce(p_direction, '')), '') is null
     or nullif(trim(coalesce(p_source_materializer_version, '')), '') is null
     or nullif(trim(coalesce(p_compare_version, '')), '') is null
     or p_boundary_snapshot_at is null then
    raise exception 'face_match_fanout_missing_required_fields' using errcode = '23514';
  end if;

  if p_direction = 'photo_to_headshots' and p_source_consent_id is not null then
    raise exception 'face_match_fanout_invalid_photo_scope' using errcode = '23514';
  end if;

  if p_direction = 'headshot_to_photos' and p_source_consent_id is null then
    raise exception 'face_match_fanout_missing_consent_scope' using errcode = '23514';
  end if;

  select *
  into v_existing
  from public.face_match_fanout_continuations c
  where c.tenant_id = p_tenant_id
    and c.project_id = p_project_id
    and c.direction = p_direction
    and c.source_materialization_id = p_source_materialization_id
    and c.compare_version = p_compare_version
    and c.source_consent_id is not distinct from p_source_consent_id
  for update;

  if not found then
    return query
    insert into public.face_match_fanout_continuations as c (
      tenant_id,
      project_id,
      direction,
      source_asset_id,
      source_consent_id,
      source_materialization_id,
      source_materializer_version,
      compare_version,
      boundary_snapshot_at,
      boundary_sort_at,
      boundary_asset_id,
      boundary_consent_id,
      dispatch_mode,
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
      p_direction,
      p_source_asset_id,
      p_source_consent_id,
      p_source_materialization_id,
      p_source_materializer_version,
      p_compare_version,
      p_boundary_snapshot_at,
      p_boundary_sort_at,
      p_boundary_asset_id,
      p_boundary_consent_id,
      coalesce(nullif(trim(coalesce(p_dispatch_mode, '')), ''), 'normal'),
      greatest(1, coalesce(p_max_attempts, 50)),
      v_run_after,
      'queued',
      0,
      v_now,
      v_now
    )
    returning
      c.id,
      c.status,
      c.attempt_count,
      c.max_attempts,
      c.run_after,
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

  v_can_reset_retryable_dead := (
    v_existing.status = 'dead'
    and coalesce(v_existing.last_error_code, '') in (
      'face_match_enqueue_failed',
      'face_match_requeue_failed',
      'face_match_fanout_downstream_schedule_incomplete'
    )
  );

  if not v_reset_terminal
     and (
       v_existing.status = 'queued'
       or v_existing.status in ('completed', 'superseded')
       or (
         v_existing.status = 'dead'
         and not v_can_reset_retryable_dead
       )
       or (
         v_existing.status = 'processing'
         and coalesce(v_existing.lease_expires_at, v_existing.locked_at, v_existing.updated_at, v_existing.created_at) <= v_now
       )
     ) then
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
  update public.face_match_fanout_continuations c
  set
    source_asset_id = p_source_asset_id,
    source_consent_id = p_source_consent_id,
    source_materialization_id = p_source_materialization_id,
    source_materializer_version = p_source_materializer_version,
    compare_version = p_compare_version,
    boundary_snapshot_at = p_boundary_snapshot_at,
    boundary_sort_at = p_boundary_sort_at,
    boundary_asset_id = p_boundary_asset_id,
    boundary_consent_id = p_boundary_consent_id,
    cursor_sort_at = null,
    cursor_asset_id = null,
    cursor_consent_id = null,
    dispatch_mode = coalesce(nullif(trim(coalesce(p_dispatch_mode, '')), ''), c.dispatch_mode),
    status = 'queued',
    attempt_count = 0,
    max_attempts = greatest(1, coalesce(p_max_attempts, c.max_attempts)),
    run_after = v_run_after,
    locked_at = null,
    locked_by = null,
    lock_token = null,
    lease_expires_at = null,
    started_at = null,
    completed_at = null,
    last_error_code = null,
    last_error_message = null,
    last_error_at = null,
    updated_at = v_now
  where c.id = v_existing.id
  returning
    c.id,
    c.status,
    c.attempt_count,
    c.max_attempts,
    c.run_after,
    false,
    true,
    false,
    false;
end;
$$;

create or replace function public.enqueue_face_match_fanout_continuation(
  p_tenant_id uuid,
  p_project_id uuid,
  p_direction text,
  p_source_asset_id uuid,
  p_source_consent_id uuid default null,
  p_source_materialization_id uuid default null,
  p_source_materializer_version text default null,
  p_compare_version text default null,
  p_boundary_snapshot_at timestamptz default null,
  p_boundary_sort_at timestamptz default null,
  p_boundary_asset_id uuid default null,
  p_boundary_consent_id uuid default null,
  p_dispatch_mode text default 'normal',
  p_max_attempts integer default 50,
  p_run_after timestamptz default null,
  p_reset_terminal boolean default false
)
returns table (
  continuation_id uuid,
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
  from app.enqueue_face_match_fanout_continuation(
    p_tenant_id,
    p_project_id,
    p_direction,
    p_source_asset_id,
    p_source_consent_id,
    p_source_materialization_id,
    p_source_materializer_version,
    p_compare_version,
    p_boundary_snapshot_at,
    p_boundary_sort_at,
    p_boundary_asset_id,
    p_boundary_consent_id,
    p_dispatch_mode,
    p_max_attempts,
    p_run_after,
    p_reset_terminal
  );
$$;

create or replace function app.fail_face_match_fanout_continuation(
  p_continuation_id uuid,
  p_lock_token uuid,
  p_error_code text default null,
  p_error_message text default null,
  p_retryable boolean default true,
  p_retry_delay_seconds integer default null
)
returns table (
  continuation_id uuid,
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
  v_existing public.face_match_fanout_continuations;
  v_now timestamptz := now();
  v_next_attempt integer;
  v_retry_delay_seconds integer;
  v_retryable boolean;
begin
  select *
  into v_existing
  from public.face_match_fanout_continuations c
  where c.id = p_continuation_id
  for update;

  if not found then
    return query
    select
      p_continuation_id,
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

  if v_existing.status <> 'processing' then
    return query
    select
      v_existing.id,
      v_existing.status,
      v_existing.attempt_count,
      v_existing.max_attempts,
      v_existing.run_after,
      v_existing.last_error_code,
      v_existing.last_error_message,
      v_existing.last_error_at,
      v_existing.updated_at,
      'not_processing'::text;
    return;
  end if;

  if v_existing.lock_token is distinct from p_lock_token then
    return query
    select
      v_existing.id,
      v_existing.status,
      v_existing.attempt_count,
      v_existing.max_attempts,
      v_existing.run_after,
      v_existing.last_error_code,
      v_existing.last_error_message,
      v_existing.last_error_at,
      v_existing.updated_at,
      'lost_lease'::text;
    return;
  end if;

  v_next_attempt := v_existing.attempt_count + 1;
  v_retryable := coalesce(p_retryable, true) and v_next_attempt < v_existing.max_attempts;

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
    update public.face_match_fanout_continuations c
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
    where c.id = p_continuation_id
    returning
      c.id,
      c.status,
      c.attempt_count,
      c.max_attempts,
      c.run_after,
      c.last_error_code,
      c.last_error_message,
      c.last_error_at,
      c.updated_at,
      'retried'::text;
    return;
  end if;

  return query
  update public.face_match_fanout_continuations c
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
  where c.id = p_continuation_id
  returning
    c.id,
    c.status,
    c.attempt_count,
    c.max_attempts,
    c.run_after,
    c.last_error_code,
    c.last_error_message,
    c.last_error_at,
    c.updated_at,
    'dead'::text;
end;
$$;

create or replace function public.fail_face_match_fanout_continuation(
  p_continuation_id uuid,
  p_lock_token uuid,
  p_error_code text default null,
  p_error_message text default null,
  p_retryable boolean default true,
  p_retry_delay_seconds integer default null
)
returns table (
  continuation_id uuid,
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
  from app.fail_face_match_fanout_continuation(
    p_continuation_id,
    p_lock_token,
    p_error_code,
    p_error_message,
    p_retryable,
    p_retry_delay_seconds
  );
$$;

drop function if exists app.get_project_matching_progress(uuid, uuid, text, text);
drop function if exists public.get_project_matching_progress(uuid, uuid, text, text);

create or replace function app.get_project_matching_progress(
  p_tenant_id uuid,
  p_project_id uuid,
  p_pipeline_mode text,
  p_materializer_version text
)
returns table (
  total_images bigint,
  processed_images bigint,
  is_matching_in_progress boolean,
  has_degraded_matching_state boolean
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
  ),
  active_continuations as (
    select exists(
      select 1
      from public.face_match_fanout_continuations c
      where c.tenant_id = p_tenant_id
        and c.project_id = p_project_id
        and (
          c.status = 'queued'
          or (
            c.status = 'processing'
            and coalesce(c.lease_expires_at, c.locked_at, c.updated_at, c.created_at) > now()
          )
        )
    ) as is_active
  ),
  degraded_continuations as (
    select exists(
      select 1
      from public.face_match_fanout_continuations c
      where c.tenant_id = p_tenant_id
        and c.project_id = p_project_id
        and (
          c.status = 'dead'
          or (
            c.status = 'queued'
            and c.attempt_count > 0
            and c.last_error_at is not null
          )
          or (
            c.status = 'processing'
            and c.attempt_count > 0
            and c.last_error_at is not null
            and coalesce(c.lease_expires_at, c.locked_at, c.updated_at, c.created_at) > now()
          )
        )
    ) as is_degraded
  )
  select
    (select count(*)::bigint from uploaded_photos) as total_images,
    case
      when p_pipeline_mode in ('materialized_apply', 'materialized_shadow')
        then coalesce((select processed_count from materialized_processed), 0)
      else coalesce((select processed_count from raw_processed), 0)
    end as processed_images,
    (
      coalesce((select is_active from active_jobs), false)
      or coalesce((select is_active from active_continuations), false)
    ) as is_matching_in_progress,
    coalesce((select is_degraded from degraded_continuations), false) as has_degraded_matching_state;
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
  is_matching_in_progress boolean,
  has_degraded_matching_state boolean
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
