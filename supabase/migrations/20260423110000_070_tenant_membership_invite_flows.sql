create or replace function app.normalize_tenant_membership_invite_email(p_value text)
returns text
language sql
immutable
as $$
  select lower(btrim(coalesce(p_value, '')));
$$;

create or replace function app.get_public_tenant_membership_invite(p_token text)
returns table (
  invite_id uuid,
  tenant_id uuid,
  tenant_name text,
  email text,
  role text,
  status text,
  expires_at timestamptz,
  can_accept boolean
)
language plpgsql
stable
security definer
set search_path = public, auth, app, extensions
as $$
declare
  v_hash text;
begin
  v_hash := app.sha256_hex(p_token);

  return query
  select
    i.id,
    i.tenant_id,
    t.name,
    i.email,
    i.role,
    case
      when i.status = 'pending' and i.expires_at <= now() then 'expired'
      else i.status
    end as status,
    i.expires_at,
    (
      i.status = 'pending'
      and i.expires_at > now()
    ) as can_accept
  from public.tenant_membership_invites i
  join public.tenants t
    on t.id = i.tenant_id
  where i.token_hash = v_hash
  limit 1;
end;
$$;

create or replace function app.create_or_refresh_tenant_membership_invite(
  p_tenant_id uuid,
  p_email text,
  p_role text,
  p_expires_at timestamptz default null
)
returns table (
  outcome text,
  invite_id uuid,
  tenant_id uuid,
  tenant_name text,
  email text,
  normalized_email text,
  role text,
  status text,
  expires_at timestamptz,
  last_sent_at timestamptz,
  invite_token text
)
language plpgsql
security definer
set search_path = public, auth, app, extensions
as $$
declare
  v_actor_user_id uuid;
  v_existing_user_id uuid;
  v_normalized_email text;
  v_effective_expires_at timestamptz;
  v_plain_token text;
  v_trimmed_email text;
  v_tenant_name text;
  v_invite public.tenant_membership_invites;
begin
  v_actor_user_id := auth.uid();
  if v_actor_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if not app.current_user_can_manage_members(p_tenant_id) then
    raise exception 'tenant_member_management_forbidden' using errcode = '42501';
  end if;

  if p_role not in ('admin', 'reviewer', 'photographer') then
    raise exception 'invalid_membership_role' using errcode = '22023';
  end if;

  v_trimmed_email := btrim(coalesce(p_email, ''));
  v_normalized_email := app.normalize_tenant_membership_invite_email(v_trimmed_email);
  if v_normalized_email = '' or position('@' in v_normalized_email) = 0 then
    raise exception 'invalid_invite_email' using errcode = '22023';
  end if;

  v_effective_expires_at := coalesce(p_expires_at, now() + interval '7 days');
  if v_effective_expires_at <= now() then
    raise exception 'invalid_invite_expiry' using errcode = '22023';
  end if;

  select t.name
  into v_tenant_name
  from public.tenants t
  where t.id = p_tenant_id;

  if v_tenant_name is null then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;

  update public.tenant_membership_invites as i
  set status = 'expired'
  where i.tenant_id = p_tenant_id
    and i.normalized_email = v_normalized_email
    and i.status = 'pending'
    and i.expires_at <= now();

  select u.id
  into v_existing_user_id
  from auth.users u
  where app.normalize_tenant_membership_invite_email(u.email) = v_normalized_email
  limit 1;

  if v_existing_user_id is not null and exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = v_existing_user_id
  ) then
    return query
    select
      'already_member'::text,
      null::uuid,
      p_tenant_id,
      v_tenant_name,
      v_trimmed_email,
      v_normalized_email,
      p_role,
      null::text,
      null::timestamptz,
      null::timestamptz,
      null::text;
    return;
  end if;

  v_plain_token := encode(gen_random_bytes(32), 'hex');

  select i.*
  into v_invite
  from public.tenant_membership_invites i
  where i.tenant_id = p_tenant_id
    and i.normalized_email = v_normalized_email
    and i.status = 'pending'
  for update;

  if found then
    update public.tenant_membership_invites as i
    set email = v_trimmed_email,
        normalized_email = v_normalized_email,
        role = p_role,
        token_hash = app.sha256_hex(v_plain_token),
        expires_at = v_effective_expires_at,
        last_sent_at = now()
    where i.id = v_invite.id
    returning * into v_invite;
  else
    begin
      insert into public.tenant_membership_invites (
        tenant_id,
        email,
        normalized_email,
        role,
        status,
        token_hash,
        invited_by_user_id,
        expires_at,
        last_sent_at
      )
      values (
        p_tenant_id,
        v_trimmed_email,
        v_normalized_email,
        p_role,
        'pending',
        app.sha256_hex(v_plain_token),
        v_actor_user_id,
        v_effective_expires_at,
        now()
      )
      returning * into v_invite;
    exception
      when unique_violation then
        select i.*
        into v_invite
        from public.tenant_membership_invites i
        where i.tenant_id = p_tenant_id
          and i.normalized_email = v_normalized_email
          and i.status = 'pending'
        for update;

        if not found then
          raise;
        end if;

        update public.tenant_membership_invites as i
        set email = v_trimmed_email,
            normalized_email = v_normalized_email,
            role = p_role,
            token_hash = app.sha256_hex(v_plain_token),
            expires_at = v_effective_expires_at,
            last_sent_at = now()
        where i.id = v_invite.id
        returning * into v_invite;
    end;
  end if;

  return query
  select
    'invited'::text,
    v_invite.id,
    v_invite.tenant_id,
    v_tenant_name,
    v_invite.email,
    v_invite.normalized_email,
    v_invite.role,
    v_invite.status,
    v_invite.expires_at,
    v_invite.last_sent_at,
    v_plain_token;
