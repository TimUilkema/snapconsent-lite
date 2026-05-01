alter table public.subject_invites
  add column if not exists request_source text not null default 'normal',
  add column if not exists correction_opened_at_snapshot timestamptz null,
  add column if not exists correction_source_release_id_snapshot uuid null references public.project_releases(id) on delete restrict;

alter table public.subject_invites
  drop constraint if exists subject_invites_request_source_check;

alter table public.subject_invites
  add constraint subject_invites_request_source_check
    check (request_source in ('normal', 'correction'));

alter table public.subject_invites
  drop constraint if exists subject_invites_correction_provenance_shape_check;

alter table public.subject_invites
  add constraint subject_invites_correction_provenance_shape_check
    check (
      (request_source = 'normal'
        and correction_opened_at_snapshot is null
        and correction_source_release_id_snapshot is null)
      or (request_source = 'correction'
        and correction_opened_at_snapshot is not null
        and correction_source_release_id_snapshot is not null)
    );

alter table public.subject_invites
  drop constraint if exists subject_invites_correction_workspace_check;

alter table public.subject_invites
  add constraint subject_invites_correction_workspace_check
    check (
      request_source <> 'correction'
      or workspace_id is not null
    );

alter table public.recurring_profile_consent_requests
  add column if not exists request_source text not null default 'normal',
  add column if not exists correction_opened_at_snapshot timestamptz null,
  add column if not exists correction_source_release_id_snapshot uuid null references public.project_releases(id) on delete restrict;

alter table public.recurring_profile_consent_requests
  drop constraint if exists recurring_profile_consent_requests_request_source_check;

alter table public.recurring_profile_consent_requests
  add constraint recurring_profile_consent_requests_request_source_check
    check (request_source in ('normal', 'correction'));

alter table public.recurring_profile_consent_requests
  drop constraint if exists recurring_profile_consent_requests_correction_provenance_shape_check;

alter table public.recurring_profile_consent_requests
  drop constraint if exists recurring_profile_consent_requests_correction_shape_check;

alter table public.recurring_profile_consent_requests
  add constraint recurring_profile_consent_requests_correction_shape_check
    check (
      (request_source = 'normal'
        and correction_opened_at_snapshot is null
        and correction_source_release_id_snapshot is null)
      or (request_source = 'correction'
        and correction_opened_at_snapshot is not null
        and correction_source_release_id_snapshot is not null)
    );

alter table public.recurring_profile_consent_requests
  drop constraint if exists recurring_profile_consent_requests_correction_kind_check;

alter table public.recurring_profile_consent_requests
  add constraint recurring_profile_consent_requests_correction_kind_check
    check (
      request_source <> 'correction'
      or (
        consent_kind = 'project'
        and project_id is not null
        and workspace_id is not null
      )
    );
