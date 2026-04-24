create table if not exists public.project_workspaces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null,
  workspace_kind text not null,
  photographer_user_id uuid null references auth.users(id) on delete restrict,
  name text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint project_workspaces_project_scope_fk
    foreign key (project_id, tenant_id)
    references public.projects(id, tenant_id)
    on delete cascade,
  constraint project_workspaces_kind_check
    check (workspace_kind in ('photographer', 'default')),
  constraint project_workspaces_kind_shape_check
    check (
      (workspace_kind = 'default' and photographer_user_id is null)
      or (workspace_kind = 'photographer' and photographer_user_id is not null)
    ),
  constraint project_workspaces_id_tenant_project_unique
    unique (id, tenant_id, project_id)
);

create unique index if not exists project_workspaces_default_unique_idx
  on public.project_workspaces (tenant_id, project_id)
  where workspace_kind = 'default';

create unique index if not exists project_workspaces_photographer_unique_idx
  on public.project_workspaces (tenant_id, project_id, photographer_user_id)
  where photographer_user_id is not null;

create index if not exists project_workspaces_project_created_at_idx
  on public.project_workspaces (tenant_id, project_id, created_at desc);

create index if not exists project_workspaces_photographer_created_at_idx
  on public.project_workspaces (tenant_id, photographer_user_id, created_at desc)
  where photographer_user_id is not null;

