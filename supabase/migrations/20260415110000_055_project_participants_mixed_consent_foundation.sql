create or replace function app.current_user_can_access_project(
  p_tenant_id uuid,
  p_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.projects p
    join public.memberships m
      on m.tenant_id = p.tenant_id
    where p.id = p_project_id
      and p.tenant_id = p_tenant_id
      and m.user_id = (select auth.uid())
  );
$$;

create table if not exists public.project_profile_participants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null,
  recurring_profile_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint project_profile_participants_project_fkey foreign key (project_id, tenant_id)
    references public.projects (id, tenant_id)
    on delete restrict,
  constraint project_profile_participants_profile_fkey foreign key (recurring_profile_id, tenant_id)
    references public.recurring_profiles (id, tenant_id)
    on delete restrict
);

create unique index if not exists project_profile_participants_id_tenant_unique_idx
  on public.project_profile_participants (id, tenant_id);

create unique index if not exists project_profile_participants_unique_active_idx
  on public.project_profile_participants (tenant_id, project_id, recurring_profile_id);

create index if not exists project_profile_participants_project_created_at_idx
  on public.project_profile_participants (tenant_id, project_id, created_at desc);

create index if not exists project_profile_participants_profile_created_at_idx
  on public.project_profile_participants (tenant_id, recurring_profile_id, created_at desc);

alter table public.project_profile_participants enable row level security;

create policy "project_profile_participants_select_member"
on public.project_profile_participants
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = project_profile_participants.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "project_profile_participants_insert_member"
on public.project_profile_participants
for insert
to authenticated
with check (
  app.current_user_can_access_project(tenant_id, project_id)
);

alter table public.recurring_profile_consent_requests
  add column if not exists project_id uuid null;

alter table public.recurring_profile_consents
  add column if not exists project_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'recurring_profile_consent_requests_project_fkey'
  ) then
    alter table public.recurring_profile_consent_requests
      add constraint recurring_profile_consent_requests_project_fkey foreign key (project_id, tenant_id)
        references public.projects (id, tenant_id)
        on delete restrict;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'recurring_profile_consents_project_fkey'
  ) then
    alter table public.recurring_profile_consents
      add constraint recurring_profile_consents_project_fkey foreign key (project_id, tenant_id)
        references public.projects (id, tenant_id)
        on delete restrict;
  end if;
end;
$$;

alter table public.recurring_profile_consent_requests
  drop constraint if exists recurring_profile_consent_requests_consent_kind_check;

alter table public.recurring_profile_consents
  drop constraint if exists recurring_profile_consents_consent_kind_check;

alter table public.recurring_profile_consent_requests
  drop constraint if exists recurring_profile_consent_requests_project_context_check;

alter table public.recurring_profile_consents
  drop constraint if exists recurring_profile_consents_project_context_check;

alter table public.recurring_profile_consent_requests
  add constraint recurring_profile_consent_requests_consent_kind_check
    check (consent_kind in ('baseline', 'project'));

alter table public.recurring_profile_consents
  add constraint recurring_profile_consents_consent_kind_check
    check (consent_kind in ('baseline', 'project'));

alter table public.recurring_profile_consent_requests
  add constraint recurring_profile_consent_requests_project_context_check
    check (
      (consent_kind = 'baseline' and project_id is null)
      or (consent_kind = 'project' and project_id is not null)
    );

alter table public.recurring_profile_consents
  add constraint recurring_profile_consents_project_context_check
    check (
      (consent_kind = 'baseline' and project_id is null)
      or (consent_kind = 'project' and project_id is not null)
    );

drop index if exists public.recurring_profile_consent_requests_active_pending_unique_idx;
drop index if exists public.recurring_profile_consents_active_signed_unique_idx;

create unique index if not exists recurring_profile_consent_requests_active_pending_baseline_unique_idx
  on public.recurring_profile_consent_requests (tenant_id, profile_id, consent_kind)
  where consent_kind = 'baseline' and status = 'pending';

create unique index if not exists recurring_profile_consent_requests_active_pending_project_unique_idx
  on public.recurring_profile_consent_requests (tenant_id, profile_id, project_id, consent_kind)
  where consent_kind = 'project' and status = 'pending';

create unique index if not exists recurring_profile_consents_active_signed_baseline_unique_idx
  on public.recurring_profile_consents (tenant_id, profile_id, consent_kind)
  where consent_kind = 'baseline' and revoked_at is null;

create unique index if not exists recurring_profile_consents_active_signed_project_unique_idx
  on public.recurring_profile_consents (tenant_id, profile_id, project_id, consent_kind)
  where consent_kind = 'project' and revoked_at is null;

create index if not exists recurring_profile_consent_requests_project_created_at_idx
  on public.recurring_profile_consent_requests (tenant_id, project_id, profile_id, created_at desc)
  where consent_kind = 'project';

create index if not exists recurring_profile_consents_project_signed_at_idx
  on public.recurring_profile_consents (tenant_id, project_id, profile_id, signed_at desc)
  where consent_kind = 'project';

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

create or replace function public.create_recurring_profile_project_consent_request(
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
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.create_recurring_profile_project_consent_request(
    p_project_participant_id,
    p_consent_template_id,
    p_request_id,
    p_token_hash,
    p_expires_at
  );
$$;

revoke all on function app.current_user_can_access_project(uuid, uuid) from public;
revoke all on function app.create_recurring_profile_project_consent_request(uuid, uuid, uuid, text, timestamptz) from public;

grant execute on function app.current_user_can_access_project(uuid, uuid) to authenticated;
grant execute on function public.create_recurring_profile_project_consent_request(uuid, uuid, uuid, text, timestamptz) to authenticated;
