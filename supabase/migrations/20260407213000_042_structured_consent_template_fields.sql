alter table public.consent_templates
  add column if not exists structured_fields_definition jsonb;

alter table public.consents
  add column if not exists structured_fields_snapshot jsonb;

alter table public.consent_templates
  drop constraint if exists consent_templates_structured_fields_definition_object_check;

alter table public.consent_templates
  add constraint consent_templates_structured_fields_definition_object_check
  check (
    structured_fields_definition is null
    or jsonb_typeof(structured_fields_definition) = 'object'
  );

alter table public.consents
  drop constraint if exists consents_structured_fields_snapshot_object_check;

alter table public.consents
  add constraint consents_structured_fields_snapshot_object_check
  check (
    structured_fields_snapshot is null
    or jsonb_typeof(structured_fields_snapshot) = 'object'
  );

create or replace function app.structured_duration_options()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'optionKey', 'one_year',
      'label', '1 year',
      'orderIndex', 0
    ),
    jsonb_build_object(
      'optionKey', 'two_years',
      'label', '2 years',
      'orderIndex', 1
    ),
    jsonb_build_object(
      'optionKey', 'three_years',
      'label', '3 years',
      'orderIndex', 2
    )
  );
$$;

create or replace function app.build_structured_fields_definition_starter()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'builtInFields', jsonb_build_object(
      'scope', jsonb_build_object(
        'fieldKey', 'scope',
        'fieldType', 'checkbox_list',
        'label', 'Scope',
        'required', true,
        'orderIndex', 0,
        'options', '[]'::jsonb
      ),
      'duration', jsonb_build_object(
        'fieldKey', 'duration',
        'fieldType', 'single_select',
        'label', 'Duration',
        'required', true,
        'orderIndex', 1,
        'options', app.structured_duration_options()
      )
    ),
    'customFields', '[]'::jsonb
  );
$$;

create or replace function app.normalize_structured_field_options(
  p_options jsonb,
  p_max_options integer,
  p_allow_empty boolean
)
returns jsonb
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  v_normalized jsonb := '[]'::jsonb;
  v_option jsonb;
  v_option_key text;
  v_option_label text;
  v_index integer := 0;
  v_seen_keys text[] := array[]::text[];
begin
  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    raise exception 'invalid_structured_fields_definition' using errcode = '23514';
  end if;

  if jsonb_array_length(p_options) > p_max_options then
    raise exception 'invalid_structured_fields_definition' using errcode = '23514';
  end if;

  if not p_allow_empty and jsonb_array_length(p_options) = 0 then
    raise exception 'invalid_structured_fields_definition' using errcode = '23514';
  end if;

  for v_option in
    select value
    from jsonb_array_elements(p_options)
  loop
    if jsonb_typeof(v_option) <> 'object' then
      raise exception 'invalid_structured_fields_definition' using errcode = '23514';
    end if;

    v_option_key := btrim(coalesce(v_option->>'optionKey', ''));
    v_option_label := btrim(coalesce(v_option->>'label', ''));

    if v_option_key = ''
      or v_option_key !~ '^[a-z][a-z0-9_]{1,63}$' then
      raise exception 'invalid_structured_fields_definition' using errcode = '23514';
    end if;

    if v_option_label = ''
      or char_length(v_option_label) > 120 then
      raise exception 'invalid_structured_fields_definition' using errcode = '23514';
    end if;

    if array_position(v_seen_keys, v_option_key) is not null then
      raise exception 'duplicate_structured_option_key' using errcode = '23514';
    end if;

    v_seen_keys := array_append(v_seen_keys, v_option_key);

    v_normalized := v_normalized || jsonb_build_array(
      jsonb_build_object(
        'optionKey', v_option_key,
        'label', v_option_label,
        'orderIndex', v_index
      )
    );

    v_index := v_index + 1;
  end loop;

  return v_normalized;
end;
$$;

