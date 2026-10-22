// Conexión a Supabase (clave publicable: puede ir en el navegador; el acceso real lo decide RLS)
window.SUPABASE_URL = 'https://ooqcdpxehcehuofolefq.supabase.co';
window.SUPABASE_KEY = 'sb_publishable_Wv5XwgzasCMlEB4lb82erw_oYgLYoo4';
window.sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
