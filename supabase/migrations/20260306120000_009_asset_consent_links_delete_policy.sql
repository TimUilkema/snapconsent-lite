create policy "asset_consent_links_delete_member"
on public.asset_consent_links
for delete
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_links.tenant_id
      and m.user_id = auth.uid()
  )
);
