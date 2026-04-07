create table if not exists public.asset_image_derivatives (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  asset_id uuid not null,
  derivative_kind text not null,
  derivative_version text not null,
  storage_bucket text not null,
  storage_path text not null,
  content_type text not null,
  file_size_bytes bigint,
  width integer,
  height integer,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  lease_expires_at timestamptz,
  generated_at timestamptz,
  failed_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_image_derivatives_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_image_derivatives_project_scope_fk
    foreign key (project_id, tenant_id)
    references public.projects(id, tenant_id)
    on delete cascade,
  constraint asset_image_derivatives_unique_kind
    unique (tenant_id, project_id, asset_id, derivative_kind),
  constraint asset_image_derivatives_derivative_kind_check
    check (derivative_kind in ('thumbnail', 'preview')),
  constraint asset_image_derivatives_status_check
    check (status in ('pending', 'processing', 'ready', 'dead')),
  constraint asset_image_derivatives_attempt_count_check
    check (attempt_count >= 0),
  constraint asset_image_derivatives_max_attempts_check
    check (max_attempts > 0),
  constraint asset_image_derivatives_width_check
    check (width is null or width > 0),
  constraint asset_image_derivatives_height_check
    check (height is null or height > 0),
  constraint asset_image_derivatives_file_size_check
    check (file_size_bytes is null or file_size_bytes > 0)
);

create index if not exists asset_image_derivatives_tenant_project_asset_idx
  on public.asset_image_derivatives (tenant_id, project_id, asset_id, derivative_kind);

create index if not exists asset_image_derivatives_status_run_after_idx
  on public.asset_image_derivatives (status, run_after, lease_expires_at);

create index if not exists asset_image_derivatives_tenant_project_status_idx
  on public.asset_image_derivatives (tenant_id, project_id, status, run_after);

alter table public.asset_image_derivatives enable row level security;

revoke all on table public.asset_image_derivatives from public;
revoke all on table public.asset_image_derivatives from anon;
revoke all on table public.asset_image_derivatives from authenticated;

grant select, insert, update, delete on table public.asset_image_derivatives to service_role;

create policy "asset_image_derivatives_select_member"
on public.asset_image_derivatives
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_image_derivatives.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_image_derivatives_insert_member"
on public.asset_image_derivatives
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_image_derivatives.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_image_derivatives_update_member"
on public.asset_image_derivatives
for update
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_image_derivatives.tenant_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_image_derivatives.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_image_derivatives_delete_member"
on public.asset_image_derivatives
for delete
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_image_derivatives.tenant_id
      and m.user_id = auth.uid()
  )
);

insert into storage.buckets (id, name, public)
values ('asset-image-derivatives', 'asset-image-derivatives', false)
on conflict (id) do nothing;

create policy "asset_image_derivatives_storage_select_member"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'asset-image-derivatives'
  and split_part(name, '/', 1) = 'tenant'
  and split_part(name, '/', 3) = 'project'
  and split_part(name, '/', 5) = 'asset'
  and split_part(name, '/', 7) = 'derivative'
  and exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = split_part(name, '/', 2)::uuid
  )
  and exists (
    select 1
    from public.projects p
    where p.id = split_part(name, '/', 4)::uuid
      and p.tenant_id = split_part(name, '/', 2)::uuid
  )
);

create policy "asset_image_derivatives_storage_insert_member"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'asset-image-derivatives'
  and split_part(name, '/', 1) = 'tenant'
  and split_part(name, '/', 3) = 'project'
  and split_part(name, '/', 5) = 'asset'
  and split_part(name, '/', 7) = 'derivative'
  and exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = split_part(name, '/', 2)::uuid
  )
  and exists (
    select 1
    from public.projects p
    where p.id = split_part(name, '/', 4)::uuid
      and p.tenant_id = split_part(name, '/', 2)::uuid
  )
);

