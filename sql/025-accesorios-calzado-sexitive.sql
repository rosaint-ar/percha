-- 025 · Accesorios, Calzado, Sexitive, Lonas, Pareos: duplicados juntados, nombres con TIPO «MODELO» detalle, acentos, categorías mal puestas.

-- mover un color de un producto a otro producto (el destino ES ese modelo: queda sin color)
create or replace function producto_mover_color(p_de_codigo text, p_color text, p_a_codigo text) returns int
language plpgsql security definer set search_path = public as $$
declare de productos%rowtype; a productos%rowtype; v record; v_dest uuid; n int := 0;
begin
  select * into de from productos where codigo = p_de_codigo; select * into a from productos where codigo = p_a_codigo;
  if de.id is null or a.id is null then return 0; end if;
  for v in select vv.* from variantes vv join atributos co on co.id = vv.color_id where vv.producto_id = de.id and lower(co.nombre) = lower(p_color) loop
    select id into v_dest from variantes where producto_id = a.id and talle_id is not distinct from v.talle_id and color_id is null and estampa_id is null;
    if v_dest is null then
      insert into variantes (empresa_id, producto_id, talle_id, sku, activa) values (a.empresa_id, a.id, v.talle_id, a.codigo || coalesce('-' || (select codigo from atributos where id = v.talle_id), ''), true) returning id into v_dest;
    end if;
    perform variante_fusionar(v.id, v_dest); n := n + 1;
  end loop;
  return n;
end $$;

-- 1) Accesorios: duplicados → uno
select producto_fusionar_en(de, a, color) from (values
  ('900235','900209','Negro'), ('900207','900200',null), ('900210','900200',null), ('900208','900201',null), ('900603','900604',null), ('900226','900240',null)
) m(de, a, color);

-- 2) Calzado: los pantuflones "animados" de FactuSOL (un producto con 12 animales como colores) pasan a cada pantuflón de TN
select producto_mover_color('910103', color, a) from (values
  ('Chanchito','910110'), ('Hamburguesa','910113'), ('Kitty','910114'), ('Papas fritas','910115'), ('Perrito','910116'), ('Selección','910117'),
  ('Stich','910118'), ('Unicornio','910119'), ('Vaquita','910120'), ('Argentina','910108'), ('Capicabra','910109'), ('Gato negro','910123')
) m(color, a);
delete from variantes v using productos p where p.id = v.producto_id and p.codigo = '910103' and not exists (select 1 from venta_lineas l where l.variante_id = v.id) and coalesce((select sum(cantidad) from stock s where s.variante_id = v.id), 0) = 0;
update productos set activo = false where codigo = '910103' and not exists (select 1 from variantes v where v.producto_id = productos.id and v.activa);
select producto_fusionar_en(de, a, color) from (values
  ('910124','910105','Crema'), ('910125','910105','Lima'), ('910129','910100','Beige'), ('910130','910100','Negro'), ('910128','910110',null)
) m(de, a, color);
update productos set activo = true where codigo = '910123' and exists (select 1 from stock s join variantes v on v.id = s.variante_id where v.producto_id = productos.id and s.cantidad > 0);

-- 3) Lonas: los "KIT 1..5" son kits de Sexitive con código reusado → a Sexitive, con código de su familia
do $$
declare r record; nuevo text; cat uuid;
begin
  select id into cat from categorias where nombre = 'SEXITIVE' limit 1;
  for r in select p.* from productos p where p.codigo between '930102' and '930106' and p.nombre like 'KIT%' loop
    nuevo := proximo_codigo_familia(r.empresa_id, '92');
    update productos set categoria_id = cat, codigo = nuevo, descripcion = coalesce(descripcion || E'\n', '') || 'Código anterior: ' || r.codigo where id = r.id;
    update variantes set sku = nuevo || substring(sku from length(r.codigo) + 1) where producto_id = r.id and sku like r.codigo || '%';
  end loop;
end $$;

-- 4) colores basura de los kits de Sexitive ("+ JUEGO «LES AMANTS» BY SEXITIVE") → sin color
do $$ declare e uuid; r record; begin
  for r in select a.id from atributos a where a.tipo = 'color' and (a.nombre like '+ %' or a.nombre like 'BLANCA + %') loop perform atributo_fusionar(r.id, null); end loop;
