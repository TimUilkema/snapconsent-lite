create or replace function app.normalize_structured_scope_label(p_label text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(btrim(coalesce(p_label, ''))), '\s+', ' ', 'g');
$$;

create or replace function app.assert_structured_scope_family_identity(
  p_tenant_id uuid,
  p_template_key text,
  p_template_id uuid,
  p_definition jsonb
)
returns void
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_latest_prior public.consent_templates;
  v_option jsonb;
  v_option_key text;
  v_normalized_label text;
  v_latest_historical_label text;
begin
  if p_definition is null then
    return;
  end if;

  select *
  into v_latest_prior
  from public.consent_templates t
  where t.tenant_id is not distinct from p_tenant_id
    and t.template_key = p_template_key
    and t.id is distinct from p_template_id
    and t.status in ('published', 'archived')
  order by t.version_number desc, t.created_at desc, t.id desc
  limit 1;

  if not found then
    return;
  end if;

  for v_option in
    select value
    from jsonb_array_elements(
      coalesce(p_definition->'builtInFields'->'scope'->'options', '[]'::jsonb)
    )
  loop
    v_option_key := btrim(coalesce(v_option->>'optionKey', ''));
    v_normalized_label := app.normalize_structured_scope_label(v_option->>'label');

    if exists (
      select 1
      from jsonb_array_elements(
        coalesce(v_latest_prior.structured_fields_definition->'builtInFields'->'scope'->'options', '[]'::jsonb)
      ) prior_option
      where prior_option->>'optionKey' = v_option_key
    ) then
      continue;
    end if;

    select app.normalize_structured_scope_label(history_option->>'label')
    into v_latest_historical_label
    from public.consent_templates history_row
    cross join lateral jsonb_array_elements(
      coalesce(history_row.structured_fields_definition->'builtInFields'->'scope'->'options', '[]'::jsonb)
    ) history_option
    where history_row.tenant_id is not distinct from p_tenant_id
      and history_row.template_key = p_template_key
      and history_row.id is distinct from p_template_id
      and history_row.status in ('published', 'archived')
      and history_option->>'optionKey' = v_option_key
    order by history_row.version_number desc, history_row.created_at desc, history_row.id desc
    limit 1;

    if v_latest_historical_label is not null
      and v_latest_historical_label <> v_normalized_label then
      raise exception 'structured_scope_key_semantic_drift' using errcode = '23514';
    end if;
  end loop;
end;
$$;

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
      and c.superseded_at is null
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

