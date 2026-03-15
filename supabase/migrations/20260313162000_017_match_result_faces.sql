create table if not exists public.asset_consent_match_result_faces (
  job_id uuid not null,
  asset_id uuid not null,
  consent_id uuid not null,
  face_rank integer not null,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  similarity numeric(5,4) not null,
  source_face_box jsonb,
  target_face_box jsonb,
  source_embedding jsonb,
  target_embedding jsonb,
  provider text not null,
  provider_mode text not null,
  provider_face_index integer,
  provider_plugin_versions jsonb,
  matcher_version text,
  scored_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint asset_consent_match_result_faces_pkey
    primary key (job_id, asset_id, consent_id, face_rank),
  constraint asset_consent_match_result_faces_similarity_check
    check (similarity >= 0 and similarity <= 1),
  constraint asset_consent_match_result_faces_face_rank_check
    check (face_rank >= 0),
  constraint asset_consent_match_result_faces_parent_fk
    foreign key (job_id, asset_id, consent_id)
    references public.asset_consent_match_results(job_id, asset_id, consent_id)
    on delete cascade,
  constraint asset_consent_match_result_faces_job_fk
    foreign key (job_id)
    references public.face_match_jobs(id)
    on delete cascade,
  constraint asset_consent_match_result_faces_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_consent_match_result_faces_consent_scope_fk
    foreign key (consent_id, tenant_id, project_id)
    references public.consents(id, tenant_id, project_id)
    on delete cascade
);

create index if not exists ac_match_result_faces_tenant_project_scored_idx
  on public.asset_consent_match_result_faces (tenant_id, project_id, scored_at desc);

create index if not exists ac_match_result_faces_tenant_project_consent_scored_idx
  on public.asset_consent_match_result_faces (tenant_id, project_id, consent_id, scored_at desc);

create index if not exists ac_match_result_faces_tenant_project_asset_scored_idx
  on public.asset_consent_match_result_faces (tenant_id, project_id, asset_id, scored_at desc);

create index if not exists ac_match_result_faces_tenant_project_job_idx
  on public.asset_consent_match_result_faces (tenant_id, project_id, job_id);

alter table public.asset_consent_match_result_faces enable row level security;

revoke all on table public.asset_consent_match_result_faces from public;
revoke all on table public.asset_consent_match_result_faces from anon;
revoke all on table public.asset_consent_match_result_faces from authenticated;

grant select, insert, update, delete on table public.asset_consent_match_result_faces to service_role;
