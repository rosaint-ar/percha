-- Tareas programadas: cada minuto se empuja el stock pendiente y cada 2 minutos se leen pedidos nuevos del canal.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function cron_llamar(fn text) returns void
language plpgsql security definer set search_path = public as $$
declare k text; u text;
begin
  select valor into k from app_config where clave = 'cron_key';
  u := 'https://ooqcdpxehcehuofolefq.supabase.co/functions/v1/' || fn;
  perform net.http_post(url := u, headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', coalesce(k, '')), body := '{}'::jsonb, timeout_milliseconds := 55000);
end $$;

select cron.unschedule(jobid) from cron.job where jobname in ('percha_tn_push', 'percha_tn_pedidos');
select cron.schedule('percha_tn_push', '* * * * *', $$select cron_llamar('tn-push')$$);
select cron.schedule('percha_tn_pedidos', '*/2 * * * *', $$select cron_llamar('tn-pedidos')$$);
select jobname, schedule, active from cron.job where jobname like 'percha_%';