create or replace function app.enforce_consent_template_immutability()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'draft' then
      if new.structured_fields_definition is null then
        new.structured_fields_definition := app.build_structured_fields_definition_starter();
      else
        new.structured_fields_definition := app.validate_structured_fields_definition_for_draft(
          new.structured_fields_definition
        );
      end if;

      if new.form_layout_definition is null then
        new.form_layout_definition := app.build_form_layout_definition_starter(
          new.structured_fields_definition
        );
      else
        new.form_layout_definition := app.validate_form_layout_definition_for_draft(
          new.form_layout_definition,
          new.structured_fields_definition
        );
      end if;

      new.published_at := null;
      new.archived_at := null;
    elsif new.status = 'published' then
      if new.structured_fields_definition is not null then
        new.structured_fields_definition := app.validate_structured_fields_definition_for_publish(
          new.structured_fields_definition
        );
        perform app.assert_structured_scope_family_identity(
          new.tenant_id,
          new.template_key,
          new.id,
          new.structured_fields_definition
        );
      end if;

      if new.form_layout_definition is not null then
        new.form_layout_definition := app.validate_form_layout_definition_for_publish(
          new.form_layout_definition,
          new.structured_fields_definition
        );
      end if;

      if new.published_at is null then
        new.published_at := now();
      end if;
      new.archived_at := null;
    elsif new.status = 'archived' then
      if new.structured_fields_definition is not null then
        new.structured_fields_definition := app.validate_structured_fields_definition_for_draft(
          new.structured_fields_definition
        );
      end if;

      if new.form_layout_definition is not null then
        new.form_layout_definition := app.validate_form_layout_definition_for_draft(
          new.form_layout_definition,
          new.structured_fields_definition
        );
      end if;

      if new.archived_at is null then
        new.archived_at := coalesce(new.updated_at, now());
      end if;
    else
      raise exception 'invalid_template_status_transition' using errcode = '23514';
    end if;

    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;

  if old.status = 'draft' then
    if new.tenant_id is distinct from old.tenant_id
      or new.template_key is distinct from old.template_key
      or new.version_number is distinct from old.version_number
      or new.version is distinct from old.version
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'template_identity_immutable' using errcode = '23514';
    end if;

    if new.status not in ('draft', 'published') then
      raise exception 'invalid_template_status_transition' using errcode = '23514';
    end if;

    if new.status = 'draft' then
      if new.structured_fields_definition is null then
        raise exception 'invalid_structured_fields_definition' using errcode = '23514';
      end if;

      new.structured_fields_definition := app.validate_structured_fields_definition_for_draft(
        new.structured_fields_definition
      );

      if new.form_layout_definition is null then
        raise exception 'invalid_form_layout_definition' using errcode = '23514';
      end if;

      new.form_layout_definition := app.validate_form_layout_definition_for_draft(
        new.form_layout_definition,
        new.structured_fields_definition
      );

      new.published_at := null;
      new.archived_at := null;
    else
      new.structured_fields_definition := app.validate_structured_fields_definition_for_publish(
        new.structured_fields_definition
      );
      perform app.assert_structured_scope_family_identity(
        new.tenant_id,
        new.template_key,
        new.id,
        new.structured_fields_definition
      );

      if new.form_layout_definition is null then
        raise exception 'invalid_form_layout_definition' using errcode = '23514';
      end if;

      new.form_layout_definition := app.validate_form_layout_definition_for_publish(
        new.form_layout_definition,
        new.structured_fields_definition
      );

      if new.published_at is null then
        new.published_at := now();
      end if;
      new.archived_at := null;
    end if;

    new.updated_at := now();
    return new;
  end if;

  if old.status = 'published' then
    if new.status = 'published' then
      if new is distinct from old then
        raise exception 'published_template_immutable' using errcode = '23514';
      end if;
      return new;
    end if;

    if new.status <> 'archived' then
      raise exception 'invalid_template_status_transition' using errcode = '23514';
    end if;

    if new.tenant_id is distinct from old.tenant_id
      or new.template_key is distinct from old.template_key
      or new.version_number is distinct from old.version_number
      or new.version is distinct from old.version
      or new.name is distinct from old.name
      or new.description is distinct from old.description
      or new.body is distinct from old.body
      or new.structured_fields_definition is distinct from old.structured_fields_definition
      or new.form_layout_definition is distinct from old.form_layout_definition
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.published_at is distinct from old.published_at then
      raise exception 'published_template_immutable' using errcode = '23514';
    end if;

    if new.archived_at is null then
      new.archived_at := now();
    end if;

    new.updated_at := now();
    return new;
  end if;

  if old.status = 'archived' then
    if new is distinct from old then
      raise exception 'archived_template_immutable' using errcode = '23514';
    end if;

    return new;
  end if;

  raise exception 'invalid_template_status_transition' using errcode = '23514';
end;
$$;

