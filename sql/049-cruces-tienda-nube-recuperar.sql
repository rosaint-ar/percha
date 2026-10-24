-- 049 · Cruces con Tienda Nube: protección y recuperación (24/10/2026)
--   La sincronización (edge tn-sync) leía los cruces manuales sin paginar: la base devuelve de a 1000 filas y el resto se perdía
--   (quedaron 1000 "manual" y 1026 sin cruzar). Arreglo en la base, sin depender de la función:
--   · disparador: si la sincronización (service_role) intenta pisar un cruce manual, se conserva. Desvincular desde la
--     pantalla (usuario) sigue funcionando.
--   · recuperación SOLO del vínculo (no toca stock): por nombre + talle + color iguales (sin ambigüedad) y los vínculos
--     escritos a mano en la 034 (Camille Aqua & rosa, Martha Soft Gris Skip y las 50 que estaban sin cruzar).

create or replace function canal_items_cuidar_manual() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '') = 'service_role'
     and old.cruce = 'manual' and old.variante_id is not null and new.cruce is distinct from 'manual' then
    new.variante_id := old.variante_id; new.cruce := 'manual';
  end if;
  return new;
end $$;
drop trigger if exists canal_items_cuidar_manual on canal_items;
create trigger canal_items_cuidar_manual before update on canal_items for each row execute function canal_items_cuidar_manual();

create temp table antes as select count(*) filter (where variante_id is null) sin from canal_items;

-- 1) mismo nombre, talle y color (una sola coincidencia)
with cand as (
  select ci.id item, v.id var
  from canal_items ci
  join productos p on p.empresa_id = ci.empresa_id and lower(translate(p.nombre, 'ÁÉÍÓÚáéíóú', 'AEIOUaeiou')) = lower(translate(ci.nombre, 'ÁÉÍÓÚáéíóú', 'AEIOUaeiou'))
  join variantes v on v.producto_id = p.id
  left join atributos t on t.id = v.talle_id left join atributos c on c.id = v.color_id
  where ci.variante_id is null
    and (case when nullif(ci.color_canal, '') is null then v.color_id is null else lower(c.nombre) = lower(btrim(ci.color_canal)) or lower(c.codigo) = lower(btrim(ci.color_canal)) end)
    and (case when nullif(ci.talle_canal, '') is null or ci.talle_canal ~* '^[uú]nic|\y(al|a)\y' then v.talle_id is null else lower(t.nombre) = lower(btrim(ci.talle_canal)) or lower(t.codigo) = lower(btrim(ci.talle_canal)) end)),
unicos as (select item, min(var::text)::uuid var from cand group by item having count(*) = 1)
update canal_items ci set variante_id = u.var, cruce = 'manual' from unicos u where u.item = ci.id;

-- 2) los vínculos de la 034 (sin tocar stock)
with x(nom, sku, color) as (values ('CONJUNTO «CAMILLE» AQUA & ROSA', '200103', 'Aqua y rosa'), ('CONJUNTO «MARTHA SOFT» GRIS SKIP', '200204', 'Gris Skip')),
m as (
  select ci.id item, (select v.id from variantes v join productos p on p.id = v.producto_id
                      left join atributos t on t.id = v.talle_id left join atributos c on c.id = v.color_id
                      where p.empresa_id = ci.empresa_id and p.codigo = x.sku and lower(c.nombre) = lower(x.color)
                        and (nullif(ci.talle_canal, '') is null and v.talle_id is null or lower(t.nombre) = lower(ci.talle_canal)) limit 1) var
  from canal_items ci join x on ci.nombre = x.nom where ci.variante_id is null)
update canal_items ci set variante_id = m.var, cruce = 'manual' from m where m.item = ci.id and m.var is not null;

