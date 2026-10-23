-- 029 · Filtros para kits y genéricos (pedido de Diego 22/10):
--   · un componente de kit puede ser un FILTRO ("medias, menos las de red y las con liga") en vez de un producto fijo
--   · un genérico (BOMBIS VARIAS) también puede decir qué incluye y qué no, para que el POS muestre solo lo que corresponde
--   filtro = {"categoria_id": uuid|null, "incluye": ["MEDIAS"], "excluye": ["RED","CON LIGA"], "defecto_producto_id": uuid|null}
--   defecto_producto_id: de dónde se descuenta si nadie eligió (pedidos de Tienda Nube) — normalmente la bolsa genérica.

alter table producto_componentes add column if not exists filtro jsonb;
alter table producto_componentes drop constraint if exists componente_algo;
alter table producto_componentes add constraint componente_algo check (variante_id is not null or componente_producto_id is not null or filtro is not null);
drop index if exists producto_componentes_unico;
alter table productos add column if not exists generico_filtro jsonb;

-- productos que cumplen un filtro (activos, prendas, ni genéricos ni kits)
create or replace function filtro_productos(e uuid, f jsonb) returns setof uuid
language sql stable security invoker set search_path = public as $$
  select p.id from productos p
  where p.empresa_id = e and p.activo and p.tipo = 'prenda' and not p.es_generico
    and (f->>'categoria_id' is null or p.categoria_id = (f->>'categoria_id')::uuid)
    and not exists (select 1 from jsonb_array_elements_text(coalesce(f->'incluye', '[]'::jsonb)) w where btrim(w) <> '' and p.nombre not ilike '%' || btrim(w) || '%')
    and not exists (select 1 from jsonb_array_elements_text(coalesce(f->'excluye', '[]'::jsonb)) w where btrim(w) <> '' and p.nombre ilike '%' || btrim(w) || '%');
$$;
create or replace function filtro_cuenta(e uuid, f jsonb) returns int
language sql stable security invoker set search_path = public as $$ select count(*)::int from filtro_productos(e, f); $$;

create or replace function stock_kit(p uuid) returns numeric
language sql stable security invoker set search_path = public as $$
  select coalesce(min(floor(
    case when pc.variante_id is not null then coalesce((select sum(s.cantidad) from stock s where s.variante_id = pc.variante_id), 0)
         when pc.componente_producto_id is not null then coalesce((select sum(s.cantidad) from stock s join variantes v on v.id = s.variante_id where v.producto_id = pc.componente_producto_id and v.activa), 0)
         else coalesce((select sum(s.cantidad) from stock s join variantes v on v.id = s.variante_id where v.activa and v.producto_id in (select filtro_productos(pc.empresa_id, pc.filtro))), 0)
              + coalesce((select sum(s.cantidad) from stock s join variantes v on v.id = s.variante_id where v.activa and v.producto_id = (pc.filtro->>'defecto_producto_id')::uuid), 0) end / pc.cantidad)), 0)
  from producto_componentes pc where pc.producto_id = p;
$$;
create or replace function costo_kit(p uuid) returns numeric
language sql stable security invoker set search_path = public as $$
  select coalesce(sum(pc.cantidad * case when pc.variante_id is not null then coalesce(v.costo, pr.costo, 0) when pc.componente_producto_id is not null then coalesce(pp.costo, 0) else coalesce(pd.costo, 0) end), 0)
  from producto_componentes pc left join variantes v on v.id = pc.variante_id left join productos pr on pr.id = v.producto_id
  left join productos pp on pp.id = pc.componente_producto_id left join productos pd on pd.id = (pc.filtro->>'defecto_producto_id')::uuid
  where pc.producto_id = p;
$$;

drop view if exists v_componentes;
create view v_componentes with (security_invoker = true) as
select pc.id, pc.empresa_id, pc.producto_id, pc.variante_id, pc.componente_producto_id, pc.filtro, pc.cantidad,
       coalesce(pp.id, pv.id, (pc.filtro->>'defecto_producto_id')::uuid) comp_producto_id, coalesce(pp.codigo, pv.codigo) comp_codigo,
       case when pc.filtro is not null then 'Filtro: ' || coalesce((select nombre from categorias where id = (pc.filtro->>'categoria_id')::uuid), 'todo el catálogo')
              || coalesce(' · con ' || nullif(array_to_string(array(select jsonb_array_elements_text(coalesce(pc.filtro->'incluye', '[]'::jsonb))), ', '), ''), '')
              || coalesce(' · sin ' || nullif(array_to_string(array(select jsonb_array_elements_text(coalesce(pc.filtro->'excluye', '[]'::jsonb))), ', '), ''), '')
            else coalesce(pp.nombre, pv.nombre) end comp_nombre,
       coalesce(pp.es_generico, pv.es_generico, false) comp_generico,
       t.nombre talle_nombre, co.nombre color_nombre,
       case when pc.variante_id is not null then coalesce((select sum(s.cantidad) from stock s where s.variante_id = pc.variante_id), 0)
            when pc.componente_producto_id is not null then coalesce((select sum(s.cantidad) from stock s join variantes v2 on v2.id = s.variante_id where v2.producto_id = pc.componente_producto_id and v2.activa), 0)
            else coalesce((select sum(s.cantidad) from stock s join variantes v2 on v2.id = s.variante_id where v2.activa and v2.producto_id in (select filtro_productos(pc.empresa_id, pc.filtro))), 0) end stock,
       case when pc.variante_id is not null then coalesce(v.costo, pv.costo, 0) when pc.componente_producto_id is not null then coalesce(pp.costo, 0) else coalesce(pd.costo, 0) end costo,
       case when pc.filtro is not null then filtro_cuenta(pc.empresa_id, pc.filtro) end productos_filtro
