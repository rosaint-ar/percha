-- 120 · Números de venta consecutivos + web cruzada con el modelo y no con el código general (11/11, pedido de Diego)
-- 1) Venta #70 de Emi el 10/11, cuando ya iba por la 94: su caja tenía guardado el número 70 desde fines de octubre
--    (se reserva al abrir el punto de venta para verlo en el ticket) y lo usó semanas después. Regla nueva:
--    · el número guardado vale solo si nadie vendió uno más alto mientras tanto;
--    · si no, se toma el más bajo reservado y libre después de la última venta (no quedan huecos), o uno nuevo;
--    · las ventas de la web usan el mismo criterio (antes salteaban el número que mostraba la caja).
-- 2) Pendiente de la venta #95 (web, MEDIAS SOQUETE ALTO «FUNNY» Smile): la publicación estaba cruzada con MEDIAS VARIAS
--    (comparten el código 900203) aunque el modelo existe en Percha. Se recruzan con el modelo las publicaciones cuyo
--    nombre es exactamente el de un modelo y el color/talle coincide con una sola variante (74). Quedan 8 en el código
--    general (5 de LESS «MARINA» XXXL con colores duplicados en Percha y 3 de FUNNY sin ese color en Percha).
--    tn-sync ya no vuelve a cruzarlas con el código general (busca el modelo por nombre).
--    El cambio de cruce pasa por el trigger de "stock a decidir": si web y Percha no coinciden, pregunta (no pisa).
begin;

