create table if not exists public.outbound_email_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email_kind text not null,
  status text not null default 'pending',
  dedupe_key text not null,
  payload_json jsonb not null default '{}'::jsonb,
  to_email text not null,
  from_email text not null,
  rendered_subject text,
  rendered_text text,
  rendered_html text,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  lease_expires_at timestamptz,
  last_worker_id text,
  last_attempted_at timestamptz,
  provider_message_id text,
  last_error_code text,
  last_error_message text,
  sent_at timestamptz,
  cancelled_at timestamptz,
  dead_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_email_jobs_status_check
    check (status in ('pending', 'processing', 'sent', 'cancelled', 'dead')),
  constraint outbound_email_jobs_attempt_count_check
    check (attempt_count >= 0),
  constraint outbound_email_jobs_max_attempts_check
    check (max_attempts > 0),
  constraint outbound_email_jobs_payload_object_check
    check (jsonb_typeof(payload_json) = 'object'),
  constraint outbound_email_jobs_tenant_dedupe_key_key
    unique (tenant_id, dedupe_key)
);

create index if not exists outbound_email_jobs_tenant_status_run_after_idx
  on public.outbound_email_jobs (tenant_id, status, run_after, created_at);

create index if not exists outbound_email_jobs_tenant_status_lease_idx
  on public.outbound_email_jobs (tenant_id, status, lease_expires_at);

alter table public.outbound_email_jobs enable row level security;

revoke all on table public.outbound_email_jobs from public;
revoke all on table public.outbound_email_jobs from anon;
revoke all on table public.outbound_email_jobs from authenticated;

create or replace function app.enqueue_outbound_email_job(
  p_tenant_id uuid,
  p_email_kind text,
  p_dedupe_key text,
  p_payload_json jsonb default '{}'::jsonb,
  p_to_email text default null,
  p_from_email text default null,
  p_rendered_subject text default null,
  p_rendered_text text default null,
  p_rendered_html text default null,
  p_max_attempts integer default 5,
  p_run_after timestamptz default null,
  p_initial_status text default 'pending',
  p_error_code text default null,
  p_error_message text default null
)
returns table (
  job_id uuid,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  sent_at timestamptz,
  cancelled_at timestamptz,
  dead_at timestamptz,
  enqueued boolean
)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_now timestamptz := now();
  v_run_after timestamptz := coalesce(p_run_after, v_now);
  v_dedupe_key text := nullif(trim(p_dedupe_key), '');
  v_initial_status text := coalesce(nullif(trim(p_initial_status), ''), 'pending');
  v_to_email text := nullif(trim(coalesce(p_to_email, '')), '');
  v_from_email text := nullif(trim(coalesce(p_from_email, '')), '');
  v_rendered_subject text := nullif(coalesce(p_rendered_subject, ''), '');
  v_rendered_text text := nullif(coalesce(p_rendered_text, ''), '');
