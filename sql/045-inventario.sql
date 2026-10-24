-- 045 · Inventario: recuentos (con foto del stock al empezar), ajustes con motivo e historial de movimientos.
--  · Recuento: se arma con un alcance (todo, familias o productos), se cuenta (a mano o escaneando) y al confirmar
--    cada diferencia queda como movimiento "recuento". La foto del stock se toma al crear: lo que se venda mientras
--    se cuenta no se pierde (stock final = contado + movimientos posteriores a la foto).
--  · Ajuste: fijar o sumar/restar con motivo (rotura, faltante, regalo…).

alter table stock_movimientos add column if not exists motivo text;

create table if not exists recuentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null,
  alcance jsonb not null default '{"tipo":"todo"}'::jsonb,   -- {tipo: todo|familias|productos, ids: [...]}
  ciego boolean not null default false,                       -- no mostrar el stock del sistema mientras se cuenta
  estado text not null default 'abierto' check (estado in ('abierto','confirmado','descartado')),
  deposito_id uuid references depositos(id),
  creado timestamptz not null default now(), creado_por uuid default auth.uid(),
  confirmado timestamptz, confirmado_por uuid, nota text,
  resumen jsonb
);
create table if not exists recuento_items (
  id bigserial primary key,
  recuento_id uuid not null references recuentos(id) on delete cascade,
  empresa_id uuid not null references empresas(id) on delete cascade,
  variante_id uuid not null references variantes(id) on delete cascade,
  sistema numeric(12,3) not null default 0,   -- stock al crear el recuento
  contado numeric(12,3),                      -- null = todavía no contado
  contado_por uuid, contado_en timestamptz,
  unique (recuento_id, variante_id)
);
create index if not exists recuento_items_rec on recuento_items (recuento_id);
alter table recuentos enable row level security; alter table recuento_items enable row level security;
drop policy if exists recuentos_ver on recuentos; create policy recuentos_ver on recuentos for select using (es_miembro(empresa_id));
drop policy if exists recuento_items_ver on recuento_items; create policy recuento_items_ver on recuento_items for select using (es_miembro(empresa_id));
drop policy if exists recuento_items_contar on recuento_items; create policy recuento_items_contar on recuento_items for update
  using (es_miembro(empresa_id) and rol_en(empresa_id) <> 'visor' and exists (select 1 from recuentos r where r.id = recuento_id and r.estado = 'abierto'))
  with check (es_miembro(empresa_id) and rol_en(empresa_id) <> 'visor');

