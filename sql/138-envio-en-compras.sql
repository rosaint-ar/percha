-- 12/11 (Diego): ENVÍO / FLETE en la compra, como costo en destino.
-- · compras.envio (monto) + envio_proveedor (si lo cobra el proveedor, va a su cuenta).
-- · Se reparte proporcional al costo con descuento de cada renglón: compra_lineas.envio_unit (por unidad).
-- · Al ingresar: productos.costo = costo del proveedor con descuento + envío; la parte del envío queda como CAPA en
--   productos.costo_envio (márgenes y rentabilidad la incluyen). La sugerencia al volver a comprar sigue saliendo de
--   compra_lineas.costo_unit / proveedor_articulos.costo = precio del proveedor SIN envío.
-- · Si alguien cambia el costo a mano (ficha, importación), la capa se borra sola (ya no se sabe qué parte es envío).
alter table compras add column if not exists envio numeric(14,2) not null default 0;
alter table compras add column if not exists envio_proveedor boolean not null default false;
alter table compra_lineas add column if not exists envio_unit numeric(14,2) not null default 0;
alter table productos add column if not exists costo_envio numeric(14,2);

create or replace function compra_repartir_envio(c_id uuid) returns numeric
language plpgsql security definer set search_path = public as $$
declare c compras%rowtype; base numeric; f numeric := 0;
begin
  select * into c from compras where id = c_id;
  if c.id is null then return 0; end if;
  select sum(pedida * costo_unit * (1 - coalesce(c.descuento_pct, 0) / 100)) into base from compra_lineas where compra_id = c_id;
  if coalesce(c.envio, 0) > 0 and coalesce(base, 0) > 0 then f := c.envio / base; end if;
  update compra_lineas set envio_unit = round(costo_unit * (1 - coalesce(c.descuento_pct, 0) / 100) * f, 2)
   where compra_id = c_id and envio_unit is distinct from round(costo_unit * (1 - coalesce(c.descuento_pct, 0) / 100) * f, 2);
  return f;
end $$;
revoke execute on function compra_repartir_envio(uuid) from public, anon, authenticated;
grant execute on function compra_repartir_envio(uuid) to service_role;

-- el costo cambiado a mano: la capa del envío ya no corresponde
create or replace function trg_productos_capa_envio() returns trigger language plpgsql as $$
begin
  if new.costo is distinct from old.costo and new.costo_envio is not distinct from old.costo_envio
     and coalesce(current_setting('percha.capa_envio', true), '') <> '1' then
    new.costo_envio := null;
  end if;
  return new;
end $$;
drop trigger if exists productos_capa_envio on productos;
create trigger productos_capa_envio before update of costo on productos for each row execute function trg_productos_capa_envio();

create or replace view v_compras as
SELECT c.id,
    c.empresa_id,
    c.numero,
    c.proveedor_id,
    c.deposito_id,
    c.estado,
    c.fecha,
    c.entrega_estimada,
    c.referencia,
    c.subtotal,
    c.descuento_pct,
    c.total,
    c.nota,
    c.creado_por,
    c.creado,
    c.modificado,
    pr.nombre AS proveedor,
    ( SELECT count(*) AS count
           FROM compra_lineas l
          WHERE (l.compra_id = c.id)) AS lineas,
    ( SELECT COALESCE(sum(l.pedida), (0)::numeric) AS "coalesce"
           FROM compra_lineas l
          WHERE (l.compra_id = c.id)) AS unidades,
    ( SELECT COALESCE(sum(l.recibida), (0)::numeric) AS "coalesce"
           FROM compra_lineas l
          WHERE (l.compra_id = c.id)) AS unidades_recibidas,
    c.envio,
    c.envio_proveedor
   FROM (compras c
     LEFT JOIN proveedores pr ON ((pr.id = c.proveedor_id)));

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
    insert into compras (empresa_id, numero, proveedor_id, deposito_id, estado, fecha, entrega_estimada, referencia, subtotal, descuento_pct, total, nota, creado_por, envio, envio_proveedor)
    values (e, num, prov, (p->>'deposito_id')::uuid, coalesce(p->>'estado', 'borrador'), coalesce((p->>'fecha')::date, current_date), (p->>'entrega_estimada')::date, p->>'referencia', sub, coalesce((p->>'descuento_pct')::numeric, 0), tot, p->>'nota', auth.uid(), greatest(coalesce((p->>'envio')::numeric, 0), 0), coalesce((p->>'envio_proveedor')::boolean, false))
    returning id into c_id;
  else
    select estado into est from compras where id = c_id and empresa_id = e;
    if est is null then raise exception 'Compra inexistente'; end if;
    if est in ('recibida', 'anulada') then raise exception 'Esta compra ya está cerrada'; end if;
    update compras set proveedor_id = prov, deposito_id = (p->>'deposito_id')::uuid, estado = coalesce(p->>'estado', estado), fecha = coalesce((p->>'fecha')::date, fecha), entrega_estimada = (p->>'entrega_estimada')::date, referencia = p->>'referencia', subtotal = sub, descuento_pct = coalesce((p->>'descuento_pct')::numeric, 0), total = tot, nota = p->>'nota', modificado = now(),
      envio = greatest(coalesce((p->>'envio')::numeric, 0), 0), envio_proveedor = coalesce((p->>'envio_proveedor')::boolean, false) where id = c_id;
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
  perform compra_repartir_envio(c_id);   -- el envío / flete, repartido en los renglones (sql/138)
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

