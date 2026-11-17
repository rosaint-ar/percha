-- 150 · Revisión de la web (Conexiones › Revisión): la auditoría Percha ↔ canal, en vivo y con los arreglos ahí mismo.
-- (17/11/2026, Diego: "que la auditoría sea dinámica y me permita aplicar la corrección ahí mismo, buscar qué producto o
--  variante es para conectar, editar nombres, variantes… que sea todo interactivo")
--   · canal_revision_ok: lo que alguien revisó y dijo «está bien así» (no vuelve a aparecer como problema).
--   · canal_separar_color(item): la web distingue un color/diseño que en Percha está junto (PANTUMEDIAS, EFECTO PIEL,
--     talles «sin color»): crea (o reusa) ese talle·color en la prenda, le pasa el stock que la web tiene en esa opción
--     y la conecta. p_color: otro nombre de color, cuando la web no lo dice (p. ej. «Rosa viejo c/ cobre»).
--     Si el talle·color de origen queda en 0 y sin conexiones, se apaga.

create table if not exists canal_revision_ok (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas(id) on delete cascade,
  clave text not null,
  nota text,
  user_id uuid default auth.uid(),
  creado timestamptz not null default now(),
  unique (empresa_id, clave)
);
alter table canal_revision_ok enable row level security;
drop policy if exists canal_revision_ok_ver on canal_revision_ok;
create policy canal_revision_ok_ver on canal_revision_ok for select using (es_miembro(empresa_id));
drop policy if exists canal_revision_ok_admin on canal_revision_ok;
create policy canal_revision_ok_admin on canal_revision_ok for all using (es_admin(empresa_id)) with check (es_admin(empresa_id));

create or replace function unaccent_simple(s text) returns text language sql immutable as $$
  select translate(coalesce(s, ''), 'áéíóúÁÉÍÓÚäëïöüÄËÏÖÜñÑ', 'aeiouAEIOUaeiouAEIOUnN')
$$;

drop function if exists canal_separar_color(bigint);
create or replace function canal_separar_color(p_item bigint, p_color text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it canal_items%rowtype; v variantes%rowtype; prod productos%rowtype; e uuid; c_id uuid; v_id uuid; cod text; col text;
        dep uuid; st numeric; actual numeric; nuevo boolean := false;
begin
  select * into it from canal_items where id = p_item;
  if it.id is null or not es_admin(it.empresa_id) then raise exception 'Sin permiso'; end if;
  e := it.empresa_id;
  if it.variante_id is null then raise exception 'La opción no está conectada: conectala primero'; end if;
  col := nullif(trim(coalesce(p_color, it.color_canal, '')), '');
  if col is null then raise exception 'En la web esa opción no tiene color: escribí cuál es'; end if;
  select * into v from variantes where id = it.variante_id;
  select * into prod from productos where id = v.producto_id;
  if prod.es_generico then raise exception 'Está atada a un código general: conectala a su prenda'; end if;
  -- el color: el que ya existe con ese nombre (sin importar mayúsculas ni acentos) o uno nuevo
  select id into c_id from atributos where empresa_id = e and tipo = 'color'
    and (lower(unaccent_simple(nombre)) = lower(unaccent_simple(col)) or lower(codigo) = lower(col)) order by orden limit 1;
  if c_id is null then
    cod := upper(left(regexp_replace(unaccent_simple(col), '[^A-Za-z0-9]', '', 'g'), 3)); if cod = '' then cod := 'C'; end if;
    while exists (select 1 from atributos where empresa_id = e and tipo = 'color' and codigo = cod) loop cod := left(cod, 3) || floor(random() * 900 + 100)::int; end loop;
    insert into atributos (empresa_id, tipo, codigo, nombre, orden) values (e, 'color', cod, col, 999) returning id into c_id;
  end if;
  if c_id = v.color_id then raise exception 'Ya está conectada a ese color'; end if;
  -- el talle·color de destino: mismo talle, ese color
  select id into v_id from variantes where producto_id = prod.id and talle_id is not distinct from v.talle_id and color_id = c_id and estampa_id is null;
  if v_id is null then
    cod := prod.codigo || coalesce('-' || (select codigo from atributos where id = v.talle_id), '') || '-' || (select codigo from atributos where id = c_id);
    while exists (select 1 from variantes where empresa_id = e and sku = cod) loop cod := cod || '-' || floor(random() * 900 + 100)::int; end loop;
    insert into variantes (empresa_id, producto_id, talle_id, color_id, sku, precio) values (e, prod.id, v.talle_id, c_id, cod, v.precio) returning id into v_id;
    update productos set tiene_variantes = true where id = prod.id; nuevo := true;
  else
    update variantes set activa = true where id = v_id and not activa;
  end if;
  -- el stock que la web tiene en esa opción pasa al color nuevo (nunca más de lo que hay en el de origen)
  select coalesce(sum(cantidad), 0) into actual from stock where variante_id = v.id;
  st := least(greatest(coalesce(it.stock, 0), 0), greatest(actual, 0));
  if st > 0 then
    select s.deposito_id into dep from stock s where s.variante_id = v.id and s.cantidad > 0 order by s.cantidad desc limit 1;
    dep := coalesce(dep, (select id from depositos where empresa_id = e and principal limit 1));
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, motivo, nota)
      values (e, v_id, dep, st, 'ajuste', 'Separar color', 'Separado de ' || coalesce((select nombre from atributos where id = v.color_id), 'sin color') || ' según la web (' || coalesce(it.valores, '') || ')'),
             (e, v.id, dep, -st, 'ajuste', 'Separar color', 'Pasa a ' || col || ' según la web (' || coalesce(it.valores, '') || ')');
  end if;
  update canal_items set variante_id = v_id, cruce = 'manual' where id = it.id;
  -- el de origen: si quedó vacío y sin conexiones, se apaga
  if coalesce((select sum(cantidad) from stock where variante_id = v.id), 0) <= 0 and not exists (select 1 from canal_items where variante_id = v.id) then
    update variantes set activa = false where id = v.id;
  end if;
  return jsonb_build_object('variante_id', v_id, 'creada', nuevo, 'stock_pasado', st);
end $$;
grant execute on function canal_separar_color(bigint, text) to authenticated;
