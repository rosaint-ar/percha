-- 032 · Editar ventas (vendedora, clienta, fecha, origen, nota, líneas, pagos) y rastrear a qué línea pertenece cada movimiento de stock.
-- Origen de la venta: local | whatsapp | tiendanube | mercadolibre | online | factusol

alter table stock_movimientos add column if not exists linea_id bigint references venta_lineas(id) on delete set null;
create index if not exists stock_mov_linea on stock_movimientos (linea_id) where linea_id is not null;

-- Rellenar linea_id en los movimientos de ventas ya registradas (prendas por variante; kits por la descripción en la nota)
update stock_movimientos m set linea_id = l.id
from venta_lineas l
where m.linea_id is null and m.tipo in ('venta','devolucion') and m.referencia = l.venta_id::text and m.variante_id = l.variante_id
  and (select count(*) from venta_lineas l2 where l2.venta_id = l.venta_id and l2.variante_id = l.variante_id) = 1;
update stock_movimientos m set linea_id = l.id
from venta_lineas l join productos p on p.id = l.producto_id
where m.linea_id is null and m.tipo in ('venta','devolucion') and m.referencia = l.venta_id::text and p.tipo = 'kit'
  and m.nota like '% · kit ' || l.descripcion || '%'
  and (select count(*) from venta_lineas l2 where l2.venta_id = l.venta_id and l2.descripcion = l.descripcion) = 1;

-- ---------- Registrar venta: cada movimiento sabe de qué línea nació ----------
create or replace function caja_registrar_venta(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e uuid := (p->>'empresa_id')::uuid;
  v_id uuid; v_num bigint; v_lin bigint; l jsonb; pg jsonb; cr jsonb; comp record; c jsonb; v_comp uuid;
  v_sub numeric := 0; v_costo numeric := 0; v_pagado numeric := 0; v_total numeric; v_desc numeric; v_rec numeric;
  v_estado text := coalesce(p->>'estado', 'completada'); v_tipo text := coalesce(p->>'tipo', 'venta');
  dep uuid; cred creditos%rowtype; codigo text; creditos_out jsonb := '[]'::jsonb; existente uuid; tipo_prod text;
begin
  if not es_servicio() and (not es_miembro(e) or rol_en(e) = 'visor') then raise exception 'Sin permiso para vender'; end if;
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
  v_num := proximo_numero(e, 'venta');
  insert into ventas (empresa_id, numero, tipo, estado, fecha, caja_id, turno_id, cliente_id, vendedora_id, lista_id, subtotal, descuento_pct, descuento, recargo, total, pagado, saldo, costo, venta_origen_id, origen, referencia, nota, offline_id, creado_por)
  values (e, v_num, v_tipo, v_estado, coalesce((p->>'fecha')::timestamptz, now()), (p->>'caja_id')::uuid, (p->>'turno_id')::uuid, (p->>'cliente_id')::uuid, coalesce((p->>'vendedora_id')::uuid, auth.uid()), (p->>'lista_id')::uuid,
          v_sub, coalesce((p->>'descuento_pct')::numeric, 0), v_desc, v_rec, v_total, v_pagado, round(v_total - v_pagado, 2), v_costo,
          (p->>'venta_origen_id')::uuid, coalesce(p->>'origen', 'local'), p->>'referencia', p->>'nota', (p->>'offline_id')::uuid, auth.uid())
  returning id into v_id;
  for l in select * from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) loop
    insert into venta_lineas (venta_id, empresa_id, variante_id, producto_id, descripcion, talle, color, cantidad, precio_lista, precio_unit, descuento_pct, promocion_id, promocion_nombre, total, costo_unit)
    values (v_id, e, (l->>'variante_id')::uuid, (l->>'producto_id')::uuid, l->>'descripcion', l->>'talle', l->>'color', (l->>'cantidad')::numeric,
            coalesce((l->>'precio_lista')::numeric, 0), coalesce((l->>'precio_unit')::numeric, 0), coalesce((l->>'descuento_pct')::numeric, 0),
            (l->>'promocion_id')::uuid, l->>'promocion_nombre', (l->>'total')::numeric, coalesce((l->>'costo_unit')::numeric, 0))
    returning id into v_lin;
    perform venta_linea_mover_stock(e, v_id, v_num, v_lin, dep, l);
  end loop;
  for pg in select * from jsonb_array_elements(coalesce(p->'pagos', '[]'::jsonb)) loop
    insert into venta_pagos (venta_id, empresa_id, turno_id, forma_pago_id, credito_id, monto, cuotas, recargo_pct, referencia)
    values (v_id, e, (p->>'turno_id')::uuid, (pg->>'forma_pago_id')::uuid, (pg->>'credito_id')::uuid, (pg->>'monto')::numeric, coalesce((pg->>'cuotas')::int, 1), coalesce((pg->>'recargo_pct')::numeric, 0), pg->>'referencia');
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
  return jsonb_build_object('id', v_id, 'numero', v_num, 'creditos', creditos_out);
