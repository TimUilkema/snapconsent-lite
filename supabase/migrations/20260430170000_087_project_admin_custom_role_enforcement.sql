create or replace function app.current_user_has_tenant_custom_role_capability(
  p_tenant_id uuid,
  p_capability_key text
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    p_capability_key in (
      'media_library.access',
      'media_library.manage_folders',
      'templates.manage',
      'profiles.view',
      'profiles.manage',
      'projects.create',
      'project_workspaces.manage'
    )
    and exists (
      select 1
      from public.memberships m
      join public.role_assignments ra
        on ra.tenant_id = m.tenant_id
       and ra.user_id = m.user_id
      join public.role_definitions rd
        on rd.id = ra.role_definition_id
      join public.role_definition_capabilities rdc
        on rdc.role_definition_id = rd.id
      where m.tenant_id = p_tenant_id
        and m.user_id = (select auth.uid())
        and ra.tenant_id = p_tenant_id
        and ra.user_id = (select auth.uid())
        and ra.scope_type = 'tenant'
        and ra.project_id is null
        and ra.workspace_id is null
        and ra.revoked_at is null
        and rd.is_system = false
        and rd.tenant_id = p_tenant_id
        and rd.archived_at is null
        and rdc.capability_key = p_capability_key
    );
$$;

create or replace function app.current_user_can_create_projects(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(app.current_user_membership_role(p_tenant_id) in ('owner', 'admin'), false)
    or app.current_user_has_tenant_custom_role_capability(p_tenant_id, 'projects.create');
$$;

create or replace function app.current_user_can_manage_project_workspaces(
  p_tenant_id uuid,
  p_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.tenant_id = p_tenant_id
      and (
        coalesce(app.current_user_membership_role(p_tenant_id) in ('owner', 'admin'), false)
        or app.current_user_has_tenant_custom_role_capability(p_tenant_id, 'project_workspaces.manage')
      )
  );
$$;

create or replace function app.current_user_can_view_project_administration(
  p_tenant_id uuid,
  p_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.tenant_id = p_tenant_id
      and (
        coalesce(app.current_user_membership_role(p_tenant_id) in ('owner', 'admin'), false)
        or app.current_user_has_tenant_custom_role_capability(p_tenant_id, 'project_workspaces.manage')
        or (
          p.created_by = (select auth.uid())
          and app.current_user_has_tenant_custom_role_capability(p_tenant_id, 'projects.create')
        )
      )
  );
$$;

create or replace function public.current_user_can_create_projects(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.current_user_can_create_projects(p_tenant_id);
$$;

create or replace function public.current_user_can_view_project_administration(
  p_tenant_id uuid,
  p_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.current_user_can_view_project_administration(p_tenant_id, p_project_id);
$$;

create or replace function app.ensure_default_project_workspace()
returns trigger
language plpgsql
security definer
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

drop policy if exists "projects_select_workspace_member" on public.projects;
create policy "projects_select_workspace_member"
on public.projects
for select
to authenticated
using (
  app.current_user_membership_role(tenant_id) in ('owner', 'admin', 'reviewer')
  or (
    app.current_user_membership_role(tenant_id) = 'photographer'
    and exists (
      select 1
      from public.project_workspaces pw
      where pw.tenant_id = projects.tenant_id
        and pw.project_id = projects.id
        and pw.photographer_user_id = auth.uid()
    )
  )
  or app.current_user_has_tenant_custom_role_capability(tenant_id, 'project_workspaces.manage')
  or (
    created_by = auth.uid()
    and app.current_user_has_tenant_custom_role_capability(tenant_id, 'projects.create')
  )
);

drop policy if exists "projects_update_workspace_member" on public.projects;
create policy "projects_update_workspace_member"
on public.projects
for update
to authenticated
using (
  app.current_user_membership_role(tenant_id) in ('owner', 'admin')
)
with check (
  app.current_user_membership_role(tenant_id) in ('owner', 'admin')
);

drop policy if exists "project_workspaces_select_workspace_member" on public.project_workspaces;
create policy "project_workspaces_select_workspace_member"
on public.project_workspaces
for select
to authenticated
using (
  app.current_user_membership_role(tenant_id) in ('owner', 'admin', 'reviewer')
  or (
    app.current_user_membership_role(tenant_id) = 'photographer'
    and photographer_user_id = auth.uid()
  )
  or app.current_user_can_manage_project_workspaces(tenant_id, project_id)
);

revoke all on function app.current_user_has_tenant_custom_role_capability(uuid, text) from public;
revoke all on function app.current_user_can_create_projects(uuid) from public;
revoke all on function app.current_user_can_manage_project_workspaces(uuid, uuid) from public;
revoke all on function app.current_user_can_view_project_administration(uuid, uuid) from public;
revoke all on function app.ensure_default_project_workspace() from public;
revoke all on function public.current_user_can_create_projects(uuid) from public;
revoke all on function public.current_user_can_view_project_administration(uuid, uuid) from public;

grant execute on function app.current_user_has_tenant_custom_role_capability(uuid, text) to authenticated;
grant execute on function app.current_user_can_create_projects(uuid) to authenticated;
grant execute on function app.current_user_can_manage_project_workspaces(uuid, uuid) to authenticated;
grant execute on function app.current_user_can_view_project_administration(uuid, uuid) to authenticated;
grant execute on function public.current_user_can_create_projects(uuid) to authenticated;
grant execute on function public.current_user_can_view_project_administration(uuid, uuid) to authenticated;
