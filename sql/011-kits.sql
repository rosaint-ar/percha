-- Percha · kits (box, combos): un producto armado con otras variantes. No tiene stock propio:
-- su disponible es el mínimo de sus componentes y al venderlo se descuentan los componentes.

create table if not exists producto_componentes (
  id          bigserial primary key,
  empresa_id  uuid not null references empresas(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade,   -- el kit
  variante_id uuid not null references variantes(id) on delete restrict,  -- el componente
  cantidad    numeric(12,3) not null default 1 check (cantidad > 0),
  unique (producto_id, variante_id)
);
alter table producto_componentes enable row level security;
drop policy if exists componentes_ver on producto_componentes; create policy componentes_ver on producto_componentes for select using (es_miembro(empresa_id));
drop policy if exists componentes_admin on producto_componentes; create policy componentes_admin on producto_componentes for all using (es_admin(empresa_id)) with check (es_admin(empresa_id));

-- Stock disponible de un kit = mínimo de (stock del componente / cantidad que lleva)
create or replace function stock_kit(p uuid) returns numeric
language sql stable security invoker set search_path = public as $$
  select coalesce(min(floor(coalesce((select sum(s.cantidad) from stock s where s.variante_id = pc.variante_id), 0) / pc.cantidad)), 0)
  from producto_componentes pc where pc.producto_id = p;
$$;
create or replace function costo_kit(p uuid) returns numeric
language sql stable security invoker set search_path = public as $$
  select coalesce(sum(pc.cantidad * coalesce(v.costo, pr.costo, 0)), 0)
  from producto_componentes pc join variantes v on v.id = pc.variante_id join productos pr on pr.id = v.producto_id
  where pc.producto_id = p;
$$;

-- Las vistas de variantes y productos pasan a conocer los kits
drop view if exists v_cruce_canal; drop view if exists v_variantes_sin_canal; drop view if exists v_variantes;
create view v_variantes with (security_invoker = true) as
select v.id, v.empresa_id, v.producto_id, p.codigo as producto_codigo, p.nombre as producto_nombre, p.tipo as producto_tipo,
       v.sku, v.ean, v.activa,
       t.codigo as talle, t.nombre as talle_nombre, t.orden as talle_orden,
       c.codigo as color, c.nombre as color_nombre, c.hex as color_hex,
       e.codigo as estampa, e.nombre as estampa_nombre,
       case when p.tipo = 'kit' then costo_kit(p.id) else coalesce(v.costo, p.costo) end as costo,
       coalesce(v.precio, p.precio) as precio,
       case when p.tipo = 'kit' then stock_kit(p.id) else coalesce((select sum(s.cantidad) from stock s where s.variante_id = v.id), 0) end as stock
from variantes v
join productos p on p.id = v.producto_id
left join atributos t on t.id = v.talle_id
left join atributos c on c.id = v.color_id
left join atributos e on e.id = v.estampa_id;

create view v_variantes_sin_canal with (security_invoker = true) as
select v.*, c.id as conexion_id
from v_variantes v cross join conexiones c
where c.empresa_id = v.empresa_id and c.estado = 'activa' and v.activa
  and not exists (select 1 from canal_items ci where ci.conexion_id = c.id and ci.variante_id = v.id);

create view v_cruce_canal with (security_invoker = true) as
select ci.*, cx.canal, cx.nombre as conexion_nombre,
       v.sku as sku_percha, v.ean as ean_percha, v.producto_nombre as producto_percha, v.producto_tipo, v.talle_nombre, v.color_nombre,
       v.precio as precio_percha, v.stock as stock_percha,
       g.n_canal as variantes_canal_mismo_item, g.stock_canal_grupo,
       case when ci.variante_id is null then 'sin_cruzar'
            when ci.stock is null then 'sin_control'
            when g.stock_canal_grupo = v.stock then 'igual'
            else 'distinto' end as estado_stock
from canal_items ci
join conexiones cx on cx.id = ci.conexion_id
left join v_variantes v on v.id = ci.variante_id
left join (select conexion_id, variante_id, count(*) n_canal, sum(stock) stock_canal_grupo from canal_items where variante_id is not null group by conexion_id, variante_id) g
  on g.conexion_id = ci.conexion_id and g.variante_id = ci.variante_id;

drop view if exists v_productos;
create view v_productos with (security_invoker = true) as
select p.*, cat.nombre as categoria, pr.nombre as proveedor,
       (select count(*) from variantes v where v.producto_id = p.id and v.activa) as variantes,
       case when p.tipo = 'kit' then stock_kit(p.id)
            else coalesce((select sum(s.cantidad) from stock s join variantes v on v.id = s.variante_id where v.producto_id = p.id), 0) end as stock
from productos p
left join categorias cat on cat.id = p.categoria_id
left join proveedores pr on pr.id = p.proveedor_id;

-- La venta de un kit descuenta sus componentes (y la anulación los devuelve)
create or replace function caja_registrar_venta(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e uuid := (p->>'empresa_id')::uuid;
  v_id uuid; v_num bigint; l jsonb; pg jsonb; cr jsonb; comp record;
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
  insert into ventas (empresa_id, numero, tipo, estado, caja_id, turno_id, cliente_id, vendedora_id, lista_id, subtotal, descuento_pct, descuento, recargo, total, pagado, saldo, costo, venta_origen_id, origen, referencia, nota, offline_id, creado_por)
  values (e, v_num, v_tipo, v_estado, (p->>'caja_id')::uuid, (p->>'turno_id')::uuid, (p->>'cliente_id')::uuid, coalesce((p->>'vendedora_id')::uuid, auth.uid()), (p->>'lista_id')::uuid,
          v_sub, coalesce((p->>'descuento_pct')::numeric, 0), v_desc, v_rec, v_total, v_pagado, round(v_total - v_pagado, 2), v_costo,
          (p->>'venta_origen_id')::uuid, coalesce(p->>'origen', 'local'), p->>'referencia', p->>'nota', (p->>'offline_id')::uuid, auth.uid())
  returning id into v_id;
  for l in select * from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) loop
    insert into venta_lineas (venta_id, empresa_id, variante_id, producto_id, descripcion, talle, color, cantidad, precio_lista, precio_unit, descuento_pct, promocion_id, promocion_nombre, total, costo_unit)
    values (v_id, e, (l->>'variante_id')::uuid, (l->>'producto_id')::uuid, l->>'descripcion', l->>'talle', l->>'color', (l->>'cantidad')::numeric,
            coalesce((l->>'precio_lista')::numeric, 0), coalesce((l->>'precio_unit')::numeric, 0), coalesce((l->>'descuento_pct')::numeric, 0),
            (l->>'promocion_id')::uuid, l->>'promocion_nombre', (l->>'total')::numeric, coalesce((l->>'costo_unit')::numeric, 0));
    select tipo into tipo_prod from productos where id = (l->>'producto_id')::uuid;
    if tipo_prod = 'kit' then
      for comp in select variante_id, cantidad from producto_componentes where producto_id = (l->>'producto_id')::uuid loop
        insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
        values (e, comp.variante_id, dep, -((l->>'cantidad')::numeric * comp.cantidad), case when (l->>'cantidad')::numeric < 0 then 'devolucion' else 'venta' end, v_id::text, 'Venta #' || v_num || ' · kit ' || (l->>'descripcion'), auth.uid());
      end loop;
    elsif l->>'variante_id' is not null then
      insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
      values (e, (l->>'variante_id')::uuid, dep, -((l->>'cantidad')::numeric), case when (l->>'cantidad')::numeric < 0 then 'devolucion' else 'venta' end, v_id::text, 'Venta #' || v_num, auth.uid());
    end if;
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
    creditos_out := creditos_out || jsonb_build_object('codigo', codigo, 'tipo', cr->>'tipo', 'monto', (cr->>'monto')::numeric);
  end loop;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'total', v_total, 'creditos', creditos_out);
