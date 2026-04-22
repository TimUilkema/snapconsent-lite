create table if not exists public.asset_assignee_links (
  asset_id uuid not null,
  project_face_assignee_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  link_source text not null default 'manual',
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint asset_assignee_links_pkey primary key (asset_id, project_face_assignee_id),
  constraint asset_assignee_links_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_assignee_links_assignee_scope_fk
    foreign key (project_face_assignee_id, tenant_id)
    references public.project_face_assignees(id, tenant_id)
    on delete restrict,
  constraint asset_assignee_links_link_source_check
    check (link_source in ('manual'))
);

create index if not exists asset_assignee_links_tenant_project_asset_idx
  on public.asset_assignee_links (tenant_id, project_id, asset_id);

create index if not exists asset_assignee_links_tenant_project_assignee_idx
  on public.asset_assignee_links (tenant_id, project_id, project_face_assignee_id);

insert into public.project_face_assignees (
  tenant_id,
  project_id,
  assignee_kind,
  consent_id
)
select distinct
  fallbacks.tenant_id,
  fallbacks.project_id,
  'project_consent',
  fallbacks.consent_id
from public.asset_consent_manual_photo_fallbacks fallbacks
where fallbacks.consent_id is not null
on conflict (tenant_id, project_id, consent_id) do nothing;

insert into public.asset_assignee_links (
  asset_id,
  project_face_assignee_id,
  tenant_id,
  project_id,
  link_source,
  created_at,
  created_by,
  updated_at
)
select
  fallbacks.asset_id,
  assignees.id,
  fallbacks.tenant_id,
  fallbacks.project_id,
  'manual',
  fallbacks.created_at,
  fallbacks.created_by,
  fallbacks.updated_at
from public.asset_consent_manual_photo_fallbacks fallbacks
join public.project_face_assignees assignees
  on assignees.tenant_id = fallbacks.tenant_id
 and assignees.project_id = fallbacks.project_id
 and assignees.assignee_kind = 'project_consent'
 and assignees.consent_id = fallbacks.consent_id
on conflict (asset_id, project_face_assignee_id) do update
set
  created_at = excluded.created_at,
  created_by = excluded.created_by,
  updated_at = excluded.updated_at;

alter table public.asset_assignee_links enable row level security;

revoke all on table public.asset_assignee_links from public;
revoke all on table public.asset_assignee_links from anon;
revoke all on table public.asset_assignee_links from authenticated;

grant select, insert, update, delete on table public.asset_assignee_links to authenticated;
grant select, insert, update, delete on table public.asset_assignee_links to service_role;

create policy "asset_assignee_links_select_member"
on public.asset_assignee_links
for select
to authenticated
using (
  app.current_user_can_access_project(tenant_id, project_id)
);

create policy "asset_assignee_links_insert_member"
on public.asset_assignee_links
for insert
to authenticated
with check (
  app.current_user_can_access_project(tenant_id, project_id)
);

create policy "asset_assignee_links_update_member"
on public.asset_assignee_links
for update
to authenticated
using (
  app.current_user_can_access_project(tenant_id, project_id)
)
with check (
  app.current_user_can_access_project(tenant_id, project_id)
);

create policy "asset_assignee_links_delete_member"
on public.asset_assignee_links
for delete
to authenticated
using (
  app.current_user_can_access_project(tenant_id, project_id)
);
