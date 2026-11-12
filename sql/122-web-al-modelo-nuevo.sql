-- 122 · Modelo nuevo de un código general → su publicación de la web pasa sola al modelo (11/11, pedido de Diego:
--       "debería quedar arreglado también para cuando sumo productos a estos conjuntos")
-- Caso: Emi publica en Tienda Nube un modelo nuevo con el código compartido (100200 bombachas, 900203 medias) antes de
-- que exista en Percha → la sincronización lo ata al código general (BOMBIS «VARIAS» / MEDIAS VARIAS). Cuando después se
-- crea el modelo en Percha (o se le agrega el color), cada variante nueva busca la publicación de la web con el MISMO
-- nombre, color y talle que esté atada a un código general, y la pasa al modelo (cruce manual, la sincronización lo respeta).
-- El cambio de cruce pasa por el trigger de "stock a decidir": si la web y Percha no coinciden, pregunta; no pisa.
-- (tn-sync, desde el 11/11, ya cruza con el modelo si existe; esto cubre el orden inverso: primero la web, después Percha.)
begin;

create or replace function canal_al_modelo_nuevo() returns trigger
language plpgsql security definer set search_path = public as $$
declare p productos%rowtype; col text; tal text;
begin
  if not new.activa then return new; end if;
  select * into p from productos where id = new.producto_id;
  if p.id is null or p.es_generico or not p.activo or p.tipo = 'kit' then return new; end if;
  select nombre into col from atributos where id = new.color_id;
  select nombre into tal from atributos where id = new.talle_id;
  update canal_items ci set variante_id = new.id, cruce = 'manual'
  where ci.id = (
    select c.id from canal_items c join variantes gv on gv.id = c.variante_id join productos g on g.id = gv.producto_id and g.es_generico
    where c.empresa_id = new.empresa_id and c.cruce <> 'manual' and upper(c.nombre) = upper(p.nombre)
      and lower(coalesce(c.color_canal, '')) = lower(coalesce(col, ''))
      and (tal is null or lower(coalesce(c.talle_canal, '')) = lower(tal))
    order by c.publicado desc, c.id limit 1);
  return new;
end $$;

drop trigger if exists variantes_canal_al_modelo on variantes;
create trigger variantes_canal_al_modelo after insert or update of activa on variantes
  for each row execute function canal_al_modelo_nuevo();

commit;