with x(item, sku, talle, color) as (values
  (11, '300103', '95', 'Negro'),
  (85, '200116', '90', 'Negro'),
  (86, '200116', '95', 'Negro'),
  (90, '200116', '90', 'Rojo'),
  (91, '200116', '95', 'Rojo'),
  (33, '200122', '115', 'Blanco'),
  (388, '200502', '90', 'Negro'),
  (389, '200502', '95', 'Negro'),
  (390, '200502', '100', 'Negro'),
  (391, '200502', '105', 'Negro'),
  (26, '200122', '115', 'Negro'),
  (448, '200141', '80', 'Negro'),
  (3005, '600306', 'S', 'Margaritas'),
  (3006, '600306', 'M', 'Margaritas'),
  (3007, '600306', 'L/XL', 'Margaritas'),
  (3009, '500135', 'M', 'Cherry'),
  (3010, '500135', 'L/XL', 'Cherry'),
  (2926, '600401', '85', 'Aqua'),
  (2929, '600401', '85', 'Negro'),
  (152, '200111', '90', 'Negro'),
  (153, '200111', '95', 'Negro'),
  (275, '500102', 'L', 'Negro'),
  (287, '300103', '95', 'Rojo'),
  (793, '600201', 'M', 'Coral'),
  (796, '600201', 'M', 'Negro'),
  (799, '600202', 'M', 'Negro'),
  (1068, '200402', 'M', 'Salmón'),
  (1164, '500108', 'S/M', 'Ardilla'),
  (1192, '500108', 'S/M', 'Oveja'),
  (1221, '900202', 'Talle 1', 'Negro'),
  (1223, '900202', 'Talle 3', 'Negro'),
  (1224, '900202', 'Talle 4', 'Negro'),
  (1226, '900202', 'Talle 1', 'Piel'),
  (1228, '900202', 'Talle 3', 'Piel'),
  (1229, '900202', 'Talle 4', 'Piel'),
  (2656, '600301', 'S/M', 'Margaritas'),
  (2657, '600301', 'L/XL', 'Margaritas'),
  (2664, '600302', 'XS', 'Margaritas'),
  (2665, '600302', 'S/M', 'Margaritas'),
  (2666, '600302', 'L/XL', 'Margaritas'),
  (2733, '600303', 'XS', 'Margaritas'),
  (2734, '600303', 'S', 'Margaritas'),
  (2735, '600303', 'M', 'Margaritas'),
  (2736, '600303', 'L', 'Margaritas'),
  (2749, '600304', 'Único', 'Margaritas'),
  (2923, '600401', '85', 'Cebra'),
  (2996, '600306', 'S', 'Batik verde'),
  (2997, '600306', 'M', 'Batik verde'),
  (2998, '600306', 'L/XL', 'Batik verde'),
  (3074, '400202', '90', 'Negro')
), m as (
  select x.item, (select v.id from variantes v join productos p on p.id = v.producto_id
                  left join atributos t on t.id = v.talle_id left join atributos c on c.id = v.color_id
                  where p.codigo = x.sku and p.empresa_id = ci.empresa_id
                    and (x.talle is null and v.talle_id is null or lower(t.nombre) = lower(x.talle))
                    and (x.color is null and v.color_id is null or lower(c.nombre) = lower(x.color)) limit 1) var
  from x join canal_items ci on ci.id = x.item)
update canal_items ci set variante_id = m.var, cruce = 'manual' from m where m.item = ci.id and ci.variante_id is null and m.var is not null;

select jsonb_build_object('sin_antes', (select sin from antes), 'sin_ahora', (select count(*) from canal_items where variante_id is null),
  'pub_con_stock_sin_cruzar', (select jsonb_agg(jsonb_build_object('n', nombre, 'v', valores, 'sku', sku, 'st', stock)) from canal_items where variante_id is null and publicado and coalesce(stock, 0) > 0),
  'cruce', (select jsonb_object_agg(k, n) from (select coalesce(cruce, 'null') || case when variante_id is null then '·sin' else '·con' end k, count(*) n from canal_items group by 1) z)) r;
