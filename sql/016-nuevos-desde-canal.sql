-- 016 · Productos nuevos desde el canal (el caso "bombachas varias": un solo SKU en el local, 184 modelos en Tienda Nube)
--   · proximo_codigo: código automático correlativo a partir del SKU compartido (100200 → 100202, 100203…)
--   · canal_crear_producto: crea en el local el producto tal cual está en el canal (nombre, foto, precio, variantes), lo cruza
--     y, si estaba apuntando a una "bolsa" (artículo único), le pasa el stock que el canal tenía
--   · v_canal_nuevos: productos del canal sin producto propio en el local
--   · stock_mover: conteo — pasa unidades de la bolsa al modelo
--   · stock_anterior en canal_cola: lo que decía el canal antes de cada envío (para poder volver atrás)

-- 1) atributo desde el canal: busca por nombre o código; si no existe lo crea. Talles "Único", "Único (S al XL)", "S al XL" = sin talle.
create or replace function atributo_desde_canal(e uuid, p_tipo text, p_nombre text) returns uuid
language plpgsql security definer set search_path = public as $$
declare a_id uuid; cod text; nom text;
begin
  nom := nullif(btrim(coalesce(p_nombre, '')), '');
  if nom is null then return null; end if;
  if p_tipo = 'talle' and (nom ~* '^[uú]nic[oa]' or nom ~* '\y(al|a)\y' or nom ~* '^talle [uú]nico') then return null; end if;
  select id into a_id from atributos where empresa_id = e and tipo = p_tipo and (lower(nombre) = lower(nom) or lower(codigo) = lower(nom)) limit 1;
  if a_id is not null then return a_id; end if;
  cod := upper(left(regexp_replace(translate(nom, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN'), '[^A-Za-z0-9]', '', 'g'), case when p_tipo = 'talle' then 6 else 3 end));
  if cod = '' then cod := upper(left(p_tipo, 1)) || floor(random() * 10000)::int; end if;
  -- si el código corto ya está usado por otro nombre, se alarga
  if exists (select 1 from atributos where empresa_id = e and tipo = p_tipo and codigo = cod) then cod := cod || '-' || floor(random() * 1000)::int; end if;
  insert into atributos (empresa_id, tipo, codigo, nombre, orden) values (e, p_tipo, cod, nom, 999) returning id into a_id;
  return a_id;
end $$;

-- 2) próximo código libre a partir de una base numérica (o base-1, base-2 si no es numérica)
create or replace function proximo_codigo(e uuid, p_base text) returns text
language plpgsql stable security definer set search_path = public as $$
declare n bigint; cod text; i int := 0;
begin
  if p_base ~ '^\d+$' then
    n := p_base::bigint;
    loop n := n + 1; cod := lpad(n::text, length(p_base), '0'); exit when not exists (select 1 from productos where empresa_id = e and codigo = cod); i := i + 1; if i > 100000 then raise exception 'Sin códigos libres'; end if; end loop;
  else
    loop i := i + 1; cod := coalesce(p_base, 'P') || '-' || i; exit when not exists (select 1 from productos where empresa_id = e and codigo = cod); end loop;
  end if;
  return cod;
end $$;

-- 3) crear en el local un producto del canal
create or replace function canal_crear_producto(p_conexion uuid, p_producto_ext text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e uuid; it record; prod_id uuid; cod text; base text; nom text; img text; pre numeric; cat uuid; dep uuid; bolsa variantes%rowtype;
        t_id uuid; c_id uuid; v_id uuid; st numeric; disponible numeric; n int := 0; tiene boolean := false; movidas numeric := 0;
begin
  select empresa_id into e from conexiones where id = p_conexion;
  if e is null or not es_admin(e) then raise exception 'Sin permiso'; end if;
  if not exists (select 1 from canal_items where conexion_id = p_conexion and producto_ext = p_producto_ext) then raise exception 'Ese producto no está en el canal'; end if;
  if exists (select 1 from canal_items ci join variantes v on v.id = ci.variante_id where ci.conexion_id = p_conexion and ci.producto_ext = p_producto_ext and (v.talle_id is not null or v.color_id is not null or v.estampa_id is not null)) then
    raise exception 'Ya está cruzado a un producto del local con talle/color';
  end if;
  select coalesce(ci.sku, ci.mpn), ci.nombre, ci.imagen into base, nom, img from canal_items ci where ci.conexion_id = p_conexion and ci.producto_ext = p_producto_ext order by ci.id limit 1;
  select min(precio) into pre from canal_items where conexion_id = p_conexion and producto_ext = p_producto_ext and precio > 0;
  -- la "bolsa": la variante única a la que hoy apuntan (si apuntan a alguna)
  select v.* into bolsa from canal_items ci join variantes v on v.id = ci.variante_id where ci.conexion_id = p_conexion and ci.producto_ext = p_producto_ext limit 1;
  cat := coalesce((select categoria_id from productos where id = bolsa.producto_id), (select categoria_id from productos where empresa_id = e and codigo = base limit 1),
                  -- sin pista por código: la familia más común de los productos que empiezan igual ("LESS …" → Bombachas, "CONJUNTO …" → Conjuntos)
                  (select categoria_id from productos where empresa_id = e and categoria_id is not null and upper(split_part(nombre, ' ', 1)) = upper(split_part(nom, ' ', 1)) group by categoria_id order by count(*) desc limit 1));
  dep := (select id from depositos where empresa_id = e and principal limit 1);
  -- si en el local ya existe un producto con ese mismo nombre (p.ej. CULOTTELESS «SEAMLESS» 100183), se usa ese: no se duplica
  select id, codigo into prod_id, cod from productos where empresa_id = e and activo and tipo = 'prenda' and id is distinct from bolsa.producto_id
    and lower(regexp_replace(nombre, '\s+', ' ', 'g')) = lower(regexp_replace(nom, '\s+', ' ', 'g')) order by creado limit 1;
  if prod_id is null then
    cod := proximo_codigo(e, coalesce(base, 'P'));
    insert into productos (empresa_id, codigo, nombre, categoria_id, precio, tipo, imagen_url, descripcion)
    values (e, cod, nom, cat, coalesce(pre, 0), 'prenda', img, 'Creado desde el canal · SKU compartido ' || coalesce(base, '')) returning id into prod_id;
  else
    update productos set imagen_url = coalesce(imagen_url, img) where id = prod_id;
  end if;
  for it in select * from canal_items where conexion_id = p_conexion and producto_ext = p_producto_ext order by id loop
    t_id := atributo_desde_canal(e, 'talle', it.talle_canal);
    c_id := atributo_desde_canal(e, 'color', it.color_canal);
    if t_id is not null or c_id is not null then tiene := true; end if;
    select id into v_id from variantes where producto_id = prod_id and talle_id is not distinct from t_id and color_id is not distinct from c_id and estampa_id is null;
    if v_id is null then
      insert into variantes (empresa_id, producto_id, talle_id, color_id, sku, ean, precio)
      values (e, prod_id, t_id, c_id,
              cod || coalesce('-' || (select codigo from atributos where id = t_id), '') || coalesce('-' || (select codigo from atributos where id = c_id), ''),
              nullif(it.barcode, ''), case when it.precio is not null and it.precio > 0 and it.precio <> coalesce(pre, 0) then it.precio end)
      returning id into v_id;
    end if;
    st := coalesce(it.stock, 0);
    if st > 0 then
      insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (e, v_id, dep, st, 'ajuste', 'Alta desde el canal: ' || it.nombre || ' (' || coalesce(it.valores, '') || ') toma el stock publicado');
      if bolsa.id is not null then
        disponible := coalesce((select sum(cantidad) from stock where variante_id = bolsa.id), 0);
        if disponible > 0 then
          insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (e, bolsa.id, dep, -least(st, disponible), 'ajuste', 'Pasa a ' || cod || ' ' || nom || ' (' || coalesce(it.valores, '') || ')');
          movidas := movidas + least(st, disponible);
        end if;
      end if;
    end if;
    update canal_items set variante_id = v_id, cruce = 'manual' where id = it.id;
    n := n + 1;
  end loop;
  update productos set tiene_variantes = tiene or tiene_variantes where id = prod_id;
  return jsonb_build_object('producto_id', prod_id, 'codigo', cod, 'nombre', nom, 'variantes', n, 'stock_movido', movidas);
end $$;

-- varios de una vez (devuelve lo creado y los errores, sin cortar)
create or replace function canal_crear_productos(p_conexion uuid, p_exts text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x text; r jsonb; creados jsonb := '[]'::jsonb; errores jsonb := '[]'::jsonb;
begin
  foreach x in array p_exts loop
    begin
      r := canal_crear_producto(p_conexion, x); creados := creados || r;
    exception when others then errores := errores || jsonb_build_object('producto_ext', x, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('creados', creados, 'errores', errores);
end $$;

-- 4) productos del canal que no tienen producto propio en el local
--    sin_cruzar: ninguna variante cruzada · bolsa: cruzadas a un artículo único que recibe ≥3 productos del canal con nombres distintos
drop view if exists v_canal_nuevos;
create view v_canal_nuevos with (security_invoker = true) as
with g as (
  select ci.conexion_id, ci.empresa_id, ci.producto_ext, min(ci.nombre) nombre, min(coalesce(ci.sku, ci.mpn)) sku, min(ci.imagen) imagen, min(ci.url) url,
         count(*) variantes, sum(ci.stock) stock, min(ci.precio) precio, bool_or(coalesce(ci.publicado, true)) publicado,
         count(ci.variante_id) cruzadas,
         (array_agg(v.producto_id) filter (where v.id is not null and v.talle_id is null and v.color_id is null and v.estampa_id is null))[1] bolsa_producto_id,
         bool_or(v.talle_id is not null or v.color_id is not null or v.estampa_id is not null) a_variante_real,
         regexp_replace(min(ci.nombre), '»\s*.*$', '»') nombre_base
  from canal_items ci left join variantes v on v.id = ci.variante_id
  group by ci.conexion_id, ci.empresa_id, ci.producto_ext
), bolsas as (
  select conexion_id, bolsa_producto_id, count(distinct nombre_base) modelos from g where bolsa_producto_id is not null group by 1, 2
)
select g.conexion_id, g.empresa_id, g.producto_ext, g.nombre, g.sku, g.imagen, g.url, g.variantes, g.stock, g.precio, g.publicado,
       g.bolsa_producto_id, p.codigo bolsa_codigo, p.nombre bolsa_nombre, b.modelos bolsa_modelos,
       (g.nombre ~* '\y(box|combo|pack|kit|set)\y') es_pack,
       case when g.cruzadas = 0 then 'sin_cruzar' else 'bolsa' end estado
from g left join bolsas b on b.conexion_id = g.conexion_id and b.bolsa_producto_id = g.bolsa_producto_id
       left join productos p on p.id = g.bolsa_producto_id
where g.cruzadas = 0 or (b.modelos >= 3 and not g.a_variante_real);

create or replace function resumen_conexion(c uuid) returns json
language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'items', (select count(*) from canal_items where conexion_id = c),
    'cruzados', (select count(*) from canal_items where conexion_id = c and variante_id is not null),
    'sin_cruzar', (select count(*) from canal_items where conexion_id = c and variante_id is null),
    'stock_distinto', (select count(*) from v_cruce_canal where conexion_id = c and estado_stock = 'distinto'),
    'percha_sin_publicar', (select count(*) from v_variantes_sin_canal where conexion_id = c),
    'nuevos', (select count(*) from v_canal_nuevos where conexion_id = c and not es_pack),
    'ultima_sync', (select ultima_sync from conexiones where id = c)
  );
$$;

-- 5) conteo: pasar unidades de una variante (la bolsa) a otra (el modelo). p_desde null = solo suma.
create or replace function stock_mover(p_desde uuid, p_hacia uuid, p_cantidad numeric, p_nota text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e uuid; e2 uuid; dep uuid; queda numeric;
begin
  select empresa_id into e from variantes where id = p_hacia;
  if e is null or not es_miembro(e) or rol_en(e) = 'visor' then raise exception 'Sin permiso'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'La cantidad tiene que ser mayor a cero'; end if;
  dep := (select id from depositos where empresa_id = e and principal limit 1);
  if p_desde is not null then
    select empresa_id into e2 from variantes where id = p_desde;
    if e2 is distinct from e then raise exception 'Sin permiso'; end if;
    if p_desde = p_hacia then raise exception 'Origen y destino son la misma variante'; end if;
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (e, p_desde, dep, -p_cantidad, 'ajuste', coalesce(p_nota, 'Conteo'));
  end if;
  insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (e, p_hacia, dep, p_cantidad, 'ajuste', coalesce(p_nota, 'Conteo'));
  queda := case when p_desde is null then null else coalesce((select sum(cantidad) from stock where variante_id = p_desde), 0) end;
  return jsonb_build_object('queda_en_origen', queda, 'destino', coalesce((select sum(cantidad) from stock where variante_id = p_hacia), 0));
end $$;

-- 6) memoria del canal antes de cada envío (para volver atrás)
alter table canal_cola add column if not exists stock_anterior numeric(12,3);
alter table canal_cola add column if not exists stock_enviado numeric(12,3);

select (select count(*) from v_canal_nuevos where not es_pack) nuevos_sin_pack, (select count(*) from v_canal_nuevos where es_pack) packs;