end;
$$;

create or replace function app.refresh_tenant_membership_invite(
  p_invite_id uuid,
  p_role text default null,
  p_expires_at timestamptz default null
)
returns table (
  outcome text,
  invite_id uuid,
  tenant_id uuid,
  tenant_name text,
  email text,
  normalized_email text,
  role text,
  status text,
  expires_at timestamptz,
  last_sent_at timestamptz,
  invite_token text
)
language plpgsql
security definer
set search_path = public, auth, app, extensions
as $$
declare
  v_actor_user_id uuid;
  v_existing_user_id uuid;
  v_effective_role text;
  v_effective_expires_at timestamptz;
  v_plain_token text;
  v_tenant_name text;
  v_invite record;
begin
  v_actor_user_id := auth.uid();
  if v_actor_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select
    i.*,
    t.name as tenant_name_value
  into v_invite
  from public.tenant_membership_invites i
  join public.tenants t
    on t.id = i.tenant_id
  where i.id = p_invite_id
  for update;

  if not found then
    raise exception 'tenant_membership_invite_not_found' using errcode = 'P0002';
  end if;

  if not app.current_user_can_manage_members(v_invite.tenant_id) then
    raise exception 'tenant_member_management_forbidden' using errcode = '42501';
  end if;

  v_tenant_name := v_invite.tenant_name_value;
  v_effective_role := coalesce(p_role, v_invite.role);
  if v_effective_role not in ('admin', 'reviewer', 'photographer') then
    raise exception 'invalid_membership_role' using errcode = '22023';
  end if;

  if v_invite.status = 'pending' and v_invite.expires_at <= now() then
    update public.tenant_membership_invites as i
    set status = 'expired'
    where i.id = v_invite.id
    returning *
    into v_invite;
  end if;

  select u.id
  into v_existing_user_id
  from auth.users u
  where app.normalize_tenant_membership_invite_email(u.email) = v_invite.normalized_email
  limit 1;

  if v_existing_user_id is not null and exists (
    select 1
    from public.memberships m
    where m.tenant_id = v_invite.tenant_id
      and m.user_id = v_existing_user_id
  ) then
    update public.tenant_membership_invites as i
    set status = 'accepted',
        accepted_by_user_id = coalesce(i.accepted_by_user_id, v_existing_user_id),
        accepted_at = coalesce(i.accepted_at, now())
    where i.id = v_invite.id
      and i.status = 'pending'
    returning *
    into v_invite;

    return query
    select
      'already_member'::text,
      v_invite.id,
      v_invite.tenant_id,
      v_tenant_name,
      v_invite.email,
      v_invite.normalized_email,
      v_invite.role,
      v_invite.status,
      v_invite.expires_at,
      v_invite.last_sent_at,
      null::text;
    return;
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'tenant_membership_invite_not_pending' using errcode = '22023';
  end if;

  v_effective_expires_at := coalesce(p_expires_at, now() + interval '7 days');
  if v_effective_expires_at <= now() then
    raise exception 'invalid_invite_expiry' using errcode = '22023';
  end if;

  v_plain_token := encode(gen_random_bytes(32), 'hex');

  update public.tenant_membership_invites as i
  set role = v_effective_role,
      token_hash = app.sha256_hex(v_plain_token),
      expires_at = v_effective_expires_at,
      last_sent_at = now()
  where i.id = v_invite.id
  returning *
  into v_invite;

  return query
  select
    'resent'::text,
    v_invite.id,
    v_invite.tenant_id,
    v_tenant_name,
    v_invite.email,
    v_invite.normalized_email,
    v_invite.role,
    v_invite.status,
    v_invite.expires_at,
    v_invite.last_sent_at,
    v_plain_token;
