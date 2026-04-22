create or replace function app.repair_project_consent_scope_signed_projections(
  p_project_id uuid,
  p_batch_size integer default 250,
  p_one_off_cursor_created_at timestamptz default null,
  p_one_off_cursor_consent_id uuid default null,
  p_recurring_cursor_created_at timestamptz default null,
  p_recurring_cursor_consent_id uuid default null,
  p_mode text default 'missing_only'
)
returns table (
  project_id uuid,
  tenant_id uuid,
  mode text,
  scanned_one_off_consents integer,
  repaired_one_off_consents integer,
  inserted_one_off_projection_rows integer,
  scanned_recurring_consents integer,
  repaired_recurring_consents integer,
  inserted_recurring_projection_rows integer,
  has_more boolean,
  next_one_off_cursor_created_at timestamptz,
  next_one_off_cursor_consent_id uuid,
  next_recurring_cursor_created_at timestamptz,
  next_recurring_cursor_consent_id uuid
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_project public.projects;
  v_batch_size integer;
  v_mode text;
  v_one_off_row record;
  v_recurring_row record;
  v_one_off_scanned integer := 0;
  v_one_off_repaired integer := 0;
  v_one_off_inserted integer := 0;
  v_one_off_has_more boolean := false;
  v_recurring_scanned integer := 0;
  v_recurring_repaired integer := 0;
  v_recurring_inserted integer := 0;
  v_recurring_has_more boolean := false;
  v_inserted integer;
begin
  if p_project_id is null then
    raise exception 'invalid_input' using errcode = '23514';
  end if;

  select *
  into v_project
  from public.projects p
  where p.id = p_project_id;

  if not found then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;

  v_batch_size := greatest(1, least(coalesce(p_batch_size, 250), 1000));
  v_mode := btrim(coalesce(p_mode, 'missing_only'));
  if v_mode not in ('missing_only', 'rebuild') then
    raise exception 'invalid_input' using errcode = '23514';
  end if;

  for v_one_off_row in
    with candidate_rows as (
      select
        c.id,
        c.subject_id,
        c.signed_at,
        c.created_at,
        c.structured_fields_snapshot
      from public.consents c
      where c.tenant_id = v_project.tenant_id
        and c.project_id = v_project.id
        and c.signed_at is not null
        and c.structured_fields_snapshot is not null
        and (
          p_one_off_cursor_created_at is null
          or c.created_at > p_one_off_cursor_created_at
          or (
            c.created_at = p_one_off_cursor_created_at
            and p_one_off_cursor_consent_id is not null
            and c.id > p_one_off_cursor_consent_id
          )
        )
        and (
          v_mode = 'rebuild'
          or not exists (
            select 1
            from public.project_consent_scope_signed_projections projection
            where projection.tenant_id = c.tenant_id
              and projection.consent_id = c.id
          )
        )
      order by c.created_at asc, c.id asc
      limit v_batch_size + 1
    )
    select *
    from candidate_rows
  loop
    if v_one_off_scanned >= v_batch_size then
      v_one_off_has_more := true;
      exit;
    end if;

    v_one_off_scanned := v_one_off_scanned + 1;
    next_one_off_cursor_created_at := v_one_off_row.created_at;
    next_one_off_cursor_consent_id := v_one_off_row.id;

    if v_mode = 'rebuild' then
      delete from public.project_consent_scope_signed_projections projection
      where projection.tenant_id = v_project.tenant_id
        and projection.consent_id = v_one_off_row.id;
    end if;

    v_inserted := app.insert_project_consent_scope_signed_projections(
      v_project.tenant_id,
      v_project.id,
      'one_off_subject',
      v_one_off_row.subject_id,
      null,
      'project_consent',
      v_one_off_row.id,
      null,
      v_one_off_row.structured_fields_snapshot,
      v_one_off_row.signed_at
    );
    v_one_off_repaired := v_one_off_repaired + 1;
    v_one_off_inserted := v_one_off_inserted + coalesce(v_inserted, 0);
  end loop;

  for v_recurring_row in
    with candidate_rows as (
      select
        c.id,
        c.signed_at,
        c.created_at,
        c.structured_fields_snapshot,
        ppp.id as project_profile_participant_id
      from public.recurring_profile_consents c
      join public.project_profile_participants ppp
        on ppp.tenant_id = c.tenant_id
       and ppp.project_id = c.project_id
       and ppp.recurring_profile_id = c.profile_id
      where c.tenant_id = v_project.tenant_id
        and c.project_id = v_project.id
        and c.consent_kind = 'project'
        and c.signed_at is not null
        and c.structured_fields_snapshot is not null
        and (
          p_recurring_cursor_created_at is null
          or c.created_at > p_recurring_cursor_created_at
          or (
            c.created_at = p_recurring_cursor_created_at
            and p_recurring_cursor_consent_id is not null
            and c.id > p_recurring_cursor_consent_id
          )
        )
        and (
          v_mode = 'rebuild'
          or not exists (
            select 1
            from public.project_consent_scope_signed_projections projection
            where projection.tenant_id = c.tenant_id
              and projection.recurring_profile_consent_id = c.id
          )
        )
      order by c.created_at asc, c.id asc
      limit v_batch_size + 1
    )
    select *
    from candidate_rows
  loop
    if v_recurring_scanned >= v_batch_size then
      v_recurring_has_more := true;
      exit;
    end if;

    v_recurring_scanned := v_recurring_scanned + 1;
    next_recurring_cursor_created_at := v_recurring_row.created_at;
    next_recurring_cursor_consent_id := v_recurring_row.id;

    if v_mode = 'rebuild' then
      delete from public.project_consent_scope_signed_projections projection
      where projection.tenant_id = v_project.tenant_id
        and projection.recurring_profile_consent_id = v_recurring_row.id;
    end if;

    v_inserted := app.insert_project_consent_scope_signed_projections(
      v_project.tenant_id,
      v_project.id,
      'project_participant',
      null,
      v_recurring_row.project_profile_participant_id,
      'project_recurring_consent',
      null,
      v_recurring_row.id,
      v_recurring_row.structured_fields_snapshot,
      v_recurring_row.signed_at
    );
    v_recurring_repaired := v_recurring_repaired + 1;
    v_recurring_inserted := v_recurring_inserted + coalesce(v_inserted, 0);
  end loop;

  return query
  select
    v_project.id,
    v_project.tenant_id,
    v_mode,
    v_one_off_scanned,
    v_one_off_repaired,
    v_one_off_inserted,
    v_recurring_scanned,
    v_recurring_repaired,
    v_recurring_inserted,
    v_one_off_has_more or v_recurring_has_more,
    next_one_off_cursor_created_at,
    next_one_off_cursor_consent_id,
    next_recurring_cursor_created_at,
    next_recurring_cursor_consent_id;
end;
$$;

create or replace function public.repair_project_consent_scope_signed_projections(
  p_project_id uuid,
  p_batch_size integer default 250,
  p_one_off_cursor_created_at timestamptz default null,
  p_one_off_cursor_consent_id uuid default null,
  p_recurring_cursor_created_at timestamptz default null,
  p_recurring_cursor_consent_id uuid default null,
  p_mode text default 'missing_only'
)
returns table (
  project_id uuid,
  tenant_id uuid,
  mode text,
  scanned_one_off_consents integer,
  repaired_one_off_consents integer,
  inserted_one_off_projection_rows integer,
  scanned_recurring_consents integer,
  repaired_recurring_consents integer,
  inserted_recurring_projection_rows integer,
  has_more boolean,
  next_one_off_cursor_created_at timestamptz,
  next_one_off_cursor_consent_id uuid,
  next_recurring_cursor_created_at timestamptz,
  next_recurring_cursor_consent_id uuid
)
language sql
security definer
set search_path = public, extensions
as $$
  select *
  from app.repair_project_consent_scope_signed_projections(
    p_project_id,
    p_batch_size,
    p_one_off_cursor_created_at,
    p_one_off_cursor_consent_id,
    p_recurring_cursor_created_at,
    p_recurring_cursor_consent_id,
    p_mode
  );
$$;

revoke all on function app.repair_project_consent_scope_signed_projections(
  uuid,
  integer,
  timestamptz,
  uuid,
  timestamptz,
  uuid,
  text
) from public;

grant execute on function public.repair_project_consent_scope_signed_projections(
  uuid,
  integer,
  timestamptz,
  uuid,
  timestamptz,
  uuid,
  text
) to service_role;
