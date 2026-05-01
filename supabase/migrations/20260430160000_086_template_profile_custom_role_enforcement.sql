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
      'profiles.manage'
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
    and app.current_user_has_tenant_custom_role_capability(p_tenant_id, p_capability_key);
$$;

create or replace function app.current_user_can_manage_templates(p_tenant_id uuid)
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
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  )
  or app.current_user_has_tenant_custom_role_capability(p_tenant_id, 'templates.manage');
$$;

create or replace function app.current_user_can_view_recurring_profiles(p_tenant_id uuid)
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
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin', 'reviewer', 'photographer')
  )
  or app.current_user_has_tenant_custom_role_capability(p_tenant_id, 'profiles.view')
  or app.current_user_has_tenant_custom_role_capability(p_tenant_id, 'profiles.manage');
$$;

create or replace function app.current_user_can_manage_recurring_profiles(p_tenant_id uuid)
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
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  )
  or app.current_user_has_tenant_custom_role_capability(p_tenant_id, 'profiles.manage');
$$;

drop policy if exists "recurring_profile_types_select_member" on public.recurring_profile_types;
create policy "recurring_profile_types_select_member"
on public.recurring_profile_types
for select
to authenticated
using (
  app.current_user_can_view_recurring_profiles(tenant_id)
);

drop policy if exists "recurring_profiles_select_member" on public.recurring_profiles;
create policy "recurring_profiles_select_member"
on public.recurring_profiles
for select
to authenticated
using (
  app.current_user_can_view_recurring_profiles(tenant_id)
);

drop policy if exists "recurring_profile_consent_requests_select_member" on public.recurring_profile_consent_requests;
drop policy if exists "recurring_profile_consent_requests_select_workspace_member" on public.recurring_profile_consent_requests;
create policy "recurring_profile_consent_requests_select_workspace_member"
on public.recurring_profile_consent_requests
for select
to authenticated
using (
  (
    consent_kind = 'baseline'
    and app.current_user_can_view_recurring_profiles(tenant_id)
  )
  or (
    consent_kind = 'project'
    and app.current_user_can_access_project_workspace(tenant_id, project_id, workspace_id)
  )
);

drop policy if exists "recurring_profile_consents_select_member" on public.recurring_profile_consents;
drop policy if exists "recurring_profile_consents_select_workspace_member" on public.recurring_profile_consents;
create policy "recurring_profile_consents_select_workspace_member"
on public.recurring_profile_consents
for select
to authenticated
using (
  (
    consent_kind = 'baseline'
    and app.current_user_can_view_recurring_profiles(tenant_id)
  )
  or (
    consent_kind = 'project'
    and app.current_user_can_access_project_workspace(tenant_id, project_id, workspace_id)
  )
);

drop policy if exists "recurring_profile_consent_events_select_member" on public.recurring_profile_consent_events;
create policy "recurring_profile_consent_events_select_member"
on public.recurring_profile_consent_events
for select
to authenticated
using (
  app.current_user_can_view_recurring_profiles(tenant_id)
);

drop policy if exists "recurring_profile_request_delivery_attempts_select_member" on public.recurring_profile_consent_request_delivery_attempts;
create policy "recurring_profile_request_delivery_attempts_select_member"
on public.recurring_profile_consent_request_delivery_attempts
for select
to authenticated
using (
  app.current_user_can_view_recurring_profiles(tenant_id)
);

drop policy if exists "recurring_profile_headshots_storage_select_member" on storage.objects;
create policy "recurring_profile_headshots_storage_select_member"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'recurring-profile-headshots'
  and split_part(name, '/', 1) = 'tenant'
  and split_part(name, '/', 3) = 'profile'
  and split_part(name, '/', 5) = 'headshot'
  and app.current_user_can_view_recurring_profiles(split_part(name, '/', 2)::uuid)
  and exists (
    select 1
    from public.recurring_profiles rp
    where rp.id = split_part(name, '/', 4)::uuid
      and rp.tenant_id = split_part(name, '/', 2)::uuid
  )
);

drop policy if exists "recurring_profile_headshots_select_member" on public.recurring_profile_headshots;
create policy "recurring_profile_headshots_select_member"
on public.recurring_profile_headshots
for select
to authenticated
using (
  app.current_user_can_view_recurring_profiles(tenant_id)
);

drop policy if exists "recurring_profile_headshot_materializations_select_member" on public.recurring_profile_headshot_materializations;
create policy "recurring_profile_headshot_materializations_select_member"
on public.recurring_profile_headshot_materializations
for select
to authenticated
using (
  app.current_user_can_view_recurring_profiles(tenant_id)
);

drop policy if exists "recurring_profile_headshot_materialization_faces_select_member" on public.recurring_profile_headshot_materialization_faces;
create policy "recurring_profile_headshot_materialization_faces_select_member"
on public.recurring_profile_headshot_materialization_faces
for select
to authenticated
using (
  app.current_user_can_view_recurring_profiles(tenant_id)
);

revoke all on function app.current_user_has_tenant_custom_role_capability(uuid, text) from public;
revoke all on function app.current_user_has_media_library_custom_role_capability(uuid, text) from public;
revoke all on function app.current_user_can_manage_templates(uuid) from public;
revoke all on function app.current_user_can_view_recurring_profiles(uuid) from public;
revoke all on function app.current_user_can_manage_recurring_profiles(uuid) from public;

grant execute on function app.current_user_has_tenant_custom_role_capability(uuid, text) to authenticated;
grant execute on function app.current_user_has_media_library_custom_role_capability(uuid, text) to authenticated;
grant execute on function app.current_user_can_manage_templates(uuid) to authenticated;
grant execute on function app.current_user_can_view_recurring_profiles(uuid) to authenticated;
grant execute on function app.current_user_can_manage_recurring_profiles(uuid) to authenticated;
