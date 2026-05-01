-- Feature 095: enforce Feature 094 effective operational capabilities in SQL/RLS.

create or replace function app.current_user_has_any_operational_custom_role_project_access(
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
    from unnest(array[
      'capture.workspace',
      'capture.create_one_off_invites',
      'capture.create_recurring_project_consent_requests',
      'capture.upload_assets',
      'review.workspace',
      'review.initiate_consent_upgrade_requests',
      'workflow.finalize_project',
      'workflow.start_project_correction',
      'workflow.reopen_workspace_for_correction',
      'correction.review',
      'correction.consent_intake',
      'correction.media_intake'
    ]::text[]) as capability(capability_key)
    where app.current_user_has_scoped_custom_role_capability(
      p_tenant_id,
      capability.capability_key,
      p_project_id,
      null
    )
  )
  or exists (
    select 1
    from public.project_workspaces pw
    cross join unnest(array[
      'capture.workspace',
      'capture.create_one_off_invites',
      'capture.create_recurring_project_consent_requests',
      'capture.upload_assets',
      'review.workspace',
      'review.initiate_consent_upgrade_requests',
      'workflow.reopen_workspace_for_correction',
      'correction.review',
      'correction.consent_intake',
      'correction.media_intake'
    ]::text[]) as capability(capability_key)
    where pw.tenant_id = p_tenant_id
      and pw.project_id = p_project_id
      and app.current_user_has_scoped_custom_role_capability(
        p_tenant_id,
        capability.capability_key,
        p_project_id,
        pw.id
      )
  );
$$;

create or replace function app.current_user_has_any_operational_custom_role_workspace_access(
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
    cross join unnest(array[
      'capture.workspace',
      'capture.create_one_off_invites',
      'capture.create_recurring_project_consent_requests',
      'capture.upload_assets',
      'review.workspace',
      'review.initiate_consent_upgrade_requests',
      'workflow.reopen_workspace_for_correction',
      'correction.review',
      'correction.consent_intake',
      'correction.media_intake'
    ]::text[]) as capability(capability_key)
    where pw.id = p_workspace_id
      and pw.tenant_id = p_tenant_id
      and pw.project_id = p_project_id
      and app.current_user_has_scoped_custom_role_capability(
        p_tenant_id,
        capability.capability_key,
        p_project_id,
        p_workspace_id
      )
  )
  or exists (
    select 1
    from public.project_workspaces pw
    cross join unnest(array[
      'workflow.finalize_project',
      'workflow.start_project_correction'
    ]::text[]) as capability(capability_key)
    where pw.id = p_workspace_id
      and pw.tenant_id = p_tenant_id
      and pw.project_id = p_project_id
      and app.current_user_has_scoped_custom_role_capability(
        p_tenant_id,
        capability.capability_key,
        p_project_id,
        null
      )
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
        or app.current_user_has_any_operational_custom_role_project_access(p_tenant_id, p_project_id)
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
        or app.current_user_has_any_operational_custom_role_workspace_access(
          p_tenant_id,
          p_project_id,
          p_workspace_id
        )
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
        or app.current_user_has_scoped_custom_role_capability(
          p_tenant_id,
          'capture.workspace',
          p_project_id,
          null
        )
        or exists (
          select 1
          from public.project_workspaces pw
          where pw.tenant_id = p_tenant_id
            and pw.project_id = p_project_id
            and app.current_user_has_scoped_custom_role_capability(
              p_tenant_id,
              'capture.workspace',
              p_project_id,
              pw.id
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
        or app.current_user_has_scoped_custom_role_capability(
          p_tenant_id,
          'capture.workspace',
          p_project_id,
          p_workspace_id
        )
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
        or app.current_user_has_scoped_custom_role_capability(
          p_tenant_id,
          'review.workspace',
          p_project_id,
          null
        )
        or exists (
          select 1
          from public.project_workspaces pw
          where pw.tenant_id = p_tenant_id
            and pw.project_id = p_project_id
            and app.current_user_has_scoped_custom_role_capability(
              p_tenant_id,
              'review.workspace',
              p_project_id,
              pw.id
            )
        )
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
        or app.current_user_has_scoped_custom_role_capability(
          p_tenant_id,
          'review.workspace',
          p_project_id,
          p_workspace_id
        )
      )
  );
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
  or app.current_user_can_access_project(tenant_id, id)
  or app.current_user_has_tenant_custom_role_capability(tenant_id, 'project_workspaces.manage')
  or (
    created_by = auth.uid()
    and app.current_user_has_tenant_custom_role_capability(tenant_id, 'projects.create')
  )
);

