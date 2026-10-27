-- 051 · Ventas de octubre desde FactuSOL SIN mover stock (26/10/2026)
--   Diego: "el stock real es el que figura en Tienda Nube; no dupliques ventas". El stock de octubre ya está contado,
--   así que las ventas viejas se registran como historial (para métricas y caja) sin tocar el stock.
--   · venta_linea_mover_stock: con la marca percha.sin_stock = '1' no mueve stock (solo durante esta carga).
--   · No duplicar pedidos de Tienda Nube: una venta de la web por número de pedido; si la conexión ve un pedido que ya está
--     (cargado desde FactuSOL), lo vincula en vez de crearlo.
--   · factusol_importar_sin_stock(desde, hasta, simular): remitos de 2026 en ese rango que no estén en Percha.

CREATE OR REPLACE FUNCTION public.venta_linea_mover_stock(e uuid, v_id uuid, v_num bigint, v_lin bigint, dep uuid, l jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare tipo_prod text; c jsonb; comp record; v_comp uuid; cant numeric := (l->>'cantidad')::numeric; mov_tipo text; vid uuid; es_falla boolean; antes numeric; f numeric; sin_control boolean;
begin
  -- ventas históricas (p. ej. FactuSOL de meses ya contados): se registran sin mover stock
  if coalesce(current_setting('percha.sin_stock', true), '') = '1' then return; end if;
  mov_tipo := case when cant < 0 then 'devolucion' else 'venta' end;
  select tipo into tipo_prod from productos where id = (l->>'producto_id')::uuid;
  if tipo_prod = 'kit' then
    if jsonb_typeof(l->'componentes') = 'array' and jsonb_array_length(l->'componentes') > 0 then
      for c in select * from jsonb_array_elements(l->'componentes') loop
        insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id, linea_id)
        values (e, (c->>'variante_id')::uuid, dep, -(sign(cant) * (c->>'cantidad')::numeric), mov_tipo, v_id::text, coalesce('Venta #' || v_num, 'Venta') || ' · kit ' || (l->>'descripcion'), auth.uid(), v_lin);
      end loop;
    else
      for comp in select variante_id, componente_producto_id, filtro, cantidad from producto_componentes where producto_id = (l->>'producto_id')::uuid loop
        v_comp := coalesce(comp.variante_id,
                           case when comp.componente_producto_id is not null then variante_indefinida(comp.componente_producto_id) end,
                           case when comp.filtro->>'defecto_producto_id' is not null then variante_indefinida((comp.filtro->>'defecto_producto_id')::uuid) end);
        if v_comp is not null then
          insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id, linea_id)
          values (e, v_comp, dep, -(cant * comp.cantidad), mov_tipo, v_id::text, coalesce('Venta #' || v_num, 'Venta') || ' · kit ' || (l->>'descripcion') || case when comp.variante_id is null then ' (sin definir)' else '' end, auth.uid(), v_lin);
        end if;
      end loop;
    end if;
  elsif l->>'variante_id' is not null then
    vid := (l->>'variante_id')::uuid; es_falla := coalesce((l->>'falla')::boolean, false);
    select coalesce(sum(cantidad), 0) into antes from stock where variante_id = vid;
    select v.fallas, p.es_generico or coalesce(v.sku, '') like '%-SD' into f, sin_control from variantes v join productos p on p.id = v.producto_id where v.id = vid;
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id, linea_id)
    values (e, vid, dep, -cant, mov_tipo, v_id::text, coalesce('Venta #' || v_num, 'Venta') || case when es_falla then ' · con falla' else '' end, auth.uid(), v_lin);
    if es_falla then
      update venta_lineas set falla = true where id = v_lin;
      perform fallas_vender(vid, cant, nullif(l->>'falla_id', '')::uuid, v_id, v_lin);
    elsif cant > 0 and not sin_control then
      -- se vendió más de lo que había: queda el recordatorio para corregir el stock
      if antes < cant then
        insert into stock_revisar (empresa_id, variante_id, venta_id, linea_id, motivo, detalle)
        values (e, vid, v_id, v_lin, 'sin_stock', coalesce('Venta #' || v_num, 'Venta') || ': se vendieron ' || cant::int || ' y el sistema tenía ' || antes::int);
      elsif f > 0 and antes - f < cant then
        insert into stock_revisar (empresa_id, variante_id, venta_id, linea_id, motivo, detalle)
        values (e, vid, v_id, v_lin, 'falla', coalesce('Venta #' || v_num, 'Venta') || ': se vendió sin marcar la falla y solo quedaban las que tienen falla');
      end if;
      -- nunca puede haber más con falla que stock
      update variantes set fallas = greatest(antes - cant, 0) where id = vid and fallas > greatest(antes - cant, 0);
    end if;
  end if;
