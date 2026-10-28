-- 071 · Separar publicaciones de la web que estaban unidas a una misma prenda de Percha (27/10/2026, OK de Diego)
-- Cada publicación queda con su prenda en Percha, con el precio, la oferta y el stock de la web.
--  · 'color'    → color nuevo del mismo modelo (mismo talle que tenía), p. ej. Alice Rosa, Chanel Negro deluxe
--  · 'producto' → producto nuevo (otra prenda), p. ej. Pijama Eva manga corta, Guantes Savage, sabores de Love Potion
--  · 'principal'→ la publicación que se queda con la prenda de Percha: su precio y su oferta pasan a Percha
-- Packs x3/x7 de bombachas (bolsa de modelos) no se tocan.

create temp table _plan (producto_ext text, modo text, color text);
insert into _plan values
  -- Conjunto Alice
  ('193846567', 'principal', null), ('146080617', 'color', 'Rosa'),
  ('193846565', 'principal', null), ('161053313', 'color', 'Verde militar'),
  -- Conjunto Chanel: el Negro se queda; el Deluxe es otro color
  ('154676119', 'principal', null), ('156433691', 'color', 'Negro deluxe'),
  -- Conjunto Emma Soft Negro: el Deluxe es otro color
  ('80540147',  'principal', null), ('198141385', 'color', 'Negro deluxe'),
  -- Conjunto Martha Classic Blanco: el "s/ coleta" se queda (mismo precio que Percha); el otro es "Blanco con coleta"
  ('63428556',  'principal', null), ('114804988', 'color', 'Blanco con coleta'),
  -- Maxibuzo Alaska Stars Grey
  ('220997376', 'principal', null), ('206724516', 'color', 'Grey'), ('216201838', 'color', 'Little Stars Grey'),
  -- Pantalón Alaska Beige
  ('347530896', 'principal', null), ('260220312', 'color', 'Doble estrella beige'), ('262060035', 'color', 'Beige estrellas'),
  -- Pijama Eva camisero Green / manga corta
  ('332076421', 'principal', null), ('332786367', 'producto', null),
  -- Guantes Luxury / de red Savage
  ('182419641', 'principal', null), ('285834218', 'producto', null),
  -- Aceite Sens Bomb Sándalo rojo / Maca
  ('198769114', 'principal', null), ('198769115', 'producto', null),
  -- Love Potion 30 ml: Frutilla y Frutos rojos (12.390) se quedan; Dulce de leche (11.280) aparte
  ('198769112', 'principal', null), ('198769113', 'principal', null), ('250776268', 'producto', null),
  -- Mini Love Potion 15 ml: los 4 de 11.250 se quedan; Algodón de azúcar y Mint cream (10.140) aparte
  ('176560740', 'principal', null), ('176560743', 'principal', null), ('176560745', 'principal', null), ('177018712', 'principal', null),
  ('198769108', 'producto', null), ('198769110', 'producto', null),
  -- Pantumedias: Animalitos y Print se quedan; Medias largas térmicas aparte
  ('214822439', 'principal', null), ('354795740', 'principal', null), ('267934342', 'producto', null);

create temp table _it as
select p.modo, p.color, ci.id item, ci.producto_ext, ci.variante_id vieja, ci.stock, ci.precio, nullif(ci.precio_promo, 0) promo, ci.conexion_id, v.producto_id, v.talle_id, v.empresa_id
from _plan p join canal_items ci on ci.producto_ext = p.producto_ext and ci.publicado join variantes v on v.id = ci.variante_id;
grant select, update on _it to authenticated; grant select on _plan to authenticated;

select set_config('request.jwt.claims', '{"sub":"5f43c17d-958a-4ef7-badc-1a4001a20747","role":"authenticated"}', true);


