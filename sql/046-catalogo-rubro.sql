-- 046 · Catálogo como lo trabaja el rubro:
--   · temporadas (y colecciones) y marcas en cada producto
--   · fotos por color (las de Tienda Nube se cargan solas)
--   · historial de precios y costos (todo cambio queda registrado) + cambio masivo con vista previa y "deshacer"
--   · duplicar un producto
--   · importar el catálogo desde Excel (con simulación antes de grabar)

-- ---------- temporadas y marcas ----------
create table if not exists temporadas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null,
  tipo text not null default 'temporada' check (tipo in ('temporada','permanente','capsula')),  -- capsula = colección corta / drop
  desde date, hasta date,
  orden int not null default 0,
  activa boolean not null default true,
  creado timestamptz not null default now()
);
create table if not exists marcas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null,
  propia boolean not null default false,
  logo_url text,
  orden int not null default 0,
  activa boolean not null default true,
  creado timestamptz not null default now()
);
alter table productos add column if not exists temporada_id uuid references temporadas(id) on delete set null;
alter table productos add column if not exists marca_id uuid references marcas(id) on delete set null;
create index if not exists productos_temporada on productos (temporada_id);
create index if not exists productos_marca on productos (marca_id);
alter table temporadas enable row level security; alter table marcas enable row level security;
drop policy if exists temporadas_ver on temporadas; create policy temporadas_ver on temporadas for select using (es_miembro(empresa_id));
drop policy if exists temporadas_admin on temporadas; create policy temporadas_admin on temporadas for all using (es_admin(empresa_id)) with check (es_admin(empresa_id));
drop policy if exists marcas_ver on marcas; create policy marcas_ver on marcas for select using (es_miembro(empresa_id));
drop policy if exists marcas_admin on marcas; create policy marcas_admin on marcas for all using (es_admin(empresa_id)) with check (es_admin(empresa_id));

-- punto de partida: "Permanente" y las dos temporadas del año (nada se asigna solo)
insert into temporadas (empresa_id, nombre, tipo, desde, hasta, orden)
select e.id, x.nombre, x.tipo, x.desde::date, x.hasta::date, x.orden
from empresas e cross join (values ('Permanente (todo el año)', 'permanente', null, null, 1),
                                   ('Otoño-Invierno 2026', 'temporada', '2026-03-01', '2026-08-31', 2),
                                   ('Primavera-Verano 2026/27', 'temporada', '2026-09-01', '2027-02-28', 3)) x(nombre, tipo, desde, hasta, orden)
where not exists (select 1 from temporadas t where t.empresa_id = e.id);
insert into marcas (empresa_id, nombre, propia, orden)
select e.id, e.nombre, true, 1 from empresas e where not exists (select 1 from marcas m where m.empresa_id = e.id);

-- ---------- fotos por color ----------
create table if not exists producto_fotos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade,
  color_id uuid references atributos(id) on delete set null,   -- null = foto general del producto
  url text not null,
  orden int not null default 0,
  origen text not null default 'manual',                         -- manual | tiendanube
  creado timestamptz not null default now()
);
create unique index if not exists producto_fotos_unica on producto_fotos (producto_id, color_id, url) nulls not distinct;
create index if not exists producto_fotos_prod on producto_fotos (producto_id, orden);
alter table producto_fotos enable row level security;
drop policy if exists producto_fotos_ver on producto_fotos; create policy producto_fotos_ver on producto_fotos for select using (es_miembro(empresa_id));
drop policy if exists producto_fotos_admin on producto_fotos; create policy producto_fotos_admin on producto_fotos for all using (es_admin(empresa_id)) with check (es_admin(empresa_id));

-- la foto actual del producto pasa a ser su primera foto general
insert into producto_fotos (empresa_id, producto_id, url, orden, origen)
select p.empresa_id, p.id, p.imagen_url, 0, 'tiendanube' from productos p where p.imagen_url is not null
on conflict do nothing;
-- las de Tienda Nube: si el producto tiene una foto distinta por color, cada color recibe la suya
with x as (
  select v.empresa_id, v.producto_id, v.color_id, ci.imagen url, min(ci.id) primero
  from canal_items ci join variantes v on v.id = ci.variante_id
  where ci.imagen is not null and v.color_id is not null
  group by 1, 2, 3, 4),
