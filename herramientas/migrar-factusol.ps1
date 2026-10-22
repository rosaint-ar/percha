param(
  [string]$Db,                 # copia del 0012026.accdb (solo lectura; nunca el original)
  [string]$Salida,             # archivo .sql a generar
  [string]$EmpresaNombre = "Augusta Intimates"
)
# Migra el catálogo de FactuSOL al modelo multiempresa de Augusta Core.
# Es repetible: busca la empresa por nombre y hace upsert por código de FactuSOL.
$ErrorActionPreference = "Stop"
$inv = [System.Globalization.CultureInfo]::InvariantCulture
$cn = New-Object System.Data.Odbc.OdbcConnection("Driver={Microsoft Access Driver (*.mdb, *.accdb)};Dbq=$Db;ReadOnly=1;Exclusive=0;")
$cn.Open()
function Q($sql) { $c = $cn.CreateCommand(); $c.CommandText = $sql; $a = New-Object System.Data.Odbc.OdbcDataAdapter($c); $t = New-Object System.Data.DataTable; [void]$a.Fill($t); $t }
function vS($v) { if ($v -is [DBNull] -or $null -eq $v) { "null" } else { $x = "$v".Trim(); if ($x -eq "") { "null" } else { "'" + $x.Replace("'", "''") + "'" } } }
function vN($v) { if ($v -is [DBNull] -or $null -eq $v) { "0" } else { ([decimal]$v).ToString($inv) } }
function vD($v) { if ($v -is [DBNull] -or $null -eq $v -or ([datetime]$v).Year -le 1900) { "null" } else { "'" + ([datetime]$v).ToString("yyyy-MM-dd") + "'" } }
function T($v) { "$v".Trim() }
function vL($v) { "'" + "$v".Trim().Replace("'", "''") + "'" }   # literal: '' se mantiene como '' (no null)

$sb = New-Object System.Text.StringBuilder
$add = { param($l) [void]$sb.AppendLine($l) }
& $add "begin;"
& $add "do `$`$"
& $add "declare e uuid; d_gen uuid; d_mlf uuid; l1 uuid; l2 uuid; l3 uuid; l4 uuid;"
& $add "begin"
& $add "  select id into e from empresas where nombre = $(vS $EmpresaNombre);"
& $add "  if e is null then raise exception 'No existe la empresa %', $(vS $EmpresaNombre); end if;"

