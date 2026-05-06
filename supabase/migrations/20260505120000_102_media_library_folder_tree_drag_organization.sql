alter table public.media_library_folders
  add column if not exists parent_folder_id uuid null;

alter table public.media_library_folders
  drop constraint if exists media_library_folders_parent_scope_fk;

alter table public.media_library_folders
  add constraint media_library_folders_parent_scope_fk
  foreign key (parent_folder_id, tenant_id)
  references public.media_library_folders(id, tenant_id)
  on delete restrict;

alter table public.media_library_folders
  drop constraint if exists media_library_folders_not_self_parent_check;

alter table public.media_library_folders
  add constraint media_library_folders_not_self_parent_check
  check (parent_folder_id is null or parent_folder_id <> id);

drop index if exists public.media_library_folders_tenant_active_name_unique_idx;

create unique index if not exists media_library_folders_tenant_root_active_name_unique_idx
  on public.media_library_folders (tenant_id, lower(btrim(name)))
  where archived_at is null and parent_folder_id is null;

create unique index if not exists media_library_folders_tenant_parent_active_name_unique_idx
  on public.media_library_folders (tenant_id, parent_folder_id, lower(btrim(name)))
  where archived_at is null and parent_folder_id is not null;

create index if not exists media_library_folders_tenant_parent_active_name_idx
  on public.media_library_folders (tenant_id, parent_folder_id, lower(btrim(name)), id)
  where archived_at is null;

create index if not exists media_library_folders_tenant_parent_idx
  on public.media_library_folders (tenant_id, parent_folder_id, id);

