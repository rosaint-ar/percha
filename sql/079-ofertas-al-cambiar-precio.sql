-- 079 · Al cambiar precios, decidir qué pasa con las ofertas: mantener el precio de oferta o mantener el % de descuento (pedido de Diego 28/10)
CREATE OR REPLACE FUNCTION public.precios_masivo(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e uuid := (p->>'empresa_id')::uuid; ids uuid[]; campo text := coalesce(p->>'campo', 'precio'); op text := coalesce(p->>'operacion', 'porcentaje'); n_of int := 0;
        val numeric := coalesce((p->>'valor')::numeric, 0); red text := coalesce(p->>'redondeo', 'no'); lote uuid; res jsonb; n_prod int; n_var int := 0; n_lis int := 0; fijos_sin_tocar int := 0;
begin
  if not es_admin(e) then raise exception 'Solo administración cambia precios'; end if;
  if campo not in ('precio', 'costo') then raise exception 'Campo inválido'; end if;
  if op = 'markup' and campo <> 'precio' then raise exception 'El multiplicador sobre el costo es para el precio de venta'; end if;
  ids := array(select jsonb_array_elements_text(coalesce(p->'productos', '[]'::jsonb))::uuid);
  -- cálculo (sirve para la vista previa y para grabar)
  create temp table if not exists _pm (producto_id uuid, nombre text, codigo text, antes numeric, despues numeric, stock numeric) on commit drop;
  truncate _pm;
  insert into _pm
  select x.id, x.nombre, x.codigo, x.actual, precio_redondear(case op when 'porcentaje' then x.actual * (1 + val / 100) when 'monto' then x.actual + val when 'fijar' then val
                                                                     when 'markup' then nullif(x.costo, 0) * val end, red), x.stock
  from (select pr.id, pr.nombre, pr.codigo, case when campo = 'precio' then pr.precio else pr.costo end actual, pr.costo,
               coalesce((select sum(s.cantidad) from stock s join variantes v on v.id = s.variante_id where v.producto_id = pr.id), 0) stock
        from productos pr where pr.empresa_id = e and pr.id = any(ids) and (pr.tipo <> 'kit' or campo = 'precio')) x;
  delete from _pm where despues is null;
  select count(*) filter (where despues is distinct from antes) into n_prod from _pm;
  if op in ('fijar', 'markup') then select count(*) into fijos_sin_tocar from precios where producto_id = any(ids); end if;

  -- productos con precio de oferta fijo (rebaja): al cambiar el precio hay que decidir si la oferta queda igual o sigue el mismo % de descuento
  select count(distinct m.producto_id) into n_of from _pm m where campo = 'precio' and m.despues is distinct from m.antes
    and exists (select 1 from rebaja_precios r join promociones pr on pr.id = r.promocion_id and pr.activa where r.producto_id = m.producto_id);
  if coalesce((p->>'simular')::boolean, true) then
    return jsonb_build_object('simulacion', true, 'productos', n_prod, 'sin_cambio', (select count(*) from _pm where despues = antes),
      'suba_promedio', (select round(avg(case when antes > 0 then 100 * (despues - antes) / antes end), 1) from _pm where despues is distinct from antes),
      'valor_stock_antes', (select sum(greatest(stock, 0) * coalesce(antes, 0)) from _pm), 'valor_stock_despues', (select sum(greatest(stock, 0) * despues) from _pm),
      'fijos_sin_tocar', fijos_sin_tocar, 'con_oferta', n_of,
      'filas', coalesce((select jsonb_agg(jsonb_build_object('id', producto_id, 'nombre', nombre, 'codigo', codigo, 'antes', antes, 'despues', despues) order by nombre) from (select * from _pm where despues is distinct from antes order by nombre limit 400) z), '[]'::jsonb));
  end if;

  if n_of > 0 and coalesce(p->>'ofertas', '') not in ('precio', 'porcentaje') then raise exception 'Hay % productos con precio de oferta: elegí si la oferta queda igual o mantiene el %% de descuento', n_of; end if;
  insert into precio_lotes (empresa_id, descripcion, productos) values (e, nullif(p->>'descripcion', ''), n_prod) returning id into lote;
  perform set_config('percha.lote', lote::text, true);
  if campo = 'precio' then
    update productos pr set precio = m.despues, modificado = now() from _pm m where m.producto_id = pr.id and m.despues is distinct from pr.precio;
    -- talles o colores con precio propio: mismo cambio (en el multiplicador, sobre su propio costo)
    update variantes v set precio = precio_redondear(case op when 'porcentaje' then v.precio * (1 + val / 100) when 'monto' then v.precio + val when 'fijar' then val
                                                              when 'markup' then coalesce(nullif(v.costo, 0), (select costo from productos where id = v.producto_id)) * val end, red)
    where v.producto_id = any(ids) and v.precio is not null;
    get diagnostics n_var = row_count;
    -- ofertas: mantienen el mismo % de descuento (si se eligió así); si no, el precio de oferta queda como estaba
    if n_of > 0 and p->>'ofertas' = 'porcentaje' then
      update rebaja_precios r set precio = precio_redondear(r.precio * m.despues / m.antes, '10') from _pm m
      where r.producto_id = m.producto_id and m.antes > 0 and m.despues is distinct from m.antes;
    end if;
    -- precios fijados a mano por lista: con porcentaje o monto se mueven igual; con "fijar" o multiplicador quedan como están
    if op in ('porcentaje', 'monto') then
      update precios set precio = precio_redondear(case op when 'porcentaje' then precio * (1 + val / 100) else precio + val end, red) where producto_id = any(ids);
      get diagnostics n_lis = row_count;
    end if;
  else
    update productos pr set costo = m.despues, modificado = now() from _pm m where m.producto_id = pr.id and m.despues is distinct from pr.costo;
    update variantes v set costo = precio_redondear(case op when 'porcentaje' then v.costo * (1 + val / 100) when 'monto' then v.costo + val else val end, red)
    where v.producto_id = any(ids) and v.costo is not null;
    get diagnostics n_var = row_count;
  end if;
  perform set_config('percha.lote', '', true);
  update precio_lotes set cambios = (select count(*) from precio_cambios where lote_id = lote) where id = lote;
  return jsonb_build_object('simulacion', false, 'lote', lote, 'productos', n_prod, 'variantes', n_var, 'listas', n_lis, 'fijos_sin_tocar', fijos_sin_tocar, 'con_oferta', n_of, 'ofertas', p->>'ofertas');
end $function$
;

-- un solo producto (la ficha): las ofertas mantienen el mismo % de descuento
create or replace function ofertas_seguir_precio(p_producto uuid, p_antes numeric, p_despues numeric) returns int
language plpgsql security definer set search_path = public as $$
declare e uuid := (select empresa_id from productos where id = p_producto); n int;
begin
  if e is null or not es_admin(e) then raise exception 'Sin permiso'; end if;
  if coalesce(p_antes, 0) <= 0 or coalesce(p_despues, 0) <= 0 then return 0; end if;
  update rebaja_precios set precio = precio_redondear(precio * p_despues / p_antes, '10') where producto_id = p_producto;
  get diagnostics n = row_count; return n;
end $$;
