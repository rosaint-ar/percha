-- 026 · Kits v2: un componente puede ser una variante exacta (como antes) o "cualquier variante de un producto"
--   ([PACK x3] LESS «ALDI» = 3 × LESS «ALDI» del color que elija la clienta; «BOX MA» = 1 × PIJAMA «CIELO» + 1 × MEDIAS VARIAS).
--   · stock del kit = mín( stock del componente / cantidad ); para un producto, su stock total.
--   · al vender, el POS pregunta qué variantes se lleva (misma ventana que los genéricos) y las manda en la línea (`componentes`);
--     si no se definió (p.ej. pedido de Tienda Nube), se descuenta de la variante "sin definir" del producto y el Conteo lo acomoda después.
--   · los packs/box/combos existentes se convierten en kits; su stock propio pasa a los componentes (a "sin definir").

alter table producto_componentes alter column variante_id drop not null;
alter table producto_componentes add column if not exists componente_producto_id uuid references productos(id) on delete restrict;
alter table producto_componentes drop constraint if exists producto_componentes_producto_id_variante_id_key;
alter table producto_componentes drop constraint if exists componente_algo;
alter table producto_componentes add constraint componente_algo check (variante_id is not null or componente_producto_id is not null);
create unique index if not exists producto_componentes_unico on producto_componentes (producto_id, coalesce(variante_id, componente_producto_id));

create or replace function stock_kit(p uuid) returns numeric
language sql stable security invoker set search_path = public as $$
  select coalesce(min(floor(
    case when pc.variante_id is not null then coalesce((select sum(s.cantidad) from stock s where s.variante_id = pc.variante_id), 0)
         else coalesce((select sum(s.cantidad) from stock s join variantes v on v.id = s.variante_id where v.producto_id = pc.componente_producto_id and v.activa), 0) end / pc.cantidad)), 0)
  from producto_componentes pc where pc.producto_id = p;
$$;
create or replace function costo_kit(p uuid) returns numeric
language sql stable security invoker set search_path = public as $$
  select coalesce(sum(pc.cantidad * case when pc.variante_id is not null then coalesce(v.costo, pr.costo, 0) else coalesce(pp.costo, 0) end), 0)
  from producto_componentes pc left join variantes v on v.id = pc.variante_id left join productos pr on pr.id = v.producto_id left join productos pp on pp.id = pc.componente_producto_id
  where pc.producto_id = p;
$$;