do $$
declare e uuid; lote uuid; promo uuid; dep uuid; r record; c_id uuid; v_new uuid; pprecio numeric; res jsonb; px text; n_col int := 0; n_prod int := 0; n_pre int := 0; n_of int := 0;
begin
  select empresa_id into e from _it limit 1;
  select id into promo from promociones where empresa_id = e and tipo = 'rebaja' and nombre = 'Ofertas de la web';
  dep := (select id from depositos where empresa_id = e and principal limit 1);
  insert into precio_lotes (empresa_id, descripcion, productos, cambios) values (e, 'Separar publicaciones de la web unidas a una misma prenda', 0, 0) returning id into lote;
  perform set_config('percha.lote', lote::text, true);

  -- 0) una oferta cargada para todo el producto (Chanel $24.375) pasa a cada talle/color que la tenía,
  --    así la publicación que no tiene oferta (Chanel Negro $30.280) no la hereda
  insert into rebaja_precios (empresa_id, promocion_id, producto_id, variante_id, precio)
  select e, promo, v.producto_id, v.id, rp.precio from rebaja_precios rp join variantes v on v.producto_id = rp.producto_id and v.activa
  where rp.promocion_id = promo and rp.variante_id is null and rp.producto_id in (select producto_id from _it)
  on conflict (promocion_id, producto_id, coalesce(variante_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
  delete from rebaja_precios where promocion_id = promo and variante_id is null and producto_id in (select producto_id from _it);

  -- 1) colores nuevos del mismo modelo
  for r in select * from _it where modo = 'color' loop
    c_id := atributo_desde_canal(e, 'color', r.color);
    select id into v_new from variantes where producto_id = r.producto_id and talle_id is not distinct from r.talle_id and color_id = c_id and estampa_id is null;
    if v_new is null then
      insert into variantes (empresa_id, producto_id, talle_id, color_id, sku)
      values (e, r.producto_id, r.talle_id, c_id, (select codigo from productos where id = r.producto_id) || coalesce('-' || (select codigo from atributos where id = r.talle_id), '') || '-' || (select codigo from atributos where id = c_id))
      returning id into v_new;
      n_col := n_col + 1;
    end if;
    select precio into pprecio from productos where id = r.producto_id;
    update variantes set precio = case when r.precio = pprecio then null else r.precio end, activa = true where id = v_new;
    if coalesce(r.stock, 0) > 0 then
      insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (e, v_new, dep, r.stock, 'ajuste', 'Separada de otra publicación de la web: toma su stock');
      insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (e, r.vieja, dep, -r.stock, 'ajuste', 'Pasa a ' || r.color);
    end if;
    update canal_items set variante_id = v_new, cruce = 'manual', actualizado = now() where id = r.item;
    if r.promo is not null and r.promo < r.precio then
      insert into rebaja_precios (empresa_id, promocion_id, producto_id, variante_id, precio) values (e, promo, r.producto_id, v_new, r.promo)
      on conflict (promocion_id, producto_id, coalesce(variante_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set precio = excluded.precio;
      n_of := n_of + 1;
    end if;
  end loop;

  -- 2) productos nuevos (otra prenda): se descruza y se crea desde la web; el stock que toma sale de la prenda vieja
  for px in select distinct producto_ext from _it where modo = 'producto' loop
    update canal_items set variante_id = null, cruce = 'ninguno' where producto_ext = px and publicado;
    res := canal_crear_producto((select conexion_id from _it where producto_ext = px limit 1), px);
    n_prod := n_prod + 1;
    for r in select * from _it where producto_ext = px and coalesce(stock, 0) > 0 loop
      insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (e, r.vieja, dep, -r.stock, 'ajuste', 'Pasa a ' || (res->>'codigo') || ' ' || (res->>'nombre'));
    end loop;
    -- su oferta de la web
    for r in select it.*, ci.variante_id nueva, v.producto_id nprod from _it it join canal_items ci on ci.id = it.item join variantes v on v.id = ci.variante_id where it.producto_ext = px and it.promo is not null and it.promo < it.precio loop
      insert into rebaja_precios (empresa_id, promocion_id, producto_id, variante_id, precio) values (e, promo, r.nprod, r.nueva, r.promo)
      on conflict (promocion_id, producto_id, coalesce(variante_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set precio = excluded.precio;
      n_of := n_of + 1;
    end loop;
  end loop;

  -- 3) la publicación principal: su precio y su oferta quedan en la prenda de Percha
  for r in select * from _it where modo = 'principal' loop
    select precio into pprecio from productos where id = r.producto_id;
    update variantes set precio = case when r.precio = pprecio then null else r.precio end where id = r.vieja and coalesce(precio, pprecio) is distinct from r.precio;
    if found then n_pre := n_pre + 1; end if;
    delete from rebaja_precios where promocion_id = promo and variante_id = r.vieja;
    if r.promo is not null and r.promo < r.precio then
      insert into rebaja_precios (empresa_id, promocion_id, producto_id, variante_id, precio) values (e, promo, r.producto_id, r.vieja, r.promo);
      n_of := n_of + 1;
    end if;
  end loop;
  -- la oferta a nivel producto no debe pisar a las variantes separadas: si había, pasa a las variantes que la tenían en la web (ninguna en este lote)
  update precio_lotes set productos = (select count(distinct producto_id) from _it), cambios = n_pre where id = lote;
  raise notice 'colores nuevos % · productos nuevos % · precios % · ofertas %', n_col, n_prod, n_pre, n_of;
end $$;


-- cómo quedó: cada publicación con su prenda de Percha y el precio que da Percha (normal y oferta)
select json_agg(x order by x.web) from (
  select ci.nombre || ' ' || coalesce(ci.valores, '') web, ci.precio web_precio, nullif(ci.precio_promo, 0) web_oferta,
    vv.producto_codigo || ' ' || vv.producto_nombre || ' · ' || concat_ws(' · ', vv.talle_nombre, vv.color_nombre) percha, vv.precio percha_precio,
    coalesce((select r.precio from rebaja_precios r join promociones pr on pr.id = r.promocion_id where pr.nombre = 'Ofertas de la web' and r.variante_id = vv.id),
             (select r.precio from rebaja_precios r join promociones pr on pr.id = r.promocion_id where pr.nombre = 'Ofertas de la web' and r.producto_id = vv.producto_id and r.variante_id is null)) percha_oferta,
    vv.stock percha_stock, ci.stock web_stock
  from canal_items ci join v_variantes vv on vv.id = ci.variante_id where ci.producto_ext in (select producto_ext from _plan) and ci.publicado) x;
