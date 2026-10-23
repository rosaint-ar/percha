-- 027 · FRU FRU es parte del nombre del modelo: siempre adentro de «», en el orden en que Emi lo escribió
--   LESS «ABSTRACT» FRU FRU MICROFIBRA → LESS «ABSTRACT FRU FRU» MICROFIBRA · LESS FRU FRU «COLORS» → LESS «FRU FRU COLORS» (ya estaba)
do $$
declare r record; nuevo text;
begin
  for r in select id, empresa_id, nombre from productos where nombre ~ '«[^»]*»' and nombre ~ '\mFRU FRU\M' and nombre !~ '«[^»]*FRU FRU[^»]*»' loop
    if r.nombre ~ 'FRU FRU\s*«' then nuevo := regexp_replace(r.nombre, '\s*FRU FRU\s*«', ' «FRU FRU ');
    else nuevo := regexp_replace(regexp_replace(r.nombre, '»\s*FRU FRU', ' FRU FRU»'), '\s+FRU FRU»', ' FRU FRU»'); end if;
    nuevo := btrim(regexp_replace(nuevo, '\s+', ' ', 'g'));
    if nuevo <> r.nombre and not exists (select 1 from productos q where q.empresa_id = r.empresa_id and q.id <> r.id and lower(q.nombre) = lower(nuevo)) then
      update productos set nombre = nuevo, descripcion = coalesce(descripcion || E'\n', '') || 'Nombre anterior: ' || r.nombre where id = r.id;
    end if;
  end loop;
end $$;
select codigo, nombre from productos where nombre ~ 'FRU FRU' order by nombre;