-- la variante "sin definir" de un producto (sin talle ni color): donde cae lo que todavía no se eligió
create or replace function variante_indefinida(p_producto uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; pr productos%rowtype;
begin
  select id into v from variantes where producto_id = p_producto and talle_id is null and color_id is null and estampa_id is null order by activa desc limit 1;
  if v is null then
    select * into pr from productos where id = p_producto;
    insert into variantes (empresa_id, producto_id, sku, activa) values (pr.empresa_id, p_producto, pr.codigo || '-SD', true) returning id into v;
  else
    update variantes set activa = true where id = v and not activa;
  end if;
  return v;
end $$;

-- registrar venta: los kits descuentan lo elegido (l.componentes) o, si no hay, la tabla (variante exacta o "sin definir" del producto)
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
        -- lo que eligió la vendedora: cantidades por el total de kits de la línea
        for c in select * from jsonb_array_elements(l->'componentes') loop
          insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
          values (e, (c->>'variante_id')::uuid, dep, -(sign((l->>'cantidad')::numeric) * (c->>'cantidad')::numeric), case when (l->>'cantidad')::numeric < 0 then 'devolucion' else 'venta' end, v_id::text, 'Venta #' || v_num || ' · kit ' || (l->>'descripcion'), auth.uid());
        end loop;
      else
        for comp in select variante_id, componente_producto_id, cantidad from producto_componentes where producto_id = (l->>'producto_id')::uuid loop
          v_comp := coalesce(comp.variante_id, variante_indefinida(comp.componente_producto_id));
          insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
          values (e, v_comp, dep, -((l->>'cantidad')::numeric * comp.cantidad), case when (l->>'cantidad')::numeric < 0 then 'devolucion' else 'venta' end, v_id::text, 'Venta #' || v_num || ' · kit ' || (l->>'descripcion') || case when comp.variante_id is null then ' (sin definir)' else '' end, auth.uid());
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

-- vista de componentes con nombre, para la ficha y el POS
drop view if exists v_componentes;
create view v_componentes with (security_invoker = true) as
select pc.id, pc.empresa_id, pc.producto_id, pc.variante_id, pc.componente_producto_id, pc.cantidad,
       coalesce(pp.id, pv.id) comp_producto_id, coalesce(pp.codigo, pv.codigo) comp_codigo, coalesce(pp.nombre, pv.nombre) comp_nombre, coalesce(pp.es_generico, pv.es_generico) comp_generico,
       t.nombre talle_nombre, co.nombre color_nombre,
       case when pc.variante_id is not null then coalesce((select sum(s.cantidad) from stock s where s.variante_id = pc.variante_id), 0)
            else coalesce((select sum(s.cantidad) from stock s join variantes v2 on v2.id = s.variante_id where v2.producto_id = pc.componente_producto_id and v2.activa), 0) end stock,
       case when pc.variante_id is not null then coalesce(v.costo, pv.costo, 0) else coalesce(pp.costo, 0) end costo
from producto_componentes pc
left join variantes v on v.id = pc.variante_id left join productos pv on pv.id = v.producto_id
left join productos pp on pp.id = pc.componente_producto_id
left join atributos t on t.id = v.talle_id left join atributos co on co.id = v.color_id;

-- convertir un producto existente (pack/box/combo con stock propio) en kit por productos
create or replace function kit_armar(p_kit_codigo text, p_componentes jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare k productos%rowtype; c jsonb; comp productos%rowtype; st numeric; dep uuid; v_ind uuid; v_kit uuid; faltan text := '';
begin
  select * into k from productos where codigo = p_kit_codigo;
  if k.id is null then return p_kit_codigo || ': no existe'; end if;
  for c in select * from jsonb_array_elements(p_componentes) loop
    select * into comp from productos where empresa_id = k.empresa_id and (codigo = c->>'codigo' or (c->>'nombre' is not null and lower(nombre) = lower(c->>'nombre'))) and id <> k.id limit 1;
    if comp.id is null then faltan := faltan || ' · ' || coalesce(c->>'codigo', c->>'nombre'); continue; end if;
    insert into producto_componentes (empresa_id, producto_id, componente_producto_id, cantidad) values (k.empresa_id, k.id, comp.id, coalesce((c->>'cantidad')::numeric, 1))
    on conflict do nothing;
  end loop;
  if faltan <> '' then return p_kit_codigo || ': falta' || faltan; end if;
  dep := (select id from depositos where empresa_id = k.empresa_id and principal limit 1);
  -- el stock propio del pack pasa a los componentes (a "sin definir")
  st := coalesce((select sum(s.cantidad) from stock s join variantes v on v.id = s.variante_id where v.producto_id = k.id), 0);
  if st > 0 then
    for c in select jsonb_build_object('pid', pc.componente_producto_id, 'cant', pc.cantidad) from producto_componentes pc where pc.producto_id = k.id and pc.componente_producto_id is not null loop
      v_ind := variante_indefinida((c->>'pid')::uuid);
      insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (k.empresa_id, v_ind, dep, st * (c->>'cant')::numeric, 'ajuste', 'Desarmado de ' || k.nombre || ' (' || st || ' packs)');
    end loop;
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota)
    select k.empresa_id, s.variante_id, s.deposito_id, -s.cantidad, 'ajuste', 'Pasa a kit: el stock va a los componentes' from stock s join variantes v on v.id = s.variante_id where v.producto_id = k.id and s.cantidad <> 0;
  end if;
  -- el kit queda con una sola variante (sin talle ni color) para la venta; las demás se apagan
  select id into v_kit from variantes where producto_id = k.id order by (talle_id is null and color_id is null) desc, activa desc limit 1;
  update variantes set activa = false where producto_id = k.id and id <> v_kit;
  update variantes set talle_id = null, color_id = null, activa = true where id = v_kit and not exists (select 1 from variantes w where w.producto_id = k.id and w.id <> v_kit and w.talle_id is null and w.color_id is null);
  update productos set tipo = 'kit', tiene_variantes = false where id = k.id;
  return p_kit_codigo || ' → kit (' || (select count(*) from producto_componentes where producto_id = k.id) || ' comp., ' || st || ' desarmados)';
end $$;

-- packs de bombachas: "[PACK x3] X" = 3 × "X"; "[PACK x7] X" = 7 × "X"
do $$
declare r record; n int; base text; res text;
begin
  for r in select p.codigo, p.nombre from productos p join categorias c on c.id = p.categoria_id where c.nombre = 'BOMBACHAS' and p.tipo = 'prenda' and p.nombre ~ '^(\[PACK x\d+\]|PACK X\d+)\s' loop
    n := substring(r.nombre from '^\[?PACK [xX](\d+)\]?')::int;
    base := btrim(regexp_replace(r.nombre, '^(\[PACK x\d+\]|PACK X\d+)\s+', ''));
    res := kit_armar(r.codigo, jsonb_build_array(jsonb_build_object('nombre', base, 'cantidad', n)));
    raise notice '%', res;
  end loop;
end $$;
select kit_armar('100300', '[{"codigo":"100200","cantidad":3}]');
select kit_armar('100500', '[{"codigo":"100200","cantidad":7}]');
select kit_armar('500245', '[{"codigo":"500123","cantidad":1},{"codigo":"900203","cantidad":1}]');
select kit_armar('500246', '[{"codigo":"500124","cantidad":1},{"codigo":"900203","cantidad":1}]');
select kit_armar('500239', '[{"codigo":"500120","cantidad":2}]');
select kit_armar('910107', '[{"codigo":"910108","cantidad":2}]');

select p.codigo, p.nombre, p.tipo, stock_kit(p.id) disponible, (select string_agg(comp_nombre || ' ×' || cantidad, ' + ') from v_componentes vc where vc.producto_id = p.id) lleva
from productos p where p.tipo = 'kit' order by p.codigo;
