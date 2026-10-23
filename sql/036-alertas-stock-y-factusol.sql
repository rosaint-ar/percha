-- 036 · Vender aunque el sistema diga que no hay (o que solo quedan con falla): la caja avisa, deja seguir
--       y queda un recordatorio "Stock a revisar" para corregir. Y el importador de FactuSOL no trae los pedidos de la web
--       que Emi carga con "#número" en la observación (el remito 1305 = pedido #2415 se había duplicado).

create table if not exists stock_revisar (
  id bigserial primary key,
  empresa_id uuid not null references empresas(id) on delete cascade,
  variante_id uuid not null references variantes(id) on delete cascade,
  venta_id uuid references ventas(id) on delete set null,
  linea_id bigint references venta_lineas(id) on delete set null,
  motivo text not null,               -- sin_stock | falla
  detalle text,
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  resuelto timestamptz, resuelto_por uuid, resolucion text
);
create index if not exists stock_revisar_pend on stock_revisar (empresa_id) where resuelto is null;
alter table stock_revisar enable row level security;
drop policy if exists stock_revisar_ver on stock_revisar; create policy stock_revisar_ver on stock_revisar for select using (es_miembro(empresa_id));

create or replace view v_stock_revisar with (security_invoker = true) as
select r.*, v.producto_id, v.producto_codigo, v.producto_nombre, v.talle_nombre, v.color_nombre, v.stock, v.fallas, ve.numero venta_numero
from stock_revisar r join v_variantes v on v.id = r.variante_id left join ventas ve on ve.id = r.venta_id;

-- Resolver: si se contó, el stock queda en lo contado; si no, solo se da por visto
create or replace function stock_revisar_resolver(p_id bigint, p_contado numeric default null, p_fallas numeric default null, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r stock_revisar%rowtype; actual numeric; dep uuid;
begin
  select * into r from stock_revisar where id = p_id for update;
  if r.id is null or not es_miembro(r.empresa_id) or rol_en(r.empresa_id) = 'visor' then raise exception 'Sin permiso'; end if;
  if p_contado is not null then
    select coalesce(sum(cantidad), 0) into actual from stock where variante_id = r.variante_id;
    dep := (select id from depositos where empresa_id = r.empresa_id and principal limit 1);
    if p_contado <> actual then
      insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
      values (r.empresa_id, r.variante_id, dep, p_contado - actual, 'ajuste', 'stock-revisar-' || r.id, 'Recuento por aviso de la caja' || coalesce(' · ' || p_nota, ''), auth.uid());
    end if;
    update variantes set fallas = least(coalesce(p_fallas, fallas), greatest(p_contado, 0)) where id = r.variante_id;
  end if;
  update stock_revisar set resuelto = now(), resuelto_por = auth.uid(),
    resolucion = coalesce(case when p_contado is not null then 'Contado: ' || p_contado::int || coalesce(' (' || p_fallas::int || ' con falla)', '') end, 'Visto') || coalesce(' · ' || p_nota, '')
  where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function venta_linea_mover_stock(e uuid, v_id uuid, v_num bigint, v_lin bigint, dep uuid, l jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare tipo_prod text; c jsonb; comp record; v_comp uuid; cant numeric := (l->>'cantidad')::numeric; mov_tipo text; vid uuid; es_falla boolean; antes numeric; f numeric; sin_control boolean;
begin
  mov_tipo := case when cant < 0 then 'devolucion' else 'venta' end;
  select tipo into tipo_prod from productos where id = (l->>'producto_id')::uuid;
  if tipo_prod = 'kit' then
    if jsonb_typeof(l->'componentes') = 'array' and jsonb_array_length(l->'componentes') > 0 then
      for c in select * from jsonb_array_elements(l->'componentes') loop
        insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id, linea_id)
        values (e, (c->>'variante_id')::uuid, dep, -(sign(cant) * (c->>'cantidad')::numeric), mov_tipo, v_id::text, 'Venta #' || v_num || ' · kit ' || (l->>'descripcion'), auth.uid(), v_lin);
      end loop;
    else
      for comp in select variante_id, componente_producto_id, filtro, cantidad from producto_componentes where producto_id = (l->>'producto_id')::uuid loop
        v_comp := coalesce(comp.variante_id,
                           case when comp.componente_producto_id is not null then variante_indefinida(comp.componente_producto_id) end,
                           case when comp.filtro->>'defecto_producto_id' is not null then variante_indefinida((comp.filtro->>'defecto_producto_id')::uuid) end);
        if v_comp is not null then
          insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id, linea_id)
          values (e, v_comp, dep, -(cant * comp.cantidad), mov_tipo, v_id::text, 'Venta #' || v_num || ' · kit ' || (l->>'descripcion') || case when comp.variante_id is null then ' (sin definir)' else '' end, auth.uid(), v_lin);
        end if;
      end loop;
    end if;
  elsif l->>'variante_id' is not null then
    vid := (l->>'variante_id')::uuid; es_falla := coalesce((l->>'falla')::boolean, false);
    select coalesce(sum(cantidad), 0) into antes from stock where variante_id = vid;
    select v.fallas, p.es_generico or coalesce(v.sku, '') like '%-SD' into f, sin_control from variantes v join productos p on p.id = v.producto_id where v.id = vid;
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id, linea_id)
    values (e, vid, dep, -cant, mov_tipo, v_id::text, 'Venta #' || v_num || case when es_falla then ' · con falla' else '' end, auth.uid(), v_lin);
    if es_falla then
      update venta_lineas set falla = true where id = v_lin;
      update variantes set fallas = greatest(fallas - cant, 0) where id = vid;
    elsif cant > 0 and not sin_control then
      -- se vendió más de lo que había: queda el recordatorio para corregir el stock
      if antes < cant then
        insert into stock_revisar (empresa_id, variante_id, venta_id, linea_id, motivo, detalle)
        values (e, vid, v_id, v_lin, 'sin_stock', 'Venta #' || v_num || ': se vendieron ' || cant::int || ' y el sistema tenía ' || antes::int);
      elsif f > 0 and antes - f < cant then
        insert into stock_revisar (empresa_id, variante_id, venta_id, linea_id, motivo, detalle)
        values (e, vid, v_id, v_lin, 'falla', 'Venta #' || v_num || ': se vendió sin marcar la falla y solo quedaban las que tienen falla');
      end if;
      -- nunca puede haber más con falla que stock
      update variantes set fallas = greatest(antes - cant, 0) where id = vid and fallas > greatest(antes - cant, 0);
    end if;
  end if;
