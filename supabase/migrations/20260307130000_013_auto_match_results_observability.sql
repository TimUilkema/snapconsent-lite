create table if not exists public.asset_consent_match_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  asset_id uuid not null,
  consent_id uuid not null,
  job_id uuid not null references public.face_match_jobs(id) on delete cascade,
  job_type text not null,
  confidence numeric(5,4) not null,
  decision text not null,
  matcher_version text,
  auto_threshold numeric(5,4) not null,
  review_min_confidence numeric(5,4) not null,
  scored_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint asset_consent_match_results_job_asset_consent_key
    unique (job_id, asset_id, consent_id),
  constraint asset_consent_match_results_job_type_check
    check (job_type in ('photo_uploaded', 'consent_headshot_ready', 'reconcile_project')),
  constraint asset_consent_match_results_confidence_check
    check (confidence >= 0 and confidence <= 1),
  constraint asset_consent_match_results_auto_threshold_check
    check (auto_threshold >= 0 and auto_threshold <= 1),
  constraint asset_consent_match_results_review_min_confidence_check
    check (review_min_confidence >= 0 and review_min_confidence <= 1),
  constraint asset_consent_match_results_decision_check
    check (
      decision in (
        'auto_link_upserted',
        'candidate_upserted',
        'below_review_band',
        'skipped_manual',
        'skipped_suppressed'
      )
    ),
  constraint asset_consent_match_results_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_consent_match_results_consent_scope_fk
    foreign key (consent_id, tenant_id, project_id)
    references public.consents(id, tenant_id, project_id)
    on delete cascade
);

create index if not exists asset_consent_match_results_tenant_project_scored_idx
  on public.asset_consent_match_results (tenant_id, project_id, scored_at desc);

create index if not exists asset_consent_match_results_tenant_project_job_idx
  on public.asset_consent_match_results (tenant_id, project_id, job_id);

create index if not exists asset_consent_match_results_tenant_project_consent_scored_idx
  on public.asset_consent_match_results (tenant_id, project_id, consent_id, scored_at desc);

alter table public.asset_consent_match_results enable row level security;

revoke all on table public.asset_consent_match_results from public;
revoke all on table public.asset_consent_match_results from anon;
revoke all on table public.asset_consent_match_results from authenticated;

grant select, insert, update, delete on table public.asset_consent_match_results to service_role;
