-- 023 · Pijamas: un producto por modelo (el color/estampa es variante), nombres con tela y corte después del «modelo».
--   Mismo problema que conjuntos: TN tiene un producto por estampa (MAXIBUZO «ALASKA» MICKEY AZUL ×30, PANTALÓN «ALASKA» ×23, BATA «ALASKA» ×13, PIJAMA «WARM» CAMISERO ×10…).
--   Regla de fusión: el producto de color tiene un solo color (o ninguno) y su base es (a) el producto cuyo código es el SKU que tiene en TN y comparte «modelo»,
--   o (b) el producto cuyo nombre es el suyo sin las últimas palabras y comparte «modelo». Lo que no encaja se resuelve a mano abajo.

-- 1) camisones cargados dos y tres veces en FactuSOL con el mismo nombre (sin colores, distintos talles): se juntan
select producto_fusionar_en(de, a, null) from (values ('500147','500146'), ('500145','500144'), ('500149','500148'), ('500150','500148')) m(de, a);

-- 2) fusiones automáticas color → modelo
do $$
declare r record; res text;
begin
  for r in
    with pij as (
      select p.id, p.codigo, p.nombre, substring(p.nombre from '«([^»]*)»') modelo,
        (select string_agg(distinct co.nombre, ', ') from variantes v join atributos co on co.id = v.color_id where v.producto_id = p.id) colores,
        (select count(distinct v.color_id) from variantes v where v.producto_id = p.id) ncol,
        (select min(ci.sku) from canal_items ci join variantes v on v.id = ci.variante_id where v.producto_id = p.id) sku_tn
      from productos p join categorias c on c.id = p.categoria_id where c.nombre = 'PIJAMAS' and p.tipo = 'prenda' and p.nombre !~ '\y(BOX|COMBO|PACK|KIT)\y'
    )
    select d.codigo de, d.colores color, coalesce(
        (select b.codigo from pij b where b.codigo = d.sku_tn and b.id <> d.id and b.modelo = d.modelo),
        (select b.codigo from pij b where b.id <> d.id and b.modelo = d.modelo and d.nombre like b.nombre || ' %' order by length(b.nombre) desc limit 1)
      ) a
    from pij d where d.ncol <= 1 and d.modelo is not null
  loop
    if r.a is not null then
      res := producto_fusionar_en(r.de, r.a, case when r.color = '[UNISEX]' then null else r.color end);
      raise notice '%', res;
    end if;
  end loop;
end $$;

-- 3) los que el SKU de TN mandaba a otro modelo (Emi reusó códigos): a mano
select producto_fusionar_en(de, a, color) from (values
  ('500274','500158','Off White'), ('500164','500105','Azul Marino'), ('500266','500143','Cat'), ('500275','500159','Negro'),
  ('500276','500161','Crudo flores gris'), ('500263','500140','Print'), ('500242','500121','Negro'), ('500243','500122',null), ('500241','500120',null)
) m(de, a, color);

-- 4) nombres: tela y corte van después del «modelo», en orden fijo: corte · tela · extras. Acentos. "SIN MANGA" → "S/ MANGAS".
create or replace function nombre_ordenado_pijama(p_nombre text) returns text
language plpgsql stable as $$
declare pref text := ''; cuerpo text; tipo text; modelo text; antes text; despues text; ap_antes text; ap_despues text; toks text[]; ordenado text;
        tecnicas text := '\m(CAMISERO|MANGA CORTA|MANGA LARGA|S/ MANGAS|S/MANGAS|SIN MANGAS?|TIRITAS|BOTONES|MODAL|MORLEY|PLUSH|POLAR SOFT|POLAR|SATÉN|ALGODÓN|CORDERITO|MATERNAL)\M';
begin
  cuerpo := btrim(regexp_replace(p_nombre, '\s+', ' ', 'g'));
  cuerpo := regexp_replace(cuerpo, '\m(SIN MANGAS?|S/MANGAS)\M', 'S/ MANGAS', 'g');
  if cuerpo ~ '^(\[PACK x\d+\]|PACK X\d+|COMBO X\d+)\s+' then pref := substring(cuerpo from '^(\[PACK x\d+\]|PACK X\d+|COMBO X\d+)') || ' '; cuerpo := btrim(regexp_replace(cuerpo, '^(\[PACK x\d+\]|PACK X\d+|COMBO X\d+)\s+', '')); end if;
  modelo := substring(cuerpo from '«([^»]*)»');
  if modelo is null or cuerpo ~ '^«' then return p_nombre; end if;
  tipo := split_part(cuerpo, ' ', 1);
  antes := btrim(regexp_replace(substring(cuerpo from '^(.*?)«'), '^\S+\s*', ''));
  despues := btrim(coalesce(substring(cuerpo from '»(.*)$'), ''));
  ap_antes := btrim(regexp_replace(regexp_replace(antes, tecnicas, '', 'g'), '\s+', ' ', 'g'));
  ap_despues := btrim(regexp_replace(regexp_replace(despues, tecnicas, '', 'g'), '\s+', ' ', 'g'));
  toks := regexp_split_to_array(btrim(regexp_replace(antes || ' ' || despues, '\s+', ' ', 'g')), ' ');
  select string_agg(tok, ' ' order by prio, pos) into ordenado from (
    select tok, pos,
      case when tok in ('CAMISERO','MANGA','CORTA','LARGA','S/','MANGAS','TIRITAS','BOTONES') then 1
           when tok in ('MODAL','MORLEY','PLUSH','POLAR','SOFT','SATÉN','ALGODÓN','CORDERITO') then 2
           when tok = 'MATERNAL' then 3
           else null end prio
    from unnest(toks) with ordinality as u(tok, pos) where tok <> '') x where prio is not null;
  return btrim(regexp_replace(pref || tipo || ' «' || btrim(concat_ws(' ', nullif(ap_antes, ''), modelo)) || '»' || coalesce(' ' || nullif(ap_despues, ''), '') || coalesce(' ' || ordenado, ''), '\s+', ' ', 'g'));
