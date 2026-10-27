-- 059 · Publicaciones de la web con el código de otro producto (27/10/2026)
--   Top Margaery: la web usa 300201 (en Percha es el Top Sara); el de Percha es 300202 → se cruzan y el stock queda como la web.
--   Pantuflón Argentina: la web usa 910103 (Animados); el de Percha es 910108 → se cruzan los talles (el stock ya coincide).
--   La variante "sin talle" del Argentina (39 u.) queda para revisar: no se toca sin confirmación.
begin;
update canal_items ci set variante_id = x.v, cruce = 'manual', actualizado = now() from (values
 (42,'1a669db7-9a23-4f50-a524-db32cd1a0fc7'::uuid),(43,'37c70273-12c7-4b87-8430-949b30ebf272'),(44,'37d13072-4cf6-4ad0-bd7c-0e04e28039fc'),(45,'64356d76-3249-46c1-91f2-d24cea31cc7a'),
 (100,'545c6fbe-ec67-4a17-bf9e-84b522b94f8e'),(101,'a8bf1542-9afe-4ca8-89de-3048ca43db58'),(102,'cb8f9201-82b9-44f1-aa32-132207a8ead6'),(103,'4cc690b1-5e5b-4bd6-a590-550eef432217'),
 (4016,'8f05277a-392a-419b-aff1-c176604cca33'),(4017,'ec98cd42-34e6-4c3c-b346-fc7b488b5070'),(4018,'56825483-a2c8-4720-84af-ff5f5994c0e1'),(4019,'7de8f885-d9af-49b9-b2c0-fbc965f1d104')) x(id, v) where ci.id = x.id;
update variantes set chequear = 'Sin talle, 39 u.: la web tiene 5 (por talle). ¿Existen o es stock viejo? (27/10)' where id = '8c7c6da0-03c5-4325-91c5-904d50a8a5ea';
select set_config('request.jwt.claims','{"sub":"5f43c17d-958a-4ef7-badc-1a4001a20747","role":"authenticated"}',true);
set local role authenticated;
select jsonb_agg(stock_ajustar(jsonb_build_object('variante_id', v, 'modo', 'fijar', 'cantidad', 1, 'motivo', 'Recuento', 'nota', 'Igual a Tienda Nube (27/10)')))
 from (values ('1a669db7-9a23-4f50-a524-db32cd1a0fc7'::uuid), ('64356d76-3249-46c1-91f2-d24cea31cc7a')) t(v);
commit;