# --- Categorías (familias)
foreach ($r in Q "SELECT CODFAM, DESFAM, ORDFAM FROM F_FAM") {
  & $add "  insert into categorias (empresa_id, codigo, nombre, orden) values (e, $(vS $r.CODFAM), $(vS $r.DESFAM), $(vN $r.ORDFAM)) on conflict (empresa_id, nombre) do update set codigo = excluded.codigo;"
}
# --- Talles y colores
$i = 0
foreach ($r in Q "SELECT CODCE1, DESCE1, ORDCE1 FROM F_CE1 ORDER BY ORDCE1") { $i++
  & $add "  insert into atributos (empresa_id, tipo, codigo, nombre, orden) values (e, 'talle', $(vS $r.CODCE1), $(vS $r.DESCE1), $i) on conflict (empresa_id, tipo, codigo) do update set nombre = excluded.nombre, orden = excluded.orden;"
}
$i = 0
foreach ($r in Q "SELECT CODCE2, DESCE2, COLCE2 FROM F_CE2") { $i++
  $hex = "null"; if ($r.COLCE2 -isnot [DBNull] -and [int]$r.COLCE2 -gt 0) { $n = [int]$r.COLCE2; $hex = "'#{0:X2}{1:X2}{2:X2}'" -f ($n -band 0xFF), (($n -shr 8) -band 0xFF), (($n -shr 16) -band 0xFF) }
  & $add "  insert into atributos (empresa_id, tipo, codigo, nombre, hex, orden) values (e, 'color', $(vS $r.CODCE2), $(vS $r.DESCE2), $hex, $i) on conflict (empresa_id, tipo, codigo) do update set nombre = excluded.nombre, hex = excluded.hex;"
}
# --- Depósitos
& $add "  insert into depositos (empresa_id, codigo, nombre, principal) values (e, 'GEN', 'General', true) on conflict (empresa_id, codigo) do nothing;"
& $add "  insert into depositos (empresa_id, codigo, nombre, principal) values (e, 'MLF', 'Mercado Libre Full', false) on conflict (empresa_id, codigo) do nothing;"
& $add "  select id into d_gen from depositos where empresa_id = e and codigo = 'GEN';"
& $add "  select id into d_mlf from depositos where empresa_id = e and codigo = 'MLF';"
# --- Listas de precios (FactuSOL: 1 Lista 100%, 2 Contado 80%, 3 Débito 90%, 4 Mayorista 60%)
& $add "  insert into listas_precios (empresa_id, nombre, porcentaje, orden, predeterminada, codigo_fs) values (e, 'Lista', 100, 1, true, 1), (e, 'Contado', 80, 2, false, 2), (e, 'Débito', 90, 3, false, 3), (e, 'Mayorista', 60, 4, false, 4) on conflict (empresa_id, nombre) do update set codigo_fs = excluded.codigo_fs;"
& $add "  select id into l1 from listas_precios where empresa_id = e and codigo_fs = 1;"
& $add "  select id into l2 from listas_precios where empresa_id = e and codigo_fs = 2;"
& $add "  select id into l3 from listas_precios where empresa_id = e and codigo_fs = 3;"
& $add "  select id into l4 from listas_precios where empresa_id = e and codigo_fs = 4;"
# --- Proveedores
foreach ($r in Q "SELECT CODPRO, NOFPRO, NIFPRO, TELPRO, EMAPRO, POBPRO, DOMPRO, OBSPRO FROM F_PRO WHERE NOFPRO<>''") {
  & $add "  insert into proveedores (empresa_id, nombre, cuit, telefono, email, localidad, direccion, notas, codigo_fs) values (e, $(vS $r.NOFPRO), $(vS $r.NIFPRO), $(vS $r.TELPRO), $(vS $r.EMAPRO), $(vS $r.POBPRO), $(vS $r.DOMPRO), $(vS $r.OBSPRO), $(vS $r.CODPRO)) on conflict (empresa_id, nombre) do update set codigo_fs = excluded.codigo_fs, telefono = coalesce(excluded.telefono, proveedores.telefono);"
}
# --- Formas de pago
$tipo = { param($n) $n = $n.ToLower(); if ($n -match 'efectivo') { 'efectivo' } elseif ($n -match 'transferencia') { 'transferencia' } elseif ($n -match 'd[eé]bito') { 'debito' } elseif ($n -match 'mercado pago') { 'mercadopago' } elseif ($n -match 'online') { 'online' } elseif ($n -match 'cuota|naranja|nave|modo') { 'credito' } else { 'otro' } }
foreach ($r in Q "SELECT CODFPA, DESFPA FROM F_FPA WHERE DESFPA<>''") {
  $n = T $r.DESFPA; $cu = 1; if ($n -match '(\d+)\s*cuota') { $cu = [int]$Matches[1] }
  $lista = if ($n -match 'Efectivo|Transferencia') { 'l2' } elseif ($n -match '^D[eé]bito') { 'l3' } else { 'l1' }
  & $add "  insert into formas_pago (empresa_id, nombre, tipo, cuotas, lista_id, orden, codigo_fs) values (e, $(vS $n), '$(& $tipo $n)', $cu, $lista, $(vN $r.CODFPA), $(vN $r.CODFPA)) on conflict (empresa_id, nombre) do update set codigo_fs = excluded.codigo_fs, lista_id = excluded.lista_id;"
}
# --- Clientes
foreach ($r in Q "SELECT CODCLI, NOFCLI, NIFCLI, TELCLI, EMACLI, DOMCLI, POBCLI, TARCLI, FNACLI, OBSCLI FROM F_CLI WHERE NOFCLI<>''") {
  $gen = if ((T $r.NOFCLI) -match '^(CONS\. FINAL|ONLINE|AJUSTE)') { 'true' } else { 'false' }
  $lista = switch ([int](vN $r.TARCLI)) { 2 { 'l2' } 3 { 'l3' } 4 { 'l4' } default { 'l1' } }
  & $add "  insert into clientes (empresa_id, nombre, documento, telefono, email, direccion, localidad, nacimiento, notas, lista_id, generico, codigo_fs) values (e, $(vS $r.NOFCLI), $(vS $r.NIFCLI), $(vS $r.TELCLI), $(vS $r.EMACLI), $(vS $r.DOMCLI), $(vS $r.POBCLI), $(vD $r.FNACLI), $(vS $r.OBSCLI), $lista, $gen, $(vN $r.CODCLI)) on conflict do nothing;"
}
& $add "  delete from clientes where empresa_id = e and codigo_fs is not null and codigo_fs in (select codigo_fs from clientes where empresa_id = e group by codigo_fs having count(*) > 1) and id not in (select min(id::text)::uuid from clientes where empresa_id = e group by codigo_fs);"

