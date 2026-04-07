alter table public.consent_templates
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict,
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists category text,
  add column if not exists version_number integer,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists published_at timestamptz,
  add column if not exists archived_at timestamptz;

alter table public.consent_templates
  drop constraint if exists consent_templates_status_check;

update public.consent_templates
set
  name = coalesce(nullif(name, ''), initcap(replace(template_key, '-', ' '))),
  description = coalesce(description, null),
  category = coalesce(category, null),
  version_number = coalesce(
    version_number,
    case
      when version ~ '^v[0-9]+$' then substring(version from '^v([0-9]+)$')::integer
      else null
    end
  ),
  status = case
    when status = 'active' then 'published'
    when status = 'retired' then 'archived'
    else status
  end,
  published_at = case
    when published_at is not null then published_at
    when status = 'active' then created_at
    else published_at
  end,
  archived_at = case
    when archived_at is not null then archived_at
    when status = 'retired' then created_at
    else archived_at
  end,
  updated_at = coalesce(updated_at, created_at, now());

with numbered_templates as (
  select
    id,
    row_number() over (partition by template_key order by created_at asc, id asc) as fallback_version_number
  from public.consent_templates
  where version_number is null
)
update public.consent_templates ct
set version_number = nt.fallback_version_number
from numbered_templates nt
where ct.id = nt.id
  and ct.version_number is null;

update public.consent_templates
set version = concat('v', version_number::text)
where version is distinct from concat('v', version_number::text);

alter table public.consent_templates
  alter column name set not null,
  alter column version_number set not null;

alter table public.consent_templates
  add constraint consent_templates_status_check
  check (status in ('draft', 'published', 'archived'));

alter table public.consent_templates
  drop constraint if exists consent_templates_version_label_check;

alter table public.consent_templates
  add constraint consent_templates_version_label_check
  check (version = concat('v', version_number::text));

alter table public.consent_templates
  drop constraint if exists consent_templates_template_key_version_key;

drop index if exists public.consent_templates_key_status_idx;

create index if not exists consent_templates_status_updated_at_idx
  on public.consent_templates (status, updated_at desc);

create index if not exists consent_templates_tenant_status_updated_at_idx
  on public.consent_templates (tenant_id, status, updated_at desc);

create index if not exists consent_templates_tenant_key_version_idx
  on public.consent_templates (tenant_id, template_key, version_number desc);

create index if not exists consent_templates_app_key_version_idx
  on public.consent_templates (template_key, version_number desc)
  where tenant_id is null;

create unique index if not exists consent_templates_app_version_unique_idx
  on public.consent_templates (template_key, version_number)
  where tenant_id is null;

create unique index if not exists consent_templates_tenant_version_unique_idx
  on public.consent_templates (tenant_id, template_key, version_number)
  where tenant_id is not null;

create unique index if not exists consent_templates_app_draft_unique_idx
  on public.consent_templates (template_key)
  where tenant_id is null and status = 'draft';

create unique index if not exists consent_templates_tenant_draft_unique_idx
  on public.consent_templates (tenant_id, template_key)
  where tenant_id is not null and status = 'draft';

create unique index if not exists consent_templates_app_published_unique_idx
  on public.consent_templates (template_key)
  where tenant_id is null and status = 'published';

create unique index if not exists consent_templates_tenant_published_unique_idx
  on public.consent_templates (tenant_id, template_key)
  where tenant_id is not null and status = 'published';

create or replace function app.current_user_can_manage_templates(p_tenant_id uuid)
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

create or replace function app.enforce_consent_template_immutability()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if tg_op <> 'UPDATE' then
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
      new.published_at := null;
      new.archived_at := null;
    else
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
before update on public.consent_templates
for each row
execute function app.enforce_consent_template_immutability();

drop policy if exists "consent_templates_select_authenticated" on public.consent_templates;
drop policy if exists "consent_templates_select_app_rows" on public.consent_templates;
drop policy if exists "consent_templates_select_tenant_published_rows" on public.consent_templates;
drop policy if exists "consent_templates_select_tenant_manage_rows" on public.consent_templates;
drop policy if exists "consent_templates_insert_manage_rows" on public.consent_templates;
drop policy if exists "consent_templates_update_manage_rows" on public.consent_templates;

create policy "consent_templates_select_app_rows"
on public.consent_templates
for select
to authenticated
using (
  tenant_id is null
  and status in ('published', 'archived')
);

create policy "consent_templates_select_tenant_published_rows"
on public.consent_templates
for select
to authenticated
using (
  tenant_id is not null
  and status in ('published', 'archived')
  and exists (
    select 1
    from public.memberships m
    where m.tenant_id = consent_templates.tenant_id
      and m.user_id = (select auth.uid())
  )
);

create policy "consent_templates_select_tenant_manage_rows"
on public.consent_templates
for select
to authenticated
using (
  tenant_id is not null
  and app.current_user_can_manage_templates(tenant_id)
);

create policy "consent_templates_insert_manage_rows"
on public.consent_templates
for insert
to authenticated
with check (
  tenant_id is not null
  and app.current_user_can_manage_templates(tenant_id)
);

create policy "consent_templates_update_manage_rows"
on public.consent_templates
for update
to authenticated
using (
  tenant_id is not null
  and app.current_user_can_manage_templates(tenant_id)
)
with check (
  tenant_id is not null
  and app.current_user_can_manage_templates(tenant_id)
);

revoke all on function app.current_user_can_manage_templates(uuid) from public;
revoke all on function app.enforce_consent_template_immutability() from public;
grant execute on function app.current_user_can_manage_templates(uuid) to authenticated;
