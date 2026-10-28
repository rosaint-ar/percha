-- 090 · Buscador de cambios: si se escribe un número, primero las ventas cuyo número de ticket lo contiene (después las demás coincidencias).
create or replace function ventas_buscar_cambio(e uuid, q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare palabras text[]; nums text[]; r jsonb;
  sin_acento constant text := 'áéíóúüñ'; con constant text := 'aeiouun';
begin
  if not es_miembro(e) or not puede(e, 'vender') then raise exception 'Sin permiso'; end if;
  palabras := array(select translate(replace(w, '#', ''), sin_acento, con) from regexp_split_to_table(lower(trim(coalesce(q, ''))), '\s+') w where replace(w, '#', '') <> '');
  nums := array(select w from unnest(palabras) w where w ~ '^\d+$');
  select coalesce(jsonb_agg(to_jsonb(x) - 'orden' order by x.orden, x.fecha desc), '[]'::jsonb) into r from (
    select v.id, v.numero, '#' || lpad(v.numero::text, 6, '0') mostrar, v.fecha, v.total, v.tipo, v.estado, c.nombre cliente,
      (select string_agg(l.cantidad::int || '× ' || l.descripcion || coalesce(' ' || nullif(concat_ws(' · ', l.talle, l.color), ''), ''), ' | ' order by l.id)
         from venta_lineas l where l.venta_id = v.id and l.cantidad > 0) resumen,
      case when exists (select 1 from unnest(nums) w where v.numero::text like '%' || w || '%') then 0 else 1 end orden
    from ventas v left join clientes c on c.id = v.cliente_id
    where v.empresa_id = e and not v.reservada and v.estado <> 'anulada'
      and (cardinality(palabras) = 0 or (
        select bool_and(t.txt like '%' || w || '%') from unnest(palabras) w,
          (select translate(lower(concat_ws(' ', v.numero::text, lpad(v.numero::text, 6, '0'), c.nombre, c.telefono,
             to_char(v.fecha at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY DD/MM/YY DD/MM DD-MM'),
             (array['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'])[extract(month from v.fecha at time zone 'America/Argentina/Buenos_Aires')::int],
             round(v.total)::bigint::text, v.nota, v.referencia,
             (select string_agg(concat_ws(' ', l.descripcion, l.talle, l.color), ' ') from venta_lineas l where l.venta_id = v.id))), sin_acento, con) txt) t))
    order by orden, v.fecha desc limit 30) x;
  return r;
end $$;
revoke all on function ventas_buscar_cambio(uuid, text) from anon;
grant execute on function ventas_buscar_cambio(uuid, text) to authenticated;
