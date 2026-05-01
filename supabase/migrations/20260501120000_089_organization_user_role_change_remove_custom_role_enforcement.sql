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
      'project_workspaces.manage',
      'organization_users.manage',
      'organization_users.invite',
      'organization_users.change_roles',
      'organization_users.remove'
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

create or replace function app.current_user_can_view_organization_users(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(app.current_user_membership_role(p_tenant_id) in ('owner', 'admin'), false)
    or app.current_user_has_tenant_custom_role_capability(
      p_tenant_id,
      'organization_users.manage'
    )
    or app.current_user_has_tenant_custom_role_capability(
      p_tenant_id,
      'organization_users.change_roles'
    )
    or app.current_user_has_tenant_custom_role_capability(
      p_tenant_id,
      'organization_users.remove'
    );
$$;

create or replace function app.current_user_can_change_organization_user_role(
  p_tenant_id uuid,
  p_target_user_id uuid,
  p_next_role text
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    auth.uid() is not null
    and p_next_role in ('admin', 'reviewer', 'photographer')
    and (
      (
        app.current_user_can_manage_members(p_tenant_id)
        and exists (
          select 1
          from public.memberships target
          where target.tenant_id = p_tenant_id
            and target.user_id = p_target_user_id
            and target.role <> 'owner'
        )
      )
      or (
        p_target_user_id <> auth.uid()
        and p_next_role in ('reviewer', 'photographer')
        and app.current_user_has_tenant_custom_role_capability(
          p_tenant_id,
          'organization_users.change_roles'
        )
        and exists (
          select 1
          from public.memberships target
          where target.tenant_id = p_tenant_id
            and target.user_id = p_target_user_id
            and target.role in ('reviewer', 'photographer')
        )
      )
    );
$$;

create or replace function app.current_user_can_remove_organization_user(
  p_tenant_id uuid,
  p_target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    auth.uid() is not null
    and (
      (
        app.current_user_can_manage_members(p_tenant_id)
        and exists (
          select 1
          from public.memberships target
          where target.tenant_id = p_tenant_id
            and target.user_id = p_target_user_id
            and target.role <> 'owner'
        )
      )
      or (
        p_target_user_id <> auth.uid()
        and app.current_user_has_tenant_custom_role_capability(
          p_tenant_id,
          'organization_users.remove'
        )
        and exists (
          select 1
          from public.memberships target
          where target.tenant_id = p_tenant_id
            and target.user_id = p_target_user_id
            and target.role in ('reviewer', 'photographer')
        )
      )
    );
$$;

create or replace function public.current_user_can_change_organization_user_role(
  p_tenant_id uuid,
  p_target_user_id uuid,
  p_next_role text
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.current_user_can_change_organization_user_role(
    p_tenant_id,
    p_target_user_id,
    p_next_role
  );
$$;

create or replace function public.current_user_can_remove_organization_user(
  p_tenant_id uuid,
  p_target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.current_user_can_remove_organization_user(
    p_tenant_id,
    p_target_user_id
  );
$$;

create or replace function app.prevent_membership_identity_update()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if old.tenant_id is distinct from new.tenant_id
    or old.user_id is distinct from new.user_id then
    raise exception 'membership_identity_immutable' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists memberships_prevent_identity_update on public.memberships;
create trigger memberships_prevent_identity_update
before update of tenant_id, user_id on public.memberships
for each row
execute function app.prevent_membership_identity_update();

drop policy if exists "memberships_update_manage_member_rows" on public.memberships;
create policy "memberships_update_manage_member_rows"
on public.memberships
for update
to authenticated
using (
  (
    app.current_user_can_manage_members(tenant_id)
    and role <> 'owner'
  )
  or (
    auth.uid() is not null
    and user_id <> auth.uid()
    and role in ('reviewer', 'photographer')
    and app.current_user_has_tenant_custom_role_capability(
      tenant_id,
      'organization_users.change_roles'
    )
  )
)
with check (
  (
    app.current_user_can_manage_members(tenant_id)
    and role in ('admin', 'reviewer', 'photographer')
  )
  or (
    auth.uid() is not null
    and user_id <> auth.uid()
    and role in ('reviewer', 'photographer')
    and app.current_user_has_tenant_custom_role_capability(
      tenant_id,
      'organization_users.change_roles'
    )
  )
);

drop policy if exists "memberships_delete_manage_member_rows" on public.memberships;
create policy "memberships_delete_manage_member_rows"
on public.memberships
for delete
to authenticated
using (
  (
    app.current_user_can_manage_members(tenant_id)
    and role <> 'owner'
  )
  or (
    auth.uid() is not null
    and user_id <> auth.uid()
    and role in ('reviewer', 'photographer')
    and app.current_user_has_tenant_custom_role_capability(
      tenant_id,
      'organization_users.remove'
    )
  )
);

revoke all on function app.current_user_has_tenant_custom_role_capability(uuid, text) from public;
revoke all on function app.current_user_can_view_organization_users(uuid) from public;
revoke all on function app.current_user_can_change_organization_user_role(uuid, uuid, text) from public;
revoke all on function app.current_user_can_remove_organization_user(uuid, uuid) from public;
revoke all on function public.current_user_can_change_organization_user_role(uuid, uuid, text) from public;
revoke all on function public.current_user_can_remove_organization_user(uuid, uuid) from public;

grant execute on function app.current_user_has_tenant_custom_role_capability(uuid, text) to authenticated;
grant execute on function app.current_user_can_view_organization_users(uuid) to authenticated;
grant execute on function app.current_user_can_change_organization_user_role(uuid, uuid, text) to authenticated;
grant execute on function app.current_user_can_remove_organization_user(uuid, uuid) to authenticated;
grant execute on function public.current_user_can_change_organization_user_role(uuid, uuid, text) to authenticated;
grant execute on function public.current_user_can_remove_organization_user(uuid, uuid) to authenticated;
