create table if not exists public.capabilities (
  key text primary key,
  created_at timestamptz not null default now(),
  constraint capabilities_key_not_blank_check
    check (btrim(key) <> '')
);

create table if not exists public.role_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid null references public.tenants(id) on delete cascade,
  slug text not null,
  name text not null,
  description text null,
  is_system boolean not null default false,
  system_role_key text null,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete restrict,
  archived_at timestamptz null,
  archived_by uuid null references auth.users(id) on delete restrict,
  constraint role_definitions_slug_not_blank_check
    check (btrim(slug) <> ''),
  constraint role_definitions_name_not_blank_check
    check (btrim(name) <> ''),
  constraint role_definitions_system_role_key_check
    check (
      system_role_key is null
      or system_role_key in ('owner', 'admin', 'reviewer', 'photographer')
    ),
  constraint role_definitions_shape_check
    check (
      (
        is_system = true
        and tenant_id is null
        and system_role_key is not null
        and created_by is null
        and updated_by is null
        and archived_at is null
        and archived_by is null
      )
      or (
        is_system = false
        and tenant_id is not null
        and system_role_key is null
        and created_by is not null
        and updated_by is not null
      )
    ),
  constraint role_definitions_archive_shape_check
    check (
      (archived_at is null and archived_by is null)
      or (archived_at is not null and archived_by is not null)
    )
);

create unique index if not exists role_definitions_system_role_key_unique_idx
  on public.role_definitions (system_role_key)
  where is_system;

create unique index if not exists role_definitions_system_slug_active_unique_idx
  on public.role_definitions (lower(btrim(slug)))
  where is_system and archived_at is null;

create unique index if not exists role_definitions_system_name_active_unique_idx
  on public.role_definitions (lower(btrim(name)))
  where is_system and archived_at is null;

create unique index if not exists role_definitions_tenant_slug_active_unique_idx
  on public.role_definitions (tenant_id, lower(btrim(slug)))
  where not is_system and archived_at is null;

create unique index if not exists role_definitions_tenant_name_active_unique_idx
  on public.role_definitions (tenant_id, lower(btrim(name)))
  where not is_system and archived_at is null;

create index if not exists role_definitions_tenant_active_idx
  on public.role_definitions (tenant_id, archived_at, created_at desc)
  where not is_system;

create index if not exists role_definitions_system_idx
  on public.role_definitions (system_role_key)
  where is_system;

create table if not exists public.role_definition_capabilities (
  role_definition_id uuid not null references public.role_definitions(id) on delete cascade,
  capability_key text not null references public.capabilities(key) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (role_definition_id, capability_key)
);

create index if not exists role_definition_capabilities_capability_idx
  on public.role_definition_capabilities (capability_key);

create table if not exists public.role_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  role_definition_id uuid not null references public.role_definitions(id) on delete restrict,
  scope_type text not null check (scope_type in ('tenant', 'project', 'workspace')),
  project_id uuid null,
  workspace_id uuid null,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete restrict,
  revoked_at timestamptz null,
  revoked_by uuid null references auth.users(id) on delete restrict,
  constraint role_assignments_membership_fk
    foreign key (tenant_id, user_id)
    references public.memberships(tenant_id, user_id)
    on delete cascade,
  constraint role_assignments_project_scope_fk
    foreign key (project_id, tenant_id)
    references public.projects(id, tenant_id)
    on delete cascade,
  constraint role_assignments_workspace_scope_fk
    foreign key (workspace_id, tenant_id, project_id)
    references public.project_workspaces(id, tenant_id, project_id)
    on delete cascade,
  constraint role_assignments_scope_shape_check
    check (
      (scope_type = 'tenant' and project_id is null and workspace_id is null)
      or (scope_type = 'project' and project_id is not null and workspace_id is null)
      or (scope_type = 'workspace' and project_id is not null and workspace_id is not null)
    ),
  constraint role_assignments_revoke_shape_check
    check (
      (revoked_at is null and revoked_by is null)
      or (revoked_at is not null and revoked_by is not null)
    )
);

create unique index if not exists role_assignments_active_tenant_unique_idx
  on public.role_assignments (tenant_id, user_id, role_definition_id)
  where scope_type = 'tenant' and revoked_at is null;

create unique index if not exists role_assignments_active_project_unique_idx
  on public.role_assignments (tenant_id, user_id, role_definition_id, project_id)
  where scope_type = 'project' and revoked_at is null;

create unique index if not exists role_assignments_active_workspace_unique_idx
  on public.role_assignments (tenant_id, user_id, role_definition_id, project_id, workspace_id)
  where scope_type = 'workspace' and revoked_at is null;

