// ============================================================
// SUPABASE-CONFIG.JS - CONFIGURATION UNIQUEMENT
// Ce fichier contient uniquement les identifiants et l'initialisation
// ============================================================

// ============================================================
// CONFIGURATION SUPABASE
// ============================================================

// ⚠️ ATTENTION : Une seule déclaration de SUPABASE_URL !
// Pour Netlify (production)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mdufmsfnjkeewopzcvei.supabase.co/rest/v1/';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kdWZtc2ZuamtlZXdvcHpjdmVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNTExMzksImV4cCI6MjA5NzYyNzEzOX0.3vD0NrLd6k7ZJNcuCro3NLDHeVQVX3HVG2YdZMy00hw';

// Vérification
console.log('🔌 Connexion à Supabase...');
console.log('📡 URL:', SUPABASE_URL ? '✅ Configurée' : '❌ Manquante');
console.log('🔑 Clé:', SUPABASE_ANON_KEY ? '✅ Configurée' : '❌ Manquante');

// Initialisation
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// EXPOSER LE CLIENT DANS WINDOW
// ============================================================

// Le client Supabase est disponible pour les autres fichiers
window.supabase = supabaseClient;

console.log('✅ supabase-config.js chargé (configuration uniquement)');
console.log('   - supabase:', typeof supabase);
