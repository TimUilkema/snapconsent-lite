create table if not exists public.recurring_profile_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label text not null,
  normalized_label text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  constraint recurring_profile_types_id_tenant_unique unique (id, tenant_id),
  constraint recurring_profile_types_archive_state_check check (
    (status = 'active' and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  ),
  constraint recurring_profile_types_label_normalized_check check (
    normalized_label = lower(regexp_replace(btrim(label), '\s+', ' ', 'g'))
  )
);

create table if not exists public.recurring_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_type_id uuid null,
  full_name text not null,
  email text not null,
  normalized_email text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  constraint recurring_profiles_archive_state_check check (
    (status = 'active' and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  ),
  constraint recurring_profiles_normalized_email_check check (
    normalized_email = lower(btrim(email))
  ),
  constraint recurring_profiles_profile_type_fkey foreign key (profile_type_id, tenant_id)
    references public.recurring_profile_types (id, tenant_id)
    on delete restrict
);

create index if not exists recurring_profile_types_tenant_status_label_idx
  on public.recurring_profile_types (tenant_id, status, label);

create index if not exists recurring_profile_types_tenant_updated_at_idx
  on public.recurring_profile_types (tenant_id, updated_at desc);

create unique index if not exists recurring_profile_types_active_label_unique_idx
  on public.recurring_profile_types (tenant_id, normalized_label)
  where status = 'active';

create index if not exists recurring_profiles_tenant_status_updated_at_idx
  on public.recurring_profiles (tenant_id, status, updated_at desc);

create index if not exists recurring_profiles_tenant_type_status_updated_at_idx
  on public.recurring_profiles (tenant_id, profile_type_id, status, updated_at desc);

create unique index if not exists recurring_profiles_active_email_unique_idx
  on public.recurring_profiles (tenant_id, normalized_email)
  where status = 'active';