create or replace function app.normalize_structured_fields_definition_internal(
  p_definition jsonb,
  p_require_scope_options boolean
)
returns jsonb
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  v_built_in_fields jsonb;
  v_scope_options jsonb;
  v_custom_fields jsonb;
  v_custom_field jsonb;
  v_field_key text;
  v_field_type text;
  v_label text;
  v_help_text text;
  v_placeholder text;
  v_required boolean;
  v_max_length integer;
  v_normalized_custom_fields jsonb := '[]'::jsonb;
  v_normalized_options jsonb;
  v_seen_field_keys text[] := array['scope', 'duration']::text[];
  v_index integer := 0;
  v_custom_field_count integer;
begin
  if p_definition is null then
    raise exception 'invalid_structured_fields_definition' using errcode = '23514';
  end if;

  if pg_column_size(p_definition) > 32768 then
    raise exception 'structured_fields_payload_too_large' using errcode = '22001';
  end if;

  if jsonb_typeof(p_definition) <> 'object' then
    raise exception 'invalid_structured_fields_definition' using errcode = '23514';
  end if;

  if coalesce(p_definition->>'schemaVersion', '') <> '1' then
    raise exception 'invalid_structured_fields_definition' using errcode = '23514';
  end if;

  v_built_in_fields := p_definition->'builtInFields';
  if v_built_in_fields is null or jsonb_typeof(v_built_in_fields) <> 'object' then
    raise exception 'invalid_structured_fields_definition' using errcode = '23514';
  end if;

  if (v_built_in_fields->'scope') is null or jsonb_typeof(v_built_in_fields->'scope') <> 'object' then
    raise exception 'invalid_structured_fields_definition' using errcode = '23514';
  end if;

  if (v_built_in_fields->'duration') is null or jsonb_typeof(v_built_in_fields->'duration') <> 'object' then
    raise exception 'invalid_structured_fields_definition' using errcode = '23514';
  end if;

  v_scope_options := app.normalize_structured_field_options(
    v_built_in_fields->'scope'->'options',
    20,
    true
  );

  if p_require_scope_options and jsonb_array_length(v_scope_options) = 0 then
    raise exception 'structured_scope_required' using errcode = '23514';
  end if;

  v_custom_fields := coalesce(p_definition->'customFields', '[]'::jsonb);
  if jsonb_typeof(v_custom_fields) <> 'array' then
    raise exception 'invalid_structured_fields_definition' using errcode = '23514';
  end if;

  v_custom_field_count := jsonb_array_length(v_custom_fields);
  if v_custom_field_count > 12 then
    raise exception 'invalid_structured_fields_definition' using errcode = '23514';
  end if;

  for v_custom_field in
    select value
    from jsonb_array_elements(v_custom_fields)
  loop
    if jsonb_typeof(v_custom_field) <> 'object' then
      raise exception 'invalid_structured_fields_definition' using errcode = '23514';
    end if;

    v_field_key := btrim(coalesce(v_custom_field->>'fieldKey', ''));
    v_field_type := coalesce(v_custom_field->>'fieldType', '');
    v_label := btrim(coalesce(v_custom_field->>'label', ''));

    if v_field_key = ''
      or v_field_key !~ '^[a-z][a-z0-9_]{1,63}$'
      or v_field_key in ('scope', 'duration') then
      raise exception 'invalid_structured_fields_definition' using errcode = '23514';
    end if;

    if array_position(v_seen_field_keys, v_field_key) is not null then
      raise exception 'duplicate_structured_field_key' using errcode = '23514';
    end if;
    v_seen_field_keys := array_append(v_seen_field_keys, v_field_key);

    if v_label = '' or char_length(v_label) > 120 then
      raise exception 'invalid_structured_fields_definition' using errcode = '23514';
    end if;

    if v_field_type not in ('single_select', 'checkbox_list', 'text_input') then
      raise exception 'invalid_structured_fields_definition' using errcode = '23514';
    end if;

    if v_custom_field ? 'required' and jsonb_typeof(v_custom_field->'required') <> 'boolean' then
      raise exception 'invalid_structured_fields_definition' using errcode = '23514';
    end if;

    v_required := coalesce((v_custom_field->>'required')::boolean, false);

    if v_custom_field ? 'helpText' and v_custom_field->'helpText' is not null
      and jsonb_typeof(v_custom_field->'helpText') <> 'string' then
      raise exception 'invalid_structured_fields_definition' using errcode = '23514';
    end if;

    v_help_text := nullif(btrim(coalesce(v_custom_field->>'helpText', '')), '');
    if v_help_text is not null and char_length(v_help_text) > 280 then
      raise exception 'invalid_structured_fields_definition' using errcode = '23514';
    end if;

    if v_field_type = 'text_input' then
      if v_custom_field ? 'placeholder' and v_custom_field->'placeholder' is not null
        and jsonb_typeof(v_custom_field->'placeholder') <> 'string' then
        raise exception 'invalid_structured_fields_definition' using errcode = '23514';
      end if;

      v_placeholder := nullif(btrim(coalesce(v_custom_field->>'placeholder', '')), '');
      if v_placeholder is not null and char_length(v_placeholder) > 120 then
        raise exception 'invalid_structured_fields_definition' using errcode = '23514';
      end if;

      if v_custom_field ? 'maxLength' and v_custom_field->'maxLength' is not null then
        if coalesce(v_custom_field->>'maxLength', '') !~ '^[0-9]+$' then
          raise exception 'invalid_structured_text_limits' using errcode = '23514';
        end if;

        v_max_length := (v_custom_field->>'maxLength')::integer;
      else
        v_max_length := 200;
      end if;

      if v_max_length < 1 or v_max_length > 500 then
        raise exception 'invalid_structured_text_limits' using errcode = '23514';
      end if;

      if v_custom_field ? 'options'
        and coalesce(jsonb_typeof(v_custom_field->'options'), 'null') <> 'null' then
        raise exception 'invalid_structured_fields_definition' using errcode = '23514';
      end if;

      v_normalized_options := null;
    else
      if nullif(btrim(coalesce(v_custom_field->>'placeholder', '')), '') is not null
        or (
          v_custom_field ? 'maxLength'
          and coalesce(jsonb_typeof(v_custom_field->'maxLength'), 'null') <> 'null'
        ) then
        raise exception 'invalid_structured_text_limits' using errcode = '23514';
      end if;

      v_placeholder := null;
      v_max_length := null;
      v_normalized_options := app.normalize_structured_field_options(
        v_custom_field->'options',
        20,
        false
      );
    end if;

    v_normalized_custom_fields := v_normalized_custom_fields || jsonb_build_array(
      jsonb_build_object(
        'fieldKey', v_field_key,
        'fieldType', v_field_type,
        'label', v_label,
        'required', v_required,
        'orderIndex', v_index,
        'helpText', to_jsonb(v_help_text),
        'placeholder', to_jsonb(v_placeholder),
        'maxLength', to_jsonb(v_max_length),
        'options', v_normalized_options
      )
    );

    v_index := v_index + 1;
  end loop;

  return jsonb_build_object(
    'schemaVersion', 1,
    'builtInFields', jsonb_build_object(
      'scope', jsonb_build_object(
        'fieldKey', 'scope',
        'fieldType', 'checkbox_list',
        'label', 'Scope',
        'required', true,
        'orderIndex', 0,
        'options', v_scope_options
      ),
      'duration', jsonb_build_object(
        'fieldKey', 'duration',
        'fieldType', 'single_select',
        'label', 'Duration',
        'required', true,
        'orderIndex', 1,
        'options', app.structured_duration_options()
      )
    ),
    'customFields', v_normalized_custom_fields
  );
