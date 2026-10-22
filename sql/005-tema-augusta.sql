-- Tema visual por empresa: solo el color de acento (el sistema nunca muestra el logo de la empresa, sí su nombre)
update empresas
set config = jsonb_set(config, '{tema}', '{"color":"#70547B"}'::jsonb)
where nombre = 'Augusta Intimates';
select nombre, config->'tema' as tema from empresas;