create or replace function app.current_user_can_manage_recurring_profiles(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function app.normalize_recurring_profile_type_label(p_value text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g'));
$$;

create or replace function app.normalize_recurring_profile_email(p_value text)
returns text
language sql
immutable
as $$
  select lower(btrim(coalesce(p_value, '')));
$$;

create or replace function app.enforce_recurring_profile_type_write_rules()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_label text;
begin
  v_label := regexp_replace(btrim(coalesce(new.label, '')), '\s+', ' ', 'g');

  if char_length(v_label) < 2 or char_length(v_label) > 80 then
    raise exception 'invalid_profile_type_label' using errcode = '23514';
  end if;

  new.label := v_label;
  new.normalized_label := app.normalize_recurring_profile_type_label(v_label);

  if tg_op = 'INSERT' then
    if new.status = 'active' then
      new.archived_at := null;
    elsif new.status = 'archived' then
      new.archived_at := coalesce(new.archived_at, now());
    else
      raise exception 'invalid_recurring_profile_type_status_transition' using errcode = '23514';
    end if;

    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;

  if old.status = 'archived' then
    if new is distinct from old then
      raise exception 'archived_recurring_profile_type_immutable' using errcode = '23514';
    end if;

    return new;
  end if;

  if new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.label is distinct from old.label
    or new.normalized_label is distinct from old.normalized_label
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'recurring_profile_type_update_not_supported' using errcode = '23514';
  end if;

  if new.status = 'active' then
    if new is distinct from old then
      raise exception 'recurring_profile_type_update_not_supported' using errcode = '23514';
    end if;

    return new;
  end if;

  if new.status <> 'archived' then
    raise exception 'invalid_recurring_profile_type_status_transition' using errcode = '23514';
  end if;

  if new.archived_at is null then
    new.archived_at := now();
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function app.enforce_recurring_profile_write_rules()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_full_name text;
  v_email text;
begin
  v_full_name := regexp_replace(btrim(coalesce(new.full_name, '')), '\s+', ' ', 'g');
  v_email := btrim(coalesce(new.email, ''));

  if char_length(v_full_name) < 2 or char_length(v_full_name) > 160 then
    raise exception 'invalid_profile_name' using errcode = '23514';
  end if;

  if char_length(v_email) < 5 or char_length(v_email) > 320 then
    raise exception 'invalid_profile_email' using errcode = '23514';
  end if;

  new.full_name := v_full_name;
  new.email := v_email;
  new.normalized_email := app.normalize_recurring_profile_email(v_email);

  if new.normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid_profile_email' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'active' then
      new.archived_at := null;
    elsif new.status = 'archived' then
      new.archived_at := coalesce(new.archived_at, now());
    else
      raise exception 'invalid_recurring_profile_status_transition' using errcode = '23514';
    end if;

    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;

  if old.status = 'archived' then
    if new is distinct from old then
      raise exception 'archived_recurring_profile_immutable' using errcode = '23514';
    end if;

    return new;
  end if;

  if new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.profile_type_id is distinct from old.profile_type_id
    or new.full_name is distinct from old.full_name
    or new.email is distinct from old.email
    or new.normalized_email is distinct from old.normalized_email
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'recurring_profile_update_not_supported' using errcode = '23514';
  end if;

  if new.status = 'active' then
    if new is distinct from old then
      raise exception 'recurring_profile_update_not_supported' using errcode = '23514';
    end if;

    return new;
  end if;

  if new.status <> 'archived' then
    raise exception 'invalid_recurring_profile_status_transition' using errcode = '23514';
  end if;

  if new.archived_at is null then
    new.archived_at := now();
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists recurring_profile_types_enforce_write_rules on public.recurring_profile_types;
create trigger recurring_profile_types_enforce_write_rules
before insert or update on public.recurring_profile_types
for each row
execute function app.enforce_recurring_profile_type_write_rules();

drop trigger if exists recurring_profiles_enforce_write_rules on public.recurring_profiles;
create trigger recurring_profiles_enforce_write_rules
before insert or update on public.recurring_profiles
for each row
execute function app.enforce_recurring_profile_write_rules();

alter table public.recurring_profile_types enable row level security;
alter table public.recurring_profiles enable row level security;

create policy "recurring_profile_types_select_member"
on public.recurring_profile_types
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = recurring_profile_types.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "recurring_profile_types_insert_manage_rows"
on public.recurring_profile_types
for insert
to authenticated
with check (
  app.current_user_can_manage_recurring_profiles(tenant_id)
);

create policy "recurring_profile_types_update_manage_rows"
on public.recurring_profile_types
for update
to authenticated
using (
  app.current_user_can_manage_recurring_profiles(tenant_id)
)
with check (
  app.current_user_can_manage_recurring_profiles(tenant_id)
);

create policy "recurring_profiles_select_member"
on public.recurring_profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = recurring_profiles.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "recurring_profiles_insert_manage_rows"
on public.recurring_profiles
for insert
to authenticated
with check (
  app.current_user_can_manage_recurring_profiles(tenant_id)
);

create policy "recurring_profiles_update_manage_rows"
on public.recurring_profiles
for update
to authenticated
using (
  app.current_user_can_manage_recurring_profiles(tenant_id)
)
with check (
  app.current_user_can_manage_recurring_profiles(tenant_id)
);

revoke all on function app.current_user_can_manage_recurring_profiles(uuid) from public;
revoke all on function app.normalize_recurring_profile_type_label(text) from public;
revoke all on function app.normalize_recurring_profile_email(text) from public;
revoke all on function app.enforce_recurring_profile_type_write_rules() from public;
revoke all on function app.enforce_recurring_profile_write_rules() from public;

grant execute on function app.current_user_can_manage_recurring_profiles(uuid) to authenticated;
grant execute on function app.normalize_recurring_profile_type_label(text) to authenticated;
grant execute on function app.normalize_recurring_profile_email(text) to authenticated;
