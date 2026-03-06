create table if not exists public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  operation text not null,
  idempotency_key text not null,
  response_json jsonb not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (tenant_id, operation, idempotency_key)
);

create index if not exists idempotency_keys_tenant_created_at_idx
  on public.idempotency_keys (tenant_id, created_at desc);

alter table public.idempotency_keys enable row level security;

create policy "idempotency_keys_select_member"
on public.idempotency_keys
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = idempotency_keys.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "idempotency_keys_insert_member"
on public.idempotency_keys
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = idempotency_keys.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "idempotency_keys_update_member"
on public.idempotency_keys
for update
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = idempotency_keys.tenant_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = idempotency_keys.tenant_id
      and m.user_id = auth.uid()
  )
);
