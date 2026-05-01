create or replace function app.create_tenant_custom_role_with_capabilities(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_slug text,
  p_name text,
  p_description text,
  p_capability_keys text[]
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role_id uuid;
begin
  if not exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = p_actor_user_id
      and m.role in ('owner', 'admin')
  ) then
    raise exception 'tenant_member_management_forbidden' using errcode = 'P0001';
  end if;

  if btrim(coalesce(p_slug, '')) = '' or btrim(coalesce(p_name, '')) = '' then
    raise exception 'invalid_role_name' using errcode = 'P0001';
  end if;

  if coalesce(array_length(p_capability_keys, 1), 0) = 0 then
    raise exception 'empty_capability_set' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from unnest(p_capability_keys) as capability_key
    group by capability_key
    having count(*) > 1
  ) then
    raise exception 'duplicate_capability_key' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from unnest(p_capability_keys) as requested(capability_key)
    left join public.capabilities c on c.key = requested.capability_key
    where c.key is null
  ) then
    raise exception 'invalid_capability_key' using errcode = 'P0001';
  end if;

  insert into public.role_definitions (
    tenant_id,
    slug,
    name,
    description,
    is_system,
    system_role_key,
    created_by,
    updated_by
  )
  values (
    p_tenant_id,
    btrim(p_slug),
    btrim(p_name),
    nullif(btrim(coalesce(p_description, '')), ''),
    false,
    null,
    p_actor_user_id,
    p_actor_user_id
  )
  returning id into v_role_id;

  insert into public.role_definition_capabilities (role_definition_id, capability_key)
  select v_role_id, capability_key
  from unnest(p_capability_keys) as capability_key;

  return v_role_id;
end;
$$;

create or replace function app.update_tenant_custom_role_with_capabilities(
  p_tenant_id uuid,
  p_role_definition_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_description text,
  p_capability_keys text[]
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role public.role_definitions%rowtype;
begin
  if not exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = p_actor_user_id
      and m.role in ('owner', 'admin')
  ) then
    raise exception 'tenant_member_management_forbidden' using errcode = 'P0001';
  end if;

  select *
  into v_role
  from public.role_definitions rd
  where rd.id = p_role_definition_id
    and rd.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'role_not_found' using errcode = 'P0001';
  end if;

  if v_role.is_system then
    raise exception 'system_role_immutable' using errcode = 'P0001';
  end if;

  if v_role.archived_at is not null then
    raise exception 'role_archived' using errcode = 'P0001';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'invalid_role_name' using errcode = 'P0001';
  end if;

  if coalesce(array_length(p_capability_keys, 1), 0) = 0 then
    raise exception 'empty_capability_set' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from unnest(p_capability_keys) as capability_key
    group by capability_key
    having count(*) > 1
  ) then
    raise exception 'duplicate_capability_key' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from unnest(p_capability_keys) as requested(capability_key)
    left join public.capabilities c on c.key = requested.capability_key
    where c.key is null
  ) then
    raise exception 'invalid_capability_key' using errcode = 'P0001';
  end if;

  update public.role_definitions
  set
    name = btrim(p_name),
    description = nullif(btrim(coalesce(p_description, '')), ''),
    updated_at = now(),
    updated_by = p_actor_user_id
  where id = p_role_definition_id
    and tenant_id = p_tenant_id
    and is_system = false;

  delete from public.role_definition_capabilities
  where role_definition_id = p_role_definition_id;

  insert into public.role_definition_capabilities (role_definition_id, capability_key)
  select p_role_definition_id, capability_key
  from unnest(p_capability_keys) as capability_key;

  return p_role_definition_id;
end;
$$;

create or replace function app.archive_tenant_custom_role(
  p_tenant_id uuid,
  p_role_definition_id uuid,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role public.role_definitions%rowtype;
begin
  if not exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = p_actor_user_id
      and m.role in ('owner', 'admin')
  ) then
    raise exception 'tenant_member_management_forbidden' using errcode = 'P0001';
  end if;

  select *
  into v_role
  from public.role_definitions rd
  where rd.id = p_role_definition_id
    and rd.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'role_not_found' using errcode = 'P0001';
  end if;

  if v_role.is_system then
    raise exception 'system_role_immutable' using errcode = 'P0001';
  end if;

  if v_role.archived_at is not null then
    return false;
  end if;

  update public.role_definitions
  set
    archived_at = now(),
    archived_by = p_actor_user_id,
    updated_at = now(),
    updated_by = p_actor_user_id
  where id = p_role_definition_id
    and tenant_id = p_tenant_id
    and is_system = false
    and archived_at is null;

  return true;
end;
$$;

create or replace function public.create_tenant_custom_role_with_capabilities(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_slug text,
  p_name text,
  p_description text,
  p_capability_keys text[]
)
returns uuid
language sql
security definer
set search_path = public, extensions
as $$
  select app.create_tenant_custom_role_with_capabilities(
    p_tenant_id,
    p_actor_user_id,
    p_slug,
    p_name,
    p_description,
    p_capability_keys
  );
$$;

create or replace function public.update_tenant_custom_role_with_capabilities(
  p_tenant_id uuid,
  p_role_definition_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_description text,
  p_capability_keys text[]
)
returns uuid
language sql
security definer
set search_path = public, extensions
as $$
  select app.update_tenant_custom_role_with_capabilities(
    p_tenant_id,
    p_role_definition_id,
    p_actor_user_id,
    p_name,
    p_description,
    p_capability_keys
  );
$$;

create or replace function public.archive_tenant_custom_role(
  p_tenant_id uuid,
  p_role_definition_id uuid,
  p_actor_user_id uuid
)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select app.archive_tenant_custom_role(
    p_tenant_id,
    p_role_definition_id,
    p_actor_user_id
  );
$$;

revoke all on function app.create_tenant_custom_role_with_capabilities(uuid, uuid, text, text, text, text[]) from public;
revoke all on function app.update_tenant_custom_role_with_capabilities(uuid, uuid, uuid, text, text, text[]) from public;
revoke all on function app.archive_tenant_custom_role(uuid, uuid, uuid) from public;
revoke all on function public.create_tenant_custom_role_with_capabilities(uuid, uuid, text, text, text, text[]) from public;
revoke all on function public.update_tenant_custom_role_with_capabilities(uuid, uuid, uuid, text, text, text[]) from public;
revoke all on function public.archive_tenant_custom_role(uuid, uuid, uuid) from public;

grant execute on function app.create_tenant_custom_role_with_capabilities(uuid, uuid, text, text, text, text[]) to service_role;
grant execute on function app.update_tenant_custom_role_with_capabilities(uuid, uuid, uuid, text, text, text[]) to service_role;
grant execute on function app.archive_tenant_custom_role(uuid, uuid, uuid) to service_role;
grant execute on function public.create_tenant_custom_role_with_capabilities(uuid, uuid, text, text, text, text[]) to service_role;
grant execute on function public.update_tenant_custom_role_with_capabilities(uuid, uuid, uuid, text, text, text[]) to service_role;
grant execute on function public.archive_tenant_custom_role(uuid, uuid, uuid) to service_role;
