-- 119 · Corregir un remito ya ingresado (11/11/2026, Diego: "deberías permitirme modificar remitos de compra, porque a veces nos
-- podemos confundir; en ese caso el sistema debería corregir el stock de acuerdo a los cambios").
-- compras_corregir(p): mismo formato que compras_ingresar (proveedor, remito, fecha, descuento, renglones) + motivo.
--   · STOCK: solo la diferencia por talle y color (lo que se sacó, resta; lo que se agregó, suma). Queda en el historial de cada
--     prenda como «Corrección de la compra #N». La web se entera sola (cola de stock).
--   · COSTO: si cambió el costo de un renglón, la prenda toma el nuevo (con el descuento), salvo que después haya entrado otra
--     compra de esa prenda (manda la más nueva).
--   · CUENTA DEL PROVEEDOR: se asienta la diferencia (si cambió de proveedor, sale de uno y entra al otro). Solo si la compra
--     había sumado a la cuenta.
--   · Si se sacan todos los renglones, la compra queda anulada (y todo vuelve atrás).
--   · Queda registrada en compra_recepciones (qué cambió, quién y por qué).
create or replace function compras_corregir(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e uuid := (p->>'empresa_id')::uuid; c compras%rowtype; dep uuid; prov uuid := (p->>'proveedor_id')::uuid;
  dsc numeric := coalesce((p->>'descuento_pct')::numeric, 0); mot text := nullif(trim(p->>'motivo'), '');
  r record; sub numeric; tot numeric; hubo_deuda boolean; ya boolean := false; cambios jsonb := '[]'::jsonb; costos jsonb := '[]'::jsonb; n_lin int;
  txt text;
begin
  if not es_miembro(e) or not puede(e, 'compras') then raise exception 'No tenés permiso para corregir compras'; end if;
  select * into c from compras where id = (p->>'id')::uuid and empresa_id = e for update;
  if c.id is null then raise exception 'Compra inexistente'; end if;
  if c.estado <> 'recibida' then raise exception 'Solo se corrigen compras ya ingresadas al stock'; end if;
  dep := coalesce(c.deposito_id, (select id from depositos where empresa_id = e and principal limit 1));
  txt := 'Corrección de la compra #' || c.numero || coalesce(' · ' || mot, '');

  -- lo nuevo, por talle y color
  create temp table _nuevo on commit drop as
    select (l->>'variante_id')::uuid variante_id, (array_agg((l->>'producto_id')::uuid))[1] producto_id, (array_agg(l->>'descripcion'))[1] descripcion,
           (array_agg(l->>'talle'))[1] talle, (array_agg(l->>'color'))[1] color, sum((l->>'pedida')::numeric) cant,
           max((l->>'costo_unit')::numeric) costo_unit, (array_agg(nullif(trim(l->>'articulo_prov'), '')))[1] articulo_prov
    from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) l
    where l->>'variante_id' is not null and coalesce((l->>'pedida')::numeric, 0) > 0 group by 1;
  create temp table _viejo on commit drop as
    select variante_id, max(producto_id::text)::uuid producto_id, sum(recibida) cant, max(costo_unit) costo_unit
    from compra_lineas where compra_id = c.id and variante_id is not null group by 1;

  -- 1) stock: solo la diferencia
  for r in select coalesce(n.variante_id, v.variante_id) vid, coalesce(n.cant, 0) - coalesce(v.cant, 0) dif
           from _nuevo n full join _viejo v on v.variante_id = n.variante_id loop
    if r.dif <> 0 then
      insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, motivo, user_id)
      values (e, r.vid, dep, r.dif, 'compra', c.id::text, txt, 'Corrección de compra', auth.uid());
      cambios := cambios || jsonb_build_object('variante_id', r.vid, 'dif', r.dif);
    end if;
  end loop;

  -- 2) costo: la prenda toma el costo corregido (con descuento) si cambió y si no entró después otra compra de esa prenda
  if coalesce((p->>'actualizar_costos')::boolean, true) then
    for r in select n.producto_id, max(n.costo_unit) cu from _nuevo n group by 1 loop
      if r.cu > 0
         and (r.cu is distinct from (select max(costo_unit) from _viejo where producto_id = r.producto_id) or dsc is distinct from c.descuento_pct)
         and not exists (select 1 from compra_lineas l join compras k on k.id = l.compra_id
                         where l.producto_id = r.producto_id and k.id <> c.id and k.empresa_id = e and k.numero > c.numero and l.recibida > 0) then
        update productos set costo = round(r.cu * (1 - dsc / 100), 2) where id = r.producto_id and costo is distinct from round(r.cu * (1 - dsc / 100), 2);
        update variantes set costo = null where producto_id = r.producto_id and id in (select variante_id from _nuevo) and costo is not null;
        costos := costos || jsonb_build_object('producto_id', r.producto_id, 'costo', round(r.cu * (1 - dsc / 100), 2));
      end if;
    end loop;
  end if;

  -- 3) los renglones de la compra, como quedaron (todo recibido)
  delete from compra_lineas where compra_id = c.id;
  insert into compra_lineas (compra_id, empresa_id, variante_id, producto_id, descripcion, talle, color, pedida, recibida, costo_unit, total, articulo_prov)
  select c.id, e, variante_id, producto_id, descripcion, talle, color, cant, cant, costo_unit, round(cant * costo_unit, 2), articulo_prov from _nuevo;
  select count(*), coalesce(sum(round(cant * costo_unit, 2)), 0) into n_lin, sub from _nuevo;
  tot := round(sub * (1 - dsc / 100), 2);
  update compras set proveedor_id = prov, referencia = p->>'referencia', fecha = coalesce((p->>'fecha')::date, fecha), descuento_pct = dsc,
         subtotal = sub, total = tot, nota = coalesce(p->>'nota', nota), estado = case when n_lin = 0 then 'anulada' else 'recibida' end, modificado = now()
   where id = c.id;

  -- 4) cuenta del proveedor: la diferencia (solo si la compra había sumado a la cuenta)
  hubo_deuda := exists (select 1 from proveedor_movimientos where compra_id = c.id and tipo = 'compra');
  if hubo_deuda then
    for r in select proveedor_id, sum(monto) s from proveedor_movimientos where compra_id = c.id and tipo = 'compra' group by 1 loop
      if r.proveedor_id is not distinct from prov then
        ya := true;
        if tot - r.s <> 0 then insert into proveedor_movimientos (empresa_id, proveedor_id, tipo, monto, compra_id, referencia, nota, user_id)
                               values (e, prov, 'compra', tot - r.s, c.id, p->>'referencia', txt, auth.uid()); end if;
      elsif r.s <> 0 then
        insert into proveedor_movimientos (empresa_id, proveedor_id, tipo, monto, compra_id, referencia, nota, user_id)
        values (e, r.proveedor_id, 'compra', -r.s, c.id, c.referencia, txt || ' (pasó a otro proveedor)', auth.uid());
      end if;
    end loop;
    if not ya and prov is not null and tot <> 0 then
      insert into proveedor_movimientos (empresa_id, proveedor_id, tipo, monto, compra_id, referencia, nota, user_id)
      values (e, prov, 'compra', tot, c.id, p->>'referencia', txt, auth.uid());
    end if;
  end if;

  -- 5) Percha sigue aprendiendo cómo llama el proveedor a cada prenda
  if prov is not null then
    insert into proveedor_articulos as pa (empresa_id, proveedor_id, texto, texto_original, producto_id, color_id, costo)
    select distinct on (texto_prov(n.articulo_prov)) e, prov, texto_prov(n.articulo_prov), n.articulo_prov, n.producto_id, (select color_id from variantes where id = n.variante_id), n.costo_unit
    from _nuevo n where texto_prov(n.articulo_prov) <> ''
    order by texto_prov(n.articulo_prov)
    on conflict (proveedor_id, texto) do update set producto_id = excluded.producto_id, color_id = excluded.color_id, costo = excluded.costo,
      texto_original = excluded.texto_original, actualizado = now();
  end if;

  -- 6) queda registrado
  insert into compra_recepciones (compra_id, empresa_id, detalle, nota)
  values (c.id, e, jsonb_build_object('correccion', true, 'stock', cambios, 'costos', costos, 'total_antes', c.total, 'total_ahora', tot, 'por', auth.uid()), txt);

  return jsonb_build_object('id', c.id, 'numero', c.numero, 'cambios', jsonb_array_length(cambios), 'costos', jsonb_array_length(costos),
    'total_antes', c.total, 'total', tot, 'estado', case when n_lin = 0 then 'anulada' else 'recibida' end);
end $$;

grant execute on function compras_corregir(jsonb) to authenticated;
