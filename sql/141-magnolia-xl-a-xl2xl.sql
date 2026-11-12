-- 141 · 12/11 (Diego): PIJAMA «MAGNOLIA» tenía XL y XL/2XL a la vez; el stock quedó en XL y en la web es XL/2XL.
-- El stock de XL pasa a XL/2XL (mismo depósito) y XL se apaga (tn-push borra la opción XL de la web, la de Cherry).
-- Además: ROUSE, MEDIAS INVISIBLE «COLORS» y PILATES pasan a «En la web: Sí» (las únicas con stock de esa lista de 60).
begin;
create temp table _mov on commit drop as
select s.deposito_id, x.id xl, y.id xl2, sum(s.cantidad) cant, x.sku
from variantes x
join variantes y on y.producto_id = x.producto_id and y.color_id is not distinct from x.color_id and y.activa
join atributos tx on tx.id = x.talle_id and tx.nombre = 'XL'
join atributos ty on ty.id = y.talle_id and ty.nombre = 'XL/2XL'
join stock s on s.variante_id = x.id
join productos p on p.id = x.producto_id
where p.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and p.nombre = 'PIJAMA «MAGNOLIA»' and x.activa
group by 1, 2, 3, 5 having sum(s.cantidad) <> 0;

insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota)
select '82c05bbf-e63e-4d25-a762-6f1ee6d27f43'::uuid, xl, deposito_id, -cant, 'ajuste', 'Pasa a XL/2XL (la web y el talle real son XL/2XL)' from _mov
union all
select '82c05bbf-e63e-4d25-a762-6f1ee6d27f43'::uuid, xl2, deposito_id, cant, 'ajuste', 'Viene de XL (' || sku || ')' from _mov;

update variantes set activa = false
 where id in (select x.id from variantes x join atributos tx on tx.id = x.talle_id and tx.nombre = 'XL' join productos p on p.id = x.producto_id
              where p.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and p.nombre = 'PIJAMA «MAGNOLIA»' and x.activa);

select json_agg(z) from (select vv.color_nombre, vv.talle_nombre, vv.activa, vv.stock from v_variantes vv
  where vv.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and vv.producto_nombre = 'PIJAMA «MAGNOLIA»' and vv.talle_nombre in ('XL', 'XL/2XL') order by 1, 2) z;
commit;
-- (aplicado junto) update productos set publicar_web = true where codigo in ('100439','900211','900213');
