alter table public.asset_face_materializations
  add column if not exists source_image_width integer,
  add column if not exists source_image_height integer,
  add column if not exists source_coordinate_space text not null default 'oriented_original';

alter table public.asset_face_materializations
  drop constraint if exists asset_face_materializations_source_image_width_check,
  drop constraint if exists asset_face_materializations_source_image_height_check,
  drop constraint if exists asset_face_materializations_source_coordinate_space_check;

alter table public.asset_face_materializations
  add constraint asset_face_materializations_source_image_width_check
    check (source_image_width is null or source_image_width > 0),
  add constraint asset_face_materializations_source_image_height_check
    check (source_image_height is null or source_image_height > 0),
  add constraint asset_face_materializations_source_coordinate_space_check
    check (source_coordinate_space in ('oriented_original'));

alter table public.asset_face_materialization_faces
  add column if not exists face_box_normalized jsonb;

create table if not exists public.asset_face_image_derivatives (
  id uuid primary key default gen_random_uuid(),
  asset_face_id uuid not null
    references public.asset_face_materialization_faces(id) on delete cascade,
  materialization_id uuid not null
    references public.asset_face_materializations(id) on delete cascade,
  asset_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  derivative_kind text not null,
  storage_bucket text not null,
  storage_path text not null,
  width integer not null,
  height integer not null,
  created_at timestamptz not null default now(),
  constraint asset_face_image_derivatives_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint asset_face_image_derivatives_unique_kind
    unique (asset_face_id, derivative_kind),
  constraint asset_face_image_derivatives_derivative_kind_check
    check (derivative_kind in ('review_square_256')),
  constraint asset_face_image_derivatives_width_check
    check (width > 0),
  constraint asset_face_image_derivatives_height_check
    check (height > 0)
);

create index if not exists asset_face_image_derivatives_tenant_project_asset_idx
  on public.asset_face_image_derivatives (tenant_id, project_id, asset_id, created_at desc);

create index if not exists asset_face_image_derivatives_tenant_project_materialization_idx
  on public.asset_face_image_derivatives (tenant_id, project_id, materialization_id, created_at desc);

create index if not exists asset_face_image_derivatives_tenant_project_kind_idx
  on public.asset_face_image_derivatives (tenant_id, project_id, derivative_kind, created_at desc);

create table if not exists public.face_review_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  consent_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  selection_hash text not null,
  status text not null,
  selected_asset_count integer not null,
  expires_at timestamptz not null,
  last_accessed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint face_review_sessions_project_scope_fk
    foreign key (project_id, tenant_id)
    references public.projects(id, tenant_id)
    on delete cascade,
  constraint face_review_sessions_consent_scope_fk
    foreign key (consent_id, tenant_id, project_id)
    references public.consents(id, tenant_id, project_id)
    on delete cascade,
  constraint face_review_sessions_status_check
    check (status in ('open', 'completed', 'cancelled', 'expired')),
  constraint face_review_sessions_selected_asset_count_check
    check (selected_asset_count >= 0)
);

create unique index if not exists face_review_sessions_one_open_per_user_idx
  on public.face_review_sessions (tenant_id, project_id, consent_id, created_by)
  where status = 'open';

create index if not exists face_review_sessions_lookup_idx
  on public.face_review_sessions (tenant_id, project_id, consent_id, created_by, status, updated_at desc);

create index if not exists face_review_sessions_selection_hash_idx
  on public.face_review_sessions (tenant_id, project_id, consent_id, created_by, selection_hash, updated_at desc);

