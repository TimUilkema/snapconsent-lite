create extension if not exists pgcrypto;

create schema if not exists app;
grant usage on schema app to service_role;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'photographer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  unique (id, tenant_id)
);

create index if not exists projects_tenant_created_at_idx
  on public.projects (tenant_id, created_at desc);

create table if not exists public.subject_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  token_hash text not null unique,
  status text not null default 'active' check (status in ('active', 'expired', 'used', 'revoked')),
  expires_at timestamptz,
  max_uses integer not null default 1 check (max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0 and used_count <= max_uses),
  created_at timestamptz not null default now(),
  foreign key (project_id, tenant_id) references public.projects(id, tenant_id) on delete restrict,
  unique (id, project_id, tenant_id)
);

create index if not exists subject_invites_tenant_project_created_at_idx
  on public.subject_invites (tenant_id, project_id, created_at desc);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  email text not null,
  full_name text not null,
  created_at timestamptz not null default now(),
  foreign key (project_id, tenant_id) references public.projects(id, tenant_id) on delete restrict,
  unique (tenant_id, project_id, email),
  unique (id, project_id, tenant_id)
);

create index if not exists subjects_tenant_project_idx
  on public.subjects (tenant_id, project_id);

create table if not exists public.consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  subject_id uuid not null,
  invite_id uuid not null,
  consent_text text not null,
  consent_version text not null,
  signed_at timestamptz not null default now(),
  capture_ip inet,
  capture_user_agent text,
  revoked_at timestamptz,
  revoke_reason text,
  receipt_email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (invite_id),
  foreign key (project_id, tenant_id) references public.projects(id, tenant_id) on delete restrict,
  foreign key (subject_id, project_id, tenant_id) references public.subjects(id, project_id, tenant_id) on delete restrict,
  foreign key (invite_id, project_id, tenant_id) references public.subject_invites(id, project_id, tenant_id) on delete restrict,
  check (revoked_at is null or revoked_at >= signed_at),
  unique (id, tenant_id)
);

create index if not exists consents_tenant_project_signed_at_idx
  on public.consents (tenant_id, project_id, signed_at desc);

create table if not exists public.revoke_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  consent_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (consent_id),
  foreign key (consent_id, tenant_id) references public.consents(id, tenant_id) on delete restrict
);

create index if not exists revoke_tokens_tenant_expires_at_idx
  on public.revoke_tokens (tenant_id, expires_at);

create table if not exists public.consent_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  consent_id uuid not null,
  event_type text not null check (event_type in ('granted', 'revoked')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (consent_id, tenant_id) references public.consents(id, tenant_id) on delete restrict
);

create index if not exists consent_events_tenant_consent_created_at_idx
  on public.consent_events (tenant_id, consent_id, created_at desc);

create or replace function app.sha256_hex(p_input text)
returns text
language sql
immutable
strict
as $$
  select encode(digest(p_input, 'sha256'), 'hex');
$$;

create or replace function app.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select m.tenant_id
  from public.memberships m
  where m.user_id = auth.uid()
  order by m.created_at asc
  limit 1;
$$;

create or replace function app.ensure_tenant_for_current_user()
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
  v_tenant_id uuid;
  v_email text;
  v_name text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select m.tenant_id
  into v_tenant_id
  from public.memberships m
  where m.user_id = v_user_id
  order by m.created_at asc
  limit 1;

  if v_tenant_id is not null then
    return v_tenant_id;
  end if;

  select u.email
  into v_email
  from auth.users u
  where u.id = v_user_id;

  v_name := coalesce(nullif(split_part(coalesce(v_email, ''), '@', 1), ''), 'My Studio');

  insert into public.tenants (name)
  values (v_name)
  returning id into v_tenant_id;

  insert into public.memberships (tenant_id, user_id, role)
  values (v_tenant_id, v_user_id, 'owner');

  return v_tenant_id;
end;
$$;

