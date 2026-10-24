-- 048 · Pendientes y promociones
--   · Prendas vendidas sin definir: cuando en la caja se vende un genérico (BOMBIS «VARIAS») o un kit sin elegir los modelos,
--     el stock sale de la "bolsa" o de "sin definir". Queda como tarea: decir qué modelo fue. Al definirlo, la bolsa recupera
--     la prenda y sale del modelo real (los dos movimientos quedan en la venta, y si se anula la venta se revierten).
--   · pendientes_resumen(e): lo que se muestra en la píldora "Pendientes" de arriba.
--   · Promociones con escalones (3 o más: 20% · 6 o más: 30%), dónde valen (local, tienda online o ambos) y en qué listas.

create or replace view v_pendientes_definir with (security_invoker = true) as
select m.empresa_id, m.linea_id, m.variante_id desde_variante_id, l.venta_id, ve.numero venta_numero, ve.creado fecha,
       vv.producto_id desde_producto_id, vv.producto_nombre desde_nombre, p.categoria_id, p.generico_filtro, p.es_generico,
       l.descripcion linea_descripcion, l.talle linea_talle, l.color linea_color, l.cantidad linea_cantidad,
       -sum(m.cantidad) pendiente, min(m.deposito_id::text)::uuid deposito_id
from stock_movimientos m
join venta_lineas l on l.id = m.linea_id
join ventas ve on ve.id = l.venta_id
join v_variantes vv on vv.id = m.variante_id
join productos p on p.id = vv.producto_id
where m.tipo = 'venta' and ve.estado <> 'anulada' and not coalesce(ve.reservada, false) and (p.es_generico or coalesce(vv.sku, '') like '%-SD')
group by m.empresa_id, m.linea_id, m.variante_id, l.venta_id, ve.numero, ve.creado, vv.producto_id, vv.producto_nombre, p.categoria_id, p.generico_filtro, p.es_generico, l.descripcion, l.talle, l.color, l.cantidad
having sum(m.cantidad) < 0;

-- definir: p = {linea_id, desde_variante_id, asignaciones:[{variante_id, cantidad}]}
create or replace function venta_definir(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l venta_lineas%rowtype; ve ventas%rowtype; desde uuid := (p->>'desde_variante_id')::uuid; pend numeric; a jsonb; v v_variantes%rowtype; tot numeric := 0; dep uuid; nom_desde text; st numeric;
begin
  select * into l from venta_lineas where id = (p->>'linea_id')::bigint;
  select * into ve from ventas where id = l.venta_id;
  if ve.id is null or not es_miembro(ve.empresa_id) or rol_en(ve.empresa_id) = 'visor' then raise exception 'Sin permiso'; end if;
  if ve.estado = 'anulada' then raise exception 'La venta está anulada'; end if;
  select -sum(cantidad), min(deposito_id::text)::uuid into pend, dep from stock_movimientos where linea_id = l.id and variante_id = desde and tipo = 'venta';
  if coalesce(pend, 0) <= 0 then raise exception 'No queda nada por definir en esta línea'; end if;
  select coalesce(sum((x->>'cantidad')::numeric), 0) into tot from jsonb_array_elements(coalesce(p->'asignaciones', '[]'::jsonb)) x;
  if tot <= 0 then raise exception 'Elegí al menos una prenda'; end if;
  if tot > pend then raise exception 'Son % por definir y elegiste %', pend::int, tot::int; end if;
  select producto_nombre into nom_desde from v_variantes where id = desde;
  for a in select * from jsonb_array_elements(p->'asignaciones') loop
    select * into v from v_variantes where id = (a->>'variante_id')::uuid and empresa_id = ve.empresa_id;
    if v.id is null then raise exception 'Prenda inexistente'; end if;
    -- la bolsa recupera la prenda y sale del modelo real
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, motivo, user_id, linea_id)
    values (ve.empresa_id, desde, dep, (a->>'cantidad')::numeric, 'venta', ve.id::text, 'Venta #' || ve.numero || ': era ' || concat_ws(' · ', v.producto_nombre, v.talle_nombre, v.color_nombre), 'Definido después', auth.uid(), l.id);
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, motivo, user_id, linea_id)
    values (ve.empresa_id, v.id, dep, -(a->>'cantidad')::numeric, 'venta', ve.id::text, 'Venta #' || ve.numero || ': vendida como ' || nom_desde, 'Definido después', auth.uid(), l.id);
    select coalesce(sum(cantidad), 0) into st from stock where variante_id = v.id;
    if st < 0 then
      insert into stock_revisar (empresa_id, variante_id, venta_id, linea_id, motivo, detalle)
      values (ve.empresa_id, v.id, ve.id, l.id, 'sin_stock', 'Venta #' || ve.numero || ': se definió como esta prenda pero el sistema no tenía stock');
    end if;
  end loop;
  return jsonb_build_object('definidas', tot, 'quedan', pend - tot);
end $$;

-- lo que va en la píldora "Pendientes"
create or replace function pendientes_resumen(e uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not es_miembro(e) or rol_en(e) = 'visor' then jsonb_build_object('total', 0) else (
    with d as (select coalesce(sum(pendiente), 0) u, count(*) n from v_pendientes_definir where empresa_id = e),
         r as (select count(distinct variante_id) n from stock_revisar where empresa_id = e and resuelto is null),
         c as (select count(*) n from recuentos where empresa_id = e and estado = 'abierto')
    select jsonb_build_object('definir', d.n, 'definir_unidades', d.u, 'revisar', r.n, 'recuentos', c.n, 'total', d.n + r.n + c.n) from d, r, c) end
$$;

-- ---------- promociones ----------
alter table promociones add column if not exists escalones jsonb;          -- [{n:3, valor:20}, {n:6, valor:30}] (tipo cantidad)
alter table promociones add column if not exists canal text not null default 'ambos';
alter table promociones add column if not exists listas uuid[];            -- null = todas las listas
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'promociones_canal_check') then
    alter table promociones add constraint promociones_canal_check check (canal in ('local', 'online', 'ambos'));
  end if;
end $$;
update promociones set escalones = jsonb_build_array(jsonb_build_object('n', n, 'valor', valor)) where tipo = 'cantidad' and escalones is null and n > 0;

select jsonb_build_object('resumen', pendientes_resumen((select id from empresas limit 1)),
  'pendientes', (select jsonb_agg(jsonb_build_object('venta', venta_numero, 'que', desde_nombre, 'pend', pendiente)) from v_pendientes_definir),
  'promos', (select jsonb_agg(jsonb_build_object('nombre', nombre, 'escalones', escalones, 'canal', canal)) from promociones)) r;