end $function$
;


create or replace function ventas_un_pedido_tn() returns trigger
language plpgsql as $$
begin
  if new.origen = 'tiendanube' and nullif(new.referencia, '') is not null and new.estado <> 'anulada'
     and exists (select 1 from ventas v where v.empresa_id = new.empresa_id and v.origen = 'tiendanube' and v.referencia = new.referencia and v.estado <> 'anulada' and v.id <> new.id) then
    raise exception 'El pedido de Tienda Nube #% ya está cargado en Percha', new.referencia;
  end if;
  return new;
end $$;
drop trigger if exists ventas_un_pedido_tn on ventas;
create trigger ventas_un_pedido_tn before insert on ventas for each row execute function ventas_un_pedido_tn();

create or replace function canal_pedidos_vincular() returns trigger
language plpgsql as $$
begin
  if new.venta_id is null and nullif(new.numero_ext, '') is not null then
    new.venta_id := (select v.id from ventas v where v.empresa_id = new.empresa_id and v.origen = 'tiendanube' and v.referencia = new.numero_ext and v.estado <> 'anulada' order by v.fecha limit 1);
    if new.venta_id is not null then new.problema := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists canal_pedidos_vincular on canal_pedidos;
create trigger canal_pedidos_vincular before insert or update on canal_pedidos for each row execute function canal_pedidos_vincular();

