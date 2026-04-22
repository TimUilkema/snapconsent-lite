create or replace function app.insert_project_consent_scope_signed_projections(
  p_tenant_id uuid,
  p_project_id uuid,
  p_owner_kind text,
  p_subject_id uuid,
  p_project_profile_participant_id uuid,
  p_source_kind text,
  p_consent_id uuid,
  p_recurring_profile_consent_id uuid,
  p_structured_fields_snapshot jsonb,
  p_signed_at timestamptz
)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_inserted_count integer := 0;
begin
  if p_project_id is null or p_structured_fields_snapshot is null then
    return 0;
  end if;

  insert into public.project_consent_scope_signed_projections (
    tenant_id,
    project_id,
    owner_kind,
    subject_id,
    project_profile_participant_id,
    source_kind,
    consent_id,
    recurring_profile_consent_id,
    template_id,
    template_key,
    template_version,
    template_version_number,
    scope_option_key,
    scope_label_snapshot,
    scope_order_index,
    granted,
    signed_at
  )
  select
    p_tenant_id,
    p_project_id,
    p_owner_kind,
    p_subject_id,
    p_project_profile_participant_id,
    p_source_kind,
    p_consent_id,
    p_recurring_profile_consent_id,
    (p_structured_fields_snapshot->'templateSnapshot'->>'templateId')::uuid,
    p_structured_fields_snapshot->'templateSnapshot'->>'templateKey',
    p_structured_fields_snapshot->'templateSnapshot'->>'version',
    (p_structured_fields_snapshot->'templateSnapshot'->>'versionNumber')::integer,
    option_value->>'optionKey',
    option_value->>'label',
    coalesce((option_value->>'orderIndex')::integer, option_ordinal - 1),
    exists (
      select 1
      from jsonb_array_elements_text(
        coalesce(
          p_structured_fields_snapshot->'values'->'scope'->'selectedOptionKeys',
          '[]'::jsonb
        )
      ) selected_option(option_key)
      where selected_option.option_key = option_value->>'optionKey'
    ),
    p_signed_at
  from jsonb_array_elements(
    coalesce(
      p_structured_fields_snapshot->'definition'->'builtInFields'->'scope'->'options',
      '[]'::jsonb
    )
  ) with ordinality as scope_options(option_value, option_ordinal)
  where coalesce(option_value->>'optionKey', '') <> ''
  on conflict do nothing;

  get diagnostics v_inserted_count = row_count;
  return v_inserted_count;
end;
$$;

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
  v_revoke_token text;
  v_normalized_structured_values jsonb;
  v_structured_fields_snapshot jsonb;
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

  if coalesce(p_face_match_opt_in, false) = false and p_headshot_asset_id is not null then
    raise exception 'headshot_requires_face_match_opt_in' using errcode = '23514';
  end if;

  if coalesce(p_face_match_opt_in, false) = true then
    if p_headshot_asset_id is null then
      raise exception 'headshot_required_for_face_match_opt_in' using errcode = '23514';
    end if;

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

  if coalesce(p_face_match_opt_in, false) = true and p_headshot_asset_id is not null then
    insert into public.asset_consent_links (asset_id, consent_id, tenant_id, project_id)
    values (p_headshot_asset_id, v_existing_consent.id, v_invite.tenant_id, v_invite.project_id)
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

  update public.project_consent_upgrade_requests
  set
    status = 'signed',
    completed_consent_id = v_existing_consent.id
  where public.project_consent_upgrade_requests.tenant_id = v_invite.tenant_id
    and public.project_consent_upgrade_requests.invite_id = v_invite.id
    and public.project_consent_upgrade_requests.status = 'pending';

  insert into public.consent_events (tenant_id, consent_id, event_type, payload)
  values (
    v_invite.tenant_id,
    v_existing_consent.id,
    'granted',
    jsonb_build_object(
      'invite_id', v_invite.id,
      'face_match_opt_in', coalesce(p_face_match_opt_in, false),
      'headshot_asset_id', p_headshot_asset_id
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
  v_revoke_token text;
  v_normalized_structured_values jsonb;
  v_structured_fields_snapshot jsonb;
  v_project_profile_participant_id uuid;
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
      and c.consent_kind = v_request.consent_kind
      and (
        (v_request.project_id is null and c.project_id is null)
        or c.project_id = v_request.project_id
      )
      and c.revoked_at is null
      and c.superseded_at is null
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
    v_request.profile_name_snapshot,
    v_request.profile_email_snapshot,
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

revoke all on function app.insert_project_consent_scope_signed_projections(
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  jsonb,
  timestamptz
) from public;
