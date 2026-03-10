create table if not exists public.asset_consent_match_candidates (
  asset_id uuid not null,
  consent_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  confidence numeric(5,4) not null,
  matcher_version text,
  source_job_type text,
  last_scored_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_consent_match_candidates_pkey primary key (asset_id, consent_id),
  constraint asset_consent_match_candidates_confidence_check
    check (confidence >= 0 and confidence <= 1),
  constraint asset_consent_match_candidates_source_job_type_check
    check (
      source_job_type is null
      or source_job_type in ('photo_uploaded', 'consent_headshot_ready', 'reconcile_project')
    ),
  constraint asset_consent_match_candidates_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_consent_match_candidates_consent_scope_fk
    foreign key (consent_id, tenant_id, project_id)
    references public.consents(id, tenant_id, project_id)
    on delete cascade
);

create index if not exists asset_consent_match_candidates_tenant_project_consent_confidence_idx
  on public.asset_consent_match_candidates (tenant_id, project_id, consent_id, confidence desc);

create index if not exists asset_consent_match_candidates_tenant_project_asset_idx
  on public.asset_consent_match_candidates (tenant_id, project_id, asset_id);

create index if not exists asset_consent_match_candidates_tenant_project_updated_idx
  on public.asset_consent_match_candidates (tenant_id, project_id, updated_at desc);

alter table public.asset_consent_match_candidates enable row level security;

create policy "asset_consent_match_candidates_select_member"
on public.asset_consent_match_candidates
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_match_candidates.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_consent_match_candidates_insert_member"
on public.asset_consent_match_candidates
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_match_candidates.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_consent_match_candidates_update_member"
on public.asset_consent_match_candidates
for update
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_match_candidates.tenant_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_match_candidates.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_consent_match_candidates_delete_member"
on public.asset_consent_match_candidates
for delete
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_match_candidates.tenant_id
      and m.user_id = auth.uid()
  )
);
