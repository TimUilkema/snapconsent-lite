alter table public.face_match_jobs
  drop constraint if exists face_match_jobs_job_type_check,
  drop constraint if exists face_match_jobs_scope_by_job_type_check;

alter table public.face_match_jobs
  add constraint face_match_jobs_job_type_check
    check (
      job_type in (
        'photo_uploaded',
        'consent_headshot_ready',
        'reconcile_project',
        'materialize_asset_faces',
        'compare_materialized_pair'
      )
    ),
  add constraint face_match_jobs_scope_by_job_type_check
    check (
      (job_type = 'photo_uploaded' and scope_asset_id is not null and scope_consent_id is null)
      or (job_type = 'consent_headshot_ready' and scope_consent_id is not null and scope_asset_id is null)
      or (job_type = 'reconcile_project' and scope_asset_id is null and scope_consent_id is null)
      or (job_type = 'materialize_asset_faces' and scope_asset_id is not null and scope_consent_id is null)
      or (job_type = 'compare_materialized_pair' and scope_asset_id is not null and scope_consent_id is not null)
    );

alter table public.asset_consent_match_candidates
  drop constraint if exists asset_consent_match_candidates_source_job_type_check;

alter table public.asset_consent_match_candidates
  add constraint asset_consent_match_candidates_source_job_type_check
    check (
      source_job_type is null
      or source_job_type in (
        'photo_uploaded',
        'consent_headshot_ready',
        'reconcile_project',
        'compare_materialized_pair'
      )
    );

alter table public.asset_consent_match_results
  drop constraint if exists asset_consent_match_results_job_type_check;

alter table public.asset_consent_match_results
  add constraint asset_consent_match_results_job_type_check
    check (
      job_type in (
        'photo_uploaded',
        'consent_headshot_ready',
        'reconcile_project',
        'compare_materialized_pair'
      )
    );

create table if not exists public.asset_face_materializations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  asset_id uuid not null,
  asset_type text not null check (asset_type in ('photo', 'headshot')),
  source_content_hash text,
  source_content_hash_algo text,
  source_uploaded_at timestamptz,
  materializer_version text not null,
  provider text not null,
  provider_mode text not null,
  provider_plugin_versions jsonb,
  face_count integer not null check (face_count >= 0),
  usable_for_compare boolean not null default false,
  unusable_reason text,
  materialized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint asset_face_materializations_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_face_materializations_project_scope_fk
    foreign key (project_id, tenant_id)
    references public.projects(id, tenant_id)
    on delete restrict,
  constraint asset_face_materializations_asset_version_key
    unique (tenant_id, project_id, asset_id, materializer_version)
);

create index if not exists asset_face_materializations_tenant_project_asset_idx
  on public.asset_face_materializations (tenant_id, project_id, asset_id, created_at desc);

create index if not exists asset_face_materializations_tenant_project_type_idx
  on public.asset_face_materializations (tenant_id, project_id, asset_type, created_at desc);

create table if not exists public.asset_face_materialization_faces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  asset_id uuid not null,
  materialization_id uuid not null,
  face_rank integer not null check (face_rank >= 0),
  provider_face_index integer,
  detection_probability numeric(5,4) check (detection_probability is null or (detection_probability >= 0 and detection_probability <= 1)),
  face_box jsonb not null,
  embedding jsonb not null,
  created_at timestamptz not null default now(),
  constraint asset_face_materialization_faces_materialization_fk
    foreign key (materialization_id)
    references public.asset_face_materializations(id)
    on delete cascade,
  constraint asset_face_materialization_faces_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_face_materialization_faces_unique_rank
    unique (materialization_id, face_rank)
);

create index if not exists asset_face_materialization_faces_tenant_project_asset_idx
  on public.asset_face_materialization_faces (tenant_id, project_id, asset_id, created_at desc);

create index if not exists asset_face_materialization_faces_materialization_idx
  on public.asset_face_materialization_faces (materialization_id, face_rank);

create table if not exists public.asset_consent_face_compares (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  asset_id uuid not null,
  consent_id uuid not null,
  headshot_materialization_id uuid not null,
  asset_materialization_id uuid not null,
  headshot_face_id uuid,
  winning_asset_face_id uuid,
  winning_asset_face_rank integer,
  winning_similarity numeric(5,4) not null check (winning_similarity >= 0 and winning_similarity <= 1),
  compare_status text not null check (
    compare_status in (
      'matched',
      'source_unusable',
      'target_empty',
      'no_match'
    )
  ),
  compare_version text not null,
  provider text not null,
  provider_mode text not null,
  provider_plugin_versions jsonb,
  target_face_count integer not null check (target_face_count >= 0),
  compared_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint asset_consent_face_compares_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_consent_face_compares_consent_scope_fk
    foreign key (consent_id, tenant_id, project_id)
    references public.consents(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_consent_face_compares_headshot_materialization_fk
    foreign key (headshot_materialization_id)
    references public.asset_face_materializations(id)
    on delete cascade,
  constraint asset_consent_face_compares_asset_materialization_fk
    foreign key (asset_materialization_id)
    references public.asset_face_materializations(id)
    on delete cascade,
  constraint asset_consent_face_compares_headshot_face_fk
    foreign key (headshot_face_id)
    references public.asset_face_materialization_faces(id)
    on delete set null,
  constraint asset_consent_face_compares_winning_asset_face_fk
    foreign key (winning_asset_face_id)
    references public.asset_face_materialization_faces(id)
    on delete set null,
  constraint asset_consent_face_compares_winning_face_rank_check
    check (winning_asset_face_rank is null or winning_asset_face_rank >= 0),
  constraint asset_consent_face_compares_versioned_pair_key
    unique (
      tenant_id,
      project_id,
      consent_id,
      asset_id,
      headshot_materialization_id,
      asset_materialization_id,
      compare_version
    )
);

create index if not exists asset_consent_face_compares_tenant_project_asset_idx
  on public.asset_consent_face_compares (tenant_id, project_id, asset_id, compared_at desc);

create index if not exists asset_consent_face_compares_tenant_project_consent_idx
  on public.asset_consent_face_compares (tenant_id, project_id, consent_id, compared_at desc);

create index if not exists asset_consent_face_compares_winning_face_idx
  on public.asset_consent_face_compares (tenant_id, project_id, winning_asset_face_id, compared_at desc);

alter table public.asset_face_materializations enable row level security;
alter table public.asset_face_materialization_faces enable row level security;
alter table public.asset_consent_face_compares enable row level security;

revoke all on table public.asset_face_materializations from public;
revoke all on table public.asset_face_materializations from anon;
revoke all on table public.asset_face_materializations from authenticated;
revoke all on table public.asset_face_materialization_faces from public;
revoke all on table public.asset_face_materialization_faces from anon;
revoke all on table public.asset_face_materialization_faces from authenticated;
revoke all on table public.asset_consent_face_compares from public;
revoke all on table public.asset_consent_face_compares from anon;
revoke all on table public.asset_consent_face_compares from authenticated;

grant select, insert, update, delete on table public.asset_face_materializations to service_role;
grant select, insert, update, delete on table public.asset_face_materialization_faces to service_role;
grant select, insert, update, delete on table public.asset_consent_face_compares to service_role;
