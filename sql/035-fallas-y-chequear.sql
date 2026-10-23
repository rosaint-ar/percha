-- 035 · Prendas con falla (solo local) y prendas "a chequear".
--  · variantes.fallas = cuántas de esas unidades tienen falla: cuentan en el stock del local pero NO en el de la web
--    (stock web = stock − fallas). Al venderla en el local se marca la línea como "con falla" (◆) y baja el contador.
--  · variantes.chequear = nota de recuento: está en el local y no en la web, se deja el stock hasta confirmarlo.
--  · Corrección del recuento 23/10 (Diego): lo que quedó en 0 por "la web no lo tiene" vuelve, salvo Olivia Uva 85 (quitar);
--    Eva Coral 85 existe solo en el local (confirmado); Martha Soft "Manteca" 100 es el Crema 100 con falla.

alter table variantes add column if not exists fallas numeric(12,3) not null default 0;
alter table variantes add column if not exists falla_nota text;
alter table variantes add column if not exists chequear text;
alter table venta_lineas add column if not exists falla boolean not null default false;

create or replace view v_variantes with (security_invoker = true) as
select v.id, v.empresa_id, v.producto_id, p.codigo as producto_codigo, p.nombre as producto_nombre, p.tipo as producto_tipo,
       v.sku, v.ean, v.activa,
       t.codigo as talle, t.nombre as talle_nombre, t.orden as talle_orden,
       c.codigo as color, c.nombre as color_nombre, c.hex as color_hex,
       e.codigo as estampa, e.nombre as estampa_nombre,
       case when p.tipo = 'kit' then costo_kit(p.id) else coalesce(v.costo, p.costo) end as costo,
       coalesce(v.precio, p.precio) as precio,
       case when p.tipo = 'kit' then stock_kit(p.id) else coalesce((select sum(s.cantidad) from stock s where s.variante_id = v.id), 0) end as stock,
       v.fallas, v.falla_nota, v.chequear,
       case when p.tipo = 'kit' then stock_kit(p.id) else greatest(coalesce((select sum(s.cantidad) from stock s where s.variante_id = v.id), 0) - v.fallas, 0) end as stock_web
from variantes v
join productos p on p.id = v.producto_id
left join atributos t on t.id = v.talle_id
left join atributos c on c.id = v.color_id
left join atributos e on e.id = v.estampa_id;

-- el cruce con la web compara contra el stock web (sin las fallas)
create or replace view v_cruce_canal with (security_invoker = true) as
select ci.id, ci.empresa_id, ci.conexion_id, ci.producto_ext, ci.variante_ext, ci.nombre, ci.valores, ci.sku, ci.barcode, ci.mpn, ci.precio, ci.precio_promo,
       ci.stock, ci.publicado, ci.url, ci.imagen, ci.variante_id, ci.cruce, ci.actualizado, ci.talle_canal, ci.color_canal,
       cx.canal, cx.nombre as conexion_nombre, v.sku as sku_percha, v.ean as ean_percha, v.producto_nombre as producto_percha, v.producto_tipo,
       v.talle_nombre, v.color_nombre, v.precio as precio_percha, v.stock as stock_percha,
       g.n_canal as variantes_canal_mismo_item, g.stock_canal_grupo,
       case when ci.variante_id is null then 'sin_cruzar'
            when ci.stock is null then 'sin_control'
            when g.stock_canal_grupo = v.stock_web then 'igual'
            else 'distinto' end as estado_stock,
       v.fallas as fallas_percha, v.stock_web as stock_web_percha
from canal_items ci
join conexiones cx on cx.id = ci.conexion_id
left join v_variantes v on v.id = ci.variante_id
left join (select conexion_id, variante_id, count(*) n_canal, sum(stock) stock_canal_grupo from canal_items where variante_id is not null group by conexion_id, variante_id) g
  on g.conexion_id = ci.conexion_id and g.variante_id = ci.variante_id;

