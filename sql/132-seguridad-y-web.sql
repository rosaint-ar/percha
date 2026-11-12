-- 132 · Relevamiento 12/11 (fondo): seguridad + talles sacados que seguían en la web + tareas automáticas
-- 1) 20 funciones de mantenimiento (fusionar productos, mover colores, armar kits, ajustes desde el cruce, turnos de ARCA,
--    llamar al cron…) se podían ejecutar con la llave pública del navegador SIN usuario ni permisos. Ninguna pantalla las
--    usa (las llaman solo el servidor y otras funciones internas): se les saca el permiso a anon/authenticated.
--    venta_es_reservada la usa una regla de acceso: se le saca solo a anon.
-- 2) Un talle·color que se saca en Percha (activa = false) avisa a la web: tn-push le manda stock 0 (antes seguía a la
--    venta con el stock de antes). Una vez: se avisa por los 21 que ya estaban así.
-- 3) tn-codigos y tn-precios corrían en el mismo minuto y competían por el límite de la web: tn-codigos pasa a :05, :15…
-- 4) Limpieza diaria: la cola de envíos a la web (hechos > 30 días) y el historial del cron (> 7 días).
begin;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname in ('producto_fusionar_en','producto_mover_color','kit_armar','box_repartir_sin_definir','atributo_fusionar','atributo_fusionar_por_nombre',
      'variante_fusionar','canal_vincular_item','fallas_vender','variante_indefinida','encolar_canal','encolar_publicar','cron_llamar','arca_cron',
      'arca_tomar_turno','arca_soltar_turno','atributo_desde_canal','proximo_numero','stock_web_de')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public' where p.proname = 'venta_es_reservada'
  loop execute format('revoke execute on function %s from public, anon', f.sig); execute format('grant execute on function %s to authenticated, service_role', f.sig); end loop;
end $$;

create or replace function trg_variante_apagada_a_canal() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.activa and not new.activa and exists (select 1 from canal_items where variante_id = new.id) then perform encolar_canal(new.empresa_id, new.id); end if;
  return new;
end $$;
drop trigger if exists trg_variante_apagada_a_canal on variantes;
create trigger trg_variante_apagada_a_canal after update of activa on variantes for each row execute function trg_variante_apagada_a_canal();

select count(*) encolados from (select encolar_canal(v.empresa_id, v.id) from variantes v join productos p on p.id = v.producto_id
  where not v.activa and p.tipo <> 'kit' and exists (select 1 from canal_items ci where ci.variante_id = v.id)) x;

select cron.alter_job((select jobid from cron.job where jobname = 'percha_tn_codigos'), schedule := '5-59/10 * * * *');
select cron.unschedule('percha_limpieza') where exists (select 1 from cron.job where jobname = 'percha_limpieza');
select cron.schedule('percha_limpieza', '30 6 * * *', $$delete from canal_cola where estado = 'hecho' and hecho < now() - interval '30 days'; delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
commit;