create or replace function app.publish_tenant_consent_template(p_template_id uuid)
returns table (
  id uuid,
  tenant_id uuid,
  template_key text,
  name text,
  description text,
  version text,
  version_number integer,
  status text,
  body text,
  structured_fields_definition jsonb,
  form_layout_definition jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  published_at timestamptz,
  archived_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_target public.consent_templates;
  v_current_published public.consent_templates;
begin
  if auth.uid() is null then
    raise exception 'template_management_forbidden' using errcode = '42501';
  end if;

  select *
  into v_target
  from public.consent_templates target_row
  where target_row.id = p_template_id
  for update;

  if not found then
    raise exception 'template_not_found' using errcode = 'P0002';
  end if;

  if v_target.tenant_id is null then
    raise exception 'template_management_forbidden' using errcode = '42501';
  end if;

  if not app.current_user_can_manage_templates(v_target.tenant_id) then
    raise exception 'template_management_forbidden' using errcode = '42501';
  end if;

  perform 1
  from public.consent_templates family_row
  where family_row.tenant_id = v_target.tenant_id
    and family_row.template_key = v_target.template_key
  for update;

  if v_target.status = 'published' then
    return query
    select
      v_target.id,
      v_target.tenant_id,
      v_target.template_key,
      v_target.name,
      v_target.description,
      v_target.version,
      v_target.version_number,
      v_target.status,
      v_target.body,
      v_target.structured_fields_definition,
      v_target.form_layout_definition,
      v_target.created_at,
      v_target.updated_at,
      v_target.published_at,
      v_target.archived_at;
    return;
  end if;

  if v_target.status <> 'draft' then
    raise exception 'template_not_publishable' using errcode = '23514';
  end if;

  v_target.structured_fields_definition := app.validate_structured_fields_definition_for_publish(
    v_target.structured_fields_definition
  );
  perform app.assert_structured_scope_family_identity(
    v_target.tenant_id,
    v_target.template_key,
    v_target.id,
    v_target.structured_fields_definition
  );
  v_target.form_layout_definition := app.validate_form_layout_definition_for_publish(
    v_target.form_layout_definition,
    v_target.structured_fields_definition
  );

  select *
  into v_current_published
  from public.consent_templates published_row
  where published_row.tenant_id = v_target.tenant_id
    and published_row.template_key = v_target.template_key
    and published_row.status = 'published'
    and published_row.id <> v_target.id
  limit 1;

  if found then
    update public.consent_templates
    set status = 'archived'
    where public.consent_templates.id = v_current_published.id;
  end if;

  update public.consent_templates
  set
    status = 'published',
    structured_fields_definition = v_target.structured_fields_definition,
    form_layout_definition = v_target.form_layout_definition
  where public.consent_templates.id = v_target.id
  returning *
  into v_target;

  return query
  select
    v_target.id,
    v_target.tenant_id,
    v_target.template_key,
    v_target.name,
    v_target.description,
    v_target.version,
    v_target.version_number,
    v_target.status,
    v_target.body,
    v_target.structured_fields_definition,
    v_target.form_layout_definition,
    v_target.created_at,
    v_target.updated_at,
    v_target.published_at,
    v_target.archived_at;
end;
$$;

alter table public.recurring_profile_consents
  add column if not exists superseded_at timestamptz null,
  add column if not exists superseded_by_consent_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'recurring_profile_consents_superseded_by_fkey'
  ) then
    alter table public.recurring_profile_consents
      add constraint recurring_profile_consents_superseded_by_fkey
      foreign key (superseded_by_consent_id)
      references public.recurring_profile_consents (id)
      on delete set null;
  end if;
end;
$$;

alter table public.recurring_profile_consents
  drop constraint if exists recurring_profile_consents_supersedence_timeline_check;

alter table public.recurring_profile_consents
  add constraint recurring_profile_consents_supersedence_timeline_check
  check (
    (
      superseded_at is null
      and superseded_by_consent_id is null
    )
    or (
      superseded_at is not null
      and superseded_at >= signed_at
      and (
        superseded_by_consent_id is null
        or superseded_by_consent_id <> id
      )
    )
  );

drop index if exists public.recurring_profile_consents_active_signed_baseline_unique_idx;
drop index if exists public.recurring_profile_consents_active_signed_project_unique_idx;

create unique index if not exists recurring_profile_consents_active_signed_baseline_unique_idx
  on public.recurring_profile_consents (tenant_id, profile_id, consent_kind)
  where consent_kind = 'baseline' and revoked_at is null and superseded_at is null;

create unique index if not exists recurring_profile_consents_active_signed_project_unique_idx
  on public.recurring_profile_consents (tenant_id, profile_id, project_id, consent_kind)
  where consent_kind = 'project' and revoked_at is null and superseded_at is null;

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
      and c.superseded_at is null
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

  if exists (
    select 1
    from public.recurring_profile_consents c
    where c.tenant_id = v_participant.tenant_id
      and c.profile_id = v_participant.recurring_profile_id
      and c.project_id = v_participant.project_id
      and c.consent_kind = 'project'
      and c.revoked_at is null
      and c.superseded_at is null
  ) then
    raise exception 'project_consent_already_signed' using errcode = '23505';
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

