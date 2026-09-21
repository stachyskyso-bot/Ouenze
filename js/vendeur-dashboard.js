// ============================================================
// VENDOR-DASHBOARD.JS — VERSION RPC COMPLÈTE
// ============================================================

console.log('🔥 vendor-dashboard.js chargé');

let dashUser = null;
let dashShops = [];

// ============ UTILITAIRES ============
function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"]/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
    }[m]));
}

function formatNumber(v) {
    return Number(v || 0).toLocaleString();
}

function generateStars(rating) {
    let stars = '';
    for (let i = 0; i < Math.floor(rating); i++) stars += '<i class="fas fa-star"></i>';
    if (rating % 1 >= 0.5) stars += '<i class="fas fa-star-half-alt"></i>';
    for (let i = 0; i < 5 - Math.ceil(rating); i++) stars += '<i class="far fa-star"></i>';
    return stars;
}

// ============ CHARGEMENT VIA RPC ============
async function loadVendorData() {
    console.log('🚀 Chargement via RPC...');
    
    try {
        const { data, error } = await window.supabase.rpc('get_vendor_dashboard');
        
        if (error) {
            console.error('❌ Erreur RPC:', error);
            return false;
        }
        
        if (!data || !data.success) {
            console.error('❌ RPC sans succès');
            return false;
        }
        
        console.log('✅ Données reçues');
        console.log('👤 User:', data.user?.email);
        console.log('🏪 Boutiques:', data.shops?.length);
        
        if (data.user?.user_type !== 'vendeur') {
            console.warn('⛔ Pas vendeur');
            window.location.href = 'index.html';
            return false;
        }
        
        dashUser = data.user;
        dashShops = data.shops || [];
        
        return true;
        
    } catch (error) {
        console.error('❌ Exception:', error);
        return false;
    }
}

