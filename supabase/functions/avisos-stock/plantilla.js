// Plantillas de los mails de avisos de Augusta (la página de baja está en la web: avisos/baja.html). JS puro: lo usa la función y la vista previa local.
// Mail = tablas e estilos en línea (Gmail no lee <style> de afuera ni SVG). Fuentes de la marca con respaldo Georgia/Arial.
export const MARCA = { violeta: "#70547B", ciruela: "#604668", lila: "#E6DEF0", papel: "#F7F8F4", tinta: "#465362", gris: "#66717b", linea: "#dedbe0" };
const WEB = "https://www.augustaintimates.com";
const LOGO = WEB + "/assets/brand/logo-mail.png";
const SERIF = "Fraunces,Georgia,'Times New Roman',serif", SANS = "'Source Sans 3','Source Sans Pro',Arial,sans-serif", ETIQ = "'DM Sans',Arial,sans-serif";
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// «LESS «CATHERINE» ALGODÓN» → «Less «Catherine» Algodón»
export const nombreLindo = (s) => String(s || "").toLowerCase().replace(/(^|[\s«"(\/-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/(^|[\s(])(xxxl|xxl|xl|xs)(?=$|[\s)])/gi, (t) => t.toUpperCase());
export const pesos = (n) => "$" + Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });

function cabeza(titulo, previa) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(titulo)}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@600&family=Fraunces:ital,wght@0,500;1,500&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet">
<style>@media (max-width:520px){.caja{padding:26px 20px!important}.foto{width:112px!important}.titulo{font-size:30px!important}.nom{font-size:18px!important}}</style></head>
<body style="margin:0;padding:0;background:${MARCA.papel};color:${MARCA.tinta}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(previa)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${MARCA.papel}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td align="center" style="padding:6px 0 24px"><a href="${WEB}/" style="text-decoration:none"><img src="${LOGO}" width="170" alt="Augusta Intimates" style="display:block;width:170px;height:auto;border:0;color:${MARCA.violeta};font:500 26px ${SERIF}"></a></td></tr>`;
}
function pie(baja, motivo) {
  return `<tr><td style="padding:26px 22px 8px;text-align:center;font:13px/1.6 ${SANS};color:${MARCA.gris}">${esc(motivo)}</td></tr>
<tr><td style="padding:0 22px 6px;text-align:center;font:13px/1.6 ${SANS};color:${MARCA.gris}">${baja ? `<a href="${esc(baja)}" style="color:${MARCA.gris};text-decoration:underline">No quiero recibir este aviso</a> · ` : ""}<a href="https://wa.me/543584365289" style="color:${MARCA.gris};text-decoration:underline">¿Dudas? Escribinos</a></td></tr>
<tr><td style="padding:10px 22px 0;text-align:center;font:600 10px/1.6 ${ETIQ};letter-spacing:1.6px;text-transform:uppercase;color:${MARCA.ciruela}">Augusta Intimates · Río Cuarto, Córdoba</td></tr>
</table></td></tr></table></body></html>`;
}
function boton(texto, enlace) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0"><tr><td style="background:${MARCA.violeta}"><a href="${esc(enlace)}" style="display:inline-block;padding:15px 30px;font:600 13px/1.2 ${ETIQ};color:#ffffff;text-decoration:none;letter-spacing:.3px">${esc(texto)} &nbsp;→</a></td></tr></table>`;
}
// Una prenda: foto a la izquierda, datos a la derecha (en celular quedan igual, más chicos).
function prenda(it) {
  const aviso = it.pocas ? `<div style="display:inline-block;margin-top:10px;padding:4px 9px;background:${MARCA.lila};color:${MARCA.ciruela};font:600 10px/1.4 ${ETIQ};letter-spacing:1px;text-transform:uppercase">Quedan pocas</div>` : "";
  return `<tr><td style="padding:14px 0;border-top:1px solid ${MARCA.linea}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
${it.imagen ? `<td width="132" valign="top" style="width:132px"><a href="${esc(it.enlace)}"><img class="foto" src="${esc(it.imagen)}" width="132" alt="${esc(it.nombre)}" style="display:block;width:132px;height:auto;border:0;background:#fff"></a></td>
` : ""}<td valign="middle" style="padding-left:${it.imagen ? 20 : 0}px"><a class="nom" href="${esc(it.enlace)}" style="text-decoration:none;font:500 21px/1.25 ${SERIF};color:${MARCA.violeta}">${esc(it.nombre)}</a>
<div style="margin-top:6px;font:14px/1.5 ${SANS};color:${MARCA.tinta}">${esc(it.detalle)}</div>
${it.precio ? `<div style="margin-top:8px;font:500 19px/1.2 ${SERIF};color:${MARCA.tinta}">${esc(it.precio)}</div>` : ""}${aviso}
<div style="margin-top:12px"><a href="${esc(it.enlace)}" style="font:600 12px/1.4 ${ETIQ};color:${MARCA.violeta};text-decoration:underline">Ver prenda</a></div></td></tr></table></td></tr>`;
}

// Volvió (una o varias prendas) / entraron prendas en tu talle.
export function mailVolvio({ titulo, intro, items, boton: b, previa, baja, motivo }) {
  return cabeza(titulo, previa) + `<tr><td class="caja" style="background:#ffffff;padding:38px 36px">
<div style="font:600 11px/1.4 ${ETIQ};letter-spacing:1.8px;text-transform:uppercase;color:${MARCA.ciruela};margin-bottom:14px">Buenas noticias ♡</div>
<h1 class="titulo" style="margin:0;font:500 34px/1.15 ${SERIF};color:${MARCA.violeta};letter-spacing:-.5px">${esc(titulo)}</h1>
<p style="margin:16px 0 22px;font:17px/1.55 ${SANS};color:${MARCA.tinta}">${esc(intro)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items.map(prenda).join("")}</table>
<div style="padding-top:24px;border-top:1px solid ${MARCA.linea}">${boton(b.texto, b.enlace)}</div>
<p style="margin:18px 0 0;font:14px/1.55 ${SANS};color:${MARCA.gris}">Las unidades se reservan cuando completás la compra. Si alguna se agota antes, te la podemos volver a avisar.</p>
</td></tr>` + pie(baja, motivo);
}

// «Listo, te avisamos».
export function mailAnotado({ titulo, intro, items, previa, baja, motivo }) {
  return cabeza(titulo, previa) + `<tr><td class="caja" style="background:#ffffff;padding:38px 36px">
<div style="font:600 11px/1.4 ${ETIQ};letter-spacing:1.8px;text-transform:uppercase;color:${MARCA.ciruela};margin-bottom:14px">Aviso anotado</div>
<h1 class="titulo" style="margin:0;font:500 32px/1.15 ${SERIF};color:${MARCA.violeta};letter-spacing:-.5px">${esc(titulo)}</h1>
<p style="margin:16px 0 22px;font:17px/1.55 ${SANS};color:${MARCA.tinta}">${esc(intro)}</p>
${items.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items.map(prenda).join("")}</table>` : ""}
<div style="margin-top:22px;padding:16px 18px;background:${MARCA.lila};font:15px/1.5 ${SANS};color:${MARCA.ciruela}">Te escribimos una sola vez, cuando entre. Sin publicidad.</div>
</td></tr>` + pie(baja, motivo);
}
