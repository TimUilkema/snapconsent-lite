create table if not exists public.asset_consent_face_compare_scores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  asset_id uuid not null,
  consent_id uuid not null,
  headshot_materialization_id uuid not null,
  asset_materialization_id uuid not null,
  asset_face_id uuid not null,
  asset_face_rank integer not null check (asset_face_rank >= 0),
  similarity numeric(5,4) not null check (similarity >= 0 and similarity <= 1),
  compare_version text not null,
  provider text not null,
  provider_mode text not null,
  provider_plugin_versions jsonb,
  compared_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint asset_consent_face_compare_scores_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_consent_face_compare_scores_consent_scope_fk
    foreign key (consent_id, tenant_id, project_id)
    references public.consents(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_consent_face_compare_scores_headshot_materialization_fk
    foreign key (headshot_materialization_id)
    references public.asset_face_materializations(id)
    on delete cascade,
  constraint asset_consent_face_compare_scores_asset_materialization_fk
    foreign key (asset_materialization_id)
    references public.asset_face_materializations(id)
    on delete cascade,
  constraint asset_consent_face_compare_scores_asset_face_fk
    foreign key (asset_face_id)
    references public.asset_face_materialization_faces(id)
    on delete cascade,
  constraint asset_consent_face_compare_scores_versioned_face_key
    unique (
      tenant_id,
      project_id,
      consent_id,
      asset_id,
      headshot_materialization_id,
      asset_materialization_id,
      asset_face_id,
      compare_version
    )
);

create index if not exists asset_consent_face_compare_scores_asset_face_idx
  on public.asset_consent_face_compare_scores (
    tenant_id,
    project_id,
    asset_id,
    asset_materialization_id,
    asset_face_id,
    compare_version,
    compared_at desc
  );

create index if not exists asset_consent_face_compare_scores_consent_idx
  on public.asset_consent_face_compare_scores (
    tenant_id,
    project_id,
    consent_id,
    compared_at desc
  );

alter table public.asset_consent_face_compare_scores enable row level security;

revoke all on table public.asset_consent_face_compare_scores from public;
revoke all on table public.asset_consent_face_compare_scores from anon;
revoke all on table public.asset_consent_face_compare_scores from authenticated;

grant select, insert, update, delete on table public.asset_consent_face_compare_scores to service_role;