end;
$$;

create or replace function app.revoke_tenant_membership_invite(p_invite_id uuid)
returns table (
  outcome text,
  invite_id uuid,
  tenant_id uuid,
  email text,
  role text,
  status text,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, app, extensions
as $$
declare
  v_actor_user_id uuid;
  v_invite public.tenant_membership_invites;
begin
  v_actor_user_id := auth.uid();
  if v_actor_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select i.*
  into v_invite
  from public.tenant_membership_invites i
  where i.id = p_invite_id
  for update;

  if not found then
    raise exception 'tenant_membership_invite_not_found' using errcode = 'P0002';
  end if;

  if not app.current_user_can_manage_members(v_invite.tenant_id) then
    raise exception 'tenant_member_management_forbidden' using errcode = '42501';
  end if;

  if v_invite.status = 'pending' and v_invite.expires_at <= now() then
    update public.tenant_membership_invites as i
    set status = 'expired'
    where i.id = v_invite.id
    returning *
    into v_invite;
  end if;

  if v_invite.status = 'pending' then
    update public.tenant_membership_invites as i
    set status = 'revoked',
        revoked_by_user_id = v_actor_user_id,
        revoked_at = coalesce(i.revoked_at, now())
    where i.id = v_invite.id
    returning *
    into v_invite;
  end if;

  return query
  select
    case
      when v_invite.status = 'revoked' then 'revoked'
      when v_invite.status = 'accepted' then 'accepted'
      when v_invite.status = 'expired' then 'expired'
      else v_invite.status
    end,
    v_invite.id,
    v_invite.tenant_id,
    v_invite.email,
    v_invite.role,
    v_invite.status,
    v_invite.revoked_at;
end;
$$;

create or replace function app.accept_tenant_membership_invite(p_token text)
returns table (
  outcome text,
  invite_id uuid,
  tenant_id uuid,
  tenant_name text,
  email text,
  role text,
  accepted_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, app, extensions
as $$
declare
  v_user_id uuid;
  v_hash text;
  v_user_email text;
  v_normalized_user_email text;
  v_tenant_name text;
  v_inserted_count integer;
  v_invite record;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select u.email
  into v_user_email
  from auth.users u
  where u.id = v_user_id;

  v_normalized_user_email := app.normalize_tenant_membership_invite_email(v_user_email);
  if v_normalized_user_email = '' then
    raise exception 'invite_email_mismatch' using errcode = '22023';
  end if;

  v_hash := app.sha256_hex(p_token);

  select
    i.*,
    t.name as tenant_name_value
  into v_invite
  from public.tenant_membership_invites i
  join public.tenants t
    on t.id = i.tenant_id
  where i.token_hash = v_hash
  for update;

  if not found then
    raise exception 'tenant_membership_invite_not_found' using errcode = 'P0002';
  end if;

  v_tenant_name := v_invite.tenant_name_value;

  if v_invite.status = 'pending' and v_invite.expires_at <= now() then
    update public.tenant_membership_invites as i
    set status = 'expired'
    where i.id = v_invite.id
    returning *
    into v_invite;

    raise exception 'tenant_membership_invite_expired' using errcode = '22023';
  end if;

  if v_normalized_user_email <> v_invite.normalized_email then
    raise exception 'invite_email_mismatch' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.memberships m
    where m.tenant_id = v_invite.tenant_id
      and m.user_id = v_user_id
  ) then
    if v_invite.status = 'pending' then
      update public.tenant_membership_invites as i
      set status = 'accepted',
          accepted_by_user_id = v_user_id,
          accepted_at = coalesce(i.accepted_at, now())
      where i.id = v_invite.id
      returning *
      into v_invite;
    end if;

    return query
    select
      'already_member'::text,
      v_invite.id,
      v_invite.tenant_id,
      v_tenant_name,
      v_invite.email,
      v_invite.role,
      v_invite.accepted_at;
    return;
  end if;

  if v_invite.status = 'revoked' then
    raise exception 'tenant_membership_invite_revoked' using errcode = '22023';
  end if;

  if v_invite.status = 'expired' then
    raise exception 'tenant_membership_invite_expired' using errcode = '22023';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'tenant_membership_invite_unavailable' using errcode = '22023';
  end if;

  insert into public.memberships (
    tenant_id,
    user_id,
    role
  )
  values (
    v_invite.tenant_id,
    v_user_id,
    v_invite.role
  )
  on conflict on constraint memberships_pkey do nothing;

  get diagnostics v_inserted_count = row_count;

  update public.tenant_membership_invites as i
  set status = 'accepted',
      accepted_by_user_id = v_user_id,
      accepted_at = coalesce(i.accepted_at, now())
  where i.id = v_invite.id
  returning *
  into v_invite;

  return query
  select
    case
      when v_inserted_count > 0 then 'accepted'
      else 'already_member'
    end,
    v_invite.id,
    v_invite.tenant_id,
    v_tenant_name,
    v_invite.email,
    v_invite.role,
    v_invite.accepted_at;
end;
$$;

create or replace function public.get_public_tenant_membership_invite(p_token text)
returns table (
  invite_id uuid,
  tenant_id uuid,
  tenant_name text,
  email text,
  role text,
  status text,
  expires_at timestamptz,
  can_accept boolean
)
language sql
stable
security definer
set search_path = public, auth, app, extensions
as $$
  select *
  from app.get_public_tenant_membership_invite(p_token);
$$;

create or replace function public.create_or_refresh_tenant_membership_invite(
  p_tenant_id uuid,
  p_email text,
  p_role text,
  p_expires_at timestamptz default null
)
returns table (
  outcome text,
  invite_id uuid,
  tenant_id uuid,
  tenant_name text,
  email text,
  normalized_email text,
  role text,
  status text,
  expires_at timestamptz,
  last_sent_at timestamptz,
  invite_token text
)
language sql
security definer
set search_path = public, auth, app, extensions
as $$
  select *
  from app.create_or_refresh_tenant_membership_invite(
    p_tenant_id,
    p_email,
    p_role,
    p_expires_at
  );
$$;

create or replace function public.refresh_tenant_membership_invite(
  p_invite_id uuid,
  p_role text default null,
  p_expires_at timestamptz default null
)
returns table (
  outcome text,
  invite_id uuid,
  tenant_id uuid,
  tenant_name text,
  email text,
  normalized_email text,
  role text,
  status text,
  expires_at timestamptz,
  last_sent_at timestamptz,
  invite_token text
)
language sql
security definer
set search_path = public, auth, app, extensions
as $$
  select *
  from app.refresh_tenant_membership_invite(
    p_invite_id,
    p_role,
    p_expires_at
  );
$$;

create or replace function public.revoke_tenant_membership_invite(p_invite_id uuid)
returns table (
  outcome text,
  invite_id uuid,
  tenant_id uuid,
  email text,
  role text,
  status text,
  revoked_at timestamptz
)
language sql
security definer
set search_path = public, auth, app, extensions
as $$
  select *
  from app.revoke_tenant_membership_invite(p_invite_id);
$$;

create or replace function public.accept_tenant_membership_invite(p_token text)
returns table (
  outcome text,
  invite_id uuid,
  tenant_id uuid,
  tenant_name text,
  email text,
  role text,
  accepted_at timestamptz
)
language sql
security definer
set search_path = public, auth, app, extensions
as $$
  select *
  from app.accept_tenant_membership_invite(p_token);
$$;

revoke all on function app.normalize_tenant_membership_invite_email(text) from public;
revoke all on function app.get_public_tenant_membership_invite(text) from public;
revoke all on function app.create_or_refresh_tenant_membership_invite(uuid, text, text, timestamptz) from public;
revoke all on function app.refresh_tenant_membership_invite(uuid, text, timestamptz) from public;
revoke all on function app.revoke_tenant_membership_invite(uuid) from public;
revoke all on function app.accept_tenant_membership_invite(text) from public;

grant execute on function public.get_public_tenant_membership_invite(text) to anon, authenticated;
grant execute on function public.create_or_refresh_tenant_membership_invite(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.refresh_tenant_membership_invite(uuid, text, timestamptz) to authenticated;
grant execute on function public.revoke_tenant_membership_invite(uuid) to authenticated;
grant execute on function public.accept_tenant_membership_invite(text) to authenticated;
