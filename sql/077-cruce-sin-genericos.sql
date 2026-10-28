-- 077 · "Con stock distinto" no cuenta genéricos (BOMBIS VARIAS) ni kits: su stock en la web lo maneja la web (312 → las reales)
create or replace view v_cruce_canal with (security_invoker = true) as
 SELECT ci.id, ci.empresa_id, ci.conexion_id, ci.producto_ext, ci.variante_ext, ci.nombre, ci.valores, ci.sku, ci.barcode, ci.mpn, ci.precio, ci.precio_promo,
    ci.stock, ci.publicado, ci.url, ci.imagen, ci.variante_id, ci.cruce, ci.actualizado, ci.talle_canal, ci.color_canal,
    cx.canal, cx.nombre AS conexion_nombre,
    v.sku AS sku_percha, v.ean AS ean_percha, v.producto_nombre AS producto_percha, v.producto_tipo, v.talle_nombre, v.color_nombre,
    v.precio AS precio_percha, v.stock AS stock_percha,
    g.n_canal AS variantes_canal_mismo_item, g.stock_canal_grupo,
    CASE WHEN ci.variante_id IS NULL THEN 'sin_cruzar'::text WHEN ci.stock IS NULL OR v.producto_tipo = 'kit' OR coalesce(pg.es_generico, false) THEN 'sin_control'::text
         WHEN g.stock_canal_grupo = v.stock_web THEN 'igual'::text ELSE 'distinto'::text END AS estado_stock,
    v.fallas AS fallas_percha, v.stock_web AS stock_web_percha
   FROM canal_items ci
     JOIN conexiones cx ON cx.id = ci.conexion_id
     LEFT JOIN v_variantes v ON v.id = ci.variante_id
     LEFT JOIN productos pg ON pg.id = v.producto_id
     LEFT JOIN ( SELECT i.conexion_id, i.variante_id, count(*) AS n_canal, sum(i.stock) AS stock_canal_grupo
           FROM canal_items i JOIN conexiones c2 ON c2.id = i.conexion_id
          WHERE i.variante_id IS NOT NULL AND (i.publicado IS NOT FALSE OR c2.incluir_ocultos)
          GROUP BY i.conexion_id, i.variante_id) g ON g.conexion_id = ci.conexion_id AND g.variante_id = ci.variante_id
  WHERE ci.publicado IS NOT FALSE OR cx.incluir_ocultos;

