create or replace function app.current_user_has_tenant_custom_role_capability(
  p_tenant_id uuid,
  p_capability_key text
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    p_capability_key in (
      'media_library.access',
      'media_library.manage_folders',
      'templates.manage',
      'profiles.view',
      'profiles.manage',
      'projects.create',
      'project_workspaces.manage',
      'organization_users.manage',
      'organization_users.invite'
    )
    and exists (
      select 1
      from public.memberships m
      join public.role_assignments ra
        on ra.tenant_id = m.tenant_id
       and ra.user_id = m.user_id
      join public.role_definitions rd
        on rd.id = ra.role_definition_id
      join public.role_definition_capabilities rdc
        on rdc.role_definition_id = rd.id
      where m.tenant_id = p_tenant_id
        and m.user_id = (select auth.uid())
        and ra.tenant_id = p_tenant_id
        and ra.user_id = (select auth.uid())
        and ra.scope_type = 'tenant'
        and ra.project_id is null
        and ra.workspace_id is null
        and ra.revoked_at is null
        and rd.is_system = false
        and rd.tenant_id = p_tenant_id
        and rd.archived_at is null
        and rdc.capability_key = p_capability_key
    );
$$;

create or replace function app.current_user_can_view_organization_users(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(app.current_user_membership_role(p_tenant_id) in ('owner', 'admin'), false)
    or app.current_user_has_tenant_custom_role_capability(
      p_tenant_id,
      'organization_users.manage'
    );
$$;

create or replace function app.current_user_can_invite_organization_users(
  p_tenant_id uuid,
  p_target_role text default null
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    case
      when p_target_role is not null
        and p_target_role not in ('admin', 'reviewer', 'photographer') then false
      when coalesce(app.current_user_membership_role(p_tenant_id) in ('owner', 'admin'), false) then true
      when p_target_role = 'admin' then false
      else app.current_user_has_tenant_custom_role_capability(
        p_tenant_id,
        'organization_users.invite'
      )
        and (
          p_target_role is null
          or p_target_role in ('reviewer', 'photographer')
        )
    end;
$$;

create or replace function app.current_user_can_manage_own_pending_organization_invite(
  p_tenant_id uuid,
  p_invite_id uuid,
  p_target_role text default null
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.tenant_membership_invites i
    where i.id = p_invite_id
      and i.tenant_id = p_tenant_id
      and (
        (
          coalesce(app.current_user_membership_role(i.tenant_id) in ('owner', 'admin'), false)
          and (
            p_target_role is null
            or p_target_role in ('admin', 'reviewer', 'photographer')
          )
        )
        or (
          i.status = 'pending'
          and i.expires_at > now()
          and i.invited_by_user_id = (select auth.uid())
          and i.role in ('reviewer', 'photographer')
          and (
            p_target_role is null
            or p_target_role in ('reviewer', 'photographer')
          )
          and app.current_user_has_tenant_custom_role_capability(
            i.tenant_id,
            'organization_users.invite'
          )
        )
      )
  );
$$;

create or replace function public.current_user_can_view_organization_users(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.current_user_can_view_organization_users(p_tenant_id);
$$;

create or replace function public.current_user_can_invite_organization_users(
  p_tenant_id uuid,
  p_target_role text default null
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.current_user_can_invite_organization_users(p_tenant_id, p_target_role);
$$;

drop policy if exists "memberships_select_organization_user_rows" on public.memberships;
create policy "memberships_select_organization_user_rows"
on public.memberships
for select
to authenticated
using (
  app.current_user_can_view_organization_users(tenant_id)
);

drop policy if exists "tenant_membership_invites_select_organization_user_rows" on public.tenant_membership_invites;
create policy "tenant_membership_invites_select_organization_user_rows"
on public.tenant_membership_invites
for select
to authenticated
using (
  app.current_user_can_view_organization_users(tenant_id)
  or (
    app.current_user_can_invite_organization_users(tenant_id, null)
    and invited_by_user_id = auth.uid()
    and role in ('reviewer', 'photographer')
    and status = 'pending'
  )
);

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
  v_can_manage_members boolean;
begin
  v_actor_user_id := auth.uid();
  if v_actor_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if p_role not in ('admin', 'reviewer', 'photographer') then
    raise exception 'invalid_membership_role' using errcode = '22023';
  end if;

  v_can_manage_members := app.current_user_can_manage_members(p_tenant_id);
  if not app.current_user_can_invite_organization_users(p_tenant_id, p_role) then
    raise exception 'organization_user_invite_forbidden' using errcode = '42501';
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

  select i.*
  into v_invite
  from public.tenant_membership_invites i
  where i.tenant_id = p_tenant_id
    and i.normalized_email = v_normalized_email
    and i.status = 'pending'
  for update;

  if found then
    if not v_can_manage_members and not (
      v_invite.invited_by_user_id = v_actor_user_id
      and v_invite.role in ('reviewer', 'photographer')
    ) then
      raise exception 'tenant_membership_invite_forbidden' using errcode = '42501';
    end if;

    if v_invite.expires_at <= now() then
      update public.tenant_membership_invites as i
      set status = 'expired'
      where i.id = v_invite.id;
      v_invite := null;
    end if;
  end if;

  v_plain_token := encode(gen_random_bytes(32), 'hex');

  if v_invite.id is not null then
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

        if not v_can_manage_members and not (
          v_invite.invited_by_user_id = v_actor_user_id
          and v_invite.role in ('reviewer', 'photographer')
        ) then
          raise exception 'tenant_membership_invite_forbidden' using errcode = '42501';
        end if;

        if v_invite.expires_at <= now() then
          update public.tenant_membership_invites as i
          set status = 'expired'
          where i.id = v_invite.id;

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
        else

          update public.tenant_membership_invites as i
          set email = v_trimmed_email,
              normalized_email = v_normalized_email,
              role = p_role,
              token_hash = app.sha256_hex(v_plain_token),
              expires_at = v_effective_expires_at,
              last_sent_at = now()
          where i.id = v_invite.id
          returning * into v_invite;
        end if;
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

  v_tenant_name := v_invite.tenant_name_value;
  v_effective_role := coalesce(p_role, v_invite.role);
  if v_effective_role not in ('admin', 'reviewer', 'photographer') then
    raise exception 'invalid_membership_role' using errcode = '22023';
  end if;

  if not app.current_user_can_manage_own_pending_organization_invite(
    v_invite.tenant_id,
    v_invite.id,
    v_effective_role
  ) then
    raise exception 'tenant_membership_invite_forbidden' using errcode = '42501';
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

  if not app.current_user_can_manage_own_pending_organization_invite(
    v_invite.tenant_id,
    v_invite.id,
    null
  ) then
    raise exception 'tenant_membership_invite_forbidden' using errcode = '42501';
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

revoke all on function app.current_user_can_view_organization_users(uuid) from public;
revoke all on function app.current_user_can_invite_organization_users(uuid, text) from public;
revoke all on function app.current_user_can_manage_own_pending_organization_invite(uuid, uuid, text) from public;
revoke all on function public.current_user_can_view_organization_users(uuid) from public;
revoke all on function public.current_user_can_invite_organization_users(uuid, text) from public;

grant execute on function app.current_user_can_view_organization_users(uuid) to authenticated;
grant execute on function app.current_user_can_invite_organization_users(uuid, text) to authenticated;
grant execute on function app.current_user_can_manage_own_pending_organization_invite(uuid, uuid, text) to authenticated;
grant execute on function public.current_user_can_view_organization_users(uuid) to authenticated;
grant execute on function public.current_user_can_invite_organization_users(uuid, text) to authenticated;
