-- 039 · Ventas reservadas (modo oscuro de Emi). Se entra y se sale escribiendo la clave en el buscador de la caja + Enter.
--  · Descuentan del mismo stock (depósito general), pero NO aparecen en Ventas, cierres de caja ni métricas comunes:
--    la base de datos las oculta a todos (RLS) y solo se leen con la clave, por funciones del servidor.
--  · Numeración propia (R-000001), sin caja ni turno (no tocan el arqueo). En los movimientos de stock figuran solo como "Venta".
--  · La clave se guarda como hash; 8 intentos fallidos en 15 minutos bloquean.

alter table ventas add column if not exists reservada boolean not null default false;
create index if not exists ventas_reservadas on ventas (empresa_id, fecha) where reservada;

drop policy if exists ventas_ver on ventas;
create policy ventas_ver on ventas for select using (es_miembro(empresa_id) and not reservada);
-- (la regla de líneas y pagos no puede mirar ventas directamente: ventas ya oculta las reservadas a quien consulta)
create or replace function venta_es_reservada(p_venta uuid) returns boolean language sql stable security definer set search_path = public as $$ select coalesce((select reservada from ventas where id = p_venta), false) $$;
drop policy if exists venta_lineas_ver on venta_lineas;
create policy venta_lineas_ver on venta_lineas for select using (es_miembro(empresa_id) and not venta_es_reservada(venta_id));
drop policy if exists venta_pagos_ver on venta_pagos;
create policy venta_pagos_ver on venta_pagos for select using (es_miembro(empresa_id) and not venta_es_reservada(venta_id));

-- el contador de numeración de las reservadas tampoco se ve
drop policy if exists secuencias_ver on secuencias;
create policy secuencias_ver on secuencias for select using (es_miembro(empresa_id) and nombre <> 'r');

-- clave (hash) e intentos
create table if not exists reservado_intentos (id bigserial primary key, empresa_id uuid, user_id uuid default auth.uid(), ok boolean, fecha timestamptz not null default now());
alter table reservado_intentos enable row level security;
-- el hash de la clave se carga aparte (no va en este archivo, que se publica): app_config.reservado_pin_sha

create or replace function reservado_pin_ok(e uuid, p_pin text) returns boolean
language plpgsql security definer set search_path = public as $$
declare bien boolean; fallidos int;
begin
  if not es_miembro(e) then return false; end if;
  select count(*) into fallidos from reservado_intentos where user_id = auth.uid() and not ok and fecha > now() - interval '15 minutes';
  if fallidos >= 8 then raise exception 'Demasiados intentos. Probá en 15 minutos.'; end if;
  bien := encode(sha256(convert_to('percha-reservado:' || coalesce(p_pin, ''), 'UTF8')), 'hex') = (select valor from app_config where clave = 'reservado_pin_sha');
  insert into reservado_intentos (empresa_id, ok) values (e, bien);
  return bien;
end $$;

create or replace function reservado_entrar(e uuid, p_pin text) returns boolean
language sql security definer set search_path = public as $$ select reservado_pin_ok(e, p_pin) $$;

-- listado de ventas reservadas (con prendas y pagos)
create or replace function reservadas_listar(e uuid, p_pin text, p_desde date, p_hasta date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not reservado_pin_ok(e, p_pin) then raise exception 'Clave incorrecta'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id, 'numero', 'R-' || lpad((v.numero - 1000000)::text, 6, '0'), 'fecha', v.fecha, 'estado', v.estado, 'total', v.total, 'nota', v.nota, 'origen', v.origen,
      'cliente', c.nombre, 'vendedora', eu.nombre, 'anulada_motivo', v.anulada_motivo, 'costo', v.costo,
      'lineas', (select jsonb_agg(jsonb_build_object('d', l.descripcion, 't', l.talle, 'c', l.color, 'n', l.cantidad, 'total', l.total, 'falla', l.falla) order by l.id) from venta_lineas l where l.venta_id = v.id),
      'pagos', (select jsonb_agg(jsonb_build_object('forma', fp.nombre, 'monto', vp.monto)) from venta_pagos vp left join formas_pago fp on fp.id = vp.forma_pago_id where vp.venta_id = v.id)
    ) order by v.fecha desc)
    from ventas v left join clientes c on c.id = v.cliente_id left join empresa_usuarios eu on eu.empresa_id = v.empresa_id and eu.user_id = v.vendedora_id
    where v.empresa_id = e and v.reservada and v.fecha >= p_desde and v.fecha < p_hasta + 1), '[]'::jsonb);
end $$;