create table if not exists public.project_consent_scope_signed_projections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null,
  owner_kind text not null check (owner_kind in ('one_off_subject', 'project_participant')),
  subject_id uuid null,
  project_profile_participant_id uuid null,
  source_kind text not null check (source_kind in ('project_consent', 'project_recurring_consent')),
  consent_id uuid null,
  recurring_profile_consent_id uuid null,
  template_id uuid not null references public.consent_templates(id) on delete restrict,
  template_key text not null,
  template_version text not null,
  template_version_number integer not null,
  scope_option_key text not null,
  scope_label_snapshot text not null,
  scope_order_index integer not null,
  granted boolean not null,
  signed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint project_consent_scope_signed_projections_project_fkey
    foreign key (project_id, tenant_id)
    references public.projects (id, tenant_id)
    on delete restrict,
  constraint project_consent_scope_signed_projections_subject_fkey
    foreign key (subject_id, project_id, tenant_id)
    references public.subjects (id, project_id, tenant_id)
    on delete restrict,
  constraint project_consent_scope_signed_projections_participant_fkey
    foreign key (project_profile_participant_id, tenant_id)
    references public.project_profile_participants (id, tenant_id)
    on delete restrict,
  constraint project_consent_scope_signed_projections_consent_fkey
    foreign key (consent_id, tenant_id)
    references public.consents (id, tenant_id)
    on delete cascade,
  constraint project_consent_scope_signed_projections_recurring_consent_fkey
    foreign key (recurring_profile_consent_id, tenant_id)
    references public.recurring_profile_consents (id, tenant_id)
    on delete cascade,
  constraint project_consent_scope_signed_projections_owner_shape_check
    check (
      (
        owner_kind = 'one_off_subject'
        and subject_id is not null
        and project_profile_participant_id is null
      )
      or (
        owner_kind = 'project_participant'
        and subject_id is null
        and project_profile_participant_id is not null
      )
    ),
  constraint project_consent_scope_signed_projections_source_shape_check
    check (
      (
        source_kind = 'project_consent'
        and consent_id is not null
        and recurring_profile_consent_id is null
      )
      or (
        source_kind = 'project_recurring_consent'
        and consent_id is null
        and recurring_profile_consent_id is not null
      )
    )
);

create unique index if not exists project_consent_scope_signed_projections_consent_scope_unique_idx
  on public.project_consent_scope_signed_projections (tenant_id, consent_id, scope_option_key)
  where consent_id is not null;

create unique index if not exists project_consent_scope_signed_projections_recurring_scope_unique_idx
  on public.project_consent_scope_signed_projections (tenant_id, recurring_profile_consent_id, scope_option_key)
  where recurring_profile_consent_id is not null;

create index if not exists project_consent_scope_signed_projections_subject_lookup_idx
  on public.project_consent_scope_signed_projections (
    tenant_id,
    project_id,
    owner_kind,
    subject_id,
    template_key,
    signed_at desc
  );

create index if not exists project_consent_scope_signed_projections_participant_lookup_idx
  on public.project_consent_scope_signed_projections (
    tenant_id,
    project_id,
    owner_kind,
    project_profile_participant_id,
    template_key,
    signed_at desc
  );

create index if not exists project_consent_scope_signed_projections_scope_lookup_idx
  on public.project_consent_scope_signed_projections (
    tenant_id,
    project_id,
    template_key,
    scope_option_key
  );

create index if not exists project_consent_scope_signed_projections_consent_idx
  on public.project_consent_scope_signed_projections (tenant_id, project_id, consent_id);

create index if not exists project_consent_scope_signed_projections_recurring_consent_idx
  on public.project_consent_scope_signed_projections (tenant_id, project_id, recurring_profile_consent_id);

alter table public.project_consent_scope_signed_projections enable row level security;

create policy "project_consent_scope_signed_projections_select_member"
on public.project_consent_scope_signed_projections
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = project_consent_scope_signed_projections.tenant_id
      and m.user_id = auth.uid()
  )
);

create or replace view public.project_consent_template_family_scope_catalog
with (security_invoker = true)
as
with ranked_templates as (
  select
    t.id,
    t.tenant_id,
    t.template_key,
    t.version,
    t.version_number,
    t.structured_fields_definition,
    row_number() over (
      partition by t.tenant_id, t.template_key
      order by
        case when t.status = 'published' then 0 else 1 end,
        t.version_number desc,
        t.created_at desc,
        t.id desc
    ) as family_rank
  from public.consent_templates t
  where t.status in ('published', 'archived')
    and t.structured_fields_definition is not null
)
select
  ranked_templates.tenant_id,
  ranked_templates.template_key,
  ranked_templates.id as template_id,
  ranked_templates.version as template_version,
  ranked_templates.version_number as template_version_number,
  option_value->>'optionKey' as scope_option_key,
  option_value->>'label' as scope_label,
  coalesce((option_value->>'orderIndex')::integer, 0) as scope_order_index
