create or replace function app.current_user_has_media_library_custom_role_capability(
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
    p_capability_key in ('media_library.access', 'media_library.manage_folders')
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
        and m.user_id = auth.uid()
        and ra.tenant_id = p_tenant_id
        and ra.user_id = auth.uid()
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

create or replace function app.current_user_can_access_media_library(
  p_tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and (
        m.role in ('owner', 'admin')
        or app.current_user_has_tenant_wide_reviewer_access(p_tenant_id)
        or app.current_user_has_media_library_custom_role_capability(
          p_tenant_id,
          'media_library.access'
        )
      )
  );
$$;

create or replace function app.current_user_can_manage_media_library(
  p_tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and (
        m.role in ('owner', 'admin')
        or app.current_user_has_tenant_wide_reviewer_access(p_tenant_id)
        or app.current_user_has_media_library_custom_role_capability(
          p_tenant_id,
          'media_library.manage_folders'
        )
      )
  );
$$;

create or replace function public.current_user_can_access_media_library(
  p_tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.current_user_can_access_media_library(p_tenant_id);
$$;

create or replace function public.current_user_can_manage_media_library(
  p_tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.current_user_can_manage_media_library(p_tenant_id);
$$;

revoke all on function app.current_user_has_media_library_custom_role_capability(uuid, text) from public;
revoke all on function app.current_user_can_access_media_library(uuid) from public;
revoke all on function app.current_user_can_manage_media_library(uuid) from public;
revoke all on function public.current_user_can_access_media_library(uuid) from public;
revoke all on function public.current_user_can_manage_media_library(uuid) from public;

grant execute on function app.current_user_has_media_library_custom_role_capability(uuid, text) to authenticated;
grant execute on function app.current_user_can_access_media_library(uuid) to authenticated;
grant execute on function app.current_user_can_manage_media_library(uuid) to authenticated;
grant execute on function public.current_user_can_access_media_library(uuid) to authenticated;
grant execute on function public.current_user_can_manage_media_library(uuid) to authenticated;