begin
  if p_tenant_id is null then
    raise exception 'outbound_email_job_missing_tenant' using errcode = '23514';
  end if;

  if v_dedupe_key is null then
    raise exception 'outbound_email_job_missing_dedupe_key' using errcode = '23514';
  end if;

  if v_initial_status not in ('pending', 'dead') then
    raise exception 'outbound_email_job_invalid_initial_status' using errcode = '23514';
  end if;

  if v_to_email is null or v_from_email is null then
    raise exception 'outbound_email_job_missing_address' using errcode = '23514';
  end if;

  if v_initial_status = 'pending' and (v_rendered_subject is null or v_rendered_text is null) then
    raise exception 'outbound_email_job_missing_rendered_content' using errcode = '23514';
  end if;

  return query
  with upserted as (
    insert into public.outbound_email_jobs (
      tenant_id,
      email_kind,
      status,
      dedupe_key,
      payload_json,
      to_email,
      from_email,
      rendered_subject,
      rendered_text,
      rendered_html,
      attempt_count,
      max_attempts,
      run_after,
      last_error_code,
      last_error_message,
      dead_at,
      created_at,
      updated_at
    )
    values (
      p_tenant_id,
      trim(p_email_kind),
      v_initial_status,
      v_dedupe_key,
      coalesce(p_payload_json, '{}'::jsonb),
      v_to_email,
      v_from_email,
      p_rendered_subject,
      p_rendered_text,
      p_rendered_html,
      0,
      p_max_attempts,
      v_run_after,
      nullif(trim(coalesce(p_error_code, '')), ''),
      left(coalesce(p_error_message, ''), 2000),
      case when v_initial_status = 'dead' then v_now else null end,
      v_now,
      v_now
    )
    on conflict (tenant_id, dedupe_key)
    do update
      set updated_at = v_now
    returning
      public.outbound_email_jobs.id,
      public.outbound_email_jobs.status,
      public.outbound_email_jobs.attempt_count,
      public.outbound_email_jobs.max_attempts,
      public.outbound_email_jobs.run_after,
      public.outbound_email_jobs.sent_at,
      public.outbound_email_jobs.cancelled_at,
      public.outbound_email_jobs.dead_at,
      (xmax = 0) as was_inserted
  )
  select
    u.id,
    u.status,
    u.attempt_count,
    u.max_attempts,
    u.run_after,
    u.sent_at,
    u.cancelled_at,
    u.dead_at,
    u.was_inserted
  from upserted u;
end;
$$;

