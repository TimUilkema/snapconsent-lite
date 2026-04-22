create or replace function app.submit_public_consent(
  p_token text,
  p_full_name text,
  p_email text,
  p_capture_ip inet,
  p_capture_user_agent text,
  p_face_match_opt_in boolean default false,
  p_headshot_asset_id uuid default null,
  p_structured_field_values jsonb default null
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
  v_prior_consent public.consents;
  v_upgrade_request public.project_consent_upgrade_requests;
  v_revoke_token text;
  v_normalized_structured_values jsonb;
  v_structured_fields_snapshot jsonb;
  v_reused_headshot_asset_id uuid;
  v_normalized_full_name text;
  v_normalized_email text;
begin
  v_hash := app.sha256_hex(p_token);

  select
    i.*,
    p.name as project_name_value,
    t.body as template_body,
    t.version as template_version,
    t.version_number as template_version_number,
    t.template_key as template_key_value,
    t.name as template_name_value,
    t.structured_fields_definition as template_structured_fields_definition
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

  v_normalized_full_name := trim(p_full_name);
  v_normalized_email := lower(trim(p_email));

  select *
  into v_upgrade_request
  from public.project_consent_upgrade_requests r
  where r.tenant_id = v_invite.tenant_id
    and r.project_id = v_invite.project_id
    and r.invite_id = v_invite.id
    and r.status = 'pending'
  for update;

  if found then
    select *
    into v_prior_consent
    from public.consents c
    where c.id = v_upgrade_request.prior_consent_id
      and c.tenant_id = v_invite.tenant_id
      and c.project_id = v_invite.project_id
    for update;

    if not found or v_prior_consent.subject_id <> v_upgrade_request.subject_id then
      raise exception 'invite_unavailable' using errcode = '22023';
    end if;

    select *
    into v_subject
    from public.subjects s
    where s.id = v_upgrade_request.subject_id
      and s.tenant_id = v_invite.tenant_id
      and s.project_id = v_invite.project_id
    for update;

    if not found then
      raise exception 'invite_unavailable' using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.subjects s
      where s.tenant_id = v_invite.tenant_id
        and s.project_id = v_invite.project_id
        and s.email = v_normalized_email
        and s.id <> v_subject.id
    ) then
      raise exception 'subject_email_in_use' using errcode = '23505';
    end if;

    update public.subjects
    set
      email = v_normalized_email,
      full_name = v_normalized_full_name
    where id = v_subject.id
    returning * into v_subject;
  else
    insert into public.subjects (tenant_id, project_id, email, full_name)
    values (v_invite.tenant_id, v_invite.project_id, v_normalized_email, v_normalized_full_name)
    on conflict on constraint subjects_tenant_id_project_id_email_key
    do update set full_name = excluded.full_name
    returning * into v_subject;
  end if;

  if coalesce(p_face_match_opt_in, false) = false and p_headshot_asset_id is not null then
    raise exception 'headshot_requires_face_match_opt_in' using errcode = '23514';
  end if;

  v_reused_headshot_asset_id := null;
  if coalesce(p_face_match_opt_in, false) = true then
    if p_headshot_asset_id is not null then
      perform 1
      from public.assets a
      where a.id = p_headshot_asset_id
        and a.tenant_id = v_invite.tenant_id
        and a.project_id = v_invite.project_id
        and a.asset_type = 'headshot'
        and a.status = 'uploaded'
        and a.archived_at is null;

      if not found then
        raise exception 'invalid_headshot_asset' using errcode = '23514';
      end if;
    elsif v_upgrade_request.id is not null then
      select a.id
      into v_reused_headshot_asset_id
      from public.asset_consent_links acl
      join public.assets a
        on a.id = acl.asset_id
       and a.tenant_id = v_invite.tenant_id
       and a.project_id = v_invite.project_id
       and a.asset_type = 'headshot'
       and a.status = 'uploaded'
       and a.archived_at is null
       and (a.retention_expires_at is null or a.retention_expires_at > now())
      where acl.tenant_id = v_invite.tenant_id
        and acl.project_id = v_invite.project_id
        and acl.consent_id = v_prior_consent.id
      order by a.uploaded_at desc nulls last, a.created_at desc, a.id desc
      limit 1;

      if not found then
        raise exception 'headshot_required_for_face_match_opt_in' using errcode = '23514';
      end if;
    else
      raise exception 'headshot_required_for_face_match_opt_in' using errcode = '23514';
    end if;
  end if;

  if v_invite.template_structured_fields_definition is null then
    if p_structured_field_values is not null then
      if jsonb_typeof(p_structured_field_values) <> 'object'
        or p_structured_field_values <> '{}'::jsonb then
        raise exception 'invalid_structured_fields' using errcode = '23514';
      end if;
    end if;

    v_structured_fields_snapshot := null;
  else
    v_normalized_structured_values := app.validate_submitted_structured_field_values(
      v_invite.template_structured_fields_definition,
      p_structured_field_values
    );

    v_structured_fields_snapshot := jsonb_build_object(
      'schemaVersion', 1,
      'templateSnapshot', jsonb_build_object(
        'templateId', v_invite.consent_template_id,
        'templateKey', v_invite.template_key_value,
        'name', v_invite.template_name_value,
        'version', v_invite.template_version,
        'versionNumber', v_invite.template_version_number
      ),
      'definition', v_invite.template_structured_fields_definition,
      'values', v_normalized_structured_values
    );
  end if;

  insert into public.consents (
    tenant_id,
    project_id,
    subject_id,
    invite_id,
    consent_text,
    consent_version,
    structured_fields_snapshot,
    capture_ip,
    capture_user_agent,
    face_match_opt_in
  )
  values (
    v_invite.tenant_id,
    v_invite.project_id,
    v_subject.id,
    v_invite.id,
    v_invite.template_body,
    v_invite.template_version,
    v_structured_fields_snapshot,
    p_capture_ip,
    p_capture_user_agent,
    coalesce(p_face_match_opt_in, false)
  )
  returning * into v_existing_consent;

  if v_structured_fields_snapshot is not null then
    perform app.insert_project_consent_scope_signed_projections(
      v_existing_consent.tenant_id,
      v_existing_consent.project_id,
      'one_off_subject',
      v_existing_consent.subject_id,
      null,
      'project_consent',
      v_existing_consent.id,
      null,
      v_structured_fields_snapshot,
      v_existing_consent.signed_at
    );
  end if;

  if coalesce(p_face_match_opt_in, false) = true then
    insert into public.asset_consent_links (asset_id, consent_id, tenant_id, project_id)
    values (
      coalesce(p_headshot_asset_id, v_reused_headshot_asset_id),
      v_existing_consent.id,
      v_invite.tenant_id,
      v_invite.project_id
    )
    on conflict on constraint asset_consent_links_pkey do nothing;
  end if;

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

  if v_upgrade_request.id is not null then
    update public.project_face_assignees assignees
    set consent_id = v_existing_consent.id
    where assignees.tenant_id = v_invite.tenant_id
      and assignees.project_id = v_invite.project_id
      and assignees.assignee_kind = 'project_consent'
      and assignees.consent_id = v_prior_consent.id;

    update public.asset_face_consent_links links
    set consent_id = v_existing_consent.id
    where links.tenant_id = v_invite.tenant_id
      and links.project_id = v_invite.project_id
      and links.consent_id = v_prior_consent.id;

    update public.asset_consent_manual_photo_fallbacks fallbacks
    set consent_id = v_existing_consent.id
    where fallbacks.tenant_id = v_invite.tenant_id
      and fallbacks.project_id = v_invite.project_id
      and fallbacks.consent_id = v_prior_consent.id;

    update public.asset_consent_manual_photo_fallback_suppressions suppressions
    set consent_id = v_existing_consent.id
    where suppressions.tenant_id = v_invite.tenant_id
      and suppressions.project_id = v_invite.project_id
      and suppressions.consent_id = v_prior_consent.id;

    update public.consents c
    set
      superseded_at = now(),
      superseded_by_consent_id = v_existing_consent.id
    where c.id = v_prior_consent.id
      and c.tenant_id = v_invite.tenant_id
      and c.superseded_at is null;

    update public.project_consent_upgrade_requests
    set
      status = 'signed',
      completed_consent_id = v_existing_consent.id
    where id = v_upgrade_request.id
      and status = 'pending';
  end if;

  insert into public.consent_events (tenant_id, consent_id, event_type, payload)
  values (
    v_invite.tenant_id,
    v_existing_consent.id,
    'granted',
    jsonb_build_object(
      'invite_id', v_invite.id,
      'face_match_opt_in', coalesce(p_face_match_opt_in, false),
      'headshot_asset_id', coalesce(p_headshot_asset_id, v_reused_headshot_asset_id)
    )
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

create or replace function app.enforce_recurring_profile_write_rules()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_full_name text;
  v_email text;
  v_allow_identity_update boolean := coalesce(
    nullif(current_setting('app.recurring_profile_identity_update', true), ''),
    'off'
  ) = 'on';
begin
  v_full_name := regexp_replace(btrim(coalesce(new.full_name, '')), '\s+', ' ', 'g');
  if char_length(v_full_name) < 2 or char_length(v_full_name) > 160 then
    raise exception 'invalid_profile_name' using errcode = '23514';
  end if;

  v_email := btrim(coalesce(new.email, ''));
  if char_length(v_email) < 5 or char_length(v_email) > 320 then
    raise exception 'invalid_profile_email' using errcode = '23514';
  end if;

  new.full_name := v_full_name;
  new.email := v_email;
  new.normalized_email := app.normalize_recurring_profile_email(v_email);

  if new.normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid_profile_email' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'active' then
      new.archived_at := null;
    elsif new.status = 'archived' then
      new.archived_at := coalesce(new.archived_at, now());
    else
      raise exception 'invalid_recurring_profile_status_transition' using errcode = '23514';
    end if;

    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;

  if old.status = 'archived' then
    if new is distinct from old then
      raise exception 'archived_recurring_profile_immutable' using errcode = '23514';
    end if;

    return new;
  end if;

  if new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.profile_type_id is distinct from old.profile_type_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'recurring_profile_update_not_supported' using errcode = '23514';
  end if;

  if new.status = 'active' then
    if v_allow_identity_update then
      if new.status is distinct from old.status
        or new.archived_at is distinct from old.archived_at then
        raise exception 'recurring_profile_update_not_supported' using errcode = '23514';
      end if;

      new.updated_at := now();
      return new;
    end if;

    if new is distinct from old then
      raise exception 'recurring_profile_update_not_supported' using errcode = '23514';
    end if;

    return new;
  end if;

  if new.status <> 'archived' then
    raise exception 'invalid_recurring_profile_status_transition' using errcode = '23514';
  end if;

  if new.archived_at is null then
    new.archived_at := now();
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function app.create_recurring_profile_project_consent_request(
  p_project_participant_id uuid,
  p_consent_template_id uuid,
  p_request_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns table (
  request_id uuid,
  tenant_id uuid,
  project_id uuid,
  participant_id uuid,
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
  v_participant public.project_profile_participants;
  v_profile public.recurring_profiles;
  v_template public.consent_templates;
  v_existing_pending public.recurring_profile_consent_requests;
  v_active_consent public.recurring_profile_consents;
  v_active_template public.consent_templates;
  v_active_template_key text;
begin
  if auth.uid() is null then
    raise exception 'project_profile_participant_forbidden' using errcode = '42501';
  end if;

  if p_project_participant_id is null or p_request_id is null or p_token_hash is null or p_expires_at is null then
    raise exception 'invalid_input' using errcode = '23514';
  end if;

  select *
  into v_participant
  from public.project_profile_participants ppp
  where ppp.id = p_project_participant_id
  for update;

  if not found then
    raise exception 'project_profile_participant_not_found' using errcode = 'P0002';
  end if;

  if not app.current_user_can_access_project(v_participant.tenant_id, v_participant.project_id) then
    raise exception 'project_profile_participant_forbidden' using errcode = '42501';
  end if;

  select *
  into v_profile
  from public.recurring_profiles rp
  where rp.id = v_participant.recurring_profile_id
    and rp.tenant_id = v_participant.tenant_id
  for update;

  if not found then
    raise exception 'recurring_profile_not_found' using errcode = 'P0002';
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
    or (v_template.tenant_id is not null and v_template.tenant_id <> v_participant.tenant_id)
    or v_template.body is null
    or v_template.version is null
    or v_template.structured_fields_definition is null then
    raise exception 'project_template_unavailable' using errcode = '23514';
  end if;

  update public.recurring_profile_consent_requests r
  set
    status = 'expired',
    updated_at = now()
  where r.tenant_id = v_participant.tenant_id
    and r.profile_id = v_participant.recurring_profile_id
    and r.project_id = v_participant.project_id
    and r.consent_kind = 'project'
    and r.status = 'pending'
    and r.expires_at <= now();

  select *
  into v_active_consent
  from public.recurring_profile_consents c
  where c.tenant_id = v_participant.tenant_id
    and c.profile_id = v_participant.recurring_profile_id
    and c.project_id = v_participant.project_id
    and c.consent_kind = 'project'
    and c.revoked_at is null
    and c.superseded_at is null
  order by c.signed_at desc, c.created_at desc, c.id desc
  limit 1;

  if found then
    select *
    into v_active_template
    from public.consent_templates t
    where t.id = v_active_consent.consent_template_id
    limit 1;

    v_active_template_key := coalesce(
      v_active_template.template_key,
      v_active_consent.structured_fields_snapshot->'templateSnapshot'->>'templateKey'
    );

    if v_active_template_key is distinct from v_template.template_key
      or v_active_consent.consent_template_id = v_template.id then
      raise exception 'project_consent_already_signed' using errcode = '23505';
    end if;
  end if;

  select *
  into v_existing_pending
  from public.recurring_profile_consent_requests r
  where r.tenant_id = v_participant.tenant_id
    and r.profile_id = v_participant.recurring_profile_id
    and r.project_id = v_participant.project_id
    and r.consent_kind = 'project'
    and r.status = 'pending'
  limit 1;

  if found then
    return query
    select
      v_existing_pending.id,
      v_existing_pending.tenant_id,
      v_existing_pending.project_id,
      v_participant.id,
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
      project_id,
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
      v_participant.tenant_id,
      v_participant.recurring_profile_id,
      v_participant.project_id,
      'project',
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
      where r.tenant_id = v_participant.tenant_id
        and r.profile_id = v_participant.recurring_profile_id
        and r.project_id = v_participant.project_id
        and r.consent_kind = 'project'
        and r.status = 'pending'
      limit 1;

      if found then
        return query
        select
          v_existing_pending.id,
          v_existing_pending.tenant_id,
          v_existing_pending.project_id,
          v_participant.id,
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
    v_participant.tenant_id,
    v_participant.project_id,
    v_participant.id,
    v_participant.recurring_profile_id,
    v_template.id,
    'pending'::text,
    p_expires_at,
    false;
end;
$$;

create or replace function app.submit_public_recurring_profile_consent(
  p_token text,
  p_full_name text,
  p_email text,
  p_capture_ip inet,
  p_capture_user_agent text,
  p_structured_field_values jsonb default null,
  p_face_match_opt_in boolean default false
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
  v_prior_active_consent public.recurring_profile_consents;
  v_revoke_token text;
  v_normalized_structured_values jsonb;
  v_structured_fields_snapshot jsonb;
  v_project_profile_participant_id uuid;
  v_target_template public.consent_templates;
  v_active_template public.consent_templates;
  v_active_template_key text;
  v_normalized_full_name text;
  v_normalized_email text;
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

  v_normalized_full_name := regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  if char_length(v_normalized_full_name) < 2 then
    raise exception 'invalid_profile_name' using errcode = '23514';
  end if;

  v_normalized_email := app.normalize_recurring_profile_email(p_email);
  if v_normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid_profile_email' using errcode = '23514';
  end if;

  select *
  into v_prior_active_consent
  from public.recurring_profile_consents c
  where c.tenant_id = v_request.tenant_id
    and c.profile_id = v_request.profile_id
    and c.consent_kind = v_request.consent_kind
    and (
      (v_request.project_id is null and c.project_id is null)
      or c.project_id = v_request.project_id
    )
    and c.revoked_at is null
    and c.superseded_at is null
  order by c.signed_at desc, c.created_at desc, c.id desc
  limit 1
  for update;

  if found then
    if v_request.consent_kind <> 'project' or v_request.project_id is null then
      raise exception 'recurring_profile_request_unavailable' using errcode = '22023';
    end if;

    select *
    into v_target_template
    from public.consent_templates t
    where t.id = v_request.consent_template_id
    limit 1;

    if not found then
      raise exception 'recurring_profile_request_unavailable' using errcode = '22023';
    end if;

    select *
    into v_active_template
    from public.consent_templates t
    where t.id = v_prior_active_consent.consent_template_id
    limit 1;

    v_active_template_key := coalesce(
      v_active_template.template_key,
      v_prior_active_consent.structured_fields_snapshot->'templateSnapshot'->>'templateKey'
    );

    if v_active_template_key is distinct from v_target_template.template_key then
      raise exception 'recurring_profile_request_unavailable' using errcode = '22023';
    end if;
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

  perform set_config('app.recurring_profile_identity_update', 'on', true);

  update public.recurring_profiles rp
  set
    full_name = v_normalized_full_name,
    email = v_normalized_email
  where rp.id = v_request.profile_id
    and rp.tenant_id = v_request.tenant_id;

  if v_prior_active_consent.id is not null then
    update public.recurring_profile_consents c
    set
      superseded_at = now(),
      superseded_by_consent_id = null
    where c.id = v_prior_active_consent.id
      and c.tenant_id = v_request.tenant_id
      and c.superseded_at is null;
  end if;

  insert into public.recurring_profile_consents (
    tenant_id,
    profile_id,
    request_id,
    project_id,
    consent_kind,
    consent_template_id,
    profile_name_snapshot,
    profile_email_snapshot,
    consent_text,
    consent_version,
    structured_fields_snapshot,
    face_match_opt_in,
    capture_ip,
    capture_user_agent
  )
  values (
    v_request.tenant_id,
    v_request.profile_id,
    v_request.id,
    v_request.project_id,
    v_request.consent_kind,
    v_request.consent_template_id,
    v_normalized_full_name,
    v_normalized_email,
    v_request.template_body,
    v_request.template_version,
    v_structured_fields_snapshot,
    coalesce(p_face_match_opt_in, false),
    p_capture_ip,
    p_capture_user_agent
  )
  returning * into v_existing_consent;

  if v_request.consent_kind = 'project' and v_request.project_id is not null then
    select ppp.id
    into v_project_profile_participant_id
    from public.project_profile_participants ppp
    where ppp.tenant_id = v_request.tenant_id
      and ppp.project_id = v_request.project_id
      and ppp.recurring_profile_id = v_request.profile_id
    limit 1;

    if not found then
      raise exception 'recurring_profile_request_unavailable' using errcode = '22023';
    end if;

    perform app.insert_project_consent_scope_signed_projections(
      v_existing_consent.tenant_id,
      v_existing_consent.project_id,
      'project_participant',
      null,
      v_project_profile_participant_id,
      'project_recurring_consent',
      null,
      v_existing_consent.id,
      v_structured_fields_snapshot,
      v_existing_consent.signed_at
    );
  end if;

  if v_prior_active_consent.id is not null then
    update public.recurring_profile_consents c
    set superseded_by_consent_id = v_existing_consent.id
    where c.id = v_prior_active_consent.id
      and c.tenant_id = v_request.tenant_id;
  end if;

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
    jsonb_strip_nulls(
      jsonb_build_object(
        'request_id', v_request.id,
        'project_id', v_request.project_id,
        'consent_kind', v_request.consent_kind
      )
    )
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
