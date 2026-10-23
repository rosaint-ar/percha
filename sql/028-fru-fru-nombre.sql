-- 028 · FRU FRU: «FRU FRU + nombre» (aprobado por Diego 22/10). Los tres «FRU FRU CLASSIC» quedan (CLASSIC es el modelo ahí).
create temp table ff_prop as
with p as (select codigo, nombre from productos where nombre ~ 'FRU FRU'),
 x as (select codigo, nombre,
   btrim(regexp_replace(nombre, '^(\[PACK x\d+\]|PACK X\d+)\s+', '')) cuerpo,
   coalesce(substring(nombre from '^(\[PACK x\d+\]|PACK X\d+)\s'), '') pref from p),
 y as (select *, split_part(cuerpo, ' ', 1) tipo,
   btrim(regexp_replace(regexp_replace(replace(replace(cuerpo, '«', ' '), '»', ' '), '^\S+\s*', ''), '\s+', ' ', 'g')) palabras from x),
 z as (select *,
   btrim(regexp_replace(regexp_replace(palabras, '\m(FRU FRU|ALGODÓN|MICROFIBRA|MICROTUL|MORLEY|LYCRA|LUREX|PUNTILLA|ENCAJE|SIN COSTURA|CLASSIC|CLÁSICA|REGULABLE|ELÁSTICO ANCHO|ELÁSTICO FINO|TIRO ALTO|XS|XXL|XXXL|3XL)\M', '', 'g'), '\s+', ' ', 'g')) nombre_parte,
   (select string_agg(tok, ' ' order by prio, pos) from (
      select tok, pos, case when tok in ('ALGODÓN','MICROFIBRA','MICROTUL','MORLEY','LYCRA','LUREX','PUNTILLA','ENCAJE','SIN','COSTURA') then 2 when tok in ('CLASSIC','CLÁSICA') then 3 when tok = 'REGULABLE' then 4 when tok in ('ELÁSTICO','ANCHO','FINO') then 5 when tok in ('TIRO','ALTO') then 6 when tok in ('XS','XXL','XXXL','3XL') then 9 end prio
      from unnest(regexp_split_to_array(palabras, ' ')) with ordinality u(tok, pos)) q where prio is not null) tecnico
   from y)
select codigo, nombre actual, btrim(regexp_replace(pref || tipo || ' «FRU FRU' || case when nombre_parte <> '' then ' ' || nombre_parte else '' end || '»' || coalesce(' ' || tecnico, ''), '\s+', ' ', 'g')) propuesto
from z order by tipo, nombre;
update productos p set nombre = f.propuesto, descripcion = coalesce(p.descripcion || E'\n', '') || 'Nombre anterior: ' || p.nombre from ff_prop f where f.codigo = p.codigo and f.actual <> f.propuesto and f.actual !~ '«FRU FRU CLASSIC»' and not exists (select 1 from productos q where q.empresa_id = p.empresa_id and q.id <> p.id and lower(q.nombre) = lower(f.propuesto));
select count(*) filter (where nombre ~ '«FRU FRU') fru_fru_adelante, count(*) filter (where nombre ~ 'FRU FRU' and nombre !~ '«FRU FRU') otros from productos where nombre ~ 'FRU FRU';
