alter table public.face_match_jobs
  drop constraint if exists face_match_jobs_job_type_check,
  drop constraint if exists face_match_jobs_scope_by_job_type_check;

alter table public.face_match_jobs
  add constraint face_match_jobs_job_type_check
    check (
      job_type in (
        'photo_uploaded',
        'consent_headshot_ready',
        'reconcile_project',
        'materialize_asset_faces',
        'compare_materialized_pair',
        'compare_recurring_profile_materialized_pair'
      )
    ),
  add constraint face_match_jobs_scope_by_job_type_check
    check (
      (job_type = 'photo_uploaded' and scope_asset_id is not null and scope_consent_id is null)
      or (job_type = 'consent_headshot_ready' and scope_consent_id is not null and scope_asset_id is null)
      or (job_type = 'reconcile_project' and scope_asset_id is null and scope_consent_id is null)
      or (job_type = 'materialize_asset_faces' and scope_asset_id is not null and scope_consent_id is null)
      or (job_type = 'compare_materialized_pair' and scope_asset_id is not null and scope_consent_id is not null)
      or (job_type = 'compare_recurring_profile_materialized_pair' and scope_asset_id is not null and scope_consent_id is null)
    );

alter table public.face_match_fanout_continuations
  drop constraint if exists face_match_fanout_continuations_source_asset_scope_fk,
  drop constraint if exists face_match_fanout_continuations_source_consent_scope_fk,
  drop constraint if exists face_match_fanout_continuations_source_materialization_fk,
  drop constraint if exists face_match_fanout_continuations_direction_check,
  drop constraint if exists face_match_fanout_continuations_scope_check;

alter table public.face_match_fanout_continuations
  add column if not exists source_project_profile_participant_id uuid null,
  add column if not exists source_profile_id uuid null,
  add column if not exists source_headshot_id uuid null,
  add column if not exists source_selection_face_id uuid null,
  add column if not exists boundary_project_profile_participant_id uuid null,
  add column if not exists cursor_project_profile_participant_id uuid null;

alter table public.face_match_fanout_continuations
  alter column source_asset_id drop not null;