create or replace function app.default_project_workspace_id(
  p_tenant_id uuid,
  p_project_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select pw.id
  from public.project_workspaces pw
  where pw.tenant_id = p_tenant_id
    and pw.project_id = p_project_id
    and pw.workspace_kind = 'default'
  limit 1;
$$;

create or replace function app.ensure_default_project_workspace()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  insert into public.project_workspaces (
    tenant_id,
    project_id,
    workspace_kind,
    photographer_user_id,
    name,
    created_by
  )
  values (
    new.tenant_id,
    new.id,
    'default',
    null,
    'Default workspace',
    new.created_by
  )
  on conflict (tenant_id, project_id) where workspace_kind = 'default' do nothing;

  return new;
end;
$$;

create or replace function app.populate_project_workspace_id()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.project_id is null then
    return new;
  end if;

  if new.workspace_id is null then
    new.workspace_id := app.default_project_workspace_id(new.tenant_id, new.project_id);
  end if;

  if new.workspace_id is null then
    raise exception 'project_workspace_required' using errcode = '23514';
  end if;

  return new;
end;
$$;

insert into public.project_workspaces (
  tenant_id,
  project_id,
  workspace_kind,
  photographer_user_id,
  name,
  created_by
)
select
  p.tenant_id,
  p.id,
  'default',
  null,
  'Default workspace',
  p.created_by
from public.projects p
on conflict (tenant_id, project_id) where workspace_kind = 'default' do nothing;

drop trigger if exists projects_ensure_default_workspace on public.projects;
create trigger projects_ensure_default_workspace
after insert on public.projects
for each row
execute function app.ensure_default_project_workspace();

alter table public.subject_invites add column if not exists workspace_id uuid;
alter table public.subjects add column if not exists workspace_id uuid;
alter table public.consents add column if not exists workspace_id uuid;
alter table public.assets add column if not exists workspace_id uuid;
alter table public.asset_consent_links add column if not exists workspace_id uuid;
alter table public.face_match_jobs add column if not exists workspace_id uuid;
alter table public.face_match_fanout_continuations add column if not exists workspace_id uuid;
alter table public.asset_consent_match_candidates add column if not exists workspace_id uuid;
alter table public.asset_consent_match_results add column if not exists workspace_id uuid;
alter table public.asset_face_materializations add column if not exists workspace_id uuid;
alter table public.asset_face_materialization_faces add column if not exists workspace_id uuid;
alter table public.asset_consent_face_compares add column if not exists workspace_id uuid;
alter table public.asset_consent_face_compare_scores add column if not exists workspace_id uuid;
alter table public.asset_face_image_derivatives add column if not exists workspace_id uuid;
alter table public.asset_face_consent_links add column if not exists workspace_id uuid;
alter table public.asset_face_consent_link_suppressions add column if not exists workspace_id uuid;
alter table public.asset_face_assignee_link_suppressions add column if not exists workspace_id uuid;
alter table public.asset_consent_manual_photo_fallbacks add column if not exists workspace_id uuid;
alter table public.asset_consent_manual_photo_fallback_suppressions add column if not exists workspace_id uuid;
alter table public.asset_consent_legacy_photo_links add column if not exists workspace_id uuid;
alter table public.asset_consent_legacy_photo_link_suppressions add column if not exists workspace_id uuid;
alter table public.asset_face_hidden_states add column if not exists workspace_id uuid;
alter table public.asset_face_block_states add column if not exists workspace_id uuid;
alter table public.project_profile_participants add column if not exists workspace_id uuid;
alter table public.recurring_profile_consent_requests add column if not exists workspace_id uuid;
alter table public.recurring_profile_consents add column if not exists workspace_id uuid;
alter table public.asset_project_profile_face_compares add column if not exists workspace_id uuid;
alter table public.asset_project_profile_face_compare_scores add column if not exists workspace_id uuid;
alter table public.face_review_sessions add column if not exists workspace_id uuid;
alter table public.face_review_session_items add column if not exists workspace_id uuid;
alter table public.project_face_assignees add column if not exists workspace_id uuid;
alter table public.asset_assignee_links add column if not exists workspace_id uuid;
alter table public.project_consent_scope_signed_projections add column if not exists workspace_id uuid;
alter table public.project_consent_upgrade_requests add column if not exists workspace_id uuid;

update public.subject_invites
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.subjects
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.consents
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.assets
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.asset_consent_links
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.face_match_jobs
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.face_match_fanout_continuations
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.asset_consent_match_candidates
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.asset_consent_match_results
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.asset_face_materializations
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.asset_face_materialization_faces
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.asset_consent_face_compares
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.asset_consent_face_compare_scores
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.asset_face_image_derivatives
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.asset_face_consent_links
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.asset_face_consent_link_suppressions
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.asset_face_assignee_link_suppressions suppressions
set workspace_id = assets.workspace_id
from public.assets assets
where assets.id = suppressions.asset_id
  and assets.tenant_id = suppressions.tenant_id
  and assets.project_id = suppressions.project_id
  and suppressions.workspace_id is null;

update public.asset_consent_manual_photo_fallbacks
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.asset_consent_manual_photo_fallback_suppressions
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.asset_consent_legacy_photo_links
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.asset_consent_legacy_photo_link_suppressions
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.asset_face_hidden_states
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.asset_face_block_states
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.project_profile_participants
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.recurring_profile_consent_requests
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where project_id is not null
  and workspace_id is null;

update public.recurring_profile_consents
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where project_id is not null
  and workspace_id is null;

update public.asset_project_profile_face_compares
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.asset_project_profile_face_compare_scores
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.face_review_sessions
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.face_review_session_items
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.project_face_assignees
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.asset_assignee_links
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.project_consent_scope_signed_projections
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

update public.project_consent_upgrade_requests
set workspace_id = app.default_project_workspace_id(tenant_id, project_id)
where workspace_id is null;

drop trigger if exists subject_invites_populate_workspace_id on public.subject_invites;
create trigger subject_invites_populate_workspace_id
before insert or update on public.subject_invites
for each row
execute function app.populate_project_workspace_id();

drop trigger if exists subjects_populate_workspace_id on public.subjects;
create trigger subjects_populate_workspace_id
before insert or update on public.subjects
for each row
execute function app.populate_project_workspace_id();

drop trigger if exists consents_populate_workspace_id on public.consents;
create trigger consents_populate_workspace_id
before insert or update on public.consents
for each row
execute function app.populate_project_workspace_id();

drop trigger if exists assets_populate_workspace_id on public.assets;
create trigger assets_populate_workspace_id
before insert or update on public.assets
for each row
execute function app.populate_project_workspace_id();

drop trigger if exists asset_consent_links_populate_workspace_id on public.asset_consent_links;
create trigger asset_consent_links_populate_workspace_id
before insert or update on public.asset_consent_links
for each row
execute function app.populate_project_workspace_id();

drop trigger if exists face_match_jobs_populate_workspace_id on public.face_match_jobs;
create trigger face_match_jobs_populate_workspace_id
before insert or update on public.face_match_jobs
for each row
execute function app.populate_project_workspace_id();

drop trigger if exists face_match_fanout_continuations_populate_workspace_id on public.face_match_fanout_continuations;
create trigger face_match_fanout_continuations_populate_workspace_id
before insert or update on public.face_match_fanout_continuations
for each row
execute function app.populate_project_workspace_id();

drop trigger if exists asset_consent_match_candidates_populate_workspace_id on public.asset_consent_match_candidates;
create trigger asset_consent_match_candidates_populate_workspace_id
before insert or update on public.asset_consent_match_candidates
for each row
execute function app.populate_project_workspace_id();

drop trigger if exists asset_consent_match_results_populate_workspace_id on public.asset_consent_match_results;
create trigger asset_consent_match_results_populate_workspace_id
before insert or update on public.asset_consent_match_results
for each row
execute function app.populate_project_workspace_id();

drop trigger if exists asset_face_materializations_populate_workspace_id on public.asset_face_materializations;
create trigger asset_face_materializations_populate_workspace_id
before insert or update on public.asset_face_materializations
for each row
execute function app.populate_project_workspace_id();

drop trigger if exists asset_face_materialization_faces_populate_workspace_id on public.asset_face_materialization_faces;
create trigger asset_face_materialization_faces_populate_workspace_id
before insert or update on public.asset_face_materialization_faces
for each row
execute function app.populate_project_workspace_id();

drop trigger if exists asset_consent_face_compares_populate_workspace_id on public.asset_consent_face_compares;
create trigger asset_consent_face_compares_populate_workspace_id
before insert or update on public.asset_consent_face_compares
for each row
execute function app.populate_project_workspace_id();

drop trigger if exists asset_consent_face_compare_scores_populate_workspace_id on public.asset_consent_face_compare_scores;
create trigger asset_consent_face_compare_scores_populate_workspace_id
before insert or update on public.asset_consent_face_compare_scores
for each row
execute function app.populate_project_workspace_id();

drop trigger if exists asset_face_image_derivatives_populate_workspace_id on public.asset_face_image_derivatives;
create trigger asset_face_image_derivatives_populate_workspace_id
before insert or update on public.asset_face_image_derivatives
for each row
execute function app.populate_project_workspace_id();

drop trigger if exists asset_face_consent_links_populate_workspace_id on public.asset_face_consent_links;
create trigger asset_face_consent_links_populate_workspace_id
before insert or update on public.asset_face_consent_links
for each row
execute function app.populate_project_workspace_id();

drop trigger if exists asset_face_consent_link_suppressions_populate_workspace_id on public.asset_face_consent_link_suppressions;
create trigger asset_face_consent_link_suppressions_populate_workspace_id
before insert or update on public.asset_face_consent_link_suppressions
for each row
execute function app.populate_project_workspace_id();

drop trigger if exists asset_consent_manual_photo_fallbacks_populate_workspace_id on public.asset_consent_manual_photo_fallbacks;
create trigger asset_consent_manual_photo_fallbacks_populate_workspace_id
before insert or update on public.asset_consent_manual_photo_fallbacks
for each row
execute function app.populate_project_workspace_id();

drop trigger if exists asset_consent_manual_photo_fallback_suppressions_populate_workspace_id on public.asset_consent_manual_photo_fallback_suppressions;
create trigger asset_consent_manual_photo_fallback_suppressions_populate_workspace_id
before insert or update on public.asset_consent_manual_photo_fallback_suppressions
for each row
execute function app.populate_project_workspace_id();

do $$
declare
  v_table text;
  v_trigger_name text;
begin
  foreach v_table in array array[
    'asset_consent_legacy_photo_links',
    'asset_consent_legacy_photo_link_suppressions',
    'asset_face_hidden_states',
    'asset_face_block_states',
    'asset_face_assignee_link_suppressions',
    'project_profile_participants',
    'recurring_profile_consent_requests',
    'recurring_profile_consents',
    'asset_project_profile_face_compares',
    'asset_project_profile_face_compare_scores',
    'face_review_sessions',
    'face_review_session_items',
    'project_face_assignees',
    'asset_assignee_links',
    'project_consent_scope_signed_projections',
    'project_consent_upgrade_requests'
  ] loop
    v_trigger_name := left(v_table || '_populate_workspace_id', 63);
    execute format('drop trigger if exists %I on public.%I;', v_trigger_name, v_table);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function app.populate_project_workspace_id();',
      v_trigger_name,
      v_table
    );
  end loop;
