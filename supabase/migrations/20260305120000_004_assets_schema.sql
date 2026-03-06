alter table public.consents
  add constraint consents_id_tenant_project_key unique (id, tenant_id, project_id);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  storage_bucket text not null,
  storage_path text not null,
  original_filename text not null,
  content_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  status text not null default 'pending' check (status in ('pending', 'uploaded', 'archived')),
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  archived_at timestamptz,
  unique (id, tenant_id, project_id),
  unique (tenant_id, project_id, storage_path),
  foreign key (project_id, tenant_id) references public.projects(id, tenant_id) on delete restrict
);

create index if not exists assets_tenant_project_created_at_idx
  on public.assets (tenant_id, project_id, created_at desc);

create table if not exists public.asset_consent_links (
  asset_id uuid not null,
  consent_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (asset_id, consent_id),
  foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete restrict,
  foreign key (consent_id, tenant_id, project_id)
    references public.consents(id, tenant_id, project_id)
    on delete restrict
);

create index if not exists asset_consent_links_tenant_project_idx
  on public.asset_consent_links (tenant_id, project_id);