alter table public.face_match_fanout_continuations
  add constraint face_match_fanout_continuations_source_asset_scope_fk
    foreign key (source_asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete restrict,
  add constraint face_match_fanout_continuations_source_consent_scope_fk
    foreign key (source_consent_id, tenant_id, project_id)
    references public.consents(id, tenant_id, project_id)
    on delete restrict,
  add constraint face_match_fanout_continuations_source_project_profile_participant_scope_fk
    foreign key (source_project_profile_participant_id, tenant_id)
    references public.project_profile_participants(id, tenant_id)
    on delete cascade,
  add constraint face_match_fanout_continuations_source_headshot_scope_fk
    foreign key (source_headshot_id, tenant_id)
    references public.recurring_profile_headshots(id, tenant_id)
    on delete cascade,
  add constraint face_match_fanout_continuations_source_selection_face_scope_fk
    foreign key (source_selection_face_id, tenant_id)
    references public.recurring_profile_headshot_materialization_faces(id, tenant_id)
    on delete cascade,
  add constraint face_match_fanout_continuations_direction_check
    check (
      direction in (
        'photo_to_headshots',
        'headshot_to_photos',
        'photo_to_recurring_profiles',
        'recurring_profile_to_photos'
      )
    ),
  add constraint face_match_fanout_continuations_scope_check
    check (
      (
        direction = 'photo_to_headshots'
        and source_asset_id is not null
        and source_consent_id is null
        and source_project_profile_participant_id is null
        and source_headshot_id is null
        and source_selection_face_id is null
        and boundary_asset_id is null
        and boundary_consent_id is not null
        and boundary_project_profile_participant_id is null
      )
      or (
        direction = 'headshot_to_photos'
        and source_asset_id is not null
        and source_consent_id is not null
        and source_project_profile_participant_id is null
        and source_headshot_id is null
        and source_selection_face_id is null
        and boundary_asset_id is not null
        and boundary_consent_id is null
        and boundary_project_profile_participant_id is null
      )
      or (
        direction = 'photo_to_recurring_profiles'
        and source_asset_id is not null
        and source_consent_id is null
        and source_project_profile_participant_id is null
        and source_headshot_id is null
        and source_selection_face_id is null
        and boundary_asset_id is null
        and boundary_consent_id is null
      )
      or (
        direction = 'recurring_profile_to_photos'
        and source_asset_id is null
        and source_consent_id is null
        and source_project_profile_participant_id is not null
        and source_profile_id is not null
        and source_headshot_id is not null
        and source_selection_face_id is not null
        and boundary_consent_id is null
        and boundary_project_profile_participant_id is null
      )
    );

drop index if exists face_match_fanout_continuations_photo_source_key;
drop index if exists face_match_fanout_continuations_headshot_source_key;
drop index if exists face_match_fanout_continuations_source_lookup_idx;

create unique index if not exists face_match_fanout_continuations_photo_source_key
  on public.face_match_fanout_continuations (tenant_id, project_id, direction, source_materialization_id, compare_version)
  where direction in ('photo_to_headshots', 'photo_to_recurring_profiles');

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

create unique index if not exists face_match_fanout_continuations_recurring_source_key
  on public.face_match_fanout_continuations (
    tenant_id,
    project_id,
    direction,
    source_materialization_id,
    source_project_profile_participant_id,
    source_selection_face_id,
    compare_version
  )
  where direction = 'recurring_profile_to_photos';

create index if not exists face_match_fanout_continuations_source_lookup_idx
  on public.face_match_fanout_continuations (
    tenant_id,
    project_id,
    source_asset_id,
    source_consent_id,
    source_project_profile_participant_id,
    source_headshot_id,
    source_selection_face_id,
    source_materialization_id,
    created_at desc
  );

create table if not exists public.asset_project_profile_face_compares (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  project_profile_participant_id uuid not null,
  profile_id uuid not null,
  asset_id uuid not null,
  recurring_headshot_id uuid not null,
  recurring_headshot_materialization_id uuid not null,
  recurring_selection_face_id uuid not null,
  asset_materialization_id uuid not null,
  winning_asset_face_id uuid null,
  winning_asset_face_rank integer null,
  winning_similarity numeric(6,5) not null default 0,
  compare_status text not null check (compare_status in ('matched', 'source_unusable', 'target_empty', 'no_match')),
  compare_version text not null,
  provider text not null,
  provider_mode text not null,
  provider_plugin_versions jsonb null,
  target_face_count integer not null check (target_face_count >= 0),
  compared_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint asset_project_profile_face_compares_project_scope_fk
    foreign key (project_id, tenant_id)
    references public.projects(id, tenant_id)
    on delete restrict,
  constraint asset_project_profile_face_compares_participant_scope_fk
    foreign key (project_profile_participant_id, tenant_id)
    references public.project_profile_participants(id, tenant_id)
    on delete cascade,
  constraint asset_project_profile_face_compares_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_project_profile_face_compares_headshot_scope_fk
    foreign key (recurring_headshot_id, tenant_id)
    references public.recurring_profile_headshots(id, tenant_id)
    on delete cascade,
  constraint asset_project_profile_face_compares_headshot_materialization_scope_fk
    foreign key (recurring_headshot_materialization_id, tenant_id)
    references public.recurring_profile_headshot_materializations(id, tenant_id)
    on delete cascade,
  constraint asset_project_profile_face_compares_selection_face_scope_fk
    foreign key (recurring_selection_face_id, tenant_id)
    references public.recurring_profile_headshot_materialization_faces(id, tenant_id)
    on delete cascade,
  constraint asset_project_profile_face_compares_asset_materialization_fk
    foreign key (asset_materialization_id)
    references public.asset_face_materializations(id)
    on delete cascade,
  constraint asset_project_profile_face_compares_winning_asset_face_fk
    foreign key (winning_asset_face_id)
    references public.asset_face_materialization_faces(id)
    on delete set null,
  constraint asset_project_profile_face_compares_unique_pair
    unique (
      tenant_id,
      project_id,
      project_profile_participant_id,
      asset_id,
      recurring_selection_face_id,
      asset_materialization_id,
      compare_version
    )
);

create index if not exists asset_project_profile_face_compares_project_asset_idx
  on public.asset_project_profile_face_compares (tenant_id, project_id, asset_id, compared_at desc);

create index if not exists asset_project_profile_face_compares_project_participant_idx
  on public.asset_project_profile_face_compares (
    tenant_id,
    project_id,
    project_profile_participant_id,
    recurring_selection_face_id,
    compared_at desc
  );

create table if not exists public.asset_project_profile_face_compare_scores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  project_profile_participant_id uuid not null,
  profile_id uuid not null,
  asset_id uuid not null,
  recurring_selection_face_id uuid not null,
  recurring_headshot_materialization_id uuid not null,
  asset_materialization_id uuid not null,
  asset_face_id uuid not null,
  asset_face_rank integer not null,
  similarity numeric(6,5) not null default 0,
  compare_version text not null,
  provider text not null,
  provider_mode text not null,
  provider_plugin_versions jsonb null,
  compared_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint asset_project_profile_face_compare_scores_project_scope_fk
    foreign key (project_id, tenant_id)
    references public.projects(id, tenant_id)
    on delete restrict,
  constraint asset_project_profile_face_compare_scores_participant_scope_fk
    foreign key (project_profile_participant_id, tenant_id)
    references public.project_profile_participants(id, tenant_id)
    on delete cascade,
  constraint asset_project_profile_face_compare_scores_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_project_profile_face_compare_scores_selection_face_scope_fk
    foreign key (recurring_selection_face_id, tenant_id)
    references public.recurring_profile_headshot_materialization_faces(id, tenant_id)
    on delete cascade,
  constraint asset_project_profile_face_compare_scores_headshot_materialization_scope_fk
    foreign key (recurring_headshot_materialization_id, tenant_id)
    references public.recurring_profile_headshot_materializations(id, tenant_id)
    on delete cascade,
  constraint asset_project_profile_face_compare_scores_asset_materialization_fk
    foreign key (asset_materialization_id)
    references public.asset_face_materializations(id)
    on delete cascade,
  constraint asset_project_profile_face_compare_scores_asset_face_fk
    foreign key (asset_face_id)
    references public.asset_face_materialization_faces(id)
    on delete cascade,
  constraint asset_project_profile_face_compare_scores_unique_pair
    unique (
      tenant_id,
      project_id,
      project_profile_participant_id,
      asset_id,
      recurring_selection_face_id,
      asset_materialization_id,
      asset_face_id,
      compare_version
    )
);

