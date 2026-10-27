-- 064 · Los productos OCULTOS de la tienda online no cuentan para nada (pedido de Diego 27/10/2026).
-- Interruptor por conexión: conexiones.incluir_ocultos (apagado). Apagado = cruce, nuevos, resumen, "tomar todo" y el empuje de stock
-- ignoran lo que en la tienda está oculto, como si no existiera.

alter table conexiones add column if not exists incluir_ocultos boolean not null default false;

-- el ítem del canal cuenta si está publicado, o si la conexión pide tener en cuenta los ocultos
create or replace function canal_item_cuenta(pub boolean, cx uuid) returns boolean
language sql stable set search_path = public as $$
  select pub is not false or coalesce((select incluir_ocultos from conexiones where id = cx), false)
$$;

create or replace view v_cruce_canal with (security_invoker = true) as
 SELECT ci.id, ci.empresa_id, ci.conexion_id, ci.producto_ext, ci.variante_ext, ci.nombre, ci.valores, ci.sku, ci.barcode, ci.mpn, ci.precio, ci.precio_promo,
    ci.stock, ci.publicado, ci.url, ci.imagen, ci.variante_id, ci.cruce, ci.actualizado, ci.talle_canal, ci.color_canal,
    cx.canal, cx.nombre AS conexion_nombre,
    v.sku AS sku_percha, v.ean AS ean_percha, v.producto_nombre AS producto_percha, v.producto_tipo, v.talle_nombre, v.color_nombre,
    v.precio AS precio_percha, v.stock AS stock_percha,
    g.n_canal AS variantes_canal_mismo_item, g.stock_canal_grupo,
    CASE WHEN ci.variante_id IS NULL THEN 'sin_cruzar'::text WHEN ci.stock IS NULL THEN 'sin_control'::text
         WHEN g.stock_canal_grupo = v.stock_web THEN 'igual'::text ELSE 'distinto'::text END AS estado_stock,
    v.fallas AS fallas_percha, v.stock_web AS stock_web_percha
   FROM canal_items ci
     JOIN conexiones cx ON cx.id = ci.conexion_id
     LEFT JOIN v_variantes v ON v.id = ci.variante_id
     LEFT JOIN ( SELECT i.conexion_id, i.variante_id, count(*) AS n_canal, sum(i.stock) AS stock_canal_grupo
           FROM canal_items i JOIN conexiones c2 ON c2.id = i.conexion_id
          WHERE i.variante_id IS NOT NULL AND (i.publicado IS NOT FALSE OR c2.incluir_ocultos)
          GROUP BY i.conexion_id, i.variante_id) g ON g.conexion_id = ci.conexion_id AND g.variante_id = ci.variante_id
  WHERE ci.publicado IS NOT FALSE OR cx.incluir_ocultos;

create or replace view v_canal_nuevos with (security_invoker = true) as
 WITH g AS (
         SELECT ci.conexion_id, ci.empresa_id, ci.producto_ext, min(ci.nombre) AS nombre, min(COALESCE(ci.sku, ci.mpn)) AS sku, min(ci.imagen) AS imagen, min(ci.url) AS url,
            count(*) AS variantes, sum(ci.stock) AS stock, min(ci.precio) AS precio, bool_or(COALESCE(ci.publicado, true)) AS publicado,
            count(ci.variante_id) AS cruzadas,
            (array_agg(v.producto_id) FILTER (WHERE v.id IS NOT NULL AND v.talle_id IS NULL AND v.color_id IS NULL AND v.estampa_id IS NULL))[1] AS bolsa_producto_id,
            bool_or(v.talle_id IS NOT NULL OR v.color_id IS NOT NULL OR v.estampa_id IS NOT NULL) AS a_variante_real,
            regexp_replace(min(ci.nombre), '»\s*.*$'::text, '»'::text) AS nombre_base
           FROM canal_items ci
             JOIN conexiones cx ON cx.id = ci.conexion_id
             LEFT JOIN variantes v ON v.id = ci.variante_id
          WHERE ci.publicado IS NOT FALSE OR cx.incluir_ocultos
          GROUP BY ci.conexion_id, ci.empresa_id, ci.producto_ext
        ), bolsas AS (
         SELECT g_1.conexion_id, g_1.bolsa_producto_id, count(DISTINCT g_1.nombre_base) AS modelos
           FROM g g_1 WHERE g_1.bolsa_producto_id IS NOT NULL GROUP BY g_1.conexion_id, g_1.bolsa_producto_id
        )
 SELECT g.conexion_id, g.empresa_id, g.producto_ext, g.nombre, g.sku, g.imagen, g.url, g.variantes, g.stock, g.precio, g.publicado,
    g.bolsa_producto_id, p.codigo AS bolsa_codigo, p.nombre AS bolsa_nombre, b.modelos AS bolsa_modelos,
    g.nombre ~* '\y(box|combo|pack|kit|set)\y'::text AS es_pack,
    CASE WHEN g.cruzadas = 0 THEN 'sin_cruzar'::text ELSE 'bolsa'::text END AS estado
   FROM g
     LEFT JOIN bolsas b ON b.conexion_id = g.conexion_id AND b.bolsa_producto_id = g.bolsa_producto_id
     LEFT JOIN productos p ON p.id = g.bolsa_producto_id
  WHERE g.cruzadas = 0 OR b.modelos >= 3 AND NOT g.a_variante_real;