# --- Productos
$precioLista = @{}; foreach ($r in Q "SELECT ARTLTC, MAX(PRELTC) AS p FROM F_LTC WHERE TARLTC=1 GROUP BY ARTLTC") { $precioLista[(T $r.ARTLTC)] = [decimal]$r.p }
foreach ($r in Q "SELECT ARTLTA, PRELTA FROM F_LTA WHERE TARLTA=1 AND PRELTA>0") { $k = T $r.ARTLTA; if (-not $precioLista.ContainsKey($k) -or $precioLista[$k] -eq 0) { $precioLista[$k] = [decimal]$r.PRELTA } }
$conVar = @{}; foreach ($r in Q "SELECT DISTINCT ARTARC FROM F_ARC") { $conVar[(T $r.ARTARC)] = $true }
$gen = @{ '100000' = 'sena'; '200000' = 'envio'; '300000' = 'gift_card'; '400000' = 'varios' }
$arts = Q "SELECT CODART, DESART, FAMART, PCOART, EANART, DEWART, OBSART, FALART FROM F_ART"
foreach ($r in $arts) {
  $k = T $r.CODART; $tipo = if ($gen.ContainsKey($k)) { $gen[$k] } else { 'prenda' }
  $p = if ($precioLista.ContainsKey($k)) { $precioLista[$k].ToString($inv) } else { "0" }
  $tv = if ($conVar.ContainsKey($k)) { 'true' } else { 'false' }
  & $add "  insert into productos (empresa_id, codigo, nombre, descripcion, categoria_id, costo, precio, ean, tipo, tiene_variantes, creado) values (e, $(vS $k), $(vS $r.DESART), $(vS $r.OBSART), (select id from categorias where empresa_id = e and codigo = $(vS $r.FAMART)), $(vN $r.PCOART), $p, $(vS $r.EANART), '$tipo', $tv, coalesce($(vD $r.FALART)::timestamptz, now())) on conflict (empresa_id, codigo) do update set nombre = excluded.nombre, categoria_id = excluded.categoria_id, costo = excluded.costo, precio = excluded.precio, ean = excluded.ean, tiene_variantes = excluded.tiene_variantes;"
}
# --- Variantes (y una variante "única" para los artículos sin talle/color, así el stock siempre cuelga de una variante)
$ean = @{}; foreach ($r in Q "SELECT ARTEAC, CE1EAC, CE2EAC, EANEAC FROM F_EAC WHERE EANEAC<>''") { $ean["$(T $r.ARTEAC)|$(T $r.CE1EAC)|$(T $r.CE2EAC)"] = T $r.EANEAC }
$pv = @{}; foreach ($r in Q "SELECT ARTLTC, CE1LTC, CE2LTC, PRELTC FROM F_LTC WHERE TARLTC=1") { $pv["$(T $r.ARTLTC)|$(T $r.CE1LTC)|$(T $r.CE2LTC)"] = [decimal]$r.PRELTC }
foreach ($r in Q "SELECT ARTARC, CE1ARC, CE2ARC FROM F_ARC") {
  $k = "$(T $r.ARTARC)|$(T $r.CE1ARC)|$(T $r.CE2ARC)"; $e = if ($ean.ContainsKey($k)) { vS $ean[$k] } else { "null" }
  $precio = "null"; if ($pv.ContainsKey($k) -and $precioLista.ContainsKey((T $r.ARTARC)) -and $pv[$k] -ne $precioLista[(T $r.ARTARC)] -and $pv[$k] -gt 0) { $precio = $pv[$k].ToString($inv) }
  & $add "  insert into variantes (empresa_id, producto_id, talle_id, color_id, sku, ean, precio) select e, p.id, t.id, c.id, p.codigo || '-' || $(vS (T $r.CE1ARC)) || '-' || $(vS (T $r.CE2ARC)), $e, $precio from productos p left join atributos t on t.empresa_id = e and t.tipo = 'talle' and t.codigo = $(vS (T $r.CE1ARC)) left join atributos c on c.empresa_id = e and c.tipo = 'color' and c.codigo = $(vS (T $r.CE2ARC)) where p.empresa_id = e and p.codigo = $(vS (T $r.ARTARC)) on conflict (producto_id, talle_id, color_id, estampa_id) do update set ean = coalesce(excluded.ean, variantes.ean), precio = excluded.precio;"
}
& $add "  insert into variantes (empresa_id, producto_id, sku, ean) select e, p.id, p.codigo, p.ean from productos p where p.empresa_id = e and not p.tiene_variantes and not exists (select 1 from variantes v where v.producto_id = p.id);"
# Combinaciones que tienen stock o ventas pero no figuran en F_ARC (FactuSOL las acepta igual): se crean para no perder stock
$arcSet = @{}; foreach ($r in Q "SELECT ARTARC, CE1ARC, CE2ARC FROM F_ARC") { $arcSet["$(T $r.ARTARC)|$(T $r.CE1ARC)|$(T $r.CE2ARC)"] = 1 }
foreach ($r in Q "SELECT DISTINCT ARTSTC, CE1STC, CE2STC FROM F_STC WHERE ACTSTC<>0") {
  $a = T $r.ARTSTC; $t1 = T $r.CE1STC; $t2 = T $r.CE2STC; $k = "$a|$t1|$t2"
  if ($arcSet.ContainsKey($k) -or ($t1 -eq '' -and $t2 -eq '' -and -not $conVar.ContainsKey($a))) { continue }
  $tSel = if ($t1 -eq '') { "null" } else { "(select id from atributos where empresa_id = e and tipo = 'talle' and codigo = $(vS $t1))" }
  $cSel = if ($t2 -eq '') { "null" } else { "(select id from atributos where empresa_id = e and tipo = 'color' and codigo = $(vS $t2))" }
  & $add "  insert into variantes (empresa_id, producto_id, talle_id, color_id, sku) select e, p.id, $tSel, $cSel, p.codigo || '-' || $(vL $t1) || '-' || $(vL $t2) from productos p where p.empresa_id = e and p.codigo = $(vS $a) and not exists (select 1 from variantes v left join atributos t on t.id = v.talle_id left join atributos c on c.id = v.color_id where v.producto_id = p.id and coalesce(t.codigo,'') = $(vL $t1) and coalesce(c.codigo,'') = $(vL $t2));"
}

