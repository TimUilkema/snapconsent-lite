-- 005 assets content hash

alter table public.assets
  add column if not exists content_hash text,
  add column if not exists content_hash_algo text default 'sha256';

create index if not exists assets_tenant_project_content_hash_idx
  on public.assets (tenant_id, project_id, content_hash);