-- "Tomar todo de Tienda Nube": el local queda = web + las que tienen falla
create or replace function canal_tomar_todo(p_conexion uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e uuid; dep uuid; r record; n_stock int := 0; n_apagadas int := 0; marca text;
begin
  select empresa_id into e from conexiones where id = p_conexion;
  if e is null or not es_admin(e) then raise exception 'Sin permiso'; end if;
  dep := (select id from depositos where empresa_id = e and principal limit 1);
  marca := 'Tienda Nube manda · ' || to_char(now() at time zone 'America/Argentina/Cordoba', 'DD/MM HH24:MI');
  for r in
    select ci.variante_id, sum(ci.stock) + max(v.fallas) canal, coalesce((select sum(s.cantidad) from stock s where s.variante_id = ci.variante_id), 0) local
    from canal_items ci join variantes v on v.id = ci.variante_id join productos p on p.id = v.producto_id
    where ci.conexion_id = p_conexion and ci.stock is not null and p.tipo <> 'kit' and not p.es_generico
    group by ci.variante_id
  loop
    if r.canal <> r.local then
      insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (e, r.variante_id, dep, r.canal - r.local, 'ajuste', marca || ' (local ' || r.local || ' → canal ' || r.canal || ')');
      n_stock := n_stock + 1;
    end if;
  end loop;
  update variantes v set activa = false
  from productos p
  where p.id = v.producto_id and v.empresa_id = e and v.activa and p.tipo <> 'kit'
    and exists (select 1 from canal_items ci join variantes v2 on v2.id = ci.variante_id where ci.conexion_id = p_conexion and v2.producto_id = p.id)
    and not exists (select 1 from canal_items ci where ci.conexion_id = p_conexion and ci.variante_id = v.id)
    and coalesce((select sum(s.cantidad) from stock s where s.variante_id = v.id), 0) = 0
    and (v.talle_id is not null or v.color_id is not null or v.estampa_id is not null);
  get diagnostics n_apagadas = row_count;
  return jsonb_build_object('stock_ajustados', n_stock, 'nombres_cambiados', 0, 'variantes_apagadas', n_apagadas);
end $$;

-- Vender una prenda con falla: la línea queda marcada y baja el contador de fallas
create or replace function venta_linea_mover_stock(e uuid, v_id uuid, v_num bigint, v_lin bigint, dep uuid, l jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare tipo_prod text; c jsonb; comp record; v_comp uuid; cant numeric := (l->>'cantidad')::numeric; mov_tipo text;
begin
  mov_tipo := case when cant < 0 then 'devolucion' else 'venta' end;
  select tipo into tipo_prod from productos where id = (l->>'producto_id')::uuid;
  if tipo_prod = 'kit' then
    if jsonb_typeof(l->'componentes') = 'array' and jsonb_array_length(l->'componentes') > 0 then
      for c in select * from jsonb_array_elements(l->'componentes') loop
        insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id, linea_id)
        values (e, (c->>'variante_id')::uuid, dep, -(sign(cant) * (c->>'cantidad')::numeric), mov_tipo, v_id::text, 'Venta #' || v_num || ' · kit ' || (l->>'descripcion'), auth.uid(), v_lin);
      end loop;
    else
      for comp in select variante_id, componente_producto_id, filtro, cantidad from producto_componentes where producto_id = (l->>'producto_id')::uuid loop
        v_comp := coalesce(comp.variante_id,
                           case when comp.componente_producto_id is not null then variante_indefinida(comp.componente_producto_id) end,
                           case when comp.filtro->>'defecto_producto_id' is not null then variante_indefinida((comp.filtro->>'defecto_producto_id')::uuid) end);
        if v_comp is not null then
          insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id, linea_id)
          values (e, v_comp, dep, -(cant * comp.cantidad), mov_tipo, v_id::text, 'Venta #' || v_num || ' · kit ' || (l->>'descripcion') || case when comp.variante_id is null then ' (sin definir)' else '' end, auth.uid(), v_lin);
        end if;
      end loop;
    end if;
  elsif l->>'variante_id' is not null then
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id, linea_id)
    values (e, (l->>'variante_id')::uuid, dep, -cant, mov_tipo, v_id::text, 'Venta #' || v_num || case when coalesce((l->>'falla')::boolean, false) then ' · con falla' else '' end, auth.uid(), v_lin);
    if coalesce((l->>'falla')::boolean, false) then
      update venta_lineas set falla = true where id = v_lin;
      update variantes set fallas = greatest(fallas - cant, 0) where id = (l->>'variante_id')::uuid;
    end if;
  end if;
