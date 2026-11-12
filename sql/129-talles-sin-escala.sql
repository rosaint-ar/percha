-- 129 · Talles: ninguno usado fuera de una escala (12/11, Diego: "si lo destildo no se va").
-- 1) 9 variantes de 100514/100515/100516 (creadas mientras se armaba la escala Bombachas) usaban el «S al L» repetido que
--    sql/125 apagó: la ventana de talles no lo mostraba. Pasan al «S al L» de siempre (SKU interno sin cambiar).
-- 2) Los talles que seguían «Sin escala» van a su escala, así se ven (y se pueden sacar) en la ventana de talles:
--    pantuflas «1 (35 al 37)» y «2 (38 al 40)» → Calzado y pantuflas; corpiños «A (85)»…«D (100)», «1 (85 a 95)»,
--    «2 (100 a 110)» → Contorno; «34 cm» y «47 cm» → Único.
begin;
update variantes set talle_id = 'b29e8079-01f3-407b-b1b3-131bf236b8e7'
where talle_id = 'd65844c6-c10e-4265-bcf0-7f722c7211cd'
  and not exists (select 1 from variantes o where o.producto_id = variantes.producto_id and o.talle_id = 'b29e8079-01f3-407b-b1b3-131bf236b8e7' and o.color_id is not distinct from variantes.color_id);

with m(nombre, escala, o) as (values
  ('1 (35 al 37)', 'Calzado y pantuflas', 1), ('2 (38 al 40)', 'Calzado y pantuflas', 2),
  ('A (85)', 'Contorno', 1), ('B (90)', 'Contorno', 2), ('C (95)', 'Contorno', 3), ('D (100)', 'Contorno', 4),
  ('1 (85 a 95)', 'Contorno', 5), ('2 (100 a 110)', 'Contorno', 6), ('34 cm', 'Único', 1), ('47 cm', 'Único', 2))
update atributos a set escala_id = s.id, orden = s.orden * 100 + 50 + m.o
from m join talle_escalas s on s.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and s.activa and s.nombre = m.escala
where a.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and a.tipo = 'talle' and a.activo and a.escala_id is null and a.nombre = m.nombre;

-- control: variantes activas con un talle apagado o sin escala (tiene que dar 0)
select count(*) quedan from variantes v join atributos t on t.id = v.talle_id
where v.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and v.activa
  and (not t.activo or t.escala_id is null or t.escala_id in (select id from talle_escalas where not activa));
commit;
