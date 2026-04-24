alter table public.project_workspaces
  add column if not exists workflow_state text not null default 'active',
  add column if not exists workflow_state_changed_at timestamptz not null default now(),
  add column if not exists workflow_state_changed_by uuid null references auth.users(id) on delete restrict,
  add column if not exists handed_off_at timestamptz null,
  add column if not exists handed_off_by uuid null references auth.users(id) on delete restrict,
  add column if not exists validated_at timestamptz null,
  add column if not exists validated_by uuid null references auth.users(id) on delete restrict,
  add column if not exists needs_changes_at timestamptz null,
  add column if not exists needs_changes_by uuid null references auth.users(id) on delete restrict,
  add column if not exists reopened_at timestamptz null,
  add column if not exists reopened_by uuid null references auth.users(id) on delete restrict;

alter table public.project_workspaces
  drop constraint if exists project_workspaces_workflow_state_check;

alter table public.project_workspaces
  add constraint project_workspaces_workflow_state_check
    check (workflow_state in ('active', 'handed_off', 'needs_changes', 'validated'));

alter table public.project_workspaces
  drop constraint if exists project_workspaces_handed_off_actor_check;

alter table public.project_workspaces
  add constraint project_workspaces_handed_off_actor_check
    check ((handed_off_at is null) = (handed_off_by is null));

alter table public.project_workspaces
  drop constraint if exists project_workspaces_validated_actor_check;

alter table public.project_workspaces
  add constraint project_workspaces_validated_actor_check
    check ((validated_at is null) = (validated_by is null));

alter table public.project_workspaces
  drop constraint if exists project_workspaces_needs_changes_actor_check;

alter table public.project_workspaces
  add constraint project_workspaces_needs_changes_actor_check
    check ((needs_changes_at is null) = (needs_changes_by is null));

alter table public.project_workspaces
  drop constraint if exists project_workspaces_reopened_actor_check;

alter table public.project_workspaces
  add constraint project_workspaces_reopened_actor_check
    check ((reopened_at is null) = (reopened_by is null));

alter table public.projects
  add column if not exists finalized_at timestamptz null,
  add column if not exists finalized_by uuid null references auth.users(id) on delete restrict;

alter table public.projects
  drop constraint if exists projects_finalized_actor_check;

alter table public.projects
  add constraint projects_finalized_actor_check
    check ((finalized_at is null) = (finalized_by is null));
