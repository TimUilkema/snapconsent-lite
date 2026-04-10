alter table public.consent_templates
drop column if exists category;

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

drop function if exists app.create_next_tenant_consent_template_version(uuid);
drop function if exists public.create_next_tenant_consent_template_version(uuid);

create or replace function app.create_next_tenant_consent_template_version(p_template_id uuid)
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
  archived_at timestamptz,
  reused_existing_draft boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_source public.consent_templates;
  v_existing_draft public.consent_templates;
  v_created public.consent_templates;
  v_next_version_number integer;
begin
  if auth.uid() is null then
    raise exception 'template_management_forbidden' using errcode = '42501';
  end if;

  select *
  into v_source
  from public.consent_templates source_row
  where source_row.id = p_template_id
  for update;

  if not found then
    raise exception 'template_not_found' using errcode = 'P0002';
  end if;

  if v_source.tenant_id is null then
    raise exception 'template_management_forbidden' using errcode = '42501';
  end if;

  if not app.current_user_can_manage_templates(v_source.tenant_id) then
    raise exception 'template_management_forbidden' using errcode = '42501';
  end if;

  perform 1
  from public.consent_templates family_row
  where family_row.tenant_id = v_source.tenant_id
    and family_row.template_key = v_source.template_key
  for update;

  select *
  into v_existing_draft
  from public.consent_templates draft_row
  where draft_row.tenant_id = v_source.tenant_id
    and draft_row.template_key = v_source.template_key
    and draft_row.status = 'draft'
  limit 1;

  if found then
    return query
    select
      v_existing_draft.id,
      v_existing_draft.tenant_id,
      v_existing_draft.template_key,
      v_existing_draft.name,
      v_existing_draft.description,
      v_existing_draft.version,
      v_existing_draft.version_number,
      v_existing_draft.status,
      v_existing_draft.body,
      v_existing_draft.structured_fields_definition,
      v_existing_draft.form_layout_definition,
      v_existing_draft.created_at,
      v_existing_draft.updated_at,
      v_existing_draft.published_at,
      v_existing_draft.archived_at,
      true;
    return;
  end if;

  select coalesce(max(family_row.version_number), 0) + 1
  into v_next_version_number
  from public.consent_templates family_row
  where family_row.tenant_id = v_source.tenant_id
    and family_row.template_key = v_source.template_key;

  insert into public.consent_templates (
    tenant_id,
    template_key,
    name,
    description,
    version,
    version_number,
    status,
    body,
    structured_fields_definition,
    form_layout_definition,
    created_by
  )
  values (
    v_source.tenant_id,
    v_source.template_key,
    v_source.name,
    v_source.description,
    concat('v', v_next_version_number::text),
    v_next_version_number,
    'draft',
    v_source.body,
    coalesce(v_source.structured_fields_definition, app.build_structured_fields_definition_starter()),
    coalesce(
      v_source.form_layout_definition,
      app.build_form_layout_definition_starter(
        coalesce(v_source.structured_fields_definition, app.build_structured_fields_definition_starter())
      )
    ),
    auth.uid()
  )
  returning *
  into v_created;

  return query
  select
    v_created.id,
    v_created.tenant_id,
    v_created.template_key,
    v_created.name,
    v_created.description,
    v_created.version,
    v_created.version_number,
    v_created.status,
    v_created.body,
    v_created.structured_fields_definition,
    v_created.form_layout_definition,
    v_created.created_at,
    v_created.updated_at,
    v_created.published_at,
    v_created.archived_at,
    false;
end;
$$;

create or replace function public.create_next_tenant_consent_template_version(p_template_id uuid)
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
  archived_at timestamptz,
  reused_existing_draft boolean
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.create_next_tenant_consent_template_version(p_template_id);
$$;

drop function if exists app.publish_tenant_consent_template(uuid);
drop function if exists public.publish_tenant_consent_template(uuid);

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

create or replace function public.publish_tenant_consent_template(p_template_id uuid)
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
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.publish_tenant_consent_template(p_template_id);
$$;