create index if not exists asset_project_profile_face_compare_scores_project_asset_idx
  on public.asset_project_profile_face_compare_scores (tenant_id, project_id, asset_id, compared_at desc);

create index if not exists asset_project_profile_face_compare_scores_project_participant_idx
  on public.asset_project_profile_face_compare_scores (
    tenant_id,
    project_id,
    project_profile_participant_id,
    recurring_selection_face_id,
    compared_at desc
  );

alter table public.asset_project_profile_face_compares enable row level security;
alter table public.asset_project_profile_face_compare_scores enable row level security;

revoke all on table public.asset_project_profile_face_compares from public;
revoke all on table public.asset_project_profile_face_compares from anon;
revoke all on table public.asset_project_profile_face_compares from authenticated;
revoke all on table public.asset_project_profile_face_compare_scores from public;
revoke all on table public.asset_project_profile_face_compare_scores from anon;
revoke all on table public.asset_project_profile_face_compare_scores from authenticated;

grant select, insert, update, delete on table public.asset_project_profile_face_compares to service_role;
grant select, insert, update, delete on table public.asset_project_profile_face_compare_scores to service_role;

drop function if exists app.enqueue_face_match_fanout_continuation(uuid, uuid, text, uuid, uuid, uuid, text, text, timestamptz, timestamptz, uuid, uuid, text, integer, timestamptz, boolean);
drop function if exists public.enqueue_face_match_fanout_continuation(uuid, uuid, text, uuid, uuid, uuid, text, text, timestamptz, timestamptz, uuid, uuid, text, integer, timestamptz, boolean);
drop function if exists app.claim_face_match_fanout_continuations(text, integer, integer);
drop function if exists public.claim_face_match_fanout_continuations(text, integer, integer);
drop function if exists app.complete_face_match_fanout_continuation_batch(uuid, uuid, text, timestamptz, timestamptz, uuid, uuid);
drop function if exists public.complete_face_match_fanout_continuation_batch(uuid, uuid, text, timestamptz, timestamptz, uuid, uuid);

