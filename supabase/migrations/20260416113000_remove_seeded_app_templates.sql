delete from public.consent_templates
where tenant_id is null
  and template_key in ('gdpr-general', 'avg-nl');
