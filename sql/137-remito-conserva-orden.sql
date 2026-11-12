-- 12/11 (Diego): «cuando cargo un remito me desacomoda las líneas». Los renglones guardan el orden en que se cargaron:
-- columna orden (el lugar en el remito). Antes, al CORREGIR un remito ingresado, se reinsertaban agrupados por variante
-- (orden al azar) y lo recibido se actualizaba en su lugar viejo mientras lo nuevo iba al final.
alter table compra_lineas add column if not exists orden int;
update compra_lineas l set orden = x.n from (select id, row_number() over (partition by compra_id order by id) n from compra_lineas) x where x.id = l.id and l.orden is null;

CREATE OR REPLACE FUNCTION public.compras_guardar(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e uuid := (p->>'empresa_id')::uuid; c_id uuid := (p->>'id')::uuid; l jsonb; sub numeric := 0; tot numeric; num bigint; est text; prov uuid := (p->>'proveedor_id')::uuid; k bigint;
begin
  if not es_miembro(e) or not puede(e, 'compras') then raise exception 'No tenés permiso para cargar compras'; end if;
  for l in select * from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) loop
    sub := sub + round((l->>'pedida')::numeric * (l->>'costo_unit')::numeric, 2);
  end loop;
  tot := round(sub * (1 - coalesce((p->>'descuento_pct')::numeric, 0) / 100), 2);
  if c_id is null then
    num := proximo_numero(e, 'compra');
    insert into compras (empresa_id, numero, proveedor_id, deposito_id, estado, fecha, entrega_estimada, referencia, subtotal, descuento_pct, total, nota, creado_por)
    values (e, num, prov, (p->>'deposito_id')::uuid, coalesce(p->>'estado', 'borrador'), coalesce((p->>'fecha')::date, current_date), (p->>'entrega_estimada')::date, p->>'referencia', sub, coalesce((p->>'descuento_pct')::numeric, 0), tot, p->>'nota', auth.uid())
    returning id into c_id;
  else
    select estado into est from compras where id = c_id and empresa_id = e;
    if est is null then raise exception 'Compra inexistente'; end if;
    if est in ('recibida', 'anulada') then raise exception 'Esta compra ya está cerrada'; end if;
    update compras set proveedor_id = prov, deposito_id = (p->>'deposito_id')::uuid, estado = coalesce(p->>'estado', estado), fecha = coalesce((p->>'fecha')::date, fecha), entrega_estimada = (p->>'entrega_estimada')::date, referencia = p->>'referencia', subtotal = sub, descuento_pct = coalesce((p->>'descuento_pct')::numeric, 0), total = tot, nota = p->>'nota', modificado = now() where id = c_id;
    -- las líneas se reemplazan, conservando lo ya recibido por variante
    delete from compra_lineas where compra_id = c_id and recibida = 0;
  end if;
  for l, k in select x, n from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) with ordinality t(x, n) loop
    if exists (select 1 from compra_lineas where compra_id = c_id and variante_id = (l->>'variante_id')::uuid and recibida > 0) then
      update compra_lineas set pedida = greatest((l->>'pedida')::numeric, recibida), costo_unit = (l->>'costo_unit')::numeric, total = round(greatest((l->>'pedida')::numeric, recibida) * (l->>'costo_unit')::numeric, 2), articulo_prov = nullif(trim(l->>'articulo_prov'), ''), orden = k
      where compra_id = c_id and variante_id = (l->>'variante_id')::uuid;
    else
      insert into compra_lineas (compra_id, empresa_id, variante_id, producto_id, descripcion, talle, color, pedida, costo_unit, total, articulo_prov, orden)
      values (c_id, e, (l->>'variante_id')::uuid, (l->>'producto_id')::uuid, l->>'descripcion', l->>'talle', l->>'color', (l->>'pedida')::numeric, (l->>'costo_unit')::numeric, round((l->>'pedida')::numeric * (l->>'costo_unit')::numeric, 2), nullif(trim(l->>'articulo_prov'), ''), k);
    end if;
  end loop;
  -- Percha aprende cómo llama este proveedor a cada prenda (una vez por nombre, aunque venga en varios talles)
  if prov is not null then
    insert into proveedor_articulos as pa (empresa_id, proveedor_id, texto, texto_original, producto_id, color_id, costo)
    -- se aprende solo si ese nombre del proveedor es UNA prenda (el color, solo si es uno): con «¿Qué modelos son?» el mismo
    -- nombre trae varios modelos y antes aprendía uno al azar ("BOMBIS SURTIDAS" → CATHERINE Negro)
    select e, prov, z.t, z.o, z.prod, case when z.nc = 1 then z.col end, z.costo from (
      select texto_prov(x.j->>'articulo_prov') t, min(trim(x.j->>'articulo_prov')) o, min(x.j->>'producto_id')::uuid prod, count(distinct x.j->>'producto_id') np,
        count(distinct v.color_id) nc, min(v.color_id::text)::uuid col, max((x.j->>'costo_unit')::numeric) costo
      from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) x(j) left join variantes v on v.id = (x.j->>'variante_id')::uuid
      where texto_prov(x.j->>'articulo_prov') <> '' and x.j->>'producto_id' is not null
      group by 1) z where z.np = 1
    on conflict (proveedor_id, texto) do update set producto_id = excluded.producto_id, color_id = excluded.color_id, costo = excluded.costo,
      texto_original = excluded.texto_original, veces = pa.veces + 1, actualizado = now();
  end if;
  return jsonb_build_object('id', c_id, 'numero', (select numero from compras where id = c_id), 'total', tot);
end $function$;

CREATE OR REPLACE FUNCTION public.compras_corregir(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           max((l->>'costo_unit')::numeric) costo_unit, (array_agg(nullif(trim(l->>'articulo_prov'), '')))[1] articulo_prov, min(ord) ord
    from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) with ordinality t(l, ord)
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
  insert into compra_lineas (compra_id, empresa_id, variante_id, producto_id, descripcion, talle, color, pedida, recibida, costo_unit, total, articulo_prov, orden)
  select c.id, e, variante_id, producto_id, descripcion, talle, color, cant, cant, costo_unit, round(cant * costo_unit, 2), articulo_prov, ord from _nuevo order by ord;
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
    select e, prov, z.t, z.o, z.prod, case when z.nc = 1 then z.col end, z.costo from (   -- solo si el nombre es UNA prenda (ver compras_guardar)
      select texto_prov(n.articulo_prov) t, min(n.articulo_prov) o, min(n.producto_id::text)::uuid prod, count(distinct n.producto_id) np,
        count(distinct v.color_id) nc, min(v.color_id::text)::uuid col, max(n.costo_unit) costo
      from _nuevo n left join variantes v on v.id = n.variante_id where texto_prov(n.articulo_prov) <> '' group by 1) z where z.np = 1
    on conflict (proveedor_id, texto) do update set producto_id = excluded.producto_id, color_id = excluded.color_id, costo = excluded.costo,
      texto_original = excluded.texto_original, actualizado = now();
  end if;

  -- 6) queda registrado
  insert into compra_recepciones (compra_id, empresa_id, detalle, nota)
  values (c.id, e, jsonb_build_object('correccion', true, 'stock', cambios, 'costos', costos, 'total_antes', c.total, 'total_ahora', tot, 'por', auth.uid()), txt);

  return jsonb_build_object('id', c.id, 'numero', c.numero, 'cambios', jsonb_array_length(cambios), 'costos', jsonb_array_length(costos),
    'total_antes', c.total, 'total', tot, 'estado', case when n_lin = 0 then 'anulada' else 'recibida' end);
end $function$;
