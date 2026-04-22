alter table public.consents
  add column if not exists superseded_at timestamptz null,
  add column if not exists superseded_by_consent_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'consents_superseded_by_fkey'
  ) then
    alter table public.consents
      add constraint consents_superseded_by_fkey
      foreign key (superseded_by_consent_id)
      references public.consents (id)
      on delete set null;
  end if;
end;
$$;

alter table public.consents
  drop constraint if exists consents_supersedence_timeline_check;

alter table public.consents
  add constraint consents_supersedence_timeline_check
  check (
    (
      superseded_at is null
      and superseded_by_consent_id is null
    )
    or (
      superseded_at is not null
      and superseded_at >= signed_at
      and (
        superseded_by_consent_id is null
        or superseded_by_consent_id <> id
      )
    )
  );

create index if not exists consents_project_subject_signed_idx
  on public.consents (tenant_id, project_id, subject_id, signed_at desc);

create index if not exists consents_superseded_by_idx
  on public.consents (tenant_id, superseded_by_consent_id)
  where superseded_by_consent_id is not null;

create index if not exists consents_project_active_status_idx
  on public.consents (tenant_id, project_id, revoked_at, superseded_at);

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
      and c.superseded_at is null
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

create or replace function app.list_current_project_consent_headshots_page(
  p_tenant_id uuid,
  p_project_id uuid,
  p_boundary_snapshot_at timestamptz,
  p_opt_in_only boolean default true,
  p_not_revoked_only boolean default true,
  p_limit integer default 100,
  p_cursor_consent_created_at timestamptz default null,
  p_cursor_consent_id uuid default null,
  p_boundary_consent_created_at timestamptz default null,
  p_boundary_consent_id uuid default null
)
returns table (
  consent_id uuid,
  consent_created_at timestamptz,
  headshot_asset_id uuid,
  headshot_uploaded_at timestamptz
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select
    c.id as consent_id,
    c.created_at as consent_created_at,
    current_headshot.headshot_asset_id,
    current_headshot.headshot_uploaded_at
  from public.consents c
  inner join lateral (
    select
      a.id as headshot_asset_id,
      a.uploaded_at as headshot_uploaded_at
    from public.asset_consent_links acl
    inner join public.assets a
      on a.id = acl.asset_id
      and a.tenant_id = p_tenant_id
      and a.project_id = p_project_id
      and a.asset_type = 'headshot'
      and a.status = 'uploaded'
      and a.archived_at is null
      and (a.retention_expires_at is null or a.retention_expires_at > now())
      and a.uploaded_at is not null
      and a.uploaded_at <= p_boundary_snapshot_at
    where acl.tenant_id = p_tenant_id
      and acl.project_id = p_project_id
      and acl.consent_id = c.id
    order by a.uploaded_at desc nulls last, a.id desc
    limit 1
  ) current_headshot on true
  where c.tenant_id = p_tenant_id
    and c.project_id = p_project_id
    and c.superseded_at is null
    and (not coalesce(p_opt_in_only, true) or c.face_match_opt_in = true)
    and (not coalesce(p_not_revoked_only, true) or c.revoked_at is null)
    and (
      p_boundary_consent_created_at is null
      or c.created_at < p_boundary_consent_created_at
      or (c.created_at = p_boundary_consent_created_at and c.id <= p_boundary_consent_id)
    )
    and (
      p_cursor_consent_created_at is null
      or c.created_at > p_cursor_consent_created_at
      or (c.created_at = p_cursor_consent_created_at and c.id > p_cursor_consent_id)
    )
  order by c.created_at asc, c.id asc
  limit greatest(1, least(coalesce(p_limit, 100), 750));
$$;

create or replace view public.project_consent_scope_effective_states
with (security_invoker = true)
as
with source_events as (
  select distinct
    p.tenant_id,
    p.project_id,
    p.owner_kind,
    p.subject_id,
    p.project_profile_participant_id,
    p.source_kind,
    p.consent_id,
    p.recurring_profile_consent_id,
    p.template_id,
    p.template_key,
    p.template_version,
    p.template_version_number,
    p.signed_at,
    p.created_at,
    coalesce(c.revoked_at, rpc.revoked_at) as governing_revoked_at,
    coalesce(p.consent_id::text, p.recurring_profile_consent_id::text) as source_identity
  from public.project_consent_scope_signed_projections p
  left join public.consents c
    on c.id = p.consent_id
   and c.tenant_id = p.tenant_id
  left join public.recurring_profile_consents rpc
    on rpc.id = p.recurring_profile_consent_id
   and rpc.tenant_id = p.tenant_id
  where (p.consent_id is null or c.superseded_at is null)
    and (p.recurring_profile_consent_id is null or rpc.superseded_at is null)
),
ranked_events as (
  select
    source_events.*,
    row_number() over (
      partition by
        source_events.tenant_id,
        source_events.project_id,
        source_events.owner_kind,
        source_events.subject_id,
        source_events.project_profile_participant_id,
        source_events.template_key
      order by
        source_events.signed_at desc,
        source_events.created_at desc,
        source_events.source_identity desc
    ) as event_rank
  from source_events
),
governing_events as (
  select *
  from ranked_events
  where event_rank = 1
),
governing_templates as (
  select
    governing_events.*,
    t.tenant_id as template_owner_tenant_id
  from governing_events
  join public.consent_templates t
    on t.id = governing_events.template_id
),
scope_universe as (
  select
    governing_templates.tenant_id,
    governing_templates.project_id,
    governing_templates.owner_kind,
    governing_templates.subject_id,
    governing_templates.project_profile_participant_id,
    governing_templates.template_key,
    catalog.scope_option_key,
    catalog.scope_label,
    catalog.scope_order_index
  from governing_templates
  join public.project_consent_template_family_scope_catalog catalog
    on catalog.template_key = governing_templates.template_key
   and catalog.tenant_id is not distinct from governing_templates.template_owner_tenant_id

  union

  select
    governing_templates.tenant_id,
    governing_templates.project_id,
    governing_templates.owner_kind,
    governing_templates.subject_id,
    governing_templates.project_profile_participant_id,
    governing_templates.template_key,
    governing_projection.scope_option_key,
    governing_projection.scope_label_snapshot,
    governing_projection.scope_order_index
  from governing_templates
  join public.project_consent_scope_signed_projections governing_projection
    on governing_projection.tenant_id = governing_templates.tenant_id
   and governing_projection.project_id = governing_templates.project_id
   and governing_projection.source_kind = governing_templates.source_kind
   and governing_projection.template_key = governing_templates.template_key
   and (
     (governing_templates.consent_id is not null and governing_projection.consent_id = governing_templates.consent_id)
     or (
       governing_templates.recurring_profile_consent_id is not null
       and governing_projection.recurring_profile_consent_id = governing_templates.recurring_profile_consent_id
     )
   )
)
select
  governing_templates.tenant_id,
  governing_templates.project_id,
  governing_templates.owner_kind,
  governing_templates.subject_id,
  governing_templates.project_profile_participant_id,
  governing_templates.template_key,
  scope_universe.scope_option_key,
  scope_universe.scope_label,
  scope_universe.scope_order_index,
  case
    when governing_projection.scope_option_key is null then 'not_collected'
    when governing_templates.governing_revoked_at is not null then 'revoked'
    when governing_projection.granted then 'granted'
    else 'not_granted'
  end as effective_status,
  case
    when governing_projection.scope_option_key is null then null
    else governing_projection.granted
  end as signed_value_granted,
  governing_templates.source_kind as governing_source_kind,
  governing_templates.consent_id as governing_consent_id,
  governing_templates.recurring_profile_consent_id as governing_recurring_profile_consent_id,
  governing_templates.template_id as governing_template_id,
  governing_templates.template_version as governing_template_version,
  governing_templates.template_version_number as governing_template_version_number,
  governing_templates.signed_at as governing_signed_at,
  governing_templates.governing_revoked_at
from governing_templates
join scope_universe
  on scope_universe.tenant_id = governing_templates.tenant_id
 and scope_universe.project_id = governing_templates.project_id
 and scope_universe.owner_kind = governing_templates.owner_kind
 and scope_universe.subject_id is not distinct from governing_templates.subject_id
 and scope_universe.project_profile_participant_id is not distinct from governing_templates.project_profile_participant_id
 and scope_universe.template_key = governing_templates.template_key
left join public.project_consent_scope_signed_projections governing_projection
  on governing_projection.tenant_id = governing_templates.tenant_id
 and governing_projection.project_id = governing_templates.project_id
 and governing_projection.source_kind = governing_templates.source_kind
 and governing_projection.scope_option_key = scope_universe.scope_option_key
 and (
   (governing_templates.consent_id is not null and governing_projection.consent_id = governing_templates.consent_id)
   or (
     governing_templates.recurring_profile_consent_id is not null
     and governing_projection.recurring_profile_consent_id = governing_templates.recurring_profile_consent_id
   )
 );