create or replace function app.complete_outbound_email_job(
  p_job_id uuid,
  p_worker_id text,
  p_provider_message_id text default null
)
returns table (
  job_id uuid,
  status text,
  sent_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_now timestamptz := now();
  v_worker_id text := nullif(trim(p_worker_id), '');
begin
  if p_job_id is null or v_worker_id is null then
    raise exception 'outbound_email_job_complete_invalid' using errcode = '23514';
  end if;

  return query
  update public.outbound_email_jobs j
  set
    status = 'sent',
    sent_at = coalesce(j.sent_at, v_now),
    provider_message_id = nullif(trim(coalesce(p_provider_message_id, '')), ''),
    locked_at = null,
    lease_expires_at = null,
    updated_at = v_now
  where j.id = p_job_id
    and j.status = 'processing'
    and j.last_worker_id = v_worker_id
  returning
    j.id,
    j.status,
    j.sent_at,
    j.updated_at;
end;
$$;

create or replace function app.fail_outbound_email_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text default null,
  p_error_message text default null,
  p_retryable boolean default true,
  p_retry_delay_seconds integer default null
)
returns table (
  job_id uuid,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  last_error_code text,
  last_error_message text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_now timestamptz := now();
  v_worker_id text := nullif(trim(p_worker_id), '');
  v_job public.outbound_email_jobs;
  v_retry_delay_seconds integer;
begin
  if p_job_id is null or v_worker_id is null then
    raise exception 'outbound_email_job_fail_invalid' using errcode = '23514';
  end if;

  select *
  into v_job
  from public.outbound_email_jobs j
  where j.id = p_job_id
    and j.status = 'processing'
    and j.last_worker_id = v_worker_id
  for update;

  if not found then
    return;
  end if;

  if coalesce(p_retryable, true) and v_job.attempt_count < v_job.max_attempts then
    v_retry_delay_seconds := coalesce(
      p_retry_delay_seconds,
      case v_job.attempt_count
        when 1 then 60
        when 2 then 300
        when 3 then 900
        else 3600
      end
    );

    return query
    update public.outbound_email_jobs j
    set
      status = 'pending',
      run_after = v_now + make_interval(secs => greatest(1, v_retry_delay_seconds)),
      locked_at = null,
      lease_expires_at = null,
      last_error_code = nullif(trim(coalesce(p_error_code, '')), ''),
      last_error_message = left(coalesce(p_error_message, ''), 2000),
      updated_at = v_now
    where j.id = p_job_id
    returning
      j.id,
      j.status,
      j.attempt_count,
      j.max_attempts,
      j.run_after,
      j.last_error_code,
      j.last_error_message,
      j.updated_at;

    return;
  end if;

  return query
  update public.outbound_email_jobs j
  set
    status = 'dead',
    dead_at = coalesce(j.dead_at, v_now),
    locked_at = null,
    lease_expires_at = null,
    last_error_code = nullif(trim(coalesce(p_error_code, '')), ''),
    last_error_message = left(coalesce(p_error_message, ''), 2000),
    updated_at = v_now
  where j.id = p_job_id
  returning
    j.id,
    j.status,
    j.attempt_count,
    j.max_attempts,
    j.run_after,
    j.last_error_code,
    j.last_error_message,
    j.updated_at;
end;
$$;

create or replace function app.cancel_outbound_email_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text default null,
  p_error_message text default null
)
returns table (
  job_id uuid,
  status text,
  cancelled_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_now timestamptz := now();
  v_worker_id text := nullif(trim(p_worker_id), '');
begin
  if p_job_id is null or v_worker_id is null then
    raise exception 'outbound_email_job_cancel_invalid' using errcode = '23514';
  end if;

  return query
  update public.outbound_email_jobs j
  set
    status = 'cancelled',
    cancelled_at = coalesce(j.cancelled_at, v_now),
    locked_at = null,
    lease_expires_at = null,
    last_error_code = nullif(trim(coalesce(p_error_code, '')), ''),
    last_error_message = left(coalesce(p_error_message, ''), 2000),
    updated_at = v_now
  where j.id = p_job_id
    and j.status = 'processing'
    and j.last_worker_id = v_worker_id
  returning
    j.id,
    j.status,
    j.cancelled_at,
    j.updated_at;
end;
$$;

create or replace function app.claim_outbound_email_job_by_id(
  p_job_id uuid,
  p_tenant_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns table (
  job_id uuid,
  tenant_id uuid,
  email_kind text,
  status text,
  dedupe_key text,
  payload_json jsonb,
  to_email text,
  from_email text,
  rendered_subject text,
  rendered_text text,
  rendered_html text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  locked_at timestamptz,
  lease_expires_at timestamptz,
  last_worker_id text,
  last_attempted_at timestamptz,
  provider_message_id text,
  last_error_code text,
  last_error_message text,
  sent_at timestamptz,
  cancelled_at timestamptz,
  dead_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  reclaimed boolean
)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_now timestamptz := now();
  v_worker_id text := nullif(trim(p_worker_id), '');
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 300), 3600));
begin
  if p_job_id is null or p_tenant_id is null then
    raise exception 'outbound_email_job_claim_missing_scope' using errcode = '23514';
  end if;

  if v_worker_id is null then
    raise exception 'outbound_email_job_worker_id_required' using errcode = '23514';
  end if;

  return query
  with claimable as (
    select
      j.id,
      (j.status = 'processing') as reclaimed
    from public.outbound_email_jobs j
    where j.id = p_job_id
      and j.tenant_id = p_tenant_id
      and (
        (j.status = 'pending' and j.run_after <= v_now)
        or (
          j.status = 'processing'
          and coalesce(j.lease_expires_at, j.locked_at, j.updated_at, j.created_at) <= v_now
        )
      )
    for update skip locked
  ),
  updated as (
    update public.outbound_email_jobs j
    set
      status = 'processing',
      attempt_count = j.attempt_count + 1,
      locked_at = v_now,
      lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
      last_worker_id = v_worker_id,
      last_attempted_at = v_now,
      updated_at = v_now
    from claimable c
    where j.id = c.id
    returning
      j.*,
      c.reclaimed
  )
  select
    u.id,
    u.tenant_id,
    u.email_kind,
    u.status,
    u.dedupe_key,
    u.payload_json,
    u.to_email,
    u.from_email,
    u.rendered_subject,
    u.rendered_text,
    u.rendered_html,
    u.attempt_count,
    u.max_attempts,
    u.run_after,
    u.locked_at,
    u.lease_expires_at,
    u.last_worker_id,
    u.last_attempted_at,
    u.provider_message_id,
    u.last_error_code,
    u.last_error_message,
    u.sent_at,
    u.cancelled_at,
    u.dead_at,
    u.created_at,
    u.updated_at,
    u.reclaimed
  from updated u;
