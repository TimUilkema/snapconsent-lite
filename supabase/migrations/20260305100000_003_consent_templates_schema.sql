create table if not exists public.consent_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  version text not null,
  body text not null,
  status text not null default 'active' check (status in ('active', 'retired')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (template_key, version)
);

create index if not exists consent_templates_key_status_idx
  on public.consent_templates (template_key, status);

alter table public.projects
  add column if not exists default_consent_template_id uuid references public.consent_templates(id) on delete set null;

alter table public.subject_invites
  add column if not exists consent_template_id uuid references public.consent_templates(id) on delete restrict;
