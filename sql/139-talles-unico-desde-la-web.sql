-- 139 · 12/11 (Diego: «Sara no trajo los talles desde Tienda Nube»). Error nuestro: al importar, «Único (S al 2XL)» se
-- tomaba como "sin talle" y se perdía el rango (sql/131 solo arregló los rangos sueltos y solo para lo nuevo).
-- · talle_canal_nombre(t): el nombre del talle en Percha para un valor de la web. «Único» solo = sin talle (null);
--   «Único (35 - 41)» → «Único (35 al 41)»; «S a XL» → «S al XL».
-- · atributo_desde_canal: «Único (…)» ya NO es sin talle; un talle nuevo de rango va a su escala (Bombachas o Medias).
-- · Relleno: cada variante activa SIN talle cuyo cruce con la web tiene UN talle de rango lo recibe (si no choca con otra
--   variante igual). Su SKU no cambia (las etiquetas ya pegadas siguen sirviendo). Los cruces automáticos de esas
--   variantes pasan a «manual» (la sincronización no los vuelve a calcular).
begin;

create or replace function talle_canal_nombre(t text) returns text language sql immutable as $$
  with x as (select btrim(coalesce(t, '')) s)
  select case
    when s = '' or s ~* '^([uú]nic[oa]|talle [uú]nico)$' then null
    when s ~* '^[uú]nic[oa]\s*\((.+)\)$' then 'Único (' || regexp_replace(regexp_replace(btrim(substring(s from '\((.+)\)')), '\s*-\s*', ' al ', 'g'), '\s+a\s+', ' al ', 'gi') || ')'
    when s ~* '^\S+\s+(al|a|-)\s+\S+$' or s ~* '^\S+\s*-\s*\S+$' then regexp_replace(regexp_replace(s, '\s*-\s*', ' al ', 'g'), '\s+a\s+', ' al ', 'gi')
    else s end
  from x $$;

CREATE OR REPLACE FUNCTION public.atributo_desde_canal(e uuid, p_tipo text, p_nombre text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a_id uuid; cod text; base text; nom text; k int := 2; esc uuid;
begin
  nom := nullif(btrim(coalesce(p_nombre, '')), '');
  if nom is null then return null; end if;
  -- «Único» solo = sin talle; «Único (S al 2XL)» y los rangos SÍ son talles (sql/139)
  if p_tipo = 'talle' then nom := talle_canal_nombre(nom); if nom is null then return null; end if; end if;
  -- 1) el que ya existe con ese nombre (activo; para talles XXL = 2XL), prefiriendo el que está en una escala
  select id into a_id from atributos where empresa_id = e and tipo = p_tipo and activo
    and (lower(nombre) = lower(nom) or lower(codigo) = lower(nom) or (p_tipo = 'talle' and talle_norm(nombre) = talle_norm(nom)))
    order by (escala_id is not null) desc, orden limit 1;
  if a_id is not null then return a_id; end if;
  -- 2) nuevo, con un código que no choque con ninguno (tampoco con los apagados); un rango va a su escala
  base := upper(left(regexp_replace(translate(nom, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN'), '[^A-Za-z0-9]', '', 'g'), case when p_tipo = 'talle' then 12 else 3 end));
  if base = '' then base := upper(left(p_tipo, 1)); end if;
  cod := base;
  while exists (select 1 from atributos where empresa_id = e and tipo = p_tipo and codigo = cod) loop cod := base || '-' || k; k := k + 1; end loop;
  if p_tipo = 'talle' then
    esc := case when nom ~* '\m(XS|S|M|L|XL|[234]XL)\M' and nom ~* ' al ' then (select id from talle_escalas where empresa_id = e and nombre ilike 'bombachas' limit 1)
                when nom ~* '\m(2[6-9]|3[0-9]|4[0-6])\M al \m(2[6-9]|3[0-9]|4[0-6])\M' then (select id from talle_escalas where empresa_id = e and nombre ilike 'medias%' limit 1) end;
  end if;
  insert into atributos (empresa_id, tipo, codigo, nombre, orden, escala_id)
  values (e, p_tipo, cod, nom, case when esc is not null then coalesce((select max(orden) + 1 from atributos where escala_id = esc), 999) else 999 end, esc)
  returning id into a_id;
  return a_id;
end $function$;

-- relleno: variantes sin talle cuya publicación en la web dice un talle de rango
create temp table _relleno on commit drop as
  select v.id, v.empresa_id, v.producto_id, v.color_id, v.estampa_id, min(talle_canal_nombre(ci.talle_canal)) nom
  from variantes v join canal_items ci on ci.variante_id = v.id
  where v.talle_id is null and v.activa and talle_canal_nombre(ci.talle_canal) is not null
  group by 1, 2, 3, 4, 5
  having count(distinct talle_canal_nombre(ci.talle_canal)) = 1;   -- con dos rangos distintos en la web: no se adivina
create temp table _talle on commit drop as
  select nom, empresa_id, atributo_desde_canal(empresa_id, 'talle', nom) talle_id from (select distinct nom, empresa_id from _relleno) z;
create temp table _hecho (id uuid, nom text) on commit drop;
with h as (
  update variantes v set talle_id = t.talle_id
  from _relleno r join _talle t on t.nom = r.nom and t.empresa_id = r.empresa_id
  where v.id = r.id and t.talle_id is not null
    and not exists (select 1 from variantes o where o.producto_id = r.producto_id and o.id <> r.id and o.talle_id = t.talle_id
                    and o.color_id is not distinct from r.color_id and o.estampa_id is not distinct from r.estampa_id)
  returning v.id, t.nom)
insert into _hecho select * from h;
update canal_items set cruce = 'manual' where variante_id in (select id from _hecho) and cruce <> 'manual';
select (select count(*) from _hecho) variantes_con_talle, (select count(distinct producto_id) from variantes where id in (select id from _hecho)) prendas,
       (select count(*) from _relleno) candidatas, (select json_agg(x) from (select nom, count(*) n from _hecho group by 1 order by 2 desc) x) por_talle;
commit;

-- (2) los colores de esas mismas prendas que no están en la web (ej. SARA Rosa viejo): si TODA la prenda tiene un único talle
-- «Único (…)», el color sin talle toma ese mismo (si no choca).
begin;
create temp table _hecho2 (id uuid, nom text) on commit drop;
with uno as (
  select v.producto_id, min(v.talle_id::text)::uuid talle_id
  from variantes v join atributos a on a.id = v.talle_id
  where v.activa and v.talle_id is not null and a.nombre ~* '^[uú]nic[oa] \('
  group by 1 having count(distinct v.talle_id) = 1
     and not exists (select 1 from variantes o join atributos b on b.id = o.talle_id where o.producto_id = v.producto_id and o.activa and b.nombre !~* '^[uú]nic[oa] \(')),
h as (
  update variantes v set talle_id = u.talle_id from uno u
  where v.producto_id = u.producto_id and v.activa and v.talle_id is null
    and not exists (select 1 from variantes o where o.producto_id = v.producto_id and o.id <> v.id and o.talle_id = u.talle_id
                    and o.color_id is not distinct from v.color_id and o.estampa_id is not distinct from v.estampa_id)
  returning v.id, u.talle_id::text)
insert into _hecho2 select * from h;
select count(*) n, count(distinct (select producto_id from variantes where id = h.id)) prendas from _hecho2 h;
commit;
