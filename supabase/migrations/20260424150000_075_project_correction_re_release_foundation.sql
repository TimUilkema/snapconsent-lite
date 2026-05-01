alter table public.projects
  add column if not exists correction_state text not null default 'none',
  add column if not exists correction_opened_at timestamptz null,
  add column if not exists correction_opened_by uuid null references auth.users(id) on delete restrict,
  add column if not exists correction_source_release_id uuid null references public.project_releases(id) on delete restrict,
  add column if not exists correction_reason text null;

alter table public.projects
  drop constraint if exists projects_correction_state_check;

alter table public.projects
  add constraint projects_correction_state_check
    check (correction_state in ('none', 'open'));

alter table public.projects
  drop constraint if exists projects_correction_shape_check;

alter table public.projects
  add constraint projects_correction_shape_check
    check (
      (
        correction_state = 'none'
        and correction_opened_at is null
        and correction_opened_by is null
        and correction_source_release_id is null
      )
      or (
        correction_state = 'open'
        and correction_opened_at is not null
        and correction_opened_by is not null
        and correction_source_release_id is not null
      )
    );
