create or replace function app.get_project_matching_progress(
  p_tenant_id uuid,
  p_project_id uuid,
  p_pipeline_mode text,
  p_materializer_version text
)
returns table (
  total_images bigint,
  processed_images bigint,
  is_matching_in_progress boolean
)
language sql
security definer
set search_path = public, app, extensions
as $$
  with uploaded_photos as (
    select a.id
    from public.assets a
    where a.tenant_id = p_tenant_id
      and a.project_id = p_project_id
      and a.asset_type = 'photo'
      and a.status = 'uploaded'
      and a.archived_at is null
  ),
  materialized_processed as (
    select count(distinct m.asset_id)::bigint as processed_count
    from public.asset_face_materializations m
    inner join uploaded_photos p
      on p.id = m.asset_id
    where m.tenant_id = p_tenant_id
      and m.project_id = p_project_id
      and m.asset_type = 'photo'
      and m.materializer_version = p_materializer_version
  ),
  raw_processed as (
    select count(*)::bigint as processed_count
    from uploaded_photos p
    where exists (
      select 1
      from public.face_match_jobs j
      where j.tenant_id = p_tenant_id
        and j.project_id = p_project_id
        and j.job_type = 'photo_uploaded'
        and j.scope_asset_id = p.id
        and j.status in ('succeeded', 'dead')
    )
      and not exists (
        select 1
        from public.face_match_jobs j
        where j.tenant_id = p_tenant_id
          and j.project_id = p_project_id
          and j.job_type = 'photo_uploaded'
          and j.scope_asset_id = p.id
          and j.status in ('queued', 'processing')
      )
  ),
  active_jobs as (
    select exists(
      select 1
      from public.face_match_jobs j
      where j.tenant_id = p_tenant_id
        and j.project_id = p_project_id
        and j.status in ('queued', 'processing')
        and j.job_type in ('photo_uploaded', 'consent_headshot_ready', 'materialize_asset_faces', 'compare_materialized_pair')
    ) as is_active
  )
  select
    (select count(*)::bigint from uploaded_photos) as total_images,
    case
      when p_pipeline_mode in ('materialized_apply', 'materialized_shadow')
        then coalesce((select processed_count from materialized_processed), 0)
      else coalesce((select processed_count from raw_processed), 0)
    end as processed_images,
    coalesce((select is_active from active_jobs), false) as is_matching_in_progress;
$$;

create or replace function app.list_current_project_consent_headshots(
  p_tenant_id uuid,
  p_project_id uuid,
  p_opt_in_only boolean default true,
  p_not_revoked_only boolean default false,
  p_limit integer default null
)
returns table (
  consent_id uuid,
  headshot_asset_id uuid,
  headshot_uploaded_at timestamptz
)
language sql
security definer
set search_path = public, app, extensions
as $$
  with scoped_consents as (
    select
      c.id,
      row_number() over (
        order by c.signed_at desc nulls last, c.created_at desc, c.id desc
      ) as consent_rank
    from public.consents c
    where c.tenant_id = p_tenant_id
      and c.project_id = p_project_id
      and (not coalesce(p_opt_in_only, true) or c.face_match_opt_in = true)
      and (not coalesce(p_not_revoked_only, false) or c.revoked_at is null)
  ),
  limited_consents as (
    select sc.id, sc.consent_rank
    from scoped_consents sc
    where p_limit is null
       or p_limit <= 0
       or sc.consent_rank <= p_limit
  ),
  ranked_headshots as (
    select
      lc.id as consent_id,
      lc.consent_rank,
      a.id as headshot_asset_id,
      a.uploaded_at as headshot_uploaded_at,
      row_number() over (
        partition by lc.id
        order by a.uploaded_at desc nulls last, a.created_at desc, a.id desc
      ) as headshot_rank
    from limited_consents lc
    inner join public.asset_consent_links acl
      on acl.tenant_id = p_tenant_id
      and acl.project_id = p_project_id
      and acl.consent_id = lc.id
    inner join public.assets a
      on a.id = acl.asset_id
      and a.tenant_id = p_tenant_id
      and a.project_id = p_project_id
      and a.asset_type = 'headshot'
      and a.status = 'uploaded'
      and a.archived_at is null
      and (a.retention_expires_at is null or a.retention_expires_at > now())
  )
  select
    rh.consent_id,
    rh.headshot_asset_id,
    rh.headshot_uploaded_at
  from ranked_headshots rh
  where rh.headshot_rank = 1
  order by rh.consent_rank asc;
$$;

create or replace function public.get_project_matching_progress(
  p_tenant_id uuid,
  p_project_id uuid,
  p_pipeline_mode text,
  p_materializer_version text
)
returns table (
  total_images bigint,
  processed_images bigint,
  is_matching_in_progress boolean
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.get_project_matching_progress(
    p_tenant_id,
    p_project_id,
    p_pipeline_mode,
    p_materializer_version
  );
$$;

create or replace function public.list_current_project_consent_headshots(
  p_tenant_id uuid,
  p_project_id uuid,
  p_opt_in_only boolean default true,
  p_not_revoked_only boolean default false,
  p_limit integer default null
)
returns table (
  consent_id uuid,
  headshot_asset_id uuid,
  headshot_uploaded_at timestamptz
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.list_current_project_consent_headshots(
    p_tenant_id,
    p_project_id,
    p_opt_in_only,
    p_not_revoked_only,
    p_limit
  );
$$;

revoke all on function app.get_project_matching_progress(uuid, uuid, text, text) from public;
revoke all on function app.list_current_project_consent_headshots(uuid, uuid, boolean, boolean, integer) from public;

revoke all on function public.get_project_matching_progress(uuid, uuid, text, text) from public;
revoke all on function public.list_current_project_consent_headshots(uuid, uuid, boolean, boolean, integer) from public;

grant execute on function public.get_project_matching_progress(uuid, uuid, text, text) to service_role;
grant execute on function public.list_current_project_consent_headshots(uuid, uuid, boolean, boolean, integer) to service_role;
