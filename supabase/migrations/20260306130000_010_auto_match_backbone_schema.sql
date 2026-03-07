alter table public.asset_consent_links
  add column if not exists link_source text not null default 'manual',
  add column if not exists match_confidence numeric(5,4),
  add column if not exists matched_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists matcher_version text;

alter table public.asset_consent_links
  drop constraint if exists asset_consent_links_link_source_check,
  drop constraint if exists asset_consent_links_match_confidence_check;

alter table public.asset_consent_links
  add constraint asset_consent_links_link_source_check
    check (link_source in ('manual', 'auto')),
  add constraint asset_consent_links_match_confidence_check
    check (match_confidence is null or (match_confidence >= 0 and match_confidence <= 1));

create or replace function app.preserve_manual_asset_consent_link_provenance()
returns trigger
language plpgsql
set search_path = public, app, extensions
as $$
begin
  if old.link_source = 'manual' and new.link_source = 'auto' then
    new.link_source := old.link_source;
    new.match_confidence := old.match_confidence;
    new.matched_at := old.matched_at;
    new.matcher_version := old.matcher_version;
  end if;

  return new;
end;
$$;

drop trigger if exists asset_consent_links_preserve_manual_provenance on public.asset_consent_links;

create trigger asset_consent_links_preserve_manual_provenance
before update on public.asset_consent_links
for each row
execute function app.preserve_manual_asset_consent_link_provenance();

create table if not exists public.face_match_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  scope_asset_id uuid,
  scope_consent_id uuid,
  job_type text not null,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint face_match_jobs_project_scope_fk
    foreign key (project_id, tenant_id)
    references public.projects(id, tenant_id)
    on delete restrict,
  constraint face_match_jobs_scope_asset_fk
    foreign key (scope_asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete restrict,
  constraint face_match_jobs_scope_consent_fk
    foreign key (scope_consent_id, tenant_id, project_id)
    references public.consents(id, tenant_id, project_id)
    on delete restrict,
  constraint face_match_jobs_tenant_project_dedupe_key_key
    unique (tenant_id, project_id, dedupe_key),
  constraint face_match_jobs_job_type_check
    check (job_type in ('photo_uploaded', 'consent_headshot_ready', 'reconcile_project')),
  constraint face_match_jobs_status_check
    check (status in ('queued', 'processing', 'succeeded', 'failed', 'dead')),
  constraint face_match_jobs_attempt_count_check
    check (attempt_count >= 0),
  constraint face_match_jobs_max_attempts_check
    check (max_attempts > 0),
  constraint face_match_jobs_scope_by_job_type_check
    check (
      (job_type = 'photo_uploaded' and scope_asset_id is not null and scope_consent_id is null)
      or (job_type = 'consent_headshot_ready' and scope_consent_id is not null and scope_asset_id is null)
      or (job_type = 'reconcile_project' and scope_asset_id is null and scope_consent_id is null)
    )
);

create index if not exists face_match_jobs_status_run_after_idx
  on public.face_match_jobs (status, run_after);

create index if not exists face_match_jobs_tenant_project_status_idx
  on public.face_match_jobs (tenant_id, project_id, status);

alter table public.face_match_jobs enable row level security;

revoke all on table public.face_match_jobs from public;
revoke all on table public.face_match_jobs from anon;
revoke all on table public.face_match_jobs from authenticated;