from ranked_templates
cross join lateral jsonb_array_elements(
  coalesce(
    ranked_templates.structured_fields_definition->'builtInFields'->'scope'->'options',
    '[]'::jsonb
  )
) option_value
where ranked_templates.family_rank = 1;

create or replace view public.project_consent_scope_effective_states
with (security_invoker = true)
as
with source_events as (
  select distinct
    p.tenant_id,
    p.project_id,
    p.owner_kind,
    p.subject_id,
    p.project_profile_participant_id,
    p.source_kind,
    p.consent_id,
    p.recurring_profile_consent_id,
    p.template_id,
    p.template_key,
    p.template_version,
    p.template_version_number,
    p.signed_at,
    p.created_at,
    coalesce(c.revoked_at, rpc.revoked_at) as governing_revoked_at,
    coalesce(p.consent_id::text, p.recurring_profile_consent_id::text) as source_identity
  from public.project_consent_scope_signed_projections p
  left join public.consents c
    on c.id = p.consent_id
   and c.tenant_id = p.tenant_id
  left join public.recurring_profile_consents rpc
    on rpc.id = p.recurring_profile_consent_id
   and rpc.tenant_id = p.tenant_id
),
ranked_events as (
  select
    source_events.*,
    row_number() over (
      partition by
        source_events.tenant_id,
        source_events.project_id,
        source_events.owner_kind,
        source_events.subject_id,
        source_events.project_profile_participant_id,
        source_events.template_key
      order by
        source_events.signed_at desc,
        source_events.created_at desc,
        source_events.source_identity desc
    ) as event_rank
  from source_events
),
governing_events as (
  select *
  from ranked_events
  where event_rank = 1
),
governing_templates as (
  select
    governing_events.*,
    t.tenant_id as template_owner_tenant_id
  from governing_events
  join public.consent_templates t
    on t.id = governing_events.template_id
),
scope_universe as (
  select
    governing_templates.tenant_id,
    governing_templates.project_id,
    governing_templates.owner_kind,
    governing_templates.subject_id,
    governing_templates.project_profile_participant_id,
    governing_templates.template_key,
    catalog.scope_option_key,
    catalog.scope_label,
    catalog.scope_order_index
  from governing_templates
  join public.project_consent_template_family_scope_catalog catalog
    on catalog.template_key = governing_templates.template_key
   and catalog.tenant_id is not distinct from governing_templates.template_owner_tenant_id

  union

  select
    governing_templates.tenant_id,
    governing_templates.project_id,
    governing_templates.owner_kind,
    governing_templates.subject_id,
    governing_templates.project_profile_participant_id,
    governing_templates.template_key,
    governing_projection.scope_option_key,
    governing_projection.scope_label_snapshot,
    governing_projection.scope_order_index
  from governing_templates
  join public.project_consent_scope_signed_projections governing_projection
    on governing_projection.tenant_id = governing_templates.tenant_id
   and governing_projection.project_id = governing_templates.project_id
   and governing_projection.source_kind = governing_templates.source_kind
   and governing_projection.template_key = governing_templates.template_key
   and (
     (governing_templates.consent_id is not null and governing_projection.consent_id = governing_templates.consent_id)
     or (
       governing_templates.recurring_profile_consent_id is not null
       and governing_projection.recurring_profile_consent_id = governing_templates.recurring_profile_consent_id
     )
   )
)
select
  governing_templates.tenant_id,
  governing_templates.project_id,
  governing_templates.owner_kind,
  governing_templates.subject_id,
  governing_templates.project_profile_participant_id,
  governing_templates.template_key,
  scope_universe.scope_option_key,
  scope_universe.scope_label,
  scope_universe.scope_order_index,
  case
    when governing_projection.scope_option_key is null then 'not_collected'
    when governing_templates.governing_revoked_at is not null then 'revoked'
    when governing_projection.granted then 'granted'
    else 'not_granted'
  end as effective_status,
  case
    when governing_projection.scope_option_key is null then null
    else governing_projection.granted
  end as signed_value_granted,
  governing_templates.source_kind as governing_source_kind,
  governing_templates.consent_id as governing_consent_id,
  governing_templates.recurring_profile_consent_id as governing_recurring_profile_consent_id,
  governing_templates.template_id as governing_template_id,
  governing_templates.template_version as governing_template_version,
  governing_templates.template_version_number as governing_template_version_number,
  governing_templates.signed_at as governing_signed_at,
  governing_templates.governing_revoked_at as governing_revoked_at
