// ============================================================
// VD.JS — Tableau de bord vendeur Ouenze (JCVD, 02/10/2026)
//
// Source de données unique : RPC Supabase get_vendor_dashboard()
//   → { success, user:{...}, shops:[{..., design:{...}, products:[...]}] }
// Dépendances (dans vendor-dashboard.html, dans cet ordre) :
//   supabase-js v2 → js/supabase-config.js → js/database.js → js/vd.js
// ============================================================
 
(function () {
    'use strict';
 
    if (window.__VD_LOADED__) return;
    window.__VD_LOADED__ = true;
 
    // ============ ÉTAT ============
    let dashUser = null;
    let dashShops = [];
 
    // ============ UTILITAIRES ============
    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[m]));
    }
 
    // Images : http(s) ou data:image (logos/photos stockés en base64 par le shop-designer)
    function safeUrl(url) {
        const u = String(url || '');
        return /^(https?:\/\/|data:image\/)/i.test(u) ? escapeHtml(u) : '';
    }
 
    // Couleurs : uniquement #hex, sinon valeur par défaut (évite l'injection CSS)
    function safeColor(c, fallback) {
        return /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : fallback;
    }
 
    // Nombres de design : bornés
    function safeNum(n, fallback, min, max) {
        const v = Number(n);
        if (!Number.isFinite(v)) return fallback;
        return Math.min(max, Math.max(min, v));
    }
 
    function formatNumber(v) {
        return Number(v || 0).toLocaleString('fr-FR');
    }
 
    function generateStars(rating) {
        const r = Math.max(0, Math.min(5, Number(rating) || 0));
        const full = Math.floor(r);
        const half = r - full >= 0.5;
        let s = '';
        for (let i = 0; i < full; i++) s += '<i class="fas fa-star"></i>';
        if (half) s += '<i class="fas fa-star-half-alt"></i>';
        for (let i = full + (half ? 1 : 0); i < 5; i++) s += '<i class="far fa-star"></i>';
        return s;
    }
 
    function readDesign(shop) {
        const d = shop.design || {};
        return {
            primary: safeColor(d.primary_color, '#1e40af'),
            button: safeColor(d.button_color, '#1e40af'),
            bg: safeColor(d.background_color, '#ffffff'),
            headerText: safeColor(d.header_text_color, '#ffffff'),
            productText: safeColor(d.product_text_color, '#1e293b'),
            menuBg: safeColor(d.menu_bg, '#1e40af'),
            menuText: safeColor(d.menu_text, '#ffffff'),
            menuRadius: safeNum(d.menu_radius, 0, 0, 30),
            menuPosition: ['horizontal', 'vertical-left', 'vertical-right'].includes(d.menu_position)
                ? d.menu_position : 'horizontal',
            layout: d.layout === 'list' ? 'list' : 'grid',
            prodWidth: safeNum(d.prod_width, 200, 140, 300),
            prodImgHeight: safeNum(d.prod_img_height, 160, 100, 250),
            prodRadius: safeNum(d.prod_radius, 12, 0, 32),
            prodGap: safeNum(d.prod_gap, 16, 8, 40),
            showSearch: !!shop.show_search_bar
        };
    }
 
    function setMessage(html) {
        const container = document.getElementById('appContainer');
        if (container) {
            container.innerHTML = `<div class="stat-card" style="text-align:center;padding:40px;">${html}</div>`;
        }
    }
 
    // ============ CHARGEMENT ============
    async function loadVendorData() {
        if (!window.supabase || !window.supabase.auth) {
            setMessage('<p>Connexion au serveur impossible (configuration Supabase introuvable).</p>');
            return false;
        }
 
        // 1. Session : sans connexion, retour à l'accueil
        const { data: sessionData } = await window.supabase.auth.getSession();
        if (!sessionData?.session) {
            window.location.href = 'index.html';
            return false;
        }
 
        // 2. Données via la RPC
        const { data, error } = await window.supabase.rpc('get_vendor_dashboard');
 
        if (error || !data || !data.success) {
            console.error('❌ get_vendor_dashboard:', error || data);
            setMessage(`
                <i class="fas fa-exclamation-circle" style="font-size:40px;color:var(--danger,#ef4444);margin-bottom:12px;"></i>
                <p style="font-weight:600;">Impossible de charger votre tableau de bord.</p>
                <p style="font-size:13px;color:var(--gray-500,#64748b);">${escapeHtml(error?.message || data?.error || 'Réponse inattendue du serveur')}</p>
                <button class="btn-sm btn-primary" onclick="location.reload()" style="margin-top:16px;">Réessayer</button>`);
            return false;
        }
 
        if (data.user?.user_type !== 'vendeur') {
            window.location.href = 'index.html';
            return false;
        }
 
        dashUser = data.user;
        dashShops = Array.isArray(data.shops) ? data.shops : [];
        console.log(`✅ vd.js : ${dashUser.email} — ${dashShops.length} boutique(s)`);
        return true;
    }
 
    // ============ TABLEAU DE BORD ============
    function showDashboard() {
        const container = document.getElementById('appContainer');
        if (!container) return;
 
        const sum = key => dashShops.reduce((s, shop) => s + Number(shop[key] || 0), 0);
 
        container.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card"><h3>Mes boutiques</h3><div class="stat-value">${dashShops.length}</div></div>
                <div class="stat-card"><h3>Produits</h3><div class="stat-value">${sum('product_count')}</div></div>
                <div class="stat-card"><h3>Ventes livrées</h3><div class="stat-value">${sum('real_sales_count')}</div></div>
                <div class="stat-card"><h3>Chiffre d'affaires</h3><div class="stat-value">${formatNumber(sum('real_revenue'))} FCFA</div></div>
                <div class="stat-card"><h3>En attente</h3><div class="stat-value">${sum('pending_orders')}</div></div>
            </div>
 
            <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap;">
                <button class="btn-sm btn-primary" onclick="createNewShop()"><i class="fas fa-plus"></i> Créer une boutique</button>
                <button class="btn-sm btn-success" onclick="window.location.href='accounting.html'"><i class="fas fa-calculator"></i> Comptabilité</button>
            </div>
 
            <h2 style="font-size:20px;margin-bottom:20px;">Mes boutiques (${dashShops.length})</h2>
 
            ${dashShops.length === 0 ? `
                <div class="stat-card" style="text-align:center;padding:40px;">
                    <i class="fas fa-store" style="font-size:48px;color:var(--gray-500);margin-bottom:16px;"></i>
                    <p style="font-weight:600;">Aucune boutique pour l'instant</p>
                    <button class="btn-sm btn-primary" onclick="createNewShop()" style="padding:10px 24px;margin-top:16px;">
                        <i class="fas fa-plus"></i> Créer ma première boutique
                    </button>
                </div>` : dashShops.map(renderShop).join('')}`;
    }
 
    // ============ UNE BOUTIQUE : stats + aperçu avec son design ============
    function renderShop(shop) {
        const d = readDesign(shop);
        const id = escapeHtml(shop.id);
        const logo = safeUrl(shop.logo_url);
        const pending = Number(shop.pending_orders || 0);
        const products = Array.isArray(shop.products) ? shop.products : [];
 
        const metric = (value, label, color) => `
            <div style="background:var(--gray-100,#f1f5f9);border-radius:12px;padding:14px;text-align:center;">
                <div style="font-size:22px;font-weight:700;color:${color};">${value}</div>
                <div style="font-size:11px;color:var(--gray-500,#64748b);margin-top:4px;">${label}</div>
            </div>`;
 
        return `
        <div class="shop-card" style="background:var(--card-bg,#fff);border-radius:20px;border:1px solid var(--gray-200,#e2e8f0);margin-bottom:24px;overflow:hidden;">
 
            <div style="padding:20px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
                    <div>
                        <h3 style="font-size:18px;margin:0 0 4px;">${escapeHtml(shop.name)}</h3>
                        <div style="font-size:13px;color:var(--warning,#f59e0b);">${generateStars(shop.rating)}
                            <span style="color:var(--gray-500,#64748b);">${Number(shop.rating || 0)}/5 (${shop.total_ratings || 0} avis)</span>
                        </div>
                        <div style="font-size:12px;color:var(--gray-500,#64748b);margin-top:4px;">
                            <i class="fas fa-map-marker-alt"></i> ${escapeHtml(shop.city || 'Brazzaville')}${shop.district ? ', ' + escapeHtml(shop.district) : ''}
                        </div>
                    </div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:11px;">
                        ${shop.is_verified ? '<span style="background:#d1fae5;color:#059669;padding:2px 8px;border-radius:20px;">✓ Vérifiée</span>' : ''}
                        ${shop.is_active === false ? '<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:20px;">Désactivée</span>' : ''}
                    </div>
                </div>
 
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:12px;margin-top:16px;">
                    ${metric(Number(shop.product_count || 0), 'Produits', d.primary)}
                    ${metric(Number(shop.real_sales_count || 0), 'Ventes livrées', 'var(--success,#10b981)')}
                    ${metric(formatNumber(shop.real_revenue), 'CA (FCFA)', 'var(--warning,#f59e0b)')}
                    ${metric(Number(shop.total_orders || 0), 'Commandes', 'var(--primary,#1e40af)')}
                    ${metric(pending, 'En attente', pending > 0 ? 'var(--danger,#ef4444)' : 'var(--gray-500,#64748b)')}
                </div>
            </div>
 
            <!-- APERÇU : la boutique telle que les clients la voient -->
            <div style="padding:0 20px 20px;">
                <div style="font-size:12px;font-weight:600;color:var(--gray-500,#64748b);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em;">
                    <i class="fas fa-palette"></i> Aperçu de votre boutique
                </div>
                ${renderStorefront(shop, d, logo, products)}
            </div>
 
            <div style="padding:0 20px 20px;display:flex;gap:8px;flex-wrap:wrap;">
                <button onclick="openShopDesigner('${id}')"
                        style="background:${d.button};color:#fff;border:none;padding:8px 16px;border-radius:30px;cursor:pointer;font-size:12px;">
                    <i class="fas fa-edit"></i> Modifier la boutique
                </button>
                <button class="btn-sm btn-outline" onclick="viewShop('${id}')">
                    <i class="fas fa-eye"></i> Voir en ligne
                </button>
            </div>
        </div>`;
    }
 
    // Même rendu que l'aperçu du shop-designer, à partir du design enregistré
    function renderStorefront(shop, d, logo, products) {
        const productsStyle = d.layout === 'grid'
            ? `display:grid;grid-template-columns:repeat(auto-fill,minmax(${Math.min(d.prodWidth, 180)}px,1fr));gap:${d.prodGap}px;`
            : `display:flex;flex-direction:column;gap:${d.prodGap}px;`;
 
        const categories = Array.isArray(shop.categories) ? shop.categories : [];
        const menu = categories.length ? `
            <div style="background:${d.menuBg};color:${d.menuText};border-radius:${d.menuRadius}px;padding:10px 16px;display:flex;gap:16px;flex-wrap:wrap;margin:12px 16px 0;">
                ${categories.map(c => `<span style="font-size:13px;">${escapeHtml(c.name || c)}</span>`).join('')}
            </div>` : '';
 
        return `
        <div style="background:${d.bg};border-radius:12px;overflow:hidden;border:1px solid var(--gray-200,#e2e8f0);">
            <div style="background:linear-gradient(135deg,${d.primary},${d.primary}aa);padding:16px 20px;color:${d.headerText};">
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:52px;height:52px;flex-shrink:0;background:#fff;border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;">
                        ${logo ? `<img src="${logo}" alt="" style="width:100%;height:100%;object-fit:contain;">`
                               : `<i class="fas fa-store" style="font-size:22px;color:${d.primary};"></i>`}
                    </div>
                    <div style="min-width:0;">
                        <div style="font-size:16px;font-weight:700;">${escapeHtml(shop.name)}</div>
                        ${shop.description ? `<div style="font-size:11px;opacity:.9;margin-top:2px;">${escapeHtml(shop.description)}</div>` : ''}
                    </div>
                </div>
            </div>
 
            ${d.showSearch ? `
                <div style="padding:12px 16px;border-bottom:1px solid #e2e8f0;">
                    <div style="display:flex;background:#f1f5f9;border-radius:20px;padding:8px 14px;align-items:center;gap:8px;">
                        <input type="text" placeholder="Rechercher un produit..." disabled
                               style="flex:1;border:none;background:transparent;outline:none;font-size:13px;">
                        <i class="fas fa-search" style="color:${d.primary};"></i>
                    </div>
                </div>` : ''}
 
            ${menu}
 
            <div style="padding:16px;">
                ${products.length ? `
                    <div style="${productsStyle}">
                        ${products.slice(0, 6).map(p => {
                            const photo = safeUrl(Array.isArray(p.photos) ? p.photos[0] : '');
                            const list = d.layout === 'list';
                            return `
                            <div style="background:#fff;border-radius:${d.prodRadius}px;border:1px solid #e2e8f0;overflow:hidden;${list ? 'display:flex;gap:12px;' : ''}">
                                <div style="${list ? 'width:80px;height:80px;' : `height:${Math.min(d.prodImgHeight, 140)}px;`}flex-shrink:0;background:#f1f5f9;display:flex;align-items:center;justify-content:center;">
                                    ${photo ? `<img src="${photo}" alt="" style="width:100%;height:100%;object-fit:cover;">`
                                            : '<i class="fas fa-image" style="font-size:24px;color:#cbd5e1;"></i>'}
                                </div>
                                <div style="padding:10px;flex:1;min-width:0;">
                                    <div style="font-weight:600;font-size:13px;color:${d.productText};">${escapeHtml(p.name)}</div>
                                    <div style="font-weight:700;font-size:13px;color:${d.primary};">${formatNumber(p.price)} FCFA</div>
                                    <div style="font-size:11px;color:#64748b;">Stock : ${Number(p.stock || 0)}</div>
                                </div>
                            </div>`;
                        }).join('')}
                    </div>
                    ${products.length > 6 ? `<div style="font-size:12px;color:#64748b;margin-top:8px;">+ ${products.length - 6} autre(s) produit(s)</div>` : ''}
                ` : '<p style="font-size:12px;color:#64748b;text-align:center;padding:20px;">Aucun produit</p>'}
            </div>
        </div>`;
    }
 
    // ============ ACTIONS ============
    function createNewShop() {
        window.location.href = 'shop-designer.html';
    }
 
    function openShopDesigner(shopId) {
        window.location.href = 'shop-designer.html?edit=' + encodeURIComponent(shopId);
    }
 
    function viewShop(shopId) {
        window.open('index.html?shop=' + encodeURIComponent(shopId), '_blank');
    }
 
    // ============ DÉMARRAGE ============
    async function init() {
        try {
            const ok = await loadVendorData();
            if (!ok) return;
 
            const name = dashUser.full_name || 'Vendeur';
            const avatar = document.getElementById('userAvatar');
            const nameEl = document.getElementById('userName');
            if (avatar) avatar.textContent = name.charAt(0).toUpperCase();
            if (nameEl) nameEl.textContent = name;
 
            showDashboard();
        } catch (e) {
            console.error('❌ vd.js:', e);
            setMessage('<p>Une erreur inattendue est survenue.</p><button class="btn-sm btn-primary" onclick="location.reload()">Réessayer</button>');
        }
    }
 
    Object.assign(window, { createNewShop, openShopDesigner, viewShop });
 
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
 
