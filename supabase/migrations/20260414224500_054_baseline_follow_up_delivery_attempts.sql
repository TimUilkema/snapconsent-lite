create table if not exists public.recurring_profile_consent_request_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null,
  request_id uuid not null,
  action_kind text not null check (action_kind in ('reminder', 'new_request')),
  delivery_mode text not null check (delivery_mode in ('placeholder')),
  status text not null check (status in ('recorded', 'failed')),
  target_email text not null,
  error_code text null,
  error_message text null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint recurring_profile_request_delivery_attempts_id_tenant_unique unique (id, tenant_id),
  constraint recurring_profile_request_delivery_attempts_profile_fkey foreign key (profile_id, tenant_id)
    references public.recurring_profiles (id, tenant_id)
    on delete restrict,
  constraint recurring_profile_request_delivery_attempts_request_fkey foreign key (request_id, tenant_id)
    references public.recurring_profile_consent_requests (id, tenant_id)
    on delete restrict
);

create index if not exists rec_prof_req_delivery_attempts_profile_created_idx
  on public.recurring_profile_consent_request_delivery_attempts (tenant_id, profile_id, created_at desc);

create index if not exists rec_prof_req_delivery_attempts_request_created_idx
  on public.recurring_profile_consent_request_delivery_attempts (tenant_id, request_id, created_at desc);

alter table public.recurring_profile_consent_request_delivery_attempts enable row level security;

create policy "recurring_profile_request_delivery_attempts_select_member"
on public.recurring_profile_consent_request_delivery_attempts
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = recurring_profile_consent_request_delivery_attempts.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "recurring_profile_request_delivery_attempts_insert_manage_rows"
on public.recurring_profile_consent_request_delivery_attempts
for insert
to authenticated
with check (
  app.current_user_can_manage_recurring_profiles(tenant_id)
);
