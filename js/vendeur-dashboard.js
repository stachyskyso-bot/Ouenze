// ============================================================
// VENDOR-DASHBOARD-V2.JS — VERSION SUPABASE
// ============================================================

console.log('🔥 vendor-dashboard-v2.js chargé');

let activeCharts = {};
let vendorCurrentUser = null;
let vendorCurrentProfile = null;
let vendorShops = [];

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

// ============ ACCÈS VENDEUR ============
async function checkVendorAccess() {
    try {
        console.log('🔍 Vérification accès vendeur...');
        
        const { data: { user }, error: userError } = await window.supabase.auth.getUser();
        
        if (userError || !user) {
            console.warn('❌ Pas connecté');
            window.location.href = 'index.html';
            return null;
        }
        
        console.log('👤 User:', user.email, '| ID:', user.id);
        
        const { data: profile, error: profileError } = await window.supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();
        
        if (profileError || !profile) {
            console.warn('❌ Profil introuvable');
            window.location.href = 'index.html';
            return null;
        }
        
        console.log('📋 user_type:', profile.user_type);
        
        if (profile.user_type !== 'vendeur') {
            console.warn('⛔ Pas vendeur');
            window.location.href = 'index.html';
            return null;
        }
        
        vendorCurrentUser = { id: user.id, email: user.email, name: profile.full_name };
        vendorCurrentProfile = profile;
        
        console.log('✅ Vendeur autorisé');
        return { user, profile };
        
    } catch (error) {
        console.error('❌ Erreur:', error);
        window.location.href = 'index.html';
        return null;
    }
}

// ============ CHARGEMENT DES DONNÉES ============
async function loadVendorData() {
    if (!vendorCurrentUser) return;
    
    try {
        console.log('🏪 Chargement des boutiques...');
        
        const { data: shops, error: shopsError } = await window.supabase
            .from('shops')
            .select('*')
            .eq('owner_id', vendorCurrentUser.id)
            .order('created_at', { ascending: false });
        
        if (shopsError) throw shopsError;
        
        vendorShops = shops || [];
        console.log(`✅ ${vendorShops.length} boutique(s) chargée(s)`);
        
        for (const shop of vendorShops) {
            const { data: products } = await window.supabase
                .from('products')
                .select('*')
                .eq('shop_id', shop.id);
            shop.products = products || [];
        }
        
        console.log('✅ Données chargées');
        
    } catch (error) {
        console.error('❌ Erreur:', error);
    }
}

// ============ AFFICHAGE ============
function showDashboard() {
    const container = document.getElementById('appContainer');
    if (!container) return;
    
    const totalProducts = vendorShops.reduce((s, shop) => s + (shop.products?.length || 0), 0);
    
    container.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <h3>Mes boutiques</h3>
                <div class="stat-value">${vendorShops.length}</div>
            </div>
            <div class="stat-card">
                <h3>Produits</h3>
                <div class="stat-value">${totalProducts}</div>
            </div>
            <div class="stat-card">
                <h3>Ventes</h3>
                <div class="stat-value">0</div>
            </div>
            <div class="stat-card">
                <h3>Chiffre d'affaires</h3>
                <div class="stat-value">0 FCFA</div>
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
        
        <h2 style="font-size: 20px; margin-bottom: 20px;">Mes boutiques (${vendorShops.length})</h2>
        
        ${vendorShops.length === 0 ? `
            <div class="stat-card" style="text-align:center; padding:40px;">
                <i class="fas fa-store" style="font-size:48px; color:var(--gray-500); margin-bottom:16px;"></i>
                <p style="font-size:16px; font-weight:600;">Aucune boutique</p>
                <button class="btn-sm btn-primary" onclick="createNewShop()" style="padding:10px 24px; font-size:14px; margin-top:16px;">
                    <i class="fas fa-plus"></i> Créer ma première boutique
                </button>
            </div>
        ` : vendorShops.map(shop => renderShop(shop)).join('')}
    `;
}

function renderShop(shop) {
    const productCount = shop.products?.length || 0;
    const rating = shop.rating || 0;
    const stars = generateStars(rating);
    
    return `
        <div class="shop-card" style="background:var(--card-bg);border-radius:20px;border:1px solid var(--gray-200);margin-bottom:24px;overflow:hidden;">
            <div style="padding:20px;background:var(--gray-100);border-bottom:1px solid var(--gray-200);">
                <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
                    <div style="width:60px;height:60px;background:white;border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;">
                        ${shop.logo_url 
                            ? `<img src="${shop.logo_url}" style="width:100%;height:100%;object-fit:cover;">` 
                            : '<i class="fas fa-store" style="font-size:24px;color:var(--primary);"></i>'
                        }
                    </div>
                    <div style="flex:1;">
                        <h3 style="font-size:18px;margin:0 0 4px;">${escapeHtml(shop.name)}</h3>
                        <div style="font-size:13px;color:var(--warning);">${stars} ${rating}/5</div>
                        <div style="font-size:12px;color:var(--gray-500);margin-top:4px;">
                            <i class="fas fa-map-marker-alt"></i> ${escapeHtml(shop.city || 'Brazzaville')}
                        </div>
                    </div>
                </div>
            </div>
            
            <div style="padding:20px;">
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
                    <div style="background:var(--gray-200);border-radius:12px;padding:16px;text-align:center;">
                        <div style="font-size:24px;font-weight:700;color:var(--primary);">${productCount}</div>
                        <div style="font-size:11px;color:var(--gray-500);margin-top:4px;">Produits</div>
                    </div>
                    <div style="background:var(--gray-200);border-radius:12px;padding:16px;text-align:center;">
                        <div style="font-size:24px;font-weight:700;color:var(--success);">0</div>
                        <div style="font-size:11px;color:var(--gray-500);margin-top:4px;">Ventes</div>
                    </div>
                    <div style="background:var(--gray-200);border-radius:12px;padding:16px;text-align:center;">
                        <div style="font-size:24px;font-weight:700;color:var(--warning);">0</div>
                        <div style="font-size:11px;color:var(--gray-500);margin-top:4px;">CA (FCFA)</div>
                    </div>
                </div>
                
                <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn-sm btn-primary" onclick="openShopDesigner('${shop.id}')">
                        <i class="fas fa-edit"></i> Modifier
                    </button>
                    <button class="btn-sm btn-outline" onclick="viewShop('${shop.id}')">
                        <i class="fas fa-eye"></i> Voir en ligne
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
    console.log('🚀 Init dashboard vendeur...');
    
    const access = await checkVendorAccess();
    if (!access) return;
    
    const avatar = document.getElementById('userAvatar');
    const name = document.getElementById('userName');
    if (avatar) avatar.innerText = vendorCurrentUser.name?.charAt(0).toUpperCase() || 'V';
    if (name) name.innerText = vendorCurrentUser.name || 'Vendeur';
    
    await loadVendorData();
    showDashboard();
    
    console.log('✅ Dashboard prêt');
}

window.addEventListener('beforeunload', () => {
    Object.keys(activeCharts).forEach(k => {
        if (activeCharts[k]) activeCharts[k].destroy();
    });
});

window.createNewShop = createNewShop;
window.openShopDesigner = openShopDesigner;
window.viewShop = viewShop;

init();
