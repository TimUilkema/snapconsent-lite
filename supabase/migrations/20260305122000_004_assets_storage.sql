insert into storage.buckets (id, name, public)
values ('project-assets', 'project-assets', false)
on conflict (id) do nothing;

create policy "project_assets_select_member"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'project-assets'
  and split_part(name, '/', 1) = 'tenant'
  and split_part(name, '/', 3) = 'project'
  and split_part(name, '/', 5) = 'asset'
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

create policy "project_assets_insert_member"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'project-assets'
  and split_part(name, '/', 1) = 'tenant'
  and split_part(name, '/', 3) = 'project'
  and split_part(name, '/', 5) = 'asset'
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
