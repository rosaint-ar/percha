-- Percha · fase 2: caja (ventas, pagos, turnos, señas, créditos, promociones)

-- ---------- Numeración por empresa ----------
create table if not exists secuencias (
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre     text not null,
  valor      bigint not null default 0,
  primary key (empresa_id, nombre)
);
create or replace function proximo_numero(e uuid, n text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into secuencias (empresa_id, nombre, valor) values (e, n, 1)
  on conflict (empresa_id, nombre) do update set valor = secuencias.valor + 1
  returning valor into v;
  return v;
end $$;

-- ---------- Cajas y turnos ----------
create table if not exists cajas (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  deposito_id uuid references depositos(id),
  activa      boolean not null default true,
  unique (empresa_id, nombre)
);

create table if not exists caja_turnos (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references empresas(id) on delete cascade,
  caja_id          uuid not null references cajas(id),
  abierto_por      uuid not null default auth.uid(),
  abierto          timestamptz not null default now(),
  cerrado_por      uuid,
  cerrado          timestamptz,
  efectivo_inicial numeric(14,2) not null default 0,
  arqueo           jsonb,                -- [{forma_pago_id, nombre, esperado, declarado, diferencia}]
  notas            text,
  estado           text not null default 'abierto' check (estado in ('abierto','cerrado'))
);
create index if not exists caja_turnos_caja on caja_turnos (caja_id, estado);

-- Ingresos y retiros de efectivo dentro del turno (no son ventas)
create table if not exists caja_movimientos (
  id         bigserial primary key,
  empresa_id uuid not null references empresas(id) on delete cascade,
  turno_id   uuid not null references caja_turnos(id),
  tipo       text not null check (tipo in ('ingreso','retiro')),
  monto      numeric(14,2) not null check (monto > 0),
  concepto   text,
  user_id    uuid not null default auth.uid(),
  fecha      timestamptz not null default now()
);

-- ---------- Promociones ----------
create table if not exists promociones (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  tipo        text not null check (tipo in ('porcentaje','monto','nxm','cantidad')),
  -- porcentaje: valor = % off · monto: valor = $ off por unidad · nxm: lleva n paga m (n, m) · cantidad: desde n unidades, valor % off
  valor       numeric(10,2) not null default 0,
  n           int not null default 0,
  m           int not null default 0,
  alcance     text not null default 'todo' check (alcance in ('todo','familias','productos')),
  familia_ids uuid[] not null default '{}',
  producto_ids uuid[] not null default '{}',
  desde       date,
  hasta       date,
  dias_semana int[] not null default '{1,2,3,4,5,6,7}',   -- 1 = lunes
  formas_pago uuid[] not null default '{}',                 -- vacío = cualquiera
  activa      boolean not null default true,
  creada      timestamptz not null default now()
);

-- ---------- Créditos: notas de crédito internas, gift cards, saldos a favor ----------
create table if not exists creditos (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas(id) on delete cascade,
  tipo           text not null check (tipo in ('nota_credito','gift_card')),
  codigo         text not null,                 -- corto, para escribirlo o imprimirlo
  cliente_id     uuid references clientes(id),
  origen_venta_id uuid,
  monto          numeric(14,2) not null,
  saldo          numeric(14,2) not null,
  vence          date,
  estado         text not null default 'vigente' check (estado in ('vigente','usado','vencido','anulado')),
  nota           text,
  creado_por     uuid default auth.uid(),
  creado         timestamptz not null default now(),
  unique (empresa_id, codigo)
);

-- ---------- Ventas ----------
create table if not exists ventas (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  numero        bigint not null,
  tipo          text not null default 'venta' check (tipo in ('venta','cambio','devolucion')),
  estado        text not null default 'completada' check (estado in ('completada','senada','anulada')),
  fecha         timestamptz not null default now(),
  caja_id       uuid references cajas(id),
  turno_id      uuid references caja_turnos(id),
  cliente_id    uuid references clientes(id),
  vendedora_id  uuid,                                  -- auth.users.id de quien atendió
  lista_id      uuid references listas_precios(id),
  subtotal      numeric(14,2) not null default 0,     -- suma de líneas ya con descuentos de línea y promos
  descuento_pct numeric(7,3) not null default 0,      -- descuento general
  descuento     numeric(14,2) not null default 0,
  recargo       numeric(14,2) not null default 0,     -- recargos por medio de pago (cuotas)
  total         numeric(14,2) not null default 0,
  pagado        numeric(14,2) not null default 0,
  saldo         numeric(14,2) not null default 0,     -- > 0 en señas
  costo         numeric(14,2) not null default 0,     -- costo de la mercadería (margen)
  venta_origen_id uuid references ventas(id),         -- en cambios/devoluciones: la venta original
  origen        text not null default 'local',        -- local | online | tiendanube | mercadolibre
  referencia    text,
  nota          text,
  offline_id    uuid,                                 -- id generado en el navegador: evita duplicar al re-sincronizar
  anulada_por   uuid, anulada_fecha timestamptz, anulada_motivo text,
  creado_por    uuid default auth.uid(),
  creado        timestamptz not null default now(),
  unique (empresa_id, numero),
  unique (empresa_id, offline_id)
);
create index if not exists ventas_fecha on ventas (empresa_id, fecha desc);
create index if not exists ventas_turno on ventas (turno_id);

create table if not exists venta_lineas (
  id            bigserial primary key,
  venta_id      uuid not null references ventas(id) on delete cascade,
  empresa_id    uuid not null references empresas(id) on delete cascade,
  variante_id   uuid references variantes(id),
  producto_id   uuid references productos(id),
  descripcion   text not null,                        -- foto del nombre en el momento de la venta
  talle         text, color text,
  cantidad      numeric(12,3) not null,               -- negativa = devuelve
  precio_lista  numeric(14,2) not null default 0,     -- precio de la lista aplicada, sin descuentos
  precio_unit   numeric(14,2) not null default 0,     -- precio cobrado por unidad (ya con descuento y promo)
  descuento_pct numeric(7,3) not null default 0,
  promocion_id  uuid references promociones(id),
  promocion_nombre text,
  total         numeric(14,2) not null default 0,
  costo_unit    numeric(14,2) not null default 0
);
create index if not exists venta_lineas_venta on venta_lineas (venta_id);
create index if not exists venta_lineas_variante on venta_lineas (variante_id);

create table if not exists venta_pagos (
  id            bigserial primary key,
  venta_id      uuid not null references ventas(id) on delete cascade,
  empresa_id    uuid not null references empresas(id) on delete cascade,
  turno_id      uuid references caja_turnos(id),
  forma_pago_id uuid references formas_pago(id),
  credito_id    uuid references creditos(id),         -- si pagó con nota de crédito / gift card
  monto         numeric(14,2) not null,               -- negativo = devolución de dinero
  cuotas        int not null default 1,
  recargo_pct   numeric(7,3) not null default 0,
  referencia    text,
  fecha         timestamptz not null default now()
);
create index if not exists venta_pagos_turno on venta_pagos (turno_id);

-- ---------- RLS ----------
do $$
declare t text;
begin
  foreach t in array array['secuencias','cajas','caja_turnos','caja_movimientos','promociones','creditos','ventas','venta_lineas','venta_pagos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_ver on %I', t, t);
    execute format('create policy %I_ver on %I for select using (es_miembro(empresa_id))', t, t);
  end loop;
end $$;
-- Administración configura cajas y promociones
drop policy if exists cajas_admin on cajas; create policy cajas_admin on cajas for all using (es_admin(empresa_id)) with check (es_admin(empresa_id));
drop policy if exists promociones_admin on promociones; create policy promociones_admin on promociones for all using (es_admin(empresa_id)) with check (es_admin(empresa_id));
-- Quien vende abre/cierra turnos y registra movimientos de caja
drop policy if exists turnos_vendedora on caja_turnos; create policy turnos_vendedora on caja_turnos for all using (es_miembro(empresa_id) and rol_en(empresa_id) <> 'visor') with check (es_miembro(empresa_id) and rol_en(empresa_id) <> 'visor');
drop policy if exists cajamov_vendedora on caja_movimientos; create policy cajamov_vendedora on caja_movimientos for insert with check (es_miembro(empresa_id) and rol_en(empresa_id) <> 'visor');
-- Ventas, líneas, pagos y créditos se escriben solo por las funciones de abajo (security definer)

-- ---------- Registrar una venta (atómico) ----------
-- p = { offline_id, tipo, estado, caja_id, turno_id, cliente_id, vendedora_id, lista_id, descuento_pct, descuento, recargo, nota,
--       venta_origen_id, origen, referencia, deposito_id,
--       lineas: [{variante_id, producto_id, descripcion, talle, color, cantidad, precio_lista, precio_unit, descuento_pct, promocion_id, promocion_nombre, total, costo_unit}],
--       pagos:  [{forma_pago_id, credito_id, monto, cuotas, recargo_pct, referencia}],
--       creditos_a_emitir: [{tipo, monto, cliente_id, vence, nota}] }
create or replace function caja_registrar_venta(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e uuid := (p->>'empresa_id')::uuid;
  v_id uuid; v_num bigint; l jsonb; pg jsonb; cr jsonb;
  v_sub numeric := 0; v_costo numeric := 0; v_pagado numeric := 0; v_total numeric; v_desc numeric; v_rec numeric;
  v_estado text := coalesce(p->>'estado', 'completada'); v_tipo text := coalesce(p->>'tipo', 'venta');
  dep uuid; cred creditos%rowtype; codigo text; creditos_out jsonb := '[]'::jsonb; existente uuid;
begin
  if not es_miembro(e) or rol_en(e) = 'visor' then raise exception 'Sin permiso para vender'; end if;
  -- idempotencia: si ya se registró (reintento tras corte de internet), devolver la existente
  if p->>'offline_id' is not null then
    select id into existente from ventas where empresa_id = e and offline_id = (p->>'offline_id')::uuid;
    if existente is not null then
      return jsonb_build_object('id', existente, 'numero', (select numero from ventas where id = existente), 'repetida', true);
    end if;
  end if;
  dep := coalesce((p->>'deposito_id')::uuid, (select deposito_id from cajas where id = (p->>'caja_id')::uuid), (select id from depositos where empresa_id = e and principal limit 1));

  for l in select * from jsonb_array_elements(coalesce(p->'lineas', '[]'::jsonb)) loop
    v_sub := v_sub + (l->>'total')::numeric;
    v_costo := v_costo + coalesce((l->>'costo_unit')::numeric, 0) * (l->>'cantidad')::numeric;
  end loop;
  v_desc := coalesce((p->>'descuento')::numeric, 0);
  v_rec := coalesce((p->>'recargo')::numeric, 0);
  v_total := round(v_sub - v_desc + v_rec, 2);
  for pg in select * from jsonb_array_elements(coalesce(p->'pagos', '[]'::jsonb)) loop v_pagado := v_pagado + (pg->>'monto')::numeric; end loop;
  -- una nota de crédito emitida es plata que se le devuelve a la clienta: cuenta como pago negativo
  for cr in select * from jsonb_array_elements(coalesce(p->'creditos_a_emitir', '[]'::jsonb)) loop
    if cr->>'tipo' = 'nota_credito' then v_pagado := v_pagado - (cr->>'monto')::numeric; end if;
  end loop;
  if v_estado = 'completada' and abs(v_pagado - v_total) > 0.5 then
    raise exception 'Los pagos (%) no coinciden con el total (%)', v_pagado, v_total;
  end if;
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
    -- stock: la venta saca, la devolución (cantidad negativa) devuelve
    if l->>'variante_id' is not null then
      insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
      values (e, (l->>'variante_id')::uuid, dep, -((l->>'cantidad')::numeric), case when (l->>'cantidad')::numeric < 0 then 'devolucion' else 'venta' end, v_id::text, 'Venta #' || v_num, auth.uid());
    end if;
  end loop;

  for pg in select * from jsonb_array_elements(coalesce(p->'pagos', '[]'::jsonb)) loop
    insert into venta_pagos (venta_id, empresa_id, turno_id, forma_pago_id, credito_id, monto, cuotas, recargo_pct, referencia)
    values (v_id, e, (p->>'turno_id')::uuid, (pg->>'forma_pago_id')::uuid, (pg->>'credito_id')::uuid, (pg->>'monto')::numeric, coalesce((pg->>'cuotas')::int, 1), coalesce((pg->>'recargo_pct')::numeric, 0), pg->>'referencia');
    -- si pagó con un crédito, descontarle el saldo
    if pg->>'credito_id' is not null then
      select * into cred from creditos where id = (pg->>'credito_id')::uuid and empresa_id = e for update;
      if cred.id is null or cred.estado <> 'vigente' then raise exception 'El crédito no está vigente'; end if;
      if cred.saldo < (pg->>'monto')::numeric - 0.01 then raise exception 'El crédito no tiene saldo suficiente'; end if;
      update creditos set saldo = round(saldo - (pg->>'monto')::numeric, 2), estado = case when round(saldo - (pg->>'monto')::numeric, 2) <= 0 then 'usado' else 'vigente' end where id = cred.id;
    end if;
  end loop;

  -- créditos a emitir (nota de crédito por devolución, gift card vendida)
  for cr in select * from jsonb_array_elements(coalesce(p->'creditos_a_emitir', '[]'::jsonb)) loop
    codigo := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    insert into creditos (empresa_id, tipo, codigo, cliente_id, origen_venta_id, monto, saldo, vence, nota)
    values (e, cr->>'tipo', codigo, (cr->>'cliente_id')::uuid, v_id, (cr->>'monto')::numeric, (cr->>'monto')::numeric, (cr->>'vence')::date, cr->>'nota');
    creditos_out := creditos_out || jsonb_build_object('codigo', codigo, 'tipo', cr->>'tipo', 'monto', (cr->>'monto')::numeric);
  end loop;

  return jsonb_build_object('id', v_id, 'numero', v_num, 'total', v_total, 'creditos', creditos_out);
end $$;

-- ---------- Completar una seña (retiro) ----------
create or replace function caja_completar_sena(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e uuid := (p->>'empresa_id')::uuid; v ventas%rowtype; pg jsonb; v_pagado numeric := 0;
begin
  if not es_miembro(e) or rol_en(e) = 'visor' then raise exception 'Sin permiso'; end if;
  select * into v from ventas where id = (p->>'venta_id')::uuid and empresa_id = e for update;
  if v.id is null or v.estado <> 'senada' then raise exception 'La seña no existe o ya fue retirada'; end if;
  for pg in select * from jsonb_array_elements(coalesce(p->'pagos', '[]'::jsonb)) loop
    v_pagado := v_pagado + (pg->>'monto')::numeric;
    insert into venta_pagos (venta_id, empresa_id, turno_id, forma_pago_id, credito_id, monto, cuotas, recargo_pct, referencia)
    values (v.id, e, (p->>'turno_id')::uuid, (pg->>'forma_pago_id')::uuid, (pg->>'credito_id')::uuid, (pg->>'monto')::numeric, coalesce((pg->>'cuotas')::int, 1), coalesce((pg->>'recargo_pct')::numeric, 0), pg->>'referencia');
  end loop;
  if abs((v.pagado + v_pagado) - v.total) > 0.5 then raise exception 'Falta pagar % para completar', v.total - v.pagado - v_pagado; end if;
  update ventas set pagado = v.pagado + v_pagado, saldo = 0, estado = 'completada', turno_id = coalesce((p->>'turno_id')::uuid, ventas.turno_id) where id = v.id;
  return jsonb_build_object('id', v.id, 'numero', v.numero);
end $$;

-- ---------- Anular una venta ----------
create or replace function caja_anular_venta(p_venta uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v ventas%rowtype; l record; dep uuid;
begin
  select * into v from ventas where id = p_venta for update;
  if v.id is null or not es_miembro(v.empresa_id) then raise exception 'Venta inexistente'; end if;
  if not es_admin(v.empresa_id) and v.creado_por <> auth.uid() then raise exception 'Solo administración puede anular ventas de otra persona'; end if;
  if v.estado = 'anulada' then raise exception 'Ya estaba anulada'; end if;
  dep := coalesce((select deposito_id from cajas where id = v.caja_id), (select id from depositos where empresa_id = v.empresa_id and principal limit 1));
  for l in select * from venta_lineas where venta_id = v.id and variante_id is not null loop
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
    values (v.empresa_id, l.variante_id, dep, l.cantidad, 'ajuste', v.id::text, 'Anulación venta #' || v.numero, auth.uid());
  end loop;
  -- devolver saldo a los créditos usados y anular los emitidos por esta venta
  update creditos c set saldo = c.saldo + vp.monto, estado = 'vigente' from venta_pagos vp where vp.venta_id = v.id and vp.credito_id = c.id;
  update creditos set estado = 'anulado' where origen_venta_id = v.id and saldo = monto;
  update ventas set estado = 'anulada', anulada_por = auth.uid(), anulada_fecha = now(), anulada_motivo = p_motivo where id = v.id;
end $$;

-- ---------- Arqueo del turno: lo esperado por forma de pago ----------
create or replace function caja_esperado(p_turno uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  with pagos as (
    select vp.forma_pago_id, sum(vp.monto) monto, count(distinct vp.venta_id) ventas
    from venta_pagos vp join ventas v on v.id = vp.venta_id
    where vp.turno_id = p_turno and v.estado <> 'anulada' and vp.credito_id is null
    group by vp.forma_pago_id
  ),
  t as (select * from caja_turnos where id = p_turno),
  mov as (select coalesce(sum(case when tipo = 'ingreso' then monto else -monto end), 0) neto from caja_movimientos where turno_id = p_turno)
  select jsonb_build_object(
    'formas', coalesce((select jsonb_agg(jsonb_build_object('forma_pago_id', fp.id, 'nombre', fp.nombre, 'tipo', fp.tipo, 'ventas', coalesce(pg.ventas, 0),
                 'esperado', coalesce(pg.monto, 0) + case when fp.tipo = 'efectivo' then (select efectivo_inicial from t) + (select neto from mov) else 0 end) order by fp.orden)
               from formas_pago fp left join pagos pg on pg.forma_pago_id = fp.id
               where fp.empresa_id = (select empresa_id from t) and (fp.activa or pg.monto is not null)), '[]'::jsonb),
    'efectivo_inicial', (select efectivo_inicial from t),
    'movimientos', (select neto from mov),
    'ventas', (select count(*) from ventas where turno_id = p_turno and estado <> 'anulada'),
    'total', (select coalesce(sum(total), 0) from ventas where turno_id = p_turno and estado = 'completada')
  );
$$;

-- ---------- Vistas para listados ----------
create or replace view v_ventas with (security_invoker = true) as
select v.*, c.nombre as cliente_nombre, eu.nombre as vendedora_nombre,
       (select count(*) from venta_lineas l where l.venta_id = v.id) as lineas,
       (select string_agg(fp.nombre, ' + ') from venta_pagos vp left join formas_pago fp on fp.id = vp.forma_pago_id where vp.venta_id = v.id) as pagos
from ventas v
left join clientes c on c.id = v.cliente_id
left join empresa_usuarios eu on eu.empresa_id = v.empresa_id and eu.user_id = v.vendedora_id;

-- Caja y turno por defecto para cada empresa existente
insert into cajas (empresa_id, nombre, deposito_id)
select e.id, 'Caja principal', (select id from depositos d where d.empresa_id = e.id and d.principal limit 1)
from empresas e where not exists (select 1 from cajas c where c.empresa_id = e.id);
