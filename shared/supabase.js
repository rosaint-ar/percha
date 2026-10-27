// Conexión a Supabase (clave publicable: puede ir en el navegador; el acceso real lo decide RLS)
window.SUPABASE_URL = 'https://ooqcdpxehcehuofolefq.supabase.co';
window.SUPABASE_KEY = 'sb_publishable_Wv5XwgzasCMlEB4lb82erw_oYgLYoo4';
window.sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
// el stock es uno solo: después de cada venta o ajuste, lo que cambió sale enseguida a los canales conectados
// (si no, igual lo manda el servidor en menos de un minuto)
window.empujarStock = async (e) => {
  try {
    e = e || (window.APP && APP.empresa && APP.empresa.id); if (!e) return;
    const { data: { session } } = await sb.auth.getSession(); if (!session) return;
    fetch(`${SUPABASE_URL}/functions/v1/tn-push`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ empresa_id: e }) }).catch(() => {});
  } catch (_) {}
};
