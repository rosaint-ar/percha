-- 107 · Prenda con falla: además del % off, un PRECIO (31/10/2026, Diego: "cuando aplicamos un descuento, por ejemplo de una prenda
-- fallada, no me sale poner un precio en lugar de solo un descuento").
-- variante_fallas.precio = a cuánto se vende esa unidad a precio de LISTA (la predeterminada). En las otras listas baja en la misma
-- proporción (si en Contado la prenda sale 80% de Lista, la de la falla también). Con precio, descuento_pct queda vacío.
begin;
alter table variante_fallas add column if not exists precio numeric(14,2) check (precio is null or precio >= 0);

CREATE OR REPLACE FUNCTION public.fallas_guardar(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v variantes%rowtype; u jsonb; st numeric; n int; adm boolean;
begin
  select * into v from variantes where id = (p->>'variante_id')::uuid;
  if v.id is null or not es_miembro(v.empresa_id) or rol_en(v.empresa_id) = 'visor' then raise exception 'Sin permiso'; end if;
  adm := es_admin(v.empresa_id);
  for u in select * from jsonb_array_elements(coalesce(p->'cerrar', '[]'::jsonb)) loop
    update variante_fallas set estado = coalesce(u->>'estado', 'arreglada'), cerrada = now(), cerrada_nota = nullif(u->>'nota', '')
    where id = (u->>'id')::uuid and variante_id = v.id and estado = 'disponible';
  end loop;
  for u in select * from jsonb_array_elements(coalesce(p->'unidades', '[]'::jsonb)) loop
    if nullif(u->>'id', '') is null then
      insert into variante_fallas (empresa_id, variante_id, nota, descuento_pct, precio, listas)
      values (v.empresa_id, v.id, nullif(btrim(u->>'nota'), ''), case when adm and nullif(u->>'precio', '') is null then nullif(u->>'descuento_pct', '')::numeric end, case when adm then nullif(u->>'precio', '')::numeric end,
              case when adm and jsonb_typeof(u->'listas') = 'array' and jsonb_array_length(u->'listas') > 0 then array(select jsonb_array_elements_text(u->'listas')::uuid) end);
    else
      update variante_fallas set nota = nullif(btrim(u->>'nota'), ''),
        descuento_pct = case when adm then (case when nullif(u->>'precio', '') is null then nullif(u->>'descuento_pct', '')::numeric end) else descuento_pct end,
        precio = case when adm then nullif(u->>'precio', '')::numeric else precio end,
        listas = case when adm then (case when jsonb_typeof(u->'listas') = 'array' and jsonb_array_length(u->'listas') > 0 then array(select jsonb_array_elements_text(u->'listas')::uuid) end) else listas end
      where id = (u->>'id')::uuid and variante_id = v.id and estado = 'disponible';
    end if;
  end loop;
  select coalesce(sum(cantidad), 0) into st from stock where variante_id = v.id;
  select count(*) into n from variante_fallas where variante_id = v.id and estado = 'disponible';
  if n > greatest(st, 0) then raise exception 'Hay % con falla y el stock es %: no puede haber más con falla que stock', n, greatest(st, 0)::int; end if;
  return jsonb_build_object('fallas', n, 'stock', st);
end $function$;
commit;