create or replace function app.get_public_invite(p_token text)
returns table (
  invite_id uuid,
  project_id uuid,
  project_name text,
  expires_at timestamptz,
  status text,
  can_sign boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  v_hash := app.sha256_hex(p_token);

  return query
  select
    i.id,
    i.project_id,
    p.name,
    i.expires_at,
    i.status,
    (
      i.status = 'active'
      and (i.expires_at is null or i.expires_at > now())
      and i.used_count < i.max_uses
    ) as can_sign
  from public.subject_invites i
  join public.projects p on p.id = i.project_id and p.tenant_id = i.tenant_id
  where i.token_hash = v_hash
  limit 1;
end;
$$;

create or replace function app.submit_public_consent(
  p_token text,
  p_full_name text,
  p_email text,
  p_consent_text text,
  p_consent_version text,
  p_capture_ip inet,
  p_capture_user_agent text
)
returns table (
  consent_id uuid,
  duplicate boolean,
  revoke_token text,
  subject_email text,
  subject_name text,
  project_name text,
  signed_at timestamptz,
  tenant_id uuid,
  project_id uuid
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_invite record;
  v_subject public.subjects;
  v_existing_consent public.consents;
  v_revoke_token text;
begin
  v_hash := app.sha256_hex(p_token);

  select i.*, p.name as project_name_value
  into v_invite
  from public.subject_invites i
  join public.projects p on p.id = i.project_id and p.tenant_id = i.tenant_id
  where i.token_hash = v_hash
  for update;

  if not found then
    raise exception 'invalid_invite_token' using errcode = 'P0002';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    update public.subject_invites
    set status = 'expired'
    where id = v_invite.id
      and status = 'active';

    raise exception 'expired_invite_token' using errcode = '22023';
  end if;

  select c.*
  into v_existing_consent
  from public.consents c
  where c.invite_id = v_invite.id
  limit 1;

  if found then
    select s.*
    into v_subject
    from public.subjects s
    where s.id = v_existing_consent.subject_id;

    return query
    select
      v_existing_consent.id,
      true,
      null::text,
      v_subject.email,
      v_subject.full_name,
      v_invite.project_name_value,
      v_existing_consent.signed_at,
      v_existing_consent.tenant_id,
      v_existing_consent.project_id;

    return;
  end if;

  if v_invite.status <> 'active' or v_invite.used_count >= v_invite.max_uses then
    raise exception 'invite_unavailable' using errcode = '22023';
  end if;

  insert into public.subjects (tenant_id, project_id, email, full_name)
  values (v_invite.tenant_id, v_invite.project_id, lower(trim(p_email)), trim(p_full_name))
  on conflict (tenant_id, project_id, email)
  do update set full_name = excluded.full_name
  returning * into v_subject;

  insert into public.consents (
    tenant_id,
    project_id,
    subject_id,
    invite_id,
    consent_text,
    consent_version,
    capture_ip,
    capture_user_agent
  )
  values (
    v_invite.tenant_id,
    v_invite.project_id,
    v_subject.id,
    v_invite.id,
    p_consent_text,
    p_consent_version,
    p_capture_ip,
    p_capture_user_agent
  )
  returning * into v_existing_consent;

  v_revoke_token := encode(gen_random_bytes(32), 'hex');

  insert into public.revoke_tokens (tenant_id, consent_id, token_hash, expires_at)
  values (
    v_invite.tenant_id,
    v_existing_consent.id,
    app.sha256_hex(v_revoke_token),
    now() + interval '90 days'
  );

  update public.subject_invites
  set
    used_count = used_count + 1,
    status = case when used_count + 1 >= max_uses then 'used' else status end
  where id = v_invite.id;

  insert into public.consent_events (tenant_id, consent_id, event_type, payload)
  values (
    v_invite.tenant_id,
    v_existing_consent.id,
    'granted',
    jsonb_build_object('invite_id', v_invite.id)
  );

  return query
  select
    v_existing_consent.id,
    false,
    v_revoke_token,
    v_subject.email,
    v_subject.full_name,
    v_invite.project_name_value,
    v_existing_consent.signed_at,
    v_existing_consent.tenant_id,
    v_existing_consent.project_id;
end;
$$;

create or replace function app.mark_consent_receipt_sent(
  p_consent_id uuid,
  p_revoke_token text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.consents c
  set receipt_email_sent_at = coalesce(c.receipt_email_sent_at, now())
  where c.id = p_consent_id
    and exists (
      select 1
      from public.revoke_tokens rt
      where rt.consent_id = c.id
        and rt.token_hash = app.sha256_hex(p_revoke_token)
    );

  return found;
end;
$$;

create or replace function app.revoke_public_consent(
  p_token text,
  p_reason text default null
)
returns table (
  consent_id uuid,
  revoked boolean,
  already_revoked boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_token record;
  v_updated_consent_id uuid;
begin
  v_hash := app.sha256_hex(p_token);

  select rt.*, c.revoked_at
  into v_token
  from public.revoke_tokens rt
  join public.consents c on c.id = rt.consent_id and c.tenant_id = rt.tenant_id
  where rt.token_hash = v_hash
  for update;

  if not found then
    raise exception 'invalid_revoke_token' using errcode = 'P0002';
  end if;

  if v_token.consumed_at is not null then
    return query select v_token.consent_id, true, true;
    return;
  end if;

  if v_token.expires_at <= now() then
    raise exception 'expired_revoke_token' using errcode = '22023';
  end if;

  update public.revoke_tokens
  set consumed_at = now()
  where id = v_token.id;

  update public.consents
  set
    revoked_at = now(),
    revoke_reason = coalesce(nullif(trim(p_reason), ''), revoke_reason)
  where id = v_token.consent_id
    and revoked_at is null
  returning id into v_updated_consent_id;

  if v_updated_consent_id is not null then
    insert into public.consent_events (tenant_id, consent_id, event_type, payload)
    values (
      v_token.tenant_id,
      v_token.consent_id,
      'revoked',
      jsonb_build_object('reason', nullif(trim(p_reason), ''))
    );

    return query select v_token.consent_id, true, false;
  else
    return query select v_token.consent_id, true, true;
  end if;
end;
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public, app, extensions
as $$
  select app.current_tenant_id();
$$;

create or replace function public.ensure_tenant_for_current_user()
returns uuid
language sql
stable
security definer
set search_path = public, app, extensions
as $$
  select app.ensure_tenant_for_current_user();
$$;

create or replace function public.get_public_invite(p_token text)
returns table (
  invite_id uuid,
  project_id uuid,
  project_name text,
  expires_at timestamptz,
  status text,
  can_sign boolean
)
language sql
stable
security definer
set search_path = public, app, extensions
as $$
  select * from app.get_public_invite(p_token);
$$;

create or replace function public.submit_public_consent(
  p_token text,
  p_full_name text,
  p_email text,
  p_consent_text text,
  p_consent_version text,
  p_capture_ip inet,
  p_capture_user_agent text
)
returns table (
  consent_id uuid,
  duplicate boolean,
  revoke_token text,
  subject_email text,
  subject_name text,
  project_name text,
  signed_at timestamptz,
  tenant_id uuid,
  project_id uuid
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.submit_public_consent(
    p_token,
    p_full_name,
    p_email,
    p_consent_text,
    p_consent_version,
    p_capture_ip,
    p_capture_user_agent
  );
$$;

create or replace function public.mark_consent_receipt_sent(
  p_consent_id uuid,
  p_revoke_token text
)
returns boolean
language sql
security definer
set search_path = public, app, extensions
as $$
  select app.mark_consent_receipt_sent(p_consent_id, p_revoke_token);
$$;

create or replace function public.revoke_public_consent(
  p_token text,
  p_reason text default null
)
returns table (
  consent_id uuid,
  revoked boolean,
  already_revoked boolean
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select * from app.revoke_public_consent(p_token, p_reason);
$$;

revoke all on function app.current_tenant_id() from public;
revoke all on function app.ensure_tenant_for_current_user() from public;
revoke all on function app.get_public_invite(text) from public;
revoke all on function app.submit_public_consent(text, text, text, text, text, inet, text) from public;
revoke all on function app.mark_consent_receipt_sent(uuid, text) from public;
revoke all on function app.revoke_public_consent(text, text) from public;

grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.ensure_tenant_for_current_user() to authenticated;
grant execute on function public.get_public_invite(text) to anon, authenticated;
grant execute on function public.submit_public_consent(text, text, text, text, text, inet, text) to anon, authenticated;
grant execute on function public.mark_consent_receipt_sent(uuid, text) to anon, authenticated;
grant execute on function public.revoke_public_consent(text, text) to anon, authenticated;
