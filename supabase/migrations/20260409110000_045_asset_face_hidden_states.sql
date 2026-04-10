create table if not exists public.asset_face_hidden_states (
  id uuid primary key default gen_random_uuid(),
  asset_face_id uuid not null
    references public.asset_face_materialization_faces(id) on delete cascade,
  asset_materialization_id uuid not null
    references public.asset_face_materializations(id) on delete cascade,
  asset_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  reason text not null default 'manual_hide',
  hidden_at timestamptz not null default now(),
  hidden_by uuid references auth.users(id) on delete set null,
  restored_at timestamptz,
  restored_by uuid references auth.users(id) on delete set null,
  constraint asset_face_hidden_states_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_face_hidden_states_reason_check
    check (reason in ('manual_hide'))
);

create unique index if not exists asset_face_hidden_states_active_face_idx
  on public.asset_face_hidden_states (asset_face_id)
  where restored_at is null;

create index if not exists asset_face_hidden_states_tenant_project_asset_idx
  on public.asset_face_hidden_states (tenant_id, project_id, asset_id, restored_at, hidden_at desc);

create index if not exists asset_face_hidden_states_tenant_project_materialization_idx
  on public.asset_face_hidden_states (tenant_id, project_id, asset_materialization_id, restored_at);

alter table public.asset_face_hidden_states enable row level security;

revoke all on table public.asset_face_hidden_states from public;
revoke all on table public.asset_face_hidden_states from anon;
revoke all on table public.asset_face_hidden_states from authenticated;

create policy "asset_face_hidden_states_select_member"
on public.asset_face_hidden_states
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_face_hidden_states.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_face_hidden_states_insert_member"
on public.asset_face_hidden_states
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_face_hidden_states.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_face_hidden_states_update_member"
on public.asset_face_hidden_states
for update
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_face_hidden_states.tenant_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_face_hidden_states.tenant_id
      and m.user_id = auth.uid()
  )
);
