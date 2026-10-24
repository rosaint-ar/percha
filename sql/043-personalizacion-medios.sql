-- 043 · Personalización completa de medios de pago:
--  · cada medio puede tener su propio ícono (sigla + color, o una imagen) y marcarse "destacado" (aparece primero en la caja)
--  · cualquier empresa, banco o grupo (incluso los que Percha ya conoce, como MODO o "Efectivo") se puede renombrar y cambiarle el ícono:
--    se guarda en medios_entidades con la misma clave (pisa al conocido; borrarlo lo restablece)
--  · almacenamiento de imágenes (logos, íconos) por empresa: bucket "percha", carpeta = id de la empresa

alter table formas_pago add column if not exists icono_texto text;
alter table formas_pago add column if not exists icono_color text;
alter table formas_pago add column if not exists icono_url text;
alter table formas_pago add column if not exists destacado boolean not null default false;

alter table medios_entidades drop constraint if exists medios_entidades_tipo_check;
alter table medios_entidades add constraint medios_entidades_tipo_check check (tipo in ('proveedor', 'banco', 'grupo'));
alter table medios_entidades add column if not exists icono_url text;
alter table medios_entidades alter column sigla drop not null;
alter table medios_entidades alter column color drop not null;

-- imágenes
insert into storage.buckets (id, name, public) values ('percha', 'percha', true) on conflict (id) do nothing;
drop policy if exists percha_subir on storage.objects;
create policy percha_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'percha' and (storage.foldername(name))[1] in (select empresa_id::text from empresa_usuarios where user_id = auth.uid() and activo));
drop policy if exists percha_cambiar on storage.objects;
create policy percha_cambiar on storage.objects for update to authenticated
  using (bucket_id = 'percha' and (storage.foldername(name))[1] in (select empresa_id::text from empresa_usuarios where user_id = auth.uid() and activo));
drop policy if exists percha_borrar on storage.objects;
create policy percha_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'percha' and (storage.foldername(name))[1] in (select empresa_id::text from empresa_usuarios where user_id = auth.uid() and activo));
drop policy if exists percha_ver on storage.objects;
create policy percha_ver on storage.objects for select using (bucket_id = 'percha');

select (select count(*) from storage.buckets where id = 'percha') bucket, (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'percha_%') politicas;