end;
$$;

do $$
declare
  v_table text;
  v_constraint_name text;
begin
  foreach v_table in array array[
    'subject_invites',
    'subjects',
    'consents',
    'assets',
    'asset_consent_links',
    'face_match_jobs',
    'face_match_fanout_continuations',
    'asset_consent_match_candidates',
    'asset_consent_match_results',
    'asset_face_materializations',
    'asset_face_materialization_faces',
    'asset_consent_face_compares',
    'asset_consent_face_compare_scores',
    'asset_face_image_derivatives',
    'asset_face_consent_links',
    'asset_face_consent_link_suppressions',
    'asset_face_assignee_link_suppressions',
    'asset_consent_manual_photo_fallbacks',
    'asset_consent_manual_photo_fallback_suppressions',
    'asset_consent_legacy_photo_links',
    'asset_consent_legacy_photo_link_suppressions',
    'asset_face_hidden_states',
    'asset_face_block_states',
    'project_profile_participants',
    'recurring_profile_consent_requests',
    'recurring_profile_consents',
    'asset_project_profile_face_compares',
    'asset_project_profile_face_compare_scores',
    'face_review_sessions',
    'face_review_session_items',
    'project_face_assignees',
    'asset_assignee_links',
    'project_consent_scope_signed_projections',
    'project_consent_upgrade_requests'
  ] loop
    v_constraint_name := left(v_table || '_workspace_scope_fk', 63);
    if not exists (
      select 1
      from pg_constraint
      where conname = v_constraint_name
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (workspace_id, tenant_id, project_id) references public.project_workspaces(id, tenant_id, project_id) on delete restrict;',
        v_table,
        v_constraint_name
      );
    end if;
  end loop;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'subject_invites',
    'subjects',
    'consents',
    'assets',
    'asset_consent_links',
    'face_match_jobs',
    'face_match_fanout_continuations',
    'asset_consent_match_candidates',
    'asset_consent_match_results',
    'asset_face_materializations',
    'asset_face_materialization_faces',
    'asset_consent_face_compares',
    'asset_consent_face_compare_scores',
    'asset_face_image_derivatives',
    'asset_face_consent_links',
    'asset_face_consent_link_suppressions',
    'asset_face_assignee_link_suppressions',
    'asset_consent_manual_photo_fallbacks',
    'asset_consent_manual_photo_fallback_suppressions',
    'asset_consent_legacy_photo_links',
    'asset_consent_legacy_photo_link_suppressions',
    'asset_face_hidden_states',
    'asset_face_block_states',
    'project_profile_participants',
    'asset_project_profile_face_compares',
    'asset_project_profile_face_compare_scores',
    'face_review_sessions',
    'face_review_session_items',
    'project_face_assignees',
    'asset_assignee_links',
    'project_consent_scope_signed_projections',
    'project_consent_upgrade_requests'
  ] loop
    execute format(
      'alter table public.%I alter column workspace_id set not null;',
      v_table
    );
  end loop;
