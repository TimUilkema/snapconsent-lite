create table if not exists public.asset_face_assignee_link_suppressions (
  asset_face_id uuid not null
    references public.asset_face_materialization_faces(id) on delete cascade,
  asset_materialization_id uuid not null
    references public.asset_face_materializations(id) on delete cascade,
  asset_id uuid not null,
  project_face_assignee_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  reason text not null default 'manual_unlink',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint asset_face_assignee_link_suppressions_pkey
    primary key (asset_face_id, project_face_assignee_id),
  constraint asset_face_assignee_link_suppressions_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_face_assignee_link_suppressions_assignee_scope_fk
    foreign key (project_face_assignee_id, tenant_id)
    references public.project_face_assignees(id, tenant_id)
    on delete restrict,
  constraint asset_face_assignee_link_suppressions_reason_check
    check (reason in ('manual_unlink', 'manual_replace'))
);

create index if not exists asset_face_assignee_link_suppressions_tenant_project_assignee_idx
  on public.asset_face_assignee_link_suppressions (tenant_id, project_id, project_face_assignee_id);

create index if not exists asset_face_assignee_link_suppressions_tenant_project_asset_idx
  on public.asset_face_assignee_link_suppressions (tenant_id, project_id, asset_id);

insert into public.project_face_assignees (
  tenant_id,
  project_id,
  assignee_kind,
  consent_id
)
select distinct
  suppressions.tenant_id,
  suppressions.project_id,
  'project_consent',
  suppressions.consent_id
from public.asset_face_consent_link_suppressions suppressions
where suppressions.consent_id is not null
on conflict (tenant_id, project_id, consent_id) do nothing;

insert into public.asset_face_assignee_link_suppressions (
  asset_face_id,
  asset_materialization_id,
  asset_id,
  project_face_assignee_id,
  tenant_id,
  project_id,
  reason,
  created_at,
  created_by
)
select
  suppressions.asset_face_id,
  suppressions.asset_materialization_id,
  suppressions.asset_id,
  assignees.id,
  suppressions.tenant_id,
  suppressions.project_id,
  suppressions.reason,
  suppressions.created_at,
  suppressions.created_by
from public.asset_face_consent_link_suppressions suppressions
join public.project_face_assignees assignees
  on assignees.tenant_id = suppressions.tenant_id
 and assignees.project_id = suppressions.project_id
 and assignees.assignee_kind = 'project_consent'
 and assignees.consent_id = suppressions.consent_id
on conflict (asset_face_id, project_face_assignee_id) do update
set
  asset_materialization_id = excluded.asset_materialization_id,
  asset_id = excluded.asset_id,
  reason = excluded.reason,
  created_at = excluded.created_at,
  created_by = excluded.created_by;

alter table public.asset_face_assignee_link_suppressions enable row level security;

revoke all on table public.asset_face_assignee_link_suppressions from public;
revoke all on table public.asset_face_assignee_link_suppressions from anon;
revoke all on table public.asset_face_assignee_link_suppressions from authenticated;

grant select, insert, update, delete on table public.asset_face_assignee_link_suppressions to authenticated;
grant select, insert, update, delete on table public.asset_face_assignee_link_suppressions to service_role;

create policy "asset_face_assignee_link_suppressions_select_member"
on public.asset_face_assignee_link_suppressions
for select
to authenticated
using (
  app.current_user_can_access_project(tenant_id, project_id)
);

create policy "asset_face_assignee_link_suppressions_insert_member"
on public.asset_face_assignee_link_suppressions
for insert
to authenticated
with check (
  app.current_user_can_access_project(tenant_id, project_id)
);

create policy "asset_face_assignee_link_suppressions_update_member"
on public.asset_face_assignee_link_suppressions
for update
to authenticated
using (
  app.current_user_can_access_project(tenant_id, project_id)
)
with check (
  app.current_user_can_access_project(tenant_id, project_id)
);

create policy "asset_face_assignee_link_suppressions_delete_member"
on public.asset_face_assignee_link_suppressions
for delete
to authenticated
using (
  app.current_user_can_access_project(tenant_id, project_id)
);

alter table public.asset_face_consent_links
  drop constraint if exists asset_face_consent_links_auto_link_requires_consent_check;
