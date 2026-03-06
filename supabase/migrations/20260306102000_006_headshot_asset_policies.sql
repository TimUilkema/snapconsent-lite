-- Existing RLS policies remain tenant-scoped and apply to new headshot columns.
-- No additional table/storage policy changes are required for this feature.

create or replace function app.revoke_public_consent(
  p_token text,
  p_reason text default null
)
returns table (
  consent_id uuid,
  revoked boolean,
  already_revoked boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_token record;
  v_updated_consent_id uuid;
begin
  v_hash := app.sha256_hex(p_token);

  select rt.*, c.revoked_at
  into v_token
  from public.revoke_tokens rt
  join public.consents c on c.id = rt.consent_id and c.tenant_id = rt.tenant_id
  where rt.token_hash = v_hash
  for update;

  if not found then
    raise exception 'invalid_revoke_token' using errcode = 'P0002';
  end if;

  if v_token.consumed_at is not null then
    return query select v_token.consent_id, true, true;
    return;
  end if;

  if v_token.expires_at <= now() then
    raise exception 'expired_revoke_token' using errcode = '22023';
  end if;

  update public.revoke_tokens
  set consumed_at = now()
  where id = v_token.id;

  update public.consents
  set
    revoked_at = now(),
    revoke_reason = coalesce(nullif(trim(p_reason), ''), revoke_reason)
  where id = v_token.consent_id
    and revoked_at is null
  returning id into v_updated_consent_id;

  if v_updated_consent_id is not null then
    insert into public.consent_events (tenant_id, consent_id, event_type, payload)
    values (
      v_token.tenant_id,
      v_token.consent_id,
      'revoked',
      jsonb_build_object('reason', nullif(trim(p_reason), ''))
    );

    update public.assets a
    set retention_expires_at = now()
    from public.asset_consent_links l
    where l.asset_id = a.id
      and l.consent_id = v_token.consent_id
      and l.tenant_id = v_token.tenant_id
      and a.tenant_id = v_token.tenant_id
      and a.project_id = l.project_id
      and a.asset_type = 'headshot'
      and a.status <> 'archived'
      and (a.retention_expires_at is null or a.retention_expires_at > now());

    return query select v_token.consent_id, true, false;
  else
    return query select v_token.consent_id, true, true;
  end if;
end;
$$;