end $$;

update productos set nombre = regexp_replace(nombre, '\mCAMISON\M', 'CAMISÓN', 'g') where nombre ~ '\mCAMISON\M';
update productos set nombre = regexp_replace(nombre, '\mPANTALON\M', 'PANTALÓN', 'g') where nombre ~ '\mPANTALON\M';
update productos set nombre = regexp_replace(nombre, '\mCAMISOLIN\M', 'CAMISOLÍN', 'g') where nombre ~ '\mCAMISOLIN\M';
update productos set nombre = regexp_replace(nombre, '\mCORAZON\M', 'CORAZÓN', 'g') where nombre ~ '\mCORAZON\M';

do $$
declare r record; nuevo text;
begin
  for r in select p.id, p.empresa_id, p.nombre from productos p join categorias c on c.id = p.categoria_id where c.nombre = 'PIJAMAS' and p.tipo = 'prenda' loop
    nuevo := nombre_ordenado_pijama(r.nombre);
    if nuevo <> r.nombre and not exists (select 1 from productos q where q.empresa_id = r.empresa_id and q.id <> r.id and lower(q.nombre) = lower(nuevo)) then
      update productos set nombre = nuevo, descripcion = coalesce(descripcion || E'\n', '') || 'Nombre anterior: ' || r.nombre where id = r.id;
    end if;
  end loop;
end $$;

-- 5) colores repetidos que volvieron a entrar (Negra, [UNISEX])
do $$ declare e uuid; begin
  for e in select id from empresas loop
    perform atributo_fusionar_por_nombre(e, 'color', 'Negra', 'Negro');
    perform atributo_fusionar_por_nombre(e, 'color', 'Blanca', 'Blanco');
    perform atributo_fusionar(a.id, null) from atributos a where a.empresa_id = e and a.tipo = 'color' and a.nombre = '[UNISEX]';
  end loop;
  delete from atributos a where not exists (select 1 from variantes v where v.color_id = a.id or v.talle_id = a.id or v.estampa_id = a.id);
end $$;

select p.codigo, p.nombre, p.activo,
  (select string_agg(distinct t.nombre, '/' order by t.nombre) from variantes v join atributos t on t.id=v.talle_id where v.producto_id=p.id and v.activa) talles,
  (select string_agg(distinct co.nombre, ', ' order by co.nombre) from variantes v join atributos co on co.id=v.color_id where v.producto_id=p.id and v.activa) colores,
  coalesce((select sum(s.cantidad) from stock s join variantes v on v.id=s.variante_id where v.producto_id=p.id and v.activa),0)::int stock
from productos p join categorias c on c.id=p.categoria_id where c.nombre='PIJAMAS' and p.tipo='prenda' order by p.nombre;
-- restos de pijamas
select producto_fusionar_en('500163', '500114', 'Rosa chicle');
update productos set nombre = 'CAMISOLÍN «EMILY»', descripcion = coalesce(descripcion || E'\n', '') || 'Nombre anterior: ' || nombre where codigo = '500114';
update productos set nombre = replace(nombre, 'CAMISON', 'CAMISÓN') where nombre like '%CAMISON%';
update productos set nombre = replace(nombre, 'PANTALON', 'PANTALÓN') where nombre like '%PANTALON%';
update productos set nombre = replace(nombre, 'CAMISOLIN', 'CAMISOLÍN') where nombre like '%CAMISOLIN%';
update productos set nombre = replace(nombre, 'ORQUIDEA', 'ORQUÍDEA') where nombre like '%ORQUIDEA%';
update productos set nombre = n.nuevo, descripcion = coalesce(descripcion || E'\n', '') || 'Nombre anterior: ' || productos.nombre from (values
  ('500146','CAMISÓN «BORDADO» C/ MANGAS'), ('500144','CAMISÓN «BORDADO» S/ MANGAS'), ('500148','CAMISÓN «ESPECIAL BORDADO» C/ MANGAS'),
  ('500239','COMBO X2 PANTALÓN «ARGENTINA» PLUSH [UNISEX]')
) n(codigo, nuevo) where productos.codigo = n.codigo and productos.nombre <> n.nuevo;
