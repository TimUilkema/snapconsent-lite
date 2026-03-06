create or replace function public.ensure_tenant_for_current_user()
returns uuid
language sql
volatile
security definer
set search_path = public, app, extensions
as $$
  select app.ensure_tenant_for_current_user();
$$;
