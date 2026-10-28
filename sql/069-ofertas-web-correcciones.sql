-- 069 · Correcciones de la revisión de precios contra la web (27/10/2026, OK de Diego)
-- 1) Ofertas reales que no habían quedado en "Ofertas de la web": Pantuflón Capibara Kids $20.000, Emma Soft Negro $30.000,
--    Pijama Angie Rosa $58.750.
-- 2) Publicaciones sin stock con el precio normal corrido (−$1.110) quedan como sus hermanas:
--    Maxibuzo Alaska Corazón Fucsia / Light Blue / Puppy Foot / Print Pink 60.000 → 55.000 · Bata Alaska Little Stars Grey 75.000 → 65.000
--    · Top Margaery Negro 100 30.000 → 22.500. Cherry Blossom Blanco: 20.000 sin oferta (ya es así en Percha).
-- 3) "Pijama Clara Rosa" no existe (Diego): esa publicación de la web se descruza (manual, para que la sincronización no la vuelva a unir al Angi).

create temp table _obj (producto_ext text, valores_like text, precio numeric, oferta numeric);
insert into _obj values
  ('263081381', 'Kids%',  null,  20000),   -- Pantuflón Capibara, talle Kids (Marrón oscuro y Camel)
  ('80540147',  '%',      null,  30000),   -- Conjunto Emma Soft Negro
  ('342317349', '%',      null,  58750),   -- Pijama Angie Algodón Rosa
  ('260220326', '%',      60000, 55000),   -- Maxibuzo Alaska Corazón Fucsia
  ('206724517', '%',      60000, 55000),   -- Maxibuzo Alaska Light Blue
  ('216121855', '%',      60000, 55000),   -- Maxibuzo Alaska Puppy Foot
  ('213110172', '%',      60000, 55000),   -- Maxibuzo Alaska Print Pink
  ('260220363', '%',      75000, 65000),   -- Bata Alaska Little Stars Grey
  ('71225437',  '%100%',  30000, 22500);   -- Top Margaery Negro, talle 100

create temp table _v as
select distinct ci.variante_id, v.producto_id, o.precio, o.oferta, p.precio precio_producto
from _obj o join canal_items ci on ci.producto_ext = o.producto_ext and coalesce(ci.valores, '') like o.valores_like
join variantes v on v.id = ci.variante_id join productos p on p.id = v.producto_id
where ci.variante_id is not null;

do $$
declare e uuid; lote uuid; promo uuid; n1 int; n2 int; n3 int;
begin
  select empresa_id into e from productos where id = (select producto_id from _v limit 1);
  select id into promo from promociones where empresa_id = e and tipo = 'rebaja' and nombre = 'Ofertas de la web';
  if promo is null then raise exception 'No está la rebaja "Ofertas de la web"'; end if;
  -- precio normal (queda en el historial como un lote)
  insert into precio_lotes (empresa_id, descripcion, productos, cambios)
  values (e, 'Revisión web: precio normal de 6 publicaciones sin stock como sus hermanas', (select count(distinct producto_id) from _v where precio is not null), (select count(*) from _v where precio is not null))
  returning id into lote;
  perform set_config('percha.lote', lote::text, true);
  update variantes v set precio = case when x.precio = x.precio_producto then null else x.precio end
  from _v x where x.variante_id = v.id and x.precio is not null and coalesce(v.precio, x.precio_producto) is distinct from x.precio;
  get diagnostics n1 = row_count;
  -- ofertas por talle/color
  insert into rebaja_precios (empresa_id, promocion_id, producto_id, variante_id, precio)
  select e, promo, producto_id, variante_id, oferta from _v
  on conflict (promocion_id, producto_id, coalesce(variante_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set precio = excluded.precio;
  get diagnostics n2 = row_count;
  -- Pijama Clara Rosa: no existe → la publicación se descruza
  update canal_items set variante_id = null, cruce = 'manual', actualizado = now() where producto_ext = '342318083';
  get diagnostics n3 = row_count;
  raise notice 'precios % · ofertas % · descruzados %', n1, n2, n3;
end $$;

select json_build_object('variantes', (select count(*) from _v), 'detalle', (select json_agg(x) from (select p.nombre, vv.talle_nombre, vv.color_nombre, coalesce(v.precio, p.precio) precio,
  (select r.precio from rebaja_precios r join promociones pr on pr.id = r.promocion_id where pr.nombre = 'Ofertas de la web' and r.variante_id = v.id) oferta
  from _v x join variantes v on v.id = x.variante_id join productos p on p.id = v.producto_id join v_variantes vv on vv.id = v.id order by 1, 2, 3) x),
  'clara_rosa', (select json_agg(json_build_object('v', valores, 'var', variante_id, 'cruce', cruce)) from canal_items where producto_ext = '342318083'));
