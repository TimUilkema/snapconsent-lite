alter table public.asset_face_materialization_faces
  add column if not exists face_source text not null default 'detector',
  add column if not exists created_by uuid references auth.users(id) on delete set null;

update public.asset_face_materialization_faces
set face_source = 'detector'
where face_source is null;

alter table public.asset_face_materialization_faces
  alter column embedding drop not null;

alter table public.asset_face_materialization_faces
  drop constraint if exists asset_face_materialization_faces_face_source_check,
  drop constraint if exists asset_face_materialization_faces_manual_normalized_box_check,
  drop constraint if exists asset_face_materialization_faces_embedding_source_check;

alter table public.asset_face_materialization_faces
  add constraint asset_face_materialization_faces_face_source_check
    check (face_source in ('detector', 'manual')),
  add constraint asset_face_materialization_faces_manual_normalized_box_check
    check (face_source <> 'manual' or face_box_normalized is not null),
  add constraint asset_face_materialization_faces_embedding_source_check
    check (
      (face_source = 'manual' and embedding is null)
      or (face_source = 'detector' and embedding is not null)
    );
