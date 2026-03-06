alter table public.assets enable row level security;
alter table public.asset_consent_links enable row level security;

create policy "assets_select_member"
on public.assets
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = assets.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "assets_insert_member"
on public.assets
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = assets.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "assets_update_member"
on public.assets
for update
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = assets.tenant_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = assets.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_consent_links_select_member"
on public.asset_consent_links
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_links.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_consent_links_insert_member"
on public.asset_consent_links
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_links.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_consent_links_update_member"
on public.asset_consent_links
for update
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_links.tenant_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_links.tenant_id
      and m.user_id = auth.uid()
  )
);
