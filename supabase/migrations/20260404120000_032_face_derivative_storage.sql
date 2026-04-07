insert into storage.buckets (id, name, public)
values ('asset-face-derivatives', 'asset-face-derivatives', false)
on conflict (id) do nothing;

create policy "asset_face_derivatives_select_member"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'asset-face-derivatives'
  and split_part(name, '/', 1) = 'tenant'
  and split_part(name, '/', 3) = 'project'
  and split_part(name, '/', 5) = 'materialization'
  and split_part(name, '/', 7) = 'face'
  and exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = split_part(name, '/', 2)::uuid
  )
  and exists (
    select 1
    from public.projects p
    where p.id = split_part(name, '/', 4)::uuid
      and p.tenant_id = split_part(name, '/', 2)::uuid
  )
);

create policy "asset_face_derivatives_insert_member"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'asset-face-derivatives'
  and split_part(name, '/', 1) = 'tenant'
  and split_part(name, '/', 3) = 'project'
  and split_part(name, '/', 5) = 'materialization'
  and split_part(name, '/', 7) = 'face'
  and exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = split_part(name, '/', 2)::uuid
  )
  and exists (
    select 1
    from public.projects p
    where p.id = split_part(name, '/', 4)::uuid
      and p.tenant_id = split_part(name, '/', 2)::uuid
  )
);
