create table if not exists public.project_releases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  release_version integer not null,
  status text not null default 'building',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  source_project_finalized_at timestamptz not null,
  source_project_finalized_by uuid not null references auth.users(id) on delete restrict,
  snapshot_created_at timestamptz null,
  project_snapshot jsonb not null,
  constraint project_releases_project_scope_fk
    foreign key (project_id, tenant_id)
    references public.projects(id, tenant_id)
    on delete restrict,
  constraint project_releases_id_tenant_project_unique
    unique (id, tenant_id, project_id),
  constraint project_releases_version_unique
    unique (tenant_id, project_id, release_version),
  constraint project_releases_finalized_at_unique
    unique (tenant_id, project_id, source_project_finalized_at),
  constraint project_releases_version_check
    check (release_version >= 1),
  constraint project_releases_status_check
    check (status in ('building', 'published')),
  constraint project_releases_snapshot_shape_check
    check (jsonb_typeof(project_snapshot) = 'object'),
  constraint project_releases_snapshot_published_check
    check (
      (status = 'building' and snapshot_created_at is null)
      or (status = 'published' and snapshot_created_at is not null)
    )
);

create index if not exists project_releases_tenant_project_created_at_idx
  on public.project_releases (tenant_id, project_id, created_at desc);

create index if not exists project_releases_tenant_created_at_idx
  on public.project_releases (tenant_id, created_at desc);

create index if not exists project_releases_tenant_project_finalized_at_idx
  on public.project_releases (tenant_id, project_id, source_project_finalized_at desc);

create table if not exists public.project_release_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  release_id uuid not null,
  project_id uuid not null,
  workspace_id uuid not null,
  source_asset_id uuid not null,
  asset_type text not null,
  original_filename text not null,
  original_storage_bucket text not null,
  original_storage_path text not null,
  content_type text null,
  file_size_bytes bigint not null,
  uploaded_at timestamptz null,
  created_at timestamptz not null default now(),
  asset_metadata_snapshot jsonb not null,
  workspace_snapshot jsonb not null,
  consent_snapshot jsonb not null,
  link_snapshot jsonb not null,
  review_snapshot jsonb not null,
  scope_snapshot jsonb not null,
  constraint project_release_assets_release_scope_fk
    foreign key (release_id, tenant_id, project_id)
    references public.project_releases(id, tenant_id, project_id)
    on delete restrict,
  constraint project_release_assets_project_scope_fk
    foreign key (project_id, tenant_id)
    references public.projects(id, tenant_id)
    on delete restrict,
  constraint project_release_assets_workspace_scope_fk
    foreign key (workspace_id, tenant_id, project_id)
    references public.project_workspaces(id, tenant_id, project_id)
    on delete restrict,
  constraint project_release_assets_source_asset_scope_fk
    foreign key (source_asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete restrict,
  constraint project_release_assets_release_asset_unique
    unique (release_id, source_asset_id),
  constraint project_release_assets_asset_type_check
    check (asset_type in ('photo', 'video')),
  constraint project_release_assets_file_size_check
    check (file_size_bytes > 0),
  constraint project_release_assets_metadata_shape_check
    check (
      jsonb_typeof(asset_metadata_snapshot) = 'object'
      and jsonb_typeof(workspace_snapshot) = 'object'
      and jsonb_typeof(consent_snapshot) = 'object'
      and jsonb_typeof(link_snapshot) = 'object'
      and jsonb_typeof(review_snapshot) = 'object'
      and jsonb_typeof(scope_snapshot) = 'object'
    )
);

create index if not exists project_release_assets_tenant_release_created_at_idx
  on public.project_release_assets (tenant_id, release_id, created_at desc);

create index if not exists project_release_assets_tenant_project_workspace_created_at_idx
  on public.project_release_assets (tenant_id, project_id, workspace_id, created_at desc);

create index if not exists project_release_assets_tenant_asset_type_created_at_idx
  on public.project_release_assets (tenant_id, asset_type, created_at desc);

create index if not exists project_release_assets_tenant_source_asset_idx
  on public.project_release_assets (tenant_id, source_asset_id);

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
      and m.role in ('owner', 'admin', 'reviewer')
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

alter table public.project_releases enable row level security;
alter table public.project_release_assets enable row level security;

grant select on table public.project_releases to authenticated;
grant select on table public.project_release_assets to authenticated;
grant select, insert, update, delete on table public.project_releases to service_role;
grant select, insert, update, delete on table public.project_release_assets to service_role;

drop policy if exists "project_releases_select_media_library" on public.project_releases;
create policy "project_releases_select_media_library"
on public.project_releases
for select
to authenticated
using (
  app.current_user_can_access_media_library(tenant_id)
);

drop policy if exists "project_release_assets_select_media_library" on public.project_release_assets;
create policy "project_release_assets_select_media_library"
on public.project_release_assets
for select
to authenticated
using (
  app.current_user_can_access_media_library(tenant_id)
);

revoke all on function app.current_user_can_access_media_library(uuid) from public;
revoke all on function public.current_user_can_access_media_library(uuid) from public;

grant execute on function app.current_user_can_access_media_library(uuid) to authenticated;
grant execute on function public.current_user_can_access_media_library(uuid) to authenticated;
