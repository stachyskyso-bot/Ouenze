// ============================================================
// DATABASE.JS - TOUTES LES FONCTIONS
// ============================================================

// ⚠️ NE PAS déclarer supabase ici !
// Il est déjà déclaré dans supabase-config.js et disponible dans window
// On le récupère directement

if (typeof window.supabase === 'undefined') {
    console.error('❌ Supabase non disponible. Vérifie que supabase-config.js est chargé avant database.js');
}

// ============================================================
// AUTHENTIFICATION
// ============================================================

async function signUp(email, password, userData) {
    const { data, error } = await window.supabase.auth.signUp({
        email: email,
        password: password,
        options: {
            data: userData,
            emailRedirectTo: window.location.origin + '/'
        }
    });
    if (error) throw error;
    return data;
}

async function signIn(email, password) {
    const { data, error } = await window.supabase.auth.signInWithPassword({
        email: email,
        password: password
    });
    if (error) throw error;
    return data;
}

async function signOut() {
    const { error } = await window.supabase.auth.signOut();
    if (error) throw error;
}

async function getCurrentUser() {
    const { data: { user }, error } = await window.supabase.auth.getUser();
    if (error || !user) return null;
    return user;
}

// ============================================================
// PROFIL
// ============================================================

async function getProfile(userId) {
    const { data, error } = await window.supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();  // ← Au lieu de .single()
    
    if (error) throw error;
    return data;
}

async function updateProfile(userId, updates) {
    const { data, error } = await window.supabase
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
    let query = window.supabase
        .from('shops')
        .select('*, products:products(count)');
    
    if (filters.country) query = query.eq('country', filters.country);
    if (filters.search) query = query.ilike('name', `%${filters.search}%`);
    
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
    const { data, error } = await window.supabase
        .from('shops')
        .select('*, products(*)')
        .eq('id', shopId)
        .single();
    if (error) throw error;
    return data;
}

async function createShop(shopData) {
    const { data, error } = await window.supabase
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
    let query = window.supabase
        .from('products')
        .select('*')
        .eq('shop_id', shopId);
    
    if (filters.categoryId) query = query.eq('category_id', filters.categoryId);
    if (filters.search) query = query.ilike('name', `%${filters.search}%`);
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
}

// ============================================================
// COMMANDES
// ============================================================

// Les commandes sont créées par la base : rpc('place_order') (prix recalculés côté serveur,
// une commande par boutique) — voir supabase/migrations/20261017_orders.sql et js/checkout.js.