-- una prenda cuyo único ítem en la tienda está oculto cuenta como "no publicada"
create or replace view v_variantes_sin_canal with (security_invoker = true) as
 SELECT v.id, v.empresa_id, v.producto_id, v.producto_codigo, v.producto_nombre, v.producto_tipo, v.sku, v.ean, v.activa,
    v.talle, v.talle_nombre, v.talle_orden, v.color, v.color_nombre, v.color_hex, v.estampa, v.estampa_nombre, v.costo, v.precio, v.stock,
    c.id AS conexion_id
   FROM v_variantes v CROSS JOIN conexiones c
  WHERE c.empresa_id = v.empresa_id AND c.estado = 'activa'::text AND v.activa
    AND NOT (EXISTS ( SELECT 1 FROM canal_items ci WHERE ci.conexion_id = c.id AND ci.variante_id = v.id AND (ci.publicado IS NOT FALSE OR c.incluir_ocultos)));

create or replace function resumen_conexion(c uuid) returns json
language sql stable set search_path = public as $$
  select json_build_object(
    'items', (select count(*) from canal_items where conexion_id = c and canal_item_cuenta(publicado, c)),
    'cruzados', (select count(*) from canal_items where conexion_id = c and variante_id is not null and canal_item_cuenta(publicado, c)),
    'sin_cruzar', (select count(*) from canal_items where conexion_id = c and variante_id is null and canal_item_cuenta(publicado, c)),
    'ocultos', (select count(*) from canal_items where conexion_id = c and publicado is false),
    'stock_distinto', (select count(*) from v_cruce_canal where conexion_id = c and estado_stock = 'distinto'),
    'percha_sin_publicar', (select count(*) from v_variantes_sin_canal where conexion_id = c),
    'nuevos', (select count(*) from v_canal_nuevos where conexion_id = c and not es_pack),
    'ultima_sync', (select ultima_sync from conexiones where id = c),
    'incluir_ocultos', (select incluir_ocultos from conexiones where id = c)
  );
$$;

-- "Tomar todo de la tienda": el stock de un oculto no se trae
create or replace function canal_tomar_todo(p_conexion uuid) returns jsonb
language plpgsql security definer set search_path = public as $function$
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
  update variantes v set activa = false
  from productos p
  where p.id = v.producto_id and v.empresa_id = e and v.activa and p.tipo <> 'kit'
    and exists (select 1 from canal_items ci join variantes v2 on v2.id = ci.variante_id where ci.conexion_id = p_conexion and v2.producto_id = p.id and canal_item_cuenta(ci.publicado, p_conexion))
    and not exists (select 1 from canal_items ci where ci.conexion_id = p_conexion and ci.variante_id = v.id and canal_item_cuenta(ci.publicado, p_conexion))
    and coalesce((select sum(s.cantidad) from stock s where s.variante_id = v.id), 0) = 0
    and (v.talle_id is not null or v.color_id is not null or v.estampa_id is not null);
  get diagnostics n_apagadas = row_count;
  return jsonb_build_object('stock_ajustados', n_stock, 'nombres_cambiados', 0, 'variantes_apagadas', n_apagadas);
end $function$;

-- solo administración cambia el interruptor (la tabla ya tiene su policy de update para admins)
