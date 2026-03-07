create table if not exists public.asset_consent_link_suppressions (
  asset_id uuid not null,
  consent_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  reason text not null default 'manual_unlink',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint asset_consent_link_suppressions_pkey primary key (asset_id, consent_id),
  constraint asset_consent_link_suppressions_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_consent_link_suppressions_consent_scope_fk
    foreign key (consent_id, tenant_id, project_id)
    references public.consents(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_consent_link_suppressions_reason_check
    check (reason in ('manual_unlink'))
);

create index if not exists asset_consent_link_suppressions_tenant_project_consent_idx
  on public.asset_consent_link_suppressions (tenant_id, project_id, consent_id);

create index if not exists asset_consent_link_suppressions_tenant_project_asset_idx
  on public.asset_consent_link_suppressions (tenant_id, project_id, asset_id);

alter table public.asset_consent_link_suppressions enable row level security;

create policy "asset_consent_link_suppressions_select_member"
on public.asset_consent_link_suppressions
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_link_suppressions.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_consent_link_suppressions_insert_member"
on public.asset_consent_link_suppressions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_link_suppressions.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_consent_link_suppressions_delete_member"
on public.asset_consent_link_suppressions
for delete
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_link_suppressions.tenant_id
      and m.user_id = auth.uid()
  )
);
