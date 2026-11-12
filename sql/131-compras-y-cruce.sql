-- 131 · Relevamiento 12/11: compras y cruce con la web
-- · compras_recibir: no entra más de lo que falta de cada renglón (doble confirmación = stock dos veces).
-- · atributo_desde_canal: primero busca el talle/color que ya existe (activo, XXL = 2XL); los rangos «S al L» ya no se
--   toman como "talle único" (son de la escala Bombachas); código nuevo que no choca con ninguno.
-- · canal_crear_variante usa atributo_desde_canal (antes: otro color con el mismo código, o un talle apagado).
-- · canal_vincular_item: solo talles/colores activos.
begin;
CREATE OR REPLACE FUNCTION public.compras_recibir(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.atributo_desde_canal(e uuid, p_tipo text, p_nombre text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare a_id uuid; cod text; base text; nom text; k int := 2;
begin
  nom := nullif(btrim(coalesce(p_nombre, '')), '');
  if nom is null then return null; end if;
  -- 1) el que ya existe con ese nombre (activo; para talles XXL = 2XL), prefiriendo el que está en una escala
  select id into a_id from atributos where empresa_id = e and tipo = p_tipo and activo
    and (lower(nombre) = lower(nom) or lower(codigo) = lower(nom) or (p_tipo = 'talle' and talle_norm(nombre) = talle_norm(nom)))
    order by (escala_id is not null) desc, orden limit 1;
  if a_id is not null then return a_id; end if;
  -- 2) "Único (S al XL)" / "Talle único" = sin talle (los rangos "S al L" ya NO: son talles de la escala Bombachas)
  if p_tipo = 'talle' and (nom ~* '^[uú]nic[oa]' or nom ~* '^talle [uú]nico') then return null; end if;
  -- 3) nuevo, con un código que no choque con ninguno (tampoco con los apagados)
  base := upper(left(regexp_replace(translate(nom, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN'), '[^A-Za-z0-9]', '', 'g'), case when p_tipo = 'talle' then 8 else 3 end));
  if base = '' then base := upper(left(p_tipo, 1)); end if;
  cod := base;
  while exists (select 1 from atributos where empresa_id = e and tipo = p_tipo and codigo = cod) loop cod := base || '-' || k; k := k + 1; end loop;
  insert into atributos (empresa_id, tipo, codigo, nombre, orden) values (e, p_tipo, cod, nom, 999) returning id into a_id;
  return a_id;
end $function$;

CREATE OR REPLACE FUNCTION public.canal_crear_variante(p_item bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare it canal_items%rowtype; prod productos%rowtype; e uuid; t_id uuid; c_id uuid; v_id uuid; unica variantes%rowtype; dep uuid; st numeric; cod text; vact variantes%rowtype;
begin
  select * into it from canal_items where id = p_item;
  if it.id is null or not es_admin(it.empresa_id) then raise exception 'Sin permiso'; end if;
  e := it.empresa_id;
  if it.variante_id is not null then
    select * into vact from variantes where id = it.variante_id;
    if vact.talle_id is not null or vact.color_id is not null or vact.estampa_id is not null then raise exception 'Ya está cruzada a una variante con talle/color'; end if;
    select * into prod from productos where id = vact.producto_id;
  else
    select * into prod from productos where empresa_id = e and codigo = coalesce(it.sku, it.mpn);
  end if;
  if prod.id is null then raise exception 'El producto % no existe en Percha: crealo primero', coalesce(it.sku, it.mpn); end if;
  dep := (select id from depositos where empresa_id = e and principal limit 1);
  -- talle y color: los mismos que usa todo Percha (antes podía devolver otro color con el mismo código, o un talle apagado)
  t_id := atributo_desde_canal(e, 'talle', it.talle_canal);
  c_id := atributo_desde_canal(e, 'color', it.color_canal);
  if t_id is null and c_id is null then raise exception 'La variante del canal no tiene talle ni color: cruzala a mano'; end if;
  select id into v_id from variantes where producto_id = prod.id and talle_id is not distinct from t_id and color_id is not distinct from c_id and estampa_id is null;
  if v_id is null then
    insert into variantes (empresa_id, producto_id, talle_id, color_id, sku, ean)
    values (e, prod.id, t_id, c_id, prod.codigo || '-' || coalesce((select codigo from atributos where id = t_id), '') || '-' || coalesce((select codigo from atributos where id = c_id), ''), it.barcode)
    returning id into v_id;
    select * into unica from variantes where producto_id = prod.id and talle_id is null and color_id is null and estampa_id is null and activa limit 1;
    if unica.id is not null then
      st := coalesce(it.stock, 0);
      if st > 0 then
        insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (e, v_id, dep, st, 'ajuste', 'Variante creada desde ' || it.nombre || ' (' || coalesce(it.valores, '') || '): toma el stock del canal');
        insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) select e, unica.id, dep, -least(st, coalesce(sum(s.cantidad), 0)), 'ajuste', 'Pasa a la variante ' || coalesce(it.valores, '') from stock s where s.variante_id = unica.id having coalesce(sum(s.cantidad), 0) > 0;
      end if;
    end if;
    update productos set tiene_variantes = true where id = prod.id;
  end if;
  update canal_items set variante_id = v_id, cruce = 'manual' where id = it.id;
  if unica.id is not null and coalesce((select sum(cantidad) from stock where variante_id = unica.id), 0) <= 0
     and not exists (select 1 from canal_items where variante_id = unica.id and id <> it.id) then
    update variantes set activa = false where id = unica.id;
  end if;
  return jsonb_build_object('variante_id', v_id, 'creada', true);
end $function$;

CREATE OR REPLACE FUNCTION public.canal_vincular_item(p_item bigint, p_sku text, p_talle text, p_color text, p_stock numeric, p_nota text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ci canal_items%rowtype; pr record; t_id uuid; c_id uuid; v_id uuid; nueva boolean := false; reactivada boolean := false;
        actual numeric; aplicar boolean; dep uuid; fam text;
begin
  select * into ci from canal_items where id = p_item;
  select p.id, p.empresa_id, p.codigo, cat.codigo fam into pr from productos p left join categorias cat on cat.id = p.categoria_id where p.empresa_id = ci.empresa_id and p.codigo = p_sku;
  if pr.id is null then return jsonb_build_object('item', p_item, 'error', 'no existe el producto ' || p_sku); end if;
  if p_talle is not null then
    select id into t_id from atributos where empresa_id = pr.empresa_id and tipo = 'talle' and activo and (lower(nombre) = lower(p_talle) or talle_norm(nombre) = talle_norm(p_talle)) order by (escala_id is not null) desc, orden limit 1;
    if t_id is null then t_id := atributo_desde_canal(pr.empresa_id, 'talle', p_talle); end if;
  end if;
  if p_color is not null then
    select id into c_id from atributos where empresa_id = pr.empresa_id and tipo = 'color' and activo and lower(nombre) = lower(p_color) order by orden limit 1;
    if c_id is null then c_id := atributo_desde_canal(pr.empresa_id, 'color', p_color); end if;
  end if;
  select id into v_id from variantes where producto_id = pr.id and talle_id is not distinct from t_id and color_id is not distinct from c_id and estampa_id is null;
  if v_id is null then
    insert into variantes (empresa_id, producto_id, talle_id, color_id, sku)
    values (pr.empresa_id, pr.id, t_id, c_id, pr.codigo || coalesce('-' || (select codigo from atributos where id = t_id), '') || coalesce('-' || (select codigo from atributos where id = c_id), ''))
    returning id into v_id; nueva := true;
  elsif not (select activa from variantes where id = v_id) then
    update variantes set activa = true where id = v_id; reactivada := true;
  end if;
  update canal_items set variante_id = v_id, stock = coalesce(p_stock, stock), actualizado = now() where id = p_item;
  select coalesce(sum(cantidad), 0) into actual from stock where variante_id = v_id;
  aplicar := pr.fam = '20' or nueva;
  if aplicar and p_stock is not null and p_stock <> actual then
    dep := (select id from depositos where empresa_id = pr.empresa_id and principal limit 1);
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
    values (pr.empresa_id, v_id, dep, p_stock - actual, 'ajuste', 'recuento-2026-10-23', p_nota, '5f43c17d-958a-4ef7-badc-1a4001a20747');
  end if;
  return jsonb_build_object('item', p_item, 'sku', p_sku, 'talle', p_talle, 'color', p_color, 'tn', p_stock, 'percha_antes', actual,
    'accion', case when nueva then 'creada' when reactivada then 'reactivada' else 'vinculada' end,
    'stock', case when not aplicar then case when p_stock is distinct from actual then 'pendiente (familia sin contar)' else 'igual' end
                  when p_stock is distinct from actual then 'ajustado' else 'igual' end);
end $function$;
commit;
