create or replace function app.current_user_has_tenant_wide_reviewer_access(
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
    join public.role_assignments ra
      on ra.tenant_id = m.tenant_id
      and ra.user_id = m.user_id
    join public.role_definitions rd
      on rd.id = ra.role_definition_id
    where m.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and m.role = 'reviewer'
      and ra.scope_type = 'tenant'
      and ra.project_id is null
      and ra.workspace_id is null
      and ra.revoked_at is null
      and rd.is_system
      and rd.system_role_key = 'reviewer'
  );
$$;

create or replace function app.current_user_has_project_reviewer_access(
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
        app.current_user_has_tenant_wide_reviewer_access(p_tenant_id)
        or exists (
          select 1
          from public.memberships m
          join public.role_assignments ra
            on ra.tenant_id = m.tenant_id
            and ra.user_id = m.user_id
          join public.role_definitions rd
            on rd.id = ra.role_definition_id
          where m.tenant_id = p_tenant_id
            and m.user_id = auth.uid()
            and m.role = 'reviewer'
            and ra.scope_type = 'project'
            and ra.project_id = p_project_id
            and ra.workspace_id is null
            and ra.revoked_at is null
            and rd.is_system
            and rd.system_role_key = 'reviewer'
        )
      )
  );
$$;

create or replace function app.current_user_has_workspace_reviewer_access(
  p_tenant_id uuid,
  p_project_id uuid,
  p_workspace_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.project_workspaces pw
    where pw.id = p_workspace_id
      and pw.tenant_id = p_tenant_id
      and pw.project_id = p_project_id
      and app.current_user_has_project_reviewer_access(p_tenant_id, p_project_id)
  );
$$;

create or replace function app.current_user_can_access_project(
  p_tenant_id uuid,
  p_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  with membership as (
    select app.current_user_membership_role(p_tenant_id) as role
  )
  select exists (
    select 1
    from public.projects p
    cross join membership
    where p.id = p_project_id
      and p.tenant_id = p_tenant_id
      and (
        membership.role in ('owner', 'admin')
        or (
          membership.role = 'photographer'
          and exists (
            select 1
            from public.project_workspaces pw
            where pw.tenant_id = p_tenant_id
              and pw.project_id = p_project_id
              and pw.photographer_user_id = auth.uid()
          )
        )
        or app.current_user_has_project_reviewer_access(p_tenant_id, p_project_id)
      )
  );
$$;

create or replace function app.current_user_can_access_project_workspace(
  p_tenant_id uuid,
  p_project_id uuid,
  p_workspace_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.project_workspaces pw
    join public.memberships m
      on m.tenant_id = pw.tenant_id
    where pw.id = p_workspace_id
      and pw.tenant_id = p_tenant_id
      and pw.project_id = p_project_id
      and m.user_id = auth.uid()
      and (
        m.role in ('owner', 'admin')
        or (m.role = 'photographer' and pw.photographer_user_id = auth.uid())
        or app.current_user_has_workspace_reviewer_access(p_tenant_id, p_project_id, p_workspace_id)
      )
  );
$$;

create or replace function app.current_user_can_review_project(
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
    join public.memberships m
      on m.tenant_id = p.tenant_id
    where p.id = p_project_id
      and p.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and (
        m.role in ('owner', 'admin')
        or app.current_user_has_project_reviewer_access(p_tenant_id, p_project_id)
      )
  );
$$;

create or replace function app.current_user_can_review_project_workspace(
  p_tenant_id uuid,
  p_project_id uuid,
  p_workspace_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.project_workspaces pw
    join public.memberships m
      on m.tenant_id = pw.tenant_id
    where pw.id = p_workspace_id
      and pw.tenant_id = p_tenant_id
      and pw.project_id = p_project_id
      and m.user_id = auth.uid()
      and (
        m.role in ('owner', 'admin')
        or app.current_user_has_workspace_reviewer_access(p_tenant_id, p_project_id, p_workspace_id)
      )
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
      )
  );
$$;

create or replace function public.current_user_can_access_project(
  p_tenant_id uuid,
  p_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.current_user_can_access_project(p_tenant_id, p_project_id);
$$;

create or replace function public.current_user_can_access_project_workspace(
  p_tenant_id uuid,
  p_project_id uuid,
  p_workspace_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.current_user_can_access_project_workspace(p_tenant_id, p_project_id, p_workspace_id);
$$;

create or replace function public.current_user_can_review_project_workspace(
  p_tenant_id uuid,
  p_project_id uuid,
  p_workspace_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.current_user_can_review_project_workspace(p_tenant_id, p_project_id, p_workspace_id);
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

revoke all on function app.current_user_has_tenant_wide_reviewer_access(uuid) from public;
revoke all on function app.current_user_has_project_reviewer_access(uuid, uuid) from public;
revoke all on function app.current_user_has_workspace_reviewer_access(uuid, uuid, uuid) from public;
revoke all on function app.current_user_can_access_project(uuid, uuid) from public;
revoke all on function app.current_user_can_access_project_workspace(uuid, uuid, uuid) from public;
revoke all on function app.current_user_can_review_project(uuid, uuid) from public;
revoke all on function app.current_user_can_review_project_workspace(uuid, uuid, uuid) from public;
revoke all on function app.current_user_can_access_media_library(uuid) from public;
revoke all on function app.current_user_can_manage_media_library(uuid) from public;
revoke all on function public.current_user_can_access_project(uuid, uuid) from public;
revoke all on function public.current_user_can_access_project_workspace(uuid, uuid, uuid) from public;
revoke all on function public.current_user_can_review_project_workspace(uuid, uuid, uuid) from public;
revoke all on function public.current_user_can_access_media_library(uuid) from public;
revoke all on function public.current_user_can_manage_media_library(uuid) from public;

grant execute on function app.current_user_has_tenant_wide_reviewer_access(uuid) to authenticated;
grant execute on function app.current_user_has_project_reviewer_access(uuid, uuid) to authenticated;
grant execute on function app.current_user_has_workspace_reviewer_access(uuid, uuid, uuid) to authenticated;
grant execute on function app.current_user_can_access_project(uuid, uuid) to authenticated;
grant execute on function app.current_user_can_access_project_workspace(uuid, uuid, uuid) to authenticated;
grant execute on function app.current_user_can_review_project(uuid, uuid) to authenticated;
grant execute on function app.current_user_can_review_project_workspace(uuid, uuid, uuid) to authenticated;
grant execute on function app.current_user_can_access_media_library(uuid) to authenticated;
grant execute on function app.current_user_can_manage_media_library(uuid) to authenticated;
grant execute on function public.current_user_can_access_project(uuid, uuid) to authenticated;
grant execute on function public.current_user_can_access_project_workspace(uuid, uuid, uuid) to authenticated;
grant execute on function public.current_user_can_review_project_workspace(uuid, uuid, uuid) to authenticated;
grant execute on function public.current_user_can_access_media_library(uuid) to authenticated;
grant execute on function public.current_user_can_manage_media_library(uuid) to authenticated;
