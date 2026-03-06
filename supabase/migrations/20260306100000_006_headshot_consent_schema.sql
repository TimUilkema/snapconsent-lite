alter table public.consents
  add column if not exists face_match_opt_in boolean not null default false;

alter table public.assets
  add column if not exists asset_type text not null default 'photo',
  add column if not exists retention_expires_at timestamptz;

alter table public.assets
  drop constraint if exists assets_asset_type_check;

alter table public.assets
  add constraint assets_asset_type_check
  check (asset_type in ('photo', 'headshot'));

create index if not exists assets_tenant_project_type_status_idx
  on public.assets (tenant_id, project_id, asset_type, status);

create index if not exists assets_headshot_retention_idx
  on public.assets (asset_type, retention_expires_at)
  where asset_type = 'headshot' and retention_expires_at is not null;