end;
$$;

create or replace function app.validate_structured_fields_definition_for_draft(p_definition jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, extensions
as $$
begin
  return app.normalize_structured_fields_definition_internal(p_definition, false);
end;
$$;

create or replace function app.validate_structured_fields_definition_for_publish(p_definition jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, extensions
as $$
begin
  return app.normalize_structured_fields_definition_internal(p_definition, true);
end;
$$;

create or replace function app.validate_submitted_structured_field_values(
  p_definition jsonb,
  p_values jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  v_input jsonb := coalesce(p_values, '{}'::jsonb);
  v_normalized jsonb := '{}'::jsonb;
  v_custom_fields jsonb := coalesce(p_definition->'customFields', '[]'::jsonb);
  v_field jsonb;
  v_field_key text;
  v_field_type text;
  v_required boolean;
  v_option_keys text[];
  v_input_value jsonb;
  v_selected_value jsonb;
  v_selected_key text;
  v_selected_keys text[];
  v_text_value text;
  v_unknown_key text;
  v_max_length integer;
begin
  if p_definition is null then
    raise exception 'invalid_structured_fields' using errcode = '23514';
  end if;

  if pg_column_size(v_input) > 8192 then
    raise exception 'payload_too_large' using errcode = '22001';
  end if;

  if jsonb_typeof(v_input) <> 'object' then
    raise exception 'invalid_structured_fields' using errcode = '23514';
  end if;

  for v_unknown_key in
    select jsonb_object_keys
    from jsonb_object_keys(v_input)
  loop
    if v_unknown_key not in ('scope', 'duration')
      and not exists (
        select 1
        from jsonb_array_elements(v_custom_fields) custom_field
        where custom_field->>'fieldKey' = v_unknown_key
      ) then
      raise exception 'unknown_structured_field' using errcode = '23514';
    end if;
  end loop;

  for v_field in
    select value
    from jsonb_array_elements(
      jsonb_build_array(
        p_definition->'builtInFields'->'scope',
        p_definition->'builtInFields'->'duration'
      ) || v_custom_fields
    )
  loop
    v_field_key := v_field->>'fieldKey';
    v_field_type := v_field->>'fieldType';
    v_required := coalesce((v_field->>'required')::boolean, false);
    v_input_value := v_input->v_field_key;
    v_option_keys := null;

    if v_field_type in ('checkbox_list', 'single_select') then
      v_option_keys := array(
        select option_value->>'optionKey'
        from jsonb_array_elements(coalesce(v_field->'options', '[]'::jsonb)) option_value
      );
    end if;

    if v_field_type = 'checkbox_list' then
      v_selected_keys := array[]::text[];

      if v_input_value is null or jsonb_typeof(v_input_value) = 'null' then
        null;
      elsif jsonb_typeof(v_input_value) = 'string' then
        v_selected_key := btrim(v_input_value #>> '{}');
        if v_selected_key = '' or array_position(v_option_keys, v_selected_key) is null then
          raise exception 'invalid_structured_field_value' using errcode = '23514';
        end if;
        v_selected_keys := array_append(v_selected_keys, v_selected_key);
      elsif jsonb_typeof(v_input_value) = 'array' then
        for v_selected_value in
          select value
          from jsonb_array_elements(v_input_value)
        loop
          if jsonb_typeof(v_selected_value) <> 'string' then
            raise exception 'invalid_structured_field_value' using errcode = '23514';
          end if;

          v_selected_key := btrim(v_selected_value #>> '{}');
          if v_selected_key = '' or array_position(v_option_keys, v_selected_key) is null then
            raise exception 'invalid_structured_field_value' using errcode = '23514';
          end if;

          if array_position(v_selected_keys, v_selected_key) is null then
            v_selected_keys := array_append(v_selected_keys, v_selected_key);
          end if;
        end loop;
      else
        raise exception 'invalid_structured_field_value' using errcode = '23514';
      end if;

      if v_required and cardinality(v_selected_keys) = 0 then
        raise exception 'structured_field_required' using errcode = '23514';
      end if;

      v_normalized := v_normalized || jsonb_build_object(
        v_field_key,
        jsonb_build_object(
          'valueType', 'checkbox_list',
          'selectedOptionKeys', to_jsonb(v_selected_keys)
        )
      );
    elsif v_field_type = 'single_select' then
      if v_input_value is null or jsonb_typeof(v_input_value) = 'null' then
        v_selected_key := null;
      elsif jsonb_typeof(v_input_value) = 'string' then
        v_selected_key := nullif(btrim(v_input_value #>> '{}'), '');
      else
        raise exception 'invalid_structured_field_value' using errcode = '23514';
      end if;

      if v_selected_key is not null and array_position(v_option_keys, v_selected_key) is null then
        raise exception 'invalid_structured_field_value' using errcode = '23514';
      end if;

      if v_required and v_selected_key is null then
        raise exception 'structured_field_required' using errcode = '23514';
      end if;

      v_normalized := v_normalized || jsonb_build_object(
        v_field_key,
        jsonb_build_object(
          'valueType', 'single_select',
          'selectedOptionKey', to_jsonb(v_selected_key)
        )
      );
    elsif v_field_type = 'text_input' then
      if v_input_value is null or jsonb_typeof(v_input_value) = 'null' then
        v_text_value := null;
      elsif jsonb_typeof(v_input_value) = 'string' then
        v_text_value := nullif(btrim(v_input_value #>> '{}'), '');
      else
        raise exception 'invalid_structured_field_value' using errcode = '23514';
      end if;

      v_max_length := coalesce((v_field->>'maxLength')::integer, 200);
      if v_text_value is not null and char_length(v_text_value) > v_max_length then
        raise exception 'invalid_structured_field_value' using errcode = '23514';
      end if;

      if v_required and v_text_value is null then
        raise exception 'structured_field_required' using errcode = '23514';
      end if;

      v_normalized := v_normalized || jsonb_build_object(
        v_field_key,
        jsonb_build_object(
          'valueType', 'text_input',
          'text', to_jsonb(v_text_value)
        )
      );
    else
      raise exception 'invalid_structured_fields_definition' using errcode = '23514';
    end if;
  end loop;

  return v_normalized;
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

      new.published_at := null;
      new.archived_at := null;
    elsif new.status = 'published' then
      if new.structured_fields_definition is not null then
        new.structured_fields_definition := app.validate_structured_fields_definition_for_publish(
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
      new.published_at := null;
      new.archived_at := null;
    else
      new.structured_fields_definition := app.validate_structured_fields_definition_for_publish(
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
      or new.category is distinct from old.category
      or new.body is distinct from old.body
      or new.structured_fields_definition is distinct from old.structured_fields_definition
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

drop trigger if exists consent_templates_enforce_immutability on public.consent_templates;

create trigger consent_templates_enforce_immutability
before insert or update on public.consent_templates
for each row
execute function app.enforce_consent_template_immutability();

drop function if exists app.create_next_tenant_consent_template_version(uuid);
drop function if exists public.create_next_tenant_consent_template_version(uuid);

create or replace function app.create_next_tenant_consent_template_version(p_template_id uuid)
returns table (
  id uuid,
  tenant_id uuid,
  template_key text,
  name text,
  description text,
  category text,
  version text,
  version_number integer,
  status text,
  body text,
  structured_fields_definition jsonb,
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
      v_existing_draft.category,
      v_existing_draft.version,
      v_existing_draft.version_number,
      v_existing_draft.status,
      v_existing_draft.body,
      v_existing_draft.structured_fields_definition,
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
    category,
    version,
    version_number,
    status,
    body,
    structured_fields_definition,
    created_by
  )
  values (
    v_source.tenant_id,
    v_source.template_key,
    v_source.name,
    v_source.description,
    v_source.category,
    concat('v', v_next_version_number::text),
    v_next_version_number,
    'draft',
    v_source.body,
    coalesce(v_source.structured_fields_definition, app.build_structured_fields_definition_starter()),
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
    v_created.category,
    v_created.version,
    v_created.version_number,
    v_created.status,
    v_created.body,
    v_created.structured_fields_definition,
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
  category text,
  version text,
  version_number integer,
  status text,
  body text,
  structured_fields_definition jsonb,
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
  category text,
  version text,
  version_number integer,
  status text,
  body text,
  structured_fields_definition jsonb,
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
      v_target.category,
      v_target.version,
      v_target.version_number,
      v_target.status,
      v_target.body,
      v_target.structured_fields_definition,
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
    structured_fields_definition = v_target.structured_fields_definition
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
    v_target.category,
    v_target.version,
    v_target.version_number,
    v_target.status,
    v_target.body,
    v_target.structured_fields_definition,
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
  category text,
  version text,
  version_number integer,
  status text,
  body text,
  structured_fields_definition jsonb,
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

drop function if exists app.get_public_invite(text);
drop function if exists public.get_public_invite(text);

create or replace function app.get_public_invite(p_token text)
returns table (
  invite_id uuid,
  project_id uuid,
  project_name text,
  expires_at timestamptz,
  status text,
  can_sign boolean,
  consent_text text,
  consent_version text,
  structured_fields_definition jsonb
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
      and t.id is not null
    ) as can_sign,
    t.body,
    t.version,
    t.structured_fields_definition
  from public.subject_invites i
  join public.projects p on p.id = i.project_id and p.tenant_id = i.tenant_id
  left join public.consent_templates t on t.id = i.consent_template_id
  where i.token_hash = v_hash
  limit 1;
end;
$$;

create or replace function public.get_public_invite(p_token text)
returns table (
  invite_id uuid,
  project_id uuid,
  project_name text,
  expires_at timestamptz,
  status text,
  can_sign boolean,
  consent_text text,
  consent_version text,
  structured_fields_definition jsonb
)
language sql
stable
security definer
set search_path = public, app, extensions
as $$
  select * from app.get_public_invite(p_token);
$$;

drop function if exists app.submit_public_consent(text, text, text, inet, text, boolean, uuid);
drop function if exists public.submit_public_consent(text, text, text, inet, text, boolean, uuid);

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

create or replace function public.submit_public_consent(
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
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.submit_public_consent(
    p_token,
    p_full_name,
    p_email,
    p_capture_ip,
    p_capture_user_agent,
    p_face_match_opt_in,
    p_headshot_asset_id,
    p_structured_field_values
  );
$$;

revoke all on function app.structured_duration_options() from public;
revoke all on function app.build_structured_fields_definition_starter() from public;
revoke all on function app.normalize_structured_field_options(jsonb, integer, boolean) from public;
revoke all on function app.normalize_structured_fields_definition_internal(jsonb, boolean) from public;
revoke all on function app.validate_structured_fields_definition_for_draft(jsonb) from public;
revoke all on function app.validate_structured_fields_definition_for_publish(jsonb) from public;
revoke all on function app.validate_submitted_structured_field_values(jsonb, jsonb) from public;
revoke all on function app.create_next_tenant_consent_template_version(uuid) from public;
revoke all on function app.publish_tenant_consent_template(uuid) from public;
revoke all on function app.submit_public_consent(text, text, text, inet, text, boolean, uuid, jsonb) from public;
revoke all on function app.get_public_invite(text) from public;
revoke all on function app.enforce_consent_template_immutability() from public;

grant execute on function app.build_structured_fields_definition_starter() to authenticated;
grant execute on function app.structured_duration_options() to authenticated;
grant execute on function app.normalize_structured_field_options(jsonb, integer, boolean) to authenticated;
grant execute on function app.normalize_structured_fields_definition_internal(jsonb, boolean) to authenticated;
grant execute on function app.validate_structured_fields_definition_for_draft(jsonb) to authenticated;
grant execute on function app.validate_structured_fields_definition_for_publish(jsonb) to authenticated;
grant execute on function app.validate_submitted_structured_field_values(jsonb, jsonb) to anon, authenticated;
grant execute on function public.create_next_tenant_consent_template_version(uuid) to authenticated;
grant execute on function public.publish_tenant_consent_template(uuid) to authenticated;
grant execute on function public.get_public_invite(text) to anon, authenticated;
grant execute on function public.submit_public_consent(text, text, text, inet, text, boolean, uuid, jsonb) to anon, authenticated;

grant usage on schema app to anon, authenticated;
