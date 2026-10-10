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
    let pendingTransfers = {};   // shop_id → transfert en attente
 
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
        dashShops = (Array.isArray(data.shops) ? data.shops : []).filter(s => !s.archived_at && s.is_active !== false);
        pendingTransfers = {};
        try {
            const { data: transfers, error: tError } = await window.supabase
                .from('shop_transfers').select('id, shop_id, to_email, price, expires_at, channels')
                .eq('status', 'pending');
            if (!tError) (transfers || []).forEach(t => { pendingTransfers[t.shop_id] = t; });
        } catch (e) {
            // Table absente tant que la migration du 12/10 n'est pas exécutée
        }
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
 
        const transfer = pendingTransfers[shop.id];
        return `
        <div class="shop-card" style="background:var(--card-bg,#fff);border-radius:20px;border:1px solid var(--gray-200,#e2e8f0);margin-bottom:24px;overflow:hidden;">
            ${transfer ? `
                <div class="transfer-banner">
                    <i class="fas fa-exchange-alt"></i>
                    <span>Transfert en attente vers <strong>${escapeHtml(transfer.to_email)}</strong>${transfer.price !== null ? ` (${formatNumber(transfer.price)} FCFA)` : ''} — valable jusqu'au ${new Date(transfer.expires_at).toLocaleString('fr-FR')}</span>
                    <button onclick="cancelTransfer('${escapeHtml(transfer.id)}')">Annuler</button>
                </div>` : ''}
 
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
                <button class="btn-sm btn-share" onclick="openShareShop('${id}')">
                    <i class="fas fa-share-alt"></i> Partager ma boutique
                </button>
                <button class="btn-sm btn-market" onclick="openListing('${id}')">
                    <i class="fas fa-chart-line"></i> Entrer en bourse
                </button>
                <button class="btn-sm btn-manage" onclick="openManageShop('${id}')">
                    <i class="fas fa-cog"></i> Gérer
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
 
    // ============ GÉRER : TRANSFÉRER / FERMER ============
    // Téléphone : +242 0X XXX XX XX (Congo-Brazzaville) ou +243 XX XXX XXXX (RDC)
    function normalizePhone(input, cc) {
        let d = String(input || '').replace(/[\s.\-()]/g, '');
        const dial = cc === 'CD' ? '243' : '242';
        if (d.startsWith('+' + dial)) d = d.slice(4);
        else if (d.startsWith('00' + dial)) d = d.slice(5);
        else if (d.startsWith(dial) && d.length === 12) d = d.slice(3);
        if (cc === 'CG') return /^0[456]\d{7}$/.test(d) ? `+242 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7)}` : null;
        if (d.length === 10 && d.startsWith('0')) d = d.slice(1);
        return /^[89]\d{8}$/.test(d) ? `+243 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}` : null;
    }
 
    function openSheet(html) {
        document.getElementById('shareOverlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'shareOverlay';
        overlay.className = 'share-overlay';
        overlay.innerHTML = `<div class="share-sheet" role="dialog"><button class="share-close" onclick="closeShareShop()" aria-label="Fermer">&times;</button>${html}</div>`;
        overlay.addEventListener('click', e => { if (e.target === overlay) closeShareShop(); });
        document.body.appendChild(overlay);
        return overlay;
    }
 
    function sheetError(msg) {
        const el = document.getElementById('sheetError');
        if (el) { el.textContent = msg || ''; el.style.display = msg ? 'block' : 'none'; }
        return false;
    }
 
    async function invokeTransfer(body) {
        const { data, error } = await window.supabase.functions.invoke('shop-transfer', { body });
        if (!error) return { data };
        let message = 'Service de transfert indisponible pour le moment.';
        try { message = (await error.context.json()).error || message; } catch (e) { /* réponse non JSON */ }
        return { error: message };
    }
 
    // ============ ENTRÉE EN BOURSE ============
    // Conditions et calculs vérifiés par la base (request_listing) ; ici on les explique.
    const SHARES_PER_COMPANY = 10000;

    function progressRow(label, value, target, display) {
        const ratio = Math.max(0, Math.min(1, value / target));
        return `<div class="listing-req ${value >= target ? 'ok' : ''}">
            <div><span>${label}</span><strong>${display} / ${target.toLocaleString('fr-FR')}</strong></div>
            <div class="listing-bar"><div style="width:${ratio * 100}%"></div></div></div>`;
    }

    async function openListing(shopId) {
        const shop = dashShops.find(s => String(s.id) === String(shopId));
        if (!shop) return;
        openSheet('<h3>Entrer en bourse</h3><p class="share-sub">Vérification de ta boutique…</p>');
        const { data, error } = await window.supabase.rpc('listing_eligibility', { target_shop: shop.id });
        const e = Array.isArray(data) ? data[0] : data;
        if (error || !e) {
            openSheet(`<h3>Entrer en bourse</h3><p class="share-sub">${/function|does not exist|Could not find/i.test(error?.message || '')
                ? 'La bourse n\'est pas encore activée sur Ouenze. Réessaie bientôt.' : 'Vérification impossible pour le moment. Réessaie plus tard.'}</p>`);
            return;
        }
        const name = escapeHtml(shop.name);
        if (e.active_status === 'pending') {
            openSheet(`<h3>« ${name} » en vérification</h3>
                <p class="share-sub">Ta demande d'entrée en bourse est en cours. L'équipe Ouenze va te contacter pour vérifier ta boutique sur place.</p>
                <a class="share-native" href="activities.html"><i class="fas fa-history"></i> Suivre dans Mes activités</a>`);
            return;
        }
        if (e.active_status === 'open') {
            openSheet(`<h3>« ${name} » est en bourse</h3>
                <p class="share-sub">Les investisseurs peuvent réserver tes parts.</p>
                <a class="share-native" href="invest.html"><i class="fas fa-chart-line"></i> Voir sur le marché</a>`);
            return;
        }
        const rating = Number(e.rating) || 0;
        const orders = Number(e.delivered_orders) || 0;
        if (!e.eligible) {
            openSheet(`<h3>Entrer en bourse</h3>
                <p class="share-sub">Vends des parts de « ${name} » à des investisseurs pour financer ta croissance. Il faut d'abord :</p>
                ${progressRow('Note des clients', rating, 3.5, rating.toLocaleString('fr-FR', { maximumFractionDigits: 1 }))}
                ${progressRow('Commandes livrées', orders, 75, orders.toLocaleString('fr-FR'))}
                <p class="sheet-warning"><i class="fas fa-lightbulb"></i> Chaque commande livrée et chaque bon avis te rapprochent du but. Ensuite, l'équipe Ouenze vérifie ta boutique sur place.</p>`);
            return;
        }
        openSheet(`<h3>Entrer en bourse</h3>
            <p class="share-sub">« ${name} » remplit les conditions (${rating.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ★, ${orders} commandes livrées). Ta boutique compte ${SHARES_PER_COMPANY.toLocaleString('fr-FR')} parts : choisis combien tu en vends.</p>
            <label class="sheet-label" for="lsPercent">Part du capital mise en vente (1 à 49 %) *</label>
            <input class="sheet-input" type="number" id="lsPercent" min="1" max="49" step="1" value="10" oninput="listingCalc()">
            <label class="sheet-label" for="lsPrice">Prix d'une part (FCFA, minimum 100) *</label>
            <input class="sheet-input" type="number" id="lsPrice" min="100" step="50" value="500" oninput="listingCalc()">
            <label class="sheet-label" for="lsPitch">Pourquoi investir chez toi ? (facultatif)</label>
            <textarea class="sheet-input" id="lsPitch" rows="3" maxlength="1000" placeholder="Ex : ouvrir une 2e boutique à Pointe-Noire, acheter un stock plus important…"></textarea>
            <div class="listing-calc" id="lsCalc"></div>
            <p class="sheet-warning"><i class="fas fa-info-circle"></i> L'équipe Ouenze vérifie ta boutique sur place (local, pièce d'identité) avant de l'ouvrir aux investisseurs.</p>
            <div class="form-error" id="sheetError" role="alert"></div>
            <button class="share-native" id="lsSubmit" onclick="submitListing('${escapeHtml(shop.id)}')"><i class="fas fa-paper-plane"></i> Envoyer ma demande</button>`);
        listingCalc();
    }

    function listingCalc() {
        const percent = Number(document.getElementById('lsPercent')?.value) || 0;
        const price = Number(document.getElementById('lsPrice')?.value) || 0;
        const shares = Math.round(percent * SHARES_PER_COMPANY / 100);
        const el = document.getElementById('lsCalc');
        if (!el) return;
        el.innerHTML = `<div><span>Parts mises en vente</span><strong>${shares.toLocaleString('fr-FR')}</strong></div>
            <div><span>Montant levé si tout est vendu</span><strong>${formatNumber(shares * price)} FCFA</strong></div>
            <div><span>Valorisation de la boutique</span><strong>${formatNumber(price * SHARES_PER_COMPANY)} FCFA</strong></div>
            <div><span>Tu gardes</span><strong>${Math.max(0, 100 - percent).toLocaleString('fr-FR')} %</strong></div>`;
    }

    async function submitListing(shopId) {
        const percent = Number(document.getElementById('lsPercent').value);
        const price = Number(document.getElementById('lsPrice').value);
        const pitch = document.getElementById('lsPitch').value.trim();
        if (!(percent >= 1 && percent <= 49)) return sheetError('Choisis une part entre 1 et 49 % : tu gardes le contrôle de ta boutique.');
        if (!(price >= 100)) return sheetError('Le prix d\'une part doit être d\'au moins 100 FCFA.');
        const btn = document.getElementById('lsSubmit');
        btn.disabled = true;
        btn.textContent = 'Envoi…';
        const { error } = await window.supabase.rpc('request_listing', { target_shop: shopId, percent, share_price: price, pitch_text: pitch || null });
        if (error) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer ma demande';
            return sheetError(error.message || 'Envoi impossible, réessaie.');
        }
        openSheet(`<h3>Demande envoyée ✅</h3>
            <p class="share-sub">L'équipe Ouenze va te contacter pour vérifier ta boutique sur place. Dès validation, elle apparaîtra sur la page Investir.</p>
            <a class="share-native" href="activities.html"><i class="fas fa-history"></i> Suivre dans Mes activités</a>`);
    }

    function openManageShop(shopId) {
        const shop = dashShops.find(s => String(s.id) === String(shopId));
        if (!shop) return;
        const id = escapeHtml(shop.id);
        openSheet(`
            <h3>Gérer « ${escapeHtml(shop.name)} »</h3>
            <p class="share-sub">Vendre ta boutique à quelqu'un, ou la fermer.</p>
            <div class="manage-options">
                <button class="manage-option" onclick="openTransferForm('${id}')">
                    <i class="fas fa-exchange-alt"></i>
                    <span><strong>Vendre / transférer</strong><small>La boutique passe sur le compte de l'acheteur après sa confirmation (lien envoyé par email, SMS et WhatsApp).</small></span>
                </button>
                <button class="manage-option danger" onclick="openCloseForm('${id}')">
                    <i class="fas fa-store-slash"></i>
                    <span><strong>Fermer la boutique</strong><small>Archivée si elle a déjà vendu (historique conservé), sinon supprimée.</small></span>
                </button>
            </div>`);
    }
 
    function openTransferForm(shopId) {
        const shop = dashShops.find(s => String(s.id) === String(shopId));
        if (!shop) return;
        openSheet(`
            <h3>Vendre « ${escapeHtml(shop.name)} »</h3>
            <p class="share-sub">L'acheteur recevra un lien valable 72 h. La boutique ne change de propriétaire que lorsqu'il confirme avec ce compte.</p>
            <label class="sheet-label">Email du nouveau propriétaire *</label>
            <input class="sheet-input" type="email" id="trEmail" placeholder="acheteur@email.com" autocomplete="off">
            <label class="sheet-label">Téléphone (SMS et WhatsApp)</label>
            <div class="sheet-phone">
                <select id="trCountry"><option value="CG">🇨🇬 +242</option><option value="CD">🇨🇩 +243</option></select>
                <input class="sheet-input" type="tel" id="trPhone" inputmode="tel" placeholder="06 555 25 62">
            </div>
            <label class="sheet-label">Prix convenu (FCFA, facultatif)</label>
            <input class="sheet-input" type="number" id="trPrice" min="0" step="1000" placeholder="Ex : 1 500 000">
            <p class="sheet-warning"><i class="fas fa-info-circle"></i> Ouenze n'encaisse pas ce paiement : réglez-le entre vous avant la confirmation.</p>
            <div class="form-error" id="sheetError" role="alert"></div>
            <button class="share-native" id="trSubmit" onclick="submitTransfer('${escapeHtml(shop.id)}')"><i class="fas fa-paper-plane"></i> Envoyer le lien de confirmation</button>`);
        document.getElementById('trEmail').focus();
    }
 
    async function submitTransfer(shopId) {
        const shop = dashShops.find(s => String(s.id) === String(shopId));
        const email = (document.getElementById('trEmail').value || '').trim().toLowerCase();
        const rawPhone = (document.getElementById('trPhone').value || '').trim();
        const cc = document.getElementById('trCountry').value;
        const priceRaw = document.getElementById('trPrice').value;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return sheetError('Email invalide.');
        if (email === String(dashUser?.email || '').toLowerCase()) return sheetError('C\'est ton propre email.');
        const phone = rawPhone ? normalizePhone(rawPhone, cc) : '';
        if (phone === null) return sheetError(cc === 'CD' ? 'Numéro invalide. Exemple : +243 81 234 5678' : 'Numéro invalide. Exemple : +242 06 555 25 62');
        const price = priceRaw === '' ? null : Number(priceRaw);
        if (price !== null && (!Number.isFinite(price) || price < 0)) return sheetError('Prix invalide.');
        if (!confirm(`Envoyer à ${email} le lien pour reprendre « ${shop.name} » ?`)) return;
 
        const btn = document.getElementById('trSubmit');
        btn.disabled = true;
        btn.textContent = 'Envoi…';
        const { data, error } = await invokeTransfer({ action: 'create', shop_id: shopId, to_email: email, to_phone: phone || null, price });
        if (error) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer le lien de confirmation';
            return sheetError(error);
        }
        const label = v => v === true ? '✅ envoyé' : v === 'échec' ? '⚠️ échec' : '— non configuré';
        const waText = encodeURIComponent(`Bonjour, voici le lien pour reprendre ma boutique « ${shop.name} » sur Ouenze (valable 72 h) : ${data.link}`);
        const waNumber = phone ? phone.replace(/\D/g, '') : '';
        openSheet(`
            <h3>Lien envoyé ✅</h3>
            <p class="share-sub">${escapeHtml(email)} a 72 h pour confirmer. Tu seras prévenu par email.</p>
            <dl class="channel-list">
                <dt>Email</dt><dd>${label(data.channels?.email)}</dd>
                ${phone ? `<dt>SMS</dt><dd>${label(data.channels?.sms)}</dd><dt>WhatsApp</dt><dd>${label(data.channels?.whatsapp)}</dd>` : ''}
            </dl>
            ${phone && data.channels?.whatsapp !== true ? `
                <a class="share-native" style="display:block;text-align:center;text-decoration:none;background:#25D366;" target="_blank" rel="noopener"
                   href="https://wa.me/${waNumber}?text=${waText}"><i class="fab fa-whatsapp"></i> Envoyer moi-même sur WhatsApp</a>` : ''}
            <button class="share-native" style="background:#0f172a;" onclick="closeShareShop();location.reload();">Terminé</button>`);
    }
 
    async function cancelTransfer(transferId) {
        if (!confirm('Annuler ce transfert ? Le lien envoyé ne fonctionnera plus.')) return;
        const { error } = await invokeTransfer({ action: 'cancel', transfer_id: transferId });
        if (error) { alert(error); return; }
        location.reload();
    }
 
    function openCloseForm(shopId) {
        const shop = dashShops.find(s => String(s.id) === String(shopId));
        if (!shop) return;
        openSheet(`
            <h3>Fermer « ${escapeHtml(shop.name)} »</h3>
            <p class="share-sub">Si la boutique a déjà vendu, elle est <strong>archivée</strong> : elle disparaît du site mais ses commandes et sa comptabilité sont conservées. Sinon, elle est <strong>supprimée définitivement</strong> avec ses produits.</p>
            <label class="sheet-label">Pour confirmer, tape le nom de la boutique :</label>
            <input class="sheet-input" type="text" id="closeName" placeholder="${escapeHtml(shop.name)}" autocomplete="off">
            <div class="form-error" id="sheetError" role="alert"></div>
            <button class="share-native" id="closeSubmit" style="background:#dc2626;" onclick="submitCloseShop('${escapeHtml(shop.id)}')"><i class="fas fa-store-slash"></i> Fermer la boutique</button>`);
        document.getElementById('closeName').focus();
    }
 
    async function submitCloseShop(shopId) {
        const shop = dashShops.find(s => String(s.id) === String(shopId));
        const typed = (document.getElementById('closeName').value || '').trim().toLowerCase();
        if (typed !== String(shop.name).trim().toLowerCase()) return sheetError('Le nom ne correspond pas.');
        const btn = document.getElementById('closeSubmit');
        btn.disabled = true;
        const { data, error } = await window.supabase.rpc('close_shop', { target_shop: shopId });
        if (error) {
            btn.disabled = false;
            return sheetError(/function .* does not exist|schema cache/i.test(error.message)
                ? 'La fermeture de boutique n\'est pas encore activée (migration SQL à exécuter).' : error.message);
        }
        alert(data === 'archived'
            ? `« ${shop.name} » est archivée : elle n'apparaît plus sur le site, son historique est conservé.`
            : `« ${shop.name} » a été supprimée.`);
        location.reload();
    }
 
    // ============ PARTAGE DE LA BOUTIQUE ============
    function shopLink(shopId) {
        return `${window.location.origin}/?shop=${encodeURIComponent(shopId)}`;
    }
 
    function shareMessage(shop) {
        return `Découvrez ma boutique « ${shop.name} » sur Ouenze 🛍️`;
    }
 
    function openShareShop(shopId) {
        const shop = dashShops.find(s => String(s.id) === String(shopId));
        if (!shop) return;
        const url = shopLink(shop.id);
        const text = shareMessage(shop);
        const u = encodeURIComponent(url);
        const t = encodeURIComponent(text);
        const networks = [
            { name: 'WhatsApp', icon: 'fab fa-whatsapp', color: '#25D366', href: `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}` },
            { name: 'Facebook', icon: 'fab fa-facebook-f', color: '#1877F2', href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
            { name: 'Messenger', icon: 'fab fa-facebook-messenger', color: '#0084FF', href: `fb-messenger://share/?link=${u}`, mobileOnly: true },
            { name: 'Telegram', icon: 'fab fa-telegram-plane', color: '#229ED9', href: `https://t.me/share/url?url=${u}&text=${t}` },
            { name: 'X (Twitter)', icon: 'fab fa-twitter', color: '#0f1419', href: `https://twitter.com/intent/tweet?text=${t}&url=${u}` },
            { name: 'SMS', icon: 'fas fa-sms', color: '#64748b', href: `sms:?&body=${encodeURIComponent(text + ' ' + url)}`, mobileOnly: true },
            { name: 'E-mail', icon: 'fas fa-envelope', color: '#ea580c', href: `mailto:?subject=${encodeURIComponent(shop.name + ' sur Ouenze')}&body=${encodeURIComponent(text + '\n' + url)}` }
        ];
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        const canNativeShare = typeof navigator.share === 'function';
 
        document.getElementById('shareOverlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'shareOverlay';
        overlay.className = 'share-overlay';
        overlay.innerHTML = `
            <div class="share-sheet" role="dialog" aria-label="Partager ma boutique">
                <button class="share-close" onclick="closeShareShop()" aria-label="Fermer">&times;</button>
                <h3>Partager « ${escapeHtml(shop.name)} »</h3>
                <p class="share-sub">Envoyez le lien de votre boutique à vos clients.</p>
 
                ${canNativeShare ? `
                    <button class="share-native" onclick="nativeShareShop('${escapeHtml(shop.id)}')">
                        <i class="fas fa-share-alt"></i> Partager via Instagram, Snapchat, TikTok…
                    </button>` : ''}
 
                <div class="share-grid">
                    ${networks.filter(n => !n.mobileOnly || isMobile).map(n => `
                        <a class="share-item" href="${n.href}" target="_blank" rel="noopener">
                            <span class="share-icon" style="background:${n.color};"><i class="${n.icon}"></i></span>
                            <span>${n.name}</span>
                        </a>`).join('')}
                    <button class="share-item" onclick="copyShopLink('${escapeHtml(shop.id)}', 'Instagram')">
                        <span class="share-icon" style="background:linear-gradient(45deg,#f09433,#dc2743,#bc1888);"><i class="fab fa-instagram"></i></span>
                        <span>Instagram</span>
                    </button>
                    <button class="share-item" onclick="copyShopLink('${escapeHtml(shop.id)}', 'Snapchat')">
                        <span class="share-icon" style="background:#FFFC00;color:#000;"><i class="fab fa-snapchat-ghost"></i></span>
                        <span>Snapchat</span>
                    </button>
                </div>
 
                <div class="share-link">
                    <input type="text" readonly value="${escapeHtml(url)}" onclick="this.select()">
                    <button onclick="copyShopLink('${escapeHtml(shop.id)}')"><i class="fas fa-copy"></i> Copier</button>
                </div>
                <p class="share-tip" id="shareTip">Astuce : mettez ce lien dans la bio de votre Instagram, TikTok ou Snapchat.</p>
            </div>`;
        overlay.addEventListener('click', e => { if (e.target === overlay) closeShareShop(); });
        document.body.appendChild(overlay);
    }
 
    function closeShareShop() {
        document.getElementById('shareOverlay')?.remove();
    }
 
    async function nativeShareShop(shopId) {
        const shop = dashShops.find(s => String(s.id) === String(shopId));
        if (!shop) return;
        try {
            await navigator.share({ title: shop.name, text: shareMessage(shop), url: shopLink(shop.id) });
        } catch (e) {
            // Partage annulé par l'utilisateur : rien à faire
        }
    }
 
    // Instagram et Snapchat n'acceptent pas de lien depuis le web : on copie le lien à coller
    async function copyShopLink(shopId, network) {
        const url = shopLink(shopId);
        let ok = false;
        try {
            await navigator.clipboard.writeText(url);
            ok = true;
        } catch (e) {
            const input = document.querySelector('.share-link input');
            if (input) { input.select(); ok = document.execCommand('copy'); }
        }
        const tip = document.getElementById('shareTip');
        if (tip) {
            tip.textContent = !ok ? 'Copie impossible : sélectionnez le lien ci-dessus et copiez-le.'
                : network ? `Lien copié ✅ Collez-le dans ${network} (story, message ou bio).`
                : 'Lien copié ✅';
            tip.classList.toggle('ok', ok);
        }
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
 
    Object.assign(window, { createNewShop, openShopDesigner, viewShop, openShareShop, closeShareShop, nativeShareShop, copyShopLink,
        openManageShop, openTransferForm, submitTransfer, cancelTransfer, openCloseForm, submitCloseShop,
        openListing, listingCalc, submitListing });
 
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
 
