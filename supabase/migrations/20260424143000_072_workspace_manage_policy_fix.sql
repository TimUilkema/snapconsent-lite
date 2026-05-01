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
  -- Workspace staffing is a tenant-manager capability. The project foreign key
  -- already guarantees the workspace row belongs to a real project in the same tenant.
  select coalesce(app.current_user_membership_role(p_tenant_id) in ('owner', 'admin'), false);
$$;
