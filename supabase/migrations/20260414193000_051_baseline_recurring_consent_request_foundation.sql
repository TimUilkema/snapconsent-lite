create unique index if not exists recurring_profiles_id_tenant_unique_idx
  on public.recurring_profiles (id, tenant_id);

create table if not exists public.recurring_profile_consent_requests (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null,
  consent_kind text not null check (consent_kind in ('baseline')),
  consent_template_id uuid not null references public.consent_templates(id) on delete restrict,
  profile_name_snapshot text not null,
  profile_email_snapshot text not null,
  token_hash text not null unique,
  status text not null check (status in ('pending', 'signed', 'expired', 'superseded', 'cancelled')),
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  superseded_by_request_id uuid null,
  constraint recurring_profile_consent_requests_profile_fkey foreign key (profile_id, tenant_id)
    references public.recurring_profiles (id, tenant_id)
    on delete restrict,
  constraint recurring_profile_consent_requests_superseded_by_fkey foreign key (superseded_by_request_id)
    references public.recurring_profile_consent_requests (id)
    on delete set null
);

create unique index if not exists recurring_profile_consent_requests_id_tenant_unique_idx
  on public.recurring_profile_consent_requests (id, tenant_id);

create unique index if not exists recurring_profile_consent_requests_active_pending_unique_idx
  on public.recurring_profile_consent_requests (tenant_id, profile_id, consent_kind)
  where status = 'pending';

create index if not exists recurring_profile_consent_requests_profile_created_at_idx
  on public.recurring_profile_consent_requests (tenant_id, profile_id, created_at desc);

create index if not exists recurring_profile_consent_requests_token_hash_idx
  on public.recurring_profile_consent_requests (token_hash);

create table if not exists public.recurring_profile_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null,
  request_id uuid not null,
  consent_kind text not null check (consent_kind in ('baseline')),
  consent_template_id uuid not null references public.consent_templates(id) on delete restrict,
  profile_name_snapshot text not null,
  profile_email_snapshot text not null,
  consent_text text not null,
  consent_version text not null,
  structured_fields_snapshot jsonb not null,
  signed_at timestamptz not null default now(),
  capture_ip inet null,
  capture_user_agent text null,
  revoked_at timestamptz null,
  revoke_reason text null,
  receipt_email_sent_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint recurring_profile_consents_profile_fkey foreign key (profile_id, tenant_id)
    references public.recurring_profiles (id, tenant_id)
    on delete restrict,
  constraint recurring_profile_consents_request_fkey foreign key (request_id, tenant_id)
    references public.recurring_profile_consent_requests (id, tenant_id)
    on delete restrict,
  constraint recurring_profile_consents_request_unique unique (request_id),
  constraint recurring_profile_consents_structured_snapshot_object_check
    check (jsonb_typeof(structured_fields_snapshot) = 'object'),
  constraint recurring_profile_consents_revoke_timeline_check
    check (revoked_at is null or revoked_at >= signed_at)
);

create unique index if not exists recurring_profile_consents_id_tenant_unique_idx
  on public.recurring_profile_consents (id, tenant_id);

create unique index if not exists recurring_profile_consents_active_signed_unique_idx
  on public.recurring_profile_consents (tenant_id, profile_id, consent_kind)
  where revoked_at is null;

create index if not exists recurring_profile_consents_profile_signed_at_idx
  on public.recurring_profile_consents (tenant_id, profile_id, signed_at desc);

create table if not exists public.recurring_profile_consent_revoke_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  consent_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint recurring_profile_consent_revoke_tokens_consent_unique unique (consent_id),
  constraint recurring_profile_consent_revoke_tokens_consent_fkey foreign key (consent_id, tenant_id)
    references public.recurring_profile_consents (id, tenant_id)
    on delete restrict
);

create index if not exists recurring_profile_consent_revoke_tokens_tenant_expires_at_idx
  on public.recurring_profile_consent_revoke_tokens (tenant_id, expires_at);

