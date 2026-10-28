-- 070 · FactuSOL no redondea (Contado = 59.990 × 0,8 = 47.992) y en el local se cobra 48.000: al importar, esa diferencia
-- chica (menos de $100) pasa al precio de la prenda en vez de quedar como "recargo $8". También corrige las ventas ya importadas así.
CREATE OR REPLACE FUNCTION public.factusol_importar_ventas(p_empresa uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e uuid := coalesce(p_empresa, (select id from empresas order by creada limit 1));
  desde int := coalesce((select valor from app_config where clave = 'factusol_desde_codigo'), '0')::int;
  dif numeric; imax int; lin jsonb; nt numeric;   -- redondeo del cobro (FactuSOL no redondea: 59.990 × 0,8 = 47.992 y se cobra 48.000)
  r record; l record; prod record; var_id uuid; lineas jsonb; probl text[]; fp uuid; fp_nombre text; origen text;
  tn_num text; res jsonb; importados jsonb := '[]'::jsonb; omitidos int := 0; v_fecha timestamptz; dep uuid; total_l numeric; desc_ numeric; rec_ numeric;
begin
  if not es_servicio() and not es_admin(e) then raise exception 'Solo administración puede traer ventas de FactuSOL'; end if;
  -- lo que sigue registra ventas sin sesión de vendedora
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  dep := (select id from depositos where empresa_id = e and principal limit 1);
  for r in select * from fs_remitos where ejercicio = 2026 and codigo > desde and venta_id is null and omitido is null order by codigo loop
    if r.cliente_nombre ilike 'ONLINE - LISTA%' then
      update fs_remitos set omitido = 'Pedido de Tienda Nube: entra por la conexión' where id = r.id; omitidos := omitidos + 1; continue;
    end if;
    -- Emi también carga en FactuSOL los pedidos de la web: en la observación pone "#2415 Nombre". Esos entran por la conexión con Tienda Nube.
    tn_num := substring(coalesce(r.obs, '') from '#[[:space:]]*([0-9]{3,6})');
    if tn_num is not null or (r.cliente_nombre ilike 'ONLINE%' and exists (select 1 from ventas x where x.empresa_id = e and x.origen = 'tiendanube' and x.estado <> 'anulada' and abs(x.total - r.total) < 1 and x.fecha::date between r.fecha - 5 and r.fecha + 2)) then
      update fs_remitos set omitido = 'Pedido de Tienda Nube' || coalesce(' #' || tn_num, ' (mismo total)') || ': entra por la conexión',
        venta_id = coalesce(venta_id, (select x.id from ventas x where x.empresa_id = e and x.origen = 'tiendanube' and (x.referencia = tn_num or (tn_num is null and abs(x.total - r.total) < 1)) order by x.fecha desc limit 1))
      where id = r.id; omitidos := omitidos + 1; continue;
    end if;
    if not exists (select 1 from fs_remito_lineas where remito_id = r.id) then
      update fs_remitos set omitido = 'Sin renglones' where id = r.id; omitidos := omitidos + 1; continue;
    end if;
    origen := case when r.cliente_nombre ilike 'ONLINE%' or r.obs ilike '%wsp%' or r.obs ilike '%whats%' then 'whatsapp' else 'local' end;
    lineas := '[]'::jsonb; probl := '{}'; total_l := 0;
    for l in select * from fs_remito_lineas where remito_id = r.id order by pos loop
      select p.id, p.nombre, p.tipo, p.tiene_variantes into prod from productos p where p.empresa_id = e and p.codigo = l.articulo;
      if prod.id is null then
        select p.id, p.nombre, p.tipo, p.tiene_variantes into prod from productos p where p.empresa_id = e and p.activo
          and (quitar_acentos(p.nombre) = quitar_acentos(l.descripcion) or p.descripcion ilike '%Nombre anterior: ' || l.descripcion || '%') limit 1;
      end if;
      var_id := null;
      if prod.id is not null then
        select v.id into var_id from variantes v
          left join atributos t on t.id = v.talle_id left join atributos c on c.id = v.color_id
          where v.producto_id = prod.id
            and (l.talle is null or upper(t.codigo) = upper(l.talle) or quitar_acentos(t.nombre) = quitar_acentos(l.talle))
            and (l.color is null or upper(c.codigo) = upper(l.color) or quitar_acentos(c.nombre) = quitar_acentos(l.color))
          order by (t.id is not null)::int + (c.id is not null)::int desc limit 1;
        if var_id is null and (l.talle is not null or l.color is not null) then
          -- talle o color que Percha no tiene para ese producto → unidad "sin definir"
          var_id := variante_indefinida(prod.id);
          probl := probl || (l.descripcion || ' ' || coalesce(l.talle, '') || ' ' || coalesce(l.color, '') || ': talle/color no encontrado, quedó sin definir');
        elsif var_id is null then
          select v.id into var_id from variantes v where v.producto_id = prod.id and v.activa order by (v.talle_id is null and v.color_id is null)::int desc limit 1;
        end if;
      elsif l.articulo not in ('100000','200000','300000','400000') then
        probl := probl || (l.articulo || ' ' || l.descripcion || ': producto no existe en Percha, sin stock');
      end if;
      total_l := total_l + l.total;
      lineas := lineas || jsonb_build_object('variante_id', var_id, 'producto_id', prod.id, 'descripcion', coalesce(prod.nombre, l.descripcion), 'talle', l.talle, 'color', l.color,
        'cantidad', l.cantidad, 'precio_lista', l.precio, 'precio_unit', l.precio, 'descuento_pct', 0, 'total', l.total, 'costo_unit', coalesce(l.costo_unit, 0));
    end loop;
    -- una diferencia chica entre los renglones y lo cobrado es el redondeo del precio: va al precio de la prenda, no como recargo/descuento
    dif := round(r.total - total_l, 2);
    if dif <> 0 and abs(dif) < 100 then
      select (o - 1)::int into imax from jsonb_array_elements(lineas) with ordinality t(x, o) where (x->>'cantidad')::numeric > 0 order by (x->>'total')::numeric desc limit 1;
      if imax is not null then
        lin := lineas->imax; nt := (lin->>'total')::numeric + dif;
        lineas := jsonb_set(lineas, array[imax::text], lin || jsonb_build_object('total', nt, 'precio_unit', round(nt / (lin->>'cantidad')::numeric, 2), 'precio_lista', round(nt / (lin->>'cantidad')::numeric, 2)));
        total_l := total_l + dif;
      end if;
    end if;
    desc_ := case when total_l > r.total then round(total_l - r.total, 2) else 0 end;
    rec_ := case when r.total > total_l then round(r.total - total_l, 2) else 0 end;
    -- forma de pago: por código de FactuSOL, si no por nombre, si no se crea (inactiva) para no mentir
    select id into fp from formas_pago where empresa_id = e and codigo_fs = r.forma_pago limit 1;
    if fp is null then
      select nombre into fp_nombre from fs_formas_pago where codigo = r.forma_pago;
      select id into fp from formas_pago where empresa_id = e and lower(nombre) = lower(coalesce(fp_nombre, '')) limit 1;
      if fp is null then
        insert into formas_pago (empresa_id, nombre, tipo, activa, codigo_fs) values (e, coalesce(fp_nombre, 'FactuSOL ' || r.forma_pago), 'otro', false, r.forma_pago) returning id into fp;
      else update formas_pago set codigo_fs = r.forma_pago where id = fp; end if;
    end if;
    v_fecha := (r.fecha::text || ' ' || coalesce(r.hora::text, '12:00:00'))::timestamp at time zone 'America/Argentina/Cordoba';
    res := caja_registrar_venta(jsonb_build_object('empresa_id', e, 'estado', 'completada', 'tipo', 'venta', 'fecha', v_fecha, 'deposito_id', dep,
      'lista_id', (select id from listas_precios where empresa_id = e and predeterminada limit 1), 'descuento_pct', 0, 'descuento', desc_, 'recargo', rec_,
      'origen', origen, 'referencia', 'FactuSOL ' || r.codigo,
      'nota', 'FactuSOL remito ' || r.codigo || ' · ' || coalesce(r.cliente_nombre, '') || coalesce(' · ' || nullif(r.obs, ''), '') || case when array_length(probl, 1) > 0 then ' · REVISAR: ' || array_to_string(probl, '; ') else '' end,
      'lineas', lineas, 'pagos', jsonb_build_array(jsonb_build_object('forma_pago_id', fp, 'monto', r.total)), 'creditos_a_emitir', '[]'::jsonb));
    update fs_remitos set venta_id = (res->>'id')::uuid, problema = nullif(array_to_string(probl, '; '), '') where id = r.id;
    importados := importados || jsonb_build_object('remito', r.codigo, 'ticket', res->>'numero', 'total', r.total, 'origen', origen, 'problema', nullif(array_to_string(probl, '; '), ''));
  end loop;
  return jsonb_build_object('importados', importados, 'omitidos', omitidos);
end $function$
;

-- ventas ya importadas de FactuSOL con un redondeo como recargo/descuento (sin factura): la diferencia pasa al renglón más grande
do $$
declare v record; ln record; dif numeric;
begin
  for v in select vt.* from ventas vt where exists (select 1 from fs_remitos r where r.venta_id = vt.id) and (vt.descuento + vt.recargo) > 0 and (vt.descuento + vt.recargo) < 100
             and not exists (select 1 from comprobantes c where c.venta_id = vt.id) loop
    dif := v.recargo - v.descuento;
    if round(v.subtotal + dif - v.total, 2) <> 0 then raise notice 'venta % no cierra, no se toca', v.numero; continue; end if;   -- el total cobrado NO cambia
    select * into ln from venta_lineas where venta_id = v.id and cantidad > 0 order by total desc limit 1;
    if ln.id is null then continue; end if;
    update venta_lineas set total = total + dif, precio_unit = round((total + dif) / cantidad, 2), precio_lista = round((total + dif) / cantidad, 2) where id = ln.id;
    update ventas set subtotal = subtotal + dif, recargo = 0, descuento = 0 where id = v.id;
    raise notice 'venta % · renglón % → %', v.numero, ln.total, ln.total + dif;
  end loop;
end $$;

select json_agg(x) from (select v.numero, v.estado, v.subtotal, v.descuento, v.recargo, v.total, l.descripcion, l.cantidad, l.precio_lista, l.precio_unit, l.total lt
  from ventas v join venta_lineas l on l.venta_id = v.id where v.numero in (1, 2, 5, 69) and exists (select 1 from fs_remitos r where r.venta_id = v.id) order by v.numero, l.total desc) x;
