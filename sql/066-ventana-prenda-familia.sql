-- 066 · la ventana de la prenda trae familia y tipo (para las excepciones de las listas)
CREATE OR REPLACE FUNCTION public.ventana_prenda(p_variante uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when not es_miembro(v.empresa_id) then null else jsonb_build_object(
    'variante', to_jsonb(vv) - 'costo',
    'costo', case when es_admin(v.empresa_id) then vv.costo end,
    'producto', jsonb_build_object('id', p.id, 'nombre', p.nombre, 'codigo', p.codigo, 'precio', p.precio, 'imagen_url', p.imagen_url, 'tiene_variantes', p.tiene_variantes, 'categoria_id', p.categoria_id, 'tipo', p.tipo),
    'por_deposito', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'nombre', d.nombre, 'principal', d.principal, 'cantidad', coalesce((select sum(s.cantidad) from stock s where s.variante_id = v.id and s.deposito_id = d.id), 0)) order by d.principal desc, d.nombre), '[]'::jsonb)
                     from depositos d where d.empresa_id = v.empresa_id and d.activo),
    'fallas', (select coalesce(jsonb_agg(to_jsonb(f) order by f.creado), '[]'::jsonb) from variante_fallas f where f.variante_id = v.id and f.estado = 'disponible'),
    'revisar', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'motivo', r.motivo, 'detalle', r.detalle, 'creado', r.creado) order by r.creado), '[]'::jsonb) from stock_revisar r where r.variante_id = v.id and r.resuelto is null),
    'movimientos', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select m.fecha, m.tipo, m.motivo, m.cantidad, m.nota, m.usuario, m.venta_numero, m.recuento_nombre from v_movimientos m where m.variante_id = v.id order by m.fecha desc limit 6) x)
  ) end
  from variantes v join productos p on p.id = v.producto_id join v_variantes vv on vv.id = v.id where v.id = p_variante;
$function$
;