create table if not exists public.recurring_profile_consent_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  consent_id uuid not null,
  event_type text not null check (event_type in ('granted', 'revoked')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint recurring_profile_consent_events_consent_fkey foreign key (consent_id, tenant_id)
    references public.recurring_profile_consents (id, tenant_id)
    on delete restrict
);

create index if not exists recurring_profile_consent_events_consent_created_at_idx
  on public.recurring_profile_consent_events (tenant_id, consent_id, created_at asc);

create or replace function app.touch_recurring_profile_consent_request_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app.cancel_pending_recurring_profile_consent_requests()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if tg_op = 'UPDATE'
    and old.status = 'active'
    and new.status = 'archived' then
    update public.recurring_profile_consent_requests
    set
      status = 'cancelled',
      updated_at = now()
    where tenant_id = new.tenant_id
      and profile_id = new.id
      and consent_kind = 'baseline'
      and status = 'pending';
  end if;

  return new;
end;
$$;

drop trigger if exists recurring_profile_consent_requests_touch_updated_at
  on public.recurring_profile_consent_requests;
create trigger recurring_profile_consent_requests_touch_updated_at
before update on public.recurring_profile_consent_requests
for each row
execute function app.touch_recurring_profile_consent_request_updated_at();

drop trigger if exists recurring_profiles_cancel_pending_consent_requests
  on public.recurring_profiles;
create trigger recurring_profiles_cancel_pending_consent_requests
after update on public.recurring_profiles
for each row
execute function app.cancel_pending_recurring_profile_consent_requests();

alter table public.recurring_profile_consent_requests enable row level security;
alter table public.recurring_profile_consents enable row level security;
alter table public.recurring_profile_consent_revoke_tokens enable row level security;
alter table public.recurring_profile_consent_events enable row level security;

create policy "recurring_profile_consent_requests_select_member"
on public.recurring_profile_consent_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = recurring_profile_consent_requests.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "recurring_profile_consents_select_member"
on public.recurring_profile_consents
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = recurring_profile_consents.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "recurring_profile_consent_events_select_member"
on public.recurring_profile_consent_events
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = recurring_profile_consent_events.tenant_id
      and m.user_id = auth.uid()
  )
);

