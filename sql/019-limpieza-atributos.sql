-- 019 · Limpieza de talles, colores y nombres (todo el catálogo)
--   · fusionar atributos duplicados (Blanca/Blanco, NEGRA/Negro, Leopard/Leopardo, Triple XL/XXXL…)
--   · colores "basura" que salieron del texto del nombre (MICROFIBRA REGULABLE → sin color, ALGODÓN NEGRO → Negro, CAMISERO GIRLY → Girly)
--   · MAYÚSCULAS → Capitalizado · atributos sin uso → se borran
--   · nombres: espacios, acentos en palabras comunes, apóstrofos. NUNCA se toca «», [PACK x3] ni la palabra NEW (son nombres).

-- 1) fusionar una variante en otra del mismo producto: junta el stock, pasa la historia (ventas, movimientos, canal, kits) y borra la repetida
create or replace function variante_fusionar(p_de uuid, p_a uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e uuid; dep uuid; st numeric;
begin
  if p_de = p_a or p_de is null or p_a is null then return; end if;
  select empresa_id into e from variantes where id = p_de;
  dep := (select id from depositos where empresa_id = e and principal limit 1);
  st := coalesce((select sum(cantidad) from stock where variante_id = p_de), 0);
  if st <> 0 then
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (e, p_de, dep, -st, 'ajuste', 'Fusión de variante repetida');
    insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) values (e, p_a, dep, st, 'ajuste', 'Fusión de variante repetida');
  end if;
  update stock_movimientos set variante_id = p_a where variante_id = p_de;
  update venta_lineas set variante_id = p_a where variante_id = p_de;
  update canal_items set variante_id = p_a where variante_id = p_de;
  update canal_cola set variante_id = p_a where variante_id = p_de;
  update producto_componentes set variante_id = p_a where variante_id = p_de;
  update compra_lineas set variante_id = p_a where variante_id = p_de;
  delete from stock where variante_id = p_de;
  delete from precios where variante_id = p_de;
  delete from variantes where id = p_de;
end $$;