end;
$$;

create or replace function app.claim_outbound_email_jobs(
  p_worker_id text,
  p_batch_size integer default 25,
  p_lease_seconds integer default 300
)
returns table (
  job_id uuid,
  tenant_id uuid,
  email_kind text,
  status text,
  dedupe_key text,
  payload_json jsonb,
  to_email text,
  from_email text,
  rendered_subject text,
  rendered_text text,
  rendered_html text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  locked_at timestamptz,
  lease_expires_at timestamptz,
  last_worker_id text,
  last_attempted_at timestamptz,
  provider_message_id text,
  last_error_code text,
  last_error_message text,
  sent_at timestamptz,
  cancelled_at timestamptz,
  dead_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  reclaimed boolean
)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_now timestamptz := now();
  v_worker_id text := nullif(trim(p_worker_id), '');
  v_batch_size integer := greatest(1, least(coalesce(p_batch_size, 25), 200));
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 300), 3600));
begin
  if v_worker_id is null then
    raise exception 'outbound_email_job_worker_id_required' using errcode = '23514';
  end if;

  return query
  with claimable as (
    select
      j.id,
      (j.status = 'processing') as reclaimed
    from public.outbound_email_jobs j
    where
      (j.status = 'pending' and j.run_after <= v_now)
      or (
        j.status = 'processing'
        and coalesce(j.lease_expires_at, j.locked_at, j.updated_at, j.created_at) <= v_now
      )
    order by
      coalesce(j.run_after, j.lease_expires_at, j.locked_at, j.updated_at, j.created_at) asc,
      j.created_at asc
    for update skip locked
    limit v_batch_size
  ),
  updated as (
    update public.outbound_email_jobs j
    set
      status = 'processing',
      attempt_count = j.attempt_count + 1,
      locked_at = v_now,
      lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
      last_worker_id = v_worker_id,
      last_attempted_at = v_now,
      updated_at = v_now
    from claimable c
    where j.id = c.id
    returning
      j.*,
      c.reclaimed
  )
  select
    u.id,
    u.tenant_id,
    u.email_kind,
    u.status,
    u.dedupe_key,
    u.payload_json,
    u.to_email,
    u.from_email,
    u.rendered_subject,
    u.rendered_text,
    u.rendered_html,
    u.attempt_count,
    u.max_attempts,
    u.run_after,
    u.locked_at,
    u.lease_expires_at,
    u.last_worker_id,
    u.last_attempted_at,
    u.provider_message_id,
    u.last_error_code,
    u.last_error_message,
    u.sent_at,
    u.cancelled_at,
    u.dead_at,
    u.created_at,
    u.updated_at,
    u.reclaimed
  from updated u
  order by u.run_after asc, u.created_at asc;
end;
$$;

