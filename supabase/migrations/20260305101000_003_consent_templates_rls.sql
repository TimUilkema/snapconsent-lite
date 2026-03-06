alter table public.consent_templates enable row level security;

create policy "consent_templates_select_authenticated"
on public.consent_templates
for select
to authenticated
using (true);