end $$;

create or replace function caja_anular_venta(p_venta uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v ventas%rowtype; l record; dep uuid; m record;
begin
  select * into v from ventas where id = p_venta for update;
  if v.id is null or not es_miembro(v.empresa_id) then raise exception 'Venta inexistente'; end if;
  if not es_admin(v.empresa_id) and v.creado_por <> auth.uid() then raise exception 'Solo administración puede anular ventas de otra persona'; end if;
  if v.estado = 'anulada' then raise exception 'Ya estaba anulada'; end if;
  -- se revierte exactamente cada movimiento de stock que generó la venta (sirve para kits y para prendas sueltas)
  for m in select * from stock_movimientos where referencia = v.id::text and tipo in ('venta','devolucion') loop
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
    values (v.empresa_id, m.variante_id, m.deposito_id, -m.cantidad, 'ajuste', v.id::text, 'Anulación venta #' || v.numero, auth.uid());
  end loop;
  update creditos c set saldo = c.saldo + vp.monto, estado = 'vigente' from venta_pagos vp where vp.venta_id = v.id and vp.credito_id = c.id;
  update creditos set estado = 'anulado' where origen_venta_id = v.id and saldo = monto;
  update ventas set estado = 'anulada', anulada_por = auth.uid(), anulada_fecha = now(), anulada_motivo = p_motivo where id = v.id;
end $$;