create table if not exists public.face_review_session_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.face_review_sessions(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  consent_id uuid not null,
  asset_id uuid not null,
  position integer not null,
  status text not null,
  completion_kind text,
  block_code text,
  prepared_materialization_id uuid
    references public.asset_face_materializations(id) on delete set null,
  selected_asset_face_id uuid
    references public.asset_face_materialization_faces(id) on delete set null,
  detected_face_count integer,
  last_reconciled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint face_review_session_items_session_asset_unique
    unique (session_id, asset_id),
  constraint face_review_session_items_asset_scope_fk
    foreign key (asset_id, tenant_id, project_id)
    references public.assets(id, tenant_id, project_id)
    on delete cascade,
  constraint face_review_session_items_consent_scope_fk
    foreign key (consent_id, tenant_id, project_id)
    references public.consents(id, tenant_id, project_id)
    on delete cascade,
  constraint face_review_session_items_status_check
    check (status in ('pending_materialization', 'ready_for_face_selection', 'completed', 'blocked')),
  constraint face_review_session_items_completion_kind_check
    check (completion_kind is null or completion_kind in ('linked_face', 'linked_fallback', 'suppressed_face')),
  constraint face_review_session_items_block_code_check
    check (block_code is null or block_code in ('consent_revoked', 'manual_conflict', 'asset_unavailable', 'materialization_failed')),
  constraint face_review_session_items_position_check
    check (position >= 0),
  constraint face_review_session_items_detected_face_count_check
    check (detected_face_count is null or detected_face_count >= 0)
);

create index if not exists face_review_session_items_queue_idx
  on public.face_review_session_items (session_id, position);

create index if not exists face_review_session_items_status_idx
  on public.face_review_session_items (tenant_id, project_id, consent_id, status, position);

create index if not exists face_review_session_items_asset_idx
  on public.face_review_session_items (tenant_id, project_id, asset_id, status, updated_at desc);

alter table public.asset_face_image_derivatives enable row level security;
alter table public.face_review_sessions enable row level security;
alter table public.face_review_session_items enable row level security;

revoke all on table public.asset_face_image_derivatives from public;
revoke all on table public.asset_face_image_derivatives from anon;
revoke all on table public.asset_face_image_derivatives from authenticated;
revoke all on table public.face_review_sessions from public;
revoke all on table public.face_review_sessions from anon;
revoke all on table public.face_review_sessions from authenticated;
revoke all on table public.face_review_session_items from public;
revoke all on table public.face_review_session_items from anon;
revoke all on table public.face_review_session_items from authenticated;

grant select, insert, update, delete on table public.asset_face_image_derivatives to service_role;
grant select, insert, update, delete on table public.face_review_sessions to service_role;
grant select, insert, update, delete on table public.face_review_session_items to service_role;

create policy "asset_face_image_derivatives_select_member"
on public.asset_face_image_derivatives
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_face_image_derivatives.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_face_image_derivatives_insert_member"
on public.asset_face_image_derivatives
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_face_image_derivatives.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_face_image_derivatives_update_member"
on public.asset_face_image_derivatives
for update
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_face_image_derivatives.tenant_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_face_image_derivatives.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "asset_face_image_derivatives_delete_member"
on public.asset_face_image_derivatives
for delete
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = asset_face_image_derivatives.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "face_review_sessions_select_member"
on public.face_review_sessions
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = face_review_sessions.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "face_review_sessions_insert_member"
on public.face_review_sessions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = face_review_sessions.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "face_review_sessions_update_member"
on public.face_review_sessions
for update
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = face_review_sessions.tenant_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = face_review_sessions.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "face_review_sessions_delete_member"
on public.face_review_sessions
for delete
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = face_review_sessions.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "face_review_session_items_select_member"
on public.face_review_session_items
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = face_review_session_items.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "face_review_session_items_insert_member"
on public.face_review_session_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = face_review_session_items.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "face_review_session_items_update_member"
on public.face_review_session_items
for update
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = face_review_session_items.tenant_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = face_review_session_items.tenant_id
      and m.user_id = auth.uid()
  )
);

create policy "face_review_session_items_delete_member"
on public.face_review_session_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.tenant_id = face_review_session_items.tenant_id
      and m.user_id = auth.uid()
  )
);
