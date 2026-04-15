create table if not exists public.project_face_assignees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null,
  assignee_kind text not null,
  consent_id uuid null,
  recurring_profile_consent_id uuid null,
  project_profile_participant_id uuid null,
  recurring_profile_id uuid null,
  created_at timestamptz not null default now(),
  constraint project_face_assignees_project_scope_fk
    foreign key (project_id, tenant_id)
    references public.projects(id, tenant_id)
    on delete restrict,
  constraint project_face_assignees_consent_scope_fk
    foreign key (consent_id, tenant_id, project_id)
    references public.consents(id, tenant_id, project_id)
    on delete restrict,
  constraint project_face_assignees_recurring_consent_scope_fk
    foreign key (recurring_profile_consent_id, tenant_id)
    references public.recurring_profile_consents(id, tenant_id)
    on delete restrict,
  constraint project_face_assignees_participant_scope_fk
    foreign key (project_profile_participant_id, tenant_id)
    references public.project_profile_participants(id, tenant_id)
    on delete restrict,
  constraint project_face_assignees_profile_scope_fk
    foreign key (recurring_profile_id, tenant_id)
    references public.recurring_profiles(id, tenant_id)
    on delete restrict,
  constraint project_face_assignees_kind_check
    check (assignee_kind in ('project_consent', 'project_recurring_consent')),
  constraint project_face_assignees_kind_shape_check
    check (
      (
        assignee_kind = 'project_consent'
        and consent_id is not null
        and recurring_profile_consent_id is null
        and project_profile_participant_id is null
        and recurring_profile_id is null
      )
      or (
        assignee_kind = 'project_recurring_consent'
        and consent_id is null
        and recurring_profile_consent_id is not null
        and project_profile_participant_id is not null
        and recurring_profile_id is not null
      )
    )
);

create unique index if not exists project_face_assignees_id_tenant_unique_idx
  on public.project_face_assignees (id, tenant_id);

create unique index if not exists project_face_assignees_project_consent_unique_idx
  on public.project_face_assignees (tenant_id, project_id, consent_id);

create unique index if not exists project_face_assignees_project_recurring_consent_unique_idx
  on public.project_face_assignees (tenant_id, project_id, recurring_profile_consent_id);

create index if not exists project_face_assignees_project_participant_idx
  on public.project_face_assignees (tenant_id, project_id, project_profile_participant_id, created_at desc);

create index if not exists project_face_assignees_project_created_at_idx
  on public.project_face_assignees (tenant_id, project_id, created_at desc);

alter table public.project_face_assignees enable row level security;

revoke all on table public.project_face_assignees from public;
revoke all on table public.project_face_assignees from anon;
revoke all on table public.project_face_assignees from authenticated;

grant select, insert, update, delete on table public.project_face_assignees to authenticated;
grant select, insert, update, delete on table public.project_face_assignees to service_role;

create policy "project_face_assignees_select_member"
on public.project_face_assignees
for select
to authenticated
using (
  app.current_user_can_access_project(tenant_id, project_id)
);

create policy "project_face_assignees_insert_member"
on public.project_face_assignees
for insert
to authenticated
with check (
  app.current_user_can_access_project(tenant_id, project_id)
);

create policy "project_face_assignees_update_member"
on public.project_face_assignees
for update
to authenticated
using (
  app.current_user_can_access_project(tenant_id, project_id)
)
with check (
  app.current_user_can_access_project(tenant_id, project_id)
);

create policy "project_face_assignees_delete_member"
on public.project_face_assignees
for delete
to authenticated
using (
  app.current_user_can_access_project(tenant_id, project_id)
);

alter table public.asset_face_consent_links
  add column if not exists project_face_assignee_id uuid null;

alter table public.asset_face_consent_links
  alter column consent_id drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'asset_face_consent_links_project_face_assignee_fk'
  ) then
    alter table public.asset_face_consent_links
      add constraint asset_face_consent_links_project_face_assignee_fk
        foreign key (project_face_assignee_id, tenant_id)
        references public.project_face_assignees(id, tenant_id)
        on delete restrict;
  end if;
end;
$$;

insert into public.project_face_assignees (
  tenant_id,
  project_id,
  assignee_kind,
  consent_id
)
select distinct
  links.tenant_id,
  links.project_id,
  'project_consent',
  links.consent_id
from public.asset_face_consent_links links
where links.consent_id is not null
on conflict (tenant_id, project_id, consent_id) do nothing;

update public.asset_face_consent_links links
set project_face_assignee_id = assignees.id
from public.project_face_assignees assignees
where assignees.tenant_id = links.tenant_id
  and assignees.project_id = links.project_id
  and assignees.assignee_kind = 'project_consent'
  and assignees.consent_id = links.consent_id
  and links.project_face_assignee_id is null;

alter table public.asset_face_consent_links
  alter column project_face_assignee_id set not null;

alter table public.asset_face_consent_links
  drop constraint if exists asset_face_consent_links_project_face_assignee_required_check,
  drop constraint if exists asset_face_consent_links_auto_link_requires_consent_check;

alter table public.asset_face_consent_links
  add constraint asset_face_consent_links_project_face_assignee_required_check
    check (project_face_assignee_id is not null),
  add constraint asset_face_consent_links_auto_link_requires_consent_check
    check (link_source <> 'auto' or consent_id is not null);

create unique index if not exists asset_face_consent_links_tenant_project_asset_assignee_unique_idx
  on public.asset_face_consent_links (tenant_id, project_id, asset_id, project_face_assignee_id);

create index if not exists asset_face_consent_links_tenant_project_assignee_idx
  on public.asset_face_consent_links (tenant_id, project_id, project_face_assignee_id);
