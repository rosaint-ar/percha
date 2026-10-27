-- 053 · Stock compartido con la web (27/10/2026)
--   Una prenda con falla no se publica online (stock web = stock − fallas). Marcar o quitar una falla no mueve stock,
--   así que hasta ahora no avisaba a la web: ahora sí encola la variante para que el stock web se recalcule.
create or replace function trg_encolar_fallas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.fallas, 0) is distinct from coalesce(old.fallas, 0) then perform encolar_canal(new.empresa_id, new.id); end if;
  return new;
end $$;
drop trigger if exists trg_fallas_a_canal on variantes;
create trigger trg_fallas_a_canal after update of fallas on variantes for each row execute function trg_encolar_fallas();