-- 2) fusionar un atributo en otro (o en "ninguno" si p_a es null): remapea variantes; si chocan, fusiona las variantes
create or replace function atributo_fusionar(p_de uuid, p_a uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_dest uuid; n int := 0; tipo_attr text;
begin
  if p_de = p_a then return 0; end if;
  select tipo into tipo_attr from atributos where id = p_de;
  for r in select * from variantes where (tipo_attr = 'color' and color_id = p_de) or (tipo_attr = 'talle' and talle_id = p_de) loop
    select id into v_dest from variantes where producto_id = r.producto_id and id <> r.id
      and talle_id is not distinct from (case when tipo_attr = 'talle' then p_a else r.talle_id end)
      and color_id is not distinct from (case when tipo_attr = 'color' then p_a else r.color_id end)
      and estampa_id is not distinct from r.estampa_id;
    if v_dest is null then
      if tipo_attr = 'color' then update variantes set color_id = p_a where id = r.id; else update variantes set talle_id = p_a where id = r.id; end if;
    else
      perform variante_fusionar(r.id, v_dest);
    end if;
    n := n + 1;
  end loop;
  delete from atributos where id = p_de;
  return n;
end $$;

create or replace function atributo_fusionar_por_nombre(e uuid, p_tipo text, p_de text, p_a text) returns int
language plpgsql security definer set search_path = public as $$
declare de_id uuid; a_id uuid;
begin
  select id into de_id from atributos where empresa_id = e and tipo = p_tipo and lower(nombre) = lower(p_de) limit 1;
  if de_id is null then return 0; end if;
  select id into a_id from atributos a where a.empresa_id = e and a.tipo = p_tipo and lower(a.nombre) = lower(p_a) and a.id <> de_id
    order by (select count(*) from variantes v where v.color_id = a.id or v.talle_id = a.id) desc limit 1;
  if a_id is null then update atributos set nombre = p_a where id = de_id; return 1; end if;
  return atributo_fusionar(de_id, a_id);
end $$;

do $$
declare e uuid; r record; n int; resto text; a_id uuid;
begin
  for e in select id from empresas loop
    -- a) duplicados exactos sin mayúsculas/acentos: queda el más usado
    for r in
      select lower(translate(nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) k, tipo, array_agg(id order by (select count(*) from variantes v where v.color_id = atributos.id or v.talle_id = atributos.id) desc, nombre) ids
      from atributos where empresa_id = e group by 1, 2 having count(*) > 1
    loop
      for n in 2..array_length(r.ids, 1) loop perform atributo_fusionar(r.ids[n], r.ids[1]); end loop;
    end loop;
    -- b) sinónimos
    perform atributo_fusionar_por_nombre(e, 'color', 'Blanca', 'Blanco');
    perform atributo_fusionar_por_nombre(e, 'color', 'Negra', 'Negro');
    perform atributo_fusionar_por_nombre(e, 'color', 'Marino', 'Azul Marino');
    perform atributo_fusionar_por_nombre(e, 'color', 'Leopard', 'Leopardo');
    perform atributo_fusionar_por_nombre(e, 'color', 'Rabit', 'Rabbit');
    perform atributo_fusionar_por_nombre(e, 'color', 'Estampada', 'Estampado');
    perform atributo_fusionar_por_nombre(e, 'color', 'Orquidea', 'Orquídea');
    perform atributo_fusionar_por_nombre(e, 'color', 'Arco Íris', 'Arcoíris');
    perform atributo_fusionar_por_nombre(e, 'color', 'Zebra', 'Cebra');
    perform atributo_fusionar_por_nombre(e, 'color', 'Cebras', 'Cebra');
    perform atributo_fusionar_por_nombre(e, 'color', 'Vaquitas', 'Vaquita');
    perform atributo_fusionar_por_nombre(e, 'color', 'Chanchitos', 'Chanchito');
    perform atributo_fusionar_por_nombre(e, 'color', 'Militar', 'Verde Militar');
    perform atributo_fusionar_por_nombre(e, 'color', 'Off white', 'Off White');
    perform atributo_fusionar_por_nombre(e, 'color', 'Color - Verde', 'Verde');
    perform atributo_fusionar_por_nombre(e, 'color', 'Color - Azul', 'Azul');
    perform atributo_fusionar_por_nombre(e, 'color', 'Color - Lila', 'Lila');
    perform atributo_fusionar_por_nombre(e, 'color', 'Color - Rosa', 'Rosa');
    perform atributo_fusionar_por_nombre(e, 'talle', 'Doble XL', 'XXL');
    perform atributo_fusionar_por_nombre(e, 'talle', 'Triple XL', 'XXXL');
    perform atributo_fusionar_por_nombre(e, 'talle', 'Cuatro XL', '4XL');
    perform atributo_fusionar_por_nombre(e, 'talle', 'Talle 3', 'T.3');
    -- c) colores que en realidad son texto del nombre: se saca la tela/corte; lo que queda es el color (o nada)
    for r in select * from atributos where empresa_id = e and tipo = 'color'
             and (nombre ~* '^(MICROFIBRA|ALGOD[OÓ]N|REGULABLE|MODAL|CAMISERO|MANGA CORTA|POLAR SOFT|PLUSH|CLASSIC|XS REGULABLE|C/ PUNTILLA|CULOTTE|COLALESS|VEDETINA|ACEITE PARA|\[UNISEX\]|ELÁSTICO)\M'
                  or nombre in ('R', 'Ok!', 'Just', '✨', '⭐', '⚡', 'Regulable'))
    loop
      resto := btrim(regexp_replace(regexp_replace(r.nombre, '\m(MICROFIBRA|ALGOD[OÓ]N|REGULABLE|EL[ÁA]STICO|ANCHO|MODAL|CAMISERO|MANGA CORTA|POLAR SOFT|PLUSH|CLASSIC|XS|3XL|60ml|ACEITE PARA MASAJES|\[UNISEX\]|C/ PUNTILLA|CULOTTE|COLALESS|VEDETINA)\M', '', 'gi'), '\s+', ' ', 'g'));
      if r.nombre in ('R', 'Ok!', 'Just', '✨', '⭐', '⚡') then resto := ''; end if;
      if resto = '' then
        perform atributo_fusionar(r.id, null);
      else
        resto := upper(left(resto, 1)) || lower(substring(resto from 2));
        select id into a_id from atributos where empresa_id = e and tipo = 'color' and lower(nombre) = lower(resto) and id <> r.id limit 1;
        if a_id is null then update atributos set nombre = resto where id = r.id; else perform atributo_fusionar(r.id, a_id); end if;
      end if;
    end loop;
    -- d) MAYÚSCULAS → Capitalizado (colores; los talles quedan)
    update atributos set nombre = upper(left(nombre, 1)) || lower(substring(nombre from 2))
    where empresa_id = e and tipo = 'color' and nombre = upper(nombre) and length(nombre) > 3 and nombre !~ '^[0-9]' and nombre !~ '[«\[+]';
    -- e) sin uso → afuera
    delete from atributos a where a.empresa_id = e and not exists (select 1 from variantes v where v.color_id = a.id or v.talle_id = a.id or v.estampa_id = a.id);
  end loop;
