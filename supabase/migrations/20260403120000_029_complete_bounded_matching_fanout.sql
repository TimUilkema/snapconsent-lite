create table if not exists public.face_match_fanout_continuations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  direction text not null,
  source_asset_id uuid not null,
  source_consent_id uuid,
  source_materialization_id uuid not null,
  source_materializer_version text not null,
  compare_version text not null,
  boundary_snapshot_at timestamptz not null,
  boundary_sort_at timestamptz,
  boundary_asset_id uuid,
  boundary_consent_id uuid,
  cursor_sort_at timestamptz,
  cursor_asset_id uuid,
  cursor_consent_id uuid,
  dispatch_mode text not null default 'normal',
  status text not null default 'queued',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  lock_token uuid,
  lease_expires_at timestamptz,
  reclaim_count integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint face_match_fanout_continuations_project_scope_fk
    foreign key (project_id, tenant_id)
    references public.projects(id, tenant_id)
    on delete restrict,
  constraint face_match_fanout_continuations_source_asset_scope_fk
    foreign key (source_asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete restrict,
  constraint face_match_fanout_continuations_source_consent_scope_fk
    foreign key (source_consent_id, tenant_id, project_id)
    references public.consents(id, tenant_id, project_id)
    on delete restrict,
  constraint face_match_fanout_continuations_source_materialization_fk
    foreign key (source_materialization_id)
    references public.asset_face_materializations(id)
    on delete cascade,
  constraint face_match_fanout_continuations_direction_check
    check (direction in ('photo_to_headshots', 'headshot_to_photos')),
  constraint face_match_fanout_continuations_dispatch_mode_check
    check (dispatch_mode in ('normal', 'backfill_repair')),
  constraint face_match_fanout_continuations_status_check
    check (status in ('queued', 'processing', 'completed', 'superseded', 'dead')),
  constraint face_match_fanout_continuations_attempt_count_check
    check (attempt_count >= 0),
  constraint face_match_fanout_continuations_max_attempts_check
    check (max_attempts > 0),
  constraint face_match_fanout_continuations_scope_check
    check (
      (direction = 'photo_to_headshots' and source_consent_id is null and boundary_asset_id is null)
      or (direction = 'headshot_to_photos' and source_consent_id is not null and boundary_consent_id is null)
    )
);

create unique index if not exists face_match_fanout_continuations_photo_source_key
  on public.face_match_fanout_continuations (tenant_id, project_id, direction, source_materialization_id, compare_version)
  where direction = 'photo_to_headshots';

create unique index if not exists face_match_fanout_continuations_headshot_source_key
  on public.face_match_fanout_continuations (
    tenant_id,
    project_id,
    direction,
    source_materialization_id,
    source_consent_id,
    compare_version
  )
  where direction = 'headshot_to_photos';

create index if not exists face_match_fanout_continuations_status_run_after_idx
  on public.face_match_fanout_continuations (status, run_after, lease_expires_at);

create index if not exists face_match_fanout_continuations_project_status_idx
  on public.face_match_fanout_continuations (tenant_id, project_id, status, run_after);

create index if not exists face_match_fanout_continuations_source_lookup_idx
  on public.face_match_fanout_continuations (
    tenant_id,
    project_id,
    source_asset_id,
    source_consent_id,
    source_materialization_id,
    created_at desc
  );

create index if not exists assets_matching_uploaded_photo_page_idx
  on public.assets (tenant_id, project_id, uploaded_at, id)
  where asset_type = 'photo'
    and status = 'uploaded'
    and archived_at is null;

create index if not exists consents_matching_created_page_idx
  on public.consents (tenant_id, project_id, created_at, id)
  where face_match_opt_in = true
    and revoked_at is null;

create index if not exists asset_consent_links_tenant_project_consent_asset_idx
  on public.asset_consent_links (tenant_id, project_id, consent_id, asset_id);

alter table public.face_match_fanout_continuations enable row level security;

revoke all on table public.face_match_fanout_continuations from public;
revoke all on table public.face_match_fanout_continuations from anon;
revoke all on table public.face_match_fanout_continuations from authenticated;

grant select, insert, update, delete on table public.face_match_fanout_continuations to service_role;

