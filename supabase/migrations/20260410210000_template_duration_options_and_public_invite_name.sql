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
  v_duration_options jsonb;
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

  v_duration_options := app.normalize_structured_field_options(
    v_built_in_fields->'duration'->'options',
    20,
    false
  );

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
        'options', v_duration_options
      )
    ),
    'customFields', v_normalized_custom_fields
  );
end;
$$;

drop function if exists app.get_public_invite(text);
drop function if exists public.get_public_invite(text);

create or replace function app.get_public_invite(p_token text)
returns table (
  invite_id uuid,
  project_id uuid,
  project_name text,
  template_name text,
  expires_at timestamptz,
  status text,
  can_sign boolean,
  consent_text text,
  consent_version text,
  structured_fields_definition jsonb,
  form_layout_definition jsonb
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
    ct.name,
    i.expires_at,
    i.status,
    (
      i.status = 'active'
      and (i.expires_at is null or i.expires_at > now())
      and i.used_count < i.max_uses
      and ct.status in ('published', 'archived')
    ) as can_sign,
    ct.body,
    ct.version,
    ct.structured_fields_definition,
    ct.form_layout_definition
  from public.subject_invites i
  join public.projects p on p.id = i.project_id
  join public.consent_templates ct on ct.id = i.consent_template_id
  where i.token_hash = v_hash
  limit 1;
end;
$$;

create or replace function public.get_public_invite(p_token text)
returns table (
  invite_id uuid,
  project_id uuid,
  project_name text,
  template_name text,
  expires_at timestamptz,
  status text,
  can_sign boolean,
  consent_text text,
  consent_version text,
  structured_fields_definition jsonb,
  form_layout_definition jsonb
)
language sql
stable
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.get_public_invite(p_token);
$$;
