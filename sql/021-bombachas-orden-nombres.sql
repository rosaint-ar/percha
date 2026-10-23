-- 021 · Bombachas: orden único de palabras en el nombre. Criterio (con fotos y variantes a la vista):
--   · lo que Emi escribió ANTES del «modelo» lo identifica → entra en «»: CATHERINE «CHRISTMAS» → «CATHERINE CHRISTMAS», FRU FRU «COLORS» → «FRU FRU COLORS»
--   · lo que escribió DESPUÉS y no es técnico es color, estampa o sub-línea → queda afuera, pegado al «»: «PIA» BORDÓ, «TAYLOR» SNAKE, «SIN COSTURA» ESTAMPADA, «PIA» FREEDOM, «FLOWERS» BLACK I
--   · si esa palabra es un modelo conocido (CATHERINE) vuelve adentro, adelante: ALGODÓN «CHRISTMAS» CATHERINE → «CATHERINE CHRISTMAS»
--   · lo técnico va al final en orden fijo: FRU FRU (si venía después) · tela · CLASSIC · REGULABLE · ELÁSTICO ANCHO · TIRO ALTO · "V" · talle grande (XS/XXL/XXXL)
--   · [PACK x3], NEW y «» no se tocan. El nombre anterior queda en la descripción ("Nombre anterior: …").
create or replace function nombre_ordenado_bombacha(p_nombre text) returns text
language plpgsql stable as $$
declare pref text := ''; cuerpo text; tipo text; modelo text; antes text; despues text; toks text[]; ordenado text; ap_antes text; ap_despues text; modelo_final text;
        tecnicas text; con_v boolean; dentro text[] := '{}'; fuera text[] := '{}';
begin
  cuerpo := btrim(regexp_replace(p_nombre, '\s+', ' ', 'g'));
  if cuerpo ~ '^(\[PACK x\d+\]|PACK X\d+)\s+' then pref := substring(cuerpo from '^(\[PACK x\d+\]|PACK X\d+)') || ' '; cuerpo := btrim(regexp_replace(cuerpo, '^(\[PACK x\d+\]|PACK X\d+)\s+', '')); end if;
  modelo := substring(cuerpo from '«([^»]*)»');
  if modelo is null then return p_nombre; end if;
  tipo := split_part(cuerpo, ' ', 1);
  antes := btrim(regexp_replace(substring(cuerpo from '^(.*?)«'), '^\S+\s*', ''));
  despues := btrim(coalesce(substring(cuerpo from '»(.*)$'), ''));
  con_v := cuerpo ~ 'TIRO ALTO' or cuerpo ~ '"V"';   -- la V es corte solo en esos casos; si no, es numeral (FLOWERS BLACK V)
  tecnicas := '\m(FRU FRU|ALGODÓN|MICROFIBRA|MICROTUL|MORLEY|LYCRA|LUREX|PUNTILLA|ENCAJE|SIN COSTURA|CLASSIC|CLÁSICA|REGULABLE|ELÁSTICO ANCHO|ELÁSTICO FINO|TIRO ALTO|XS|XXL|XXXL|3XL' || case when con_v then '|V' else '' end || ')\M';
  ap_antes := btrim(regexp_replace(regexp_replace(antes, replace(tecnicas, 'FRU FRU|', ''), '', 'g'), '\s+', ' ', 'g'));
  ap_despues := btrim(regexp_replace(regexp_replace(replace(despues, '"V"', ''), tecnicas, '', 'g'), '\s+', ' ', 'g'));
  dentro := case when ap_antes = '' then '{}'::text[] else regexp_split_to_array(ap_antes, ' ') end;
  fuera := case when ap_despues = '' then '{}'::text[] else regexp_split_to_array(ap_despues, ' ') end;
  modelo_final := btrim(concat_ws(' ', nullif(array_to_string(dentro, ' '), ''), modelo));
  toks := regexp_split_to_array(btrim(regexp_replace(regexp_replace(antes, '\mFRU FRU\M', '', 'g') || ' ' || despues, '\s+', ' ', 'g')), ' ');
  select string_agg(tok, ' ' order by prio, pos) into ordenado from (
    select tok, pos,
      case when tok = 'FRU' then 1
           when tok in ('ALGODÓN','MICROFIBRA','MICROTUL','MORLEY','LYCRA','LUREX','PUNTILLA','ENCAJE','SIN','COSTURA') then 2
           when tok in ('CLASSIC','CLÁSICA') then 3
           when tok = 'REGULABLE' then 4
           when tok in ('ELÁSTICO','ANCHO','FINO') and cuerpo ~ 'ELÁSTICO (ANCHO|FINO)' then 5
           when tok in ('TIRO','ALTO') then 6
           when con_v and tok in ('V','"V"') then 7
           when tok in ('XS','XXL','XXXL','3XL') then 9
           else null end prio
    from unnest(toks) with ordinality as u(tok, pos) where tok <> '') x where prio is not null;
  return btrim(regexp_replace(pref || tipo || ' «' || modelo_final || '»' || coalesce(' ' || nullif(array_to_string(fuera, ' '), ''), '') || coalesce(' ' || ordenado, ''), '\s+', ' ', 'g'));
end $$;

-- volver atrás una corrida previa (si la hubo): el nombre anterior está en la descripción
update productos p set nombre = substring(p.descripcion from 'Nombre anterior: ([^\n]+)'), descripcion = nullif(btrim(regexp_replace(p.descripcion, '\n?Nombre anterior: [^\n]*', '', 'g')), '')
where p.descripcion like '%Nombre anterior:%';

-- aplicar (sin pisar nombres que ya existan en otro producto)
do $$
declare r record; nuevo text;
begin
  for r in select p.id, p.empresa_id, p.nombre from productos p join categorias c on c.id = p.categoria_id where c.nombre = 'BOMBACHAS' and p.tipo = 'prenda' and not p.es_generico loop
    nuevo := nombre_ordenado_bombacha(r.nombre);
    if nuevo <> r.nombre and not exists (select 1 from productos q where q.empresa_id = r.empresa_id and q.id <> r.id and lower(q.nombre) = lower(nuevo)) then
      update productos set nombre = nuevo, descripcion = coalesce(descripcion || E'\n', '') || 'Nombre anterior: ' || r.nombre, modificado = now() where id = r.id;
    end if;
  end loop;
end $$;

-- los dos que Emi escribió al revés ("LESS ALGODÓN «CHRISTMAS» CATHERINE"): CATHERINE es el modelo, CHRISTMAS la edición
update productos set nombre = replace(nombre, '«CHRISTMAS» CATHERINE', '«CATHERINE CHRISTMAS»') where nombre like '%«CHRISTMAS» CATHERINE%';

select count(*) filter (where descripcion like '%Nombre anterior:%') cambiados,
       (select string_agg(p.codigo || ' ' || p.nombre, ' | ') from productos p join categorias c on c.id = p.categoria_id where c.nombre = 'BOMBACHAS' and nombre_ordenado_bombacha(p.nombre) <> p.nombre and not p.es_generico) sin_aplicar_por_choque
from productos;