-- crear un recuento con la foto del stock de lo que entra en el alcance
create or replace function recuento_crear(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare e uuid := (p->>'empresa_id')::uuid; r uuid; v_tipo text := coalesce(p->'alcance'->>'tipo', 'todo'); ids uuid[];
begin
  if not es_miembro(e) or rol_en(e) = 'visor' then raise exception 'Sin permiso'; end if;
  ids := array(select jsonb_array_elements_text(coalesce(p->'alcance'->'ids', '[]'::jsonb))::uuid);
  insert into recuentos (empresa_id, nombre, alcance, ciego, deposito_id)
  values (e, coalesce(nullif(p->>'nombre', ''), 'Recuento ' || to_char(now() at time zone 'America/Argentina/Cordoba', 'DD/MM')), coalesce(p->'alcance', '{"tipo":"todo"}'::jsonb), coalesce((p->>'ciego')::boolean, false),
          coalesce((p->>'deposito_id')::uuid, (select id from depositos where empresa_id = e and principal limit 1)))
  returning id into r;
  insert into recuento_items (recuento_id, empresa_id, variante_id, sistema)
  select r, e, v.id, coalesce((select sum(cantidad) from stock s where s.variante_id = v.id), 0)
  from variantes v join productos p2 on p2.id = v.producto_id
  where v.empresa_id = e and v.activa and p2.activo and p2.tipo <> 'kit' and coalesce(v.sku, '') not like '%-SD'
    and coalesce((select codigo from categorias where id = p2.categoria_id), '') <> '99'   -- servicios (envío, seña, gift card) no se cuentan
    and (v_tipo = 'todo' or (v_tipo = 'familias' and p2.categoria_id = any(ids)) or (v_tipo = 'productos' and p2.id = any(ids)));
  return r;
end $$;

-- confirmar: cada diferencia (contado − foto) queda como movimiento "recuento"; lo no contado se mantiene o pasa a 0
create or replace function recuento_confirmar(p_recuento uuid, p_no_contados text default 'mantener', p_nota text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r recuentos%rowtype; n_mov int := 0; sube numeric := 0; baja numeric := 0; it record; dif numeric;
begin
  select * into r from recuentos where id = p_recuento for update;
  if r.id is null or not es_miembro(r.empresa_id) or rol_en(r.empresa_id) not in ('duenio','admin') then raise exception 'Solo administración confirma recuentos'; end if;
  if r.estado <> 'abierto' then raise exception 'Este recuento ya está %', r.estado; end if;
  for it in select * from recuento_items where recuento_id = r.id loop
    if it.contado is null then
      if p_no_contados = 'cero' and it.sistema <> 0 then dif := -it.sistema; else continue; end if;
    else dif := it.contado - it.sistema; end if;
    if dif = 0 then continue; end if;
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, motivo, user_id)
    values (r.empresa_id, it.variante_id, coalesce(r.deposito_id, (select id from depositos where empresa_id = r.empresa_id and principal limit 1)), dif, 'recuento', r.id::text,
            r.nombre || case when it.contado is null then ' · no contado → 0' else ' · contado ' || it.contado::int || ', había ' || it.sistema::int end, 'recuento', auth.uid());
    n_mov := n_mov + 1; if dif > 0 then sube := sube + dif; else baja := baja - dif; end if;
  end loop;
  -- las prendas con falla no pueden ser más que el stock
  update variantes v set fallas = greatest(0, least(v.fallas, coalesce((select sum(cantidad) from stock s where s.variante_id = v.id), 0)))
  where v.id in (select variante_id from recuento_items where recuento_id = r.id) and v.fallas > 0;
  update recuentos set estado = 'confirmado', confirmado = now(), confirmado_por = auth.uid(), nota = coalesce(p_nota, nota),
    resumen = jsonb_build_object('movimientos', n_mov, 'sube', sube, 'baja', baja,
      'contados', (select count(*) from recuento_items where recuento_id = r.id and contado is not null), 'items', (select count(*) from recuento_items where recuento_id = r.id))
  where id = r.id;
  return (select resumen from recuentos where id = r.id);
end $$;

create or replace function recuento_descartar(p_recuento uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r recuentos%rowtype;
begin
  select * into r from recuentos where id = p_recuento;
  if r.id is null or not es_miembro(r.empresa_id) or rol_en(r.empresa_id) = 'visor' then raise exception 'Sin permiso'; end if;
  if r.estado <> 'abierto' then raise exception 'Solo se descartan recuentos abiertos'; end if;
  update recuentos set estado = 'descartado' where id = r.id;
end $$;

-- ajuste rápido con motivo: fijar la cantidad o sumar/restar
create or replace function stock_ajustar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v variantes%rowtype; actual numeric; dif numeric; dep uuid; modo text := coalesce(p->>'modo', 'sumar');
begin
  select * into v from variantes where id = (p->>'variante_id')::uuid;
  if v.id is null or not es_miembro(v.empresa_id) or rol_en(v.empresa_id) = 'visor' then raise exception 'Sin permiso'; end if;
  select coalesce(sum(cantidad), 0) into actual from stock where variante_id = v.id;
  dif := case when modo = 'fijar' then (p->>'cantidad')::numeric - actual else (p->>'cantidad')::numeric end;
  if dif = 0 then return jsonb_build_object('cambio', 0, 'stock', actual); end if;
  dep := coalesce((p->>'deposito_id')::uuid, (select id from depositos where empresa_id = v.empresa_id and principal limit 1));
  insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota, motivo, user_id)
  values (v.empresa_id, v.id, dep, dif, 'ajuste', nullif(p->>'nota', ''), nullif(p->>'motivo', ''), auth.uid());
  update variantes set fallas = greatest(0, least(fallas, actual + dif)) where id = v.id and fallas > 0;
  return jsonb_build_object('cambio', dif, 'stock', actual + dif);
end $$;

-- historial legible
create or replace view v_movimientos with (security_invoker = true) as
select m.id, m.empresa_id, m.fecha, m.tipo, m.motivo, m.cantidad, m.nota, m.referencia, m.variante_id, m.deposito_id, m.user_id,
       v.producto_id, v.producto_codigo, v.producto_nombre, v.talle_nombre, v.color_nombre, v.sku,
       d.nombre deposito, eu.nombre usuario,
       ve.numero venta_numero, rc.nombre recuento_nombre
from stock_movimientos m
join v_variantes v on v.id = m.variante_id
left join depositos d on d.id = m.deposito_id
left join empresa_usuarios eu on eu.empresa_id = m.empresa_id and eu.user_id = m.user_id
left join ventas ve on ve.id::text = m.referencia
left join recuentos rc on rc.id::text = m.referencia;

-- números del inventario para los recuadros de arriba
create or replace function inventario_resumen(e uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not es_miembro(e) then null else jsonb_build_object(
    'unidades', coalesce(sum(greatest(st, 0)), 0),
    'costo', coalesce(sum(greatest(st, 0) * costo), 0),
    'venta', coalesce(sum(greatest(st, 0) * precio), 0),
    'negativos', count(*) filter (where st < 0),
    'sin_stock', count(*) filter (where st = 0),
    'variantes', count(*),
    'movimientos_7d', (select count(*) from stock_movimientos where empresa_id = e and fecha > now() - interval '7 days'),
    'recuentos_abiertos', (select count(*) from recuentos where empresa_id = e and estado = 'abierto')) end
  from (select coalesce((select sum(s.cantidad) from stock s where s.variante_id = v.id), 0) st, coalesce(v.costo, p.costo, 0) costo, coalesce(v.precio, p.precio, 0) precio
        from variantes v join productos p on p.id = v.producto_id left join categorias c on c.id = p.categoria_id where v.empresa_id = e and v.activa and p.activo and p.tipo <> 'kit' and coalesce(c.codigo, '') <> '99') x;
$$;

select inventario_resumen((select id from empresas limit 1)) r;