from governing_templates
join scope_universe
  on scope_universe.tenant_id = governing_templates.tenant_id
 and scope_universe.project_id = governing_templates.project_id
 and scope_universe.owner_kind = governing_templates.owner_kind
 and scope_universe.subject_id is not distinct from governing_templates.subject_id
 and scope_universe.project_profile_participant_id is not distinct from governing_templates.project_profile_participant_id
 and scope_universe.template_key = governing_templates.template_key
left join public.project_consent_scope_signed_projections governing_projection
  on governing_projection.tenant_id = governing_templates.tenant_id
 and governing_projection.project_id = governing_templates.project_id
 and governing_projection.source_kind = governing_templates.source_kind
 and governing_projection.template_key = governing_templates.template_key
 and governing_projection.scope_option_key = scope_universe.scope_option_key
 and (
   (governing_templates.consent_id is not null and governing_projection.consent_id = governing_templates.consent_id)
   or (
     governing_templates.recurring_profile_consent_id is not null
     and governing_projection.recurring_profile_consent_id = governing_templates.recurring_profile_consent_id
   )
 );

create table if not exists public.project_consent_upgrade_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null,
  subject_id uuid not null,
  prior_consent_id uuid not null,
  target_template_id uuid not null references public.consent_templates(id) on delete restrict,
  target_template_key text not null,
  invite_id uuid null references public.subject_invites(id) on delete set null,
  status text not null check (status in ('pending', 'signed', 'cancelled', 'expired', 'superseded')),
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  completed_consent_id uuid null references public.consents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_consent_upgrade_requests_project_fkey
    foreign key (project_id, tenant_id)
    references public.projects (id, tenant_id)
    on delete restrict,
  constraint project_consent_upgrade_requests_subject_fkey
    foreign key (subject_id, project_id, tenant_id)
    references public.subjects (id, project_id, tenant_id)
    on delete restrict,
  constraint project_consent_upgrade_requests_prior_consent_fkey
    foreign key (prior_consent_id, tenant_id)
    references public.consents (id, tenant_id)
    on delete restrict,
  constraint project_consent_upgrade_requests_completed_consent_shape_check
    check (completed_consent_id is null or status = 'signed')
);

create unique index if not exists project_consent_upgrade_requests_pending_unique_idx
  on public.project_consent_upgrade_requests (tenant_id, project_id, subject_id, target_template_id)
  where status = 'pending';

create index if not exists project_consent_upgrade_requests_subject_created_at_idx
  on public.project_consent_upgrade_requests (tenant_id, project_id, subject_id, created_at desc);

create or replace function app.touch_project_consent_upgrade_request_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists project_consent_upgrade_requests_touch_updated_at
  on public.project_consent_upgrade_requests;

create trigger project_consent_upgrade_requests_touch_updated_at
before update on public.project_consent_upgrade_requests
for each row
execute function app.touch_project_consent_upgrade_request_updated_at();

alter table public.project_consent_upgrade_requests enable row level security;

create policy "project_consent_upgrade_requests_select_member"
on public.project_consent_upgrade_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = project_consent_upgrade_requests.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "project_consent_upgrade_requests_insert_project_member"
on public.project_consent_upgrade_requests
for insert
to authenticated
with check (
  app.current_user_can_access_project(tenant_id, project_id)
);

create policy "project_consent_upgrade_requests_update_project_member"
on public.project_consent_upgrade_requests
for update
to authenticated
using (
  app.current_user_can_access_project(tenant_id, project_id)
)
with check (
  app.current_user_can_access_project(tenant_id, project_id)
);

revoke all on function app.normalize_structured_scope_label(text) from public;
revoke all on function app.assert_structured_scope_family_identity(uuid, text, uuid, jsonb) from public;
revoke all on function app.touch_project_consent_upgrade_request_updated_at() from public;

grant execute on function app.normalize_structured_scope_label(text) to authenticated;
grant execute on function app.assert_structured_scope_family_identity(uuid, text, uuid, jsonb) to authenticated;
grant select on public.project_consent_template_family_scope_catalog to authenticated;
grant select on public.project_consent_scope_effective_states to authenticated;