# --- Stock: se carga como movimiento 'inicial' por la diferencia contra lo que ya haya (repetible)
foreach ($r in Q "SELECT ARTSTC, ALMSTC, CE1STC, CE2STC, ACTSTC FROM F_STC WHERE ACTSTC<>0") {
  $dep = if ((T $r.ALMSTC) -eq 'MLF') { 'd_mlf' } else { 'd_gen' }
  $art = T $r.ARTSTC; $t1 = T $r.CE1STC; $t2 = T $r.CE2STC
  $sel = "select v.id from variantes v join productos p on p.id = v.producto_id left join atributos t on t.id = v.talle_id left join atributos c on c.id = v.color_id where p.empresa_id = e and p.codigo = $(vS $art) and coalesce(t.codigo,'') = $(vL $t1) and coalesce(c.codigo,'') = $(vL $t2) limit 1"
  & $add "  insert into stock_movimientos (empresa_id, variante_id, deposito_id, cantidad, tipo, nota) select e, v.id, $dep, $(vN $r.ACTSTC) - coalesce((select cantidad from stock s where s.variante_id = v.id and s.deposito_id = $dep), 0), 'inicial', 'Migración FactuSOL' from ($sel) v where $(vN $r.ACTSTC) - coalesce((select cantidad from stock s where s.variante_id = v.id and s.deposito_id = $dep), 0) <> 0;"
}
& $add "end `$`$;"
& $add "commit;"
$cn.Close()
[System.IO.File]::WriteAllText($Salida, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
"OK: $($arts.Rows.Count) artículos -> $Salida ($([math]::Round((Get-Item $Salida).Length/1KB)) KB)"