create or replace function app.enqueue_face_match_fanout_continuation(
  p_tenant_id uuid,
  p_project_id uuid,
  p_direction text,
  p_source_asset_id uuid default null,
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
  p_reset_terminal boolean default false,
  p_source_project_profile_participant_id uuid default null,
  p_source_profile_id uuid default null,
  p_source_headshot_id uuid default null,
  p_source_selection_face_id uuid default null,
  p_boundary_project_profile_participant_id uuid default null
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
     or p_source_materialization_id is null
     or nullif(trim(coalesce(p_direction, '')), '') is null
     or nullif(trim(coalesce(p_source_materializer_version, '')), '') is null
     or nullif(trim(coalesce(p_compare_version, '')), '') is null
     or p_boundary_snapshot_at is null then
    raise exception 'face_match_fanout_missing_required_fields' using errcode = '23514';
  end if;

  if p_direction in ('photo_to_headshots', 'photo_to_recurring_profiles') and p_source_asset_id is null then
    raise exception 'face_match_fanout_missing_photo_scope' using errcode = '23514';
  end if;

  if p_direction = 'headshot_to_photos' and (p_source_asset_id is null or p_source_consent_id is null) then
    raise exception 'face_match_fanout_missing_consent_scope' using errcode = '23514';
  end if;

  if p_direction = 'recurring_profile_to_photos' and (
    p_source_project_profile_participant_id is null
    or p_source_profile_id is null
    or p_source_headshot_id is null
    or p_source_selection_face_id is null
  ) then
    raise exception 'face_match_fanout_missing_recurring_scope' using errcode = '23514';
  end if;

  select *
  into v_existing
  from public.face_match_fanout_continuations c
  where c.tenant_id = p_tenant_id
    and c.project_id = p_project_id
    and c.direction = p_direction
    and c.source_materialization_id = p_source_materialization_id
    and c.compare_version = p_compare_version
    and (
      (
        p_direction in ('photo_to_headshots', 'photo_to_recurring_profiles')
        and c.source_consent_id is null
        and c.source_project_profile_participant_id is null
      )
      or (
        p_direction = 'headshot_to_photos'
        and c.source_consent_id is not distinct from p_source_consent_id
      )
      or (
        p_direction = 'recurring_profile_to_photos'
        and c.source_project_profile_participant_id is not distinct from p_source_project_profile_participant_id
        and c.source_selection_face_id is not distinct from p_source_selection_face_id
      )
    )
  for update;

  if not found then
    return query
    insert into public.face_match_fanout_continuations as c (
      tenant_id,
      project_id,
      direction,
      source_asset_id,
      source_consent_id,
      source_project_profile_participant_id,
      source_profile_id,
      source_headshot_id,
      source_selection_face_id,
      source_materialization_id,
      source_materializer_version,
      compare_version,
      boundary_snapshot_at,
      boundary_sort_at,
      boundary_asset_id,
      boundary_consent_id,
      boundary_project_profile_participant_id,
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
      p_source_project_profile_participant_id,
      p_source_profile_id,
      p_source_headshot_id,
      p_source_selection_face_id,
      p_source_materialization_id,
      p_source_materializer_version,
      p_compare_version,
      p_boundary_snapshot_at,
      p_boundary_sort_at,
      p_boundary_asset_id,
      p_boundary_consent_id,
      p_boundary_project_profile_participant_id,
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
       or v_existing.status in ('completed', 'superseded')
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
    source_project_profile_participant_id = p_source_project_profile_participant_id,
    source_profile_id = p_source_profile_id,
    source_headshot_id = p_source_headshot_id,
    source_selection_face_id = p_source_selection_face_id,
    source_materialization_id = p_source_materialization_id,
    source_materializer_version = p_source_materializer_version,
    compare_version = p_compare_version,
    boundary_snapshot_at = p_boundary_snapshot_at,
    boundary_sort_at = p_boundary_sort_at,
    boundary_asset_id = p_boundary_asset_id,
    boundary_consent_id = p_boundary_consent_id,
    boundary_project_profile_participant_id = p_boundary_project_profile_participant_id,
    cursor_sort_at = null,
    cursor_asset_id = null,
    cursor_consent_id = null,
    cursor_project_profile_participant_id = null,
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
  p_source_asset_id uuid default null,
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
  p_reset_terminal boolean default false,
  p_source_project_profile_participant_id uuid default null,
  p_source_profile_id uuid default null,
  p_source_headshot_id uuid default null,
  p_source_selection_face_id uuid default null,
  p_boundary_project_profile_participant_id uuid default null
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
    p_reset_terminal,
    p_source_project_profile_participant_id,
    p_source_profile_id,
    p_source_headshot_id,
    p_source_selection_face_id,
    p_boundary_project_profile_participant_id
  );
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
  source_project_profile_participant_id uuid,
  source_profile_id uuid,
  source_headshot_id uuid,
  source_selection_face_id uuid,
  source_materialization_id uuid,
  source_materializer_version text,
  compare_version text,
  boundary_snapshot_at timestamptz,
  boundary_sort_at timestamptz,
  boundary_asset_id uuid,
  boundary_consent_id uuid,
  boundary_project_profile_participant_id uuid,
  cursor_sort_at timestamptz,
  cursor_asset_id uuid,
  cursor_consent_id uuid,
  cursor_project_profile_participant_id uuid,
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
    u.source_project_profile_participant_id,
    u.source_profile_id,
    u.source_headshot_id,
    u.source_selection_face_id,
    u.source_materialization_id,
    u.source_materializer_version,
    u.compare_version,
    u.boundary_snapshot_at,
    u.boundary_sort_at,
    u.boundary_asset_id,
    u.boundary_consent_id,
    u.boundary_project_profile_participant_id,
    u.cursor_sort_at,
    u.cursor_asset_id,
    u.cursor_consent_id,
    u.cursor_project_profile_participant_id,
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
  source_project_profile_participant_id uuid,
  source_profile_id uuid,
  source_headshot_id uuid,
  source_selection_face_id uuid,
  source_materialization_id uuid,
  source_materializer_version text,
  compare_version text,
  boundary_snapshot_at timestamptz,
  boundary_sort_at timestamptz,
  boundary_asset_id uuid,
  boundary_consent_id uuid,
  boundary_project_profile_participant_id uuid,
  cursor_sort_at timestamptz,
  cursor_asset_id uuid,
  cursor_consent_id uuid,
  cursor_project_profile_participant_id uuid,
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

create or replace function app.complete_face_match_fanout_continuation_batch(
  p_continuation_id uuid,
  p_lock_token uuid,
  p_next_status text,
  p_run_after timestamptz default null,
  p_cursor_sort_at timestamptz default null,
  p_cursor_asset_id uuid default null,
  p_cursor_consent_id uuid default null,
  p_cursor_project_profile_participant_id uuid default null
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
    cursor_project_profile_participant_id = p_cursor_project_profile_participant_id,
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

create or replace function public.complete_face_match_fanout_continuation_batch(
  p_continuation_id uuid,
  p_lock_token uuid,
  p_next_status text,
  p_run_after timestamptz default null,
  p_cursor_sort_at timestamptz default null,
  p_cursor_asset_id uuid default null,
  p_cursor_consent_id uuid default null,
  p_cursor_project_profile_participant_id uuid default null
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
    p_cursor_consent_id,
    p_cursor_project_profile_participant_id
  );
$$;

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
        and j.job_type in (
          'photo_uploaded',
          'consent_headshot_ready',
          'reconcile_project',
          'materialize_asset_faces',
          'compare_materialized_pair',
          'compare_recurring_profile_materialized_pair'
        )
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
  degraded_jobs as (
    select exists(
      select 1
      from public.face_match_jobs j
      where j.tenant_id = p_tenant_id
        and j.project_id = p_project_id
        and j.job_type in (
          'photo_uploaded',
          'consent_headshot_ready',
          'reconcile_project',
          'materialize_asset_faces',
          'compare_materialized_pair',
          'compare_recurring_profile_materialized_pair'
        )
        and (
          j.status = 'dead'
          or (
            j.status = 'queued'
            and j.attempt_count > 0
            and j.last_error_at is not null
          )
          or (
            j.status = 'processing'
            and j.attempt_count > 0
            and j.last_error_at is not null
            and coalesce(j.lease_expires_at, j.locked_at, j.updated_at, j.created_at) > now()
          )
        )
    ) as is_degraded
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
    (
      coalesce((select is_degraded from degraded_jobs), false)
      or coalesce((select is_degraded from degraded_continuations), false)
    ) as has_degraded_matching_state;
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

grant execute on function public.enqueue_face_match_fanout_continuation(
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  timestamptz,
  uuid,
  uuid,
  text,
  integer,
  timestamptz,
  boolean,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) to service_role;

grant execute on function public.claim_face_match_fanout_continuations(text, integer, integer) to service_role;

grant execute on function public.complete_face_match_fanout_continuation_batch(
  uuid,
  uuid,
  text,
  timestamptz,
  timestamptz,
  uuid,
  uuid,
  uuid
) to service_role;
