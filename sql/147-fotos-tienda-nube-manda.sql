-- 147 · 13/11 (Diego): «las imágenes de productos las vamos a manejar en Tienda Nube; lo que se suba allí tiene que
-- sincronizar con Percha, todas, y mantenerse actualizado. Si queremos usar Percha para subirlas también, sin errores,
-- sin duplicar». Y «la configuración, en el apartado de integraciones; un sistema que sirva para otros negocios».
--
-- FOTOS: cada foto que vino de la web queda atada a SU imagen de Tienda Nube (imagen_ext + publicación). Así:
--   · se reconoce por el número de imagen, no por la dirección (nunca se repite)
--   · si en la web se borra, se cambia el orden o se reemplaza, Percha la sigue (también las «generales», que antes quedaban viejas)
--   · una foto subida desde Percha, apenas está en la web, pasa a ser una foto de la web (la de Percha se retira: no hay dos)
--   · borrar desde Percha una foto de la web la marca (borrar_web) y la función la borra en Tienda Nube (si la conexión lo permite)
--   · color_fijo: el color se eligió a mano en Percha; la sincronización no lo pisa
alter table producto_fotos add column if not exists imagen_ext text;
alter table producto_fotos add column if not exists producto_ext text;
alter table producto_fotos add column if not exists conexion_id uuid references conexiones(id) on delete cascade;
alter table producto_fotos add column if not exists color_fijo boolean not null default false;
alter table producto_fotos add column if not exists borrar_web boolean not null default false;
create unique index if not exists producto_fotos_imagen on producto_fotos (producto_id, imagen_ext) where imagen_ext is not null;
create index if not exists producto_fotos_conexion on producto_fotos (conexion_id, producto_ext) where conexion_id is not null;

-- La foto de un color «fijado» a mano no la cambia la sincronización
create or replace function producto_fotos_color_a_mano() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and new.color_id is distinct from old.color_id then new.color_fijo := true; end if;
  return new;
end $$;
drop trigger if exists trg_producto_fotos_color on producto_fotos;
create trigger trg_producto_fotos_color before update of color_id on producto_fotos for each row execute function producto_fotos_color_a_mano();

-- Duplicar una prenda copia las fotos como «de Percha» (van a la publicación nueva cuando se publique). Antes copiaba
-- «de la web» y esas fotos quedaban huérfanas: no eran de ninguna publicación de la prenda nueva.
create or replace function public.producto_duplicar(p jsonb)
 returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare o productos%rowtype; nuevo uuid; cod text;
begin
  select * into o from productos where id = (p->>'producto_id')::uuid;
  if o.id is null or not es_admin(o.empresa_id) then raise exception 'Sin permiso'; end if;
  cod := coalesce(nullif(btrim(p->>'codigo'), ''), proximo_codigo(o.empresa_id, o.codigo));
  if exists (select 1 from productos where empresa_id = o.empresa_id and codigo = cod) then raise exception 'Ya existe un producto con el código %', cod; end if;
  insert into productos (empresa_id, codigo, nombre, descripcion, categoria_id, proveedor_id, costo, precio, tipo, tiene_variantes, imagen_url, activo, es_generico, generico_filtro, temporada_id, marca_id)
  values (o.empresa_id, cod, coalesce(nullif(btrim(p->>'nombre'), ''), o.nombre || ' (copia)'), o.descripcion, o.categoria_id, o.proveedor_id, o.costo, o.precio, o.tipo, o.tiene_variantes,
          case when coalesce((p->>'fotos')::boolean, false) then o.imagen_url end, true, o.es_generico, o.generico_filtro, o.temporada_id, o.marca_id)
  returning id into nuevo;
  if coalesce((p->>'variantes')::boolean, true) or not o.tiene_variantes or o.tipo = 'kit' then
    insert into variantes (empresa_id, producto_id, talle_id, color_id, estampa_id, sku, costo, precio)
    select v.empresa_id, nuevo, v.talle_id, v.color_id, v.estampa_id,
           case when v.sku like o.codigo || '%' then cod || substr(v.sku, length(o.codigo) + 1) else cod end, v.costo, v.precio
    from variantes v where v.producto_id = o.id and v.activa
      and (coalesce((p->>'variantes')::boolean, true) or (v.talle_id is null and v.color_id is null and v.estampa_id is null));
  end if;
  insert into producto_componentes (empresa_id, producto_id, variante_id, cantidad, componente_producto_id, filtro)
  select empresa_id, nuevo, variante_id, cantidad, componente_producto_id, filtro from producto_componentes where producto_id = o.id;
  insert into precios (empresa_id, lista_id, producto_id, variante_id, precio)
  select empresa_id, lista_id, nuevo, null, precio from precios where producto_id = o.id and variante_id is null;
  if coalesce((p->>'fotos')::boolean, false) then
    insert into producto_fotos (empresa_id, producto_id, color_id, url, orden, origen, color_fijo)
    select distinct on (color_id, url) empresa_id, nuevo, color_id, url, orden, 'manual', color_fijo
    from producto_fotos where producto_id = o.id and not borrar_web order by color_id, url, orden;
  end if;
  return nuevo;
end $function$;

-- Avisos al instante de Tienda Nube (un producto cambió en la web): la función los anota acá y tn-publicar los procesa
-- en el minuto (fotos y visible/oculto). La lectura completa cada 30 min sigue de respaldo.
create table if not exists canal_cambios_web (
  conexion_id uuid not null references conexiones(id) on delete cascade,
  producto_ext text not null,
  evento text,
  recibido timestamptz not null default now(),
  primary key (conexion_id, producto_ext)
);
alter table canal_cambios_web enable row level security;   -- solo las funciones (service role)

-- CONFIGURACIÓN POR CONEXIÓN (Conexiones › Tienda Nube): lo que antes estaba fijo en el código para Augusta.
--   fotos_desde_percha  true  = también se pueden subir/borrar fotos desde Percha (van a la web); false = solo Tienda Nube
--   publicar_nuevos     true  = una prenda o color nuevo de Percha se crea solo en la web
--   nuevos_ocultos      true  = …oculto (para completar fotos y texto allá)
--   espera_min          10    = minutos sin cambios antes de subirla
--   medidas             peso (kg) y medidas (cm) de lo que se crea; null = no se mandan
--   nuevos_ingresos_dias 30   = días en «Nuevos Ingresos» (0 = no se usa)
--   codigos_percha      true  = Percha pone el SKU/MPN en la web (tn-codigos)
update conexiones set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
    'fotos_desde_percha', true, 'publicar_nuevos', true, 'nuevos_ocultos', true, 'espera_min', 10,
    'medidas', jsonb_build_object('peso', 0.010, 'ancho', 4, 'alto', 4, 'profundidad', 4),
    'nuevos_ingresos_dias', 30, 'codigos_percha', true)
where canal = 'tiendanube' and not (coalesce(config, '{}'::jsonb) ? 'fotos_desde_percha');

-- tn-codigos leía todo el catálogo cada 10 min: cada 30 alcanza (los códigos casi nunca se cambian a mano) y deja
-- lugar en el límite de pedidos de Tienda Nube para el stock y las fotos.
select cron.alter_job((select jobid from cron.job where jobname = 'percha_tn_codigos'), schedule := '25,55 * * * *');
