create or replace function app.replace_recurring_profile_baseline_request(
  p_profile_id uuid,
  p_request_id uuid,
  p_new_request_id uuid,
  p_new_token_hash text,
  p_expires_at timestamptz
)
returns table (
  request_id uuid,
  tenant_id uuid,
  profile_id uuid,
  consent_template_id uuid,
  status text,
  expires_at timestamptz,
  profile_email_snapshot text,
  replaced_request_id uuid,
  replaced_status text,
  replaced_superseded_by_request_id uuid,
  replaced_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_profile public.recurring_profiles;
  v_request public.recurring_profile_consent_requests;
  v_active_pending public.recurring_profile_consent_requests;
  v_new_request public.recurring_profile_consent_requests;
begin
  if auth.uid() is null then
    raise exception 'recurring_profile_management_forbidden' using errcode = '42501';
  end if;

  if p_profile_id is null or p_request_id is null or p_new_request_id is null
    or p_new_token_hash is null or p_expires_at is null then
    raise exception 'invalid_input' using errcode = '23514';
  end if;

  select *
  into v_profile
  from public.recurring_profiles rp
  where rp.id = p_profile_id
  for update;

  if not found then
    raise exception 'baseline_consent_request_not_found' using errcode = 'P0002';
  end if;

  if not app.current_user_can_manage_recurring_profiles(v_profile.tenant_id) then
    raise exception 'recurring_profile_management_forbidden' using errcode = '42501';
  end if;

  select *
  into v_request
  from public.recurring_profile_consent_requests r
  where r.id = p_request_id
    and r.tenant_id = v_profile.tenant_id
    and r.profile_id = v_profile.id
    and r.consent_kind = 'baseline'
  for update;

  if not found then
    raise exception 'baseline_consent_request_not_found' using errcode = 'P0002';
  end if;

  if v_request.status = 'pending' and v_request.expires_at <= now() then
    update public.recurring_profile_consent_requests r
    set
      status = 'expired',
      updated_at = now()
    where r.id = v_request.id
      and r.status = 'pending'
    returning * into v_request;
  end if;

  if v_profile.status <> 'active' then
    raise exception 'recurring_profile_archived' using errcode = '23514';
  end if;

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

  if v_request.status <> 'pending' then
    raise exception 'baseline_consent_request_not_pending' using errcode = '22023';
  end if;

  select *
  into v_active_pending
  from public.recurring_profile_consent_requests r
  where r.tenant_id = v_profile.tenant_id
    and r.profile_id = v_profile.id
    and r.consent_kind = 'baseline'
    and r.status = 'pending'
  limit 1;

  if not found or v_active_pending.id <> v_request.id then
    raise exception 'baseline_consent_request_not_pending' using errcode = '22023';
  end if;

  update public.recurring_profile_consent_requests r
  set
    status = 'superseded',
    updated_at = now()
  where r.id = v_request.id
    and r.status = 'pending'
  returning * into v_request;

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
    p_new_request_id,
    v_profile.tenant_id,
    v_profile.id,
    'baseline',
    v_request.consent_template_id,
    v_profile.full_name,
    v_profile.email,
    p_new_token_hash,
    'pending',
    p_expires_at,
    auth.uid()
  )
  returning * into v_new_request;

  update public.recurring_profile_consent_requests r
  set superseded_by_request_id = p_new_request_id
  where r.id = v_request.id
  returning * into v_request;

  return query
  select
    v_new_request.id,
    v_new_request.tenant_id,
    v_new_request.profile_id,
    v_new_request.consent_template_id,
    v_new_request.status,
    v_new_request.expires_at,
    v_new_request.profile_email_snapshot,
    v_request.id,
    v_request.status,
    v_request.superseded_by_request_id,
    v_request.updated_at;
end;
$$;
