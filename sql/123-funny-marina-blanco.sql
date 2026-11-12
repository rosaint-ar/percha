-- 123 · Arreglos pedidos por Diego el 12/11 (lo que quedó del cruce de la web):
--   1) MEDIAS INVISIBLE «COLORS» Blanco: vale la web (4) → Percha pasa de 3 a 4 (ajuste por Recuento, canal_decidir_stock).
--   2) MEDIAS SOQUETE ALTO «FUNNY» (900217): se le agregan los colores Just, Ok! y R (como en la web). El trigger
--      variantes_canal_al_modelo (sql/122) pasa solas sus publicaciones de MEDIAS VARIAS al modelo.
--   3) LESS «MARINA» ALGODÓN XXXL (100276): en la web tiene 2 talles por color, «XL al XXL» y «XXXL». En Percha la
--      variante del talle «XL al XXL» había quedado SIN talle (parecía un color repetido). Se le pone el talle y las
--      publicaciones «XXXL» (que estaban en BOMBIS «VARIAS») se cruzan con la variante XXXL de cada color.
begin;
select set_config('request.jwt.claims', '{"sub":"5f43c17d-958a-4ef7-badc-1a4001a20747","role":"authenticated"}', true);

-- 1) Blanco: vale la web
select canal_decidir_stock('1a65f14a-72dd-4409-8ec6-10e03f6cac83', 'web');

-- 2) FUNNY: colores nuevos (en el grupo Estampados, como Smile y Rayada)
select compras_agregar_color(p.id, c) from productos p, unnest(array['Just', 'Ok!', 'R']) c
where p.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and p.codigo = '900217';
update atributos set grupo = 'Estampados'
where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and tipo = 'color' and nombre in ('Just', 'Ok!', 'R') and grupo is null;

-- 3) MARINA: la variante sin talle es la «XL al XXL»
update variantes v set talle_id = 'f001994d-0837-43df-87b1-91e510b6dad7',
  sku = concat_ws('-', p.codigo, 'XLALXXL', (select codigo from atributos where id = v.color_id))
from productos p
where p.id = v.producto_id and p.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and p.codigo = '100276' and v.talle_id is null;

update canal_items ci set variante_id = v.id, cruce = 'manual'
from productos p, variantes v, atributos c
where p.empresa_id = ci.empresa_id and p.codigo = '100276' and v.producto_id = p.id and v.activa
  and v.talle_id = 'd4fc7c28-3a63-444a-a8f3-593e8e4699fa' and c.id = v.color_id
  and ci.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and ci.nombre = 'LESS «MARINA» ALGODÓN XXXL'
  and ci.talle_canal = 'XXXL' and lower(ci.color_canal) = lower(c.nombre)
  and ci.variante_id is distinct from v.id;

-- control
select ci.nombre, ci.valores, p.nombre modelo, c.nombre color, t.nombre talle, ci.stock_a_decidir
from canal_items ci join variantes v on v.id = ci.variante_id join productos p on p.id = v.producto_id
left join atributos c on c.id = v.color_id left join atributos t on t.id = v.talle_id
where ci.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43'
  and (ci.nombre in ('LESS «MARINA» ALGODÓN XXXL', 'MEDIAS SOQUETE ALTO «FUNNY»') or ci.variante_id = '1a65f14a-72dd-4409-8ec6-10e03f6cac83')
order by 1, 2;

commit;
