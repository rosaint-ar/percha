-- 117 · Al conectar una publicación de la web con una prenda de Percha, si el stock no coincide se PREGUNTA cuál vale
-- (06/11/2026, Diego: "que me pregunte para decidir, sí"). Antes ganaba Percha sin avisar (lo que pasó con la LEILA).
-- Vale para todos los caminos de conexión: la sincronización automática (tn-sync), el cruce a mano (Cruce de productos) y
-- cualquier corrección por base. Lo que crea Percha en la web (tn-publicar) nace con el mismo stock: no pregunta nada.
--   · canal_items.stock_a_decidir: la conexión quedó con stock distinto; tn-push NO manda nada de esa prenda hasta decidir.
--   · canal_decidir_stock(variante, 'web' | 'percha'): «vale la web» pone en Percha el stock de la web (ajuste Recuento);
--     «vale Percha» manda el de Percha a la web.
--   · canal_avisos(empresa): para el Inicio — publicaciones visibles de la web sin conectar y conexiones a decidir.
--   · canal_a_decidir(conexion): la lista para la pestaña «A decidir» del Cruce de productos.

alter table canal_items add column if not exists stock_a_decidir boolean not null default false;

-- stock que Percha mandaría a la web para una variante (sin kits ni genéricos: esos tienen su propia cuenta y no se preguntan)
create or replace function stock_web_de(v uuid) returns numeric language sql stable security definer set search_path = public as $$
  select case when p.tipo = 'kit' or p.es_generico or vv.sku ~* '-SD$' then null
              else greatest(0, floor(coalesce(vv.stock, 0) - coalesce(vv.fallas, 0))) end
  from v_variantes vv join productos p on p.id = vv.producto_id where vv.id = v
$$;

create or replace function canal_items_decidir_stock() returns trigger language plpgsql security definer set search_path = public as $$
declare pw numeric;
begin
  if new.variante_id is null then new.stock_a_decidir := false; return new; end if;
  if tg_op = 'UPDATE' and new.variante_id is not distinct from old.variante_id then return new; end if;
  -- conexión nueva: ¿la web y Percha dicen lo mismo?
  pw := stock_web_de(new.variante_id);
  -- si la web reparte la prenda en varias publicaciones (talles que Percha tiene juntos), se compara el total
  new.stock_a_decidir := coalesce(new.publicado, true) and new.stock is not null and pw is not null
    and pw <> new.stock + coalesce((select sum(stock) from canal_items o where o.variante_id = new.variante_id and o.conexion_id = new.conexion_id
                                     and o.id is distinct from new.id and o.publicado and o.stock is not null), 0);
  return new;
end $$;
drop trigger if exists canal_items_decidir_stock on canal_items;
create trigger canal_items_decidir_stock before insert or update of variante_id on canal_items
  for each row execute function canal_items_decidir_stock();

create or replace function canal_decidir_stock(p_variante uuid, p_vale text) returns jsonb language plpgsql security definer set search_path = public as $$
declare e uuid; web numeric; antes numeric; dep uuid;
begin
  select empresa_id into e from variantes where id = p_variante;
  if e is null or not es_miembro(e) or rol_en(e) not in ('duenio', 'admin') then raise exception 'Solo administración decide el stock de la web'; end if;
  if p_vale not in ('web', 'percha') then raise exception 'Elegí web o percha'; end if;
  -- lo que dice la web: la suma de sus publicaciones visibles conectadas a esta prenda
  if not exists (select 1 from canal_items where variante_id = p_variante and stock_a_decidir) then return jsonb_build_object('ok', true, 'nada', true); end if;
  select coalesce(sum(stock), 0) into web from canal_items where variante_id = p_variante and publicado and stock is not null;
  antes := coalesce((select sum(cantidad) from stock where variante_id = p_variante), 0);
  if p_vale = 'web' then
    -- el stock de la web es lo que se vende online; las prendas con falla quedan en el local (se suman)
    web := web + coalesce((select fallas from variantes where id = p_variante), 0);
    if web <> antes then
      dep := (select id from depositos where empresa_id = e and principal limit 1);
      insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota, motivo)
      values (e, p_variante, dep, web - antes, 'ajuste', 'Al conectar con la web: vale el stock de la web', 'Recuento');
    end if;
  end if;
  update canal_items set stock_a_decidir = false where variante_id = p_variante and stock_a_decidir;
  perform encolar_canal(e, p_variante);   -- con «vale la web» ya coinciden y no se escribe nada; con «vale Percha» se manda
  return jsonb_build_object('ok', true, 'vale', p_vale, 'percha_antes', antes, 'percha_ahora', coalesce((select sum(cantidad) from stock where variante_id = p_variante), 0));
end $$;

create or replace function canal_avisos(e uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select case when not es_miembro(e) then '{}'::jsonb else jsonb_build_object(
    'sin_conectar', (select count(distinct ci.producto_ext) from canal_items ci join conexiones c on c.id = ci.conexion_id
                      where c.empresa_id = e and c.estado = 'activa' and ci.publicado and ci.variante_id is null),
    'sin_conectar_con_stock', (select count(distinct ci.producto_ext) from canal_items ci join conexiones c on c.id = ci.conexion_id
                      where c.empresa_id = e and c.estado = 'activa' and ci.publicado and ci.variante_id is null and coalesce(ci.stock, 0) > 0),
    'a_decidir', (select count(distinct ci.variante_id) from canal_items ci join conexiones c on c.id = ci.conexion_id
                      where c.empresa_id = e and c.estado = 'activa' and ci.stock_a_decidir),
    'conexion', (select id from conexiones where empresa_id = e and estado = 'activa' and canal = 'tiendanube' limit 1)) end
$$;

create or replace function canal_a_decidir(c uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'prenda'), '[]'::jsonb) from (
    select jsonb_build_object('variante_id', vv.id, 'prenda', vv.producto_nombre, 'codigo', vv.producto_codigo,
             'talle', vv.talle_nombre, 'color', vv.color_nombre, 'percha', stock_web_de(vv.id), 'fallas', coalesce(vv.fallas, 0),
             'web', (select coalesce(sum(o.stock), 0) from canal_items o where o.variante_id = vv.id and o.conexion_id = c and o.publicado and o.stock is not null), 'publicacion', min(ci.nombre), 'valores', string_agg(distinct ci.valores, ' · '), 'imagen', min(ci.imagen)) x
    from canal_items ci join v_variantes vv on vv.id = ci.variante_id
    where ci.conexion_id = c and ci.stock_a_decidir and es_miembro(vv.empresa_id)
    group by vv.id, vv.producto_nombre, vv.producto_codigo, vv.talle_nombre, vv.color_nombre, vv.fallas) s
$$;

grant execute on function canal_decidir_stock(uuid, text), canal_avisos(uuid), canal_a_decidir(uuid) to authenticated;
