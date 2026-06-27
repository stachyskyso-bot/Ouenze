// ============================================
// DATABASE.JS - COUCHE D'ABSTRACTION
// Toute interaction avec les données passe par ici
// ============================================

// Configuration Supabase (à remplacer par tes valeurs)
const SUPABASE_URL = 'https://mdufmsfnjkeewopzcvei.supabase.co/rest/v1/';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kdWZtc2ZuamtlZXdvcHpjdmVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNTExMzksImV4cCI6MjA5NzYyNzEzOX0.3vD0NrLd6k7ZJNcuCro3NLDHeVQVX3HVG2YdZMy00hw';

// Initialisation du client
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// 1. AUTHENTIFICATION
// ============================================

/**
 * Inscription d'un nouvel utilisateur
 */
// ============================================================
// INSCRIPTION AVEC VÉRIFICATION EMAIL
// ============================================================

async function signUp(email, password, userData) {
    const { data, error } = await supabaseClient.auth.signUp({
        email: email,
        password: password,
        options: {
            data: userData,
            emailRedirectTo: 'https://ouenze.netlify.app/'  // ← Redirection après vérification
        }
    });
    
    if (error) throw error;
    
    // Si la vérification est activée, un email sera envoyé automatiquement
    if (data?.user?.identities?.length === 0) {
        throw new Error('Cet email est déjà utilisé.');
    }
    
    return data;
}
/**
 * Connexion d'un utilisateur
 */
async function signIn(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
    });
    
    if (error) throw error;
    return data;
}

/**
 * Déconnexion
 */
async function signOut() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
}

/**
 * Récupérer l'utilisateur actuellement connecté
 */
async function getCurrentUser() {
    const { data: { user }, error } = await supabaseClient.auth.getUser();
    if (error || !user) return null;
    return user;
}

/**
 * Récupérer le profil d'un utilisateur
 */
async function getProfile(userId) {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
    
    if (error) throw error;
    return data;
}

/**
 * Mettre à jour le profil d'un utilisateur
 */
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

// ============================================
// 2. BOUTIQUES
// ============================================

/**
 * Récupérer toutes les boutiques avec filtres optionnels
 */
async function getShops(filters = {}) {
    let query = supabaseClient
        .from('shops')
        .select('*, products:products(count)');
    
    if (filters.city) query = query.eq('city', filters.city);
    if (filters.minRating) query = query.gte('rating', filters.minRating);
    if (filters.search) query = query.ilike('name', `%${filters.search}%`);
    if (filters.ownerId) query = query.eq('owner_id', filters.ownerId);
    
    const { data, error } = await query;
    if (error) throw error;
    
    // Transformer les données pour correspondre à l'ancien format
    return data.map(shop => ({
        ...shop,
        // products_count: shop.products?.[0]?.count || 0,
        products: [], // À charger séparément si besoin
        rating: shop.rating || 0,
        totalRatings: shop.total_ratings || 0,
        totalSales: shop.total_sales || 0
    }));
}

/**
 * Récupérer une boutique par son ID
 */
async function getShopById(shopId) {
    const { data, error } = await supabaseClient
        .from('shops')
        .select('*, products(*)')
        .eq('id', shopId)
        .single();
    
    if (error) throw error;
    return data;
}

/**
 * Créer une nouvelle boutique
 */
