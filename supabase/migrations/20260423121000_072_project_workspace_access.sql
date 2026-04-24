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
        membership.role in ('owner', 'admin', 'reviewer')
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
      )
  );
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
    join public.memberships m
      on m.tenant_id = p.tenant_id
    where p.id = p_project_id
      and p.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
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
        m.role in ('owner', 'admin', 'reviewer')
        or (m.role = 'photographer' and pw.photographer_user_id = auth.uid())
      )
  );
$$;

create or replace function app.current_user_can_capture_project(
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
      )
  );
$$;

create or replace function app.current_user_can_capture_project_workspace(
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
      and m.role in ('owner', 'admin', 'reviewer')
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
      and m.role in ('owner', 'admin', 'reviewer')
  );
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

create or replace function public.current_user_can_capture_project_workspace(
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
  select app.current_user_can_capture_project_workspace(p_tenant_id, p_project_id, p_workspace_id);
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

alter table public.project_workspaces enable row level security;

grant select, insert, update, delete on table public.project_workspaces to authenticated;
grant select, insert, update, delete on table public.project_workspaces to service_role;

drop policy if exists "project_workspaces_select_workspace_member" on public.project_workspaces;
create policy "project_workspaces_select_workspace_member"
on public.project_workspaces
for select
to authenticated
using (
  app.current_user_can_access_project_workspace(tenant_id, project_id, id)
);

drop policy if exists "project_workspaces_insert_manage_workspace_rows" on public.project_workspaces;
create policy "project_workspaces_insert_manage_workspace_rows"
on public.project_workspaces
for insert
to authenticated
with check (
  app.current_user_can_manage_project_workspaces(tenant_id, project_id)
  and created_by = auth.uid()
);

drop policy if exists "project_workspaces_update_manage_workspace_rows" on public.project_workspaces;
create policy "project_workspaces_update_manage_workspace_rows"
on public.project_workspaces
for update
to authenticated
using (
  app.current_user_can_manage_project_workspaces(tenant_id, project_id)
)
with check (
  app.current_user_can_manage_project_workspaces(tenant_id, project_id)
);

drop policy if exists "project_workspaces_delete_manage_workspace_rows" on public.project_workspaces;
create policy "project_workspaces_delete_manage_workspace_rows"
on public.project_workspaces
for delete
to authenticated
using (
  app.current_user_can_manage_project_workspaces(tenant_id, project_id)
);

drop policy if exists "projects_select_member" on public.projects;
drop policy if exists "projects_insert_member" on public.projects;
drop policy if exists "projects_update_member" on public.projects;

create policy "projects_select_workspace_member"
on public.projects
for select
to authenticated
using (
  app.current_user_can_access_project(tenant_id, id)
);

create policy "projects_insert_workspace_member"
on public.projects
for insert
to authenticated
with check (
  app.current_user_can_create_projects(tenant_id)
  and created_by = auth.uid()
);

create policy "projects_update_workspace_member"
on public.projects
for update
to authenticated
using (
  app.current_user_can_create_projects(tenant_id)
)
with check (
  app.current_user_can_create_projects(tenant_id)
);

drop policy if exists "subject_invites_select_member" on public.subject_invites;
drop policy if exists "subject_invites_insert_member" on public.subject_invites;
drop policy if exists "subject_invites_update_member" on public.subject_invites;

create policy "subject_invites_select_workspace_member"
on public.subject_invites
for select
to authenticated
using (
  app.current_user_can_access_project_workspace(tenant_id, project_id, workspace_id)
);

create policy "subject_invites_insert_workspace_capture"
on public.subject_invites
for insert
to authenticated
with check (
  app.current_user_can_capture_project_workspace(tenant_id, project_id, workspace_id)
);

create policy "subject_invites_update_workspace_capture"
on public.subject_invites
for update
to authenticated
using (
  app.current_user_can_capture_project_workspace(tenant_id, project_id, workspace_id)
)
with check (
  app.current_user_can_capture_project_workspace(tenant_id, project_id, workspace_id)
);

drop policy if exists "subjects_select_member" on public.subjects;
drop policy if exists "subjects_insert_member" on public.subjects;
drop policy if exists "subjects_update_member" on public.subjects;

create policy "subjects_select_workspace_member"
on public.subjects
for select
to authenticated
using (
  app.current_user_can_access_project_workspace(tenant_id, project_id, workspace_id)
);

create policy "subjects_insert_workspace_capture"
on public.subjects
for insert
to authenticated
with check (
  app.current_user_can_capture_project_workspace(tenant_id, project_id, workspace_id)
);

create policy "subjects_update_workspace_capture"
on public.subjects
for update
to authenticated
using (
  app.current_user_can_capture_project_workspace(tenant_id, project_id, workspace_id)
)
with check (
  app.current_user_can_capture_project_workspace(tenant_id, project_id, workspace_id)
);

drop policy if exists "consents_select_member" on public.consents;
drop policy if exists "consents_insert_member" on public.consents;
drop policy if exists "consents_update_member" on public.consents;

create policy "consents_select_workspace_member"
on public.consents
for select
to authenticated
using (
  app.current_user_can_access_project_workspace(tenant_id, project_id, workspace_id)
);

create policy "consents_insert_workspace_capture"
on public.consents
for insert
to authenticated
with check (
  app.current_user_can_capture_project_workspace(tenant_id, project_id, workspace_id)
);

create policy "consents_update_workspace_staff"
on public.consents
for update
to authenticated
using (
  app.current_user_can_capture_project_workspace(tenant_id, project_id, workspace_id)
  or app.current_user_can_review_project_workspace(tenant_id, project_id, workspace_id)
)
with check (
  app.current_user_can_capture_project_workspace(tenant_id, project_id, workspace_id)
  or app.current_user_can_review_project_workspace(tenant_id, project_id, workspace_id)
);

drop policy if exists "assets_select_member" on public.assets;
drop policy if exists "assets_insert_member" on public.assets;
drop policy if exists "assets_update_member" on public.assets;

create policy "assets_select_workspace_member"
on public.assets
for select
to authenticated
using (
  app.current_user_can_access_project_workspace(tenant_id, project_id, workspace_id)
);

create policy "assets_insert_workspace_capture"
on public.assets
for insert
to authenticated
with check (
  app.current_user_can_capture_project_workspace(tenant_id, project_id, workspace_id)
);

create policy "assets_update_workspace_capture"
on public.assets
for update
to authenticated
using (
  app.current_user_can_capture_project_workspace(tenant_id, project_id, workspace_id)
)
with check (
  app.current_user_can_capture_project_workspace(tenant_id, project_id, workspace_id)
);

drop policy if exists "asset_consent_links_select_member" on public.asset_consent_links;
drop policy if exists "asset_consent_links_insert_member" on public.asset_consent_links;
drop policy if exists "asset_consent_links_update_member" on public.asset_consent_links;

create policy "asset_consent_links_select_workspace_member"
on public.asset_consent_links
for select
to authenticated
using (
  app.current_user_can_access_project_workspace(tenant_id, project_id, workspace_id)
);

create policy "asset_consent_links_insert_workspace_review"
on public.asset_consent_links
for insert
to authenticated
with check (
  app.current_user_can_review_project_workspace(tenant_id, project_id, workspace_id)
);

create policy "asset_consent_links_update_workspace_review"
on public.asset_consent_links
for update
to authenticated
using (
  app.current_user_can_review_project_workspace(tenant_id, project_id, workspace_id)
)
with check (
  app.current_user_can_review_project_workspace(tenant_id, project_id, workspace_id)
);

drop policy if exists "project_profile_participants_select_member" on public.project_profile_participants;
drop policy if exists "project_profile_participants_insert_member" on public.project_profile_participants;

create policy "project_profile_participants_select_workspace_member"
on public.project_profile_participants
for select
to authenticated
using (
  app.current_user_can_access_project_workspace(tenant_id, project_id, workspace_id)
);

create policy "project_profile_participants_insert_workspace_capture"
on public.project_profile_participants
for insert
to authenticated
with check (
  app.current_user_can_capture_project_workspace(tenant_id, project_id, workspace_id)
);

drop policy if exists "recurring_profile_consent_requests_select_member" on public.recurring_profile_consent_requests;
create policy "recurring_profile_consent_requests_select_workspace_member"
on public.recurring_profile_consent_requests
for select
to authenticated
using (
  (
    consent_kind = 'baseline'
    and exists (
      select 1
      from public.memberships m
      where m.tenant_id = recurring_profile_consent_requests.tenant_id
        and m.user_id = auth.uid()
    )
  )
  or (
    consent_kind = 'project'
    and app.current_user_can_access_project_workspace(tenant_id, project_id, workspace_id)
  )
);

drop policy if exists "recurring_profile_consents_select_member" on public.recurring_profile_consents;
create policy "recurring_profile_consents_select_workspace_member"
on public.recurring_profile_consents
for select
to authenticated
using (
  (
    consent_kind = 'baseline'
    and exists (
      select 1
      from public.memberships m
      where m.tenant_id = recurring_profile_consents.tenant_id
        and m.user_id = auth.uid()
    )
  )
  or (
    consent_kind = 'project'
    and app.current_user_can_access_project_workspace(tenant_id, project_id, workspace_id)
  )
);

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'asset_face_image_derivatives',
    'asset_face_consent_links',
    'asset_face_consent_link_suppressions',
    'asset_face_assignee_link_suppressions',
    'asset_consent_manual_photo_fallbacks',
    'asset_consent_manual_photo_fallback_suppressions',
    'asset_face_hidden_states',
    'asset_face_block_states',
    'face_review_sessions',
    'face_review_session_items',
    'project_face_assignees',
    'asset_assignee_links'
  ] loop
    execute format('drop policy if exists %I on public.%I;', v_table || '_select_member', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using (app.current_user_can_access_project_workspace(tenant_id, project_id, workspace_id));',
      v_table || '_select_workspace_member',
      v_table
    );
  end loop;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'asset_face_image_derivatives',
    'asset_face_consent_links',
    'asset_face_consent_link_suppressions',
    'asset_face_assignee_link_suppressions',
    'asset_consent_manual_photo_fallbacks',
    'asset_consent_manual_photo_fallback_suppressions',
    'asset_face_hidden_states',
    'asset_face_block_states',
    'face_review_sessions',
    'face_review_session_items',
    'project_face_assignees',
    'asset_assignee_links'
  ] loop
    execute format('drop policy if exists %I on public.%I;', v_table || '_insert_member', v_table);
    execute format('drop policy if exists %I on public.%I;', v_table || '_update_member', v_table);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (app.current_user_can_review_project_workspace(tenant_id, project_id, workspace_id));',
      v_table || '_insert_workspace_review',
      v_table
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (app.current_user_can_review_project_workspace(tenant_id, project_id, workspace_id)) with check (app.current_user_can_review_project_workspace(tenant_id, project_id, workspace_id));',
      v_table || '_update_workspace_review',
      v_table
    );
  end loop;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'asset_face_image_derivatives',
    'asset_face_consent_links',
    'asset_face_assignee_link_suppressions',
    'asset_consent_manual_photo_fallbacks',
    'asset_consent_manual_photo_fallback_suppressions',
    'project_face_assignees',
    'asset_assignee_links'
  ] loop
    execute format('drop policy if exists %I on public.%I;', v_table || '_delete_member', v_table);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (app.current_user_can_review_project_workspace(tenant_id, project_id, workspace_id));',
      v_table || '_delete_workspace_review',
      v_table
    );
  end loop;
