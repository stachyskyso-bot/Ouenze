// ============================================================
// DATABASE.JS - COUCHE D'ABSTRACTION UNIQUE
// Toute interaction avec les données passe par ici
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
// 1. AUTHENTIFICATION
// ============================================================

async function signUp(email, password, userData) {
    const { data, error } = await supabaseClient.auth.signUp({
        email: email,
        password: password,
        options: {
            data: userData,
            emailRedirectTo: 'https://ouenze.netlify.app/'
        }
    });
    if (error) throw error;
    if (data?.user?.identities?.length === 0) {
        throw new Error('Cet email est déjà utilisé.');
    }
    return data;
}

async function signIn(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
    });
    if (error) throw error;
    return data;
}

async function signOut() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
}

async function getCurrentUser() {
    const { data: { user }, error } = await supabaseClient.auth.getUser();
    if (error || !user) return null;
    return user;
}

// ============================================================
// 2. PROFIL
// ============================================================

async function getProfile(userId) {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
    if (error) throw error;
    return data;
}

async function updateProfile(userId, updates) {
    const { data, error } = await supabaseClient
        .from('profiles')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();
    if (error) throw error;
    return data;
}

// ============================================================
// 3. BOUTIQUES
// ============================================================

async function getShops(filters = {}) {
    let query = supabaseClient
        .from('shops')
        .select('*, products:products(count)');
    
    if (filters.city) query = query.eq('city', filters.city);
    if (filters.minRating) query = query.gte('rating', filters.minRating);
    if (filters.search) query = query.ilike('name', `%${filters.search}%`);
    if (filters.ownerId) query = query.eq('owner_id', filters.ownerId);
    if (filters.country) query = query.eq('country', filters.country);
    
    const { data, error } = await query;
    if (error) throw error;
    
    return data.map(shop => ({
        ...shop,
        products: [],
        rating: shop.rating || 0,
        totalRatings: shop.total_ratings || 0,
        totalSales: shop.total_sales || 0,
        products_count: shop.products?.[0]?.count || 0
    }));
}

async function getShopById(shopId) {
    const { data, error } = await supabaseClient
        .from('shops')
        .select('*, products(*)')
        .eq('id', shopId)
        .single();
    if (error) throw error;
    return data;
}

async function createShop(shopData) {
    const { data, error } = await supabaseClient
        .from('shops')
        .insert([{
            owner_id: shopData.owner_id,
            name: shopData.name,
            slug: shopData.slug || shopData.name.toLowerCase().replace(/ /g, '-'),
            description: shopData.description || '',
            logo_url: shopData.logo_url || '',
            city: shopData.city || 'Brazzaville',
            district: shopData.district || '',
            address: shopData.address || '',
            country: shopData.country || 'Congo-Brazzaville',
            has_physical_store: shopData.has_physical_store || false,
            total_shares: shopData.total_shares || 10000
        }])
        .select()
        .single();
    if (error) throw error;
    return data;
}

// ============================================================
// 4. PRODUITS
// ============================================================

async function getProducts(shopId, filters = {}) {
    let query = supabaseClient
        .from('products')
        .select('*, variants:product_variants(*)')
        .eq('shop_id', shopId);
    
    if (filters.categoryId) query = query.eq('category_id', filters.categoryId);
    if (filters.productType) query = query.eq('product_type', filters.productType);
    if (filters.search) query = query.ilike('name', `%${filters.search}%`);
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
}

// ============================================================
// 5. COMMANDES
// ============================================================

async function createOrder(orderData, items) {
    const { data: order, error: orderError } = await supabaseClient
        .from('orders')
        .insert([{
            client_id: orderData.client_id,
            total: orderData.total,
            delivery_fees: orderData.delivery_fees || 0,
            status: orderData.status || 'confirmed',
            payment_method: orderData.payment_method,
            delivery_info: orderData.delivery_info,
            tracking_step: 1
        }])
        .select()
        .single();
    if (orderError) throw orderError;
    
    const orderItems = items.map(item => ({
        order_id: order.id,
        product_id: item.product_id || null,
        shop_id: item.shop_id,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        variant_name: item.variant_name || null
    }));
    
    const { error: itemsError } = await supabaseClient
        .from('order_items')
        .insert(orderItems);
    if (itemsError) throw itemsError;
    
    await supabaseClient
        .from('delivery_history')
        .insert([{
            order_id: order.id,
            status: 'confirmed',
            message: 'Commande confirmée'
        }]);
    
    return order;
}

async function getUserOrders(userId) {
    const { data, error } = await supabaseClient
        .from('orders')
        .select('*, items:order_items(*)')
        .eq('client_id', userId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}

// ============================================================
// 6. EXPORTS (TOUTES LES FONCTIONS DANS WINDOW)
// ============================================================

// Auth
window.signUp = signUp;
window.signIn = signIn;
window.signOut = signOut;
window.getCurrentUser = getCurrentUser;

// Profile
window.getProfile = getProfile;
window.updateProfile = updateProfile;

// Shops
window.getShops = getShops;
window.getShopById = getShopById;
window.createShop = createShop;

// Products
window.getProducts = getProducts;

// Orders
window.createOrder = createOrder;
window.getUserOrders = getUserOrders;

// Client
window.supabase = supabaseClient;

// ============================================================
// 7. VÉRIFICATION FINALE
// ============================================================

console.log('✅ database.js chargé');
console.log('   - signUp:', typeof signUp);
console.log('   - signIn:', typeof signIn);
console.log('   - getCurrentUser:', typeof getCurrentUser);
console.log('   - getShops:', typeof getShops);
console.log('   - getProfile:', typeof getProfile);
console.log('   - supabase:', typeof supabase);