porprod as (select producto_id from x group by 1 having count(distinct url) > 1),
elegida as (select distinct on (x.producto_id, x.color_id) x.* from x join porprod using (producto_id) order by x.producto_id, x.color_id, x.primero)
insert into producto_fotos (empresa_id, producto_id, color_id, url, orden, origen)
select empresa_id, producto_id, color_id, url, 10 + row_number() over (partition by producto_id order by primero), 'tiendanube' from elegida
on conflict do nothing;

-- ---------- vistas: temporada, marca y foto por variante ----------
create or replace view v_productos with (security_invoker = true) as
SELECT p.id, p.empresa_id, p.codigo, p.nombre, p.descripcion, p.categoria_id, p.proveedor_id, p.costo, p.precio, p.ean, p.tipo, p.tiene_variantes, p.imagen_url, p.activo, p.creado, p.modificado,
    cat.nombre AS categoria, pr.nombre AS proveedor,
    (SELECT count(*) FROM variantes v WHERE v.producto_id = p.id AND v.activa) AS variantes,
    CASE WHEN p.tipo = 'kit' THEN stock_kit(p.id)
         ELSE COALESCE((SELECT sum(s.cantidad) FROM stock s JOIN variantes v ON v.id = s.variante_id WHERE v.producto_id = p.id), 0) END AS stock,
    p.temporada_id, p.marca_id, te.nombre AS temporada, ma.nombre AS marca
FROM productos p
LEFT JOIN categorias cat ON cat.id = p.categoria_id
LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
LEFT JOIN temporadas te ON te.id = p.temporada_id
LEFT JOIN marcas ma ON ma.id = p.marca_id;

create or replace view v_variantes with (security_invoker = true) as
SELECT v.id, v.empresa_id, v.producto_id, p.codigo AS producto_codigo, p.nombre AS producto_nombre, p.tipo AS producto_tipo, v.sku, v.ean, v.activa,
    t.codigo AS talle, t.nombre AS talle_nombre, t.orden AS talle_orden, c.codigo AS color, c.nombre AS color_nombre, c.hex AS color_hex, e.codigo AS estampa, e.nombre AS estampa_nombre,
    CASE WHEN p.tipo = 'kit' THEN costo_kit(p.id) ELSE COALESCE(v.costo, p.costo) END AS costo,
    COALESCE(v.precio, p.precio) AS precio,
    CASE WHEN p.tipo = 'kit' THEN stock_kit(p.id) ELSE COALESCE((SELECT sum(s.cantidad) FROM stock s WHERE s.variante_id = v.id), 0) END AS stock,
    v.fallas, v.falla_nota, v.chequear,
    CASE WHEN p.tipo = 'kit' THEN stock_kit(p.id) ELSE GREATEST(COALESCE((SELECT sum(s.cantidad) FROM stock s WHERE s.variante_id = v.id), 0) - v.fallas, 0) END AS stock_web,
    COALESCE((SELECT f.url FROM producto_fotos f WHERE f.producto_id = v.producto_id AND f.color_id = v.color_id ORDER BY f.orden LIMIT 1), p.imagen_url) AS foto
FROM variantes v
JOIN productos p ON p.id = v.producto_id
LEFT JOIN atributos t ON t.id = v.talle_id
LEFT JOIN atributos c ON c.id = v.color_id
LEFT JOIN atributos e ON e.id = v.estampa_id;

-- ---------- historial de precios y costos ----------
create table if not exists precio_lotes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  fecha timestamptz not null default now(),
  user_id uuid default auth.uid(),
  descripcion text,            -- "Subir 15% · precio de venta · redondeo 990 · 214 productos"
  productos int, cambios int,
  deshecho timestamptz, deshecho_por uuid
);
create table if not exists precio_cambios (
  id bigserial primary key,
  empresa_id uuid not null references empresas(id) on delete cascade,
  fecha timestamptz not null default now(),
  user_id uuid default auth.uid(),
  lote_id uuid references precio_lotes(id) on delete set null,
  producto_id uuid references productos(id) on delete cascade,
  variante_id uuid references variantes(id) on delete cascade,
  lista_id uuid references listas_precios(id) on delete cascade,
  campo text not null,          -- precio | costo | precio_lista
  antes numeric, despues numeric
);
create index if not exists precio_cambios_prod on precio_cambios (producto_id, fecha desc);
create index if not exists precio_cambios_lote on precio_cambios (lote_id);
alter table precio_lotes enable row level security; alter table precio_cambios enable row level security;
drop policy if exists precio_lotes_ver on precio_lotes; create policy precio_lotes_ver on precio_lotes for select using (es_admin(empresa_id));
drop policy if exists precio_cambios_ver on precio_cambios; create policy precio_cambios_ver on precio_cambios for select using (es_miembro(empresa_id) and (campo <> 'costo' or es_admin(empresa_id)));

