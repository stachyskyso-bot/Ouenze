// ============================================================
// APP.JS — Ouenze Marketplace — version stable (JCVD, 01/10/2026)
//
// Dépendances (dans cet ordre dans index.html) :
//   1. supabase-js v2 (CDN)
//   2. js/supabase-config.js  → doit exposer le client dans window.supabase
//   3. js/database.js         → getCurrentUser, getProfile, getShops, getUserOrders
//                               (optionnels : fallback Supabase direct si absents)
//   4. js/app.js
// ============================================================
 
(function () {
    'use strict';
 
    if (window.__APP_LOADED__) {
        console.warn('⚠️ app.js déjà chargé, abandon');
        return;
    }
    window.__APP_LOADED__ = true;
 
    // ============ ÉTAT ============
    let currentUser = null;
    let currentProfile = null;
    let currentUserType = null;
    let shopsCache = [];          // boutiques affichées sur l'accueil
    let productsCache = {};       // id produit → produit (pour addToCart)
    let orders = [];
    let currentSort = 'rating';
    let currentShopProducts = [];   // vue boutique : produits affichés
    let currentShopCategories = [];
    let currentShopDesign = null;
    let currentShopCategoryFilter = '';
    let cart = loadCart();
 
    // ============ UTILITAIRES ============
    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[m]));
    }

    // Téléphone Congo-Brazzaville : +242 0X XXX XX XX (mobiles 04, 05, 06).
    // Accepte espaces, points, tirets, et les préfixes +242 / 00242 / 242.
    // Renvoie le numéro normalisé, ou null s'il est invalide.
    function normalizeCongoPhone(input) {
        let d = String(input || '').replace(/[\s.\-()]/g, '');
        if (d.startsWith('+242')) d = d.slice(4);
        else if (d.startsWith('00242')) d = d.slice(5);
        else if (d.startsWith('242') && d.length === 12) d = d.slice(3);
        if (!/^0[456]\d{7}$/.test(d)) return null;
        return `+242 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7)}`;
    }

    // Images : http(s) ou data:image (logos/photos stockés en base64 par le shop-designer)
    function safeUrl(url) {
        const u = String(url || '');
        return /^(https?:\/\/|data:image\/)/i.test(u) ? escapeHtml(u) : '';
    }
 
    function safeColor(c, fallback) {
        return /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : fallback;
    }
 
    function safeNum(n, fallback, min, max) {
        const v = Number(n);
        return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
    }
 
    function formatPrice(price) {
        return Number(price || 0).toLocaleString('fr-FR');
    }
 
    function generateStars(rating) {
        const r = Math.max(0, Math.min(5, Number(rating) || 0));
        const full = Math.floor(r);
        const half = r - full >= 0.5;
        let stars = '';
        for (let i = 0; i < full; i++) stars += '<i class="fas fa-star"></i>';
        if (half) stars += '<i class="fas fa-star-half-alt"></i>';
        for (let i = full + (half ? 1 : 0); i < 5; i++) stars += '<i class="far fa-star"></i>';
        return stars;
    }
 
    function getShopLevel(shop) {
        const rating = shop.rating || 0;
        if (rating >= 4.5) return { name: 'Or', class: 'level-gold' };
        if (rating >= 4) return { name: 'Argent', class: 'level-silver' };
        if (rating >= 3) return { name: 'Bronze', class: 'level-bronze' };
        return { name: 'Standard', class: '' };
    }
 
    function loadCart() {
        try {
            return JSON.parse(localStorage.getItem('ouenze_cart') || '[]');
        } catch (e) {
            return [];
        }
    }
 
    // ============ ACCÈS DONNÉES (database.js + fallback) ============
    async function fetchCurrentUser() {
        if (typeof getCurrentUser === 'function') return getCurrentUser();
        const { data } = await window.supabase.auth.getUser();
        return data?.user || null;
    }
 
    async function fetchProfile(userId) {
        if (typeof getProfile === 'function') return getProfile(userId);
        const { data } = await window.supabase
            .from('profiles').select('*').eq('id', userId).maybeSingle();
        return data;
    }
 
    async function fetchUserOrders(userId) {
        if (typeof getUserOrders === 'function') return getUserOrders(userId);
        const { data } = await window.supabase
            .from('orders').select('*').eq('user_id', userId)
            .order('created_at', { ascending: false });
        return data || [];
    }
 
    // ============ INITIALISATION ============
    async function initApp() {
        console.log('🚀 Initialisation...');
 
        if (!window.supabase || !window.supabase.auth) {
            console.error('❌ Client Supabase introuvable (vérifier supabase-config.js)');
        }
 
        try {
            currentUser = await fetchCurrentUser();
            if (currentUser) {
                currentProfile = await fetchProfile(currentUser.id);
                currentUserType = currentProfile?.user_type || 'client';
                console.log('👤 Connecté:', currentUser.email, '—', currentUserType);
                await loadUserData();
            } else {
                console.log('👤 Non connecté');
            }
        } catch (error) {
            console.error('❌ Erreur init:', error);
        }
 
        // Toujours appelé : c'est ce qui affiche Connexion/Inscription
        updateHeaderUI();
        updateCartCount();
 
        // Lien direct vers une boutique : index.html?shop=<id> (bouton « Voir en ligne »)
        const shopParam = new URLSearchParams(window.location.search).get('shop');
        if (shopParam) {
            viewShopDetail(shopParam);
        } else {
            showHomePage();
        }
    }
 
    async function loadUserData() {
        try {
            if (currentUserType === 'client') {
                orders = await fetchUserOrders(currentUser.id);
            }
        } catch (error) {
            console.error('❌ Erreur chargement données:', error);
        }
    }
 
    // ============ AUTHENTIFICATION ============
    async function doLogin() {
        const email = document.getElementById('loginEmail')?.value.trim();
        const password = document.getElementById('loginPassword')?.value;
 
        if (!email || !password) {
            alert('Email et mot de passe requis');
            return;
        }
 
        try {
            const { data, error } = await window.supabase.auth.signInWithPassword({ email, password });
 
            if (error) {
                console.error('❌', error.message);
                alert(/confirm/i.test(error.message)
                    ? "Ton email n'est pas encore confirmé."
                    : 'Email ou mot de passe incorrect');
                return;
            }
 
            currentUser = data.user;
            currentProfile = await fetchProfile(currentUser.id);
            currentUserType = currentProfile?.user_type || 'client';
 
            closeModal();
            updateHeaderUI();
            await loadUserData();
 
            if (currentUserType === 'vendeur') {
                window.location.href = 'vendor-dashboard.html';
            } else if (currentUserType === 'livreur') {
                window.location.href = 'delivery-dashboard.html';
            } else {
                showHomePage();
            }
        } catch (error) {
            console.error('❌ Erreur connexion:', error);
            alert('Une erreur est survenue');
        }
    }
 
    async function doSignUp() {
        const val = id => document.getElementById(id)?.value.trim() || '';
        const email = val('signupEmail');
        const password = document.getElementById('signupPassword')?.value || '';
        const fullName = val('signupName');
        const userType = val('signupType') || 'client';
        const rawPhone = val('signupPhone');
        const city = val('signupCity') || 'Brazzaville';
 
        if (!email || !password || !fullName) {
            alert('Champs obligatoires manquants');
            return;
        }
        if (password.length < 6) {
            alert('Mot de passe trop court (min 6 caractères)');
            return;
        }
        const phone = rawPhone ? normalizeCongoPhone(rawPhone) : '';
        if (phone === null) {
            alert('Numéro de téléphone invalide.\n\nFormat attendu : +242 06 XXX XX XX ou +242 05 XXX XX XX');
            document.getElementById('signupPhone')?.focus();
            return;
        }
 
        try {
            const { data, error } = await window.supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        full_name: fullName,
                        user_type: userType,
                        phone,
                        city,
                        country: 'Congo-Brazzaville'
                    }
                }
            });
 
            if (error) {
                console.error('❌ Inscription:', error.message);
                const msg = error.message || '';
                if (/already registered|already exists/i.test(msg)) {
                    alert('Un compte existe déjà avec cet email.\n\nConnecte-toi, ou utilise « Mot de passe oublié » si tu ne t\'en souviens plus.');
                    openLoginModal();
                    const loginEmail = document.getElementById('loginEmail');
                    if (loginEmail) loginEmail.value = email;
                } else if (/valid email|invalid.*email/i.test(msg)) {
                    alert('Adresse email invalide.');
                } else if (/password/i.test(msg)) {
                    alert('Mot de passe refusé : choisis-en un plus long ou plus difficile à deviner.');
                } else if (/rate limit|too many|security purposes/i.test(msg)) {
                    alert('Trop de tentatives récentes. Réessaie dans quelques minutes.');
                } else {
                    alert("Erreur lors de l'inscription.\n\nDétail : " + msg);
                }
                return;
            }
 
            closeModal();
 
            // Si la confirmation email est activée, il n'y a pas encore de session
            if (!data.session) {
                alert(`Inscription enregistrée, ${fullName} !\n\nConfirme ton adresse via l'email reçu, puis connecte-toi.`);
                return;
            }
 
            if (userType === 'vendeur') {
                window.location.href = 'shop-designer.html';
            } else {
                await initApp();
            }
        } catch (error) {
            console.error('❌ Erreur inscription:', error);
            alert("Erreur lors de l'inscription");
        }
    }
 
    async function logout() {
        try {
            await window.supabase.auth.signOut();
        } catch (error) {
            console.error('❌ Erreur déconnexion:', error);
        }
        currentUser = null;
        currentProfile = null;
        currentUserType = null;
        orders = [];
        cart = [];
        localStorage.removeItem('ouenze_cart');
        updateHeaderUI();
        updateCartCount();
        showHomePage();
    }
 
    async function requestPasswordReset() {
        const emailInput = document.getElementById('loginEmail');
        const email = emailInput?.value.trim();
 
        if (!email) {
            alert("Entre d'abord ton adresse email dans le champ Email.");
            emailInput?.focus();
            return;
        }
 
        try {
            const { error } = await window.supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/reset-password.html`
            });
 
            if (error) {
                console.error('❌ Erreur récupération:', error);
                const msg = error.message || '';
                let hint = '';
                if (/rate limit|too many|security purposes/i.test(msg)) {
                    hint = '\n\nTrop de demandes récentes. Réessaie dans une heure.';
                } else if (/sending|smtp|email/i.test(msg)) {
                    hint = "\n\nLe service d'envoi d'emails n'est pas configuré correctement.";
                }
                alert("Impossible d'envoyer l'email de récupération." + hint + '\n\nDétail : ' + msg);
                return;
            }
 
            alert(
                'Si un compte correspond à cette adresse, un email de réinitialisation vient d\'être envoyé.\n\n' +
                'Vérifie également tes spams.'
            );
        } catch (error) {
            console.error('❌ Erreur récupération:', error);
            alert('Une erreur est survenue lors de la demande.');
        }
    }
 
    // ============ HEADER ============
    function cartTotalQty() {
        return cart.reduce((s, i) => s + (i.quantity || 0), 0);
    }
 
    function updateHeaderUI() {
        const container = document.getElementById('headerActions');
        if (container) {
            if (currentUser) {
                const labels = { client: 'Client', vendeur: 'Vendeur', livreur: 'Livreur', admin: 'Admin' };
                const name = currentProfile?.full_name || currentUser.email || 'Utilisateur';
                const avatar = safeUrl(currentProfile?.avatar_url);
 
                container.innerHTML = `
                    <div class="user-menu" onclick="showProfile()">
                        <div class="user-avatar">
                            ${avatar ? `<img src="${avatar}" alt="">` : escapeHtml(name.charAt(0).toUpperCase())}
                        </div>
                        <div class="user-info">
                            <div>${escapeHtml(name.split(' ')[0])}</div>
                            <small>${labels[currentUserType] || 'Client'}</small>
                        </div>
                        <button onclick="event.stopPropagation();logout()" title="Déconnexion"
                                style="background:none;border:none;cursor:pointer;color:var(--gray-500);">
                            <i class="fas fa-sign-out-alt"></i>
                        </button>
                    </div>
                    <div class="cart-icon" onclick="showCart()">
                        <i class="fas fa-shopping-cart"></i>
                        <span class="cart-count">${cartTotalQty()}</span>
                    </div>`;
            } else {
                container.innerHTML = `
                    <button class="auth-btn" onclick="openLoginModal()">Connexion</button>
                    <button class="auth-btn" onclick="openRegisterModal()">Inscription</button>
                    <div class="cart-icon" onclick="showCart()">
                        <i class="fas fa-shopping-cart"></i>
                        <span class="cart-count">${cartTotalQty()}</span>
                    </div>`;
            }
        }
 
        // Liens de navigation selon le rôle
        const vendorLink = document.getElementById('vendorLink');
        if (vendorLink) {
            const isVendor = currentUserType === 'vendeur';
            vendorLink.style.display = isVendor ? '' : 'none';
            vendorLink.href = 'vendor-dashboard.html';
        }
        const deliveryLink = document.getElementById('deliveryDashboardLink');
        if (deliveryLink) {
            deliveryLink.style.display = currentUserType === 'livreur' ? '' : 'none';
        }
    }
 
    // ============ PAGE D'ACCUEIL ============
    async function showHomePage() {
        const container = document.getElementById('appContainer');
        if (!container) return;
 
        container.innerHTML = `
            <div class="ranking-bar">
                <div class="ranking-filters">
                    <button class="sort-btn" data-sort="rating" onclick="setSort('rating')">
                        <i class="fas fa-sort-down"></i> Par note
                    </button>
                    <button class="sort-btn" data-sort="sales" onclick="setSort('sales')">
                        <i class="fas fa-sort"></i> Par ventes
                    </button>
                    <button class="sort-btn" data-sort="products" onclick="setSort('products')">
                        <i class="fas fa-sort"></i> Par produits
                    </button>
                </div>
                <div>
                    <span class="rating-badge gold"><i class="fas fa-crown"></i> Or</span>
                    <span class="rating-badge silver"><i class="fas fa-star"></i> Argent</span>
                    <span class="rating-badge bronze"><i class="fas fa-star-half-alt"></i> Bronze</span>
                </div>
            </div>
            <div id="shopsGrid" class="shops-grid">
                <div style="text-align:center;padding:60px;color:var(--gray-500);">Chargement…</div>
            </div>`;
 
        await loadShops();
    }
 
    async function loadShops() {
        const grid = document.getElementById('shopsGrid');
        if (!grid) return;
 
        try {
            const { data, error } = await window.supabase
                .from('shops')
                .select('*, products(count)');
            if (error) throw error;
 
            shopsCache = data || [];
            renderShops();
        } catch (error) {
            console.error('❌ Erreur boutiques:', error);
            grid.innerHTML = `
                <div style="text-align:center;padding:60px;color:var(--danger);">
                    <i class="fas fa-exclamation-circle" style="font-size:48px;margin-bottom:16px;"></i>
                    <p>Erreur de chargement</p>
                </div>`;
        }
    }
 
    function productCountOf(shop) {
        return shop.products?.[0]?.count || 0;
    }
 
    function renderShops(filterText) {
        const grid = document.getElementById('shopsGrid');
        if (!grid) return;
 
        document.querySelectorAll('.sort-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.sort === currentSort));
 
        let list = shopsCache.slice();
        const q = (filterText || '').toLowerCase().trim();
        if (q) {
            list = list.filter(s =>
                (s.name || '').toLowerCase().includes(q) ||
                (s.city || '').toLowerCase().includes(q) ||
                (s.description || '').toLowerCase().includes(q));
        }
 
        const sorters = {
            rating: (a, b) => (b.rating || 0) - (a.rating || 0),
            sales: (a, b) => (b.total_sales || 0) - (a.total_sales || 0),
            products: (a, b) => productCountOf(b) - productCountOf(a)
        };
        list.sort(sorters[currentSort] || sorters.rating);
 
        if (list.length === 0) {
            grid.innerHTML = `
                <div style="text-align:center;padding:60px;color:var(--gray-500);">
                    <i class="fas fa-store-slash" style="font-size:48px;margin-bottom:16px;"></i>
                    <p>Aucune boutique trouvée</p>
                </div>`;
            return;
        }
 
        grid.innerHTML = list.map(shop => {
            const level = getShopLevel(shop);
            const logo = safeUrl(shop.logo_url);
            return `
                <div class="shop-card" onclick="viewShopDetail('${escapeHtml(shop.id)}')">
                    <div class="shop-logo-area">
                        <div class="shop-logo-img">
                            ${logo
                                ? `<img src="${logo}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`
                                : '<i class="fas fa-store" style="font-size:28px;"></i>'}
                        </div>
                        <div class="shop-name">${escapeHtml(shop.name)}</div>
                        <div class="shop-rating">
                            <div class="stars">${generateStars(shop.rating)}</div>
                            <span>(${shop.total_ratings || 0})</span>
                        </div>
                        <div style="font-size:11px;color:var(--gray-500);margin-top:4px;">
                            <i class="fas fa-map-marker-alt"></i> ${escapeHtml(shop.city || 'Brazzaville')}
                        </div>
                        <div style="margin-top:6px;">
                            <span class="level-badge ${level.class}"><i class="fas fa-crown"></i> ${level.name}</span>
                        </div>
                    </div>
                    <div class="shop-details">
                        <div class="shop-metrics">
                            <div class="metric"><div class="metric-value">${productCountOf(shop)}</div><div>Produits</div></div>
                            <div class="metric"><div class="metric-value">${shop.total_sales || 0}</div><div>Ventes</div></div>
                        </div>
                        <button class="btn-visit-shop" style="margin-top:10px;width:100%;background:var(--primary);color:white;border:none;padding:6px;border-radius:30px;cursor:pointer;font-size:11px;">
                            <i class="fas fa-eye"></i> Voir la boutique
                        </button>
                    </div>
                </div>`;
        }).join('');
    }
 
    function setSort(sort) {
        currentSort = sort;
        renderShops(document.getElementById('searchInput')?.value);
    }
 
    // ============ VUE BOUTIQUE ============
    async function viewShopDetail(shopId) {
        try {
            const { data: shop, error: shopError } = await window.supabase
                .from('shops').select('*').eq('id', shopId).single();
            if (shopError) throw shopError;
 
            const { data: products, error: productsError } = await window.supabase
                .from('products').select('*').eq('shop_id', shopId);
            if (productsError) console.error('❌ Produits:', productsError);
 
            (products || []).forEach(p => { productsCache[p.id] = p; });
            currentShopProducts = products || [];
 
            const { data: cats } = await window.supabase
                .from('categories').select('id, name').eq('shop_id', shopId);
            currentShopCategories = cats || [];
 
            // Design enregistré par le shop-designer (valeurs validées)
            const ds = shop.design || {};
            currentShopDesign = {
                primary: safeColor(ds.primary_color, '#1e40af'),
                button: safeColor(ds.button_color, '#1e40af'),
                bg: safeColor(ds.background_color, '#ffffff'),
                headerText: safeColor(ds.header_text_color, '#ffffff'),
                productText: safeColor(ds.product_text_color, '#1e293b'),
                menuBg: safeColor(ds.menu_bg, '#1e40af'),
                menuText: safeColor(ds.menu_text, '#ffffff'),
                menuRadius: safeNum(ds.menu_radius, 0, 0, 30),
                layout: ds.layout === 'list' ? 'list' : 'grid',
                prodWidth: safeNum(ds.prod_width, 200, 140, 300),
                prodImgHeight: safeNum(ds.prod_img_height, 160, 100, 250),
                prodRadius: safeNum(ds.prod_radius, 12, 0, 32),
                prodGap: safeNum(ds.prod_gap, 16, 8, 40)
            };
            const d = currentShopDesign;
 
            const logo = safeUrl(shop.logo_url);
            const container = document.getElementById('appContainer');
            container.innerHTML = `
                <button onclick="resetToHome()" style="background:none;border:none;color:var(--primary);cursor:pointer;font-size:16px;margin-bottom:20px;">
                    ← Retour
                </button>
                <div style="background:${d.bg};border-radius:20px;overflow:hidden;border:1px solid var(--gray-200);">
                    <div style="background:linear-gradient(135deg,${d.primary},${d.primary}aa);padding:24px;color:${d.headerText};">
                        <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
                            <div style="width:80px;height:80px;flex-shrink:0;background:#fff;border-radius:16px;display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:32px;">
                                ${logo ? `<img src="${logo}" alt="" style="width:100%;height:100%;object-fit:contain;">` : '🏪'}
                            </div>
                            <div style="min-width:0;">
                                <h2 style="font-size:24px;margin:0;">${escapeHtml(shop.name)}</h2>
                                ${shop.description ? `<p style="opacity:.9;margin:4px 0;">${escapeHtml(shop.description)}</p>` : ''}
                                <p style="font-size:13px;opacity:.9;margin:2px 0;"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(shop.city || 'Brazzaville')}${shop.district ? ', ' + escapeHtml(shop.district) : ''}</p>
                                <p style="font-size:13px;opacity:.9;margin:2px 0;">⭐ ${Number(shop.rating || 0)}/5 (${shop.total_ratings || 0} avis)</p>
                            </div>
                        </div>
                    </div>
 
                    ${shop.show_search_bar ? `
                        <div style="padding:12px 16px;border-bottom:1px solid #e2e8f0;">
                            <div style="display:flex;background:#f1f5f9;border-radius:20px;padding:8px 14px;align-items:center;gap:8px;">
                                <input type="text" id="shopProductSearch" placeholder="Rechercher un produit..."
                                       oninput="filterShopProducts()"
                                       style="flex:1;border:none;background:transparent;outline:none;font-size:14px;">
                                <i class="fas fa-search" style="color:${d.primary};"></i>
                            </div>
                        </div>` : ''}
 
                    ${currentShopCategories.length ? `
                        <div style="background:${d.menuBg};color:${d.menuText};border-radius:${d.menuRadius}px;padding:10px 16px;display:flex;gap:8px;flex-wrap:wrap;margin:16px 16px 0;">
                            <button class="shop-cat-btn" data-cat="" onclick="filterShopProducts('')"
                                    style="background:none;border:none;color:inherit;cursor:pointer;font-size:14px;font-weight:700;padding:4px 8px;">Tout</button>
                            ${currentShopCategories.map(c => `
                                <button class="shop-cat-btn" data-cat="${escapeHtml(c.id)}" onclick="filterShopProducts('${escapeHtml(c.id)}')"
                                        style="background:none;border:none;color:inherit;cursor:pointer;font-size:14px;padding:4px 8px;opacity:.85;">${escapeHtml(c.name)}</button>`).join('')}
                        </div>` : ''}
 
                    <div style="padding:20px;">
                        <h3 id="shopProductsTitle" style="margin:0 0 12px;color:${d.productText};">Produits (${currentShopProducts.length})</h3>
                        <div id="shopProductsGrid"></div>
                    </div>
                </div>`;
            currentShopCategoryFilter = '';
            renderShopProducts(currentShopProducts);
            window.scrollTo(0, 0);
        } catch (error) {
            console.error('❌ Erreur boutique:', error);
            alert('Erreur chargement boutique');
        }
    }
 
    // Grille produits de la vue boutique, selon le design de la boutique
    function renderShopProducts(list) {
        const grid = document.getElementById('shopProductsGrid');
        const d = currentShopDesign;
        if (!grid || !d) return;
 
        const title = document.getElementById('shopProductsTitle');
        if (title) title.textContent = `Produits (${list.length})`;
 
        if (!list.length) {
            grid.innerHTML = `
                <div style="text-align:center;padding:40px;color:var(--gray-500);background:var(--gray-100);border-radius:12px;">
                    <p>Aucun produit</p>
                </div>`;
            return;
        }
 
        const isList = d.layout === 'list';
        grid.style.cssText = isList
            ? `display:flex;flex-direction:column;gap:${d.prodGap}px;`
            : `display:grid;grid-template-columns:repeat(auto-fill,minmax(min(${d.prodWidth}px,100%),1fr));gap:${d.prodGap}px;`;
 
        grid.innerHTML = list.map(p => {
            const photo = safeUrl(Array.isArray(p.photos) ? p.photos[0] : '');
            return `
            <div style="background:#fff;border-radius:${d.prodRadius}px;border:1px solid #e2e8f0;overflow:hidden;${isList ? 'display:flex;gap:12px;' : ''}">
                <div style="${isList ? 'width:96px;height:96px;' : `height:${d.prodImgHeight}px;`}flex-shrink:0;background:#f1f5f9;display:flex;align-items:center;justify-content:center;">
                    ${photo ? `<img src="${photo}" alt="" style="width:100%;height:100%;object-fit:cover;">`
                            : '<i class="fas fa-image" style="font-size:32px;color:#cbd5e1;"></i>'}
                </div>
                <div style="padding:12px;flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:14px;color:${d.productText};margin-bottom:4px;">${escapeHtml(p.name)}</div>
                    <div style="font-weight:700;font-size:14px;color:${d.primary};">${formatPrice(p.price)} FCFA</div>
                    <button onclick="addToCart('${escapeHtml(p.id)}')"
                            style="background:${d.button};color:#fff;border:none;padding:8px;border-radius:30px;width:100%;cursor:pointer;font-size:12px;font-weight:500;margin-top:8px;">
                        Ajouter
                    </button>
                </div>
            </div>`;
        }).join('');
    }
 
    // Filtre de la vue boutique : catégorie (menu) + texte (barre de recherche)
    function filterShopProducts(categoryId) {
        if (categoryId !== undefined) {
            currentShopCategoryFilter = String(categoryId);
            document.querySelectorAll('.shop-cat-btn').forEach(b => {
                const on = b.dataset.cat === currentShopCategoryFilter;
                b.style.fontWeight = on ? '700' : '400';
                b.style.opacity = on ? '1' : '.85';
            });
        }
        const q = (document.getElementById('shopProductSearch')?.value || '').toLowerCase().trim();
        renderShopProducts(currentShopProducts.filter(p =>
            (!currentShopCategoryFilter || String(p.category_id) === currentShopCategoryFilter) &&
            (!q || (p.name || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q))
        ));
    }
 
    // ============ PANIER ============
    function saveCart() {
        localStorage.setItem('ouenze_cart', JSON.stringify(cart));
        updateCartCount();
    }
 
    function updateCartCount() {
        const count = cartTotalQty();
        document.querySelectorAll('#cartCountHeader, .cart-count').forEach(el => {
            el.textContent = count;
        });
    }
 
    function addToCart(productId) {
        if (!currentUser) {
            alert('Connecte-toi pour ajouter au panier');
            openLoginModal();
            return;
        }
 
        const p = productsCache[productId];
        if (!p) {
            alert('Produit introuvable');
            return;
        }
 
        const existing = cart.find(i => i.productId === p.id);
        if (existing) {
            existing.quantity++;
        } else {
            cart.push({
                productId: p.id,
                productName: p.name,
                price: Number(p.price) || 0,
                quantity: 1,
                shopId: p.shop_id
            });
        }
        saveCart();
        alert(`${p.name} ajouté au panier`);
    }
 
    function showCart() {
        if (cart.length === 0) {
            alert('Panier vide');
            return;
        }
        let msg = 'Panier :\n\n';
        cart.forEach(i => {
            msg += `${i.productName} x${i.quantity} — ${formatPrice(i.price * i.quantity)} FCFA\n`;
        });
        msg += `\nTotal : ${formatPrice(cart.reduce((s, i) => s + i.price * i.quantity, 0))} FCFA`;
        alert(msg);
    }
 
    // ============ MODALES ============
    function closeModal() {
        document.querySelectorAll('.modal.active').forEach(m => m.remove());
    }
 
    function openModal(innerHtml) {
        closeModal();
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-card">
                <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
                ${innerHtml}
            </div>`;
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);
        return modal;
    }
 
    function openLoginModal() {
        const modal = openModal(`
            <h3 style="margin-bottom:20px;">Connexion</h3>
            <div class="form-group">
                <label>Email</label>
                <input type="email" id="loginEmail" placeholder="exemple@email.com" autocomplete="email">
            </div>
            <div class="form-group">
                <label>Mot de passe</label>
                <input type="password" id="loginPassword" placeholder="••••••••" autocomplete="current-password">
            </div>
            <div style="text-align:right;margin-top:-4px;margin-bottom:16px;">
                <button type="button" onclick="requestPasswordReset()"
                        style="background:none;border:none;padding:0;color:var(--primary);cursor:pointer;font-size:13px;">
                    Mot de passe oublié ?
                </button>
            </div>
            <button class="btn-submit" onclick="doLogin()">
                <i class="fas fa-sign-in-alt"></i> Se connecter
            </button>
            <div style="text-align:center;margin-top:16px;font-size:13px;">
                <a href="#" onclick="event.preventDefault();openRegisterModal();" style="color:var(--primary);cursor:pointer;">
                    Créer un compte
                </a>
            </div>`);
 
        modal.querySelector('#loginPassword').addEventListener('keydown', e => {
            if (e.key === 'Enter') doLogin();
        });
        modal.querySelector('#loginEmail').focus();
    }
 
    function openRegisterModal() {
        const modal = openModal(`
            <h3 style="margin-bottom:20px;">Inscription</h3>
            <div class="form-group">
                <label>Nom complet *</label>
                <input type="text" id="signupName" placeholder="Jean Dupont" autocomplete="name">
            </div>
            <div class="form-group">
                <label>Email *</label>
                <input type="email" id="signupEmail" placeholder="exemple@email.com" autocomplete="email">
            </div>
            <div class="form-group">
                <label>Mot de passe *</label>
                <input type="password" id="signupPassword" placeholder="Min 6 caractères" autocomplete="new-password">
            </div>
            <div class="form-group">
                <label>Téléphone</label>
                <input type="tel" id="signupPhone" placeholder="+242 06 XXX XX XX" autocomplete="tel" inputmode="tel">
            </div>
            <div class="form-group">
                <label>Ville</label>
                <input type="text" id="signupCity" placeholder="Brazzaville">
            </div>
            <div class="form-group">
                <label>Type de compte</label>
                <select id="signupType">
                    <option value="client">Client</option>
                    <option value="vendeur">Vendeur</option>
                    <option value="livreur">Livreur</option>
                </select>
            </div>
            <button class="btn-submit" onclick="doSignUp()">S'inscrire</button>
            <div style="text-align:center;margin-top:12px;">
                <a href="#" onclick="event.preventDefault();openLoginModal();" style="color:var(--primary);cursor:pointer;">
                    Déjà un compte ?
                </a>
            </div>`);
        modal.querySelector('#signupName').focus();
    }
 
    function showProfile() {
        if (!currentUser) {
            openLoginModal();
            return;
        }
        const labels = { client: 'Client', vendeur: 'Vendeur', livreur: 'Livreur', admin: 'Admin' };
        openModal(`
            <h3 style="margin-bottom:20px;">Mon profil</h3>
            <p><strong>Nom :</strong> ${escapeHtml(currentProfile?.full_name || '—')}</p>
            <p><strong>Email :</strong> ${escapeHtml(currentUser.email)}</p>
            <p><strong>Type :</strong> ${labels[currentUserType] || 'Client'}</p>
            ${currentUserType === 'vendeur' ? `
                <button class="btn-submit" style="margin-top:16px;" onclick="window.location.href='vendor-dashboard.html'">
                    <i class="fas fa-store"></i> Mon tableau de bord
                </button>` : ''}
            <button class="btn-cancel" style="margin-top:10px;width:100%;" onclick="window.location.href='reset-password.html'">
                <i class="fas fa-key"></i> Changer mon mot de passe
            </button>`);
    }
 
    async function showMyOrders() {
        if (!currentUser) {
            openLoginModal();
            return;
        }
        try {
            orders = await fetchUserOrders(currentUser.id);
        } catch (e) {
            console.error('❌ Commandes:', e);
        }
        openModal(`
            <h3 style="margin-bottom:20px;">Mes commandes</h3>
            ${orders && orders.length ? orders.map(o => `
                <div style="padding:10px 0;border-bottom:1px solid var(--gray-200);">
                    <div><strong>#${escapeHtml(String(o.id).slice(0, 8))}</strong> — ${escapeHtml(o.status || 'en attente')}</div>
                    <small style="color:var(--gray-500);">
                        ${o.created_at ? new Date(o.created_at).toLocaleDateString('fr-FR') : ''}
                        ${o.total_amount != null ? ' · ' + formatPrice(o.total_amount) + ' FCFA' : ''}
                    </small>
                </div>`).join('') : '<p style="color:var(--gray-500);">Aucune commande pour le moment.</p>'}`);
    }
 
    // ============ NAVIGATION / RECHERCHE ============
    function resetToHome() {
        showHomePage();
        window.scrollTo(0, 0);
        return false;
    }
 
    function bindPageEvents() {
        const input = document.getElementById('searchInput');
        const btn = document.getElementById('searchBtn');
        const runSearch = () => {
            if (!document.getElementById('shopsGrid')) {
                showHomePage().then(() => renderShops(input?.value));
            } else {
                renderShops(input?.value);
            }
        };
        if (input) {
            input.addEventListener('input', () => {
                if (document.getElementById('shopsGrid')) renderShops(input.value);
            });
            input.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
        }
        if (btn) btn.addEventListener('click', runSearch);
 
        const ddBtn = document.getElementById('dropdownBtn');
        const ddContent = document.getElementById('dropdownContent');
        if (ddBtn && ddContent) {
            ddBtn.addEventListener('click', e => {
                e.stopPropagation();
                ddContent.classList.toggle('show');
            });
            document.addEventListener('click', () => ddContent.classList.remove('show'));
        }
    }
 
    // ============ EXPORTS (utilisés par les onclick du HTML) ============
    Object.assign(window, {
        doLogin,
        doSignUp,
        logout,
        requestPasswordReset,
        showHomePage,
        resetToHome,
        showCart,
        showProfile,
        showMyOrders,
        openLoginModal,
        openRegisterModal,
        addToCart,
        setSort,
        viewShopDetail,
        filterShopProducts
    });
 
    // ============ DÉMARRAGE ============
    function start() {
        bindPageEvents();
        initApp();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
 
    console.log('✅ app.js chargé');
})();
 
