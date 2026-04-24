alter table public.memberships
  drop constraint if exists memberships_role_check;

alter table public.memberships
  add constraint memberships_role_check
  check (role in ('owner', 'admin', 'reviewer', 'photographer'));

create table if not exists public.tenant_membership_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  email text not null,
  normalized_email text not null,
  role text not null check (role in ('admin', 'reviewer', 'photographer')),
  status text not null check (status in ('pending', 'accepted', 'revoked', 'expired')),
  token_hash text not null unique,
  invited_by_user_id uuid not null references auth.users(id) on delete restrict,
  accepted_by_user_id uuid references auth.users(id) on delete restrict,
  revoked_by_user_id uuid references auth.users(id) on delete restrict,
  expires_at timestamptz not null,
  last_sent_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenant_membership_invites_tenant_status_created_idx
  on public.tenant_membership_invites (tenant_id, status, created_at desc);

create index if not exists tenant_membership_invites_tenant_normalized_email_idx
  on public.tenant_membership_invites (tenant_id, normalized_email);

create unique index if not exists tenant_membership_invites_pending_unique_idx
  on public.tenant_membership_invites (tenant_id, normalized_email)
  where status = 'pending';

create or replace function app.current_user_membership_role(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select m.role
  from public.memberships m
  where m.tenant_id = p_tenant_id
    and m.user_id = (select auth.uid())
  order by m.created_at asc
  limit 1;
$$;

create or replace function app.current_user_can_manage_members(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(app.current_user_membership_role(p_tenant_id) in ('owner', 'admin'), false);
$$;

create or replace function app.current_user_can_create_projects(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(app.current_user_membership_role(p_tenant_id) in ('owner', 'admin'), false);
$$;

create or replace function app.current_user_can_capture_project(p_tenant_id uuid, p_project_id uuid)
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
      and m.role in ('owner', 'admin', 'photographer')
  );
$$;

create or replace function app.current_user_can_review_project(p_tenant_id uuid, p_project_id uuid)
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
      and m.role in ('owner', 'admin', 'reviewer')
  );
$$;

create or replace function public.current_user_membership_role(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.current_user_membership_role(p_tenant_id);
$$;

create or replace function public.current_user_can_manage_members(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.current_user_can_manage_members(p_tenant_id);
$$;

create or replace function public.current_user_can_create_projects(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.current_user_can_create_projects(p_tenant_id);
$$;

create or replace function public.current_user_can_capture_project(p_tenant_id uuid, p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.current_user_can_capture_project(p_tenant_id, p_project_id);
$$;

create or replace function public.current_user_can_review_project(p_tenant_id uuid, p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select app.current_user_can_review_project(p_tenant_id, p_project_id);
$$;

create or replace function app.touch_tenant_membership_invite_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tenant_membership_invites_touch_updated_at
  on public.tenant_membership_invites;

create trigger tenant_membership_invites_touch_updated_at
before update on public.tenant_membership_invites
for each row
execute function app.touch_tenant_membership_invite_updated_at();

alter table public.tenant_membership_invites enable row level security;

grant select, insert, update, delete on table public.memberships to authenticated;
grant select, insert, update on table public.tenant_membership_invites to authenticated;
grant select, insert, update, delete on table public.tenant_membership_invites to service_role;

create policy "memberships_select_manage_member_rows"
on public.memberships
for select
to authenticated
using (
  app.current_user_can_manage_members(tenant_id)
);

create policy "memberships_insert_manage_member_rows"
on public.memberships
for insert
to authenticated
with check (
  app.current_user_can_manage_members(tenant_id)
  and role in ('admin', 'reviewer', 'photographer')
);

create policy "memberships_update_manage_member_rows"
on public.memberships
for update
to authenticated
using (
  app.current_user_can_manage_members(tenant_id)
  and role <> 'owner'
)
with check (
  app.current_user_can_manage_members(tenant_id)
  and role in ('admin', 'reviewer', 'photographer')
);

create policy "memberships_delete_manage_member_rows"
on public.memberships
for delete
to authenticated
using (
  app.current_user_can_manage_members(tenant_id)
  and role <> 'owner'
);

create policy "tenant_membership_invites_select_manage_rows"
on public.tenant_membership_invites
for select
to authenticated
using (
  app.current_user_can_manage_members(tenant_id)
);

create policy "tenant_membership_invites_insert_manage_rows"
on public.tenant_membership_invites
for insert
to authenticated
with check (
  app.current_user_can_manage_members(tenant_id)
  and invited_by_user_id = auth.uid()
);

create policy "tenant_membership_invites_update_manage_rows"
on public.tenant_membership_invites
for update
to authenticated
using (
  app.current_user_can_manage_members(tenant_id)
)
with check (
  app.current_user_can_manage_members(tenant_id)
);

revoke all on function app.current_user_membership_role(uuid) from public;
revoke all on function app.current_user_can_manage_members(uuid) from public;
revoke all on function app.current_user_can_create_projects(uuid) from public;
revoke all on function app.current_user_can_capture_project(uuid, uuid) from public;
revoke all on function app.current_user_can_review_project(uuid, uuid) from public;
revoke all on function app.touch_tenant_membership_invite_updated_at() from public;

grant execute on function app.current_user_membership_role(uuid) to authenticated;
grant execute on function app.current_user_can_manage_members(uuid) to authenticated;
grant execute on function app.current_user_can_create_projects(uuid) to authenticated;
grant execute on function app.current_user_can_capture_project(uuid, uuid) to authenticated;
grant execute on function app.current_user_can_review_project(uuid, uuid) to authenticated;

grant execute on function public.current_user_membership_role(uuid) to authenticated;
grant execute on function public.current_user_can_manage_members(uuid) to authenticated;
grant execute on function public.current_user_can_create_projects(uuid) to authenticated;
grant execute on function public.current_user_can_capture_project(uuid, uuid) to authenticated;
grant execute on function public.current_user_can_review_project(uuid, uuid) to authenticated;
