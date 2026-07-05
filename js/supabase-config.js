// ============================================================
// SUPABASE-CONFIG.JS - CONFIGURATION UNIQUEMENT
// ============================================================

// ✅ URL CORRECTE (sans /rest/v1/)
const SUPABASE_URL = 'https://mdufmsfnjkeewopzcvei.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kdWZtc2ZuamtlZXdvcHpjdmVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNTExMzksImV4cCI6MjA5NzYyNzEzOX0.3vD0NrLd6k7ZJNcuCro3NLDHeVQVX3HVG2YdZMy00hw';

console.log('🔌 Connexion à Supabase...');
console.log('📡 URL:', SUPABASE_URL ? '✅' : '❌');
console.log('🔑 Clé:', SUPABASE_ANON_KEY ? '✅' : '❌');

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabase = supabaseClient;

console.log('✅ supabase-config.js chargé');