end;
$$;

drop policy if exists "project_consent_scope_signed_projections_select_member" on public.project_consent_scope_signed_projections;
create policy "project_consent_scope_signed_projections_select_workspace_member"
on public.project_consent_scope_signed_projections
for select
to authenticated
using (
  app.current_user_can_access_project_workspace(tenant_id, project_id, workspace_id)
);

drop policy if exists "project_consent_upgrade_requests_select_member" on public.project_consent_upgrade_requests;
drop policy if exists "project_consent_upgrade_requests_insert_project_member" on public.project_consent_upgrade_requests;
drop policy if exists "project_consent_upgrade_requests_update_project_member" on public.project_consent_upgrade_requests;

create policy "project_consent_upgrade_requests_select_workspace_member"
on public.project_consent_upgrade_requests
for select
to authenticated
using (
  app.current_user_can_access_project_workspace(tenant_id, project_id, workspace_id)
);

create policy "project_consent_upgrade_requests_insert_workspace_review"
on public.project_consent_upgrade_requests
for insert
to authenticated
with check (
  app.current_user_can_review_project_workspace(tenant_id, project_id, workspace_id)
);

create policy "project_consent_upgrade_requests_update_workspace_review"
on public.project_consent_upgrade_requests
for update
to authenticated
using (
  app.current_user_can_review_project_workspace(tenant_id, project_id, workspace_id)
)
with check (
  app.current_user_can_review_project_workspace(tenant_id, project_id, workspace_id)
);

