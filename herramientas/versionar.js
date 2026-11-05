// Agrega ?v=<sello> a los .css/.js propios en todos los .html de Percha (para que el navegador no use versiones viejas)
const fs = require('fs'), path = require('path');
const raiz = process.argv[2] || path.join(__dirname, '..');   // la carpeta de Percha (sirve en cualquier PC)
const sello = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
let n = 0, archivos = 0;
const recorrer = d => fs.readdirSync(d, { withFileTypes: true }).forEach(x => {
  const p = path.join(d, x.name);
  if (x.isDirectory()) { if (!/^(node_modules|\.git|revision|supabase|sql)$/.test(x.name)) recorrer(p); return; }
  if (!x.name.endsWith('.html')) return;
  const s = fs.readFileSync(p, 'utf8');
  const t = s.replace(/(<(?:script|link)\b[^>]*?\b(?:src|href)=")((?!https?:|\/\/)[^"?#]+\.(?:js|css))(?:\?v=[^"]*)?(")/g, (m, a, u, b) => { n++; return a + u + '?v=' + sello + b; });
  if (t !== s) { fs.writeFileSync(p, t); archivos++; }
});
recorrer(raiz);
console.log(`sello ${sello}: ${n} referencias en ${archivos} páginas`);
