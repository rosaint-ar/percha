-- 044 · Escalas de talles (como trabaja el rubro): cada tipo de prenda tiene su escala, con su orden y su tabla de medidas.
--       Las familias de productos usan una o más escalas. Los colores se agrupan por familia de color.
--       Clasificación automática de lo que ya existe + unificación de talles duplicados.

create table if not exists talle_escalas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null,
  descripcion text,
  tipo text not null default 'otro',          -- letras | contorno | calzado | medias | numerado | jeans | ninos | unico | otro
  orden int not null default 0,
  admite_copa boolean not null default false,  -- corpiños: además del contorno, copa (A, B, C…)
  medidas jsonb not null default '{"columnas":[],"filas":{}}'::jsonb,  -- tabla de medidas: columnas (Busto, Cintura…) y por talle sus valores
  activa boolean not null default true,
  creado timestamptz not null default now()
);
alter table talle_escalas enable row level security;
drop policy if exists talle_escalas_ver on talle_escalas; create policy talle_escalas_ver on talle_escalas for select using (es_miembro(empresa_id));
drop policy if exists talle_escalas_admin on talle_escalas; create policy talle_escalas_admin on talle_escalas for all using (es_admin(empresa_id)) with check (es_admin(empresa_id));

alter table atributos add column if not exists escala_id uuid references talle_escalas(id) on delete set null;
alter table atributos add column if not exists grupo text;       -- colores: familia de color (Negros, Rojos, Estampados…)
alter table categorias add column if not exists escalas uuid[];   -- escalas que usa la familia de productos

-- ---------- escalas de Augusta, a partir de lo que ya hay ----------
do $$
declare e uuid; x record; esc_id uuid;
begin
  for e in select id from empresas loop
    if exists (select 1 from talle_escalas where empresa_id = e) then continue; end if;
    insert into talle_escalas (empresa_id, nombre, descripcion, tipo, orden, admite_copa) values
      (e, 'Letras', 'Remeras, pijamas, bombachas, bikinis', 'letras', 1, false),
      (e, 'Contorno', 'Corpiños, conjuntos, bodies, corsetería', 'contorno', 2, true),
      (e, 'Calzado y pantuflas', 'Numeración argentina', 'calzado', 3, false),
      (e, 'Medias y pantys', 'Por rango de calzado', 'medias', 4, false),
      (e, 'Numerado', 'Can can y prendas por número de talle', 'numerado', 5, false),
      (e, 'Único', 'Accesorios, lonas, pareos', 'unico', 6, false);
  end loop;
end $$;

-- unificar duplicados del can can: "T.3" = "Talle 3"
do $$
declare de uuid; a uuid;
begin
  for de, a in select d.id, t.id from atributos d join atributos t on t.empresa_id = d.empresa_id and t.tipo = 'talle' and t.codigo = 'TALLE3' where d.tipo = 'talle' and d.codigo = 'T3' loop
    perform atributo_fusionar(de, a);
  end loop;
end $$;
update atributos set nombre = 'Talle 2' where tipo = 'talle' and codigo = 'T2';
update atributos set nombre = 'Talle 5' where tipo = 'talle' and codigo = 'T.5';

-- clasificar cada talle en su escala
update atributos a set escala_id = (select id from talle_escalas s where s.empresa_id = a.empresa_id and s.tipo = case
    when a.nombre ~* '^(xxs|xs|s|m|l|xl|xxl|xxxl|[2-6]xl)(/(xs|s|m|l|xl|xxl|xxxl))?$' then 'letras'
    when a.nombre ~* '^[uú]nic' then 'unico'
    when a.nombre ~* '^talle\s*\d+$|^t\.?\s*\d$' then 'numerado'
    when a.nombre ~* '^\d{2}\s*al\s*\d{2}$' then 'medias'
    when a.nombre ~ '^\d \((\d{2,3})/(\d{2,3})\)$' then 'contorno'
    when a.nombre ~ '^\d{2,3}(/\d{2,3})?$' and split_part(a.nombre, '/', 1)::int >= 70 then 'contorno'
    when a.nombre ~ '^\d{2}(/\d{2})?$' and split_part(a.nombre, '/', 1)::int < 50 then 'calzado'
    else null end limit 1)
where a.tipo = 'talle' and a.escala_id is null;

-- orden dentro de cada escala (y un orden general coherente: escala × 100 + posición)
with base as (
  select a.id, s.orden so,
    case s.tipo
      when 'letras' then array_position(array['XXS','XS','S','S/M','M','M/L','L','L/XL','XL','XL/XXL','XXL','XXXL','4XL','5XL','6XL'], upper(a.nombre))
      when 'contorno' then coalesce(nullif(regexp_replace(split_part(regexp_replace(a.nombre, '^\d \(', ''), '/', 1), '\D', '', 'g'), ''), '0')::int * 10 + case when a.nombre like '%/%' then 5 else 0 end
      when 'calzado' then split_part(a.nombre, '/', 1)::int * 10 + case when a.nombre like '%/%' then 5 else 0 end
      when 'medias' then substring(a.nombre from '^(\d+)')::int
      when 'numerado' then substring(a.nombre from '(\d+)')::int
      else 1 end pos
  from atributos a join talle_escalas s on s.id = a.escala_id where a.tipo = 'talle'),
