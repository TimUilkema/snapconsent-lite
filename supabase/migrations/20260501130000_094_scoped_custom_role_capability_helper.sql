create or replace function app.current_user_has_scoped_custom_role_capability(
  p_tenant_id uuid,
  p_capability_key text,
  p_project_id uuid default null,
  p_workspace_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  with capability_scope_matrix(capability_key, tenant_support, project_support, workspace_support) as (
    values
      ('organization_users.manage', 'yes', 'no', 'no'),
      ('organization_users.invite', 'yes', 'no', 'no'),
      ('organization_users.change_roles', 'yes', 'no', 'no'),
      ('organization_users.remove', 'yes', 'no', 'no'),
      ('templates.manage', 'yes', 'no', 'no'),
      ('profiles.view', 'yes', 'no', 'no'),
      ('profiles.manage', 'yes', 'no', 'no'),
      ('projects.create', 'yes', 'not_applicable', 'not_applicable'),
      ('project_workspaces.manage', 'yes', 'yes', 'no'),
      ('capture.workspace', 'defer', 'yes', 'yes'),
      ('capture.create_one_off_invites', 'defer', 'yes', 'yes'),
      ('capture.create_recurring_project_consent_requests', 'defer', 'yes', 'yes'),
      ('capture.upload_assets', 'defer', 'yes', 'yes'),
      ('review.workspace', 'defer', 'yes', 'yes'),
      ('review.initiate_consent_upgrade_requests', 'defer', 'yes', 'yes'),
      ('workflow.finalize_project', 'defer', 'yes', 'no'),
      ('workflow.start_project_correction', 'defer', 'yes', 'no'),
      ('workflow.reopen_workspace_for_correction', 'defer', 'yes', 'yes'),
      ('correction.review', 'defer', 'yes', 'yes'),
      ('correction.consent_intake', 'defer', 'yes', 'yes'),
      ('correction.media_intake', 'defer', 'yes', 'yes'),
      ('media_library.access', 'yes', 'no', 'no'),
      ('media_library.manage_folders', 'yes', 'no', 'no')
  ),
  requested_context as (
    select
      case
        when p_workspace_id is not null and p_project_id is not null then 'workspace'
        when p_workspace_id is null and p_project_id is not null then 'project'
        when p_workspace_id is null and p_project_id is null then 'tenant'
        else 'invalid'
      end as requested_scope,
      case
        when p_workspace_id is not null and p_project_id is null then false
        when p_workspace_id is not null then exists (
          select 1
          from public.project_workspaces pw
          where pw.tenant_id = p_tenant_id
            and pw.project_id = p_project_id
            and pw.id = p_workspace_id
        )
        when p_project_id is not null then exists (
          select 1
          from public.projects p
          where p.tenant_id = p_tenant_id
            and p.id = p_project_id
        )
        else true
      end as context_is_valid
  )
  select coalesce((
    select
      rc.context_is_valid
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
          and ra.revoked_at is null
          and rd.tenant_id = p_tenant_id
          and rd.is_system = false
          and rd.archived_at is null
          and rdc.capability_key = p_capability_key
          and rdc.capability_key = csm.capability_key
          and (
            (
              rc.requested_scope = 'tenant'
              and ra.scope_type = 'tenant'
              and ra.project_id is null
              and ra.workspace_id is null
              and csm.tenant_support = 'yes'
            )
            or (
              rc.requested_scope = 'project'
              and (
                (
                  ra.scope_type = 'tenant'
                  and ra.project_id is null
                  and ra.workspace_id is null
                  and csm.tenant_support = 'yes'
                  and csm.project_support = 'yes'
                )
                or (
                  ra.scope_type = 'project'
                  and ra.project_id = p_project_id
                  and ra.workspace_id is null
                  and csm.project_support = 'yes'
                )
              )
            )
            or (
              rc.requested_scope = 'workspace'
              and (
                (
                  ra.scope_type = 'tenant'
                  and ra.project_id is null
                  and ra.workspace_id is null
                  and csm.tenant_support = 'yes'
                  and csm.workspace_support = 'yes'
                )
                or (
                  ra.scope_type = 'project'
                  and ra.project_id = p_project_id
                  and ra.workspace_id is null
                  and csm.workspace_support = 'yes'
                )
                or (
                  ra.scope_type = 'workspace'
                  and ra.project_id = p_project_id
                  and ra.workspace_id = p_workspace_id
                  and csm.workspace_support = 'yes'
                )
              )
            )
          )
      )
    from capability_scope_matrix csm
    cross join requested_context rc
    where csm.capability_key = p_capability_key
  ), false);
$$;

create or replace function public.current_user_has_scoped_custom_role_capability(
  p_tenant_id uuid,
  p_capability_key text,
  p_project_id uuid default null,
  p_workspace_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.current_user_has_scoped_custom_role_capability(
    p_tenant_id,
    p_capability_key,
    p_project_id,
    p_workspace_id
  );
$$;

revoke all on function app.current_user_has_scoped_custom_role_capability(uuid, text, uuid, uuid) from public;
revoke all on function public.current_user_has_scoped_custom_role_capability(uuid, text, uuid, uuid) from public;
grant execute on function app.current_user_has_scoped_custom_role_capability(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.current_user_has_scoped_custom_role_capability(uuid, text, uuid, uuid) to authenticated;