create or replace function app.get_photo_fanout_boundary(
  p_tenant_id uuid,
  p_project_id uuid
)
returns table (
  boundary_snapshot_at timestamptz,
  boundary_uploaded_at timestamptz,
  boundary_asset_id uuid
)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_snapshot_at timestamptz := now();
begin
  return query
  select
    v_snapshot_at,
    a.uploaded_at,
    a.id
  from public.assets a
  where a.tenant_id = p_tenant_id
    and a.project_id = p_project_id
    and a.asset_type = 'photo'
    and a.status = 'uploaded'
    and a.archived_at is null
  order by a.uploaded_at desc nulls last, a.id desc
  limit 1;
end;
$$;

create or replace function app.get_current_consent_headshot_fanout_boundary(
  p_tenant_id uuid,
  p_project_id uuid
)
returns table (
  boundary_snapshot_at timestamptz,
  boundary_consent_created_at timestamptz,
  boundary_consent_id uuid
)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_snapshot_at timestamptz := now();
begin
  return query
  select
    v_snapshot_at,
    c.created_at,
    c.id
  from public.consents c
  inner join lateral (
    select a.id
    from public.asset_consent_links acl
    inner join public.assets a
      on a.id = acl.asset_id
      and a.tenant_id = p_tenant_id
      and a.project_id = p_project_id
      and a.asset_type = 'headshot'
      and a.status = 'uploaded'
      and a.archived_at is null
      and (a.retention_expires_at is null or a.retention_expires_at > v_snapshot_at)
      and a.uploaded_at is not null
      and a.uploaded_at <= v_snapshot_at
    where acl.tenant_id = p_tenant_id
      and acl.project_id = p_project_id
      and acl.consent_id = c.id
    order by a.uploaded_at desc nulls last, a.id desc
    limit 1
  ) current_headshot on true
  where c.tenant_id = p_tenant_id
    and c.project_id = p_project_id
    and c.face_match_opt_in = true
    and c.revoked_at is null
  order by c.created_at desc, c.id desc
  limit 1;
end;
$$;

