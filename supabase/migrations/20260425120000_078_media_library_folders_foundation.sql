create table if not exists public.media_library_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  source_asset_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  constraint media_library_assets_project_scope_fk
    foreign key (project_id, tenant_id)
    references public.projects(id, tenant_id)
    on delete restrict,
  constraint media_library_assets_source_asset_scope_fk
    foreign key (source_asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete restrict,
  constraint media_library_assets_id_tenant_unique
    unique (id, tenant_id),
  constraint media_library_assets_lineage_unique
    unique (tenant_id, project_id, source_asset_id)
);

create index if not exists media_library_assets_tenant_project_idx
  on public.media_library_assets (tenant_id, project_id, created_at desc);

create index if not exists media_library_assets_tenant_source_asset_idx
  on public.media_library_assets (tenant_id, source_asset_id);

create table if not exists public.media_library_folders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  archived_at timestamptz null,
  archived_by uuid null references auth.users(id) on delete restrict,
  constraint media_library_folders_id_tenant_unique
    unique (id, tenant_id),
  constraint media_library_folders_name_not_blank
    check (btrim(name) <> ''),
  constraint media_library_folders_archive_shape_check
    check (
      (archived_at is null and archived_by is null)
      or (archived_at is not null and archived_by is not null)
    )
);

create unique index if not exists media_library_folders_tenant_active_name_unique_idx
  on public.media_library_folders (tenant_id, lower(btrim(name)))
  where archived_at is null;

create index if not exists media_library_folders_tenant_active_idx
  on public.media_library_folders (tenant_id, updated_at desc)
  where archived_at is null;

create table if not exists public.media_library_folder_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  media_library_asset_id uuid not null,
  folder_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  constraint media_library_folder_memberships_asset_scope_fk
    foreign key (media_library_asset_id, tenant_id)
    references public.media_library_assets(id, tenant_id)
    on delete restrict,
  constraint media_library_folder_memberships_folder_scope_fk
    foreign key (folder_id, tenant_id)
    references public.media_library_folders(id, tenant_id)
    on delete restrict,
  constraint media_library_folder_memberships_unique_asset
    unique (tenant_id, media_library_asset_id)
);

create index if not exists media_library_folder_memberships_tenant_folder_idx
  on public.media_library_folder_memberships (tenant_id, folder_id, updated_at desc);

create index if not exists media_library_folder_memberships_tenant_asset_idx
  on public.media_library_folder_memberships (tenant_id, media_library_asset_id);

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
      and m.role in ('owner', 'admin', 'reviewer')
  );
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

alter table public.media_library_assets enable row level security;
alter table public.media_library_folders enable row level security;
alter table public.media_library_folder_memberships enable row level security;

grant select on table public.media_library_assets to authenticated;
grant select, insert, update, delete on table public.media_library_assets to service_role;

grant select, insert, update, delete on table public.media_library_folders to authenticated;
grant select, insert, update, delete on table public.media_library_folders to service_role;

grant select, insert, update, delete on table public.media_library_folder_memberships to authenticated;
grant select, insert, update, delete on table public.media_library_folder_memberships to service_role;

drop policy if exists "media_library_assets_select_media_library" on public.media_library_assets;
create policy "media_library_assets_select_media_library"
on public.media_library_assets
for select
to authenticated
using (
  app.current_user_can_access_media_library(tenant_id)
);

drop policy if exists "media_library_folders_select_media_library" on public.media_library_folders;
create policy "media_library_folders_select_media_library"
on public.media_library_folders
for select
to authenticated
using (
  app.current_user_can_access_media_library(tenant_id)
);

drop policy if exists "media_library_folders_insert_media_library" on public.media_library_folders;
create policy "media_library_folders_insert_media_library"
on public.media_library_folders
for insert
to authenticated
with check (
  app.current_user_can_manage_media_library(tenant_id)
  and created_by = auth.uid()
  and updated_by = auth.uid()
  and archived_at is null
  and archived_by is null
);

drop policy if exists "media_library_folders_update_media_library" on public.media_library_folders;
create policy "media_library_folders_update_media_library"
on public.media_library_folders
for update
to authenticated
using (
  app.current_user_can_manage_media_library(tenant_id)
)
with check (
  app.current_user_can_manage_media_library(tenant_id)
  and updated_by = auth.uid()
  and (archived_by is null or archived_by = auth.uid())
);

drop policy if exists "media_library_folders_delete_media_library" on public.media_library_folders;
create policy "media_library_folders_delete_media_library"
on public.media_library_folders
for delete
to authenticated
using (
  app.current_user_can_manage_media_library(tenant_id)
);

drop policy if exists "media_library_folder_memberships_select_media_library" on public.media_library_folder_memberships;
create policy "media_library_folder_memberships_select_media_library"
on public.media_library_folder_memberships
for select
to authenticated
using (
  app.current_user_can_access_media_library(tenant_id)
);

drop policy if exists "media_library_folder_memberships_insert_media_library" on public.media_library_folder_memberships;
create policy "media_library_folder_memberships_insert_media_library"
on public.media_library_folder_memberships
for insert
to authenticated
with check (
  app.current_user_can_manage_media_library(tenant_id)
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

drop policy if exists "media_library_folder_memberships_update_media_library" on public.media_library_folder_memberships;
create policy "media_library_folder_memberships_update_media_library"
on public.media_library_folder_memberships
for update
to authenticated
using (
  app.current_user_can_manage_media_library(tenant_id)
)
with check (
  app.current_user_can_manage_media_library(tenant_id)
  and updated_by = auth.uid()
);

drop policy if exists "media_library_folder_memberships_delete_media_library" on public.media_library_folder_memberships;
create policy "media_library_folder_memberships_delete_media_library"
on public.media_library_folder_memberships
for delete
to authenticated
using (
  app.current_user_can_manage_media_library(tenant_id)
);

revoke all on function app.current_user_can_manage_media_library(uuid) from public;
revoke all on function public.current_user_can_manage_media_library(uuid) from public;

grant execute on function app.current_user_can_manage_media_library(uuid) to authenticated;
grant execute on function public.current_user_can_manage_media_library(uuid) to authenticated;