end $$;

-- Movimientos de stock de una línea (prenda suelta o kit con/sin componentes definidos). Lo usan registrar y editar.
create or replace function venta_linea_mover_stock(e uuid, v_id uuid, v_num bigint, v_lin bigint, dep uuid, l jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare tipo_prod text; c jsonb; comp record; v_comp uuid; cant numeric := (l->>'cantidad')::numeric; mov_tipo text;
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
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id, linea_id)
    values (e, (l->>'variante_id')::uuid, dep, -cant, mov_tipo, v_id::text, 'Venta #' || v_num, auth.uid(), v_lin);
  end if;
end $$;

-- ---------- Editar una venta ----------
-- p = { venta_id, fecha?, origen?, vendedora_id?, cliente_id?, referencia?, nota?, descuento_pct?, descuento?, recargo?,
--       lineas?: [{ id?, variante_id, producto_id, descripcion, talle, color, cantidad, precio_lista, precio_unit, descuento_pct, total, costo_unit, componentes? }],
--       pagos?:  [{ forma_pago_id, monto, cuotas, recargo_pct, referencia }] }   (los pagos con crédito/gift card se conservan tal cual)
-- Si viene "lineas", las que no vienen se quitan (vuelve su stock); las que cambian cantidad o variante rehacen su stock; las nuevas descuentan.
create or replace function caja_editar_venta(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v ventas%rowtype; l jsonb; pg jsonb; ol venta_lineas%rowtype; m record; dep uuid; v_lin bigint; nuevo_id bigint;
  v_sub numeric := 0; v_costo numeric := 0; v_total numeric; v_desc numeric; v_rec numeric; v_pagado numeric := 0; v_cred numeric := 0;
  ids_nuevas bigint[] := '{}'; cambios text[] := '{}'; rehacer boolean; factor numeric;
begin
  select * into v from ventas where id = (p->>'venta_id')::uuid for update;
  if v.id is null or not es_miembro(v.empresa_id) then raise exception 'Venta inexistente'; end if;
  if rol_en(v.empresa_id) = 'visor' then raise exception 'Sin permiso para editar ventas'; end if;
  if not es_admin(v.empresa_id) and v.creado_por is distinct from auth.uid() then raise exception 'Solo administración puede editar ventas de otra persona'; end if;
  if v.estado = 'anulada' then raise exception 'Una venta anulada no se edita'; end if;
  dep := coalesce((select deposito_id from cajas where id = v.caja_id), (select id from depositos where empresa_id = v.empresa_id and principal limit 1));

  -- cabecera
  if p ? 'fecha' and p->>'fecha' is not null then v.fecha := (p->>'fecha')::timestamptz; end if;
  if p ? 'origen' and coalesce(p->>'origen', '') <> '' then
    if p->>'origen' not in ('local','whatsapp','tiendanube','mercadolibre','online','factusol') then raise exception 'Origen inválido: %', p->>'origen'; end if;
    v.origen := p->>'origen';
  end if;
  if p ? 'vendedora_id' then v.vendedora_id := (p->>'vendedora_id')::uuid; end if;
  if p ? 'cliente_id' then v.cliente_id := (p->>'cliente_id')::uuid; end if;
  if p ? 'referencia' then v.referencia := nullif(p->>'referencia', ''); end if;
  if p ? 'nota' then v.nota := nullif(p->>'nota', ''); end if;
  if p ? 'descuento_pct' then v.descuento_pct := coalesce((p->>'descuento_pct')::numeric, 0); end if;
  if p ? 'descuento' then v.descuento := coalesce((p->>'descuento')::numeric, 0); end if;
  if p ? 'recargo' then v.recargo := coalesce((p->>'recargo')::numeric, 0); end if;

  -- líneas
  if jsonb_typeof(p->'lineas') = 'array' then
    for l in select * from jsonb_array_elements(p->'lineas') loop
      if (l->>'cantidad')::numeric = 0 then continue; end if;
      if l->>'id' is not null then
        select * into ol from venta_lineas where id = (l->>'id')::bigint and venta_id = v.id;
        if ol.id is null then raise exception 'La línea % no es de esta venta', l->>'id'; end if;
        rehacer := ol.cantidad <> (l->>'cantidad')::numeric or ol.variante_id is distinct from (l->>'variante_id')::uuid;
        update venta_lineas set variante_id = (l->>'variante_id')::uuid, producto_id = coalesce((l->>'producto_id')::uuid, producto_id), descripcion = coalesce(l->>'descripcion', descripcion),
          talle = l->>'talle', color = l->>'color', cantidad = (l->>'cantidad')::numeric, precio_lista = coalesce((l->>'precio_lista')::numeric, precio_lista),
          precio_unit = coalesce((l->>'precio_unit')::numeric, precio_unit), descuento_pct = coalesce((l->>'descuento_pct')::numeric, descuento_pct),
          total = coalesce((l->>'total')::numeric, total), costo_unit = coalesce((l->>'costo_unit')::numeric, costo_unit)
        where id = ol.id;
        if rehacer then
          -- mismo producto, solo cambió la cantidad y la línea ya tenía movimientos: se escalan (sirve para kits con modelos elegidos)
          if ol.variante_id is not distinct from (l->>'variante_id')::uuid and not coalesce(jsonb_typeof(l->'componentes') = 'array' and jsonb_array_length(l->'componentes') > 0, false)
             and exists (select 1 from stock_movimientos where linea_id = ol.id) then
            factor := (l->>'cantidad')::numeric / ol.cantidad;
            for m in select variante_id, deposito_id, cantidad from stock_movimientos where linea_id = ol.id loop
              insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id, linea_id)
              values (v.empresa_id, m.variante_id, m.deposito_id, round(m.cantidad * factor, 3) - m.cantidad, 'ajuste', v.id::text, 'Edición venta #' || v.numero || ' · cantidad ' || ol.cantidad || ' → ' || (l->>'cantidad'), auth.uid(), ol.id);
            end loop;
          else
            for m in select variante_id, deposito_id, cantidad from stock_movimientos where linea_id = ol.id loop
              insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id, linea_id)
              values (v.empresa_id, m.variante_id, m.deposito_id, -m.cantidad, 'ajuste', v.id::text, 'Edición venta #' || v.numero || ' · se cambió la prenda', auth.uid(), null);
            end loop;
            update stock_movimientos set linea_id = null where linea_id = ol.id;
            perform venta_linea_mover_stock(v.empresa_id, v.id, v.numero, ol.id, dep, l);
          end if;
          cambios := cambios || ('línea ' || ol.descripcion || ': ' || ol.cantidad || ' → ' || (l->>'cantidad'));
        end if;
        ids_nuevas := ids_nuevas || ol.id;
      else
        insert into venta_lineas (venta_id, empresa_id, variante_id, producto_id, descripcion, talle, color, cantidad, precio_lista, precio_unit, descuento_pct, promocion_id, promocion_nombre, total, costo_unit)
        values (v.id, v.empresa_id, (l->>'variante_id')::uuid, (l->>'producto_id')::uuid, l->>'descripcion', l->>'talle', l->>'color', (l->>'cantidad')::numeric,
                coalesce((l->>'precio_lista')::numeric, 0), coalesce((l->>'precio_unit')::numeric, 0), coalesce((l->>'descuento_pct')::numeric, 0),
                null, null, (l->>'total')::numeric, coalesce((l->>'costo_unit')::numeric, 0))
        returning id into nuevo_id;
        perform venta_linea_mover_stock(v.empresa_id, v.id, v.numero, nuevo_id, dep, l);
        ids_nuevas := ids_nuevas || nuevo_id; cambios := cambios || ('agregada ' || (l->>'descripcion'));
      end if;
    end loop;
    -- las que no vinieron se quitan y vuelve su stock
    for ol in select * from venta_lineas where venta_id = v.id and not (id = any(ids_nuevas)) loop
      for m in select variante_id, deposito_id, cantidad from stock_movimientos where linea_id = ol.id loop
        insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id, linea_id)
        values (v.empresa_id, m.variante_id, m.deposito_id, -m.cantidad, 'ajuste', v.id::text, 'Edición venta #' || v.numero || ' · quitada ' || ol.descripcion, auth.uid(), null);
      end loop;
      update stock_movimientos set linea_id = null where linea_id = ol.id;
      delete from venta_lineas where id = ol.id;
      cambios := cambios || ('quitada ' || ol.descripcion);
    end loop;
    if not exists (select 1 from venta_lineas where venta_id = v.id) then raise exception 'La venta tiene que quedar con al menos una prenda'; end if;
  end if;

  -- pagos (los de crédito / gift card se conservan)
  if jsonb_typeof(p->'pagos') = 'array' then
    delete from venta_pagos where venta_id = v.id and credito_id is null;
    for pg in select * from jsonb_array_elements(p->'pagos') loop
      if coalesce((pg->>'monto')::numeric, 0) = 0 then continue; end if;
      insert into venta_pagos (venta_id, empresa_id, turno_id, forma_pago_id, monto, cuotas, recargo_pct, referencia, fecha)
      values (v.id, v.empresa_id, v.turno_id, (pg->>'forma_pago_id')::uuid, (pg->>'monto')::numeric, coalesce((pg->>'cuotas')::int, 1), coalesce((pg->>'recargo_pct')::numeric, 0), pg->>'referencia', v.fecha);
    end loop;
  end if;

  -- totales
  select coalesce(sum(total), 0), coalesce(sum(costo_unit * cantidad), 0) into v_sub, v_costo from venta_lineas where venta_id = v.id;
  v_desc := coalesce(v.descuento, 0); v_rec := coalesce(v.recargo, 0); v_total := round(v_sub - v_desc + v_rec, 2);
  select coalesce(sum(monto), 0) into v_pagado from venta_pagos where venta_id = v.id;
  select coalesce(sum(monto), 0) into v_cred from creditos where origen_venta_id = v.id and tipo = 'nota_credito' and estado <> 'anulado';
  v_pagado := v_pagado - v_cred;
  if v.estado = 'completada' and abs(v_pagado - v_total) > 0.5 then raise exception 'Los pagos (%) no coinciden con el total (%)', v_pagado, v_total; end if;
  update ventas set fecha = v.fecha, origen = v.origen, vendedora_id = v.vendedora_id, cliente_id = v.cliente_id, referencia = v.referencia, nota = v.nota,
    descuento_pct = v.descuento_pct, descuento = v_desc, recargo = v_rec, subtotal = v_sub, total = v_total, pagado = v_pagado, saldo = round(v_total - v_pagado, 2), costo = v_costo
  where id = v.id;
  return jsonb_build_object('id', v.id, 'numero', v.numero, 'total', v_total, 'cambios', to_jsonb(cambios));
end $$;

-- Lista para elegir vendedora en Ventas (miembros activos de la empresa, sin visores)
create or replace view v_vendedoras with (security_invoker = true) as
select empresa_id, user_id, nombre, rol from empresa_usuarios where activo and rol <> 'visor';

select numero, origen, (select count(*) from venta_lineas l where l.venta_id = v.id) lineas,
       (select count(*) from stock_movimientos m where m.referencia = v.id::text and m.linea_id is not null) con_linea,
       (select count(*) from stock_movimientos m where m.referencia = v.id::text and m.linea_id is null) sin_linea
from ventas v order by numero;