create or replace function venta_numero_tomar(e uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare n bigint; ult bigint;
begin
  select coalesce(max(numero), 0) into ult from ventas where empresa_id = e and numero < 1000000;
  select numero into n from venta_numeros where empresa_id = e and usado is null and numero > ult
    and not exists (select 1 from ventas v where v.empresa_id = e and v.numero = venta_numeros.numero)
    order by numero limit 1 for update skip locked;
  if n is not null then update venta_numeros set usado = now() where empresa_id = e and numero = n; return n; end if;
  n := proximo_numero(e, 'venta');
  insert into venta_numeros (empresa_id, numero, usado) values (e, n, now());
  return n;
end $$;
revoke all on function venta_numero_tomar(uuid) from public, anon, authenticated;

create or replace function venta_numero_reservar(e uuid, p_actual bigint default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare n bigint; ult bigint;
begin
  if not es_miembro(e) or not puede(e, 'vender') then raise exception 'Sin permiso'; end if;
  select coalesce(max(numero), 0) into ult from ventas where empresa_id = e and numero < 1000000;
  -- el que el equipo ya tenía, si sigue libre y nadie vendió uno más alto
  if p_actual is not null and p_actual > ult and exists (select 1 from venta_numeros where empresa_id = e and numero = p_actual and usado is null) then return p_actual; end if;
  -- el más bajo reservado y libre después de la última venta (si otra caja lo muestra también, el primero que cobra se lo queda)
  select min(numero) into n from venta_numeros where empresa_id = e and usado is null and numero > ult;
  if n is not null then return n; end if;
  n := proximo_numero(e, 'venta');
  insert into venta_numeros (empresa_id, numero) values (e, n);
  return n;
end $$;
revoke all on function venta_numero_reservar(uuid, bigint) from anon;
grant execute on function venta_numero_reservar(uuid, bigint) to authenticated;

CREATE OR REPLACE FUNCTION public.caja_registrar_venta(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e uuid := (p->>'empresa_id')::uuid;
  v_id uuid; v_num bigint; v_lin bigint; l jsonb; pg jsonb; cr jsonb; comp record; c jsonb; v_comp uuid;
  v_sub numeric := 0; v_costo numeric := 0; v_pagado numeric := 0; v_total numeric; v_desc numeric; v_rec numeric;
  v_estado text := coalesce(p->>'estado', 'completada'); v_tipo text := coalesce(p->>'tipo', 'venta');
  es_res boolean := coalesce((p->>'reservada')::boolean, false); auto_res boolean := false; dep uuid; cred creditos%rowtype; codigo text; creditos_out jsonb := '[]'::jsonb; existente uuid; tipo_prod text; cid uuid;
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
  -- (apagado salvo que la empresa lo prenda: empresas.config->>'efectivo_a_reservadas' = 'true'; pedido de Diego 28/10)
  -- pagada 100% en efectivo → va a la vista reservada (se factura distinto y no se lista en la vista normal)
  if not es_res and v_tipo = 'venta' and v_estado = 'completada' and v_total > 0 and jsonb_array_length(coalesce(p->'pagos', '[]'::jsonb)) > 0
     and coalesce((select (config->>'efectivo_a_reservadas')::boolean from empresas where id = e), false)
     and not exists (select 1 from jsonb_array_elements(p->'pagos') x left join formas_pago f on f.id = nullif(x->>'forma_pago_id', '')::uuid
                     where nullif(x->>'credito_id', '') is not null or coalesce(f.grupo, '') <> 'efectivo') then
    es_res := true; auto_res := true;   -- queda en el turno: el efectivo está en el cajón
  end if;
  if v_estado = 'senada' and v_pagado <= 0 then raise exception 'Una seña necesita un pago a cuenta'; end if;
  -- el número que se reservó al empezar la venta (se ve en el ticket mientras se arma); si ya se usó o no estaba reservado, el que sigue
  -- número consecutivo: el que se mostró en el ticket, si nadie vendió uno más alto mientras tanto; si no, el que sigue (venta_numero_tomar)
  if not es_res and nullif(p->>'numero', '') is not null
     and not exists (select 1 from ventas where empresa_id = e and numero >= (p->>'numero')::bigint and numero < 1000000) then
    update venta_numeros set usado = now() where empresa_id = e and numero = (p->>'numero')::bigint and usado is null
    returning numero into v_num;
  end if;
  if v_num is null then v_num := case when es_res then 1000000 + proximo_numero(e, 'r') else venta_numero_tomar(e) end; end if;
  insert into ventas (empresa_id, numero, tipo, estado, fecha, caja_id, turno_id, cliente_id, vendedora_id, lista_id, subtotal, descuento_pct, descuento, recargo, total, pagado, saldo, costo, venta_origen_id, origen, referencia, nota, offline_id, creado_por, reservada)
  values (e, v_num, v_tipo, v_estado, coalesce((p->>'fecha')::timestamptz, now()), case when es_res and not auto_res then null else (p->>'caja_id')::uuid end, case when es_res and not auto_res then null else (p->>'turno_id')::uuid end, (p->>'cliente_id')::uuid, coalesce((p->>'vendedora_id')::uuid, auth.uid()), (p->>'lista_id')::uuid,
          v_sub, coalesce((p->>'descuento_pct')::numeric, 0), v_desc, v_rec, v_total, v_pagado, round(v_total - v_pagado, 2), v_costo,
          (p->>'venta_origen_id')::uuid, coalesce(p->>'origen', 'local'), p->>'referencia', p->>'nota', (p->>'offline_id')::uuid, auth.uid(), es_res)
  returning id into v_id;
  -- entrega (envío): medio, costo, dirección y contacto; queda pendiente de despachar
  if jsonb_typeof(p->'envio') = 'object' then
    update ventas set envio_metodo_id = nullif(p->'envio'->>'metodo_id', '')::uuid, envio_metodo = nullif(p->'envio'->>'metodo', ''), envio_costo = nullif(p->'envio'->>'costo', '')::numeric,
      envio_direccion = nullif(p->'envio'->>'direccion', ''), envio_contacto = nullif(p->'envio'->>'contacto', ''), envio_estado = 'pendiente', envio_actualizado = now()
    where id = v_id;
  end if;
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
    values (v_id, e, case when es_res and not auto_res then null else (p->>'turno_id')::uuid end, (pg->>'forma_pago_id')::uuid, (pg->>'credito_id')::uuid, (pg->>'monto')::numeric, coalesce((pg->>'cuotas')::int, 1), coalesce((pg->>'recargo_pct')::numeric, 0), pg->>'referencia');
    if pg->>'credito_id' is not null then
      select * into cred from creditos where id = (pg->>'credito_id')::uuid and empresa_id = e for update;
      if cred.id is null or cred.estado <> 'vigente' then raise exception 'El crédito no está vigente'; end if;
      if cred.saldo < coalesce((pg->>'consumo')::numeric, (pg->>'monto')::numeric) - 0.01 or coalesce((pg->>'consumo')::numeric, (pg->>'monto')::numeric) < 0 then raise exception 'El crédito no tiene saldo suficiente'; end if;
      update creditos set saldo = round(saldo - coalesce((pg->>'consumo')::numeric, (pg->>'monto')::numeric), 2), estado = case when round(saldo - coalesce((pg->>'consumo')::numeric, (pg->>'monto')::numeric), 2) <= 0 then 'usado' else 'vigente' end where id = cred.id;
    end if;
  end loop;
  for cr in select * from jsonb_array_elements(coalesce(p->'creditos_a_emitir', '[]'::jsonb)) loop
    -- el código: el que eligió quien vende (gift card) o uno al azar
    codigo := credito_codigo_valido(e, cr->>'codigo');
    insert into creditos (empresa_id, tipo, codigo, cliente_id, origen_venta_id, monto, saldo, vence, nota, lista_id, dedicatoria)
    values (e, cr->>'tipo', codigo, (cr->>'cliente_id')::uuid, v_id, (cr->>'monto')::numeric, (cr->>'monto')::numeric, (cr->>'vence')::date, cr->>'nota', (select id from listas_precios where id = nullif(cr->>'lista_id', '')::uuid and empresa_id = e), nullif(cr->'dedicatoria', 'null'::jsonb))
    returning id into cid;
    creditos_out := creditos_out || jsonb_build_object('id', cid, 'tipo', cr->>'tipo', 'codigo', codigo, 'monto', (cr->>'monto')::numeric, 'lista_id', nullif(cr->>'lista_id', ''), 'dedicatoria', cr->'dedicatoria', 'lista', (select nombre from listas_precios where id = nullif(cr->>'lista_id', '')::uuid and empresa_id = e));
  end loop;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'creditos', creditos_out, 'reservada', es_res, 'numero_mostrar', case when es_res then 'R-' || lpad((v_num - 1000000)::text, 6, '0') end);
end $function$;

-- 2) publicaciones de la web cruzadas con un código general cuando el modelo existe (mismo nombre, color/talle único)
with x as (
  select ci.id ci_id, trim(split_part(ci.valores, '/', 1)) col_txt, ci.talle_canal, p.id pid
  from canal_items ci join variantes v on v.id = ci.variante_id join productos g on g.id = v.producto_id and g.es_generico
  join productos p on p.empresa_id = ci.empresa_id and p.activo and not p.es_generico and upper(p.nombre) = upper(ci.nombre)
  where ci.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43'),
m as (
  select x.ci_id, (select array_agg(vv.id) from v_variantes vv where vv.producto_id = x.pid and vv.activa and lower(vv.color_nombre) = lower(x.col_txt)
     and (vv.talle_nombre is null or lower(vv.talle_nombre) = lower(coalesce(x.talle_canal, '')))) cands from x)
update canal_items ci set variante_id = m.cands[1], cruce = 'manual'
from m where m.ci_id = ci.id and cardinality(m.cands) = 1
  and not exists (select 1 from canal_items c2 where c2.variante_id = m.cands[1]);

commit;
