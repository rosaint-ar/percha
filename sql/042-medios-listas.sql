-- 042 · Cada medio de pago aplica a TODAS las listas de precios (por defecto) o solo a las que se elijan (una, varias).
--       formas_pago.listas = null o vacío → todas. lista_id queda sincronizado (la única lista, si hay una sola) para la caja.

alter table formas_pago add column if not exists listas uuid[];

-- lo que ya estaba atado a una lista (Efectivo → Contado, Débito → Débito, cuotas → Lista) se respeta
update formas_pago set listas = array[lista_id] where lista_id is not null and listas is null;

create or replace function formas_pago_sync_listas() returns trigger language plpgsql as $$
begin
  if new.listas is not null and cardinality(new.listas) = 0 then new.listas := null; end if;
  new.lista_id := case when new.listas is not null and cardinality(new.listas) = 1 then new.listas[1] else null end;
  return new;
end $$;
drop trigger if exists trg_formas_pago_listas on formas_pago;
create trigger trg_formas_pago_listas before insert or update of listas on formas_pago for each row execute function formas_pago_sync_listas();

select jsonb_agg(f.nombre || ' → ' || coalesce((select string_agg(l.nombre, ', ') from listas_precios l where l.id = any(f.listas)), 'todas')) r from formas_pago f;