create or replace function app.create_recurring_profile_baseline_request(
  p_profile_id uuid,
  p_consent_template_id uuid,
  p_request_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns table (
  request_id uuid,
  tenant_id uuid,
  profile_id uuid,
  consent_template_id uuid,
  status text,
  expires_at timestamptz,
  reused_existing boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_profile public.recurring_profiles;
  v_template public.consent_templates;
  v_existing_pending public.recurring_profile_consent_requests;
begin
  if auth.uid() is null then
    raise exception 'recurring_profile_management_forbidden' using errcode = '42501';
  end if;

  if p_request_id is null or p_token_hash is null or p_expires_at is null then
    raise exception 'invalid_input' using errcode = '23514';
  end if;

  select *
  into v_profile
  from public.recurring_profiles rp
  where rp.id = p_profile_id
  for update;

  if not found then
    raise exception 'recurring_profile_not_found' using errcode = 'P0002';
  end if;

  if not app.current_user_can_manage_recurring_profiles(v_profile.tenant_id) then
    raise exception 'recurring_profile_management_forbidden' using errcode = '42501';
  end if;

  if v_profile.status <> 'active' then
    raise exception 'recurring_profile_archived' using errcode = '23514';
  end if;

  select *
  into v_template
  from public.consent_templates t
  where t.id = p_consent_template_id
  limit 1;

  if not found then
    raise exception 'template_not_found' using errcode = 'P0002';
  end if;

  if v_template.status <> 'published'
    or (v_template.tenant_id is not null and v_template.tenant_id <> v_profile.tenant_id)
    or v_template.body is null
    or v_template.version is null
    or v_template.structured_fields_definition is null then
    raise exception 'baseline_template_unavailable' using errcode = '23514';
  end if;

  update public.recurring_profile_consent_requests r
  set
    status = 'expired',
    updated_at = now()
  where r.tenant_id = v_profile.tenant_id
    and r.profile_id = v_profile.id
    and r.consent_kind = 'baseline'
    and r.status = 'pending'
    and r.expires_at <= now();

  if exists (
    select 1
    from public.recurring_profile_consents c
    where c.tenant_id = v_profile.tenant_id
      and c.profile_id = v_profile.id
      and c.consent_kind = 'baseline'
      and c.revoked_at is null
  ) then
    raise exception 'baseline_consent_already_signed' using errcode = '23505';
  end if;

  select *
  into v_existing_pending
  from public.recurring_profile_consent_requests r
  where r.tenant_id = v_profile.tenant_id
    and r.profile_id = v_profile.id
    and r.consent_kind = 'baseline'
    and r.status = 'pending'
  limit 1;

  if found then
    return query
    select
      v_existing_pending.id,
      v_existing_pending.tenant_id,
      v_existing_pending.profile_id,
      v_existing_pending.consent_template_id,
      v_existing_pending.status,
      v_existing_pending.expires_at,
      true;
    return;
  end if;

  begin
    insert into public.recurring_profile_consent_requests (
      id,
      tenant_id,
      profile_id,
      consent_kind,
      consent_template_id,
      profile_name_snapshot,
      profile_email_snapshot,
      token_hash,
      status,
      expires_at,
      created_by
    )
    values (
      p_request_id,
      v_profile.tenant_id,
      v_profile.id,
      'baseline',
      v_template.id,
      v_profile.full_name,
      v_profile.email,
      p_token_hash,
      'pending',
      p_expires_at,
      auth.uid()
    );
  exception
    when unique_violation then
      select *
      into v_existing_pending
      from public.recurring_profile_consent_requests r
      where r.tenant_id = v_profile.tenant_id
        and r.profile_id = v_profile.id
        and r.consent_kind = 'baseline'
        and r.status = 'pending'
      limit 1;

      if found then
        return query
        select
          v_existing_pending.id,
          v_existing_pending.tenant_id,
          v_existing_pending.profile_id,
          v_existing_pending.consent_template_id,
          v_existing_pending.status,
          v_existing_pending.expires_at,
          true;
        return;
      end if;

      raise;
  end;

  return query
  select
    p_request_id,
    v_profile.tenant_id,
    v_profile.id,
    v_template.id,
    'pending'::text,
    p_expires_at,
    false;
end;
$$;

create or replace function app.get_public_recurring_profile_consent_request(p_token text)
returns table (
  request_id uuid,
  profile_id uuid,
  profile_name text,
  profile_email text,
  expires_at timestamptz,
  request_status text,
  can_sign boolean,
  consent_text text,
  consent_version text,
  template_name text,
  structured_fields_definition jsonb,
  form_layout_definition jsonb
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  v_hash := app.sha256_hex(p_token);

  update public.recurring_profile_consent_requests r
  set
    status = 'expired',
    updated_at = now()
  where r.token_hash = v_hash
    and r.status = 'pending'
    and r.expires_at <= now();

  return query
  select
    r.id,
    r.profile_id,
    r.profile_name_snapshot,
    r.profile_email_snapshot,
    r.expires_at,
    r.status,
    (
      r.status = 'pending'
      and r.expires_at > now()
      and rp.status = 'active'
      and t.body is not null
      and t.version is not null
      and t.structured_fields_definition is not null
    ) as can_sign,
    t.body,
    t.version,
    t.name,
    t.structured_fields_definition,
    t.form_layout_definition
  from public.recurring_profile_consent_requests r
  join public.recurring_profiles rp
    on rp.id = r.profile_id
   and rp.tenant_id = r.tenant_id
  left join public.consent_templates t
    on t.id = r.consent_template_id
  where r.token_hash = v_hash
  limit 1;
end;
$$;

create or replace function app.submit_public_recurring_profile_consent(
  p_token text,
  p_full_name text,
  p_email text,
  p_capture_ip inet,
  p_capture_user_agent text,
  p_structured_field_values jsonb default null
)
returns table (
  consent_id uuid,
  duplicate boolean,
  revoke_token text,
  profile_email text,
  profile_name text,
  signed_at timestamptz,
  tenant_id uuid,
  request_id uuid,
  consent_text text,
  consent_version text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_request record;
  v_existing_consent public.recurring_profile_consents;
  v_revoke_token text;
  v_normalized_structured_values jsonb;
  v_structured_fields_snapshot jsonb;
begin
  v_hash := app.sha256_hex(p_token);

  select
    r.*,
    rp.status as profile_status,
    t.body as template_body,
    t.version as template_version,
    t.version_number as template_version_number,
    t.template_key as template_key_value,
    t.name as template_name_value,
    t.structured_fields_definition as template_structured_fields_definition
  into v_request
  from public.recurring_profile_consent_requests r
  join public.recurring_profiles rp
    on rp.id = r.profile_id
   and rp.tenant_id = r.tenant_id
  left join public.consent_templates t
    on t.id = r.consent_template_id
  where r.token_hash = v_hash
  for update of r;

  if not found then
    raise exception 'invalid_recurring_profile_request_token' using errcode = 'P0002';
  end if;

  if v_request.status = 'signed' then
    select *
    into v_existing_consent
    from public.recurring_profile_consents c
    where c.request_id = v_request.id
    limit 1;

    if found then
      return query
      select
        v_existing_consent.id,
        true,
        null::text,
        v_existing_consent.profile_email_snapshot,
        v_existing_consent.profile_name_snapshot,
        v_existing_consent.signed_at,
        v_existing_consent.tenant_id,
        v_existing_consent.request_id,
        v_existing_consent.consent_text,
        v_existing_consent.consent_version;
      return;
    end if;

    raise exception 'recurring_profile_request_unavailable' using errcode = '22023';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'recurring_profile_request_unavailable' using errcode = '22023';
  end if;

  if v_request.expires_at <= now() then
    update public.recurring_profile_consent_requests
    set
      status = 'expired',
      updated_at = now()
    where id = v_request.id
      and status = 'pending';

    raise exception 'expired_recurring_profile_request_token' using errcode = '22023';
  end if;

  if v_request.profile_status <> 'active' then
    raise exception 'recurring_profile_request_unavailable' using errcode = '22023';
  end if;

  if v_request.template_body is null
    or v_request.template_version is null
    or v_request.template_structured_fields_definition is null then
    raise exception 'recurring_profile_request_unavailable' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.recurring_profile_consents c
    where c.tenant_id = v_request.tenant_id
      and c.profile_id = v_request.profile_id
      and c.consent_kind = 'baseline'
      and c.revoked_at is null
  ) then
    raise exception 'recurring_profile_request_unavailable' using errcode = '22023';
  end if;

  if char_length(regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g')) < 2 then
    raise exception 'invalid_profile_name' using errcode = '23514';
  end if;

  if app.normalize_recurring_profile_email(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid_profile_email' using errcode = '23514';
  end if;

  v_normalized_structured_values := app.validate_submitted_structured_field_values(
    v_request.template_structured_fields_definition,
    p_structured_field_values
  );

  v_structured_fields_snapshot := jsonb_build_object(
    'schemaVersion', 1,
    'templateSnapshot', jsonb_build_object(
      'templateId', v_request.consent_template_id,
      'templateKey', v_request.template_key_value,
      'name', v_request.template_name_value,
      'version', v_request.template_version,
      'versionNumber', v_request.template_version_number
    ),
    'definition', v_request.template_structured_fields_definition,
    'values', v_normalized_structured_values
  );

  insert into public.recurring_profile_consents (
    tenant_id,
    profile_id,
    request_id,
    consent_kind,
    consent_template_id,
    profile_name_snapshot,
    profile_email_snapshot,
    consent_text,
    consent_version,
    structured_fields_snapshot,
    capture_ip,
    capture_user_agent
  )
  values (
    v_request.tenant_id,
    v_request.profile_id,
    v_request.id,
    'baseline',
    v_request.consent_template_id,
    v_request.profile_name_snapshot,
    v_request.profile_email_snapshot,
    v_request.template_body,
    v_request.template_version,
    v_structured_fields_snapshot,
    p_capture_ip,
    p_capture_user_agent
  )
  returning * into v_existing_consent;

  v_revoke_token := encode(gen_random_bytes(32), 'hex');

  insert into public.recurring_profile_consent_revoke_tokens (
    tenant_id,
    consent_id,
    token_hash,
    expires_at
  )
  values (
    v_request.tenant_id,
    v_existing_consent.id,
    app.sha256_hex(v_revoke_token),
    now() + interval '90 days'
  );

  update public.recurring_profile_consent_requests
  set
    status = 'signed',
    updated_at = now()
  where id = v_request.id;

  insert into public.recurring_profile_consent_events (
    tenant_id,
    consent_id,
    event_type,
    payload
  )
  values (
    v_request.tenant_id,
    v_existing_consent.id,
    'granted',
    jsonb_build_object('request_id', v_request.id)
  );

  return query
  select
    v_existing_consent.id,
    false,
    v_revoke_token,
    v_existing_consent.profile_email_snapshot,
    v_existing_consent.profile_name_snapshot,
    v_existing_consent.signed_at,
    v_existing_consent.tenant_id,
    v_existing_consent.request_id,
    v_existing_consent.consent_text,
    v_existing_consent.consent_version;
end;
$$;

create or replace function app.get_public_recurring_profile_revoke_token(p_token text)
returns table (
  consent_id uuid,
  profile_name text,
  profile_email text,
  revoked_at timestamptz,
  expires_at timestamptz,
  consumed_at timestamptz,
  status text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  v_hash := app.sha256_hex(p_token);

  return query
  select
    c.id,
    c.profile_name_snapshot,
    c.profile_email_snapshot,
    c.revoked_at,
    rt.expires_at,
    rt.consumed_at,
    case
      when rt.consumed_at is not null or c.revoked_at is not null then 'revoked'
      when rt.expires_at <= now() then 'expired'
      else 'available'
    end as status
  from public.recurring_profile_consent_revoke_tokens rt
  join public.recurring_profile_consents c
    on c.id = rt.consent_id
   and c.tenant_id = rt.tenant_id
  where rt.token_hash = v_hash
  limit 1;
end;
$$;

create or replace function app.mark_recurring_profile_consent_receipt_sent(
  p_consent_id uuid,
  p_revoke_token text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.recurring_profile_consents c
  set receipt_email_sent_at = coalesce(c.receipt_email_sent_at, now())
  where c.id = p_consent_id
    and exists (
      select 1
      from public.recurring_profile_consent_revoke_tokens rt
      where rt.consent_id = c.id
        and rt.token_hash = app.sha256_hex(p_revoke_token)
    );

  return found;
end;
$$;

create or replace function app.revoke_public_recurring_profile_consent(
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

  select rt.*, c.revoked_at, c.tenant_id
  into v_token
  from public.recurring_profile_consent_revoke_tokens rt
  join public.recurring_profile_consents c
    on c.id = rt.consent_id
   and c.tenant_id = rt.tenant_id
  where rt.token_hash = v_hash
  for update of rt;

  if not found then
    raise exception 'invalid_recurring_profile_revoke_token' using errcode = 'P0002';
  end if;

  if v_token.consumed_at is not null or v_token.revoked_at is not null then
    return query select v_token.consent_id, true, true;
    return;
  end if;

  if v_token.expires_at <= now() then
    raise exception 'expired_recurring_profile_revoke_token' using errcode = '22023';
  end if;

  update public.recurring_profile_consent_revoke_tokens
  set consumed_at = now()
  where id = v_token.id;

  update public.recurring_profile_consents
  set
    revoked_at = now(),
    revoke_reason = coalesce(nullif(trim(p_reason), ''), revoke_reason)
  where id = v_token.consent_id
    and revoked_at is null
  returning id into v_updated_consent_id;

  if v_updated_consent_id is not null then
    insert into public.recurring_profile_consent_events (
      tenant_id,
      consent_id,
      event_type,
      payload
    )
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

create or replace function public.create_recurring_profile_baseline_request(
  p_profile_id uuid,
  p_consent_template_id uuid,
  p_request_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns table (
  request_id uuid,
  tenant_id uuid,
  profile_id uuid,
  consent_template_id uuid,
  status text,
  expires_at timestamptz,
  reused_existing boolean
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.create_recurring_profile_baseline_request(
    p_profile_id,
    p_consent_template_id,
    p_request_id,
    p_token_hash,
    p_expires_at
  );
$$;

create or replace function public.get_public_recurring_profile_consent_request(p_token text)
returns table (
  request_id uuid,
  profile_id uuid,
  profile_name text,
  profile_email text,
  expires_at timestamptz,
  request_status text,
  can_sign boolean,
  consent_text text,
  consent_version text,
  template_name text,
  structured_fields_definition jsonb,
  form_layout_definition jsonb
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select * from app.get_public_recurring_profile_consent_request(p_token);
$$;

create or replace function public.submit_public_recurring_profile_consent(
  p_token text,
  p_full_name text,
  p_email text,
  p_capture_ip inet,
  p_capture_user_agent text,
  p_structured_field_values jsonb default null
)
returns table (
  consent_id uuid,
  duplicate boolean,
  revoke_token text,
  profile_email text,
  profile_name text,
  signed_at timestamptz,
  tenant_id uuid,
  request_id uuid,
  consent_text text,
  consent_version text
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.submit_public_recurring_profile_consent(
    p_token,
    p_full_name,
    p_email,
    p_capture_ip,
    p_capture_user_agent,
    p_structured_field_values
  );
$$;

create or replace function public.get_public_recurring_profile_revoke_token(p_token text)
returns table (
  consent_id uuid,
  profile_name text,
  profile_email text,
  revoked_at timestamptz,
  expires_at timestamptz,
  consumed_at timestamptz,
  status text
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select * from app.get_public_recurring_profile_revoke_token(p_token);
$$;

create or replace function public.mark_recurring_profile_consent_receipt_sent(
  p_consent_id uuid,
  p_revoke_token text
)
returns boolean
language sql
security definer
set search_path = public, app, extensions
as $$
  select app.mark_recurring_profile_consent_receipt_sent(p_consent_id, p_revoke_token);
$$;

create or replace function public.revoke_public_recurring_profile_consent(
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
  select * from app.revoke_public_recurring_profile_consent(p_token, p_reason);
$$;

revoke all on function app.touch_recurring_profile_consent_request_updated_at() from public;
revoke all on function app.cancel_pending_recurring_profile_consent_requests() from public;
revoke all on function app.create_recurring_profile_baseline_request(uuid, uuid, uuid, text, timestamptz) from public;
revoke all on function app.get_public_recurring_profile_consent_request(text) from public;
revoke all on function app.submit_public_recurring_profile_consent(text, text, text, inet, text, jsonb) from public;
revoke all on function app.get_public_recurring_profile_revoke_token(text) from public;
revoke all on function app.mark_recurring_profile_consent_receipt_sent(uuid, text) from public;
revoke all on function app.revoke_public_recurring_profile_consent(text, text) from public;

grant execute on function public.create_recurring_profile_baseline_request(uuid, uuid, uuid, text, timestamptz) to authenticated;
grant execute on function public.get_public_recurring_profile_consent_request(text) to anon, authenticated;
grant execute on function public.submit_public_recurring_profile_consent(text, text, text, inet, text, jsonb) to anon, authenticated;
grant execute on function public.get_public_recurring_profile_revoke_token(text) to anon, authenticated;
grant execute on function public.mark_recurring_profile_consent_receipt_sent(uuid, text) to anon, authenticated;
grant execute on function public.revoke_public_recurring_profile_consent(text, text) to anon, authenticated;