end $$;

-- 5) nombres
update productos set nombre = n.nuevo, descripcion = coalesce(descripcion || E'\n', '') || 'Nombre anterior: ' || productos.nombre from (values
  ('900601','GUANTES «LUXURY» PUNTILLA'), ('900602','ANTIFAZ «LUXURY»'), ('900604','GUANTES «SAVAGE» RED'), ('900200','MEDIAS «RED» CON LIGA'), ('900201','MEDIAS «FINA» CAN CAN CON LIGA'),
  ('900206','MEDIAS «TÉRMICAS»'), ('900202','CAN CAN «CLÁSICO»'), ('900408','CORPIÑO «SILICON BRA» SILICONA'), ('900501','BOLA LAVARROPA «CHICA»'), ('900502','BOLA LAVARROPA «GRANDE»'),
  ('900001','BOLSITA DE GUARDADO - REGALO'), ('900002','MEDIAS INVISIBLES - REGALO'), ('900236','COMBO «GOLD»'), ('900237','COMBO «PLATINUM»'), ('900238','COMBO «SILVER»'),
  ('910105','CHUNAS «CAMILLE»'), ('910106','CHUNAS «CAMILLE» LEATHER'), ('910001','*FALLADAS* CHUNAS «CAMILLE»'), ('910112','SANDALIAS «FROGGY»'), ('990001','*FALLADAS* SANDALIAS «FROGGY»'),
  ('910100','PANTUFLÓN «LISO» PREMIUM'), ('910103','PANTUFLÓN «ANIMADOS» PREMIUM'), ('910122','PANTUFLÓN «FRIDA»'), ('910123','PANTUFLÓN «GATITO» NEGRO'), ('910117','PANTUFLÓN «SELECCIÓN»'),
  ('930101','LONA PLAYERA «REDONDA 1,95 M»'), ('940102','PAREO «VISCOSA»'), ('940101','PAREO «1,75 x 1,10»'),
  ('920115','CHALLENGE «30 DÍAS»'), ('920107','DADOS «OH MY GOD» CLÁSICOS'), ('920101','«VERDAD O DESAFÍO»'), ('920207','SERUM «EOS» PUNTO G')
) n(codigo, nuevo) where productos.codigo = n.codigo and productos.nombre <> n.nuevo;
update productos set nombre = replace(nombre, 'PANTUFLON ', 'PANTUFLÓN ') where nombre like 'PANTUFLON %';
update productos set nombre = replace(nombre, 'PANTUFLONES ', 'PANTUFLÓN ') where nombre like 'PANTUFLONES %';
update productos set nombre = replace(nombre, 'GEL INTIMO', 'GEL ÍNTIMO') where nombre like '%GEL INTIMO%';
update productos set nombre = replace(nombre, 'DIVAS SECRET', 'DIVA''S SECRET') where nombre like '%DIVAS SECRET%';
update productos set nombre = replace(nombre, 'PLEASSURE', 'PLEASURE') where nombre like '%PLEASSURE%';
update productos set nombre = btrim(regexp_replace(nombre, '\s+', ' ', 'g')) where nombre <> btrim(regexp_replace(nombre, '\s+', ' ', 'g'));
delete from atributos a where not exists (select 1 from variantes v where v.color_id = a.id or v.talle_id = a.id or v.estampa_id = a.id);

select c.nombre fam, p.codigo, p.nombre, p.activo,
  (select string_agg(distinct t.nombre, '/' order by t.nombre) from variantes v join atributos t on t.id=v.talle_id where v.producto_id=p.id and v.activa) talles,
  (select string_agg(distinct co.nombre, ', ' order by co.nombre) from variantes v join atributos co on co.id=v.color_id where v.producto_id=p.id and v.activa) colores,
  coalesce((select sum(s.cantidad) from stock s join variantes v on v.id=s.variante_id where v.producto_id=p.id and v.activa),0)::int stock
from productos p join categorias c on c.id=p.categoria_id where c.nombre in ('ACCESORIOS','CALZADO','SEXITIVE','LONAS PLAYERAS','PAREOS Y PAÑUELOS') and p.tipo='prenda' order by c.nombre, p.nombre;