async function createShop(shopData) {
    const { data, error } = await supabaseClient
        .from('shops')
        .insert([{
            owner_id: shopData.owner_id,
            name: shopData.name,
            description: shopData.description || '',
            logo_url: shopData.logo_url || '',
            city: shopData.city || 'Brazzaville',
            district: shopData.district || '',
            address: shopData.address || '',
            has_physical_store: shopData.has_physical_store || false,
            total_shares: shopData.total_shares || 10000
        }])
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

/**
 * Mettre à jour une boutique
 */
async function updateShop(shopId, updates) {
    const { data, error } = await supabaseClient
        .from('shops')
        .update(updates)
        .eq('id', shopId)
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

/**
 * Supprimer une boutique (seulement par le propriétaire)
 */
async function deleteShop(shopId, ownerId) {
    const { error } = await supabaseClient
        .from('shops')
        .delete()
        .eq('id', shopId)
        .eq('owner_id', ownerId);
    
    if (error) throw error;
    return true;
}

// ============================================
// 3. PRODUITS
// ============================================

/**
 * Récupérer les produits d'une boutique
 */
async function getProducts(shopId, filters = {}) {
    let query = supabaseClient
        .from('products')
        .select('*, variants:product_variants(*)')
        .eq('shop_id', shopId);
    
    if (filters.categoryId) query = query.eq('category_id', filters.categoryId);
    if (filters.productType) query = query.eq('product_type', filters.productType);
    if (filters.search) query = query.ilike('name', `%${filters.search}%`);
    if (filters.minPrice) query = query.gte('price', filters.minPrice);
    if (filters.maxPrice) query = query.lte('price', filters.maxPrice);
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
}

/**
 * Récupérer un produit par son ID
 */
async function getProductById(productId) {
    const { data, error } = await supabaseClient
        .from('products')
        .select('*, variants:product_variants(*)')
        .eq('id', productId)
        .single();
    
    if (error) throw error;
    return data;
}

/**
 * Créer un nouveau produit
 */
async function createProduct(productData) {
    // Extraire les variantes (si présentes)
    const variants = productData.variants || [];
    delete productData.variants;
    
    // Créer le produit
    const { data: product, error: productError } = await supabaseClient
        .from('products')
        .insert([{
            shop_id: productData.shop_id,
            category_id: productData.category_id || null,
            name: productData.name,
            description: productData.description || '',
            price: productData.price,
            stock: productData.stock || 0,
            product_type: productData.product_type || 'standard',
            photos: productData.photos || [],
            expiry_date: productData.expiry_date || null,
            weight: productData.weight || '',
            origin: productData.origin || '',
            ingredients: productData.ingredients || ''
        }])
        .select()
        .single();
    
    if (productError) throw productError;
    
    // Ajouter les variantes
    if (variants.length > 0) {
        const variantData = variants.map(v => ({
            product_id: product.id,
            name: v.name,
            color: v.color || '#1e40af',
            price: v.price || productData.price,
            stock: v.stock || 0
        }));
        
        const { error: variantError } = await supabaseClient
            .from('product_variants')
            .insert(variantData);
        
        if (variantError) throw variantError;
    }
    
    return product;
}

/**
 * Mettre à jour un produit
 */
async function updateProduct(productId, updates) {
    const { data, error } = await supabaseClient
        .from('products')
        .update(updates)
        .eq('id', productId)
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

/**
 * Supprimer un produit
 */
async function deleteProduct(productId, shopId) {
    const { error } = await supabaseClient
        .from('products')
        .delete()
        .eq('id', productId)
        .eq('shop_id', shopId);
    
    if (error) throw error;
    return true;
}

// ============================================
// 4. COMMANDES
// ============================================

/**
 * Créer une nouvelle commande avec ses articles
 */
async function createOrder(orderData, items) {
    // 1. Créer la commande
    const { data: order, error: orderError } = await supabaseClient
        .from('orders')
        .insert([{
            client_id: orderData.client_id,
            total: orderData.total,
            delivery_fees: orderData.delivery_fees || 0,
            status: orderData.status || 'confirmed',
            payment_method: orderData.payment_method,
            payment_status: orderData.payment_status || 'pending',
            delivery_info: orderData.delivery_info,
            tracking_step: 1
        }])
        .select()
        .single();
    
    if (orderError) throw orderError;
    
    // 2. Créer les articles de la commande
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
    
    // 3. Ajouter l'historique
    await supabaseClient
        .from('delivery_history')
        .insert([{
            order_id: order.id,
            status: 'confirmed',
            message: 'Commande confirmée'
        }]);
    
    return order;
}

/**
 * Récupérer les commandes d'un utilisateur
 */
async function getUserOrders(userId) {
    const { data, error } = await supabaseClient
        .from('orders')
        .select('*, items:order_items(*)')
        .eq('client_id', userId)
        .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
}

/**
 * Récupérer les commandes d'une boutique (pour vendeur)
 */
async function getShopOrders(shopId) {
    const { data, error } = await supabaseClient
        .from('orders')
        .select('*, items:order_items(*), client:profiles(*)')
        .eq('items.shop_id', shopId)
        .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
}

/**
 * Mettre à jour le statut d'une commande
 */
async function updateOrderStatus(orderId, status, trackingStep) {
    const { data, error } = await supabaseClient
        .from('orders')
        .update({ 
            status: status, 
            tracking_step: trackingStep || null,
            updated_at: new Date().toISOString()
        })
        .eq('id', orderId)
        .select()
        .single();
    
    if (error) throw error;
    
    // Ajouter à l'historique
    await supabaseClient
        .from('delivery_history')
        .insert([{
            order_id: orderId,
            status: status,
            message: `Commande ${status}`
        }]);
    
    return data;
}

/**
 * Récupérer les commandes disponibles pour les livreurs
 */
async function getAvailableDeliveries() {
    const { data, error } = await supabaseClient
        .from('orders')
        .select('*, items:order_items(*), client:profiles(*)')
        .eq('status', 'confirmed')
        .is('deliverer_id', null)
        .order('created_at', { ascending: true });
    
    if (error) throw error;
    return data;
}

// ============================================
// 5. LIVRAISONS
// ============================================

/**
 * Accepter une livraison
 */
async function acceptDelivery(orderId, delivererId, fee) {
    // 1. Mettre à jour la commande
    const { error: orderError } = await supabaseClient
        .from('orders')
        .update({ 
            deliverer_id: delivererId, 
            status: 'accepted',
            updated_at: new Date().toISOString()
        })
        .eq('id', orderId);
    
    if (orderError) throw orderError;
    
    // 2. Créer l'enregistrement de livraison
    const { data, error } = await supabaseClient
        .from('deliveries')
        .insert([{
            order_id: orderId,
            deliverer_id: delivererId,
            fee: fee,
            status: 'accepted'
        }])
        .select()
        .single();
    
    if (error) throw error;
    
    // 3. Ajouter à l'historique
    await supabaseClient
        .from('delivery_history')
        .insert([{
            order_id: orderId,
            status: 'accepted',
            message: `Livreur ${delivererId} a accepté la livraison`
        }]);
    
    return data;
}

/**
 * Mettre à jour le statut d'une livraison
 */
async function updateDeliveryStatus(deliveryId, status, completedAt = null) {
    const updates = { 
        status: status,
        updated_at: new Date().toISOString()
    };
    
    if (status === 'completed' && completedAt) {
        updates.completed_at = completedAt;
    }
    
    const { data, error } = await supabaseClient
        .from('deliveries')
        .update(updates)
        .eq('id', deliveryId)
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

/**
 * Récupérer les livraisons d'un livreur
 */
async function getDelivererDeliveries(delivererId) {
    const { data, error } = await supabaseClient
        .from('deliveries')
        .select('*, order:orders(*)')
        .eq('deliverer_id', delivererId)
        .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
}

// ============================================
// 6. CATÉGORIES
// ============================================

/**
 * Récupérer les catégories d'une boutique
 */
async function getCategories(shopId) {
    const { data, error } = await supabaseClient
        .from('categories')
        .select('*')
        .eq('shop_id', shopId);
    
    if (error) throw error;
    return data;
}

/**
 * Créer une catégorie
 */
async function createCategory(shopId, name) {
    const { data, error } = await supabaseClient
        .from('categories')
        .insert([{ shop_id: shopId, name: name }])
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

// ============================================
// 7. AVIS
// ============================================

/**
 * Ajouter un avis sur une boutique
 */
async function addReview(shopId, userId, rating, comment) {
    const { data, error } = await supabaseClient
        .from('reviews')
        .insert([{
            shop_id: shopId,
            user_id: userId,
            rating: rating,
            comment: comment || ''
        }])
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

/**
 * Récupérer les avis d'une boutique
 */
async function getShopReviews(shopId) {
    const { data, error } = await supabaseClient
        .from('reviews')
        .select('*, user:profiles(full_name)')
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
}

// ============================================
// 8. NOTIFICATIONS
// ============================================

/**
 * Créer une notification
 */
async function createNotification(userId, title, message, type = 'system', data = null) {
    const { error } = await supabaseClient
        .from('notifications')
        .insert([{
            user_id: userId,
            title: title,
            message: message,
            type: type,
            data: data
        }]);
    
    if (error) throw error;
}

/**
 * Récupérer les notifications d'un utilisateur
 */
async function getNotifications(userId, limit = 50) {
    const { data, error } = await supabaseClient
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
    
    if (error) throw error;
    return data;
}

/**
 * Marquer une notification comme lue
 */
async function markNotificationAsRead(notificationId) {
    const { error } = await supabaseClient
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId);
    
    if (error) throw error;
}

// ============================================
// 9. UPLOAD DE FICHIERS
// ============================================

/**
 * Uploader un fichier vers Supabase Storage
 */
async function uploadFile(bucket, path, file) {
    const { data, error } = await supabaseClient.storage
        .from(bucket)
        .upload(path, file);
    
    if (error) throw error;
    
    // Récupérer l'URL publique
    const { data: { publicUrl } } = supabaseClient.storage
        .from(bucket)
        .getPublicUrl(path);
    
    return publicUrl;
}

/**
 * Supprimer un fichier
 */
async function deleteFile(bucket, path) {
    const { error } = await supabaseClient.storage
        .from(bucket)
        .remove([path]);
    
    if (error) throw error;
}

// ============================================
// 10. ÉCOUTE EN TEMPS RÉEL
// ============================================

/**
 * S'abonner aux nouvelles commandes (pour vendeurs)
 */
function subscribeToNewOrders(shopId, callback) {
    return supabaseClient
        .channel(`orders-${shopId}`)
        .on('postgres_changes',
            { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'orders',
                filter: `shop_id=eq.${shopId}`
            },
            (payload) => callback(payload.new)
        )
        .subscribe();
}

/**
 * S'abonner aux mises à jour de livraison (pour livreurs)
 */
function subscribeToDeliveryUpdates(delivererId, callback) {
    return supabaseClient
        .channel(`deliveries-${delivererId}`)
        .on('postgres_changes',
            { 
                event: 'UPDATE', 
                schema: 'public', 
                table: 'deliveries',
                filter: `deliverer_id=eq.${delivererId}`
            },
            (payload) => callback(payload.new)
        )
        .subscribe();
}

/**
 * S'abonner aux nouvelles commandes disponibles (pour livreurs)
 */
function subscribeToAvailableOrders(callback) {
    return supabaseClient
        .channel('available-orders')
        .on('postgres_changes',
            { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'orders',
                filter: `status=eq.confirmed`
            },
            (payload) => callback(payload.new)
        )
        .subscribe();
}

// ============================================
// 11. DEMANDES LIVREURS
// ============================================

/**
 * Soumettre une demande de livreur
 */
async function submitDelivererRequest(requestData) {
    const { data, error } = await supabaseClient
        .from('deliverer_requests')
        .insert([{
            user_id: requestData.user_id || null,
            full_name: requestData.full_name,
            phone: requestData.phone,
            email: requestData.email,
            city: requestData.city,
            district: requestData.district,
            photo_url: requestData.photo_url || '',
            id_card_url: requestData.id_card_url || '',
            transport_photo_url: requestData.transport_photo_url || '',
            vehicle_type: requestData.vehicle_type || '',
            vehicle_plate: requestData.vehicle_plate || ''
        }])
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

/**
 * Récupérer les demandes de livreurs (admin)
 */
async function getDelivererRequests(status = null) {
    let query = supabaseClient
        .from('deliverer_requests')
        .select('*')
        .order('created_at', { ascending: false });
    
    if (status) query = query.eq('status', status);
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
}

/**
 * Mettre à jour le statut d'une demande de livreur
 */
async function updateDelivererRequestStatus(requestId, status) {
    const { data, error } = await supabaseClient
        .from('deliverer_requests')
        .update({ 
            status: status,
            updated_at: new Date().toISOString()
        })
        .eq('id', requestId)
        .select()
        .single();
    
    if (error) throw error;
    return data;
}

// ============================================
// EXPORTS (pour utilisation dans les autres fichiers)
// ============================================

// Authentification
window.supabase = supabaseClient;
window.signUp = signUp;
window.signIn = signIn;
window.signOut = signOut;
window.getCurrentUser = getCurrentUser;
window.getProfile = getProfile;
window.updateProfile = updateProfile;

// Boutiques
window.getShops = getShops;
window.getShopById = getShopById;
window.createShop = createShop;
window.updateShop = updateShop;
window.deleteShop = deleteShop;

// Produits
window.getProducts = getProducts;
window.getProductById = getProductById;
window.createProduct = createProduct;
window.updateProduct = updateProduct;
window.deleteProduct = deleteProduct;

// Catégories
window.getCategories = getCategories;
window.createCategory = createCategory;

// Commandes
window.createOrder = createOrder;
window.getUserOrders = getUserOrders;
window.getShopOrders = getShopOrders;
window.updateOrderStatus = updateOrderStatus;
window.getAvailableDeliveries = getAvailableDeliveries;

// Livraisons
window.acceptDelivery = acceptDelivery;
window.updateDeliveryStatus = updateDeliveryStatus;
window.getDelivererDeliveries = getDelivererDeliveries;

// Avis
window.addReview = addReview;
window.getShopReviews = getShopReviews;

// Notifications
window.createNotification = createNotification;
window.getNotifications = getNotifications;
window.markNotificationAsRead = markNotificationAsRead;

// Upload
window.uploadFile = uploadFile;
window.deleteFile = deleteFile;

// Realtime
window.subscribeToNewOrders = subscribeToNewOrders;
window.subscribeToDeliveryUpdates = subscribeToDeliveryUpdates;
window.subscribeToAvailableOrders = subscribeToAvailableOrders;

// Demandes livreurs
window.submitDelivererRequest = submitDelivererRequest;
window.getDelivererRequests = getDelivererRequests;
window.updateDelivererRequestStatus = updateDelivererRequestStatus;
