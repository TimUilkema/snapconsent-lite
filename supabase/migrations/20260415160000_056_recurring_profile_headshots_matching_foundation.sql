alter table public.recurring_profile_consents
  add column if not exists face_match_opt_in boolean not null default false;

create table if not exists public.recurring_profile_headshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null,
  storage_bucket text not null,
  storage_path text not null,
  original_filename text not null,
  content_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  content_hash text null,
  content_hash_algo text null,
  upload_status text not null default 'pending' check (upload_status in ('pending', 'uploaded', 'failed')),
  uploaded_at timestamptz null,
  materialization_status text not null default 'pending' check (
    materialization_status in ('pending', 'completed', 'repair_queued', 'failed')
  ),
  materialized_at timestamptz null,
  selection_face_id uuid null,
  selection_status text not null default 'pending_materialization' check (
    selection_status in (
      'pending_materialization',
      'auto_selected',
      'manual_selected',
      'needs_face_selection',
      'no_face_detected',
      'unusable_headshot'
    )
  ),
  selection_reason text null,
  superseded_at timestamptz null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_profile_headshots_profile_fkey foreign key (profile_id, tenant_id)
    references public.recurring_profiles (id, tenant_id)
    on delete restrict,
  constraint recurring_profile_headshots_content_hash_algo_check check (
    content_hash is null
    or content_hash_algo is null
    or content_hash_algo = 'sha256'
  ),
  constraint recurring_profile_headshots_upload_timeline_check check (
    (upload_status = 'pending' and uploaded_at is null)
    or (upload_status = 'failed')
    or (upload_status = 'uploaded' and uploaded_at is not null)
  ),
  constraint recurring_profile_headshots_materialization_timeline_check check (
    materialized_at is null or materialized_at >= created_at
  )
);

create unique index if not exists recurring_profile_headshots_id_tenant_unique_idx
  on public.recurring_profile_headshots (id, tenant_id);

create unique index if not exists recurring_profile_headshots_storage_path_unique_idx
  on public.recurring_profile_headshots (tenant_id, storage_path);

create unique index if not exists recurring_profile_headshots_current_uploaded_unique_idx
  on public.recurring_profile_headshots (tenant_id, profile_id)
  where superseded_at is null and upload_status = 'uploaded';

create index if not exists recurring_profile_headshots_profile_created_at_idx
  on public.recurring_profile_headshots (tenant_id, profile_id, created_at desc);

create table if not exists public.recurring_profile_headshot_materializations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  headshot_id uuid not null,
  materialization_version text not null,
  provider text not null,
  provider_mode text not null,
  provider_plugin_versions jsonb null,
  face_count integer not null check (face_count >= 0),
  usable_for_compare boolean not null,
  unusable_reason text null,
  source_image_width integer null,
  source_image_height integer null,
  source_coordinate_space text not null default 'oriented_original',
  materialized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint recurring_profile_headshot_materializations_headshot_fkey foreign key (headshot_id, tenant_id)
    references public.recurring_profile_headshots (id, tenant_id)
    on delete cascade,
  constraint recurring_profile_headshot_materializations_unique_version
    unique (tenant_id, headshot_id, materialization_version)
);

create unique index if not exists recurring_profile_headshot_materializations_id_tenant_unique_idx
  on public.recurring_profile_headshot_materializations (id, tenant_id);

create index if not exists recurring_profile_headshot_materializations_headshot_materialized_idx
  on public.recurring_profile_headshot_materializations (tenant_id, headshot_id, materialized_at desc);

create table if not exists public.recurring_profile_headshot_materialization_faces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  materialization_id uuid not null,
  face_rank integer not null check (face_rank >= 0),
  provider_face_index integer null,
  detection_probability numeric(5,4) null check (
    detection_probability is null or (detection_probability >= 0 and detection_probability <= 1)
  ),
  face_box jsonb not null,
  face_box_normalized jsonb null,
  embedding jsonb not null,
  created_at timestamptz not null default now(),
  constraint recurring_profile_headshot_materialization_faces_materialization_fkey foreign key (
    materialization_id,
    tenant_id
  )
    references public.recurring_profile_headshot_materializations (id, tenant_id)
    on delete cascade,
  constraint recurring_profile_headshot_materialization_faces_unique_rank
    unique (materialization_id, face_rank)
);

create unique index if not exists recurring_profile_headshot_materialization_faces_id_tenant_unique_idx
  on public.recurring_profile_headshot_materialization_faces (id, tenant_id);

create index if not exists recurring_profile_headshot_materialization_faces_materialization_idx
  on public.recurring_profile_headshot_materialization_faces (materialization_id, face_rank);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'recurring_profile_headshots_selection_face_fkey'
  ) then
    alter table public.recurring_profile_headshots
      add constraint recurring_profile_headshots_selection_face_fkey
      foreign key (selection_face_id, tenant_id)
      references public.recurring_profile_headshot_materialization_faces (id, tenant_id)
      on delete set null;
  end if;
end;
$$;