create or replace function registrar_cambio_precio() returns trigger
language plpgsql security definer set search_path = public as $$
declare lote uuid := nullif(current_setting('percha.lote', true), '')::uuid;
begin
  if tg_table_name = 'productos' then
    if new.precio is distinct from old.precio then insert into precio_cambios (empresa_id, lote_id, producto_id, campo, antes, despues) values (new.empresa_id, lote, new.id, 'precio', old.precio, new.precio); end if;
    if new.costo is distinct from old.costo then insert into precio_cambios (empresa_id, lote_id, producto_id, campo, antes, despues) values (new.empresa_id, lote, new.id, 'costo', old.costo, new.costo); end if;
    return new;
  elsif tg_table_name = 'variantes' then
    if new.precio is distinct from old.precio then insert into precio_cambios (empresa_id, lote_id, producto_id, variante_id, campo, antes, despues) values (new.empresa_id, lote, new.producto_id, new.id, 'precio', old.precio, new.precio); end if;
    if new.costo is distinct from old.costo then insert into precio_cambios (empresa_id, lote_id, producto_id, variante_id, campo, antes, despues) values (new.empresa_id, lote, new.producto_id, new.id, 'costo', old.costo, new.costo); end if;
    return new;
  else -- precios fijados por lista
    if tg_op = 'DELETE' then
      insert into precio_cambios (empresa_id, lote_id, producto_id, variante_id, lista_id, campo, antes, despues) values (old.empresa_id, lote, old.producto_id, old.variante_id, old.lista_id, 'precio_lista', old.precio, null); return old;
    elsif tg_op = 'INSERT' or new.precio is distinct from old.precio then
      insert into precio_cambios (empresa_id, lote_id, producto_id, variante_id, lista_id, campo, antes, despues) values (new.empresa_id, lote, new.producto_id, new.variante_id, new.lista_id, 'precio_lista', case when tg_op = 'UPDATE' then old.precio end, new.precio);
    end if;
    return new;
  end if;
end $$;
drop trigger if exists productos_historial_precio on productos;
create trigger productos_historial_precio after update of precio, costo on productos for each row execute function registrar_cambio_precio();
drop trigger if exists variantes_historial_precio on variantes;
create trigger variantes_historial_precio after update of precio, costo on variantes for each row execute function registrar_cambio_precio();
drop trigger if exists precios_historial on precios;
create trigger precios_historial after insert or update or delete on precios for each row execute function registrar_cambio_precio();

-- redondeo como se usa en las tiendas: múltiplos o terminación en 990 / 900. Con "+" al final ("990+") redondea hacia arriba; sin "+", al más cercano
create or replace function precio_redondear(x numeric, modo text) returns numeric
language plpgsql immutable as $$
declare m text := replace(coalesce(modo, 'no'), '+', ''); arriba boolean := coalesce(modo, '') like '%+'; paso numeric; resta numeric := 0;
begin
  if x is null then return null; end if;
  if m in ('10', '100', '500', '1000') then paso := m::numeric;
  elsif m = '990' then paso := 1000; resta := 10;
  elsif m = '900' then paso := 1000; resta := 100;
  else return greatest(0, round(x, 2)); end if;
  if x < paso - resta then return greatest(0, case when arriba then ceil(x) else round(x) end); end if;
  return greatest(0, (case when arriba then ceil((x + resta) / paso) else round((x + resta) / paso) end) * paso - resta);
end $$;

