// ============================================================
// DATABASE.JS - TOUTES LES FONCTIONS
// ============================================================

// Récupérer le client Supabase depuis window
// (il a déjà été créé dans supabase-config.js)
const supabase = window.supabase;

if (!supabase) {
    console.error('❌ Supabase non disponible. Vérifie que supabase-config.js est chargé avant database.js');
}

// ============================================================
// AUTHENTIFICATION
// ============================================================

async function signUp(email, password, userData) {
    const { data, error } = await supabase.auth.signUp({
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
    const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password
    });
    if (error) throw error;
    return data;
}

async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
}

async function getCurrentUser() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    return user;
}

// ============================================================
// PROFIL
// ============================================================

async function getProfile(userId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
    if (error) throw error;
    return data;
}

async function updateProfile(userId, updates) {
    const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();
    if (error) throw error;
    return data;
}

// ============================================================
// BOUTIQUES
// ============================================================

async function getShops(filters = {}) {
    let query = supabase
        .from('shops')
        .select('*, products:products(count)');
    
    if (filters.country) query = query.eq('country', filters.country);
    if (filters.search) query = query.ilike('name', `%${filters.search}%`);
    if (filters.ownerId) query = query.eq('owner_id', filters.ownerId);
    
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
    const { data, error } = await supabase
        .from('shops')
        .select('*, products(*)')
        .eq('id', shopId)
        .single();
    if (error) throw error;
    return data;
}

async function createShop(shopData) {
    const { data, error } = await supabase
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
// PRODUITS
// ============================================================

async function getProducts(shopId, filters = {}) {
    let query = supabase
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
// COMMANDES
// ============================================================

async function createOrder(orderData, items) {
    const { data: order, error: orderError } = await supabase
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
    
    const { error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItems);
    if (itemsError) throw itemsError;
    
    await supabase
        .from('delivery_history')
        .insert([{
            order_id: order.id,
            status: 'confirmed',
            message: 'Commande confirmée'
        }]);
    
    return order;
}

async function getUserOrders(userId) {
    const { data, error } = await supabase
        .from('orders')
        .select('*, items:order_items(*)')
        .eq('client_id', userId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}

// ============================================================
// EXPORTS (pour les autres fichiers)
// ============================================================

window.signUp = signUp;
window.signIn = signIn;
window.signOut = signOut;
window.getCurrentUser = getCurrentUser;
window.getProfile = getProfile;
window.updateProfile = updateProfile;
window.getShops = getShops;
window.getShopById = getShopById;
window.createShop = createShop;
window.getProducts = getProducts;
window.createOrder = createOrder;
window.getUserOrders = getUserOrders;

console.log('✅ database.js chargé (toutes les fonctions)');
console.log('   - getShops:', typeof getShops);
console.log('   - getCurrentUser:', typeof getCurrentUser);
console.log('   - getProfile:', typeof getProfile);
console.log('   - signUp:', typeof signUp);