end $$;

-- 3) nombres de productos: espacios, apóstrofos, acentos en palabras comunes (se respetan «», [ ] y NEW)
update productos set nombre = btrim(regexp_replace(nombre, '\s+', ' ', 'g')) where nombre <> btrim(regexp_replace(nombre, '\s+', ' ', 'g'));
update productos set nombre = replace(nombre, '’', '''') where nombre like '%’%';
update productos set nombre = regexp_replace(nombre, '\s+»', '»', 'g') where nombre ~ '\s+»';
update productos set nombre = regexp_replace(nombre, '«\s+', '«', 'g') where nombre ~ '«\s+';
update productos set nombre = regexp_replace(nombre, '\mALGODON\M', 'ALGODÓN', 'g') where nombre ~ '\mALGODON\M';
update productos set nombre = regexp_replace(nombre, '\mELASTICO\M', 'ELÁSTICO', 'g') where nombre ~ '\mELASTICO\M';
update productos set nombre = regexp_replace(nombre, '\mSATEN\M', 'SATÉN', 'g') where nombre ~ '\mSATEN\M';
update productos set nombre = regexp_replace(nombre, '\mCAMISOLIN\M', 'CAMISOLÍN', 'g') where nombre ~ '\mCAMISOLIN\M';
update productos set nombre = regexp_replace(nombre, '\mCAMISON\M', 'CAMISÓN', 'g') where nombre ~ '\mCAMISON\M';
update productos set nombre = regexp_replace(nombre, '\mPANTALON\M', 'PANTALÓN', 'g') where nombre ~ '\mPANTALON\M';
update productos set nombre = regexp_replace(nombre, '\mCORPINO\M', 'CORPIÑO', 'g') where nombre ~ '\mCORPINO\M';
update productos set nombre = regexp_replace(nombre, '\mPANTUFLON\M', 'PANTUFLÓN', 'g') where nombre ~ '\mPANTUFLON\M';
update productos set nombre = regexp_replace(nombre, '\mINTIMO\M', 'ÍNTIMO', 'g') where nombre ~ '\mINTIMO\M';
update productos set nombre = regexp_replace(nombre, '\mCLASICO\M', 'CLÁSICO', 'g') where nombre ~ '\mCLASICO\M';
update productos set nombre = regexp_replace(nombre, '\mCLASICA\M', 'CLÁSICA', 'g') where nombre ~ '\mCLASICA\M';
update productos set nombre = regexp_replace(nombre, '\mJAZMIN\M', 'JAZMÍN', 'g') where nombre ~ '\mJAZMIN\M';
update productos set nombre = regexp_replace(nombre, '\mAMBAR\M', 'ÁMBAR', 'g') where nombre ~ '\mAMBAR\M';
update productos set nombre = regexp_replace(nombre, '\mARNES\M', 'ARNÉS', 'g') where nombre ~ '\mARNES\M';
update productos set nombre = replace(nombre, 'PLEASSURE', 'PLEASURE') where nombre like '%PLEASSURE%';

select (select count(*) from atributos where tipo = 'color') colores, (select count(*) from atributos where tipo = 'talle') talles,
       (select count(*) from variantes where activa) variantes_activas, (select count(*) from atributos a where tipo = 'color' and a.nombre ~* '(MICROFIBRA|ALGOD|REGULABLE|MODAL|CAMISERO)') basura_que_queda;