// ============ AFFICHAGE DASHBOARD ============
function showDashboard() {
    const container = document.getElementById('appContainer');
    if (!container) return;
    
    // Totaux globaux
    const totalProducts = dashShops.reduce((s, shop) => s + (shop.product_count || 0), 0);
    const totalSales = dashShops.reduce((s, shop) => s + (shop.real_sales_count || 0), 0);
    const totalRevenue = dashShops.reduce((s, shop) => s + Number(shop.real_revenue || 0), 0);
    const totalPending = dashShops.reduce((s, shop) => s + (shop.pending_orders || 0), 0);
    
    container.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <h3>Mes boutiques</h3>
                <div class="stat-value">${dashShops.length}</div>
            </div>
            <div class="stat-card">
                <h3>Produits</h3>
                <div class="stat-value">${totalProducts}</div>
            </div>
            <div class="stat-card">
                <h3>Ventes</h3>
                <div class="stat-value">${totalSales}</div>
            </div>
            <div class="stat-card">
                <h3>Chiffre d'affaires</h3>
                <div class="stat-value">${formatNumber(totalRevenue)} FCFA</div>
            </div>
            <div class="stat-card">
                <h3>En attente</h3>
                <div class="stat-value">${totalPending}</div>
            </div>
        </div>
        
        <div style="display:flex; gap:12px; margin-bottom:24px; flex-wrap:wrap;">
            <button class="btn-sm btn-primary" onclick="createNewShop()">
                <i class="fas fa-plus"></i> Créer une boutique
            </button>
            <button class="btn-sm btn-success" onclick="window.location.href='accounting.html'">
                <i class="fas fa-calculator"></i> Comptabilité
            </button>
        </div>
        
        <h2 style="font-size:20px; margin-bottom:20px;">Mes boutiques (${dashShops.length})</h2>
        
        ${dashShops.length === 0 ? `
            <div class="stat-card" style="text-align:center; padding:40px;">
                <i class="fas fa-store" style="font-size:48px; color:var(--gray-500); margin-bottom:16px;"></i>
                <p style="font-size:16px; font-weight:600;">Aucune boutique</p>
                <button class="btn-sm btn-primary" onclick="createNewShop()" style="padding:10px 24px; font-size:14px; margin-top:16px;">
                    <i class="fas fa-plus"></i> Créer ma première boutique
                </button>
            </div>
        ` : dashShops.map(shop => renderShop(shop)).join('')}
    `;
}

// ============ RENDU D'UNE BOUTIQUE ============
function renderShop(shop) {
    const productCount = shop.product_count || 0;
    const rating = shop.rating || 0;
    const stars = generateStars(rating);
    const design = shop.design || {};
    
    const primaryColor = design.primary_color || '#1e40af';
    const bgColor = design.background_color || '#ffffff';
    const buttonColor = design.button_color || '#1e40af';
    const layout = design.layout || 'grid';
    const showSearch = shop.show_search_bar || false;
    
    // Vraies stats
    const realSales = shop.real_sales_count || 0;
    const realRevenue = Number(shop.real_revenue || 0);
    const totalOrders = shop.total_orders || 0;
    const pendingOrders = shop.pending_orders || 0;
    
    return `
        <div class="shop-card" style="background:var(--card-bg);border-radius:20px;border:1px solid var(--gray-200);margin-bottom:24px;overflow:hidden;">
            
            <!-- HEADER BOUTIQUE -->
            <div style="padding:20px;background:${bgColor};border-bottom:1px solid var(--gray-200);">
                <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
                    <div style="width:60px;height:60px;background:white;border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid var(--gray-200);">
                        ${shop.logo_url 
                            ? `<img src="${shop.logo_url}" style="width:100%;height:100%;object-fit:cover;">` 
                            : '<i class="fas fa-store" style="font-size:24px;color:' + primaryColor + ';"></i>'
                        }
                    </div>
                    <div style="flex:1;">
                        <h3 style="font-size:18px;margin:0 0 4px;">${escapeHtml(shop.name)}</h3>
                        <div style="font-size:13px;color:var(--warning);">${stars} ${rating}/5 (${shop.total_ratings || 0} avis)</div>
                        <div style="font-size:12px;color:var(--gray-500);margin-top:4px;">
                            <i class="fas fa-map-marker-alt"></i> ${escapeHtml(shop.city || 'Brazzaville')}
                            ${shop.district ? `, ${escapeHtml(shop.district)}` : ''}
                        </div>
                        <div style="font-size:11px;margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
                            ${shop.is_verified ? '<span style="background:#d1fae5;color:#059669;padding:2px 8px;border-radius:20px;">✓ Vérifiée</span>' : ''}
                            ${shop.has_physical_store ? '<span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:20px;">🏢 Boutique physique</span>' : ''}
                            ${showSearch ? '<span style="background:#e0e7ff;color:#4338ca;padding:2px 8px;border-radius:20px;">🔍 Recherche activée</span>' : ''}
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- MÉTRIQUES -->
            <div style="padding:20px;">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;">
                    <div style="background:var(--gray-200);border-radius:12px;padding:16px;text-align:center;">
                        <div style="font-size:24px;font-weight:700;color:${primaryColor};">${productCount}</div>
                        <div style="font-size:11px;color:var(--gray-500);margin-top:4px;">Produits</div>
                    </div>
                    <div style="background:var(--gray-200);border-radius:12px;padding:16px;text-align:center;">
                        <div style="font-size:24px;font-weight:700;color:var(--success);">${realSales}</div>
                        <div style="font-size:11px;color:var(--gray-500);margin-top:4px;">Ventes livrées</div>
                    </div>
                    <div style="background:var(--gray-200);border-radius:12px;padding:16px;text-align:center;">
                        <div style="font-size:24px;font-weight:700;color:var(--warning);">${formatNumber(realRevenue)}</div>
                        <div style="font-size:11px;color:var(--gray-500);margin-top:4px;">CA (FCFA)</div>
                    </div>
                    <div style="background:var(--gray-200);border-radius:12px;padding:16px;text-align:center;">
                        <div style="font-size:24px;font-weight:700;color:var(--primary);">${totalOrders}</div>
                        <div style="font-size:11px;color:var(--gray-500);margin-top:4px;">Commandes</div>
                    </div>
                    <div style="background:var(--gray-200);border-radius:12px;padding:16px;text-align:center;">
                        <div style="font-size:24px;font-weight:700;color:${pendingOrders > 0 ? 'var(--danger)' : 'var(--gray-500)'};">${pendingOrders}</div>
                        <div style="font-size:11px;color:var(--gray-500);margin-top:4px;">En attente</div>
                    </div>
                </div>
                
                <!-- INFOS DESIGN -->
                <div style="margin-top:16px;background:var(--gray-100);border-radius:12px;padding:12px;font-size:12px;color:var(--gray-700);">
                    <strong><i class="fas fa-palette"></i> Design actuel :</strong>
                    Menu: ${design.menu_position || 'horizontal'} | 
                    Layout: ${layout} | 
                    Couleur: <span style="display:inline-block;width:12px;height:12px;background:${primaryColor};border-radius:2px;vertical-align:middle;"></span> ${primaryColor}
                </div>
                
                <!-- PRODUITS RÉCENTS -->
                ${shop.products && shop.products.length > 0 ? `
                    <h4 style="font-size:14px;margin:16px 0 8px;">Produits récents</h4>
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        ${shop.products.slice(0, 3).map(p => `
                            <div style="display:flex;align-items:center;gap:12px;background:var(--gray-100);border-radius:8px;padding:8px;">
                                <div style="width:40px;height:40px;background:white;border-radius:6px;overflow:hidden;flex-shrink:0;">
                                    ${p.photos && p.photos[0] 
                                        ? `<img src="${p.photos[0]}" style="width:100%;height:100%;object-fit:cover;">` 
                                        : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#94a3b8;">📦</div>'}
                                </div>
                                <div style="flex:1;">
                                    <div style="font-weight:600;font-size:13px;">${escapeHtml(p.name)}</div>
                                    <div style="font-size:11px;color:var(--gray-500);">Stock: ${p.stock || 0}</div>
                                </div>
                                <div style="font-weight:700;color:${primaryColor};font-size:13px;">${formatNumber(p.price)} FCFA</div>
                            </div>
                        `).join('')}
                    </div>
                ` : '<p style="font-size:12px;color:var(--gray-500);margin-top:16px;">Aucun produit</p>'}
                
                <!-- ACTIONS -->
                <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn-sm btn-primary" onclick="openShopDesigner('${shop.id}')">
                        <i class="fas fa-edit"></i> Modifier le design
                    </button>
                    <button class="btn-sm btn-outline" onclick="viewShop('${shop.id}')">
                        <i class="fas fa-eye"></i> Voir en ligne
                    </button>
                    <button class="btn-sm btn-success" onclick="window.location.href='accounting.html'">
                        <i class="fas fa-calculator"></i> Comptabilité
                    </button>
                </div>
            </div>
        </div>
    `;
}

// ============ ACTIONS ============
function createNewShop() {
    window.location.href = 'shop-designer.html';
}

function openShopDesigner(shopId) {
    window.open(`shop-designer.html?edit=${shopId}`, '_blank');
}

function viewShop(shopId) {
    window.open(`index.html?shop=${shopId}`, '_blank');
}

// ============ INITIALISATION ============
async function init() {
    console.log('🚀 Init dashboard vendeur (RPC)...');
    
    const ok = await loadVendorData();
    if (!ok) return;
    
    const avatar = document.getElementById('userAvatar');
    const name = document.getElementById('userName');
    if (avatar) avatar.innerText = dashUser.full_name?.charAt(0).toUpperCase() || 'V';
    if (name) name.innerText = dashUser.full_name || 'Vendeur';
    
    showDashboard();
    
    console.log('✅ Dashboard prêt');
}

window.createNewShop = createNewShop;
window.openShopDesigner = openShopDesigner;
window.viewShop = viewShop;

init();
