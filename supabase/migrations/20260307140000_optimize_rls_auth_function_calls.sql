do $$
declare
  r record;
  new_qual text;
  new_with_check text;
begin
  for r in
    select
      p.schemaname,
      p.tablename,
      p.policyname,
      p.qual,
      p.with_check
    from pg_policies p
    where p.schemaname in ('public', 'storage')
      and (
        (p.qual is not null and p.qual ~ 'auth\.[a-zA-Z_]+\(\)')
        or (p.with_check is not null and p.with_check ~ 'auth\.[a-zA-Z_]+\(\)')
      )
  loop
    new_qual := case
      when r.qual is null then null
      else regexp_replace(r.qual, 'auth\.([a-zA-Z_]+)\(\)', '(select auth.\1())', 'g')
    end;

    new_with_check := case
      when r.with_check is null then null
      else regexp_replace(r.with_check, 'auth\.([a-zA-Z_]+)\(\)', '(select auth.\1())', 'g')
    end;

    if new_qual is not distinct from r.qual
      and new_with_check is not distinct from r.with_check then
      continue;
    end if;

    if new_qual is not null and new_with_check is not null then
      execute format(
        'alter policy %I on %I.%I using (%s) with check (%s)',
        r.policyname,
        r.schemaname,
        r.tablename,
        new_qual,
        new_with_check
      );
    elsif new_qual is not null then
      execute format(
        'alter policy %I on %I.%I using (%s)',
        r.policyname,
        r.schemaname,
        r.tablename,
        new_qual
      );
    elsif new_with_check is not null then
      execute format(
        'alter policy %I on %I.%I with check (%s)',
        r.policyname,
        r.schemaname,
        r.tablename,
        new_with_check
      );
    end if;
  end loop;
end
$$;