from producto_componentes pc
left join variantes v on v.id = pc.variante_id left join productos pv on pv.id = v.producto_id
left join productos pp on pp.id = pc.componente_producto_id
left join productos pd on pd.id = (pc.filtro->>'defecto_producto_id')::uuid
left join atributos t on t.id = v.talle_id left join atributos co on co.id = v.color_id;

-- registrar venta: componente por filtro sin elegir → se descuenta del producto por defecto (si lo hay)
create or replace function caja_registrar_venta(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e uuid := (p->>'empresa_id')::uuid;
  v_id uuid; v_num bigint; l jsonb; pg jsonb; cr jsonb; comp record; c jsonb; v_comp uuid;
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
      if jsonb_typeof(l->'componentes') = 'array' and jsonb_array_length(l->'componentes') > 0 then
        for c in select * from jsonb_array_elements(l->'componentes') loop
          insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
          values (e, (c->>'variante_id')::uuid, dep, -(sign((l->>'cantidad')::numeric) * (c->>'cantidad')::numeric), case when (l->>'cantidad')::numeric < 0 then 'devolucion' else 'venta' end, v_id::text, 'Venta #' || v_num || ' · kit ' || (l->>'descripcion'), auth.uid());
        end loop;
      else
        for comp in select variante_id, componente_producto_id, filtro, cantidad from producto_componentes where producto_id = (l->>'producto_id')::uuid loop
          v_comp := coalesce(comp.variante_id,
                             case when comp.componente_producto_id is not null then variante_indefinida(comp.componente_producto_id) end,
                             case when comp.filtro->>'defecto_producto_id' is not null then variante_indefinida((comp.filtro->>'defecto_producto_id')::uuid) end);
          if v_comp is not null then
            insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
            values (e, v_comp, dep, -((l->>'cantidad')::numeric * comp.cantidad), case when (l->>'cantidad')::numeric < 0 then 'devolucion' else 'venta' end, v_id::text, 'Venta #' || v_num || ' · kit ' || (l->>'descripcion') || case when comp.variante_id is null then ' (sin definir)' else '' end, auth.uid());
          end if;
        end loop;
      end if;
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
    creditos_out := creditos_out || jsonb_build_object('tipo', cr->>'tipo', 'codigo', codigo, 'monto', (cr->>'monto')::numeric);
  end loop;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'creditos', creditos_out);
end $$;

-- el componente repetido del «BOX MA» (Diego probó agregar la variante exacta) → afuera
delete from producto_componentes where id = 16;

-- arranque: «BOX MA» lleva "medias" por filtro (sin red, sin liga, sin can can, sin térmicas); BOMBIS VARIAS = bombachas sin packs
update producto_componentes pc set componente_producto_id = null,
  filtro = jsonb_build_object('categoria_id', (select id from categorias where nombre = 'ACCESORIOS' and empresa_id = pc.empresa_id), 'incluye', '["MEDIAS"]'::jsonb, 'excluye', '["RED","CON LIGA","CAN CAN","TÉRMICAS","REGALO","VARIAS"]'::jsonb, 'defecto_producto_id', (select id from productos where codigo = '900203'))
where componente_producto_id = (select id from productos where codigo = '900203');
update productos set generico_filtro = jsonb_build_object('categoria_id', categoria_id, 'incluye', '[]'::jsonb, 'excluye', '["PACK","REGALO"]'::jsonb) where codigo = '100200';
update productos set generico_filtro = jsonb_build_object('categoria_id', categoria_id, 'incluye', '["MEDIAS"]'::jsonb, 'excluye', '["RED","CON LIGA","CAN CAN","TÉRMICAS","REGALO","VARIAS"]'::jsonb) where codigo = '900203';

select p.codigo, p.nombre, stock_kit(p.id) disponible, (select string_agg(comp_nombre || ' ×' || cantidad::int || coalesce(' (' || productos_filtro || ' productos)', ''), ' + ') from v_componentes vc where vc.producto_id = p.id) lleva
from productos p where p.tipo = 'kit' and p.activo order by p.codigo;
