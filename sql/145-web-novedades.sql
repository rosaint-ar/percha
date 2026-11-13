-- 145 · 12/11 (Diego): «lo nuevo primero» en la web (categorías y armador de packs). Una publicación es NOVEDAD si:
--   · la creó Percha como prenda nueva (canal_items.de_percha con «Nuevos Ingresos» vigente) → desde que se publicó, o
--   · le entró stock por remito en los últimos 30 días → desde ese remito.
-- La web la lee con la función pública web-novedades (solo ids de publicación y fecha; nada interno).
create or replace function web_novedades(p_conexion uuid, p_dias int default 30)
returns table (publicacion text, desde timestamptz)
language sql stable security definer set search_path = public as $$
  select pe, max(f) from (
    select ci.producto_ext pe, max(sm.fecha) f
      from stock_movimientos sm join canal_items ci on ci.variante_id = sm.variante_id and ci.conexion_id = p_conexion
     where sm.tipo = 'compra' and sm.cantidad > 0 and sm.fecha > now() - make_interval(days => p_dias)
     group by 1
    union all
    select producto_ext, max(nuevo_hasta) - make_interval(days => 30)
      from canal_items where conexion_id = p_conexion and de_percha and nuevo_hasta > now()
     group by 1
  ) x group by pe order by 2 desc;
$$;
revoke execute on function web_novedades(uuid, int) from public, anon, authenticated;
grant execute on function web_novedades(uuid, int) to service_role;