create index if not exists role_assignments_tenant_user_active_idx
  on public.role_assignments (tenant_id, user_id, revoked_at, created_at desc);

create index if not exists role_assignments_project_active_idx
  on public.role_assignments (tenant_id, project_id, revoked_at, created_at desc)
  where project_id is not null;

create index if not exists role_assignments_workspace_active_idx
  on public.role_assignments (tenant_id, project_id, workspace_id, revoked_at, created_at desc)
  where workspace_id is not null;

create index if not exists role_assignments_role_definition_idx
  on public.role_assignments (role_definition_id);

comment on table public.role_assignments is
  'Durable scoped role assignment foundation. Feature 081 does not use these rows for live access; memberships.role remains authoritative.';

create or replace function app.assert_role_assignment_role_definition_scope()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role public.role_definitions%rowtype;
begin
  select *
  into v_role
  from public.role_definitions
  where id = new.role_definition_id;

  if not found then
    raise exception 'role_definition_not_found' using errcode = '23503';
  end if;

  -- Prevent a scoped assignment from pointing at another tenant's custom role.
  if v_role.is_system then
    if v_role.tenant_id is not null then
      raise exception 'invalid_system_role_definition_scope' using errcode = '23514';
    end if;
  else
    if v_role.tenant_id is distinct from new.tenant_id then
      raise exception 'role_definition_tenant_mismatch' using errcode = '23514';
    end if;

    if new.revoked_at is null and v_role.archived_at is not null then
      raise exception 'role_definition_archived' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists role_assignments_role_definition_scope_trigger on public.role_assignments;
create trigger role_assignments_role_definition_scope_trigger
before insert or update on public.role_assignments
for each row
execute function app.assert_role_assignment_role_definition_scope();

alter table public.capabilities enable row level security;
alter table public.role_definitions enable row level security;
alter table public.role_definition_capabilities enable row level security;
alter table public.role_assignments enable row level security;

grant select on table public.capabilities to authenticated;
grant select on table public.role_definitions to authenticated;
grant select on table public.role_definition_capabilities to authenticated;
grant select on table public.role_assignments to authenticated;

drop policy if exists "capabilities_select_authenticated" on public.capabilities;
create policy "capabilities_select_authenticated"
on public.capabilities
for select
to authenticated
using (true);

drop policy if exists "role_definitions_select_system" on public.role_definitions;
create policy "role_definitions_select_system"
on public.role_definitions
for select
to authenticated
using (is_system);

drop policy if exists "role_definitions_select_tenant_managers" on public.role_definitions;
create policy "role_definitions_select_tenant_managers"
on public.role_definitions
for select
to authenticated
using (
  tenant_id is not null
  and app.current_user_can_manage_members(tenant_id)
);

drop policy if exists "role_definition_capabilities_select_system" on public.role_definition_capabilities;
create policy "role_definition_capabilities_select_system"
on public.role_definition_capabilities
for select
to authenticated
using (
  exists (
    select 1
    from public.role_definitions rd
    where rd.id = role_definition_capabilities.role_definition_id
      and rd.is_system
  )
);

drop policy if exists "role_definition_capabilities_select_tenant_managers" on public.role_definition_capabilities;
create policy "role_definition_capabilities_select_tenant_managers"
on public.role_definition_capabilities
for select
to authenticated
using (
  exists (
    select 1
    from public.role_definitions rd
    where rd.id = role_definition_capabilities.role_definition_id
      and rd.tenant_id is not null
      and app.current_user_can_manage_members(rd.tenant_id)
  )
);

drop policy if exists "role_assignments_select_tenant_managers" on public.role_assignments;
create policy "role_assignments_select_tenant_managers"
on public.role_assignments
for select
to authenticated
using (
  app.current_user_can_manage_members(tenant_id)
);

drop policy if exists "role_assignments_select_own_rows" on public.role_assignments;
create policy "role_assignments_select_own_rows"
on public.role_assignments
for select
to authenticated
using (
  user_id = auth.uid()
);

insert into public.capabilities (key)
values
  ('organization_users.manage'),
  ('organization_users.invite'),
  ('organization_users.change_roles'),
  ('organization_users.remove'),
  ('templates.manage'),
  ('profiles.view'),
  ('profiles.manage'),
  ('projects.create'),
  ('project_workspaces.manage'),
  ('capture.workspace'),
  ('capture.create_one_off_invites'),
  ('capture.create_recurring_project_consent_requests'),
  ('capture.upload_assets'),
  ('review.workspace'),
  ('review.initiate_consent_upgrade_requests'),
  ('workflow.finalize_project'),
  ('workflow.start_project_correction'),
  ('workflow.reopen_workspace_for_correction'),
  ('correction.review'),
  ('correction.consent_intake'),
  ('correction.media_intake'),
  ('media_library.access'),
  ('media_library.manage_folders')
