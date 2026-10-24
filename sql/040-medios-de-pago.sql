-- 040 · Medios de pago ordenados: grupo (efectivo, transferencia, débito, tarjeta/cuotas, billetera/QR, online, otro),
--       empresa que lo procesa (Mercado Pago, MODO, NAVE, Naranja, GO Cuotas, Payway, Viumi…) y banco, reconocidos solos por el nombre.
--       Ranking de uso (FactuSOL último año + Percha) para mostrar primero los más usados.

alter table formas_pago add column if not exists grupo text;
alter table formas_pago add column if not exists proveedor text;
alter table formas_pago add column if not exists banco text;

-- reconoce empresa, banco y grupo a partir del nombre
create or replace function medio_pago_reconocer(p_nombre text, p_tipo text default null, p_cuotas int default 1) returns jsonb
language plpgsql immutable as $$
declare n text := lower(translate(coalesce(p_nombre, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')); prov text; banco text; grupo text;
begin
  prov := case
    when n ~ 'mercado ?pago|mpago|\mmp\M' then 'mercadopago'
    when n ~ 'mercado ?libre' then 'mercadolibre'
    when n ~ 'pago ?nube|tienda ?nube|tiendanube' then 'tiendanube'
    when n ~ '\mmodo\M' then 'modo'
    when n ~ '\mnave\M' then 'nave'
    when n ~ 'naranja|plan z' then 'naranja'
    when n ~ 'go ?cuotas' then 'gocuotas'
    when n ~ 'payway' then 'payway'
    when n ~ 'viumi' then 'viumi'
    when n ~ 'uala' then 'uala'
    when n ~ 'cuenta ?dni' then 'cuentadni'
    when n ~ 'personal ?pay' then 'personalpay'
    when n ~ 'getnet' then 'getnet'
    when n ~ 'rapi ?pago|pago ?facil' then 'cupon'
    end;
  banco := case
    when n ~ 'galicia' then 'galicia' when n ~ 'macro' then 'macro' when n ~ 'santander' then 'santander'
    when n ~ 'nacion|\mbna\M' then 'nacion' when n ~ 'provincia|bapro' then 'provincia' when n ~ 'bbva|frances' then 'bbva'
    when n ~ 'credicoop' then 'credicoop' when n ~ 'icbc' then 'icbc' when n ~ 'brubank' then 'brubank' when n ~ 'hsbc' then 'hsbc'
    when n ~ 'cordoba|bancor' then 'bancor' when n ~ 'supervielle' then 'supervielle' when n ~ 'patagonia' then 'patagonia'
    end;
  grupo := case
    when n ~ 'sin cargo|regalo|canje' then 'otro'
    when n ~ 'efectivo|contado efectivo' or p_tipo = 'efectivo' then 'efectivo'
    when n ~ '^online|mercado ?libre|pago ?nube|tienda ?nube|rapi ?pago|pago ?facil' then 'online'
    when n ~ 'transfer|deposito' or p_tipo = 'transferencia' then 'transferencia'
    when n ~ 'debito' then 'debito'
    when n ~ '\mqr\M|\mmodo\M|billetera|cuenta ?dni|uala|personal ?pay' then 'billetera'
    when n ~ 'cuota|credito|tarjeta|plan z|go ?cuotas|payway|viumi|nave|getnet' or coalesce(p_cuotas, 1) > 1 or p_tipo in ('credito', 'mercadopago') then 'credito'
    else 'otro' end;
  return jsonb_build_object('proveedor', prov, 'banco', banco, 'grupo', grupo);
end $$;

-- al crear o renombrar un medio se reconoce solo (lo que se eligió a mano no se pisa)
create or replace function formas_pago_reconocer() returns trigger language plpgsql as $$
declare r jsonb;
begin
  r := medio_pago_reconocer(new.nombre, new.tipo, new.cuotas);
  if tg_op = 'INSERT' or new.nombre is distinct from old.nombre then
    if new.grupo is null or (tg_op = 'UPDATE' and new.grupo is not distinct from old.grupo) then new.grupo := r->>'grupo'; end if;
    if new.proveedor is null or (tg_op = 'UPDATE' and new.proveedor is not distinct from old.proveedor) then new.proveedor := r->>'proveedor'; end if;
    if new.banco is null or (tg_op = 'UPDATE' and new.banco is not distinct from old.banco) then new.banco := r->>'banco'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_formas_pago_reconocer on formas_pago;
create trigger trg_formas_pago_reconocer before insert or update on formas_pago for each row execute function formas_pago_reconocer();

-- los que ya están
update formas_pago f set grupo = coalesce(f.grupo, r->>'grupo'), proveedor = coalesce(f.proveedor, r->>'proveedor'), banco = coalesce(f.banco, r->>'banco')
from (select id, medio_pago_reconocer(nombre, tipo, cuotas) r from formas_pago) x where x.id = f.id;
-- "Débito" estaba como tipo "otro"
update formas_pago set tipo = 'debito' where grupo = 'debito' and tipo = 'otro';

-- ranking de uso: FactuSOL último año + ventas de Percha (no reservadas)
create or replace function formas_pago_uso(e uuid) returns table (forma_pago_id uuid, usos bigint)
language sql stable security definer set search_path = public as $$
  select f.id,
         (select count(*) from fs_remitos r where f.codigo_fs is not null and r.forma_pago = f.codigo_fs and r.fecha >= current_date - 365)
       + (select count(*) from venta_pagos vp join ventas v on v.id = vp.venta_id where vp.forma_pago_id = f.id and not v.reservada and v.estado <> 'anulada')
  from formas_pago f where f.empresa_id = e and es_miembro(e);
$$;

select jsonb_agg(nombre || ' → ' || coalesce(grupo, '?') || ' · ' || coalesce(proveedor, '-') || coalesce(' · ' || banco, '') order by orden) r from formas_pago;