end $$;


create or replace function factusol_importar_ventas(p_empresa uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e uuid := coalesce(p_empresa, (select id from empresas order by creada limit 1));
  desde int := coalesce((select valor from app_config where clave = 'factusol_desde_codigo'), '0')::int;
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
end $$;


-- datos: 1305 era el pedido #2415 (ticket #3); 1303/1304 son los tickets #1/#2
update fs_remitos set omitido = 'Pedido de Tienda Nube #2415: ya está como ticket #3 (el ticket #5 se anuló)' where ejercicio = 2026 and codigo = 1305;
update fs_remitos r set venta_id = v.id from ventas v where r.ejercicio = 2026 and r.codigo in (1303, 1304) and v.referencia = 'FactuSOL ' || r.codigo;

select jsonb_build_object('remitos', (select jsonb_agg(codigo || ' ' || coalesce(omitido, case when venta_id is not null then 'importado' else 'pendiente' end) order by codigo) from fs_remitos where ejercicio = 2026 and codigo >= 1303),
  'stock', (select jsonb_agg(producto_nombre || ' ' || coalesce(talle_nombre,'') || ' ' || coalesce(color_nombre,'') || ' = ' || stock::int) from v_variantes where producto_codigo in ('500123','500124','900203') and stock <> 0)) r;