end;
$$;

alter table public.recurring_profile_consent_requests
  drop constraint if exists recurring_profile_consent_requests_project_context_check;

alter table public.recurring_profile_consents
  drop constraint if exists recurring_profile_consents_project_context_check;

alter table public.recurring_profile_consent_requests
  add constraint recurring_profile_consent_requests_project_context_check
    check (
      (consent_kind = 'baseline' and project_id is null and workspace_id is null)
      or (consent_kind = 'project' and project_id is not null and workspace_id is not null)
    );

alter table public.recurring_profile_consents
  add constraint recurring_profile_consents_project_context_check
    check (
      (consent_kind = 'baseline' and project_id is null and workspace_id is null)
      or (consent_kind = 'project' and project_id is not null and workspace_id is not null)
    );

alter table public.subjects
  drop constraint if exists subjects_tenant_id_project_id_email_key;

alter table public.subjects
  add constraint subjects_tenant_id_project_id_email_key
    unique (tenant_id, project_id, workspace_id, email);

alter table public.assets
  drop constraint if exists assets_tenant_id_project_id_storage_path_key;

alter table public.assets
  add constraint assets_tenant_id_project_id_storage_path_key
    unique (tenant_id, project_id, workspace_id, storage_path);

alter table public.face_match_jobs
  drop constraint if exists face_match_jobs_tenant_project_dedupe_key_key;