create or replace function public.enqueue_outbound_email_job(
  p_tenant_id uuid,
  p_email_kind text,
  p_dedupe_key text,
  p_payload_json jsonb default '{}'::jsonb,
  p_to_email text default null,
  p_from_email text default null,
  p_rendered_subject text default null,
  p_rendered_text text default null,
  p_rendered_html text default null,
  p_max_attempts integer default 5,
  p_run_after timestamptz default null,
  p_initial_status text default 'pending',
  p_error_code text default null,
  p_error_message text default null
)
returns table (
  job_id uuid,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  sent_at timestamptz,
  cancelled_at timestamptz,
  dead_at timestamptz,
  enqueued boolean
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.enqueue_outbound_email_job(
    p_tenant_id,
    p_email_kind,
    p_dedupe_key,
    p_payload_json,
    p_to_email,
    p_from_email,
    p_rendered_subject,
    p_rendered_text,
    p_rendered_html,
    p_max_attempts,
    p_run_after,
    p_initial_status,
    p_error_code,
    p_error_message
  );
$$;

create or replace function public.claim_outbound_email_job_by_id(
  p_job_id uuid,
  p_tenant_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns table (
  job_id uuid,
  tenant_id uuid,
  email_kind text,
  status text,
  dedupe_key text,
  payload_json jsonb,
  to_email text,
  from_email text,
  rendered_subject text,
  rendered_text text,
  rendered_html text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  locked_at timestamptz,
  lease_expires_at timestamptz,
  last_worker_id text,
  last_attempted_at timestamptz,
  provider_message_id text,
  last_error_code text,
  last_error_message text,
  sent_at timestamptz,
  cancelled_at timestamptz,
  dead_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  reclaimed boolean
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.claim_outbound_email_job_by_id(
    p_job_id,
    p_tenant_id,
    p_worker_id,
    p_lease_seconds
  );
$$;

create or replace function public.claim_outbound_email_jobs(
  p_worker_id text,
  p_batch_size integer default 25,
  p_lease_seconds integer default 300
)
returns table (
  job_id uuid,
  tenant_id uuid,
  email_kind text,
  status text,
  dedupe_key text,
  payload_json jsonb,
  to_email text,
  from_email text,
  rendered_subject text,
  rendered_text text,
  rendered_html text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  locked_at timestamptz,
  lease_expires_at timestamptz,
  last_worker_id text,
  last_attempted_at timestamptz,
  provider_message_id text,
  last_error_code text,
  last_error_message text,
  sent_at timestamptz,
  cancelled_at timestamptz,
  dead_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  reclaimed boolean
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.claim_outbound_email_jobs(
    p_worker_id,
    p_batch_size,
    p_lease_seconds
  );
$$;

create or replace function public.complete_outbound_email_job(
  p_job_id uuid,
  p_worker_id text,
  p_provider_message_id text default null
)
returns table (
  job_id uuid,
  status text,
  sent_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.complete_outbound_email_job(
    p_job_id,
    p_worker_id,
    p_provider_message_id
  );
$$;

create or replace function public.fail_outbound_email_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text default null,
  p_error_message text default null,
  p_retryable boolean default true,
  p_retry_delay_seconds integer default null
)
returns table (
  job_id uuid,
  status text,
  attempt_count integer,
  max_attempts integer,
  run_after timestamptz,
  last_error_code text,
  last_error_message text,
  updated_at timestamptz
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.fail_outbound_email_job(
    p_job_id,
    p_worker_id,
    p_error_code,
    p_error_message,
    p_retryable,
    p_retry_delay_seconds
  );
$$;

create or replace function public.cancel_outbound_email_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text default null,
  p_error_message text default null
)
returns table (
  job_id uuid,
  status text,
  cancelled_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.cancel_outbound_email_job(
    p_job_id,
    p_worker_id,
    p_error_code,
    p_error_message
  );
$$;

revoke all on function app.enqueue_outbound_email_job(uuid, text, text, jsonb, text, text, text, text, text, integer, timestamptz, text, text, text) from public;
revoke all on function app.claim_outbound_email_job_by_id(uuid, uuid, text, integer) from public;
revoke all on function app.claim_outbound_email_jobs(text, integer, integer) from public;
revoke all on function app.complete_outbound_email_job(uuid, text, text) from public;
revoke all on function app.fail_outbound_email_job(uuid, text, text, text, boolean, integer) from public;
revoke all on function app.cancel_outbound_email_job(uuid, text, text, text) from public;