create or replace function app.list_uploaded_project_photos_page(
  p_tenant_id uuid,
  p_project_id uuid,
  p_limit integer default 100,
  p_cursor_uploaded_at timestamptz default null,
  p_cursor_asset_id uuid default null,
  p_boundary_uploaded_at timestamptz default null,
  p_boundary_asset_id uuid default null
)
returns table (
  asset_id uuid,
  uploaded_at timestamptz
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select
    a.id as asset_id,
    a.uploaded_at
  from public.assets a
  where a.tenant_id = p_tenant_id
    and a.project_id = p_project_id
    and a.asset_type = 'photo'
    and a.status = 'uploaded'
    and a.archived_at is null
    and (
      p_boundary_uploaded_at is null
      or a.uploaded_at < p_boundary_uploaded_at
      or (a.uploaded_at = p_boundary_uploaded_at and a.id <= p_boundary_asset_id)
    )
    and (
      p_cursor_uploaded_at is null
      or a.uploaded_at > p_cursor_uploaded_at
      or (a.uploaded_at = p_cursor_uploaded_at and a.id > p_cursor_asset_id)
    )
  order by a.uploaded_at asc, a.id asc
  limit greatest(1, least(coalesce(p_limit, 100), 750));
$$;

create or replace function app.list_current_project_consent_headshots_page(
  p_tenant_id uuid,
  p_project_id uuid,
  p_boundary_snapshot_at timestamptz,
  p_opt_in_only boolean default true,
  p_not_revoked_only boolean default true,
  p_limit integer default 100,
  p_cursor_consent_created_at timestamptz default null,
  p_cursor_consent_id uuid default null,
  p_boundary_consent_created_at timestamptz default null,
  p_boundary_consent_id uuid default null
)
returns table (
  consent_id uuid,
  consent_created_at timestamptz,
  headshot_asset_id uuid,
  headshot_uploaded_at timestamptz
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select
    c.id as consent_id,
    c.created_at as consent_created_at,
    current_headshot.headshot_asset_id,
    current_headshot.headshot_uploaded_at
  from public.consents c
  inner join lateral (
    select
      a.id as headshot_asset_id,
      a.uploaded_at as headshot_uploaded_at
    from public.asset_consent_links acl
    inner join public.assets a
      on a.id = acl.asset_id
      and a.tenant_id = p_tenant_id
      and a.project_id = p_project_id
      and a.asset_type = 'headshot'
      and a.status = 'uploaded'
      and a.archived_at is null
      and (a.retention_expires_at is null or a.retention_expires_at > now())
      and a.uploaded_at is not null
      and a.uploaded_at <= p_boundary_snapshot_at
    where acl.tenant_id = p_tenant_id
      and acl.project_id = p_project_id
      and acl.consent_id = c.id
    order by a.uploaded_at desc nulls last, a.id desc
    limit 1
  ) current_headshot on true
  where c.tenant_id = p_tenant_id
    and c.project_id = p_project_id
    and (not coalesce(p_opt_in_only, true) or c.face_match_opt_in = true)
    and (not coalesce(p_not_revoked_only, true) or c.revoked_at is null)
    and (
      p_boundary_consent_created_at is null
      or c.created_at < p_boundary_consent_created_at
      or (c.created_at = p_boundary_consent_created_at and c.id <= p_boundary_consent_id)
    )
    and (
      p_cursor_consent_created_at is null
      or c.created_at > p_cursor_consent_created_at
      or (c.created_at = p_cursor_consent_created_at and c.id > p_cursor_consent_id)
    )
  order by c.created_at asc, c.id asc
  limit greatest(1, least(coalesce(p_limit, 100), 750));
$$;

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
  p_max_attempts integer default 5,
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
      greatest(1, coalesce(p_max_attempts, 5)),
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

  if not v_reset_terminal
     and (
       v_existing.status = 'queued'
       or v_existing.status in ('completed', 'superseded', 'dead')
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

create or replace function app.claim_face_match_fanout_continuations(
  p_locked_by text,
  p_batch_size integer default 25,
  p_lease_seconds integer default 900
)
returns table (
  continuation_id uuid,
  tenant_id uuid,
  project_id uuid,
  direction text,
  source_asset_id uuid,
  source_consent_id uuid,
  source_materialization_id uuid,
  source_materializer_version text,
  compare_version text,
  boundary_snapshot_at timestamptz,
  boundary_sort_at timestamptz,
  boundary_asset_id uuid,
  boundary_consent_id uuid,
  cursor_sort_at timestamptz,
  cursor_asset_id uuid,
  cursor_consent_id uuid,
  dispatch_mode text,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  locked_at timestamptz,
  locked_by text,
  lock_token uuid,
  lease_expires_at timestamptz,
  reclaimed boolean,
  reclaim_count integer,
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
    raise exception 'face_match_fanout_locked_by_required' using errcode = '23514';
  end if;

  return query
  with claimable as (
    select
      c.id,
      (c.status = 'processing') as was_reclaimed
    from public.face_match_fanout_continuations c
    where (
      c.status = 'queued'
      and c.run_after <= v_now
    ) or (
      c.status = 'processing'
      and coalesce(c.lease_expires_at, c.locked_at, c.updated_at, c.created_at) <= v_now
    )
    order by
      case when c.status = 'queued' then 0 else 1 end asc,
      coalesce(c.run_after, c.lease_expires_at, c.locked_at, c.updated_at, c.created_at) asc,
      c.created_at asc
    for update skip locked
    limit v_batch_size
  ),
  updated as (
    update public.face_match_fanout_continuations c
    set
      status = 'processing',
      locked_at = v_now,
      locked_by = v_locked_by,
      lock_token = gen_random_uuid(),
      lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
      started_at = v_now,
      reclaim_count = case when claimable.was_reclaimed then c.reclaim_count + 1 else c.reclaim_count end,
      updated_at = v_now
    from claimable
    where c.id = claimable.id
    returning
      c.*,
      claimable.was_reclaimed
  )
  select
    u.id,
    u.tenant_id,
    u.project_id,
    u.direction,
    u.source_asset_id,
    u.source_consent_id,
    u.source_materialization_id,
    u.source_materializer_version,
    u.compare_version,
    u.boundary_snapshot_at,
    u.boundary_sort_at,
    u.boundary_asset_id,
    u.boundary_consent_id,
    u.cursor_sort_at,
    u.cursor_asset_id,
    u.cursor_consent_id,
    u.dispatch_mode,
    u.status,
    u.attempt_count,
    u.max_attempts,
    u.run_after,
    u.locked_at,
    u.locked_by,
    u.lock_token,
    u.lease_expires_at,
    u.was_reclaimed,
    u.reclaim_count,
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

create or replace function app.complete_face_match_fanout_continuation_batch(
  p_continuation_id uuid,
  p_lock_token uuid,
  p_next_status text,
  p_run_after timestamptz default null,
  p_cursor_sort_at timestamptz default null,
  p_cursor_asset_id uuid default null,
  p_cursor_consent_id uuid default null
)
returns table (
  continuation_id uuid,
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
  v_existing public.face_match_fanout_continuations;
  v_next_status text := nullif(trim(coalesce(p_next_status, '')), '');
begin
  if v_next_status is null or v_next_status not in ('queued', 'completed', 'superseded') then
    raise exception 'face_match_fanout_invalid_complete_status' using errcode = '23514';
  end if;

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
      v_existing.completed_at,
      v_existing.updated_at,
      'not_processing'::text;
    return;
  end if;

  if v_existing.lock_token is distinct from p_lock_token then
    return query
    select
      v_existing.id,
      v_existing.status,
      v_existing.completed_at,
      v_existing.updated_at,
      'lost_lease'::text;
    return;
  end if;

  return query
  update public.face_match_fanout_continuations c
  set
    status = v_next_status,
    cursor_sort_at = p_cursor_sort_at,
    cursor_asset_id = p_cursor_asset_id,
    cursor_consent_id = p_cursor_consent_id,
    run_after = case when v_next_status = 'queued' then coalesce(p_run_after, v_now) else c.run_after end,
    completed_at = case when v_next_status in ('completed', 'superseded') then v_now else null end,
    locked_at = null,
    locked_by = null,
    lock_token = null,
    lease_expires_at = null,
    updated_at = v_now
  where c.id = p_continuation_id
  returning
    c.id,
    c.status,
    c.completed_at,
    c.updated_at,
    'completed'::text;
end;
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

create or replace function public.get_photo_fanout_boundary(
  p_tenant_id uuid,
  p_project_id uuid
)
returns table (
  boundary_snapshot_at timestamptz,
  boundary_uploaded_at timestamptz,
  boundary_asset_id uuid
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.get_photo_fanout_boundary(p_tenant_id, p_project_id);
$$;

create or replace function public.get_current_consent_headshot_fanout_boundary(
  p_tenant_id uuid,
  p_project_id uuid
)
returns table (
  boundary_snapshot_at timestamptz,
  boundary_consent_created_at timestamptz,
  boundary_consent_id uuid
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.get_current_consent_headshot_fanout_boundary(p_tenant_id, p_project_id);
$$;

create or replace function public.list_uploaded_project_photos_page(
  p_tenant_id uuid,
  p_project_id uuid,
  p_limit integer default 100,
  p_cursor_uploaded_at timestamptz default null,
  p_cursor_asset_id uuid default null,
  p_boundary_uploaded_at timestamptz default null,
  p_boundary_asset_id uuid default null
)
returns table (
  asset_id uuid,
  uploaded_at timestamptz
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.list_uploaded_project_photos_page(
    p_tenant_id,
    p_project_id,
    p_limit,
    p_cursor_uploaded_at,
    p_cursor_asset_id,
    p_boundary_uploaded_at,
    p_boundary_asset_id
  );
$$;

create or replace function public.list_current_project_consent_headshots_page(
  p_tenant_id uuid,
  p_project_id uuid,
  p_boundary_snapshot_at timestamptz,
  p_opt_in_only boolean default true,
  p_not_revoked_only boolean default true,
  p_limit integer default 100,
  p_cursor_consent_created_at timestamptz default null,
  p_cursor_consent_id uuid default null,
  p_boundary_consent_created_at timestamptz default null,
  p_boundary_consent_id uuid default null
)
returns table (
  consent_id uuid,
  consent_created_at timestamptz,
  headshot_asset_id uuid,
  headshot_uploaded_at timestamptz
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.list_current_project_consent_headshots_page(
    p_tenant_id,
    p_project_id,
    p_boundary_snapshot_at,
    p_opt_in_only,
    p_not_revoked_only,
    p_limit,
    p_cursor_consent_created_at,
    p_cursor_consent_id,
    p_boundary_consent_created_at,
    p_boundary_consent_id
  );
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
  p_max_attempts integer default 5,
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

create or replace function public.claim_face_match_fanout_continuations(
  p_locked_by text,
  p_batch_size integer default 25,
  p_lease_seconds integer default 900
)
returns table (
  continuation_id uuid,
  tenant_id uuid,
  project_id uuid,
  direction text,
  source_asset_id uuid,
  source_consent_id uuid,
  source_materialization_id uuid,
  source_materializer_version text,
  compare_version text,
  boundary_snapshot_at timestamptz,
  boundary_sort_at timestamptz,
  boundary_asset_id uuid,
  boundary_consent_id uuid,
  cursor_sort_at timestamptz,
  cursor_asset_id uuid,
  cursor_consent_id uuid,
  dispatch_mode text,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  locked_at timestamptz,
  locked_by text,
  lock_token uuid,
  lease_expires_at timestamptz,
  reclaimed boolean,
  reclaim_count integer,
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
  from app.claim_face_match_fanout_continuations(
    p_locked_by,
    p_batch_size,
    p_lease_seconds
  );
$$;

create or replace function public.complete_face_match_fanout_continuation_batch(
  p_continuation_id uuid,
  p_lock_token uuid,
  p_next_status text,
  p_run_after timestamptz default null,
  p_cursor_sort_at timestamptz default null,
  p_cursor_asset_id uuid default null,
  p_cursor_consent_id uuid default null
)
returns table (
  continuation_id uuid,
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
  from app.complete_face_match_fanout_continuation_batch(
    p_continuation_id,
    p_lock_token,
    p_next_status,
    p_run_after,
    p_cursor_sort_at,
    p_cursor_asset_id,
    p_cursor_consent_id
  );
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

revoke all on function app.get_photo_fanout_boundary(uuid, uuid) from public;
revoke all on function app.get_current_consent_headshot_fanout_boundary(uuid, uuid) from public;
revoke all on function app.list_uploaded_project_photos_page(uuid, uuid, integer, timestamptz, uuid, timestamptz, uuid) from public;
revoke all on function app.list_current_project_consent_headshots_page(uuid, uuid, timestamptz, boolean, boolean, integer, timestamptz, uuid, timestamptz, uuid) from public;
revoke all on function app.enqueue_face_match_fanout_continuation(uuid, uuid, text, uuid, uuid, uuid, text, text, timestamptz, timestamptz, uuid, uuid, text, integer, timestamptz, boolean) from public;
revoke all on function app.claim_face_match_fanout_continuations(text, integer, integer) from public;
revoke all on function app.complete_face_match_fanout_continuation_batch(uuid, uuid, text, timestamptz, timestamptz, uuid, uuid) from public;
revoke all on function app.fail_face_match_fanout_continuation(uuid, uuid, text, text, boolean, integer) from public;

revoke all on function public.get_photo_fanout_boundary(uuid, uuid) from public;
revoke all on function public.get_current_consent_headshot_fanout_boundary(uuid, uuid) from public;
revoke all on function public.list_uploaded_project_photos_page(uuid, uuid, integer, timestamptz, uuid, timestamptz, uuid) from public;
revoke all on function public.list_current_project_consent_headshots_page(uuid, uuid, timestamptz, boolean, boolean, integer, timestamptz, uuid, timestamptz, uuid) from public;
revoke all on function public.enqueue_face_match_fanout_continuation(uuid, uuid, text, uuid, uuid, uuid, text, text, timestamptz, timestamptz, uuid, uuid, text, integer, timestamptz, boolean) from public;
revoke all on function public.claim_face_match_fanout_continuations(text, integer, integer) from public;
revoke all on function public.complete_face_match_fanout_continuation_batch(uuid, uuid, text, timestamptz, timestamptz, uuid, uuid) from public;
revoke all on function public.fail_face_match_fanout_continuation(uuid, uuid, text, text, boolean, integer) from public;

grant execute on function public.get_photo_fanout_boundary(uuid, uuid) to service_role;
grant execute on function public.get_current_consent_headshot_fanout_boundary(uuid, uuid) to service_role;
grant execute on function public.list_uploaded_project_photos_page(uuid, uuid, integer, timestamptz, uuid, timestamptz, uuid) to service_role;
grant execute on function public.list_current_project_consent_headshots_page(uuid, uuid, timestamptz, boolean, boolean, integer, timestamptz, uuid, timestamptz, uuid) to service_role;
grant execute on function public.enqueue_face_match_fanout_continuation(uuid, uuid, text, uuid, uuid, uuid, text, text, timestamptz, timestamptz, uuid, uuid, text, integer, timestamptz, boolean) to service_role;
grant execute on function public.claim_face_match_fanout_continuations(text, integer, integer) to service_role;
grant execute on function public.complete_face_match_fanout_continuation_batch(uuid, uuid, text, timestamptz, timestamptz, uuid, uuid) to service_role;
grant execute on function public.fail_face_match_fanout_continuation(uuid, uuid, text, text, boolean, integer) to service_role;

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
    ) as is_matching_in_progress;
$$;
