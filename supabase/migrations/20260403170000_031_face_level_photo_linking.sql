create table if not exists public.asset_face_consent_links (
  asset_face_id uuid primary key
    references public.asset_face_materialization_faces(id) on delete cascade,
  asset_materialization_id uuid not null
    references public.asset_face_materializations(id) on delete cascade,
  asset_id uuid not null,
  consent_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  link_source text not null default 'manual',
  match_confidence numeric(5,4),
  matched_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  matcher_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_face_consent_links_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_face_consent_links_consent_scope_fk
    foreign key (consent_id, tenant_id, project_id)
    references public.consents(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_face_consent_links_asset_consent_unique
    unique (tenant_id, project_id, asset_id, consent_id),
  constraint asset_face_consent_links_link_source_check
    check (link_source in ('manual', 'auto')),
  constraint asset_face_consent_links_match_confidence_check
    check (match_confidence is null or (match_confidence >= 0 and match_confidence <= 1))
);

create index if not exists asset_face_consent_links_tenant_project_consent_idx
  on public.asset_face_consent_links (tenant_id, project_id, consent_id);

create index if not exists asset_face_consent_links_tenant_project_asset_idx
  on public.asset_face_consent_links (tenant_id, project_id, asset_id);

create index if not exists asset_face_consent_links_tenant_project_materialization_idx
  on public.asset_face_consent_links (tenant_id, project_id, asset_materialization_id);

create index if not exists asset_face_consent_links_tenant_project_source_idx
  on public.asset_face_consent_links (tenant_id, project_id, link_source, consent_id);

create table if not exists public.asset_face_consent_link_suppressions (
  asset_face_id uuid not null
    references public.asset_face_materialization_faces(id) on delete cascade,
  asset_materialization_id uuid not null
    references public.asset_face_materializations(id) on delete cascade,
  asset_id uuid not null,
  consent_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  reason text not null default 'manual_unlink',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint asset_face_consent_link_suppressions_pkey primary key (asset_face_id, consent_id),
  constraint asset_face_consent_link_suppressions_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_face_consent_link_suppressions_consent_scope_fk
    foreign key (consent_id, tenant_id, project_id)
    references public.consents(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_face_consent_link_suppressions_reason_check
    check (reason in ('manual_unlink', 'manual_replace'))
);

create index if not exists asset_face_consent_link_suppressions_tenant_project_consent_idx
  on public.asset_face_consent_link_suppressions (tenant_id, project_id, consent_id);

create index if not exists asset_face_consent_link_suppressions_tenant_project_asset_idx
  on public.asset_face_consent_link_suppressions (tenant_id, project_id, asset_id);

create table if not exists public.asset_consent_manual_photo_fallbacks (
  asset_id uuid not null,
  consent_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_consent_manual_photo_fallbacks_pkey primary key (asset_id, consent_id),
  constraint asset_consent_manual_photo_fallbacks_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_consent_manual_photo_fallbacks_consent_scope_fk
    foreign key (consent_id, tenant_id, project_id)
    references public.consents(id, tenant_id, project_id)
    on delete cascade
);

create index if not exists asset_consent_manual_photo_fallbacks_tenant_project_consent_idx
  on public.asset_consent_manual_photo_fallbacks (tenant_id, project_id, consent_id);

create table if not exists public.asset_consent_manual_photo_fallback_suppressions (
  asset_id uuid not null,
  consent_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  reason text not null default 'manual_unlink',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint asset_consent_manual_photo_fallback_suppressions_pkey primary key (asset_id, consent_id),
  constraint asset_consent_manual_photo_fallback_suppressions_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_consent_manual_photo_fallback_suppressions_consent_scope_fk
    foreign key (consent_id, tenant_id, project_id)
    references public.consents(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_consent_manual_photo_fallback_suppressions_reason_check
    check (reason in ('manual_unlink'))
);

create index if not exists asset_consent_manual_photo_fallback_suppressions_tenant_project_consent_idx
  on public.asset_consent_manual_photo_fallback_suppressions (tenant_id, project_id, consent_id);

create table if not exists public.asset_consent_legacy_photo_links (
  asset_id uuid not null,
  consent_id uuid not null,
  tenant_id uuid not null,
  project_id uuid not null,
  link_source text not null,
  match_confidence numeric(5,4),
  matched_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  matcher_version text,
  original_created_at timestamptz not null,
  migration_status text not null,
  current_materialization_id uuid,
  current_face_count integer,
  migrated_asset_face_id uuid,
  migrated_at timestamptz not null default now(),
  constraint asset_consent_legacy_photo_links_pkey primary key (asset_id, consent_id)
);

create table if not exists public.asset_consent_legacy_photo_link_suppressions (
  asset_id uuid not null,
  consent_id uuid not null,
  tenant_id uuid not null,
  project_id uuid not null,
  reason text not null,
  original_created_at timestamptz not null,
  created_by uuid,
  migration_status text not null,
  current_materialization_id uuid,
  current_face_count integer,
  migrated_asset_face_id uuid,
  migrated_at timestamptz not null default now(),
  constraint asset_consent_legacy_photo_link_suppressions_pkey primary key (asset_id, consent_id)
);

alter table public.asset_consent_match_candidates
  add column if not exists winning_asset_face_id uuid,
  add column if not exists winning_asset_face_rank integer;

alter table public.asset_consent_match_candidates
  drop constraint if exists asset_consent_match_candidates_winning_face_fk,
  drop constraint if exists asset_consent_match_candidates_winning_face_rank_check;

alter table public.asset_consent_match_candidates
  add constraint asset_consent_match_candidates_winning_face_fk
    foreign key (winning_asset_face_id)
    references public.asset_face_materialization_faces(id)
    on delete set null,
  add constraint asset_consent_match_candidates_winning_face_rank_check
    check (winning_asset_face_rank is null or winning_asset_face_rank >= 0);

create index if not exists asset_consent_face_compares_winning_face_compare_idx
  on public.asset_consent_face_compares (tenant_id, project_id, winning_asset_face_id, compare_version);

alter table public.asset_face_consent_links enable row level security;
alter table public.asset_face_consent_link_suppressions enable row level security;
alter table public.asset_consent_manual_photo_fallbacks enable row level security;
alter table public.asset_consent_manual_photo_fallback_suppressions enable row level security;
alter table public.asset_consent_legacy_photo_links enable row level security;
alter table public.asset_consent_legacy_photo_link_suppressions enable row level security;

revoke all on table public.asset_face_consent_links from public;
revoke all on table public.asset_face_consent_links from anon;
revoke all on table public.asset_face_consent_links from authenticated;
revoke all on table public.asset_face_consent_link_suppressions from public;
revoke all on table public.asset_face_consent_link_suppressions from anon;
revoke all on table public.asset_face_consent_link_suppressions from authenticated;
revoke all on table public.asset_consent_manual_photo_fallbacks from public;
revoke all on table public.asset_consent_manual_photo_fallbacks from anon;
revoke all on table public.asset_consent_manual_photo_fallbacks from authenticated;
revoke all on table public.asset_consent_manual_photo_fallback_suppressions from public;
revoke all on table public.asset_consent_manual_photo_fallback_suppressions from anon;
revoke all on table public.asset_consent_manual_photo_fallback_suppressions from authenticated;

create policy "asset_face_consent_links_select_member"
on public.asset_face_consent_links
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_face_consent_links.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_face_consent_links_insert_member"
on public.asset_face_consent_links
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_face_consent_links.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_face_consent_links_update_member"
on public.asset_face_consent_links
for update
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_face_consent_links.tenant_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_face_consent_links.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_face_consent_links_delete_member"
on public.asset_face_consent_links
for delete
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_face_consent_links.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_face_consent_link_suppressions_select_member"
on public.asset_face_consent_link_suppressions
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_face_consent_link_suppressions.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_face_consent_link_suppressions_insert_member"
on public.asset_face_consent_link_suppressions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_face_consent_link_suppressions.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_face_consent_link_suppressions_delete_member"
on public.asset_face_consent_link_suppressions
for delete
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_face_consent_link_suppressions.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_consent_manual_photo_fallbacks_select_member"
on public.asset_consent_manual_photo_fallbacks
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_manual_photo_fallbacks.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_consent_manual_photo_fallbacks_insert_member"
on public.asset_consent_manual_photo_fallbacks
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_manual_photo_fallbacks.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_consent_manual_photo_fallbacks_update_member"
on public.asset_consent_manual_photo_fallbacks
for update
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_manual_photo_fallbacks.tenant_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_manual_photo_fallbacks.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_consent_manual_photo_fallbacks_delete_member"
on public.asset_consent_manual_photo_fallbacks
for delete
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_manual_photo_fallbacks.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_consent_manual_photo_fallback_suppressions_select_member"
on public.asset_consent_manual_photo_fallback_suppressions
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_manual_photo_fallback_suppressions.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_consent_manual_photo_fallback_suppressions_insert_member"
on public.asset_consent_manual_photo_fallback_suppressions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_manual_photo_fallback_suppressions.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_consent_manual_photo_fallback_suppressions_delete_member"
on public.asset_consent_manual_photo_fallback_suppressions
for delete
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_consent_manual_photo_fallback_suppressions.tenant_id
      and m.user_id = auth.uid()
  )
);

revoke all on table public.asset_consent_legacy_photo_links from public;
revoke all on table public.asset_consent_legacy_photo_links from anon;
revoke all on table public.asset_consent_legacy_photo_links from authenticated;
revoke all on table public.asset_consent_legacy_photo_link_suppressions from public;
revoke all on table public.asset_consent_legacy_photo_link_suppressions from anon;
revoke all on table public.asset_consent_legacy_photo_link_suppressions from authenticated;

grant select, insert, update, delete on table public.asset_face_consent_links to service_role;
grant select, insert, update, delete on table public.asset_face_consent_link_suppressions to service_role;
grant select, insert, update, delete on table public.asset_consent_manual_photo_fallbacks to service_role;
grant select, insert, update, delete on table public.asset_consent_manual_photo_fallback_suppressions to service_role;
grant select, insert, update, delete on table public.asset_consent_legacy_photo_links to service_role;
grant select, insert, update, delete on table public.asset_consent_legacy_photo_link_suppressions to service_role;

with current_photo_materializations as (
  select distinct on (m.tenant_id, m.project_id, m.asset_id)
    m.tenant_id,
    m.project_id,
    m.asset_id,
    m.id as materialization_id,
    m.face_count
  from public.asset_face_materializations m
  where m.asset_type = 'photo'
  order by m.tenant_id, m.project_id, m.asset_id, m.materialized_at desc, m.created_at desc, m.id desc
),
single_faces as (
  select
    f.tenant_id,
    f.project_id,
    f.asset_id,
    f.materialization_id,
    f.id as asset_face_id
  from public.asset_face_materialization_faces f
  inner join current_photo_materializations cpm
    on cpm.materialization_id = f.materialization_id
  where cpm.face_count = 1
),
photo_links as (
  select
    acl.asset_id,
    acl.consent_id,
    acl.tenant_id,
    acl.project_id,
    acl.link_source,
    acl.match_confidence,
    acl.matched_at,
    acl.reviewed_at,
    acl.reviewed_by,
    acl.matcher_version,
    acl.created_at,
    cpm.materialization_id,
    cpm.face_count,
    sf.asset_face_id
  from public.asset_consent_links acl
  inner join public.assets a
    on a.id = acl.asset_id
    and a.tenant_id = acl.tenant_id
    and a.project_id = acl.project_id
    and a.asset_type = 'photo'
  left join current_photo_materializations cpm
    on cpm.tenant_id = acl.tenant_id
    and cpm.project_id = acl.project_id
    and cpm.asset_id = acl.asset_id
  left join single_faces sf
    on sf.tenant_id = acl.tenant_id
    and sf.project_id = acl.project_id
    and sf.asset_id = acl.asset_id
    and sf.materialization_id = cpm.materialization_id
),
photo_suppressions as (
  select
    acl.asset_id,
    acl.consent_id,
    acl.tenant_id,
    acl.project_id,
    acl.reason,
    acl.created_at,
    acl.created_by,
    cpm.materialization_id,
    cpm.face_count,
    sf.asset_face_id
  from public.asset_consent_link_suppressions acl
  inner join public.assets a
    on a.id = acl.asset_id
    and a.tenant_id = acl.tenant_id
    and a.project_id = acl.project_id
    and a.asset_type = 'photo'
  left join current_photo_materializations cpm
    on cpm.tenant_id = acl.tenant_id
    and cpm.project_id = acl.project_id
    and cpm.asset_id = acl.asset_id
  left join single_faces sf
    on sf.tenant_id = acl.tenant_id
    and sf.project_id = acl.project_id
    and sf.asset_id = acl.asset_id
    and sf.materialization_id = cpm.materialization_id
)
insert into public.asset_consent_legacy_photo_links (
  asset_id,
  consent_id,
  tenant_id,
  project_id,
  link_source,
  match_confidence,
  matched_at,
  reviewed_at,
  reviewed_by,
  matcher_version,
  original_created_at,
  migration_status,
  current_materialization_id,
  current_face_count,
  migrated_asset_face_id
)
select
  pl.asset_id,
  pl.consent_id,
  pl.tenant_id,
  pl.project_id,
  pl.link_source,
  pl.match_confidence,
  pl.matched_at,
  pl.reviewed_at,
  pl.reviewed_by,
  pl.matcher_version,
  pl.created_at,
  case
    when pl.face_count = 1 then 'migrated_face_link'
    when pl.face_count = 0 and pl.link_source = 'manual' then 'migrated_zero_face_fallback'
    else 'requires_manual_resolution'
  end,
  pl.materialization_id,
  pl.face_count,
  pl.asset_face_id
from photo_links pl
on conflict (asset_id, consent_id) do nothing;

with current_photo_materializations as (
  select distinct on (m.tenant_id, m.project_id, m.asset_id)
    m.tenant_id,
    m.project_id,
    m.asset_id,
    m.id as materialization_id,
    m.face_count
  from public.asset_face_materializations m
  where m.asset_type = 'photo'
  order by m.tenant_id, m.project_id, m.asset_id, m.materialized_at desc, m.created_at desc, m.id desc
),
single_faces as (
  select
    f.tenant_id,
    f.project_id,
    f.asset_id,
    f.materialization_id,
    f.id as asset_face_id
  from public.asset_face_materialization_faces f
  inner join current_photo_materializations cpm
    on cpm.materialization_id = f.materialization_id
  where cpm.face_count = 1
),
photo_suppressions as (
  select
    acl.asset_id,
    acl.consent_id,
    acl.tenant_id,
    acl.project_id,
    acl.reason,
    acl.created_at,
    acl.created_by,
    cpm.materialization_id,
    cpm.face_count,
    sf.asset_face_id
  from public.asset_consent_link_suppressions acl
  inner join public.assets a
    on a.id = acl.asset_id
    and a.tenant_id = acl.tenant_id
    and a.project_id = acl.project_id
    and a.asset_type = 'photo'
  left join current_photo_materializations cpm
    on cpm.tenant_id = acl.tenant_id
    and cpm.project_id = acl.project_id
    and cpm.asset_id = acl.asset_id
  left join single_faces sf
    on sf.tenant_id = acl.tenant_id
    and sf.project_id = acl.project_id
    and sf.asset_id = acl.asset_id
    and sf.materialization_id = cpm.materialization_id
)
insert into public.asset_consent_legacy_photo_link_suppressions (
  asset_id,
  consent_id,
  tenant_id,
  project_id,
  reason,
  original_created_at,
  created_by,
  migration_status,
  current_materialization_id,
  current_face_count,
  migrated_asset_face_id
)
select
  ps.asset_id,
  ps.consent_id,
  ps.tenant_id,
  ps.project_id,
  ps.reason,
  ps.created_at,
  ps.created_by,
  case
    when ps.face_count = 1 then 'migrated_face_suppression'
    when ps.face_count = 0 then 'migrated_zero_face_fallback_suppression'
    else 'requires_manual_resolution'
  end,
  ps.materialization_id,
  ps.face_count,
  ps.asset_face_id
from photo_suppressions ps
on conflict (asset_id, consent_id) do nothing;

with current_photo_materializations as (
  select distinct on (m.tenant_id, m.project_id, m.asset_id)
    m.tenant_id,
    m.project_id,
    m.asset_id,
    m.id as materialization_id,
    m.face_count
  from public.asset_face_materializations m
  where m.asset_type = 'photo'
  order by m.tenant_id, m.project_id, m.asset_id, m.materialized_at desc, m.created_at desc, m.id desc
),
single_faces as (
  select
    f.tenant_id,
    f.project_id,
    f.asset_id,
    f.materialization_id,
    f.id as asset_face_id
  from public.asset_face_materialization_faces f
  inner join current_photo_materializations cpm
    on cpm.materialization_id = f.materialization_id
  where cpm.face_count = 1
),
photo_links as (
  select
    acl.asset_id,
    acl.consent_id,
    acl.tenant_id,
    acl.project_id,
    acl.link_source,
    acl.match_confidence,
    acl.matched_at,
    acl.reviewed_at,
    acl.reviewed_by,
    acl.matcher_version,
    acl.created_at,
    cpm.materialization_id,
    cpm.face_count,
    sf.asset_face_id
  from public.asset_consent_links acl
  inner join public.assets a
    on a.id = acl.asset_id
    and a.tenant_id = acl.tenant_id
    and a.project_id = acl.project_id
    and a.asset_type = 'photo'
  left join current_photo_materializations cpm
    on cpm.tenant_id = acl.tenant_id
    and cpm.project_id = acl.project_id
    and cpm.asset_id = acl.asset_id
  left join single_faces sf
    on sf.tenant_id = acl.tenant_id
    and sf.project_id = acl.project_id
    and sf.asset_id = acl.asset_id
    and sf.materialization_id = cpm.materialization_id
)
insert into public.asset_face_consent_links (
  asset_face_id,
  asset_materialization_id,
  asset_id,
  consent_id,
  tenant_id,
  project_id,
  link_source,
  match_confidence,
  matched_at,
  reviewed_at,
  reviewed_by,
  matcher_version,
  created_at,
  updated_at
)
select
  pl.asset_face_id,
  pl.materialization_id,
  pl.asset_id,
  pl.consent_id,
  pl.tenant_id,
  pl.project_id,
  pl.link_source,
  pl.match_confidence,
  pl.matched_at,
  pl.reviewed_at,
  pl.reviewed_by,
  pl.matcher_version,
  pl.created_at,
  now()
from photo_links pl
where pl.face_count = 1
  and pl.asset_face_id is not null
on conflict (asset_face_id) do nothing;

with current_photo_materializations as (
  select distinct on (m.tenant_id, m.project_id, m.asset_id)
    m.tenant_id,
    m.project_id,
    m.asset_id,
    m.id as materialization_id,
    m.face_count
  from public.asset_face_materializations m
  where m.asset_type = 'photo'
  order by m.tenant_id, m.project_id, m.asset_id, m.materialized_at desc, m.created_at desc, m.id desc
),
single_faces as (
  select
    f.tenant_id,
    f.project_id,
    f.asset_id,
    f.materialization_id,
    f.id as asset_face_id
  from public.asset_face_materialization_faces f
  inner join current_photo_materializations cpm
    on cpm.materialization_id = f.materialization_id
  where cpm.face_count = 1
),
photo_links as (
  select
    acl.asset_id,
    acl.consent_id,
    acl.tenant_id,
    acl.project_id,
    acl.link_source,
    acl.match_confidence,
    acl.matched_at,
    acl.reviewed_at,
    acl.reviewed_by,
    acl.matcher_version,
    acl.created_at,
    cpm.materialization_id,
    cpm.face_count,
    sf.asset_face_id
  from public.asset_consent_links acl
  inner join public.assets a
    on a.id = acl.asset_id
    and a.tenant_id = acl.tenant_id
    and a.project_id = acl.project_id
    and a.asset_type = 'photo'
  left join current_photo_materializations cpm
    on cpm.tenant_id = acl.tenant_id
    and cpm.project_id = acl.project_id
    and cpm.asset_id = acl.asset_id
  left join single_faces sf
    on sf.tenant_id = acl.tenant_id
    and sf.project_id = acl.project_id
    and sf.asset_id = acl.asset_id
    and sf.materialization_id = cpm.materialization_id
)
insert into public.asset_consent_manual_photo_fallbacks (
  asset_id,
  consent_id,
  tenant_id,
  project_id,
  created_by,
  created_at,
  updated_at
)
select
  pl.asset_id,
  pl.consent_id,
  pl.tenant_id,
  pl.project_id,
  pl.reviewed_by,
  pl.created_at,
  now()
from photo_links pl
where pl.face_count = 0
  and pl.link_source = 'manual'
on conflict (asset_id, consent_id) do nothing;

with current_photo_materializations as (
  select distinct on (m.tenant_id, m.project_id, m.asset_id)
    m.tenant_id,
    m.project_id,
    m.asset_id,
    m.id as materialization_id,
    m.face_count
  from public.asset_face_materializations m
  where m.asset_type = 'photo'
  order by m.tenant_id, m.project_id, m.asset_id, m.materialized_at desc, m.created_at desc, m.id desc
),
single_faces as (
  select
    f.tenant_id,
    f.project_id,
    f.asset_id,
    f.materialization_id,
    f.id as asset_face_id
  from public.asset_face_materialization_faces f
  inner join current_photo_materializations cpm
    on cpm.materialization_id = f.materialization_id
  where cpm.face_count = 1
),
photo_suppressions as (
  select
    acl.asset_id,
    acl.consent_id,
    acl.tenant_id,
    acl.project_id,
    acl.reason,
    acl.created_at,
    acl.created_by,
    cpm.materialization_id,
    cpm.face_count,
    sf.asset_face_id
  from public.asset_consent_link_suppressions acl
  inner join public.assets a
    on a.id = acl.asset_id
    and a.tenant_id = acl.tenant_id
    and a.project_id = acl.project_id
    and a.asset_type = 'photo'
  left join current_photo_materializations cpm
    on cpm.tenant_id = acl.tenant_id
    and cpm.project_id = acl.project_id
    and cpm.asset_id = acl.asset_id
  left join single_faces sf
    on sf.tenant_id = acl.tenant_id
    and sf.project_id = acl.project_id
    and sf.asset_id = acl.asset_id
    and sf.materialization_id = cpm.materialization_id
)
insert into public.asset_face_consent_link_suppressions (
  asset_face_id,
  asset_materialization_id,
  asset_id,
  consent_id,
  tenant_id,
  project_id,
  reason,
  created_at,
  created_by
)
select
  ps.asset_face_id,
  ps.materialization_id,
  ps.asset_id,
  ps.consent_id,
  ps.tenant_id,
  ps.project_id,
  case
    when ps.reason = 'manual_unlink' then 'manual_unlink'
    else 'manual_replace'
  end,
  ps.created_at,
  ps.created_by
from photo_suppressions ps
where ps.face_count = 1
  and ps.asset_face_id is not null
on conflict (asset_face_id, consent_id) do nothing;

with current_photo_materializations as (
  select distinct on (m.tenant_id, m.project_id, m.asset_id)
    m.tenant_id,
    m.project_id,
    m.asset_id,
    m.id as materialization_id,
    m.face_count
  from public.asset_face_materializations m
  where m.asset_type = 'photo'
  order by m.tenant_id, m.project_id, m.asset_id, m.materialized_at desc, m.created_at desc, m.id desc
),
single_faces as (
  select
    f.tenant_id,
    f.project_id,
    f.asset_id,
    f.materialization_id,
    f.id as asset_face_id
  from public.asset_face_materialization_faces f
  inner join current_photo_materializations cpm
    on cpm.materialization_id = f.materialization_id
  where cpm.face_count = 1
),
photo_suppressions as (
  select
    acl.asset_id,
    acl.consent_id,
    acl.tenant_id,
    acl.project_id,
    acl.reason,
    acl.created_at,
    acl.created_by,
    cpm.materialization_id,
    cpm.face_count,
    sf.asset_face_id
  from public.asset_consent_link_suppressions acl
  inner join public.assets a
    on a.id = acl.asset_id
    and a.tenant_id = acl.tenant_id
    and a.project_id = acl.project_id
    and a.asset_type = 'photo'
  left join current_photo_materializations cpm
    on cpm.tenant_id = acl.tenant_id
    and cpm.project_id = acl.project_id
    and cpm.asset_id = acl.asset_id
  left join single_faces sf
    on sf.tenant_id = acl.tenant_id
    and sf.project_id = acl.project_id
    and sf.asset_id = acl.asset_id
    and sf.materialization_id = cpm.materialization_id
)
insert into public.asset_consent_manual_photo_fallback_suppressions (
  asset_id,
  consent_id,
  tenant_id,
  project_id,
  reason,
  created_at,
  created_by
)
select
  ps.asset_id,
  ps.consent_id,
  ps.tenant_id,
  ps.project_id,
  'manual_unlink',
  ps.created_at,
  ps.created_by
from photo_suppressions ps
where ps.face_count = 0
on conflict (asset_id, consent_id) do nothing;

delete from public.asset_consent_link_suppressions acl
using public.assets a
where a.id = acl.asset_id
  and a.tenant_id = acl.tenant_id
  and a.project_id = acl.project_id
  and a.asset_type = 'photo';

delete from public.asset_consent_links acl
using public.assets a
where a.id = acl.asset_id
  and a.tenant_id = acl.tenant_id
  and a.project_id = acl.project_id
  and a.asset_type = 'photo';