end $$;

-- Anular devuelve también la marca de falla
create or replace function caja_anular_venta(p_venta uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v ventas%rowtype; m record;
begin
  select * into v from ventas where id = p_venta for update;
  if v.id is null or not es_miembro(v.empresa_id) then raise exception 'Venta inexistente'; end if;
  if not es_admin(v.empresa_id) and v.creado_por <> auth.uid() then raise exception 'Solo administración puede anular ventas de otra persona'; end if;
  if v.estado = 'anulada' then raise exception 'Ya estaba anulada'; end if;
  for m in select * from stock_movimientos where referencia = v.id::text and tipo in ('venta','devolucion') loop
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
    values (v.empresa_id, m.variante_id, m.deposito_id, -m.cantidad, 'ajuste', v.id::text, 'Anulación venta #' || v.numero, auth.uid());
  end loop;
  update variantes x set fallas = x.fallas + l.cantidad from venta_lineas l where l.venta_id = v.id and l.falla and l.variante_id = x.id;
  update creditos c set saldo = c.saldo + vp.monto, estado = 'vigente' from venta_pagos vp where vp.venta_id = v.id and vp.credito_id = c.id;
  update creditos set estado = 'anulado' where origen_venta_id = v.id and saldo = monto;
  update ventas set estado = 'anulada', anulada_por = auth.uid(), anulada_fecha = now(), anulada_motivo = p_motivo where id = v.id;
end $$;

-- ---------- Corrección del recuento 23/10 según Diego ----------
create temp table x035 (vid uuid, cant numeric, accion text, que text);
insert into x035 values
('875cc40e-b782-40a1-97d5-158cd62fec24'::uuid, 2, 'chequear', 'CONJUNTO «CIELO» 100 Blanco y lila'),
  ('fee26ac8-b387-4739-8e17-a0c95c293cc4'::uuid, 1, 'chequear', 'CONJUNTO «CIELO» 100 Blanco y rosa'),
  ('dbdad420-6030-4cec-b8f5-d56c1fbafd45'::uuid, 3, 'chequear', 'CONJUNTO «ALICE» 90 Aqua'),
  ('eff0cb11-7f9f-4ff8-a193-dbd4c3022c87'::uuid, 3, 'chequear', 'CONJUNTO «ALICE» 80 Aqua'),
  ('46cbeb4d-28b0-4419-aaee-ebacacaa251e'::uuid, 1, 'chequear', 'CONJUNTO «AGNES» 85 Lila'),
  ('89a91e6d-f98b-4ebf-a2b1-d71652cf6859'::uuid, 1, 'chequear', 'CONJUNTO «AGNES» 95 Lila'),
  ('902a0429-0737-4763-8d96-ebc52d573256'::uuid, 1, 'confirmado', 'CONJUNTO «EVA» 85 Coral'),
  ('e91f12bc-58e2-41be-a0ac-257b0526ef90'::uuid, 1, 'chequear', 'CORSET «VELVET» 100 Azul oscuro'),
  ('fa4a906b-377d-4791-89c0-8fd1f30e859b'::uuid, 1, 'chequear', 'CONJUNTO «EMMA SOFT» 85 Beige'),
  ('68f59310-01e0-4b79-b87f-d8e911e199dd'::uuid, 1, 'chequear', 'CONJUNTO «EMMA SOFT» 95 Beige'),
  ('6b28f824-a461-4797-914b-16d89942aa52'::uuid, 3, 'chequear', 'CONJUNTO «EMMA SOFT» 100 Beige'),
  ('33c92126-f620-4eb7-b81c-ad4026f377f2'::uuid, 1, 'chequear', 'CONJUNTO «MARTHA» FLORES 90 Azul Marino'),
  ('8eba92cf-cc37-4306-925f-c139f1cfc19b'::uuid, 1, 'falla', 'CONJUNTO «MARTHA SOFT» 100 Manteca'),
  ('c1c652f1-3f79-4b8e-97d5-b65cb21b45f6'::uuid, 1, 'quitar', 'CONJUNTO «OLIVIA» 85 Uva'),
  ('596c7d6e-d442-4b87-82c6-be7399c7e4c2'::uuid, 1, 'chequear', 'CORPIÑO «SEAMLESS» XXL Blanco'),
  ('3b589d53-c39e-4eb4-9169-ba9039dbf6ee'::uuid, 1, 'chequear', 'CORPIÑO «SEAMLESS» XXXL Blanco');

-- vuelve el stock de lo que está solo en el local (menos Olivia Uva 85 "quitar" y el Manteca, que es el Crema con falla)
insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
select v.empresa_id, x.vid, (select id from depositos d where d.empresa_id = v.empresa_id and d.principal limit 1), x.cant, 'ajuste', 'recuento-2026-10-23',
       'Recuento 23/10 · vuelve: está solo en el local, se deja hasta chequear', '5f43c17d-958a-4ef7-badc-1a4001a20747'
from x035 x join variantes v on v.id = x.vid where x.accion in ('chequear','confirmado');
update variantes v set activa = true,
  chequear = case when x.accion = 'chequear' then 'Recuento 23/10: está en el local y no en la web. Confirmar stock.' end
from x035 x where v.id = x.vid and x.accion in ('chequear','confirmado');

-- Martha Soft "Manteca" 100 = Crema 100 con falla
insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, referencia, nota, user_id)
select v.empresa_id, v.id, (select id from depositos d where d.empresa_id = v.empresa_id and d.principal limit 1), 1, 'ajuste', 'recuento-2026-10-23',
       'Recuento 23/10 · el "Manteca" 100 es este Crema 100, con falla (solo local)', '5f43c17d-958a-4ef7-badc-1a4001a20747'