create table if not exists public.recurring_profile_headshot_repair_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null,
  headshot_id uuid not null,
  dedupe_key text not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'succeeded', 'dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  run_after timestamptz not null default now(),
  locked_at timestamptz null,
  locked_by text null,
  lock_token uuid null,
  lease_expires_at timestamptz null,
  completed_at timestamptz null,
  last_error_code text null,
  last_error_message text null,
  last_error_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_profile_headshot_repair_jobs_profile_fkey foreign key (profile_id, tenant_id)
    references public.recurring_profiles (id, tenant_id)
    on delete cascade,
  constraint recurring_profile_headshot_repair_jobs_headshot_fkey foreign key (headshot_id, tenant_id)
    references public.recurring_profile_headshots (id, tenant_id)
    on delete cascade,
  constraint recurring_profile_headshot_repair_jobs_dedupe_unique unique (tenant_id, dedupe_key)
);

create index if not exists recurring_profile_headshot_repair_jobs_status_run_after_idx
  on public.recurring_profile_headshot_repair_jobs (status, run_after);

create or replace function app.touch_recurring_profile_headshot_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists recurring_profile_headshots_touch_updated_at
  on public.recurring_profile_headshots;
create trigger recurring_profile_headshots_touch_updated_at
before update on public.recurring_profile_headshots
for each row
execute function app.touch_recurring_profile_headshot_updated_at();

insert into storage.buckets (id, name, public)
values ('recurring-profile-headshots', 'recurring-profile-headshots', false)
on conflict (id) do nothing;

create policy "recurring_profile_headshots_storage_select_member"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'recurring-profile-headshots'
  and split_part(name, '/', 1) = 'tenant'
  and split_part(name, '/', 3) = 'profile'
  and split_part(name, '/', 5) = 'headshot'
  and exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = split_part(name, '/', 2)::uuid
  )
  and exists (
    select 1
    from public.recurring_profiles rp
    where rp.id = split_part(name, '/', 4)::uuid
      and rp.tenant_id = split_part(name, '/', 2)::uuid
  )
);

alter table public.recurring_profile_headshots enable row level security;
alter table public.recurring_profile_headshot_materializations enable row level security;
alter table public.recurring_profile_headshot_materialization_faces enable row level security;
alter table public.recurring_profile_headshot_repair_jobs enable row level security;

revoke all on table public.recurring_profile_headshots from public;
revoke all on table public.recurring_profile_headshots from anon;
revoke all on table public.recurring_profile_headshots from authenticated;
revoke all on table public.recurring_profile_headshot_materializations from public;
revoke all on table public.recurring_profile_headshot_materializations from anon;
revoke all on table public.recurring_profile_headshot_materializations from authenticated;
revoke all on table public.recurring_profile_headshot_materialization_faces from public;
revoke all on table public.recurring_profile_headshot_materialization_faces from anon;
revoke all on table public.recurring_profile_headshot_materialization_faces from authenticated;
revoke all on table public.recurring_profile_headshot_repair_jobs from public;
revoke all on table public.recurring_profile_headshot_repair_jobs from anon;
revoke all on table public.recurring_profile_headshot_repair_jobs from authenticated;

grant select, insert, update, delete on table public.recurring_profile_headshots to service_role;
grant select, insert, update, delete on table public.recurring_profile_headshot_materializations to service_role;
grant select, insert, update, delete on table public.recurring_profile_headshot_materialization_faces to service_role;
grant select, insert, update, delete on table public.recurring_profile_headshot_repair_jobs to service_role;

create policy "recurring_profile_headshots_select_member"
on public.recurring_profile_headshots
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = recurring_profile_headshots.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "recurring_profile_headshots_insert_manage_rows"
on public.recurring_profile_headshots
for insert
to authenticated
with check (
  app.current_user_can_manage_recurring_profiles(tenant_id)
);

create policy "recurring_profile_headshots_update_manage_rows"
on public.recurring_profile_headshots
for update
to authenticated
using (
  app.current_user_can_manage_recurring_profiles(tenant_id)
)
with check (
  app.current_user_can_manage_recurring_profiles(tenant_id)
);

create policy "recurring_profile_headshot_materializations_select_member"
on public.recurring_profile_headshot_materializations
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = recurring_profile_headshot_materializations.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "recurring_profile_headshot_materialization_faces_select_member"
on public.recurring_profile_headshot_materialization_faces
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = recurring_profile_headshot_materialization_faces.tenant_id
      and m.user_id = auth.uid()
  )
);

drop function if exists app.submit_public_recurring_profile_consent(text, text, text, inet, text, jsonb);
drop function if exists public.submit_public_recurring_profile_consent(text, text, text, inet, text, jsonb);

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

create or replace function public.submit_public_recurring_profile_consent(
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
    p_structured_field_values,
    p_face_match_opt_in
  );
$$;

revoke all on function app.touch_recurring_profile_headshot_updated_at() from public;
revoke all on function public.submit_public_recurring_profile_consent(text, text, text, inet, text, jsonb, boolean) from public;
revoke all on function app.submit_public_recurring_profile_consent(text, text, text, inet, text, jsonb, boolean) from public;

grant execute on function public.submit_public_recurring_profile_consent(text, text, text, inet, text, jsonb, boolean) to anon, authenticated;