on conflict (key) do nothing;

insert into public.role_definitions (slug, name, description, is_system, system_role_key)
values
  ('owner', 'Owner', 'System owner role matching memberships.role = owner.', true, 'owner'),
  ('admin', 'Admin', 'System admin role matching memberships.role = admin.', true, 'admin'),
  ('reviewer', 'Reviewer', 'System reviewer role matching memberships.role = reviewer.', true, 'reviewer'),
  ('photographer', 'Photographer', 'System photographer role matching memberships.role = photographer.', true, 'photographer')
on conflict (system_role_key) where is_system
do update set
  slug = excluded.slug,
  name = excluded.name,
  description = excluded.description;

with system_role_capabilities(role_key, capability_key) as (
  values
    ('owner', 'organization_users.manage'),
    ('owner', 'organization_users.invite'),
    ('owner', 'organization_users.change_roles'),
    ('owner', 'organization_users.remove'),
    ('owner', 'templates.manage'),
    ('owner', 'profiles.view'),
    ('owner', 'profiles.manage'),
    ('owner', 'projects.create'),
    ('owner', 'project_workspaces.manage'),
    ('owner', 'capture.workspace'),
    ('owner', 'capture.create_one_off_invites'),
    ('owner', 'capture.create_recurring_project_consent_requests'),
    ('owner', 'capture.upload_assets'),
    ('owner', 'review.workspace'),
    ('owner', 'review.initiate_consent_upgrade_requests'),
    ('owner', 'workflow.finalize_project'),
    ('owner', 'workflow.start_project_correction'),
    ('owner', 'workflow.reopen_workspace_for_correction'),
    ('owner', 'correction.review'),
    ('owner', 'correction.consent_intake'),
    ('owner', 'correction.media_intake'),
    ('owner', 'media_library.access'),
    ('owner', 'media_library.manage_folders'),
    ('admin', 'organization_users.manage'),
    ('admin', 'organization_users.invite'),
    ('admin', 'organization_users.change_roles'),
    ('admin', 'organization_users.remove'),
    ('admin', 'templates.manage'),
    ('admin', 'profiles.view'),
    ('admin', 'profiles.manage'),
    ('admin', 'projects.create'),
    ('admin', 'project_workspaces.manage'),
    ('admin', 'capture.workspace'),
    ('admin', 'capture.create_one_off_invites'),
    ('admin', 'capture.create_recurring_project_consent_requests'),
    ('admin', 'capture.upload_assets'),
    ('admin', 'review.workspace'),
    ('admin', 'review.initiate_consent_upgrade_requests'),
    ('admin', 'workflow.finalize_project'),
    ('admin', 'workflow.start_project_correction'),
    ('admin', 'workflow.reopen_workspace_for_correction'),
    ('admin', 'correction.review'),
    ('admin', 'correction.consent_intake'),
    ('admin', 'correction.media_intake'),
    ('admin', 'media_library.access'),
    ('admin', 'media_library.manage_folders'),
    ('reviewer', 'profiles.view'),
    ('reviewer', 'review.workspace'),
    ('reviewer', 'review.initiate_consent_upgrade_requests'),
    ('reviewer', 'workflow.finalize_project'),
    ('reviewer', 'workflow.start_project_correction'),
    ('reviewer', 'workflow.reopen_workspace_for_correction'),
    ('reviewer', 'correction.review'),
    ('reviewer', 'correction.consent_intake'),
    ('reviewer', 'correction.media_intake'),
    ('reviewer', 'media_library.access'),
    ('reviewer', 'media_library.manage_folders'),
    ('photographer', 'profiles.view'),
    ('photographer', 'capture.workspace'),
    ('photographer', 'capture.create_one_off_invites'),
    ('photographer', 'capture.create_recurring_project_consent_requests'),
    ('photographer', 'capture.upload_assets')
)
insert into public.role_definition_capabilities (role_definition_id, capability_key)
select rd.id, src.capability_key
from system_role_capabilities src
join public.role_definitions rd
  on rd.is_system
  and rd.system_role_key = src.role_key
on conflict (role_definition_id, capability_key) do nothing;

revoke all on function app.assert_role_assignment_role_definition_scope() from public;