from variantes v join productos p on p.id = v.producto_id join atributos t on t.id = v.talle_id join atributos c on c.id = v.color_id
where p.codigo = '200204' and t.nombre = '100' and c.nombre = 'Crema';
update variantes v set fallas = 1, falla_nota = 'Fallado. Estaba cargado como Manteca.', activa = true
from productos p, atributos t, atributos c
where p.id = v.producto_id and t.id = v.talle_id and c.id = v.color_id and p.codigo = '200204' and t.nombre = '100' and c.nombre = 'Crema';

-- Modelos de Conjuntos que no están en la web (Aldi, Anais, Cherry, Lilium, Mia, Paula): a chequear
update variantes v set chequear = 'Recuento 23/10: el modelo no está en la web. Confirmar stock.'
from productos p join categorias cat on cat.id = p.categoria_id
where p.id = v.producto_id and cat.codigo = '20' and coalesce((select sum(cantidad) from stock s where s.variante_id = v.id), 0) <> 0
  and not exists (select 1 from canal_items ci join variantes v2 on v2.id = ci.variante_id where v2.producto_id = p.id);

select jsonb_build_object(
  'a_chequear', (select jsonb_agg(producto_nombre || ' ' || coalesce(talle_nombre,'') || ' ' || coalesce(color_nombre,'') || ' = ' || stock::int order by producto_nombre) from v_variantes where chequear is not null),
  'fallas', (select jsonb_agg(producto_nombre || ' ' || talle_nombre || ' ' || color_nombre || ' stock ' || stock::int || ' web ' || stock_web::int) from v_variantes where fallas > 0),
  'olivia', (select stock::int || case when activa then ' activa' else ' oculta' end from v_variantes where id = 'c1c652f1-3f79-4b8e-97d5-b65cb21b45f6'),
  'eva', (select stock::int || coalesce(' ' || chequear, ' confirmado') from v_variantes where id = '902a0429-0737-4763-8d96-ebc52d573256'),
  'conj_distinto', (select count(*) from v_cruce_canal cc join variantes v on v.id = cc.variante_id join productos p on p.id = v.producto_id join categorias c on c.id = p.categoria_id where c.codigo = '20' and cc.estado_stock = 'distinto')
) r;
