-- 144 · 12/11 (Diego): «Categorías en la web» EXACTAS, elegidas en Percha (no por aproximación).
-- · canal_categorias: el árbol de categorías de la tienda (lo trae tn-sincronizar cada 30 min).
-- · productos.categorias_web: las categorías de la web de la prenda (ids de Tienda Nube), SIN «Nuevos Ingresos» (esa la
--   maneja Percha sola, 30 días). Las dos direcciones:
--     web → Percha: tn-sincronizar las trae (si en Percha no hay un cambio sin mandar).
--     Percha → web: al cambiarlas en la ficha queda categorias_web_pendiente = true; tn-publicar las pone en todas las
--     publicaciones de la prenda (+ «Nuevos Ingresos» si todavía está dentro de sus 30 días).
-- · categorias_web_sugeridas: true = las puso Percha por parecido (la prenda nueva no tenía ninguna tildada): revisarlas.
begin;
create table if not exists canal_categorias (
  conexion_id uuid not null references conexiones(id) on delete cascade,
  empresa_id uuid not null references empresas(id) on delete cascade,
  ext_id bigint not null,
  nombre text not null,
  padre bigint,
  orden int not null default 0,
  ruta text,
  actualizado timestamptz not null default now(),
  primary key (conexion_id, ext_id)
);
alter table canal_categorias enable row level security;
drop policy if exists canal_categorias_ver on canal_categorias;
create policy canal_categorias_ver on canal_categorias for select using (es_miembro(empresa_id));

alter table productos add column if not exists categorias_web jsonb;
alter table productos add column if not exists categorias_web_pendiente boolean not null default false;
alter table productos add column if not exists categorias_web_sugeridas boolean not null default false;

-- un cambio hecho por una persona (no por la sincronización) queda para mandar a la web
create or replace function trg_productos_categorias_web() returns trigger language plpgsql as $$
begin
  if new.categorias_web is distinct from old.categorias_web and coalesce(current_setting('percha.cat_sync', true), '') <> '1' then
    new.categorias_web_pendiente := true;
    new.categorias_web_sugeridas := false;   -- alguien las revisó
  end if;
  return new;
end $$;
drop trigger if exists productos_categorias_web on productos;
create trigger productos_categorias_web before update of categorias_web on productos for each row execute function trg_productos_categorias_web();

-- la sincronización (web → Percha): [{producto_id, cats:[ids]}]; no pisa lo que Percha tiene sin mandar
create or replace function canal_categorias_a_percha(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform set_config('percha.cat_sync', '1', true);
  update productos pr set categorias_web = x.cats
  from (select (j->>'producto_id')::uuid pid, j->'cats' cats from jsonb_array_elements(coalesce(p, '[]'::jsonb)) j) x
  where pr.id = x.pid and not pr.categorias_web_pendiente and pr.categorias_web is distinct from x.cats;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function canal_categorias_a_percha(jsonb) from public, anon, authenticated;
grant execute on function canal_categorias_a_percha(jsonb) to service_role;

-- Percha las sugirió (prenda nueva sin categorías tildadas): quedan marcadas para revisar, ya mandadas a la web
create or replace function producto_categorias_sugeridas(p_producto uuid, p_cats jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('percha.cat_sync', '1', true);
  update productos set categorias_web = p_cats, categorias_web_sugeridas = true, categorias_web_pendiente = false where id = p_producto;
end $$;
revoke execute on function producto_categorias_sugeridas(uuid, jsonb) from public, anon, authenticated;
grant execute on function producto_categorias_sugeridas(uuid, jsonb) to service_role;
commit;
-- las 13 prendas que subió Percha hoy: sus categorías son las sugeridas por parecido → «para revisar»
update productos set categorias_web_sugeridas = true
 where id in (select distinct v.producto_id from canal_items ci join variantes v on v.id = ci.variante_id where ci.de_percha) and not categorias_web_sugeridas
returning nombre;
-- las 12 de sep-oct que Diego dejó en «Nuevos Ingresos»: mismo plazo de 30 días (desde el 12/11)
update canal_items set nuevo_hasta = now() + interval '30 days'
 where conexion_id = '6ecb8eee-1108-463b-a6e4-8161815c730c' and nuevo_hasta is null
   and producto_ext in ('368897072','368900832','368999165','369015764','372195547','372198513','372202444','372203561','372296852','372300490','372326174','372332982')
returning producto_ext;