ord as (select id, so, row_number() over (partition by so order by pos, id) rn from base)
update atributos a set orden = ord.so * 100 + ord.rn from ord where ord.id = a.id;

-- familias de productos → escalas que usan (por los talles de sus productos)
update categorias c set escalas = x.esc from (
  select p.categoria_id, array_agg(distinct a.escala_id) esc
  from variantes v join productos p on p.id = v.producto_id join atributos a on a.id = v.talle_id
  where v.activa and a.escala_id is not null group by p.categoria_id) x
where x.categoria_id = c.id and c.escalas is null;

-- ---------- colores por familia de color ----------
update atributos set grupo = case
    when nombre ~* 'print|animal|flor|flower|margarit|batik|cebra|estamp|raya|lunar|puntit|patch|tropic|snake|leopard|daisy|leaves|hoja|cuadr|cherry|cereza|coraz|cuore|love|tie ?dye|camuf|abstract|hippie|proud|san marino|geom|paisley|vich|mickey|palmera|arabesc|estrella|star|mariposa|mancha|osit|bear|pupp|conejit|frutill|fruta|macaron|cloudy|univers|space|rombo|l[ií]nea|confeti|d[aá]lmata|vaquita|reptil|wild|jungle|tiger|lion|le[oó]n|oveja|sheep|gatit|cat$|dog|elephant|lechuza|pajarit|pato|rabbit|chanchit|ardilla|kiwi|palta|lemon|papaya|pop ?corn|smile|carita|mermaid|rainbow|arco ?[ií]ris|pollock|aesthetic|arte|argentina|aurora|girly|grateful|lilo|milo|ma cherie|universe' then 'Estampados'
    when nombre ~* 'multicolor|smix|s(y|e)s|sc/|&|,' then 'Combinados'
    when nombre ~* 'negr|black' then 'Negros'
    when nombre ~* 'blanc|crem|natural|crud|mantec|huevo|hueso|marfil|ivory|perla|white' then 'Blancos y crudos'
    when nombre ~* 'nude|piel|beige|arena|camel|t[oó]stad|habano|chocolat|marr[oó]n|caf[eé]|suela|tierra|moka|vis[oó]n|avellana|canela|caramel|cacao|brown' then 'Nudes y marrones'
    when nombre ~* 'gris|plata|topo|melange|acero|humo|plomo|gr[ae]y' then 'Grises'
    when nombre ~* 'roj|bord|vino|malbec|granate|carmes|mredM' then 'Rojos'
    when nombre ~* 'ros|fucsi|magent|chicle|frambues|pink' then 'Rosas'
    when nombre ~* 'coral|salm[oó]n|duraz|naranj|terracot|ladrill|cobre|mandarin|orange' then 'Naranjas y corales'
    when nombre ~* 'amarill|mostaz|lim[oó]n|moroM|dorad|ocre|vainill|yellow|gold|lurex' then 'Amarillos y dorados'
    when nombre ~* 'verd|militar|oliva|esmerald|menta|lima|pistach|agua|aqua|turques|jade|green' then 'Verdes y aguas'
    when nombre ~* 'azul|marin|celest|franci|jean|denim|petr[oó]le|[ií]ndigo|cielo|navy|blue' then 'Azules'
    when nombre ~* 'violet|lila|uva|lavand|morad|orqu[ií]d|mora|ciruel|berenjen|malva|p[uú]rpur|lilac|purple' then 'Violetas y lilas'
    else 'Otros' end
where tipo = 'color' and grupo is null;

select jsonb_build_object(
  'escalas', (select jsonb_agg(s.nombre || ': ' || coalesce((select string_agg(a.nombre, ' · ' order by a.orden) from atributos a where a.escala_id = s.id and a.activo), '—') order by s.orden) from talle_escalas s),
  'sin_escala', (select jsonb_agg(nombre) from atributos where tipo = 'talle' and escala_id is null and activo),
  'familias', (select jsonb_agg(c.nombre || ' → ' || coalesce((select string_agg(s.nombre, ', ') from talle_escalas s where s.id = any(c.escalas)), '—') order by c.orden) from categorias c where c.activa),
  'colores', (select jsonb_object_agg(grupo, n) from (select grupo, count(*) n from atributos where tipo = 'color' and activo group by grupo) x)) r;

-- orden de las familias: 1, 2, 3… (había 999999 en casi todas)
update categorias c set orden = x.n from (select id, row_number() over (partition by empresa_id order by orden, nombre) n from categorias) x where x.id = c.id;