create or replace function app.move_media_library_folder(
  p_tenant_id uuid,
  p_folder_id uuid,
  p_parent_folder_id uuid,
  p_actor_user_id uuid
)
returns table (
  ok boolean,
  error_code text,
  folder_id uuid,
  parent_folder_id uuid,
  name text,
  updated_at timestamptz,
  updated_by uuid,
  changed boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_folder public.media_library_folders%rowtype;
  v_target public.media_library_folders%rowtype;
  v_now timestamptz := now();
  v_has_archived_ancestor boolean := false;
  v_parent_is_descendant boolean := false;
  v_has_name_conflict boolean := false;
begin
  select *
  into v_folder
  from public.media_library_folders f
  where f.tenant_id = p_tenant_id
    and f.id = p_folder_id
  for update;

  if not found then
    return query select false, 'folder_not_found'::text, p_folder_id, p_parent_folder_id, null::text, null::timestamptz, null::uuid, false;
    return;
  end if;

  if v_folder.archived_at is not null then
    return query select false, 'folder_archived'::text, v_folder.id, v_folder.parent_folder_id, v_folder.name, v_folder.updated_at, v_folder.updated_by, false;
    return;
  end if;

  with recursive ancestors as (
    select parent.id, parent.parent_folder_id, parent.archived_at
    from public.media_library_folders child
    join public.media_library_folders parent
      on parent.tenant_id = child.tenant_id
     and parent.id = child.parent_folder_id
    where child.tenant_id = p_tenant_id
      and child.id = p_folder_id
    union
    select parent.id, parent.parent_folder_id, parent.archived_at
    from ancestors a
    join public.media_library_folders parent
      on parent.tenant_id = p_tenant_id
     and parent.id = a.parent_folder_id
  )
  select exists(select 1 from ancestors where archived_at is not null)
  into v_has_archived_ancestor;

  if v_has_archived_ancestor then
    return query select false, 'folder_archived'::text, v_folder.id, v_folder.parent_folder_id, v_folder.name, v_folder.updated_at, v_folder.updated_by, false;
    return;
  end if;

  if p_parent_folder_id = p_folder_id then
    return query select false, 'folder_move_into_self'::text, v_folder.id, v_folder.parent_folder_id, v_folder.name, v_folder.updated_at, v_folder.updated_by, false;
    return;
  end if;

  if p_parent_folder_id is not null then
    select *
    into v_target
    from public.media_library_folders f
    where f.tenant_id = p_tenant_id
      and f.id = p_parent_folder_id
    for update;

    if not found then
      return query select false, 'target_folder_not_found'::text, v_folder.id, v_folder.parent_folder_id, v_folder.name, v_folder.updated_at, v_folder.updated_by, false;
      return;
    end if;

    if v_target.archived_at is not null then
      return query select false, 'target_folder_archived'::text, v_folder.id, v_folder.parent_folder_id, v_folder.name, v_folder.updated_at, v_folder.updated_by, false;
      return;
    end if;

    with recursive target_ancestors as (
      select parent.id, parent.parent_folder_id, parent.archived_at
      from public.media_library_folders child
      join public.media_library_folders parent
        on parent.tenant_id = child.tenant_id
       and parent.id = child.parent_folder_id
      where child.tenant_id = p_tenant_id
        and child.id = p_parent_folder_id
      union
      select parent.id, parent.parent_folder_id, parent.archived_at
      from target_ancestors a
      join public.media_library_folders parent
        on parent.tenant_id = p_tenant_id
       and parent.id = a.parent_folder_id
    )
    select exists(select 1 from target_ancestors where archived_at is not null)
    into v_has_archived_ancestor;

    if v_has_archived_ancestor then
      return query select false, 'target_folder_archived'::text, v_folder.id, v_folder.parent_folder_id, v_folder.name, v_folder.updated_at, v_folder.updated_by, false;
      return;
    end if;

    with recursive descendants as (
      select child.id, child.parent_folder_id
      from public.media_library_folders child
      where child.tenant_id = p_tenant_id
        and child.parent_folder_id = p_folder_id
      union
      select child.id, child.parent_folder_id
      from descendants d
      join public.media_library_folders child
        on child.tenant_id = p_tenant_id
       and child.parent_folder_id = d.id
    )
    select exists(select 1 from descendants where id = p_parent_folder_id)
    into v_parent_is_descendant;

    if v_parent_is_descendant then
      return query select false, 'folder_move_into_descendant'::text, v_folder.id, v_folder.parent_folder_id, v_folder.name, v_folder.updated_at, v_folder.updated_by, false;
      return;
    end if;
  end if;

  select exists(
    select 1
    from public.media_library_folders sibling
    where sibling.tenant_id = p_tenant_id
      and sibling.id <> p_folder_id
      and sibling.archived_at is null
      and lower(btrim(sibling.name)) = lower(btrim(v_folder.name))
      and (
        (p_parent_folder_id is null and sibling.parent_folder_id is null)
        or sibling.parent_folder_id = p_parent_folder_id
      )
  )
  into v_has_name_conflict;

  if v_has_name_conflict then
    return query select false, 'folder_name_conflict'::text, v_folder.id, v_folder.parent_folder_id, v_folder.name, v_folder.updated_at, v_folder.updated_by, false;
    return;
  end if;

  if v_folder.parent_folder_id is not distinct from p_parent_folder_id then
    return query select true, null::text, v_folder.id, v_folder.parent_folder_id, v_folder.name, v_folder.updated_at, v_folder.updated_by, false;
    return;
  end if;

  update public.media_library_folders f
  set parent_folder_id = p_parent_folder_id,
      updated_at = v_now,
      updated_by = p_actor_user_id
  where f.tenant_id = p_tenant_id
    and f.id = p_folder_id
  returning *
  into v_folder;

  return query select true, null::text, v_folder.id, v_folder.parent_folder_id, v_folder.name, v_folder.updated_at, v_folder.updated_by, true;
exception
  when unique_violation then
    return query select false, 'folder_name_conflict'::text, p_folder_id, p_parent_folder_id, null::text, null::timestamptz, null::uuid, false;
end;
$$;

revoke all on function app.move_media_library_folder(uuid, uuid, uuid, uuid) from public;
revoke all on function app.move_media_library_folder(uuid, uuid, uuid, uuid) from anon;
revoke all on function app.move_media_library_folder(uuid, uuid, uuid, uuid) from authenticated;
grant execute on function app.move_media_library_folder(uuid, uuid, uuid, uuid) to service_role;

create or replace function public.move_media_library_folder(
  p_tenant_id uuid,
  p_folder_id uuid,
  p_parent_folder_id uuid,
  p_actor_user_id uuid
)
returns table (
  ok boolean,
  error_code text,
  folder_id uuid,
  parent_folder_id uuid,
  name text,
  updated_at timestamptz,
  updated_by uuid,
  changed boolean
)
language sql
security definer
set search_path = public, extensions
as $$
  select *
  from app.move_media_library_folder(
    p_tenant_id,
    p_folder_id,
    p_parent_folder_id,
    p_actor_user_id
  );
$$;

revoke all on function public.move_media_library_folder(uuid, uuid, uuid, uuid) from public;
revoke all on function public.move_media_library_folder(uuid, uuid, uuid, uuid) from anon;
revoke all on function public.move_media_library_folder(uuid, uuid, uuid, uuid) from authenticated;
grant execute on function public.move_media_library_folder(uuid, uuid, uuid, uuid) to service_role;
