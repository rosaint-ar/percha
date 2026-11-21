-- 154 · El «sin talle» que sobra (21/11/2026, Diego: "cuando hay una prenda sin talle porque faltaban datos, agregamos el
-- talle que corresponde y ese sin talle queda en 0, debería desaparecer o dejarme quitarlo").
-- Caso real: LESS «KATIE» y «LOVE» Blanco. Se agregó «Único (XS al XL)», se pasó el stock y el «sin talle» quedó en 0 pero
-- prendido y CONECTADO a la web: la web seguía mirando al vacío (Blanco 0 en la web con 2 en el local) y tn-publicar iba a
-- crear otra opción «Blanco» repetida para la nueva.
--
-- · variante_sobrante_destino(v): el talle·color que hereda la conexión con la web de v. Si v no tiene talle: el único talle
--   del mismo color (prendido) que todavía no está conectado. Si v no tiene color: el único color del mismo talle. Si no hay
--   uno solo, null (no se adivina).
-- · variante_quitar(v, simular): botón «Quitar» de la ventana de la prenda. Exige stock 0; si estaba en la web la conexión
--   pasa al destino (y se manda el stock del local) o, sin destino, se avisa que esa opción se borra de la web.
-- · Solo: cuando un movimiento deja en 0 un «sin talle» que ya tiene su talle (o se crea el talle de un «sin talle» en 0),
--   se hace lo mismo sin preguntar, pero SOLO si no hay nada que adivinar (sin conexión, o con un destino claro).

create or replace function variante_sobrante_destino(p_variante uuid) returns uuid
language sql stable security definer set search_path = public as $$
  with v as (select * from variantes where id = p_variante),
  c as (
    select o.id from variantes o, v
    where o.producto_id = v.producto_id and o.id <> v.id and o.activa
      and ((v.talle_id is null and o.talle_id is not null and o.color_id is not distinct from v.color_id)
        or (v.talle_id is not null and v.color_id is null and o.talle_id = v.talle_id and o.color_id is not null))
      and not exists (select 1 from canal_items ci where ci.variante_id = o.id))
  select case when (select count(*) from c) = 1 then (select id from c) end;
$$;

-- el trabajo, sin control de permisos (lo llaman el botón, ya controlado, y el trigger)
create or replace function variante_sobrante_cerrar(p_variante uuid, p_dest uuid, p_nota text) returns int
language plpgsql security definer set search_path = public as $$
declare e uuid; n int := 0;
begin
  select empresa_id into e from variantes where id = p_variante;
  if p_dest is not null then
    update canal_items set variante_id = p_dest, cruce = 'manual' where variante_id = p_variante;
    get diagnostics n = row_count;
    if n > 0 then
      -- se movió el stock a mano en el local: vale el local (no se pregunta «¿qué vale?»)
      update canal_items set stock_a_decidir = false where variante_id = p_dest and stock_a_decidir;
      update canal_cola set estado = 'hecho', hecho = now(), error = 'pasó a otro talle·color' where variante_id = p_variante and estado = 'pendiente';
      perform encolar_canal(e, p_dest);
    end if;
  end if;
  -- apagada, no borrada: sus ventas y movimientos quedan (como al destildar en «Talles y colores»)
  update variantes set activa = false, chequear = coalesce(chequear, p_nota) where id = p_variante and activa;
  return n;
end $$;

create or replace function variante_quitar(p_variante uuid, p_simular boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v variantes%rowtype; st numeric; web int; dest uuid; dnom text; kit boolean;
begin
  select * into v from variantes where id = p_variante;
  if v.id is null then raise exception 'No se encontró ese talle·color'; end if;
  if not es_miembro(v.empresa_id) or rol_en(v.empresa_id) not in ('duenio', 'admin') then raise exception 'Solo administración saca talles o colores'; end if;
  if not v.activa then return jsonb_build_object('ok', true, 'nada', true); end if;
  st := coalesce((select sum(cantidad) from stock where variante_id = p_variante), 0);
  if st <> 0 then raise exception 'Tiene stock (%): primero pasalo al talle·color que corresponde', st; end if;
  if coalesce(v.fallas, 0) > 0 then raise exception 'Tiene prendas con falla anotadas'; end if;
  kit := exists (select 1 from producto_componentes where variante_id = p_variante);
  if kit then raise exception 'Es parte de un kit: primero cambialo en el kit'; end if;
  web := (select count(*) from canal_items where variante_id = p_variante);
  dest := case when web > 0 then variante_sobrante_destino(p_variante) end;
  select concat_ws(' · ', t.nombre, c.nombre) into dnom from variantes d left join atributos t on t.id = d.talle_id left join atributos c on c.id = d.color_id where d.id = dest;
  if p_simular then return jsonb_build_object('ok', true, 'web', web, 'pasa_a', dnom, 'se_borra_de_la_web', web > 0 and dest is null); end if;
  perform variante_sobrante_cerrar(p_variante, dest, 'Quitado a mano');
  return jsonb_build_object('ok', true, 'web', web, 'pasa_a', dnom, 'se_borra_de_la_web', web > 0 and dest is null);
end $$;
grant execute on function variante_quitar(uuid, boolean) to authenticated;
revoke execute on function variante_sobrante_cerrar(uuid, uuid, text) from public, anon, authenticated;

-- ¿v es un «sin talle» (o «sin color») que sobra? = en 0, sin fallas, no es de un kit ni genérico, y la prenda ya tiene ese
-- color con talle (o ese talle con color). Si está en la web, solo con un destino claro.
create or replace function variante_sobrante_auto(p_variante uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v variantes%rowtype; p productos%rowtype; dest uuid; web boolean;
begin
  select * into v from variantes where id = p_variante;
  if v.id is null or not v.activa or (v.talle_id is not null and v.color_id is not null) or coalesce(v.fallas, 0) > 0 then return; end if;
  if v.talle_id is null and v.color_id is null then return; end if;   -- la única de un artículo sin talles ni colores no sobra
  select * into p from productos where id = v.producto_id;
  if p.tipo <> 'prenda' or p.es_generico then return; end if;
  if coalesce((select sum(cantidad) from stock where variante_id = v.id), 0) <> 0 then return; end if;
  if exists (select 1 from producto_componentes where variante_id = v.id) then return; end if;
  if not exists (select 1 from variantes o where o.producto_id = v.producto_id and o.id <> v.id and o.activa
                 and ((v.talle_id is null and o.talle_id is not null and o.color_id is not distinct from v.color_id)
                   or (v.color_id is null and o.color_id is not null and o.talle_id is not distinct from v.talle_id))) then return; end if;
  web := exists (select 1 from canal_items where variante_id = v.id);
  dest := case when web then variante_sobrante_destino(v.id) end;
  if web and dest is null then return; end if;   -- hay que elegir a mano (botón «Quitar» o Revisión)
  perform variante_sobrante_cerrar(v.id, dest, 'Sobraba: ya tiene su talle');
end $$;
revoke execute on function variante_sobrante_auto(uuid) from public, anon, authenticated;

-- después de cada movimiento (corre último: después de aplicar el stock)
create or replace function trg_sobrante_por_movimiento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cantidad < 0 then perform variante_sobrante_auto(new.variante_id); end if;
  return new;
end $$;
drop trigger if exists trg_zz_sobrante on stock_movimientos;
create trigger trg_zz_sobrante after insert on stock_movimientos for each row execute function trg_sobrante_por_movimiento();

-- al crear (o prender) el talle de un color que tenía «sin talle» en 0
create or replace function trg_sobrante_por_variante() returns trigger
language plpgsql security definer set search_path = public as $$
declare s uuid;
begin
  if not new.activa or (tg_op = 'UPDATE' and old.activa) then return new; end if;
  for s in select o.id from variantes o where o.producto_id = new.producto_id and o.id <> new.id and o.activa
             and ((o.talle_id is null and new.talle_id is not null and o.color_id is not distinct from new.color_id)
               or (o.color_id is null and new.color_id is not null and o.talle_id is not distinct from new.talle_id)) loop
    perform variante_sobrante_auto(s);
  end loop;
  return new;
end $$;
drop trigger if exists trg_zz_sobrante on variantes;
create trigger trg_zz_sobrante after insert or update of activa on variantes for each row execute function trg_sobrante_por_variante();
