-- 067 · Lista = precio normal de la web, y las ofertas de la web pasan a ser una rebaja de Percha (27/10/2026, pedido de Diego)
-- Solo lo PUBLICADO en Tienda Nube (los ocultos no cuentan). Sin genéricos. Una prenda con dos publicaciones a distinto precio no se toca.
-- Queda en el historial de precios como un lote (se puede deshacer con precios_deshacer).
-- Con simular = true (primera línea) solo muestra lo que haría.

create temp table _cfg as select true as simular;   -- ← poner false para grabar

create temp table _w as
select ci.variante_id, v.producto_id,
       min(ci.precio) wmin, max(ci.precio) wmax,
       min(nullif(ci.precio_promo, 0)) pmin, max(nullif(ci.precio_promo, 0)) pmax,
       count(*) n, count(nullif(ci.precio_promo, 0)) npromo
from canal_items ci
join conexiones cx on cx.id = ci.conexion_id
join variantes v on v.id = ci.variante_id
join productos p on p.id = v.producto_id
where cx.canal = 'tiendanube' and (ci.publicado is not false or cx.incluir_ocultos) and p.activo and not p.es_generico and ci.precio > 0
group by ci.variante_id, v.producto_id;

-- precio normal por variante (solo si todas sus publicaciones coinciden)
create temp table _wv as select variante_id, producto_id, wmin precio,
  case when npromo = n and pmin = pmax and pmin < wmin then pmin end promo
from _w where wmin = wmax;

-- precio del producto = el más repetido entre sus talles/colores (a igualdad, el más alto)
create temp table _wp as
select distinct on (producto_id) producto_id, precio from (select producto_id, precio, count(*) c from _wv group by 1, 2) x order by producto_id, c desc, precio desc;

create temp table _cambios as
select 'producto' que, p.id producto_id, null::uuid variante_id, p.precio antes, w.precio despues
from productos p join _wp w on w.producto_id = p.id where p.precio is distinct from w.precio
union all
select 'variante', v.producto_id, v.id, v.precio, case when wv.precio = wp.precio then null else wv.precio end
from variantes v join _wv wv on wv.variante_id = v.id join _wp wp on wp.producto_id = v.producto_id
where v.precio is distinct from (case when wv.precio = wp.precio then null else wv.precio end);

-- ofertas: por producto si todos sus talles/colores tienen la misma; si no, por talle/color
create temp table _ofertas as
with g as (select producto_id, count(*) nv, count(promo) np, min(promo) pmin, max(promo) pmax, min(precio) wmin, max(precio) wmax from _wv group by 1)
select g.producto_id, null::uuid variante_id, g.pmin precio from g where g.np = g.nv and g.pmin = g.pmax and g.wmin = g.wmax
union all
select wv.producto_id, wv.variante_id, wv.promo from _wv wv join g on g.producto_id = wv.producto_id
where wv.promo is not null and not (g.np = g.nv and g.pmin = g.pmax and g.wmin = g.wmax);



do $$
declare e uuid; lote uuid; promo uuid; n1 int; n2 int;
begin
  if (select simular from _cfg) then return; end if;
  select empresa_id into e from productos where id = (select producto_id from _cambios limit 1);
  if e is null then select empresa_id into e from productos where id = (select producto_id from _ofertas limit 1); end if;
  insert into precio_lotes (empresa_id, descripcion, productos, cambios)
  values (e, 'Lista = precio normal de Tienda Nube (las ofertas de la web pasan a la rebaja "Ofertas de la web")', (select count(distinct producto_id) from _cambios), (select count(*) from _cambios))
  returning id into lote;
  perform set_config('percha.lote', lote::text, true);
  update productos p set precio = c.despues, modificado = now() from _cambios c where c.que = 'producto' and c.producto_id = p.id;
  get diagnostics n1 = row_count;
  update variantes v set precio = c.despues from _cambios c where c.que = 'variante' and c.variante_id = v.id;
  get diagnostics n2 = row_count;
  insert into promociones (empresa_id, nombre, tipo, valor, alcance, activa, canales, dias_semana)
  values (e, 'Ofertas de la web', 'rebaja', 0, 'productos', true, null, '{1,2,3,4,5,6,7}') returning id into promo;
  insert into rebaja_precios (empresa_id, promocion_id, producto_id, variante_id, precio)
  select e, promo, producto_id, variante_id, precio from _ofertas;
  raise notice 'lote % · productos % · variantes % · ofertas %', lote, n1, n2, (select count(*) from _ofertas);
end $$;

select json_build_object(
  'productos_cambian', (select count(*) from _cambios where que = 'producto'),
  'variantes_cambian', (select count(*) from _cambios where que = 'variante'),
  'productos_tocados', (select count(distinct producto_id) from _cambios),
  'ofertas_producto', (select count(*) from _ofertas where variante_id is null),
  'ofertas_variante', (select count(*) from _ofertas where variante_id is not null),
  'productos_con_oferta', (select count(distinct producto_id) from _ofertas),
  'sin_tocar_doble_precio', (select count(*) from _w where wmin <> wmax),
  'ejemplos', (select json_agg(x) from (select p.codigo, p.nombre, c.que, c.antes, c.despues from _cambios c join productos p on p.id = c.producto_id where c.que = 'producto' order by abs(coalesce(c.despues,0) - coalesce(c.antes,0)) desc limit 15) x)
) resumen;