CREATE OR REPLACE FUNCTION public.compras_recibir(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e uuid := (p->>'empresa_id')::uuid; c compras%rowtype; l jsonb; ln compra_lineas%rowtype; dep uuid; recibido_total numeric := 0; monto_recibido numeric := 0; pend numeric; envio_recibido numeric := 0;
begin
  if not es_miembro(e) or not puede(e, 'compras') then raise exception 'No tenés permiso para ingresar mercadería'; end if;
  select * into c from compras where id = (p->>'compra_id')::uuid and empresa_id = e for update;
  if c.id is null then raise exception 'Compra inexistente'; end if;
  if c.estado in ('recibida', 'anulada') then raise exception 'Esta compra ya está cerrada'; end if;
  perform set_config('percha.capa_envio', '1', true);   -- el trigger de productos no borra la capa del envío
  perform compra_repartir_envio(c.id);
  dep := coalesce(c.deposito_id, (select id from depositos where empresa_id = e and principal limit 1));
  for l in select * from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) loop
    if coalesce((l->>'cantidad')::numeric, 0) <= 0 then continue; end if;
    select * into ln from compra_lineas where id = (l->>'linea_id')::bigint and compra_id = c.id for update;
    envio_recibido := envio_recibido + coalesce((l->>'cantidad')::numeric, 0) * coalesce(ln.envio_unit, 0);
    -- no entra más de lo que falta (dos ventanas abiertas o doble confirmación sumaban el stock dos veces)
    if ln.id is not null and (l->>'cantidad')::numeric > ln.pedida - ln.recibida then
      raise exception 'De % ya entraron % de % (¿lo ingresaste dos veces?)', ln.descripcion, ln.recibida, ln.pedida; end if;
    if ln.id is null then raise exception 'Línea inexistente'; end if;
    update compra_lineas set recibida = recibida + (l->>'cantidad')::numeric where id = ln.id;
    if ln.variante_id is not null then
      insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
      values (e, ln.variante_id, dep, (l->>'cantidad')::numeric, 'compra', c.id::text, 'Compra #' || c.numero || coalesce(' · remito ' || c.referencia, ''), auth.uid());
      if coalesce((p->>'actualizar_costos')::boolean, true) and ln.costo_unit > 0 then
        -- el costo real: con el descuento del remito
        -- + su parte del envío / flete (costo en destino): sirve para márgenes; al volver a comprar se propone el del proveedor
        update productos set costo = round(ln.costo_unit * (1 - coalesce(c.descuento_pct, 0) / 100), 2) + coalesce(ln.envio_unit, 0),
               costo_envio = nullif(coalesce(ln.envio_unit, 0), 0) where id = ln.producto_id;
        update variantes set costo = null where id = ln.variante_id;   -- la variante vuelve a tomar el costo del producto
      end if;
    end if;
    recibido_total := recibido_total + (l->>'cantidad')::numeric;
    monto_recibido := monto_recibido + round((l->>'cantidad')::numeric * ln.costo_unit, 2);
  end loop;
  if recibido_total = 0 then raise exception 'No se indicó ninguna cantidad'; end if;
  insert into compra_recepciones (compra_id, empresa_id, detalle, nota) values (c.id, e, p->'lineas', p->>'nota');
  select coalesce(sum(pedida - recibida), 0) into pend from compra_lineas where compra_id = c.id;
  update compras set estado = case when pend <= 0 then 'recibida' else 'parcial' end, modificado = now() where id = c.id;
  -- la deuda con el proveedor crece con lo efectivamente recibido (con el descuento de la orden)
  if coalesce((p->>'asentar_deuda')::boolean, true) and c.proveedor_id is not null then
    insert into proveedor_movimientos (empresa_id, proveedor_id, tipo, monto, compra_id, referencia, nota, user_id)
    values (e, c.proveedor_id, 'compra', round(monto_recibido * (1 - c.descuento_pct / 100), 2) + case when c.envio_proveedor then round(envio_recibido, 2) else 0 end, c.id, c.referencia, 'Recepción compra #' || c.numero, auth.uid());
  end if;
  return jsonb_build_object('recibido', recibido_total, 'estado', case when pend <= 0 then 'recibida' else 'parcial' end);
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
  txt text; env numeric; envp boolean; base numeric; f numeric := 0; tot_cuenta numeric;
