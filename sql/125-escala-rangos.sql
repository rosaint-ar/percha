-- 125 · Escala «Bombachas» con los talles de rango (12/11, Diego: "cuando selecciono talles de las bombachas no me salen
--       opciones tipo rango, S al XL; están en Sin escala"). La ventana «Agregar talles y colores» solo muestra talles de
--       una escala, y los rangos estaban sin escala.
--   Paso 1 (13:40): se creó la escala «Rangos» con los rangos sin escala y se sumó a la familia BOMBACHAS.
--   Paso 2: al mismo tiempo Diego creó a mano la escala «Bombachas» (13:39) con S al L, S al XL, XS al M, M al XL (repetidos
--   de los que ya existían, sin uso) y M al XXL, L al XXL, L al 3XL (nuevos). Se junta todo en la escala de Diego:
--   los rangos que se usan pasan a «Bombachas», los 4 repetidos y «L al 3XL» (= «L al XXXL», que ya existe y es como
--   figura en la web) se apagan, «Rangos» se apaga, y la familia BOMBACHAS usa «Bombachas».
begin;
update talle_escalas set orden = 2 where id = '5c6a0470-3a3b-4391-a145-c4d82ffee905';
update talle_escalas set activa = false where id = '2ecd3e4b-04ba-4bec-9554-9995f817a969';
update atributos set activo = false
where id in ('de66fa47-9dc5-4b54-a766-aaf55a6f4560', 'd65844c6-c10e-4265-bcf0-7f722c7211cd', '0aa42c40-a6da-432c-81e8-04b183353acd',
             'fe596730-f46e-4e4d-ba07-a734ba3e33d7', '01a49660-95d2-45a7-b91b-597721cf3be1')
  and not exists (select 1 from variantes v where v.talle_id = atributos.id);
with orden(nombre, n) as (values
  ('XS al S', 1), ('XS al M', 2), ('1 (XS al L)', 3), ('S al M', 4), ('S al L', 5), ('1 (S al L)', 6), ('S al XL', 7),
  ('M al XL', 8), ('M al XXL', 9), ('L al XL', 10), ('L al XXL', 11), ('L al XXXL', 12), ('XL al XXL', 13), ('2 (XL al XXL)', 14),
  ('XL al XXXL', 15), ('XXL al XXXL', 16))
update atributos a set escala_id = '5c6a0470-3a3b-4391-a145-c4d82ffee905', orden = 200 + o.n
from orden o
where a.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and a.tipo = 'talle' and a.activo and a.nombre = o.nombre
  and a.escala_id in ('2ecd3e4b-04ba-4bec-9554-9995f817a969', '5c6a0470-3a3b-4391-a145-c4d82ffee905');
update categorias set escalas = array_append(array_remove(array_remove(escalas, '2ecd3e4b-04ba-4bec-9554-9995f817a969'::uuid), '5c6a0470-3a3b-4391-a145-c4d82ffee905'::uuid), '5c6a0470-3a3b-4391-a145-c4d82ffee905'::uuid)
where id = '3a09c8b6-5a3b-49d5-8446-f943aab0f07c';

select e.nombre, e.orden, (select string_agg(t.nombre, ', ' order by t.orden) from atributos t where t.escala_id = e.id and t.activo) talles,
  (select count(*) from atributos t where t.escala_id = e.id and t.activo) n
from talle_escalas e where e.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and e.activa order by e.orden;
commit;
