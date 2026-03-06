insert into public.consent_templates (template_key, version, body, status)
select
  'gdpr-general',
  'v1',
  'Prototype consent template (GDPR general). This is placeholder language for testing only.\n\nI consent to photography and media capture for this project and related communications. I understand I can revoke consent later.',
  'active'
where not exists (
  select 1
  from public.consent_templates
  where template_key = 'gdpr-general'
    and version = 'v1'
);

insert into public.consent_templates (template_key, version, body, status)
select
  'avg-nl',
  'v1',
  'Prototype consent template (Dutch AVG). This is placeholder language for testing only.\n\nIk geef toestemming voor foto- en media-opnamen voor dit project en gerelateerde communicatie. Ik kan mijn toestemming later intrekken.',
  'active'
where not exists (
  select 1
  from public.consent_templates
  where template_key = 'avg-nl'
    and version = 'v1'
);