drop policy if exists "project_workspaces_select_workspace_member" on public.project_workspaces;
create policy "project_workspaces_select_workspace_member"
on public.project_workspaces
for select
to authenticated
using (
  app.current_user_can_access_project_workspace(tenant_id, project_id, id)
  or app.current_user_can_manage_project_workspaces(tenant_id, project_id)
);

create or replace function app.current_user_has_fixed_capture_workspace_source(
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

create or replace function app.current_user_has_fixed_review_project_source(
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

create or replace function app.current_user_has_fixed_review_workspace_source(
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

create or replace function app.current_user_can_create_one_off_invites(
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
  select app.current_user_has_fixed_capture_workspace_source(p_tenant_id, p_project_id, p_workspace_id)
    or app.current_user_has_scoped_custom_role_capability(
      p_tenant_id,
      'capture.create_one_off_invites',
      p_project_id,
      p_workspace_id
    );
$$;

create or replace function app.current_user_can_create_recurring_project_consent_requests(
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
  select app.current_user_has_fixed_capture_workspace_source(p_tenant_id, p_project_id, p_workspace_id)
    or app.current_user_has_scoped_custom_role_capability(
      p_tenant_id,
      'capture.create_recurring_project_consent_requests',
      p_project_id,
      p_workspace_id
    );
$$;

create or replace function app.current_user_can_upload_project_assets(
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
  select app.current_user_has_fixed_capture_workspace_source(p_tenant_id, p_project_id, p_workspace_id)
    or app.current_user_has_scoped_custom_role_capability(
      p_tenant_id,
      'capture.upload_assets',
      p_project_id,
      p_workspace_id
    );
$$;

create or replace function app.current_user_can_initiate_consent_upgrade_requests(
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
  select app.current_user_has_fixed_review_workspace_source(p_tenant_id, p_project_id, p_workspace_id)
    or app.current_user_has_scoped_custom_role_capability(
      p_tenant_id,
      'review.initiate_consent_upgrade_requests',
      p_project_id,
      p_workspace_id
    );
$$;

create or replace function app.current_user_can_finalize_project(
  p_tenant_id uuid,
  p_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.current_user_has_fixed_review_project_source(p_tenant_id, p_project_id)
    or app.current_user_has_scoped_custom_role_capability(
      p_tenant_id,
      'workflow.finalize_project',
      p_project_id,
      null
    );
$$;

create or replace function app.current_user_can_start_project_correction(
  p_tenant_id uuid,
  p_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.current_user_has_fixed_review_project_source(p_tenant_id, p_project_id)
    or app.current_user_has_scoped_custom_role_capability(
      p_tenant_id,
      'workflow.start_project_correction',
      p_project_id,
      null
    );
$$;

create or replace function app.current_user_can_reopen_workspace_for_correction(
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
  select app.current_user_has_fixed_review_workspace_source(p_tenant_id, p_project_id, p_workspace_id)
    or app.current_user_has_scoped_custom_role_capability(
      p_tenant_id,
      'workflow.reopen_workspace_for_correction',
      p_project_id,
      p_workspace_id
    );
$$;

create or replace function app.current_user_can_correction_review(
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
  select app.current_user_has_fixed_review_workspace_source(p_tenant_id, p_project_id, p_workspace_id)
    or app.current_user_has_scoped_custom_role_capability(
      p_tenant_id,
      'correction.review',
      p_project_id,
      p_workspace_id
    );
$$;

create or replace function app.current_user_can_correction_consent_intake(
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
  select app.current_user_has_fixed_review_workspace_source(p_tenant_id, p_project_id, p_workspace_id)
    or app.current_user_has_scoped_custom_role_capability(
      p_tenant_id,
      'correction.consent_intake',
      p_project_id,
      p_workspace_id
    );
$$;

create or replace function app.current_user_can_correction_media_intake(
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
  select app.current_user_has_fixed_review_workspace_source(p_tenant_id, p_project_id, p_workspace_id)
    or app.current_user_has_scoped_custom_role_capability(
      p_tenant_id,
      'correction.media_intake',
      p_project_id,
      p_workspace_id
    );
$$;

drop policy if exists "subject_invites_insert_workspace_capture" on public.subject_invites;
drop policy if exists "subject_invites_update_workspace_capture" on public.subject_invites;

create policy "subject_invites_insert_workspace_invite_capability"
on public.subject_invites
for insert
to authenticated
with check (
  (
    coalesce(request_source, 'normal') = 'correction'
    and app.current_user_can_correction_consent_intake(tenant_id, project_id, workspace_id)
  )
  or (
    coalesce(request_source, 'normal') <> 'correction'
    and app.current_user_can_create_one_off_invites(tenant_id, project_id, workspace_id)
  )
);

create policy "subject_invites_update_workspace_invite_capability"
on public.subject_invites
for update
to authenticated
using (
  (
    coalesce(request_source, 'normal') = 'correction'
    and app.current_user_can_correction_consent_intake(tenant_id, project_id, workspace_id)
  )
  or (
    coalesce(request_source, 'normal') <> 'correction'
    and app.current_user_can_create_one_off_invites(tenant_id, project_id, workspace_id)
  )
)
with check (
  (
    coalesce(request_source, 'normal') = 'correction'
    and app.current_user_can_correction_consent_intake(tenant_id, project_id, workspace_id)
  )
  or (
    coalesce(request_source, 'normal') <> 'correction'
    and app.current_user_can_create_one_off_invites(tenant_id, project_id, workspace_id)
  )
);

drop policy if exists "assets_insert_workspace_capture" on public.assets;
drop policy if exists "assets_update_workspace_capture" on public.assets;

create policy "assets_insert_workspace_upload_capability"
on public.assets
for insert
to authenticated
with check (
  app.current_user_can_upload_project_assets(tenant_id, project_id, workspace_id)
  or app.current_user_can_correction_media_intake(tenant_id, project_id, workspace_id)
);

create policy "assets_update_workspace_upload_capability"
on public.assets
for update
to authenticated
using (
  app.current_user_can_upload_project_assets(tenant_id, project_id, workspace_id)
  or app.current_user_can_correction_media_intake(tenant_id, project_id, workspace_id)
)
with check (
  app.current_user_can_upload_project_assets(tenant_id, project_id, workspace_id)
  or app.current_user_can_correction_media_intake(tenant_id, project_id, workspace_id)
);

drop policy if exists "project_profile_participants_insert_workspace_capture" on public.project_profile_participants;

create policy "project_profile_participants_insert_workspace_consent_request_capability"
on public.project_profile_participants
for insert
to authenticated
with check (
  app.current_user_can_create_recurring_project_consent_requests(tenant_id, project_id, workspace_id)
  or app.current_user_can_correction_consent_intake(tenant_id, project_id, workspace_id)
);

drop policy if exists "project_consent_upgrade_requests_insert_workspace_review" on public.project_consent_upgrade_requests;
drop policy if exists "project_consent_upgrade_requests_update_workspace_review" on public.project_consent_upgrade_requests;

create policy "project_consent_upgrade_requests_insert_workspace_upgrade_capability"
on public.project_consent_upgrade_requests
for insert
to authenticated
with check (
  app.current_user_can_initiate_consent_upgrade_requests(tenant_id, project_id, workspace_id)
  or app.current_user_can_correction_consent_intake(tenant_id, project_id, workspace_id)
);

create policy "project_consent_upgrade_requests_update_workspace_upgrade_capability"
on public.project_consent_upgrade_requests
for update
to authenticated
using (
  app.current_user_can_initiate_consent_upgrade_requests(tenant_id, project_id, workspace_id)
  or app.current_user_can_correction_consent_intake(tenant_id, project_id, workspace_id)
)
with check (
  app.current_user_can_initiate_consent_upgrade_requests(tenant_id, project_id, workspace_id)
  or app.current_user_can_correction_consent_intake(tenant_id, project_id, workspace_id)
);

revoke all on function app.current_user_has_any_operational_custom_role_project_access(uuid, uuid) from public;
revoke all on function app.current_user_has_any_operational_custom_role_workspace_access(uuid, uuid, uuid) from public;
revoke all on function app.current_user_has_fixed_capture_workspace_source(uuid, uuid, uuid) from public;
revoke all on function app.current_user_has_fixed_review_project_source(uuid, uuid) from public;
revoke all on function app.current_user_has_fixed_review_workspace_source(uuid, uuid, uuid) from public;
revoke all on function app.current_user_can_create_one_off_invites(uuid, uuid, uuid) from public;
revoke all on function app.current_user_can_create_recurring_project_consent_requests(uuid, uuid, uuid) from public;
revoke all on function app.current_user_can_upload_project_assets(uuid, uuid, uuid) from public;
revoke all on function app.current_user_can_initiate_consent_upgrade_requests(uuid, uuid, uuid) from public;
revoke all on function app.current_user_can_finalize_project(uuid, uuid) from public;
revoke all on function app.current_user_can_start_project_correction(uuid, uuid) from public;
revoke all on function app.current_user_can_reopen_workspace_for_correction(uuid, uuid, uuid) from public;
revoke all on function app.current_user_can_correction_review(uuid, uuid, uuid) from public;
revoke all on function app.current_user_can_correction_consent_intake(uuid, uuid, uuid) from public;
revoke all on function app.current_user_can_correction_media_intake(uuid, uuid, uuid) from public;

grant execute on function app.current_user_has_any_operational_custom_role_project_access(uuid, uuid) to authenticated;
grant execute on function app.current_user_has_any_operational_custom_role_workspace_access(uuid, uuid, uuid) to authenticated;
grant execute on function app.current_user_has_fixed_capture_workspace_source(uuid, uuid, uuid) to authenticated;
grant execute on function app.current_user_has_fixed_review_project_source(uuid, uuid) to authenticated;
grant execute on function app.current_user_has_fixed_review_workspace_source(uuid, uuid, uuid) to authenticated;
grant execute on function app.current_user_can_access_project(uuid, uuid) to authenticated;
grant execute on function app.current_user_can_access_project_workspace(uuid, uuid, uuid) to authenticated;
grant execute on function app.current_user_can_capture_project(uuid, uuid) to authenticated;
grant execute on function app.current_user_can_capture_project_workspace(uuid, uuid, uuid) to authenticated;
grant execute on function app.current_user_can_review_project(uuid, uuid) to authenticated;
grant execute on function app.current_user_can_review_project_workspace(uuid, uuid, uuid) to authenticated;
grant execute on function app.current_user_can_create_one_off_invites(uuid, uuid, uuid) to authenticated;
grant execute on function app.current_user_can_create_recurring_project_consent_requests(uuid, uuid, uuid) to authenticated;
grant execute on function app.current_user_can_upload_project_assets(uuid, uuid, uuid) to authenticated;
grant execute on function app.current_user_can_initiate_consent_upgrade_requests(uuid, uuid, uuid) to authenticated;
grant execute on function app.current_user_can_finalize_project(uuid, uuid) to authenticated;
grant execute on function app.current_user_can_start_project_correction(uuid, uuid) to authenticated;
grant execute on function app.current_user_can_reopen_workspace_for_correction(uuid, uuid, uuid) to authenticated;
grant execute on function app.current_user_can_correction_review(uuid, uuid, uuid) to authenticated;
grant execute on function app.current_user_can_correction_consent_intake(uuid, uuid, uuid) to authenticated;
grant execute on function app.current_user_can_correction_media_intake(uuid, uuid, uuid) to authenticated;
