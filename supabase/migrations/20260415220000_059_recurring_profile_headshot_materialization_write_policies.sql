drop policy if exists "recurring_profile_headshot_materializations_insert_manage_rows"
  on public.recurring_profile_headshot_materializations;
create policy "recurring_profile_headshot_materializations_insert_manage_rows"
on public.recurring_profile_headshot_materializations
for insert
to authenticated
with check (
  app.current_user_can_manage_recurring_profiles(tenant_id)
);

drop policy if exists "recurring_profile_headshot_materializations_update_manage_rows"
  on public.recurring_profile_headshot_materializations;
create policy "recurring_profile_headshot_materializations_update_manage_rows"
on public.recurring_profile_headshot_materializations
for update
to authenticated
using (
  app.current_user_can_manage_recurring_profiles(tenant_id)
)
with check (
  app.current_user_can_manage_recurring_profiles(tenant_id)
);

drop policy if exists "recurring_profile_headshot_materialization_faces_insert_manage_rows"
  on public.recurring_profile_headshot_materialization_faces;
create policy "recurring_profile_headshot_materialization_faces_insert_manage_rows"
on public.recurring_profile_headshot_materialization_faces
for insert
to authenticated
with check (
  app.current_user_can_manage_recurring_profiles(tenant_id)
);

drop policy if exists "recurring_profile_headshot_materialization_faces_delete_manage_rows"
  on public.recurring_profile_headshot_materialization_faces;
create policy "recurring_profile_headshot_materialization_faces_delete_manage_rows"
on public.recurring_profile_headshot_materialization_faces
for delete
to authenticated
using (
  app.current_user_can_manage_recurring_profiles(tenant_id)
);

drop policy if exists "recurring_profile_headshot_repair_jobs_insert_manage_rows"
  on public.recurring_profile_headshot_repair_jobs;
create policy "recurring_profile_headshot_repair_jobs_insert_manage_rows"
on public.recurring_profile_headshot_repair_jobs
for insert
to authenticated
with check (
  app.current_user_can_manage_recurring_profiles(tenant_id)
);