-- anular una venta reservada: vuelve el stock (y la marca de falla)
create or replace function reservada_anular(e uuid, p_pin text, p_venta uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v ventas%rowtype; m record;
begin
  if not reservado_pin_ok(e, p_pin) then raise exception 'Clave incorrecta'; end if;
  select * into v from ventas where id = p_venta and empresa_id = e and reservada for update;
  if v.id is null then raise exception 'Venta inexistente'; end if;
  if v.estado = 'anulada' then raise exception 'Ya estaba anulada'; end if;
  for m in select * from stock_movimientos where referencia = v.id::text and tipo in ('venta','devolucion') loop
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
    values (v.empresa_id, m.variante_id, m.deposito_id, -m.cantidad, 'ajuste', v.id::text, 'Anulación de venta', auth.uid());
  end loop;
  update variantes x set fallas = x.fallas + l.cantidad from venta_lineas l where l.venta_id = v.id and l.falla and l.variante_id = x.id;
  update ventas set estado = 'anulada', anulada_por = auth.uid(), anulada_fecha = now(), anulada_motivo = p_motivo where id = v.id;
end $$;

create or replace function caja_registrar_venta(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e uuid := (p->>'empresa_id')::uuid;
  v_id uuid; v_num bigint; v_lin bigint; l jsonb; pg jsonb; cr jsonb; comp record; c jsonb; v_comp uuid;
  v_sub numeric := 0; v_costo numeric := 0; v_pagado numeric := 0; v_total numeric; v_desc numeric; v_rec numeric;
  v_estado text := coalesce(p->>'estado', 'completada'); v_tipo text := coalesce(p->>'tipo', 'venta');
  es_res boolean := coalesce((p->>'reservada')::boolean, false); dep uuid; cred creditos%rowtype; codigo text; creditos_out jsonb := '[]'::jsonb; existente uuid; tipo_prod text;
begin
  if not es_servicio() and (not es_miembro(e) or rol_en(e) = 'visor') then raise exception 'Sin permiso para vender'; end if;
  if es_res and not reservado_pin_ok(e, p->>'pin') then raise exception 'Clave incorrecta'; end if;
  if p->>'offline_id' is not null then
    select id into existente from ventas where empresa_id = e and offline_id = (p->>'offline_id')::uuid;
    if existente is not null then return jsonb_build_object('id', existente, 'numero', (select numero from ventas where id = existente), 'repetida', true); end if;
  end if;
  dep := coalesce((p->>'deposito_id')::uuid, (select deposito_id from cajas where id = (p->>'caja_id')::uuid), (select id from depositos where empresa_id = e and principal limit 1));
  for l in select * from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) loop
    v_sub := v_sub + (l->>'total')::numeric; v_costo := v_costo + coalesce((l->>'costo_unit')::numeric, 0) * (l->>'cantidad')::numeric;
  end loop;
  v_desc := coalesce((p->>'descuento')::numeric, 0); v_rec := coalesce((p->>'recargo')::numeric, 0); v_total := round(v_sub - v_desc + v_rec, 2);
  for pg in select * from jsonb_array_elements(coalesce(p->'pagos', '[]'::jsonb)) loop v_pagado := v_pagado + (pg->>'monto')::numeric; end loop;
  for cr in select * from jsonb_array_elements(coalesce(p->'creditos_a_emitir', '[]'::jsonb)) loop if cr->>'tipo' = 'nota_credito' then v_pagado := v_pagado - (cr->>'monto')::numeric; end if; end loop;
  if v_estado = 'completada' and abs(v_pagado - v_total) > 0.5 then raise exception 'Los pagos (%) no coinciden con el total (%)', v_pagado, v_total; end if;
  if v_estado = 'senada' and v_pagado <= 0 then raise exception 'Una seña necesita un pago a cuenta'; end if;
  v_num := case when es_res then 1000000 + proximo_numero(e, 'r') else proximo_numero(e, 'venta') end;
  insert into ventas (empresa_id, numero, tipo, estado, fecha, caja_id, turno_id, cliente_id, vendedora_id, lista_id, subtotal, descuento_pct, descuento, recargo, total, pagado, saldo, costo, venta_origen_id, origen, referencia, nota, offline_id, creado_por, reservada)
  values (e, v_num, v_tipo, v_estado, coalesce((p->>'fecha')::timestamptz, now()), case when es_res then null else (p->>'caja_id')::uuid end, case when es_res then null else (p->>'turno_id')::uuid end, (p->>'cliente_id')::uuid, coalesce((p->>'vendedora_id')::uuid, auth.uid()), (p->>'lista_id')::uuid,
          v_sub, coalesce((p->>'descuento_pct')::numeric, 0), v_desc, v_rec, v_total, v_pagado, round(v_total - v_pagado, 2), v_costo,
          (p->>'venta_origen_id')::uuid, coalesce(p->>'origen', 'local'), p->>'referencia', p->>'nota', (p->>'offline_id')::uuid, auth.uid(), es_res)
  returning id into v_id;
  for l in select * from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) loop
    insert into venta_lineas (venta_id, empresa_id, variante_id, producto_id, descripcion, talle, color, cantidad, precio_lista, precio_unit, descuento_pct, promocion_id, promocion_nombre, total, costo_unit)
    values (v_id, e, (l->>'variante_id')::uuid, (l->>'producto_id')::uuid, l->>'descripcion', l->>'talle', l->>'color', (l->>'cantidad')::numeric,
            coalesce((l->>'precio_lista')::numeric, 0), coalesce((l->>'precio_unit')::numeric, 0), coalesce((l->>'descuento_pct')::numeric, 0),
            (l->>'promocion_id')::uuid, l->>'promocion_nombre', (l->>'total')::numeric, coalesce((l->>'costo_unit')::numeric, 0))
    returning id into v_lin;
    perform venta_linea_mover_stock(e, v_id, case when es_res then null else v_num end, v_lin, dep, l);
  end loop;
  for pg in select * from jsonb_array_elements(coalesce(p->'pagos', '[]'::jsonb)) loop
    insert into venta_pagos (venta_id, empresa_id, turno_id, forma_pago_id, credito_id, monto, cuotas, recargo_pct, referencia)
    values (v_id, e, case when es_res then null else (p->>'turno_id')::uuid end, (pg->>'forma_pago_id')::uuid, (pg->>'credito_id')::uuid, (pg->>'monto')::numeric, coalesce((pg->>'cuotas')::int, 1), coalesce((pg->>'recargo_pct')::numeric, 0), pg->>'referencia');
    if pg->>'credito_id' is not null then
      select * into cred from creditos where id = (pg->>'credito_id')::uuid and empresa_id = e for update;
      if cred.id is null or cred.estado <> 'vigente' then raise exception 'El crédito no está vigente'; end if;
      if cred.saldo < (pg->>'monto')::numeric - 0.01 then raise exception 'El crédito no tiene saldo suficiente'; end if;
      update creditos set saldo = round(saldo - (pg->>'monto')::numeric, 2), estado = case when round(saldo - (pg->>'monto')::numeric, 2) <= 0 then 'usado' else 'vigente' end where id = cred.id;
    end if;
  end loop;
  for cr in select * from jsonb_array_elements(coalesce(p->'creditos_a_emitir', '[]'::jsonb)) loop
    codigo := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    insert into creditos (empresa_id, tipo, codigo, cliente_id, origen_venta_id, monto, saldo, vence, nota)
    values (e, cr->>'tipo', codigo, (cr->>'cliente_id')::uuid, v_id, (cr->>'monto')::numeric, (cr->>'monto')::numeric, (cr->>'vence')::date, cr->>'nota');
    creditos_out := creditos_out || jsonb_build_object('tipo', cr->>'tipo', 'codigo', codigo, 'monto', (cr->>'monto')::numeric);
  end loop;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'creditos', creditos_out, 'reservada', es_res, 'numero_mostrar', case when es_res then 'R-' || lpad((v_num - 1000000)::text, 6, '0') end);
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
      update variantes set fallas = greatest(fallas - cant, 0) where id = vid;
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
end $$;

