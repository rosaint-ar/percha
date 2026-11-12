-- 126 · «XL al 3XL» reemplaza a «XL al XXXL» (y «L al 3XL» a «L al XXXL") — 12/11, Diego: queda la notación 3XL,
--       la del talle que creó en la escala Bombachas. Las variantes pasan al talle nuevo (y su SKU interno), los viejos se
--       apagan. Las publicaciones de la web de esas variantes están todas atadas a mano (cruce manual): siguen andando
--       aunque en la web el talle diga «XXXL».
begin;
update atributos set activo = true, orden = 212 where id = '01a49660-95d2-45a7-b91b-597721cf3be1';   -- L al 3XL
update atributos set orden = 215 where id = 'fa3043ad-ece6-44e0-9fcc-3c9ad80792e5';                  -- XL al 3XL
update variantes set talle_id = 'fa3043ad-ece6-44e0-9fcc-3c9ad80792e5', sku = replace(sku, '-XLALXXXL', '-XLAL3XL')
where talle_id = 'f5ea096e-3165-41a2-949d-77041e45f44e';
update variantes set talle_id = '01a49660-95d2-45a7-b91b-597721cf3be1', sku = replace(sku, '-LALXXXL', '-LAL3XL')
where talle_id = '332c6d57-0e84-437b-a601-3e5671bf50d7';
update atributos set activo = false where id in ('f5ea096e-3165-41a2-949d-77041e45f44e', '332c6d57-0e84-437b-a601-3e5671bf50d7');

select t.nombre, t.activo, (select count(*) from variantes v where v.talle_id = t.id) vars
from atributos t where t.id in ('01a49660-95d2-45a7-b91b-597721cf3be1', 'fa3043ad-ece6-44e0-9fcc-3c9ad80792e5', 'f5ea096e-3165-41a2-949d-77041e45f44e', '332c6d57-0e84-437b-a601-3e5671bf50d7');
commit;