alter table public.face_match_jobs
  add constraint face_match_jobs_tenant_project_dedupe_key_key
    unique (tenant_id, project_id, workspace_id, dedupe_key);

drop index if exists public.project_profile_participants_unique_active_idx;
create unique index if not exists project_profile_participants_unique_active_idx
  on public.project_profile_participants (tenant_id, project_id, workspace_id, recurring_profile_id);

drop index if exists public.project_face_assignees_project_consent_unique_idx;
create unique index if not exists project_face_assignees_project_consent_unique_idx
  on public.project_face_assignees (tenant_id, project_id, workspace_id, consent_id);

drop index if exists public.project_face_assignees_project_recurring_consent_unique_idx;
create unique index if not exists project_face_assignees_project_recurring_consent_unique_idx
  on public.project_face_assignees (tenant_id, project_id, workspace_id, recurring_profile_consent_id);

drop index if exists public.recurring_profile_consent_requests_active_pending_project_unique_idx;
create unique index if not exists recurring_profile_consent_requests_active_pending_project_unique_idx
  on public.recurring_profile_consent_requests (tenant_id, profile_id, project_id, workspace_id, consent_kind)
  where consent_kind = 'project' and status = 'pending';

drop index if exists public.recurring_profile_consents_active_signed_project_unique_idx;
create unique index if not exists recurring_profile_consents_active_signed_project_unique_idx
  on public.recurring_profile_consents (tenant_id, profile_id, project_id, workspace_id, consent_kind)
  where consent_kind = 'project' and revoked_at is null and superseded_at is null;

create index if not exists subject_invites_tenant_project_workspace_created_at_idx
  on public.subject_invites (tenant_id, project_id, workspace_id, created_at desc);

create index if not exists subjects_tenant_project_workspace_idx
  on public.subjects (tenant_id, project_id, workspace_id);

create index if not exists consents_tenant_project_workspace_signed_at_idx
  on public.consents (tenant_id, project_id, workspace_id, signed_at desc);

create index if not exists assets_tenant_project_workspace_created_at_idx
  on public.assets (tenant_id, project_id, workspace_id, created_at desc);

create index if not exists asset_consent_links_tenant_project_workspace_idx
  on public.asset_consent_links (tenant_id, project_id, workspace_id);

create index if not exists face_match_jobs_tenant_project_workspace_status_idx
  on public.face_match_jobs (tenant_id, project_id, workspace_id, status);

create index if not exists project_profile_participants_project_workspace_created_at_idx
  on public.project_profile_participants (tenant_id, project_id, workspace_id, created_at desc);

create index if not exists recurring_profile_consent_requests_project_workspace_created_at_idx
  on public.recurring_profile_consent_requests (tenant_id, project_id, workspace_id, profile_id, created_at desc)
  where consent_kind = 'project';

create index if not exists recurring_profile_consents_project_workspace_signed_at_idx
  on public.recurring_profile_consents (tenant_id, project_id, workspace_id, profile_id, signed_at desc)
  where consent_kind = 'project';