revoke all on function app.current_user_can_access_project_workspace(uuid, uuid, uuid) from public;
revoke all on function app.current_user_can_capture_project_workspace(uuid, uuid, uuid) from public;
revoke all on function app.current_user_can_review_project_workspace(uuid, uuid, uuid) from public;
revoke all on function app.current_user_can_manage_project_workspaces(uuid, uuid) from public;
revoke all on function public.current_user_can_access_project_workspace(uuid, uuid, uuid) from public;
revoke all on function public.current_user_can_capture_project_workspace(uuid, uuid, uuid) from public;
revoke all on function public.current_user_can_review_project_workspace(uuid, uuid, uuid) from public;

grant execute on function app.current_user_can_access_project(uuid, uuid) to authenticated;
grant execute on function app.current_user_can_capture_project(uuid, uuid) to authenticated;
grant execute on function app.current_user_can_review_project(uuid, uuid) to authenticated;
grant execute on function app.current_user_can_access_project_workspace(uuid, uuid, uuid) to authenticated;
grant execute on function app.current_user_can_capture_project_workspace(uuid, uuid, uuid) to authenticated;
grant execute on function app.current_user_can_review_project_workspace(uuid, uuid, uuid) to authenticated;
grant execute on function app.current_user_can_manage_project_workspaces(uuid, uuid) to authenticated;

grant execute on function public.current_user_can_access_project(uuid, uuid) to authenticated;
grant execute on function public.current_user_can_capture_project(uuid, uuid) to authenticated;
grant execute on function public.current_user_can_review_project(uuid, uuid) to authenticated;
grant execute on function public.current_user_can_access_project_workspace(uuid, uuid, uuid) to authenticated;
grant execute on function public.current_user_can_capture_project_workspace(uuid, uuid, uuid) to authenticated;
grant execute on function public.current_user_can_review_project_workspace(uuid, uuid, uuid) to authenticated;
