-- 134 · Códigos de barras repetidos (12/11, Diego: "regenerá los códigos de barras, están mal generados").
-- Venían de FactuSOL: 21 códigos estaban en más de una prenda (2002040007832 en 30 prendas de crochet/bordadas; los
-- conjuntos ALONDRA/CIELO/JAZMÍN, IRIS/LAUREN/LIA y los BODY compartían los mismos por talle·color, etc.). Al escanear,
-- la caja agarraba cualquiera. A TODAS las variantes de esos códigos se les da uno nuevo y único.
-- Formato: EAN-13 de uso interno del local: 29 + 10 dígitos correlativos + dígito verificador (no choca con ninguno: no
-- había ninguno que empezara con 29). ean_nuevo(e) queda para usar cuando haga falta un código nuevo.
-- Las etiquetas viejas de esas prendas dejan de servir: hay que reimprimir las que tienen stock.
begin;
create or replace function public.ean_digito(c12 text) returns text language sql immutable as $$
  select ((10 - (sum(substr(c12, i, 1)::int * case when i % 2 = 0 then 3 else 1 end) % 10)) % 10)::text from generate_series(1, 12) i
$$;

create or replace function public.ean_nuevo(e uuid) returns text language plpgsql security definer set search_path = public as $$
declare n bigint; c text;
begin
  select coalesce(max(substr(ean, 3, 10)::bigint), 0) + 1 into n from variantes where empresa_id = e and ean ~ '^29\d{11}$';
  loop
    c := '29' || lpad(n::text, 10, '0'); c := c || ean_digito(c);
    exit when not exists (select 1 from variantes where empresa_id = e and ean = c);
    n := n + 1;
  end loop;
  return c;
end $$;
revoke all on function public.ean_nuevo(uuid) from public, anon;
grant execute on function public.ean_nuevo(uuid) to authenticated, service_role;

create temp table _rep on commit drop as
select v.id, v.ean viejo from variantes v
where v.empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and coalesce(v.ean, '') <> ''
  and v.ean in (select ean from variantes where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and coalesce(ean, '') <> '' group by ean having count(*) > 1);

do $$ declare r record; begin
  for r in select id from _rep order by viejo, id loop
    update variantes set ean = ean_nuevo('82c05bbf-e63e-4d25-a762-6f1ee6d27f43') where id = r.id;
  end loop;
end $$;

-- control: repetidos que quedan (tiene que dar 0) y lo cambiado con stock (para reimprimir etiquetas)
select (select count(*) from (select ean from variantes where empresa_id = '82c05bbf-e63e-4d25-a762-6f1ee6d27f43' and coalesce(ean, '') <> '' group by ean having count(*) > 1) x) repetidos,
  (select count(*) from _rep) cambiadas;
commit;
