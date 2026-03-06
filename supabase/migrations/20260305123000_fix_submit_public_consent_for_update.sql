create or replace function app.submit_public_consent(
  p_token text,
  p_full_name text,
  p_email text,
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
  project_id uuid,
  consent_text text,
  consent_version text
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

  select i.*, p.name as project_name_value, t.body as template_body, t.version as template_version
  into v_invite
  from public.subject_invites i
  join public.projects p on p.id = i.project_id and p.tenant_id = i.tenant_id
  left join public.consent_templates t on t.id = i.consent_template_id
  where i.token_hash = v_hash
  for update of i;

  if not found then
    raise exception 'invalid_invite_token' using errcode = 'P0002';
  end if;

  if v_invite.template_body is null or v_invite.template_version is null then
    raise exception 'invite_missing_template' using errcode = '22023';
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
      v_existing_consent.project_id,
      v_existing_consent.consent_text,
      v_existing_consent.consent_version;

    return;
  end if;

  if v_invite.status <> 'active' or v_invite.used_count >= v_invite.max_uses then
    raise exception 'invite_unavailable' using errcode = '22023';
  end if;

  insert into public.subjects (tenant_id, project_id, email, full_name)
  values (v_invite.tenant_id, v_invite.project_id, lower(trim(p_email)), trim(p_full_name))
  on conflict on constraint subjects_tenant_id_project_id_email_key
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
    v_invite.template_body,
    v_invite.template_version,
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
    v_existing_consent.project_id,
    v_existing_consent.consent_text,
    v_existing_consent.consent_version;
end;
$$;