async function getUserOrders(userId) {
    const { data, error } = await window.supabase
        .from('orders')
        .select('*, items:order_items(*)')
        .eq('client_id', userId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}




// ============================================================
// CALCUL DES VENTES (SOURCE UNIQUE DE VÉRITÉ)
// ============================================================

/**
 * Compte les commandes livrées pour une boutique
 * 1 vente = 1 commande livrée contenant au moins 1 produit de la boutique
 */
async function getShopSalesCount(shopId) {
    const { count, error } = await window.supabase
        .from('order_items')
        .select('order_id, orders!inner(status)', { count: 'exact', head: true })
        .eq('shop_id', shopId)
        .eq('orders.status', 'delivered');
    
    if (error) {
        console.error('Erreur getShopSalesCount:', error);
        return 0;
    }
    
    return count || 0;
}

/**
 * Compte les ventes pour plusieurs boutiques en une seule requête
 */
async function getShopsSalesCount(shopIds) {
    const { data, error } = await window.supabase
        .from('order_items')
        .select('shop_id, order_id, orders!inner(status)')
        .in('shop_id', shopIds)
        .eq('orders.status', 'delivered');
    
    if (error) {
        console.error('Erreur getShopsSalesCount:', error);
        return {};
    }
    
    // Compter les commandes uniques par boutique
    const counts = {};
    const seen = {};
    
    (data || []).forEach(item => {
        const key = `${item.shop_id}-${item.order_id}`;
        if (!seen[key]) {
            seen[key] = true;
            counts[item.shop_id] = (counts[item.shop_id] || 0) + 1;
        }
    });
    
    return counts;
}





// ============================================================
// EXPORTS (TOUTES LES FONCTIONS DANS WINDOW)
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
window.getUserOrders = getUserOrders;
window.getShopSalesCount = getShopSalesCount;
window.getShopsSalesCount = getShopsSalesCount;

console.log('✅ database.js chargé avec succès !');
console.log('   - getProfile:', typeof getProfile);
console.log('   - getShops:', typeof getShops);
console.log('   - getCurrentUser:', typeof getCurrentUser);

// ============================================================
// PROGRAMME MÉDAILLES
// Recopie des règles de la base (supabase/migrations/20261015_medals.sql, medal_for).
// La base fait foi (shop_medals()) ; ceci sert à l'affichage et aux explications.
// ============================================================
window.OuenzeMedals = (function () {
    const TIERS = [
        {
            id: 'standard', name: 'Standard', emoji: '<i class="fas fa-store" style="color:#64748b"></i>', rank: 0, commission: 0.09,
            minRating: 0, minOrders: 0, verified: false,
            perks: ['Fonctionnement normal de la boutique', 'Frais de service payés par tes clients : 9 %']
        },
        {
            id: 'bronze', name: 'Bronze', emoji: '<i class="fas fa-medal" style="color:#b45309"></i>', rank: 1, commission: 0.08,
            minRating: 3.5, minOrders: 10, verified: false,
            perks: ['Badge Bronze visible', 'Frais réduits à 8 % pour tes clients', 'Statistiques de base', 'Peut apparaître dans les sélections Ouenze']
        },
        {
            id: 'silver', name: 'Argent', emoji: '<i class="fas fa-medal" style="color:#94a3b8"></i>', rank: 2, commission: 0.07,
            minRating: 4, minOrders: 50, verified: false,
            perks: ['Tout Bronze', 'Frais réduits à 7 % pour tes clients', 'Meilleure visibilité dans les résultats', 'Statistiques avancées', 'Mises en avant occasionnelles']
        },
        {
            id: 'gold', name: 'Or', emoji: '<i class="fas fa-medal" style="color:#d4a017"></i>', rank: 3, commission: 0.08, vendorShare: 0.02,
            minRating: 4.5, minOrders: 150, verified: true,
            perks: ['Tout Argent', 'Frais clients 8 %, dont 2 % reversés à toi (partagés si plusieurs boutiques Or dans la commande)', 'Priorité dans le classement et la recherche', 'Badge premium très visible', 'Mises en avant gratuites', 'Accès prioritaire aux nouvelles fonctions', 'Support vendeur prioritaire']
        }
    ];
    const byId = Object.fromEntries(TIERS.map(t => [t.id, t]));

    function compute(rating, delivered, verified) {
        const r = Number(rating) || 0, d = Number(delivered) || 0;
        for (let i = TIERS.length - 1; i > 0; i--) {
            const t = TIERS[i];
            if (r >= t.minRating && d >= t.minOrders && (!t.verified || verified)) return t;
        }
        return TIERS[0];
    }

    function next(tier) {
        return TIERS[(byId[tier?.id || tier]?.rank ?? 0) + 1] || null;
    }

    // Partage d'une vente : les frais Ouenze sont payés par le client en plus du prix ;
    // le vendeur reçoit 100 % du prix de ses articles, + 2 % s'il est Or (seul dans la commande)
    function split(amount, tier) {
        const t = byId[tier?.id || tier] || TIERS[0];
        const fee = Math.round(amount * t.commission);
        const share = Math.round(amount * (t.vendorShare || 0));
        return { client: amount + fee, fee, ouenze: fee - share, vendor: amount + share, rate: t.commission };
    }

    function get(id) {
        return byId[id] || TIERS[0];
    }

    return { TIERS, compute, next, split, get };
})();


// ============================================================
// FRAIS DE COMMANDE (migration 20261109) — la base fait foi au moment de commander
//   frais de service = taux de la boutique (médaille : 9, 8, 7 ou 6 %) × total de ses articles
//   livraison = 300 FCFA pour une boutique, 500 FCFA au total pour plusieurs (répartis)
// ============================================================
window.OuenzeFees = (function () {
    const DEFAULT_RATE = 0.09;
    const state = { single: 300, multi: 500, rates: {} };

    // Taux des boutiques du panier et montants de livraison (une requête, en silence si indisponible)
    async function load(shopIds) {
        const ids = [...new Set((shopIds || []).filter(Boolean).map(String))];
        try {
            const { data, error } = await window.supabase.rpc('fee_quote', { shop_ids: ids });
            if (error || !data) return false;
            if (Number.isFinite(Number(data.delivery_single))) state.single = Number(data.delivery_single);
            if (Number.isFinite(Number(data.delivery_multi))) state.multi = Number(data.delivery_multi);
            Object.entries(data.rates || {}).forEach(([k, v]) => { if (Number.isFinite(Number(v))) state.rates[k] = Number(v); });
            return true;
        } catch (e) { return false; }
    }

    function rateOf(shopId) { return state.rates[String(shopId)] ?? DEFAULT_RATE; }

    // items : [{ shopId, price, quantity }]
    function compute(items) {
        const byShop = new Map();
        (items || []).forEach(i => {
            const k = String(i.shopId || 'inconnue');
            byShop.set(k, (byShop.get(k) || 0) + (Number(i.price) || 0) * (Number(i.quantity) || 0));
        });
        const shops = [...byShop.entries()].map(([shopId, subtotal]) => {
            const rate = rateOf(shopId);
            return { shopId, subtotal, rate, service: Math.round(subtotal * rate) };
        });
        const subtotal = shops.reduce((s, x) => s + x.subtotal, 0);
        const service = shops.reduce((s, x) => s + x.service, 0);
        const delivery = !shops.length ? 0 : shops.length === 1 ? state.single : state.multi;
        const rates = [...new Set(shops.map(x => x.rate))];
        return {
            subtotal, service, delivery, total: subtotal + service + delivery, shops: shops.length,
            rateLabel: rates.length === 1 ? `${(rates[0] * 100).toLocaleString('fr-FR')} %` : 'selon la boutique'
        };
    }

    return { load, compute, rateOf, state };
})();