create or replace function factusol_importar_sin_stock(p_desde int, p_hasta int, p_simular boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e uuid := (select id from empresas order by creada limit 1);
  r record; l record; prod record; var_id uuid; lineas jsonb; probl text[]; fp uuid; fp_nombre text; v_origen text; tn_num text; ya uuid;
  res jsonb; hechos jsonb := '[]'::jsonb; saltados jsonb := '[]'::jsonb; v_fecha timestamptz; dep uuid; total_l numeric; desc_ numeric; rec_ numeric;
begin
  if not es_servicio() and not es_admin(e) then raise exception 'Solo administración'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  perform set_config('percha.sin_stock', '1', true);
  dep := (select id from depositos where empresa_id = e and principal limit 1);
  for r in select * from fs_remitos where ejercicio = 2026 and codigo between p_desde and p_hasta order by codigo loop
    if r.venta_id is not null or r.omitido is not null then saltados := saltados || jsonb_build_object('remito', r.codigo, 'por', 'ya estaba en Percha'); continue; end if;
    -- número de pedido de la web en la observación ("#2397 …" o "2403 Camila …")
    tn_num := coalesce(substring(coalesce(r.obs, '') from '#[[:space:]]*([0-9]{4,6})'), case when r.cliente_nombre ilike 'ONLINE - LISTA%' then substring(coalesce(r.obs, '') from '(?:^|[^0-9])(2[0-9]{3})(?:[^0-9]|$)') end);
    if tn_num is not null then
      select id into ya from ventas where empresa_id = e and origen = 'tiendanube' and referencia = tn_num and estado <> 'anulada' limit 1;
      if ya is not null then
        update fs_remitos set venta_id = ya, omitido = 'Pedido de Tienda Nube #' || tn_num || ': ya estaba en Percha' where id = r.id;
        saltados := saltados || jsonb_build_object('remito', r.codigo, 'por', 'pedido web #' || tn_num || ' ya estaba'); continue;
      end if;
    end if;
    v_origen := case when tn_num is not null then 'tiendanube' when r.obs ilike '%instagram%' then 'online' when r.cliente_nombre ilike 'ONLINE%' or r.obs ilike '%wsp%' or r.obs ilike '%whats%' then 'whatsapp' else 'local' end;
    lineas := '[]'::jsonb; probl := '{}'; total_l := 0;
    for l in select * from fs_remito_lineas where remito_id = r.id order by pos loop
      select p.id, p.nombre into prod from productos p where p.empresa_id = e and p.codigo = l.articulo;
      if prod.id is null then
        select p.id, p.nombre into prod from productos p where p.empresa_id = e and p.activo
          and (quitar_acentos(p.nombre) = quitar_acentos(l.descripcion) or p.descripcion ilike '%Nombre anterior: ' || l.descripcion || '%') limit 1;
      end if;
      var_id := null;
      if prod.id is not null then
        select v.id into var_id from variantes v left join atributos t on t.id = v.talle_id left join atributos c on c.id = v.color_id
        where v.producto_id = prod.id
          and (nullif(l.talle, '') is null or upper(t.codigo) = upper(l.talle) or quitar_acentos(t.nombre) = quitar_acentos(l.talle))
          and (nullif(l.color, '') is null or upper(c.codigo) = upper(l.color) or quitar_acentos(c.nombre) = quitar_acentos(l.color))
        order by (t.id is not null)::int + (c.id is not null)::int desc limit 1;
        if var_id is null then
          select v.id into var_id from variantes v where v.producto_id = prod.id order by (v.talle_id is null and v.color_id is null)::int desc, v.activa desc limit 1;
          if nullif(l.talle, '') is not null or nullif(l.color, '') is not null then probl := probl || (l.descripcion || ' ' || coalesce(l.talle, '') || ' ' || coalesce(l.color, '') || ': talle/color no encontrado'); end if;
        end if;
      elsif l.articulo not in ('100000','200000','300000','400000') then
        probl := probl || (l.articulo || ' ' || l.descripcion || ': producto que no está en Percha');
      end if;
      total_l := total_l + l.total;
      lineas := lineas || jsonb_build_object('variante_id', var_id, 'producto_id', prod.id, 'descripcion', coalesce(prod.nombre, nullif(btrim(l.descripcion), ''), 'Artículo ' || nullif(l.articulo, ''), 'Artículo de FactuSOL'), 'talle', nullif(l.talle, ''), 'color', nullif(l.color, ''),
        'cantidad', l.cantidad, 'precio_lista', l.precio, 'precio_unit', l.precio, 'descuento_pct', 0, 'total', l.total, 'costo_unit', coalesce(l.costo_unit, 0));
    end loop;
    if jsonb_array_length(lineas) = 0 then saltados := saltados || jsonb_build_object('remito', r.codigo, 'por', 'sin renglones'); continue; end if;
    desc_ := case when total_l > r.total then round(total_l - r.total, 2) else 0 end;
    rec_ := case when r.total > total_l then round(r.total - total_l, 2) else 0 end;
    select id into fp from formas_pago where empresa_id = e and codigo_fs = r.forma_pago limit 1;
    if fp is null then
      select nombre into fp_nombre from fs_formas_pago where codigo = r.forma_pago;
      select id into fp from formas_pago where empresa_id = e and lower(nombre) = lower(coalesce(fp_nombre, '')) limit 1;
      if fp is null then insert into formas_pago (empresa_id, nombre, tipo, activa, codigo_fs) values (e, coalesce(fp_nombre, 'FactuSOL ' || r.forma_pago), 'otro', false, r.forma_pago) returning id into fp;
      else update formas_pago set codigo_fs = r.forma_pago where id = fp; end if;
    end if;
    v_fecha := (r.fecha::text || ' ' || coalesce(nullif(r.hora::text, ''), '12:00:00'))::timestamp at time zone 'America/Argentina/Cordoba';
    res := caja_registrar_venta(jsonb_build_object('empresa_id', e, 'estado', 'completada', 'tipo', 'venta', 'fecha', v_fecha, 'deposito_id', dep,
      'lista_id', (select id from listas_precios where empresa_id = e and predeterminada limit 1), 'descuento_pct', 0, 'descuento', desc_, 'recargo', rec_,
      'origen', v_origen, 'referencia', coalesce(tn_num, 'FactuSOL ' || r.codigo),
      'nota', case when tn_num is not null then 'Tienda Nube #' || tn_num || ' · ' else '' end || 'FactuSOL remito ' || r.codigo || ' · ' || coalesce(r.cliente_nombre, '') || coalesce(' · ' || nullif(btrim(r.obs), ''), '') || ' · cargada sin mover stock (octubre ya contado)'
        || case when array_length(probl, 1) > 0 then ' · REVISAR: ' || array_to_string(probl, '; ') else '' end,
      'lineas', lineas, 'pagos', jsonb_build_array(jsonb_build_object('forma_pago_id', fp, 'monto', r.total)), 'creditos_a_emitir', '[]'::jsonb));
    update fs_remitos set venta_id = (res->>'id')::uuid, problema = nullif(array_to_string(probl, '; '), '') where id = r.id;
    hechos := hechos || jsonb_build_object('remito', r.codigo, 'ticket', (res->>'numero')::int, 'fecha', r.fecha, 'total', r.total, 'origen', v_origen, 'pedido', tn_num, 'problema', nullif(array_to_string(probl, '; '), ''));
  end loop;
  perform set_config('percha.sin_stock', '', true);
  if p_simular then raise exception 'SIMULACION__%', jsonb_build_object('hechos', hechos, 'saltados', saltados)::text; end if;
  return jsonb_build_object('hechos', hechos, 'saltados', saltados);
end $$;
