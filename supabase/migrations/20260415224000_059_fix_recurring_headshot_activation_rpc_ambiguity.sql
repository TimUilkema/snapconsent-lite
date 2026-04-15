create or replace function app.activate_recurring_profile_headshot_upload(
  p_headshot_id uuid
)
returns table (
  headshot_id uuid,
  tenant_id uuid,
  profile_id uuid,
  uploaded_at timestamptz,
  superseded_headshot_id uuid
)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_headshot public.recurring_profile_headshots;
  v_previous public.recurring_profile_headshots;
  v_now timestamptz := now();
begin
  select *
  into v_headshot
  from public.recurring_profile_headshots rph
  where rph.id = p_headshot_id
  for update;

  if not found then
    raise exception 'recurring_profile_headshot_not_found' using errcode = 'P0002';
  end if;

  if auth.uid() is not null and not app.current_user_can_manage_recurring_profiles(v_headshot.tenant_id) then
    raise exception 'recurring_profile_management_forbidden' using errcode = '42501';
  end if;

  select *
  into v_previous
  from public.recurring_profile_headshots rph
  where rph.tenant_id = v_headshot.tenant_id
    and rph.profile_id = v_headshot.profile_id
    and rph.id <> v_headshot.id
    and rph.superseded_at is null
    and rph.upload_status = 'uploaded'
  order by rph.created_at desc
  limit 1
  for update;

  if found then
    update public.recurring_profile_headshots previous_headshot
    set
      superseded_at = v_now,
      updated_at = v_now
    where previous_headshot.id = v_previous.id;
  end if;

  update public.recurring_profile_headshots current_headshot
  set
    upload_status = 'uploaded',
    uploaded_at = coalesce(current_headshot.uploaded_at, v_now),
    superseded_at = null,
    updated_at = v_now
  where current_headshot.id = v_headshot.id
  returning
    current_headshot.id,
    current_headshot.tenant_id,
    current_headshot.profile_id,
    current_headshot.uploaded_at,
    v_previous.id
  into headshot_id, tenant_id, profile_id, uploaded_at, superseded_headshot_id;

  return next;
end;
$$;

create or replace function public.activate_recurring_profile_headshot_upload(
  p_headshot_id uuid
)
returns table (
  headshot_id uuid,
  tenant_id uuid,
  profile_id uuid,
  uploaded_at timestamptz,
  superseded_headshot_id uuid
)
language sql
security definer
set search_path = public, app, extensions
as $$
  select *
  from app.activate_recurring_profile_headshot_upload(p_headshot_id);
$$;
