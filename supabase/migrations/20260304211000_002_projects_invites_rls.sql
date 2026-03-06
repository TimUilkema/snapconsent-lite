alter table public.tenants enable row level security;
alter table public.memberships enable row level security;
alter table public.projects enable row level security;
alter table public.subject_invites enable row level security;
alter table public.subjects enable row level security;
alter table public.consents enable row level security;
alter table public.revoke_tokens enable row level security;
alter table public.consent_events enable row level security;

create policy "tenants_select_member"
on public.tenants
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = tenants.id
      and m.user_id = auth.uid()
  )
);

create policy "memberships_select_own"
on public.memberships
for select
to authenticated
using (user_id = auth.uid());

create policy "projects_select_member"
on public.projects
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = projects.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "projects_insert_member"
on public.projects
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = projects.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "projects_update_member"
on public.projects
for update
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = projects.tenant_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = projects.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "subject_invites_select_member"
on public.subject_invites
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = subject_invites.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "subject_invites_insert_member"
on public.subject_invites
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = subject_invites.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "subject_invites_update_member"
on public.subject_invites
for update
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = subject_invites.tenant_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = subject_invites.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "subjects_select_member"
on public.subjects
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = subjects.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "subjects_insert_member"
on public.subjects
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = subjects.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "subjects_update_member"
on public.subjects
for update
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = subjects.tenant_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = subjects.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "consents_select_member"
on public.consents
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = consents.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "consents_insert_member"
on public.consents
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = consents.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "consents_update_member"
on public.consents
for update
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = consents.tenant_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = consents.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "revoke_tokens_select_member"
on public.revoke_tokens
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = revoke_tokens.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "revoke_tokens_insert_member"
on public.revoke_tokens
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = revoke_tokens.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "revoke_tokens_update_member"
on public.revoke_tokens
for update
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = revoke_tokens.tenant_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = revoke_tokens.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "consent_events_select_member"
on public.consent_events
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = consent_events.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "consent_events_insert_member"
on public.consent_events
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = consent_events.tenant_id
      and m.user_id = auth.uid()
  )
);