create or replace function pos_mas_vendidos(p_empresa uuid, p_dias int default 90) returns table (producto_id uuid, unidades numeric)
language sql stable security definer set search_path = public as $$
  with fs as (
    select l.articulo cod, sum(l.cantidad) u from fs_remito_lineas l join fs_remitos r on r.id = l.remito_id
    where r.fecha >= current_date - p_dias and l.cantidad > 0 group by 1),
  pc as (
    select l.producto_id, sum(l.cantidad) u from venta_lineas l join ventas v on v.id = l.venta_id
    where v.empresa_id = p_empresa and v.estado <> 'anulada' and not v.reservada and v.fecha >= now() - make_interval(days => p_dias)
      and v.origen in ('local', 'whatsapp', 'online') and coalesce(v.referencia, '') not like 'FactuSOL%' and l.cantidad > 0 group by 1)
  select p.id, coalesce(fs.u, 0) + coalesce(pc.u, 0)
  from productos p left join fs on fs.cod = p.codigo left join pc on pc.producto_id = p.id
  where es_miembro(p_empresa) and p.empresa_id = p_empresa and p.activo and coalesce(fs.u, 0) + coalesce(pc.u, 0) > 0
  order by 2 desc limit 120;
$$;

select (select count(*) from pg_policies where tablename in ('ventas','venta_lineas','venta_pagos')) politicas, reservado_pin_ok((select id from empresas limit 1), '0000') debe_ser_false;
