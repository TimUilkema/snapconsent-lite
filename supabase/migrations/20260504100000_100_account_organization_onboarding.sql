create or replace function app.create_first_tenant_for_current_user(p_name text default null)
returns table (
  outcome text,
  tenant_id uuid,
  tenant_name text
)
language plpgsql
security definer
set search_path = public, auth, app, extensions
as $$
declare
  v_user_id uuid;
  v_name text;
  v_existing record;
  v_tenant_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 100));

  select
    m.tenant_id,
    t.name as tenant_name
  into v_existing
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = v_user_id
  order by m.created_at asc
  limit 1;

  if found then
    return query select
      'existing_membership'::text,
      v_existing.tenant_id,
      v_existing.tenant_name;
    return;
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  v_name := coalesce(v_name, 'My organization');

  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'invalid_organization_name' using errcode = '22023';
  end if;

  insert into public.tenants (name)
  values (v_name)
  returning id into v_tenant_id;

  insert into public.memberships (tenant_id, user_id, role)
  values (v_tenant_id, v_user_id, 'owner');

  return query select 'created'::text, v_tenant_id, v_name;
end;
$$;

create or replace function public.create_first_tenant_for_current_user(p_name text default null)
returns table (
  outcome text,
  tenant_id uuid,
  tenant_name text
)
language sql
volatile
security definer
set search_path = public, auth, app, extensions
as $$
  select *
  from app.create_first_tenant_for_current_user(p_name);
$$;

revoke all on function app.create_first_tenant_for_current_user(text) from public;
revoke all on function public.create_first_tenant_for_current_user(text) from public;

grant execute on function public.create_first_tenant_for_current_user(text) to authenticated;

create or replace function app.auth_account_exists_for_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public, auth, app, extensions
as $$
  select exists (
    select 1
    from auth.users u
    where lower(u.email) = lower(nullif(btrim(coalesce(p_email, '')), ''))
  );
$$;

create or replace function public.auth_account_exists_for_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public, auth, app, extensions
as $$
  select app.auth_account_exists_for_email(p_email);
$$;

revoke all on function app.auth_account_exists_for_email(text) from public;
revoke all on function public.auth_account_exists_for_email(text) from public;

grant execute on function public.auth_account_exists_for_email(text) to service_role;