-- cambio masivo de precio o costo. p = {empresa_id, productos:[ids], campo:'precio'|'costo',
--   operacion:'porcentaje'|'monto'|'fijar'|'markup', valor, redondeo, simular, descripcion}
create or replace function precios_masivo(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e uuid := (p->>'empresa_id')::uuid; ids uuid[]; campo text := coalesce(p->>'campo', 'precio'); op text := coalesce(p->>'operacion', 'porcentaje');
        val numeric := coalesce((p->>'valor')::numeric, 0); red text := coalesce(p->>'redondeo', 'no'); lote uuid; res jsonb; n_prod int; n_var int := 0; n_lis int := 0; fijos_sin_tocar int := 0;
begin
  if not es_admin(e) then raise exception 'Solo administración cambia precios'; end if;
  if campo not in ('precio', 'costo') then raise exception 'Campo inválido'; end if;
  if op = 'markup' and campo <> 'precio' then raise exception 'El multiplicador sobre el costo es para el precio de venta'; end if;
  ids := array(select jsonb_array_elements_text(coalesce(p->'productos', '[]'::jsonb))::uuid);
  -- cálculo (sirve para la vista previa y para grabar)
  create temp table if not exists _pm (producto_id uuid, nombre text, codigo text, antes numeric, despues numeric, stock numeric) on commit drop;
  truncate _pm;
  insert into _pm
  select x.id, x.nombre, x.codigo, x.actual, precio_redondear(case op when 'porcentaje' then x.actual * (1 + val / 100) when 'monto' then x.actual + val when 'fijar' then val
                                                                     when 'markup' then nullif(x.costo, 0) * val end, red), x.stock
  from (select pr.id, pr.nombre, pr.codigo, case when campo = 'precio' then pr.precio else pr.costo end actual, pr.costo,
               coalesce((select sum(s.cantidad) from stock s join variantes v on v.id = s.variante_id where v.producto_id = pr.id), 0) stock
        from productos pr where pr.empresa_id = e and pr.id = any(ids) and (pr.tipo <> 'kit' or campo = 'precio')) x;
  delete from _pm where despues is null;
  select count(*) filter (where despues is distinct from antes) into n_prod from _pm;
  if op in ('fijar', 'markup') then select count(*) into fijos_sin_tocar from precios where producto_id = any(ids); end if;

  if coalesce((p->>'simular')::boolean, true) then
    return jsonb_build_object('simulacion', true, 'productos', n_prod, 'sin_cambio', (select count(*) from _pm where despues = antes),
      'suba_promedio', (select round(avg(case when antes > 0 then 100 * (despues - antes) / antes end), 1) from _pm where despues is distinct from antes),
      'valor_stock_antes', (select sum(greatest(stock, 0) * coalesce(antes, 0)) from _pm), 'valor_stock_despues', (select sum(greatest(stock, 0) * despues) from _pm),
      'fijos_sin_tocar', fijos_sin_tocar,
      'filas', coalesce((select jsonb_agg(jsonb_build_object('id', producto_id, 'nombre', nombre, 'codigo', codigo, 'antes', antes, 'despues', despues) order by nombre) from (select * from _pm where despues is distinct from antes order by nombre limit 400) z), '[]'::jsonb));
  end if;

  insert into precio_lotes (empresa_id, descripcion, productos) values (e, nullif(p->>'descripcion', ''), n_prod) returning id into lote;
  perform set_config('percha.lote', lote::text, true);
  if campo = 'precio' then
    update productos pr set precio = m.despues, modificado = now() from _pm m where m.producto_id = pr.id and m.despues is distinct from pr.precio;
    -- talles o colores con precio propio: mismo cambio (en el multiplicador, sobre su propio costo)
    update variantes v set precio = precio_redondear(case op when 'porcentaje' then v.precio * (1 + val / 100) when 'monto' then v.precio + val when 'fijar' then val
                                                              when 'markup' then coalesce(nullif(v.costo, 0), (select costo from productos where id = v.producto_id)) * val end, red)
    where v.producto_id = any(ids) and v.precio is not null;
    get diagnostics n_var = row_count;
    -- precios fijados a mano por lista: con porcentaje o monto se mueven igual; con "fijar" o multiplicador quedan como están
    if op in ('porcentaje', 'monto') then
      update precios set precio = precio_redondear(case op when 'porcentaje' then precio * (1 + val / 100) else precio + val end, red) where producto_id = any(ids);
      get diagnostics n_lis = row_count;
    end if;
  else
    update productos pr set costo = m.despues, modificado = now() from _pm m where m.producto_id = pr.id and m.despues is distinct from pr.costo;
    update variantes v set costo = precio_redondear(case op when 'porcentaje' then v.costo * (1 + val / 100) when 'monto' then v.costo + val else val end, red)
    where v.producto_id = any(ids) and v.costo is not null;
    get diagnostics n_var = row_count;
  end if;
  perform set_config('percha.lote', '', true);
  update precio_lotes set cambios = (select count(*) from precio_cambios where lote_id = lote) where id = lote;
  return jsonb_build_object('simulacion', false, 'lote', lote, 'productos', n_prod, 'variantes', n_var, 'listas', n_lis, 'fijos_sin_tocar', fijos_sin_tocar);
end $$;

-- deshacer un cambio masivo: vuelve cada valor a como estaba, salvo que después lo hayan vuelto a cambiar
create or replace function precios_deshacer(p_lote uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l precio_lotes%rowtype; c record; n int := 0; saltados int := 0;
begin
  select * into l from precio_lotes where id = p_lote for update;
  if l.id is null or not es_admin(l.empresa_id) then raise exception 'Sin permiso'; end if;
  if l.deshecho is not null then raise exception 'Este cambio ya se deshizo'; end if;
  for c in select * from precio_cambios where lote_id = l.id order by id desc loop
    if c.campo = 'precio_lista' then
      update precios set precio = c.antes where lista_id = c.lista_id and producto_id = c.producto_id and variante_id is not distinct from c.variante_id and precio = c.despues;
    elsif c.variante_id is not null then
      if c.campo = 'precio' then update variantes set precio = c.antes where id = c.variante_id and precio is not distinct from c.despues;
      else update variantes set costo = c.antes where id = c.variante_id and costo is not distinct from c.despues; end if;
    else
      if c.campo = 'precio' then update productos set precio = c.antes where id = c.producto_id and precio is not distinct from c.despues;
      else update productos set costo = c.antes where id = c.producto_id and costo is not distinct from c.despues; end if;
    end if;
    if found then n := n + 1; else saltados := saltados + 1; end if;
  end loop;
  update precio_lotes set deshecho = now(), deshecho_por = auth.uid() where id = l.id;
  return jsonb_build_object('vueltos', n, 'saltados', saltados);
end $$;

create or replace view v_precio_lotes with (security_invoker = true) as
select l.*, eu.nombre usuario from precio_lotes l left join empresa_usuarios eu on eu.empresa_id = l.empresa_id and eu.user_id = l.user_id;

-- ---------- duplicar un producto ----------
-- p = {producto_id, codigo?, nombre, variantes: true, fotos: false}
create or replace function producto_duplicar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare o productos%rowtype; nuevo uuid; cod text;
begin
  select * into o from productos where id = (p->>'producto_id')::uuid;
  if o.id is null or not es_admin(o.empresa_id) then raise exception 'Sin permiso'; end if;
  cod := coalesce(nullif(btrim(p->>'codigo'), ''), proximo_codigo(o.empresa_id, o.codigo));
  if exists (select 1 from productos where empresa_id = o.empresa_id and codigo = cod) then raise exception 'Ya existe un producto con el código %', cod; end if;
  insert into productos (empresa_id, codigo, nombre, descripcion, categoria_id, proveedor_id, costo, precio, tipo, tiene_variantes, imagen_url, activo, es_generico, generico_filtro, temporada_id, marca_id)
  values (o.empresa_id, cod, coalesce(nullif(btrim(p->>'nombre'), ''), o.nombre || ' (copia)'), o.descripcion, o.categoria_id, o.proveedor_id, o.costo, o.precio, o.tipo, o.tiene_variantes,
          case when coalesce((p->>'fotos')::boolean, false) then o.imagen_url end, true, o.es_generico, o.generico_filtro, o.temporada_id, o.marca_id)
  returning id into nuevo;
  if coalesce((p->>'variantes')::boolean, true) or not o.tiene_variantes or o.tipo = 'kit' then
    insert into variantes (empresa_id, producto_id, talle_id, color_id, estampa_id, sku, costo, precio)
    select v.empresa_id, nuevo, v.talle_id, v.color_id, v.estampa_id,
           case when v.sku like o.codigo || '%' then cod || substr(v.sku, length(o.codigo) + 1) else cod end, v.costo, v.precio
    from variantes v where v.producto_id = o.id and v.activa
      and (coalesce((p->>'variantes')::boolean, true) or (v.talle_id is null and v.color_id is null and v.estampa_id is null));
  end if;
  insert into producto_componentes (empresa_id, producto_id, variante_id, cantidad, componente_producto_id, filtro)
  select empresa_id, nuevo, variante_id, cantidad, componente_producto_id, filtro from producto_componentes where producto_id = o.id;
  insert into precios (empresa_id, lista_id, producto_id, variante_id, precio)
  select empresa_id, lista_id, nuevo, null, precio from precios where producto_id = o.id and variante_id is null;
  if coalesce((p->>'fotos')::boolean, false) then
    insert into producto_fotos (empresa_id, producto_id, color_id, url, orden, origen)
    select empresa_id, nuevo, color_id, url, orden, origen from producto_fotos where producto_id = o.id;
  end if;
  return nuevo;
end $$;

-- ---------- importar el catálogo desde Excel ----------
-- Una fila por talle·color. p = {empresa_id, filas:[{codigo,nombre,familia,marca,temporada,proveedor,descripcion,costo,precio,talle,color,ean,stock}],
--   actualizar: true (pisa los datos de productos que ya existen), stock: false (fija el stock con la columna Stock), simular: true}
create or replace function catalogo_importar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e uuid := (p->>'empresa_id')::uuid; f jsonb; i int := 0; pr productos%rowtype; v_id uuid; t_id uuid; c_id uuid; cod text; nom text;
        cat_id uuid; mar_id uuid; tem_id uuid; prov_id uuid; existia boolean; actual numeric; dep uuid; base text;
        r_nuevos int := 0; r_act int := 0; r_var int := 0; r_stock int := 0; r_filas int := 0;
        errores jsonb := '[]'::jsonb; nuevos_attr jsonb := '[]'::jsonb; nuevas_fam jsonb := '[]'::jsonb; tocados uuid[] := '{}'; por_nombre jsonb := '{}'::jsonb;
        simular boolean := coalesce((p->>'simular')::boolean, true); actualizar boolean := coalesce((p->>'actualizar')::boolean, true); con_stock boolean := coalesce((p->>'stock')::boolean, false);
begin
  if not es_admin(e) then raise exception 'Solo administración importa el catálogo'; end if;
  dep := (select id from depositos where empresa_id = e and principal limit 1);
  base := coalesce((select max(codigo::bigint)::text from productos where empresa_id = e and tipo = 'prenda' and not es_generico and codigo ~ '^\d{3,12}$'), '100000');
  begin
    for f in select * from jsonb_array_elements(coalesce(p->'filas', '[]'::jsonb)) loop
      i := i + 1;
      cod := nullif(btrim(f->>'codigo'), ''); nom := nullif(btrim(f->>'nombre'), '');
      if cod is null and nom is null then continue; end if;
      r_filas := r_filas + 1;
      begin
        -- familia, marca, temporada, proveedor por nombre (se crean si no existen)
        cat_id := null; mar_id := null; tem_id := null; prov_id := null;
        if nullif(btrim(f->>'familia'), '') is not null then
          select id into cat_id from categorias where empresa_id = e and lower(translate(nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = lower(translate(btrim(f->>'familia'), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) limit 1;
          if cat_id is null then insert into categorias (empresa_id, nombre, orden) values (e, upper(btrim(f->>'familia')), coalesce((select max(orden) from categorias where empresa_id = e), 0) + 1) returning id into cat_id; nuevas_fam := nuevas_fam || to_jsonb('Familia: ' || upper(btrim(f->>'familia'))); end if;
        end if;
        if nullif(btrim(f->>'marca'), '') is not null then
          select id into mar_id from marcas where empresa_id = e and lower(nombre) = lower(btrim(f->>'marca')) limit 1;
          if mar_id is null then insert into marcas (empresa_id, nombre) values (e, btrim(f->>'marca')) returning id into mar_id; nuevas_fam := nuevas_fam || to_jsonb('Marca: ' || btrim(f->>'marca')); end if;
        end if;
        if nullif(btrim(f->>'temporada'), '') is not null then
          select id into tem_id from temporadas where empresa_id = e and lower(nombre) = lower(btrim(f->>'temporada')) limit 1;
          if tem_id is null then insert into temporadas (empresa_id, nombre, orden) values (e, btrim(f->>'temporada'), coalesce((select max(orden) from temporadas where empresa_id = e), 0) + 1) returning id into tem_id; nuevas_fam := nuevas_fam || to_jsonb('Temporada: ' || btrim(f->>'temporada')); end if;
        end if;
        if nullif(btrim(f->>'proveedor'), '') is not null then
          select id into prov_id from proveedores where empresa_id = e and lower(nombre) = lower(btrim(f->>'proveedor')) limit 1;
          if prov_id is null then insert into proveedores (empresa_id, nombre) values (e, btrim(f->>'proveedor')) returning id into prov_id; nuevas_fam := nuevas_fam || to_jsonb('Proveedor: ' || btrim(f->>'proveedor')); end if;
        end if;

        -- producto: por código; sin código, por nombre (los de este mismo archivo o los que ya existen)
        if cod is null then
          cod := coalesce(por_nombre->>lower(nom), (select codigo from productos where empresa_id = e and lower(nombre) = lower(nom) limit 1));
          if cod is null then cod := proximo_codigo(e, coalesce((select max(codigo::bigint)::text from productos where empresa_id = e and categoria_id = cat_id and codigo ~ '^\d{3,12}$'), base)); end if;
          por_nombre := por_nombre || jsonb_build_object(lower(nom), cod);
        end if;
        select * into pr from productos where empresa_id = e and codigo = cod;
        existia := pr.id is not null;
        if not existia then
          if nom is null then raise exception 'Falta el nombre del producto %', cod; end if;
          insert into productos (empresa_id, codigo, nombre, descripcion, categoria_id, proveedor_id, costo, precio, tipo, tiene_variantes, activo, temporada_id, marca_id)
          values (e, cod, nom, nullif(btrim(f->>'descripcion'), ''), cat_id, prov_id, coalesce(nullif(f->>'costo', '')::numeric, 0), coalesce(nullif(f->>'precio', '')::numeric, 0), 'prenda',
                  nullif(btrim(f->>'talle'), '') is not null or nullif(btrim(f->>'color'), '') is not null, true, tem_id, mar_id)
          returning * into pr;
          r_nuevos := r_nuevos + 1; tocados := tocados || pr.id;
        elsif actualizar and not (pr.id = any(tocados)) then
          update productos set nombre = coalesce(nom, nombre), descripcion = coalesce(nullif(btrim(f->>'descripcion'), ''), descripcion),
            categoria_id = coalesce(cat_id, categoria_id), proveedor_id = coalesce(prov_id, proveedor_id), temporada_id = coalesce(tem_id, temporada_id), marca_id = coalesce(mar_id, marca_id),
            costo = coalesce(nullif(f->>'costo', '')::numeric, costo), precio = coalesce(nullif(f->>'precio', '')::numeric, precio), modificado = now()
          where id = pr.id and (nombre, descripcion, categoria_id, proveedor_id, temporada_id, marca_id, costo, precio) is distinct from
                (coalesce(nom, nombre), coalesce(nullif(btrim(f->>'descripcion'), ''), descripcion), coalesce(cat_id, categoria_id), coalesce(prov_id, proveedor_id),
                 coalesce(tem_id, temporada_id), coalesce(mar_id, marca_id), coalesce(nullif(f->>'costo', '')::numeric, costo), coalesce(nullif(f->>'precio', '')::numeric, precio));
          if found then r_act := r_act + 1; end if;
          tocados := tocados || pr.id;
        end if;

        -- talle y color: se buscan por nombre o código; si no existen se crean (después se ubican en su escala / familia de color)
        t_id := null; c_id := null;
        if nullif(btrim(f->>'talle'), '') is not null then
          if not exists (select 1 from atributos where empresa_id = e and tipo = 'talle' and (lower(nombre) = lower(btrim(f->>'talle')) or lower(codigo) = lower(btrim(f->>'talle')))) then nuevos_attr := nuevos_attr || to_jsonb('Talle: ' || btrim(f->>'talle')); end if;
          t_id := atributo_desde_canal(e, 'talle', f->>'talle');
        end if;
        if nullif(btrim(f->>'color'), '') is not null then
          if not exists (select 1 from atributos where empresa_id = e and tipo = 'color' and (lower(nombre) = lower(btrim(f->>'color')) or lower(codigo) = lower(btrim(f->>'color')))) then nuevos_attr := nuevos_attr || to_jsonb('Color: ' || btrim(f->>'color')); end if;
          c_id := atributo_desde_canal(e, 'color', f->>'color');
        end if;
        -- producto con talles y colores: una fila sin talle ni color solo actualiza el producto
        if t_id is null and c_id is null and pr.tiene_variantes and exists (select 1 from variantes where producto_id = pr.id and (talle_id is not null or color_id is not null)) then continue; end if;
        if (t_id is not null or c_id is not null) and not pr.tiene_variantes then update productos set tiene_variantes = true where id = pr.id; pr.tiene_variantes := true; end if;
        select id into v_id from variantes where producto_id = pr.id and talle_id is not distinct from t_id and color_id is not distinct from c_id and estampa_id is null;
        if v_id is null then
          insert into variantes (empresa_id, producto_id, talle_id, color_id, sku, ean)
          values (e, pr.id, t_id, c_id, concat_ws('-', cod, (select codigo from atributos where id = t_id), (select codigo from atributos where id = c_id)), nullif(btrim(f->>'ean'), ''))
          returning id into v_id;
          r_var := r_var + 1;
        elsif nullif(btrim(f->>'ean'), '') is not null then
          update variantes set ean = btrim(f->>'ean') where id = v_id and ean is distinct from btrim(f->>'ean');
        end if;
        if nullif(btrim(f->>'ean'), '') is not null and exists (select 1 from variantes where empresa_id = e and ean = btrim(f->>'ean') and id <> v_id) then
          raise exception 'El código de barras % ya lo tiene otra prenda', btrim(f->>'ean');
        end if;
        if con_stock and nullif(f->>'stock', '') is not null then
          select coalesce(sum(cantidad), 0) into actual from stock where variante_id = v_id;
          if (f->>'stock')::numeric <> actual then
            insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, motivo, nota, user_id)
            values (e, v_id, dep, (f->>'stock')::numeric - actual, 'ajuste', 'Importación', 'Importado de Excel', auth.uid());
            r_stock := r_stock + 1;
          end if;
        end if;
      exception when others then
        if sqlerrm = 'SIMULACION__' then raise; end if;
        errores := errores || jsonb_build_object('fila', i + 1, 'codigo', cod, 'error', sqlerrm);
      end;
    end loop;
    if simular then raise exception 'SIMULACION__'; end if;
  exception when others then
    if sqlerrm <> 'SIMULACION__' then raise; end if;
  end;
  return jsonb_build_object('simulacion', simular, 'filas', r_filas, 'productos_nuevos', r_nuevos, 'productos_actualizados', r_act, 'variantes_nuevas', r_var, 'stock_ajustados', r_stock,
    'nuevos', (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(nuevas_fam || nuevos_attr) x),
    'errores', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(errores) x limit 200) z));
end $$;

select jsonb_build_object(
  'temporadas', (select count(*) from temporadas), 'marcas', (select count(*) from marcas),
  'fotos', (select jsonb_object_agg(origen || case when g then '·general' else '·color' end, n) from (select origen, color_id is null g, count(*) n from producto_fotos group by 1, 2) z),
  'redondeo', jsonb_build_array(precio_redondear(62088.5, '990'), precio_redondear(61400, '990'), precio_redondear(1234, '100'), precio_redondear(53990 * 1.15, '900'), precio_redondear(62088.5, '990+'), precio_redondear(62000, '990+'), precio_redondear(61990, '990+'), precio_redondear(43192, '1000+'))) r;
