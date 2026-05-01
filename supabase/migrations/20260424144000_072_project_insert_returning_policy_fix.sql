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
);
