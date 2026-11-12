-- 135 · "Tomar todo" (Conexiones) ya no apaga talle·colores (12/11, Diego: "¿por qué quedaron apagados? nosotros no los apagamos").
-- En octubre esa conciliación apagó los que tenían stock 0 y estaban solo en publicaciones ocultas (MARTHA CLASSIC Beige/Habano,
-- PIJAMA HAPPY Rabbit…). Se volvieron a prender los 12 que siguen en la web con la prenda activa. Percha manda: nada se apaga solo.
begin;
CREATE OR REPLACE FUNCTION public.canal_tomar_todo(p_conexion uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e uuid; dep uuid; r record; n_stock int := 0; n_apagadas int := 0; marca text;
begin
  select empresa_id into e from conexiones where id = p_conexion;
  if e is null or not es_admin(e) then raise exception 'Sin permiso'; end if;
  dep := (select id from depositos where empresa_id = e and principal limit 1);
  marca := 'Tienda Nube manda · ' || to_char(now() at time zone 'America/Argentina/Cordoba', 'DD/MM HH24:MI');
  for r in
    select ci.variante_id, sum(ci.stock) + max(v.fallas) canal, coalesce((select sum(s.cantidad) from stock s where s.variante_id = ci.variante_id), 0) local
    from canal_items ci join variantes v on v.id = ci.variante_id join productos p on p.id = v.producto_id
    where ci.conexion_id = p_conexion and ci.stock is not null and p.tipo <> 'kit' and not p.es_generico and canal_item_cuenta(ci.publicado, p_conexion)
    group by ci.variante_id
  loop
    if r.canal <> r.local then
      insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (e, r.variante_id, dep, r.canal - r.local, 'ajuste', marca || ' (local ' || r.local || ' → canal ' || r.canal || ')');
      n_stock := n_stock + 1;
    end if;
  end loop;
  -- (12/11) YA NO apaga talle·colores: en octubre apagó los que estaban solo en publicaciones ocultas y no correspondía. Percha manda.
  n_apagadas := 0;
  return jsonb_build_object('stock_ajustados', n_stock, 'nombres_cambiados', 0, 'variantes_apagadas', n_apagadas);
end $function$;

-- los que se volvieron a prender (ya aplicado el 12/11):
-- update variantes … set activa = true where producto 200122/500106 and cruzada en la web
commit;