create or replace function app.claim_asset_image_derivatives(
  p_locked_by text,
  p_batch_size integer default 25,
  p_lease_seconds integer default 900
)
returns table (
  derivative_id uuid,
  tenant_id uuid,
  project_id uuid,
  asset_id uuid,
  derivative_kind text,
  derivative_version text,
  storage_bucket text,
  storage_path text,
  content_type text,
  file_size_bytes bigint,
  width integer,
  height integer,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  locked_at timestamptz,
  locked_by text,
  lease_expires_at timestamptz,
  generated_at timestamptz,
  failed_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_error_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_now timestamptz := now();
  v_locked_by text := nullif(trim(p_locked_by), '');
  v_batch_size integer := greatest(1, least(coalesce(p_batch_size, 25), 200));
  v_lease_seconds integer := greatest(60, least(coalesce(p_lease_seconds, 900), 3600));
begin
  if v_locked_by is null then
    raise exception 'asset_image_derivative_locked_by_required' using errcode = '23514';
  end if;

  return query
  with claimable as (
    select d.id
    from public.asset_image_derivatives d
    where (
      d.status = 'pending'
      and coalesce(d.run_after, d.updated_at, d.created_at) <= v_now
    ) or (
      d.status = 'processing'
      and coalesce(d.lease_expires_at, d.locked_at, d.updated_at, d.created_at) <= v_now
    )
    order by
      coalesce(d.run_after, d.lease_expires_at, d.locked_at, d.updated_at, d.created_at) asc,
      d.created_at asc
    for update skip locked
    limit v_batch_size
  ),
  updated as (
    update public.asset_image_derivatives d
    set
      status = 'processing',
      locked_at = v_now,
      locked_by = v_locked_by,
      lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
      updated_at = v_now
    from claimable c
    where d.id = c.id
    returning d.*
  )
  select
    u.id,
    u.tenant_id,
    u.project_id,
    u.asset_id,
    u.derivative_kind,
    u.derivative_version,
    u.storage_bucket,
    u.storage_path,
    u.content_type,
    u.file_size_bytes,
    u.width,
    u.height,
    u.status,
    u.attempt_count,
    u.max_attempts,
    u.run_after,
    u.locked_at,
    u.locked_by,
    u.lease_expires_at,
    u.generated_at,
    u.failed_at,
    u.last_error_code,
    u.last_error_message,
    u.last_error_at,
    u.created_at,
    u.updated_at
  from updated u
  order by coalesce(u.run_after, u.lease_expires_at, u.locked_at, u.created_at) asc, u.created_at asc;
end;
$$;

create or replace function app.fail_asset_image_derivative(
  p_derivative_id uuid,
  p_error_code text default null,
  p_error_message text default null,
  p_retryable boolean default true,
  p_retry_delay_seconds integer default null
)
returns table (
  derivative_id uuid,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  failed_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_error_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_row public.asset_image_derivatives;
  v_now timestamptz := now();
  v_next_attempt integer;
  v_retry_delay_seconds integer;
  v_retryable boolean;
begin
  select *
  into v_row
  from public.asset_image_derivatives d
  where d.id = p_derivative_id
    and d.status = 'processing'
  for update;

  if not found then
    return;
  end if;

  v_next_attempt := v_row.attempt_count + 1;
  v_retryable := coalesce(p_retryable, true) and v_next_attempt < v_row.max_attempts;

  if v_retryable then
    if p_retry_delay_seconds is not null and p_retry_delay_seconds > 0 then
      v_retry_delay_seconds := p_retry_delay_seconds;
    else
      v_retry_delay_seconds := greatest(
        15,
        least(3600, (power(2::numeric, least(v_next_attempt, 10)) * 10)::integer)
      );
    end if;

    return query
    update public.asset_image_derivatives d
    set
      status = 'pending',
      attempt_count = v_next_attempt,
      run_after = v_now + make_interval(secs => v_retry_delay_seconds),
      locked_at = null,
      locked_by = null,
      lease_expires_at = null,
      last_error_code = nullif(trim(coalesce(p_error_code, '')), ''),
      last_error_message = left(coalesce(p_error_message, ''), 2000),
      last_error_at = v_now,
      failed_at = null,
      updated_at = v_now
    where d.id = p_derivative_id
    returning
      d.id,
      d.status,
      d.attempt_count,
      d.max_attempts,
      d.run_after,
      d.failed_at,
      d.last_error_code,
      d.last_error_message,
      d.last_error_at,
      d.updated_at;
  else
    return query
    update public.asset_image_derivatives d
    set
      status = 'dead',
      attempt_count = v_next_attempt,
      locked_at = null,
      locked_by = null,
      lease_expires_at = null,
      failed_at = v_now,
      last_error_code = nullif(trim(coalesce(p_error_code, '')), ''),
      last_error_message = left(coalesce(p_error_message, ''), 2000),
      last_error_at = v_now,
      updated_at = v_now
    where d.id = p_derivative_id
    returning
      d.id,
      d.status,
      d.attempt_count,
      d.max_attempts,
      d.run_after,
      d.failed_at,
      d.last_error_code,
      d.last_error_message,
      d.last_error_at,
      d.updated_at;
  end if;
end;
$$;

create or replace function public.claim_asset_image_derivatives(
  p_locked_by text,
  p_batch_size integer default 25,
  p_lease_seconds integer default 900
)
returns table (
  derivative_id uuid,
  tenant_id uuid,
  project_id uuid,
  asset_id uuid,
  derivative_kind text,
  derivative_version text,
  storage_bucket text,
  storage_path text,
  content_type text,
  file_size_bytes bigint,
  width integer,
  height integer,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  locked_at timestamptz,
  locked_by text,
  lease_expires_at timestamptz,
  generated_at timestamptz,
  failed_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_error_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.claim_asset_image_derivatives(
    p_locked_by,
    p_batch_size,
    p_lease_seconds
  );
$$;

create or replace function public.fail_asset_image_derivative(
  p_derivative_id uuid,
  p_error_code text default null,
  p_error_message text default null,
  p_retryable boolean default true,
  p_retry_delay_seconds integer default null
)
returns table (
  derivative_id uuid,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  failed_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_error_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.fail_asset_image_derivative(
    p_derivative_id,
    p_error_code,
    p_error_message,
    p_retryable,
    p_retry_delay_seconds
  );
$$;

revoke all on function app.claim_asset_image_derivatives(text, integer, integer) from public;
revoke all on function app.fail_asset_image_derivative(uuid, text, text, boolean, integer) from public;
revoke all on function public.claim_asset_image_derivatives(text, integer, integer) from public;
revoke all on function public.fail_asset_image_derivative(uuid, text, text, boolean, integer) from public;

grant execute on function public.claim_asset_image_derivatives(text, integer, integer) to service_role;
grant execute on function public.fail_asset_image_derivative(uuid, text, text, boolean, integer) to service_role;
