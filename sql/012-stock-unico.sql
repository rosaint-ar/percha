-- Percha · stock único: Percha manda, el canal refleja.
-- 1) el canal guarda talle y color por separado (para poder crear la variante en Percha)
alter table canal_items add column if not exists talle_canal text, add column if not exists color_canal text;

-- 2) cola de empuje: cada cambio de stock de una variante cruzada (o de un componente de un kit cruzado) encola la actualización al canal
create table if not exists canal_cola (
  id          bigserial primary key,
  empresa_id  uuid not null references empresas(id) on delete cascade,
  conexion_id uuid not null references conexiones(id) on delete cascade,
  variante_id uuid not null references variantes(id) on delete cascade,
  estado      text not null default 'pendiente' check (estado in ('pendiente','hecho','error')),
  intentos    int not null default 0,
  error       text,
  creado      timestamptz not null default now(),
  hecho       timestamptz
);
create index if not exists canal_cola_pend on canal_cola (conexion_id, estado) where estado = 'pendiente';
alter table canal_cola enable row level security;
drop policy if exists canal_cola_ver on canal_cola; create policy canal_cola_ver on canal_cola for select using (es_miembro(empresa_id));

create or replace function encolar_canal(e uuid, v uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- la variante misma, en todos los canales donde está cruzada
  insert into canal_cola (empresa_id, conexion_id, variante_id)
  select e, ci.conexion_id, v from canal_items ci join conexiones c on c.id = ci.conexion_id
  where ci.variante_id = v and c.estado = 'activa' and c.empresa_id = e
    and not exists (select 1 from canal_cola q where q.conexion_id = ci.conexion_id and q.variante_id = v and q.estado = 'pendiente')
  group by ci.conexion_id;
  -- y los kits que la usan como componente
  insert into canal_cola (empresa_id, conexion_id, variante_id)
  select e, ci.conexion_id, kv.id
  from producto_componentes pc join variantes kv on kv.producto_id = pc.producto_id
  join canal_items ci on ci.variante_id = kv.id join conexiones c on c.id = ci.conexion_id
  where pc.variante_id = v and c.estado = 'activa' and c.empresa_id = e
    and not exists (select 1 from canal_cola q where q.conexion_id = ci.conexion_id and q.variante_id = kv.id and q.estado = 'pendiente')
  group by ci.conexion_id, kv.id;
end $$;

create or replace function trg_encolar_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform encolar_canal(new.empresa_id, new.variante_id); return new; end $$;
drop trigger if exists trg_stock_a_canal on stock_movimientos;
create trigger trg_stock_a_canal after insert on stock_movimientos for each row execute function trg_encolar_stock();
-- también cuando se cruza o se cambia el cruce de un ítem
create or replace function trg_encolar_cruce() returns trigger
language plpgsql security definer set search_path = public as $$
begin if new.variante_id is not null and (tg_op = 'INSERT' or new.variante_id is distinct from old.variante_id) then perform encolar_canal(new.empresa_id, new.variante_id); end if; return new; end $$;
drop trigger if exists trg_cruce_a_canal on canal_items;
create trigger trg_cruce_a_canal after insert or update of variante_id on canal_items for each row execute function trg_encolar_cruce();

-- 3) crear en Percha la variante que existe en el canal (ej. Boob Tape Negro / Nude)
-- Si el producto de Percha era "único" con stock, ese stock se reparte según lo que dice el canal
-- (es el único que conoce el detalle) y la variante única queda en cero y desactivada.
create or replace function canal_crear_variante(p_item bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it canal_items%rowtype; prod productos%rowtype; e uuid; t_id uuid; c_id uuid; v_id uuid; unica variantes%rowtype; dep uuid; st numeric; cod text;
begin
  select * into it from canal_items where id = p_item;
  if it.id is null or not es_admin(it.empresa_id) then raise exception 'Sin permiso'; end if;
  if it.variante_id is not null then raise exception 'Ya está cruzada'; end if;
  e := it.empresa_id;
  select * into prod from productos where empresa_id = e and codigo = coalesce(it.sku, it.mpn);
  if prod.id is null then raise exception 'El producto % no existe en Percha: crealo primero', coalesce(it.sku, it.mpn);
  end if;
  dep := (select id from depositos where empresa_id = e and principal limit 1);
  -- talle y color (se crean si no existen)
  if coalesce(it.talle_canal, '') <> '' then
    select id into t_id from atributos where empresa_id = e and tipo = 'talle' and (lower(nombre) = lower(it.talle_canal) or lower(codigo) = lower(it.talle_canal)) limit 1;
    if t_id is null then
      cod := upper(left(regexp_replace(it.talle_canal, '[^A-Za-z0-9]', '', 'g'), 6)); if cod = '' then cod := 'T' || floor(random() * 1000)::int; end if;
      insert into atributos (empresa_id, tipo, codigo, nombre, orden) values (e, 'talle', cod, it.talle_canal, 999) on conflict (empresa_id, tipo, codigo) do update set nombre = atributos.nombre returning id into t_id;
    end if;
  end if;
  if coalesce(it.color_canal, '') <> '' then
    select id into c_id from atributos where empresa_id = e and tipo = 'color' and (lower(nombre) = lower(it.color_canal) or lower(codigo) = lower(it.color_canal)) limit 1;
    if c_id is null then
      cod := upper(left(regexp_replace(it.color_canal, '[^A-Za-z0-9]', '', 'g'), 3)); if cod = '' then cod := 'C' || floor(random() * 1000)::int; end if;
      insert into atributos (empresa_id, tipo, codigo, nombre, orden) values (e, 'color', cod, it.color_canal, 999) on conflict (empresa_id, tipo, codigo) do update set nombre = atributos.nombre returning id into c_id;
    end if;
  end if;
  if t_id is null and c_id is null then raise exception 'La variante del canal no tiene talle ni color: cruzala a mano'; end if;
  -- ¿ya existe esa combinación?
  select id into v_id from variantes where producto_id = prod.id and talle_id is not distinct from t_id and color_id is not distinct from c_id and estampa_id is null;
  if v_id is null then
    insert into variantes (empresa_id, producto_id, talle_id, color_id, sku, ean)
    values (e, prod.id, t_id, c_id, prod.codigo || '-' || coalesce((select codigo from atributos where id = t_id), '') || '-' || coalesce((select codigo from atributos where id = c_id), ''), it.barcode)
    returning id into v_id;
    -- si el producto era único, su stock pasa a las variantes nuevas según el canal
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
  -- si la única quedó en cero y ya no es la única, se desactiva
  if unica.id is not null and coalesce((select sum(cantidad) from stock where variante_id = unica.id), 0) <= 0 then update variantes set activa = false where id = unica.id; end if;
  return jsonb_build_object('variante_id', v_id, 'creada', true);
end $$;

-- 4) ajustar el stock de Percha desde el cruce (queda como movimiento, con quién y por qué)
create or replace function ajustar_stock(p_variante uuid, p_nuevo numeric, p_nota text) returns numeric
language plpgsql security definer set search_path = public as $$
declare e uuid; dep uuid; actual numeric;
begin
  select empresa_id into e from variantes where id = p_variante;
  if e is null or not es_miembro(e) or rol_en(e) = 'visor' then raise exception 'Sin permiso'; end if;
  dep := (select id from depositos where empresa_id = e and principal limit 1);
  actual := coalesce((select sum(cantidad) from stock where variante_id = p_variante), 0);
  if p_nuevo <> actual then
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (e, p_variante, dep, p_nuevo - actual, 'ajuste', coalesce(p_nota, 'Conciliación con el canal'));
  end if;
  return p_nuevo;
end $$;

-- 5) pedidos del canal importados como ventas
create table if not exists canal_pedidos (
  id            bigserial primary key,
  empresa_id    uuid not null references empresas(id) on delete cascade,
  conexion_id   uuid not null references conexiones(id) on delete cascade,
  pedido_ext    text not null,
  numero_ext    text,
  estado_ext    text,            -- open / closed / cancelled
  pago_ext      text,            -- pending / paid / refunded…
  total         numeric(14,2),
  fecha         timestamptz,
  cliente       text,
  venta_id      uuid references ventas(id),
  problema      text,            -- líneas sin cruzar, etc.
  datos         jsonb,
  actualizado   timestamptz not null default now(),
  unique (conexion_id, pedido_ext)
);
alter table canal_pedidos enable row level security;
drop policy if exists canal_pedidos_ver on canal_pedidos; create policy canal_pedidos_ver on canal_pedidos for select using (es_miembro(empresa_id));
alter table conexiones add column if not exists ultima_sync_pedidos timestamptz;
alter table conexiones add column if not exists empujar_stock boolean not null default false;

-- Las funciones de servicio (webhooks, cron) registran ventas sin sesión de usuario
create or replace function es_servicio() returns boolean language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '') = 'service_role';
$$;
