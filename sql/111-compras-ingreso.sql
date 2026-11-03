-- 111 · Compras: INGRESAR MERCADERÍA en un paso, como viene el remito, y Percha aprende los nombres del proveedor
-- (03/11/2026, Diego: "vamos a crear el módulo de compras en Percha, para ingresar mercadería. Tuvimos que ingresar a mano
-- porque no sabíamos desde dónde" · "los productos vienen con otro nombre desde el proveedor, Emi identifica cada producto y
-- lo carga con el nombre de Augusta").
-- · compra_lineas.articulo_prov: cómo figura en el remito ("MIA ROSA").
-- · proveedor_articulos: lo que Percha aprendió de cada proveedor ("MIA ROSA" de Concepto = PIJAMA «CIELO» Rosa). Se llena solo
--   al guardar una compra; la próxima vez, al escribir "MIA ROSA" con ese proveedor, propone la prenda y el color.
-- · compras_ingresar(p): guarda y da entrada a TODO en un solo paso (la mercadería llegó). El stock sube, la web se entera sola.
-- · compras_agregar_color(producto, color): si llega un color nuevo de una prenda, se crea ahí mismo (con sus talles).
-- · Permiso: el de "Compras" (antes pedía ser administración). El costo que queda en la prenda es con el descuento del remito.
begin;

alter table compra_lineas add column if not exists articulo_prov text;

-- el texto del proveedor, para comparar: minúsculas, sin tildes, espacios simples
create or replace function texto_prov(t text) returns text language sql immutable as $$
  select lower(regexp_replace(translate(trim(coalesce(t, '')), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'), '\s+', ' ', 'g'))
$$;

create table if not exists proveedor_articulos (
  id bigserial primary key,
  empresa_id uuid not null references empresas(id),
  proveedor_id uuid not null references proveedores(id),
  texto text not null,              -- normalizado (texto_prov)
  texto_original text,              -- como se escribió la última vez
  producto_id uuid not null references productos(id),
  color_id uuid references atributos(id),
  costo numeric,
  veces int not null default 1,
  actualizado timestamptz not null default now(),
  unique (proveedor_id, texto)
);
alter table proveedor_articulos enable row level security;
drop policy if exists proveedor_articulos_ver on proveedor_articulos;
create policy proveedor_articulos_ver on proveedor_articulos for select using (es_miembro(empresa_id) and puede(empresa_id, 'compras'));
grant select on proveedor_articulos to authenticated;

create or replace function compras_guardar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e uuid := (p->>'empresa_id')::uuid; c_id uuid := (p->>'id')::uuid; l jsonb; sub numeric := 0; tot numeric; num bigint; est text; prov uuid := (p->>'proveedor_id')::uuid;
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
  for l in select * from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) loop
    if exists (select 1 from compra_lineas where compra_id = c_id and variante_id = (l->>'variante_id')::uuid and recibida > 0) then
      update compra_lineas set pedida = greatest((l->>'pedida')::numeric, recibida), costo_unit = (l->>'costo_unit')::numeric, total = round(greatest((l->>'pedida')::numeric, recibida) * (l->>'costo_unit')::numeric, 2), articulo_prov = nullif(trim(l->>'articulo_prov'), '')
      where compra_id = c_id and variante_id = (l->>'variante_id')::uuid;
    else
      insert into compra_lineas (compra_id, empresa_id, variante_id, producto_id, descripcion, talle, color, pedida, costo_unit, total, articulo_prov)
      values (c_id, e, (l->>'variante_id')::uuid, (l->>'producto_id')::uuid, l->>'descripcion', l->>'talle', l->>'color', (l->>'pedida')::numeric, (l->>'costo_unit')::numeric, round((l->>'pedida')::numeric * (l->>'costo_unit')::numeric, 2), nullif(trim(l->>'articulo_prov'), ''));
    end if;
  end loop;
  -- Percha aprende cómo llama este proveedor a cada prenda (una vez por nombre, aunque venga en varios talles)
  if prov is not null then
    insert into proveedor_articulos as pa (empresa_id, proveedor_id, texto, texto_original, producto_id, color_id, costo)
    select distinct on (texto_prov(x.j->>'articulo_prov')) e, prov, texto_prov(x.j->>'articulo_prov'), trim(x.j->>'articulo_prov'), (x.j->>'producto_id')::uuid,
      (select color_id from variantes where id = (x.j->>'variante_id')::uuid), (x.j->>'costo_unit')::numeric
    from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) x(j)
    where texto_prov(x.j->>'articulo_prov') <> '' and x.j->>'producto_id' is not null
    order by texto_prov(x.j->>'articulo_prov')
    on conflict (proveedor_id, texto) do update set producto_id = excluded.producto_id, color_id = excluded.color_id, costo = excluded.costo,
      texto_original = excluded.texto_original, veces = pa.veces + 1, actualizado = now();
  end if;
  return jsonb_build_object('id', c_id, 'numero', (select numero from compras where id = c_id), 'total', tot);
end $$;

create or replace function compras_recibir(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e uuid := (p->>'empresa_id')::uuid; c compras%rowtype; l jsonb; ln compra_lineas%rowtype; dep uuid; recibido_total numeric := 0; monto_recibido numeric := 0; pend numeric;
begin
  if not es_miembro(e) or not puede(e, 'compras') then raise exception 'No tenés permiso para ingresar mercadería'; end if;
  select * into c from compras where id = (p->>'compra_id')::uuid and empresa_id = e for update;
  if c.id is null then raise exception 'Compra inexistente'; end if;
  if c.estado in ('recibida', 'anulada') then raise exception 'Esta compra ya está cerrada'; end if;
  dep := coalesce(c.deposito_id, (select id from depositos where empresa_id = e and principal limit 1));
  for l in select * from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) loop
    if coalesce((l->>'cantidad')::numeric, 0) <= 0 then continue; end if;
    select * into ln from compra_lineas where id = (l->>'linea_id')::bigint and compra_id = c.id for update;
    if ln.id is null then raise exception 'Línea inexistente'; end if;
    update compra_lineas set recibida = recibida + (l->>'cantidad')::numeric where id = ln.id;
    if ln.variante_id is not null then
      insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
      values (e, ln.variante_id, dep, (l->>'cantidad')::numeric, 'compra', c.id::text, 'Compra #' || c.numero || coalesce(' · remito ' || c.referencia, ''), auth.uid());
      if coalesce((p->>'actualizar_costos')::boolean, true) and ln.costo_unit > 0 then
        -- el costo real: con el descuento del remito
        update productos set costo = round(ln.costo_unit * (1 - coalesce(c.descuento_pct, 0) / 100), 2) where id = ln.producto_id;
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
    values (e, c.proveedor_id, 'compra', round(monto_recibido * (1 - c.descuento_pct / 100), 2), c.id, c.referencia, 'Recepción compra #' || c.numero, auth.uid());
  end if;
  return jsonb_build_object('recibido', recibido_total, 'estado', case when pend <= 0 then 'recibida' else 'parcial' end);
end $$;

-- llegó la mercadería: se guarda y entra TODO lo pendiente al stock, en un solo paso
create or replace function compras_ingresar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e uuid := (p->>'empresa_id')::uuid; r jsonb; lin jsonb; rec jsonb;
begin
  r := compras_guardar(p || jsonb_build_object('estado', 'pedida'));
  select jsonb_agg(jsonb_build_object('linea_id', id, 'cantidad', pedida - recibida)) into lin from compra_lineas where compra_id = (r->>'id')::uuid and pedida > recibida;
  if lin is null then raise exception 'No hay nada para ingresar'; end if;
  rec := compras_recibir(jsonb_build_object('empresa_id', e, 'compra_id', r->>'id', 'nota', p->>'nota_recepcion',
    'actualizar_costos', coalesce(p->'actualizar_costos', 'true'::jsonb), 'asentar_deuda', coalesce(p->'asentar_deuda', 'true'::jsonb), 'lineas', lin));
  return r || rec;
end $$;

create or replace function compras_anular(p_compra uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c compras%rowtype;
begin
  select * into c from compras where id = p_compra for update;
  if c.id is null or not es_miembro(c.empresa_id) or not puede(c.empresa_id, 'compras') then raise exception 'Sin permiso'; end if;
  if exists (select 1 from compra_lineas where compra_id = c.id and recibida > 0) then raise exception 'Ya se recibió mercadería de esta compra: no se puede anular'; end if;
  update compras set estado = 'anulada', modificado = now() where id = c.id;
end $$;

-- llegó un color que la prenda todavía no tiene: se crea el color (si hace falta) y la prenda en ese color, con todos sus talles
create or replace function compras_agregar_color(p_producto uuid, p_color text) returns text
language plpgsql security definer set search_path = public as $$
declare pr productos%rowtype; col atributos%rowtype; cod text; nom text := trim(p_color); t record; n int := 0;
begin
  select * into pr from productos where id = p_producto;
  if pr.id is null or not es_miembro(pr.empresa_id) or not (puede(pr.empresa_id, 'compras') or puede(pr.empresa_id, 'catalogo_editar')) then raise exception 'Sin permiso'; end if;
  if nom = '' then raise exception 'Escribí el color'; end if;
  select * into col from atributos where empresa_id = pr.empresa_id and tipo = 'color' and lower(nombre) = lower(nom) order by activo desc limit 1;
  if col.id is null then
    cod := upper(left(translate(nom, 'áéíóúñÁÉÍÓÚÑ ', 'aeiounAEIOUN'), 3));
    while exists (select 1 from atributos where empresa_id = pr.empresa_id and tipo = 'color' and codigo = cod) loop cod := upper(left(translate(nom, 'áéíóúñÁÉÍÓÚÑ ', 'aeiounAEIOUN'), 3)) || '-' || (100 + floor(random() * 900))::int; end loop;
    insert into atributos (empresa_id, tipo, codigo, nombre, activo, orden) values (pr.empresa_id, 'color', cod, nom, true, 500) returning * into col;
  elsif not col.activo then update atributos set activo = true where id = col.id;
  end if;
  for t in select distinct v.talle_id, a.codigo from variantes v left join atributos a on a.id = v.talle_id where v.producto_id = pr.id and v.activa loop
    if exists (select 1 from variantes where producto_id = pr.id and talle_id is not distinct from t.talle_id and color_id = col.id) then
      update variantes set activa = true where producto_id = pr.id and talle_id is not distinct from t.talle_id and color_id = col.id and not activa;
    else
      insert into variantes (empresa_id, producto_id, talle_id, color_id, sku) values (pr.empresa_id, pr.id, t.talle_id, col.id, concat_ws('-', pr.codigo, t.codigo, col.codigo));
      n := n + 1;
    end if;
  end loop;
  if n = 0 and not exists (select 1 from variantes where producto_id = pr.id and color_id = col.id) then
    insert into variantes (empresa_id, producto_id, color_id, sku) values (pr.empresa_id, pr.id, col.id, concat_ws('-', pr.codigo, col.codigo));
  end if;
  update productos set tiene_variantes = true where id = pr.id and not tiene_variantes;
  return col.codigo;
end $$;

grant execute on function compras_ingresar(jsonb) to authenticated;
grant execute on function compras_agregar_color(uuid, text) to authenticated;
commit;