begin
  if not es_miembro(e) or not puede(e, 'compras') then raise exception 'No tenés permiso para corregir compras'; end if;
  select * into c from compras where id = (p->>'id')::uuid and empresa_id = e for update;
  if c.id is null then raise exception 'Compra inexistente'; end if;
  if c.estado <> 'recibida' then raise exception 'Solo se corrigen compras ya ingresadas al stock'; end if;
  perform set_config('percha.capa_envio', '1', true);
  env := case when p ? 'envio' then greatest(coalesce((p->>'envio')::numeric, 0), 0) else coalesce(c.envio, 0) end;
  envp := case when p ? 'envio_proveedor' then coalesce((p->>'envio_proveedor')::boolean, false) else coalesce(c.envio_proveedor, false) end;
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

  -- el envío se reparte proporcional al costo (con descuento) de lo que quedó
  select sum(cant * costo_unit * (1 - dsc / 100)) into base from _nuevo;
  if env > 0 and coalesce(base, 0) > 0 then f := env / base; end if;
  -- 2) costo: la prenda toma el costo corregido (con descuento) si cambió y si no entró después otra compra de esa prenda
  if coalesce((p->>'actualizar_costos')::boolean, true) then
    for r in select n.producto_id, max(n.costo_unit) cu from _nuevo n group by 1 loop
      if r.cu > 0
         and (r.cu is distinct from (select max(costo_unit) from _viejo where producto_id = r.producto_id) or dsc is distinct from c.descuento_pct or env is distinct from coalesce(c.envio, 0))
         and not exists (select 1 from compra_lineas l join compras k on k.id = l.compra_id
                         where l.producto_id = r.producto_id and k.id <> c.id and k.empresa_id = e and k.numero > c.numero and l.recibida > 0) then
        update productos set costo = round(r.cu * (1 - dsc / 100), 2) + round(r.cu * (1 - dsc / 100) * f, 2), costo_envio = nullif(round(r.cu * (1 - dsc / 100) * f, 2), 0)
         where id = r.producto_id and (costo, costo_envio) is distinct from (round(r.cu * (1 - dsc / 100), 2) + round(r.cu * (1 - dsc / 100) * f, 2), nullif(round(r.cu * (1 - dsc / 100) * f, 2), 0));
        update variantes set costo = null where producto_id = r.producto_id and id in (select variante_id from _nuevo) and costo is not null;
        costos := costos || jsonb_build_object('producto_id', r.producto_id, 'costo', round(r.cu * (1 - dsc / 100), 2) + round(r.cu * (1 - dsc / 100) * f, 2));
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
         subtotal = sub, total = tot, nota = coalesce(p->>'nota', nota), estado = case when n_lin = 0 then 'anulada' else 'recibida' end, modificado = now(),
         envio = case when n_lin = 0 then 0 else env end, envio_proveedor = envp
   where id = c.id;
  perform compra_repartir_envio(c.id);
  -- a la cuenta del proveedor: la mercadería y, si lo cobra él, el envío
  tot_cuenta := tot + case when envp and n_lin > 0 then env else 0 end;

  -- 4) cuenta del proveedor: la diferencia (solo si la compra había sumado a la cuenta)
  hubo_deuda := exists (select 1 from proveedor_movimientos where compra_id = c.id and tipo = 'compra');
  if hubo_deuda then
    for r in select proveedor_id, sum(monto) s from proveedor_movimientos where compra_id = c.id and tipo = 'compra' group by 1 loop
      if r.proveedor_id is not distinct from prov then
        ya := true;
        if tot_cuenta - r.s <> 0 then insert into proveedor_movimientos (empresa_id, proveedor_id, tipo, monto, compra_id, referencia, nota, user_id)
                               values (e, prov, 'compra', tot_cuenta - r.s, c.id, p->>'referencia', txt, auth.uid()); end if;
      elsif r.s <> 0 then
        insert into proveedor_movimientos (empresa_id, proveedor_id, tipo, monto, compra_id, referencia, nota, user_id)
        values (e, r.proveedor_id, 'compra', -r.s, c.id, c.referencia, txt || ' (pasó a otro proveedor)', auth.uid());
      end if;
    end loop;
    if not ya and prov is not null and tot_cuenta <> 0 then
      insert into proveedor_movimientos (empresa_id, proveedor_id, tipo, monto, compra_id, referencia, nota, user_id)
      values (e, prov, 'compra', tot_cuenta, c.id, p->>'referencia', txt, auth.uid());
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
