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
    let currentSearchType = 'all';  // onglets de recherche : all | shop | product
    let searchSeq = 0;              // ignore les réponses de recherches périmées
    let currentShopProducts = [];
    let currentShopName = '';       // vue boutique : nom (pour le panier)
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

    // ============ PAYS (Congo-Brazzaville d'abord, RDC) ============
    const COUNTRIES = {
        CG: {
            name: 'Congo-Brazzaville', flag: '🇨🇬', dial: '242', example: '06 555 25 62',
            cities: ['Brazzaville', 'Pointe-Noire', 'Dolisie', 'Nkayi', 'Ouesso', 'Owando', 'Impfondo', 'Madingou', 'Sibiti', 'Djambala']
        },
        CD: {
            name: 'RD Congo', flag: '🇨🇩', dial: '243', example: '81 234 5678',
            cities: ['Kinshasa', 'Lubumbashi', 'Mbuji-Mayi', 'Kisangani', 'Goma', 'Bukavu', 'Kananga', 'Matadi', 'Kolwezi', 'Likasi']
        }
    };
 
    // Renvoie le numéro au format international, ou null s'il est invalide.
    // Congo-Brazzaville : 0 + (4|5|6) + 7 chiffres      → +242 06 555 25 62
    // RDC               : (8x|9x) + 7 chiffres (0 initial facultatif) → +243 81 234 5678
    function normalizePhone(input, countryCode = 'CG') {
        const c = COUNTRIES[countryCode];
        if (!c) return null;
        let d = String(input || '').replace(/[\s.\-()]/g, '');
        if (d.startsWith('+' + c.dial)) d = d.slice(c.dial.length + 1);
        else if (d.startsWith('00' + c.dial)) d = d.slice(c.dial.length + 2);
        else if (d.startsWith(c.dial) && d.length === c.dial.length + 9) d = d.slice(c.dial.length);
        if (countryCode === 'CG') {
            if (!/^0[456]\d{7}$/.test(d)) return null;
            return `+242 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7)}`;
        }
        if (d.length === 10 && d.startsWith('0')) d = d.slice(1);
        if (!/^[89]\d{8}$/.test(d)) return null;
        return `+243 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;
    }
 
    // 0 à 4 : très faible → solide
    function passwordScore(pw) {
        let score = 0;
        if (pw.length >= 8) score++;
        if (pw.length >= 12) score++;
        if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
        if (/\d/.test(pw)) score++;
        if (/[^A-Za-z0-9]/.test(pw)) score++;
        return Math.min(score, 4);
    }
 
    function passwordProblem(pw, email) {
        if (pw.length < 8) return 'Le mot de passe doit contenir au moins 8 caractères.';
        if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Le mot de passe doit contenir des lettres et des chiffres.';
        const local = String(email || '').split('@')[0].toLowerCase();
        if (local.length >= 4 && pw.toLowerCase().includes(local)) return 'Le mot de passe ne doit pas contenir ton adresse email.';
        if (/^(.)\1+$/.test(pw) || /12345678|azerty|password|motdepasse/i.test(pw)) return 'Ce mot de passe est trop facile à deviner.';
        return '';
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
 
    // Médaille calculée par la base (shop_medals) ; à défaut, mêmes règles côté navigateur
    let shopMedals = {};
    const MEDAL_CLASS = { gold: 'level-gold', silver: 'level-silver', bronze: 'level-bronze', standard: '' };

    function getShopLevel(shop) {
        const M = window.OuenzeMedals;
        const tier = shopMedals[shop.id]
            ? M.get(shopMedals[shop.id])
            : M.compute(shop.rating, shop.real_sales_count ?? shop.total_sales, shop.is_verified);
        return { id: tier.id, rank: tier.rank, name: tier.name, emoji: tier.emoji, class: MEDAL_CLASS[tier.id] };
    }

    async function loadShopMedals() {
        try {
            const { data, error } = await window.supabase.rpc('shop_medals');
            if (!error && Array.isArray(data)) shopMedals = Object.fromEntries(data.map(m => [m.shop_id, m.medal]));
        } catch (e) { /* migration pas encore passée : règles locales */ }
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
        handleOAuthReturnError();
 
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
        if (needsProfileCompletion(currentUser)) openCompleteProfileModal();
 
        // Lien direct vers une boutique : index.html?shop=<id> (bouton « Voir en ligne »)
        // Pages de contenu (À propos, Aide…) : seulement l'en-tête, pas de vitrine
        if (!document.getElementById('appContainer')) return;
 
        const params = new URLSearchParams(window.location.search);
        const shopParam = params.get('shop');
        const queryParam = params.get('q');
        if (shopParam) {
            viewShopDetail(shopParam);
        } else if (queryParam) {
            // Recherche lancée depuis une autre page : index.html?q=<texte>
            const input = document.getElementById('searchInput');
            if (input) input.value = queryParam;
            showHomePage().then(() => performSearch(queryParam));
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
 
    let signupInFlight = false;
 
    async function doSignUp() {
        if (signupInFlight) return;
        const val = id => document.getElementById(id)?.value.trim() || '';
        const fullName = val('signupName').replace(/\s+/g, ' ');
        const email = val('signupEmail').toLowerCase();
        const password = document.getElementById('signupPassword')?.value || '';
        const password2 = document.getElementById('signupPassword2')?.value || '';
        const userType = document.querySelector('input[name="signupType"]:checked')?.value === 'vendeur' ? 'vendeur' : 'client';
        const err = (msg, field) => showFormError('signupError', msg, field);
 
        // Robot : le champ invisible a été rempli → on fait comme si tout allait bien
        if (val('signupWebsite')) { closeModal(); return; }
 
        if (fullName.length < 2 || !/[A-Za-zÀ-ÿ]/.test(fullName)) return err('Indique ton nom complet.', 'signupName');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err('Adresse email invalide.', 'signupEmail');
        const loc = readCountryFields('signup');
        if (loc.error) return err(loc.error, loc.field);
        const pwIssue = passwordProblem(password, email);
        if (pwIssue) return err(pwIssue, 'signupPassword');
        if (password !== password2) return err('Les deux mots de passe ne sont pas identiques.', 'signupPassword2');
        if (!document.getElementById('signupTerms')?.checked) return err('Merci d\'accepter les conditions d\'utilisation.');
        err('');
 
        const btn = document.getElementById('signupSubmit');
        signupInFlight = true;
        if (btn) { btn.disabled = true; btn.textContent = 'Création du compte…'; }
        const done = () => {
            signupInFlight = false;
            if (btn) { btn.disabled = false; btn.textContent = 'Créer mon compte'; }
        };
 
        try {
            const { data, error } = await window.supabase.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo: window.location.origin + '/',
                    data: {
                        full_name: fullName,
                        user_type: userType,
                        ...loc.values,
                        profile_completed: true
                    }
                }
            });
 
            if (error) {
                console.error('❌ Inscription:', error.message);
                const msg = error.message || '';
                done();
                if (/already registered|already exists/i.test(msg)) {
                    alert('Un compte existe déjà avec cet email.\n\nConnecte-toi, ou utilise « Mot de passe oublié » si tu ne t\'en souviens plus.');
                    openLoginModal();
                    const loginEmail = document.getElementById('loginEmail');
                    if (loginEmail) loginEmail.value = email;
                } else if (/valid email|invalid.*email/i.test(msg)) {
                    err('Adresse email invalide.', 'signupEmail');
                } else if (/pwned|leaked|compromised/i.test(msg)) {
                    err('Ce mot de passe est apparu dans une fuite de données connue. Choisis-en un autre.', 'signupPassword');
                } else if (/password/i.test(msg)) {
                    err('Mot de passe refusé : choisis-en un plus long ou plus difficile à deviner.', 'signupPassword');
                } else if (/rate limit|too many|security purposes/i.test(msg)) {
                    err('Trop de tentatives récentes. Réessaie dans quelques minutes.');
                } else if (/captcha/i.test(msg)) {
                    err('Vérification anti-robot échouée. Recharge la page et réessaie.');
                } else {
                    err("Erreur lors de l'inscription : " + msg);
                }
                return;
            }
            done();
 
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
            done();
            err("Erreur lors de l'inscription. Vérifie ta connexion internet et réessaie.");
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
        clearInterval(carouselTimer);
 
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
            <div id="productResults"></div>
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
            await loadShopMedals();
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
 
        grid.style.display = currentSearchType === 'product' ? 'none' : '';
        let list = shopsCache.slice();
        const q = (filterText || '').toLowerCase().trim();
        if (q) {
            list = list.filter(s =>
                (s.name || '').toLowerCase().includes(q) ||
                (s.city || '').toLowerCase().includes(q) ||
                (s.description || '').toLowerCase().includes(q));
        }
 
        // « Les mieux notées » : Or d'abord, puis Argent, Bronze (avantage des médailles), puis la note
        const sorters = {
            rating: (a, b) => (getShopLevel(b).rank - getShopLevel(a).rank) || ((b.rating || 0) - (a.rating || 0)),
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
                            <span class="level-badge ${level.class}">${level.emoji} ${level.name}</span>
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
 
    // ============ RECHERCHE (boutiques + produits) ============
    // Caractères qui casseraient le filtre PostgREST « or(...) »
    function cleanSearch(q) {
        return String(q || '').replace(/[%,()*\\:"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    }
 
    async function performSearch(rawQuery) {
        const q = cleanSearch(rawQuery);
        renderShops(q);
        const box = document.getElementById('productResults');
        if (!box) return;
        if (currentSearchType === 'shop' || q.length < 2) {
            box.innerHTML = currentSearchType === 'product' && q.length < 2
                ? '<p class="search-hint">Tape au moins 2 lettres pour chercher un produit.</p>' : '';
            return;
        }
 
        const seq = ++searchSeq;
        box.innerHTML = '<p class="search-hint">Recherche de produits…</p>';
        let { data, error } = await window.supabase
            .from('products').select('*, shops(name)')
            .or(`name.ilike.%${q}%,description.ilike.%${q}%`).limit(40);
        if (error) {
            // Sans relation déclarée products → shops : on cherche sans le nom de boutique
            ({ data, error } = await window.supabase
                .from('products').select('*')
                .or(`name.ilike.%${q}%,description.ilike.%${q}%`).limit(40));
        }
        if (seq !== searchSeq) return;  // une recherche plus récente a été lancée
        if (error) {
            console.error('❌ Recherche produits:', error);
            box.innerHTML = '<p class="search-hint">Recherche de produits indisponible pour le moment.</p>';
            return;
        }
        const list = data || [];
        list.forEach(p => { productsCache[p.id] = p; });
        if (!list.length) {
            box.innerHTML = `<p class="search-hint">Aucun produit trouvé pour « ${escapeHtml(q)} ».</p>`;
            return;
        }
        // Des produits trouvés mais aucune boutique : on n'affiche pas le bloc « Aucune boutique »
        const shopsGrid = document.getElementById('shopsGrid');
        const hasShops = !!shopsGrid?.querySelector('.shop-card');
        if (shopsGrid && !hasShops) shopsGrid.style.display = 'none';
        box.innerHTML = `
            <h3 class="search-section-title">Produits (${list.length})</h3>
            <div class="shop-products-grid search-products">
                ${list.map(p => {
                    const photo = productPhotos(p)[0] || '';
                    const id = escapeHtml(p.id);
                    return `
                    <div class="product-card" role="button" tabindex="0" style="border-radius:14px;"
                         onclick="openProductDetail('${id}')" onkeydown="if(event.key==='Enter')openProductDetail('${id}')">
                        <div class="product-card-img">
                            ${photo ? `<img src="${photo}" alt="${escapeHtml(p.name)}" loading="lazy">` : '<i class="fas fa-image"></i>'}
                        </div>
                        <div class="product-card-body">
                            <div class="product-card-name">${escapeHtml(p.name)}</div>
                            <div class="product-card-price" style="color:var(--primary);">${productPriceLabel(p)}</div>
                            <a class="product-card-shop" href="#" onclick="event.stopPropagation();viewShopDetail('${escapeHtml(p.shop_id)}');return false;">
                                <i class="fas fa-store"></i> ${escapeHtml(p.shops?.name || 'Voir la boutique')}
                            </a>
                        </div>
                    </div>`;
                }).join('')}
            </div>
            ${currentSearchType === 'all' && hasShops ? '<h3 class="search-section-title">Boutiques</h3>' : ''}`;
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
                prodGap: safeNum(ds.prod_gap, 16, 8, 40),
                carouselHeight: safeNum(ds.carousel_height, 300, 150, 500),
                carouselRadius: safeNum(ds.carousel_radius, 12, 0, 40),
                carouselSpeed: safeNum(ds.carousel_speed, 0, 0, 30)
            };
            // Carrousel : uniquement des images ou vidéos dont l'adresse est sûre
            const carouselItems = (Array.isArray(ds.carousel_media) ? ds.carousel_media : [])
                .map(m => ({ type: m?.type === 'video' ? 'video' : 'image', src: safeMediaUrl(m?.src, m?.type) }))
                .filter(m => m.src)
                .slice(0, 6);
            const d = currentShopDesign;
            currentShopName = shop.name || '';
            (products || []).forEach(p => { p.shop_name = shop.name; });
 
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
 
                    ${carouselItems.length ? `
                        <div class="shop-carousel" id="shopCarousel"
                             style="--carousel-h:${d.carouselHeight}px;border-radius:${d.carouselRadius}px;">
                            <div class="shop-carousel-track">
                                ${carouselItems.map((m, i) => `
                                    <div class="shop-carousel-slide ${i === 0 ? 'active' : ''}">
                                        ${m.type === 'video'
                                            ? `<video src="${m.src}" muted loop playsinline ${i === 0 ? 'autoplay' : ''} preload="metadata"></video>`
                                            : `<img src="${m.src}" alt="" ${i === 0 ? '' : 'loading="lazy"'}>`}
                                    </div>`).join('')}
                            </div>
                            ${carouselItems.length > 1 ? `
                                <button class="shop-carousel-nav prev" onclick="moveCarousel(-1)" aria-label="Précédent">‹</button>
                                <button class="shop-carousel-nav next" onclick="moveCarousel(1)" aria-label="Suivant">›</button>
                                <div class="shop-carousel-dots">
                                    ${carouselItems.map((_, i) => `<button class="${i === 0 ? 'active' : ''}" onclick="goCarousel(${i})" aria-label="Image ${i + 1}"></button>`).join('')}
                                </div>` : ''}
                        </div>` : ''}
 
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
            startCarousel(carouselItems.length, d.carouselSpeed);
            window.scrollTo(0, 0);
        } catch (error) {
            console.error('❌ Erreur boutique:', error);
            alert('Erreur chargement boutique');
        }
    }
 
    // ============ CARROUSEL DE LA BOUTIQUE ============
    let carouselIndex = 0;
    let carouselCount = 0;
    let carouselTimer = null;
    let carouselDelay = 0;
 
    // Images : https ou data:image ; vidéos : https ou data:video
    function safeMediaUrl(src, type) {
        const u = String(src || '');
        if (type === 'video') return /^(https:\/\/|data:video\/(mp4|webm|quicktime);base64,)/i.test(u) ? u : '';
        return safeUrl(u);
    }
 
    function goCarousel(i) {
        const box = document.getElementById('shopCarousel');
        if (!box || !carouselCount) return;
        carouselIndex = (i + carouselCount) % carouselCount;
        box.querySelectorAll('.shop-carousel-slide').forEach((slide, n) => {
            const on = n === carouselIndex;
            slide.classList.toggle('active', on);
            const video = slide.querySelector('video');
            if (video) { if (on) video.play().catch(() => {}); else video.pause(); }
        });
        box.querySelectorAll('.shop-carousel-dots button').forEach((dot, n) => dot.classList.toggle('active', n === carouselIndex));
        restartCarouselTimer();
    }
 
    function moveCarousel(step) {
        goCarousel(carouselIndex + step);
    }
 
    function restartCarouselTimer() {
        clearInterval(carouselTimer);
        if (carouselDelay > 0 && carouselCount > 1) {
            carouselTimer = setInterval(() => {
                if (!document.getElementById('shopCarousel')) { clearInterval(carouselTimer); return; }
                goCarousel(carouselIndex + 1);
            }, carouselDelay * 1000);
        }
    }
 
    function startCarousel(count, speedSeconds) {
        carouselIndex = 0;
        carouselCount = count;
        carouselDelay = speedSeconds;
        restartCarouselTimer();
        // Glisser du doigt sur téléphone
        const box = document.getElementById('shopCarousel');
        if (!box || count < 2) return;
        let startX = null;
        box.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
        box.addEventListener('touchend', e => {
            if (startX === null) return;
            const dx = e.changedTouches[0].clientX - startX;
            if (Math.abs(dx) > 40) moveCarousel(dx < 0 ? 1 : -1);
            startX = null;
        });
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
        grid.className = 'shop-products-grid' + (isList ? ' is-list' : '');
        grid.style.cssText = isList
            ? `display:flex;flex-direction:column;gap:${d.prodGap}px;`
            : `display:grid;grid-template-columns:repeat(auto-fill,minmax(min(${d.prodWidth}px,100%),1fr));gap:${d.prodGap}px;`;
 
        grid.innerHTML = list.map(p => {
            const photo = productPhotos(p)[0] || '';
            const versions = productVariants(p);
            const id = escapeHtml(p.id);
            return `
            <div class="product-card ${isList ? 'is-list' : ''}" role="button" tabindex="0"
                 onclick="openProductDetail('${id}')" onkeydown="if(event.key==='Enter')openProductDetail('${id}')"
                 style="border-radius:${d.prodRadius}px;">
                <div class="product-card-img" style="${isList ? '' : `height:${d.prodImgHeight}px;`}">
                    ${photo ? `<img src="${photo}" alt="${escapeHtml(p.name)}" loading="lazy">`
                            : '<i class="fas fa-image"></i>'}
                    ${versions.length ? `<span class="product-card-tag">${versions.length} versions</span>` : ''}
                </div>
                <div class="product-card-body">
                    <div class="product-card-name" style="color:${d.productText};">${escapeHtml(p.name)}</div>
                    <div class="product-card-price" style="color:${d.primary};">${productPriceLabel(p)}</div>
                    ${productStock(p) <= 0 ? '<div class="product-card-out">Rupture de stock</div>' : ''}
                    <button class="product-card-btn" style="background:${d.button};"
                            onclick="event.stopPropagation();${versions.length ? `openProductDetail('${id}')` : `addToCart('${id}')`}">
                        ${versions.length ? 'Choisir' : 'Ajouter'}
                    </button>
                </div>
            </div>`;
        }).join('');
    }
 
    // ============ FICHE PRODUIT ============
    // Versions enregistrées par le shop-designer : products.variants = { options, items }
    function productVariants(p) {
        return Array.isArray(p?.variants?.items) ? p.variants.items.filter(v => v && v.key) : [];
    }
 
    function productOptions(p) {
        return Array.isArray(p?.variants?.options) ? p.variants.options.filter(o => o?.name && o.values?.length) : [];
    }
 
    // Photos du produit, puis une photo par version
    function productPhotos(p) {
        const own = Array.isArray(p?.photos) ? p.photos : [];
        const fromVersions = productVariants(p).flatMap(v => Array.isArray(v.photos) ? v.photos : []);
        return [...new Set([...own, ...fromVersions].map(safeUrl).filter(Boolean))];
    }
 
    function productStock(p) {
        const versions = productVariants(p);
        return versions.length ? versions.reduce((s, v) => s + (Number(v.stock) || 0), 0) : Number(p?.stock) || 0;
    }
 
    function productPriceLabel(p) {
        const prices = productVariants(p).map(v => Number(v.price)).filter(n => n > 0);
        if (!prices.length) return `${formatPrice(p.price)} FCFA`;
        const min = Math.min(...prices), max = Math.max(...prices);
        return `${min !== max ? 'dès ' : ''}${formatPrice(min)} FCFA`;
    }
 
    function foodInfoHtml(food) {
        if (!food || typeof food !== 'object') return '';
        const storage = { ambiant: 'Température ambiante', frais: 'Au frais (réfrigérateur)', congele: 'Congelé' }[food.storage];
        const rows = [];
        if (food.homemade) {
            rows.push(['Fabrication', `Fait maison${food.made_to_order ? ', préparé à la commande' : ''}`]);
            if (food.shelf_life_days) rows.push(['Se conserve', `${Number(food.shelf_life_days)} jour(s)${food.made_to_order ? ' après préparation' : ''}`]);
        } else if (food.expiry_date) {
            const [y, m, d] = String(food.expiry_date).split('-');
            rows.push([food.expiry_type === 'ddm' ? 'À consommer de préférence avant' : 'À consommer jusqu\'au', `${d}/${m}/${y}`]);
        }
        if (storage) rows.push(['Conservation', storage]);
        if (food.weight) rows.push(['Poids / volume', food.weight]);
        if (food.origin) rows.push(['Origine', food.origin]);
        if (food.ingredients) rows.push(['Ingrédients', food.ingredients]);
        if (food.allergens) rows.push(['Allergènes', food.allergens]);
        if (!rows.length) return '';
        return `
            <div class="pd-section">
                <h4><i class="fas fa-utensils"></i> Informations alimentaires</h4>
                <dl class="pd-food">${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
            </div>`;
    }
 
    let detailProduct = null;      // produit affiché dans la fiche
    let detailSelection = {};      // { Couleur: 'Noir', Capacité: '128 Go' }
    let detailQty = 1;
 
    function selectedVariant() {
        const options = productOptions(detailProduct);
        if (!options.length || options.some(o => !detailSelection[o.name])) return null;
        return productVariants(detailProduct).find(v =>
            options.every(o => v.values?.[o.name] === detailSelection[o.name])) || null;
    }
 
    function openProductDetail(productId) {
        const p = productsCache[productId];
        if (!p) return;
        detailProduct = p;
        detailQty = 1;
        detailSelection = {};
        // Une seule valeur possible pour une option : sélection automatique
        productOptions(p).forEach(o => { if (o.values.length === 1) detailSelection[o.name] = o.values[0]; });
        const modal = openModal('<div id="productDetail"></div>');
        modal.classList.add('product-modal');
        renderProductDetail();
    }
 
    function renderProductDetail(activePhoto) {
        const p = detailProduct;
        const box = document.getElementById('productDetail');
        if (!p || !box) return;
        const d = (document.getElementById('shopProductsGrid') && currentShopDesign) || { primary: '#1e40af', button: '#1e40af' };
        const options = productOptions(p);
        const variant = selectedVariant();
        const complete = !options.length || !!variant;
 
        // Photos : celles de la version choisie d'abord
        const variantPhotos = (variant?.photos || []).map(safeUrl).filter(Boolean);
        const photos = variantPhotos.length ? [...new Set([...variantPhotos, ...productPhotos(p)])] : productPhotos(p);
        const main = activePhoto && photos.includes(activePhoto) ? activePhoto : photos[0];
 
        const price = variant ? Number(variant.price) : (options.length ? null : Number(p.price));
        const stock = variant ? Number(variant.stock) || 0 : (options.length ? null : Number(p.stock) || 0);
        if (stock !== null && detailQty > Math.max(stock, 1)) detailQty = Math.max(stock, 1);
 
        // Une valeur est grisée si aucune version en stock ne la combine avec les choix déjà faits
        const isAvailable = (optName, value) => productVariants(p).some(v =>
            v.values?.[optName] === value && Number(v.stock) > 0 &&
            options.every(o => o.name === optName || !detailSelection[o.name] || v.values?.[o.name] === detailSelection[o.name]));
 
        box.innerHTML = `
            <div class="pd-layout">
                <div class="pd-gallery">
                    <div class="pd-main-photo">
                        ${main ? `<img src="${main}" alt="${escapeHtml(p.name)}">` : '<i class="fas fa-image"></i>'}
                    </div>
                    ${photos.length > 1 ? `
                        <div class="pd-thumbs">
                            ${photos.map(src => `
                                <button class="pd-thumb ${src === main ? 'active' : ''}" onclick="showProductPhoto(this.dataset.src)" data-src="${escapeHtml(src)}">
                                    <img src="${src}" alt="">
                                </button>`).join('')}
                        </div>` : ''}
                </div>
                <div class="pd-info">
                    <h3 class="pd-name">${escapeHtml(p.name)}</h3>
                    <div class="pd-price" style="color:${d.primary};">
                        ${price !== null ? `${formatPrice(price)} FCFA` : productPriceLabel(p)}
                    </div>
                    ${variant ? `<div class="pd-variant-label">${escapeHtml(variant.key)}</div>` : ''}
                    <div class="pd-stock ${stock === 0 ? 'out' : ''}">
                        ${stock === null ? '' : stock > 0 ? `<i class="fas fa-check-circle"></i> En stock (${stock})` : '<i class="fas fa-times-circle"></i> Rupture de stock'}
                    </div>
 
                    ${options.map(o => `
                        <div class="pd-option">
                            <div class="pd-option-name">${escapeHtml(o.name)} : <strong>${escapeHtml(detailSelection[o.name] || 'à choisir')}</strong></div>
                            <div class="pd-chips">
                                ${o.values.map(v => {
                                    const selected = detailSelection[o.name] === v;
                                    const available = isAvailable(o.name, v);
                                    return `<button class="pd-chip ${selected ? 'selected' : ''} ${available ? '' : 'unavailable'}"
                                                    style="${selected ? `border-color:${d.primary};color:${d.primary};` : ''}"
                                                    data-opt="${escapeHtml(o.name)}" data-val="${escapeHtml(v)}"
                                                    onclick="selectProductOption(this.dataset.opt, this.dataset.val)">${escapeHtml(v)}</button>`;
                                }).join('')}
                            </div>
                        </div>`).join('')}
 
                    <div class="pd-buy">
                        <div class="pd-qty">
                            <button onclick="changeDetailQty(-1)" aria-label="Moins">−</button>
                            <span>${detailQty}</span>
                            <button onclick="changeDetailQty(1)" aria-label="Plus">+</button>
                        </div>
                        <button class="pd-add" style="background:${d.button};"
                                ${complete && stock !== 0 ? '' : 'disabled'} onclick="addDetailToCart()">
                            <i class="fas fa-shopping-cart"></i>
                            ${!complete ? `Choisissez ${escapeHtml(options.filter(o => !detailSelection[o.name]).map(o => o.name.toLowerCase()).join(' et '))}`
                                        : stock === 0 ? 'Indisponible' : 'Ajouter au panier'}
                        </button>
                    </div>
 
                    ${p.description ? `
                        <div class="pd-section">
                            <h4>Description</h4>
                            <p class="pd-desc">${escapeHtml(p.description)}</p>
                        </div>` : ''}
                    ${foodInfoHtml(p.food_info)}
                </div>
            </div>`;
    }
 
    function showProductPhoto(src) {
        renderProductDetail(src);
    }
 
    function selectProductOption(name, value) {
        if (detailSelection[name] === value) delete detailSelection[name];
        else detailSelection[name] = value;
        detailQty = 1;
        renderProductDetail();
    }
 
    function changeDetailQty(delta) {
        const variant = selectedVariant();
        const max = variant ? Number(variant.stock) || 0 : (productOptions(detailProduct).length ? 99 : Number(detailProduct?.stock) || 0);
        detailQty = Math.min(Math.max(1, detailQty + delta), Math.max(max, 1));
        renderProductDetail(document.querySelector('.pd-main-photo img')?.getAttribute('src'));
    }
 
    function addDetailToCart() {
        const p = detailProduct;
        if (!p) return;
        const variant = selectedVariant();
        if (productOptions(p).length && !variant) return;
        if (addToCart(p.id, variant?.key || null, detailQty)) closeModal();
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
 
    // Ajoute un produit (ou une de ses versions) au panier. Renvoie true si c'est fait.
    function addToCart(productId, variantKey = null, quantity = 1) {
        if (!currentUser) {
            alert('Connecte-toi pour ajouter au panier');
            openLoginModal();
            return false;
        }
 
        const p = productsCache[productId];
        if (!p) {
            alert('Produit introuvable');
            return false;
        }
 
        // Produit à versions : il faut en choisir une dans la fiche
        const variants = productVariants(p);
        if (variants.length && !variantKey) {
            openProductDetail(productId);
            return false;
        }
        const variant = variantKey ? variants.find(v => v.key === variantKey) : null;
        if (variantKey && !variant) {
            alert('Version introuvable');
            return false;
        }
 
        const stock = variant ? Number(variant.stock) || 0 : Number(p.stock) || 0;
        const existing = cart.find(i => i.productId === p.id && (i.variantKey || null) === (variantKey || null));
        const already = existing ? existing.quantity : 0;
        if (stock > 0 && already + quantity > stock) {
            alert(`Stock insuffisant : ${stock} disponible(s)${already ? `, dont ${already} déjà dans ton panier` : ''}.`);
            return false;
        }
 
        if (existing) {
            existing.quantity += quantity;
        } else {
            cart.push({
                productId: p.id,
                productName: p.name,
                variantKey: variantKey || null,
                price: Number(variant ? variant.price : p.price) || 0,
                photo: (variant?.photos?.[0] && safeUrl(variant.photos[0])) || productPhotos(p)[0] || '',
                quantity,
                shopId: p.shop_id,
                shopName: p.shop_name || p.shops?.name || ''
            });
        }
        saveCart();
        showToast(`${p.name}${variantKey ? ` (${variantKey})` : ''} ajouté au panier`);
        return true;
    }
 
    function showToast(message) {
        document.querySelector('.toast-msg')?.remove();
        const t = document.createElement('div');
        t.className = 'toast-msg';
        t.textContent = message;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 2500);
    }
 
    function cartItemHtml(item, idx) {
        return `
            <div class="cart-item">
                <div class="cart-item-img">${item.photo ? `<img src="${safeUrl(item.photo)}" alt="">` : '<i class="fas fa-box"></i>'}</div>
                <div class="cart-item-info">
                    <div class="cart-item-name">${escapeHtml(item.productName)}</div>
                    ${item.variantKey ? `<div class="cart-item-variant">${escapeHtml(item.variantKey)}</div>` : ''}
                    <div class="cart-item-price">${formatPrice(item.price)} FCFA</div>
                </div>
                <div class="cart-item-actions">
                    <div class="pd-qty small">
                        <button onclick="changeCartQty(${idx}, -1)" aria-label="Moins">−</button>
                        <span>${item.quantity}</span>
                        <button onclick="changeCartQty(${idx}, 1)" aria-label="Plus">+</button>
                    </div>
                    <button class="cart-item-remove" onclick="removeCartItem(${idx})" aria-label="Retirer"><i class="fas fa-trash"></i> Retirer</button>
                </div>
            </div>`;
    }
 
    function showCart() {
        const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
        const html = cart.length === 0 ? `
            <h3 style="margin-bottom:12px;">Mon panier</h3>
            <div class="cart-empty"><i class="fas fa-shopping-basket"></i><p>Ton panier est vide.</p></div>` : `
            <h3 style="margin-bottom:12px;">Mon panier (${cartTotalQty()})</h3>
            <div class="cart-list">${cart.map(cartItemHtml).join('')}</div>
            <div class="cart-total"><span>Total</span><strong>${formatPrice(total)} FCFA</strong></div>
            <p class="cart-note"><i class="fas fa-info-circle"></i> Frais de livraison (10 %) ajoutés à l'étape suivante.</p>
            <a class="btn-submit cart-checkout" href="checkout.html"><i class="fas fa-lock"></i> Valider ma commande</a>`;
        const existing = document.getElementById('cartModalBody');
        if (existing) existing.innerHTML = html;
        else openModal(`<div id="cartModalBody">${html}</div>`);
    }
 
    function changeCartQty(idx, delta) {
        const item = cart[idx];
        if (!item) return;
        const p = productsCache[item.productId];
        const variant = item.variantKey ? productVariants(p).find(v => v.key === item.variantKey) : null;
        const stock = p ? (variant ? Number(variant.stock) || 0 : Number(p.stock) || 0) : 0;
        if (delta > 0 && stock > 0 && item.quantity + delta > stock) {
            showToast(`Stock maximum atteint (${stock})`);
            return;
        }
        item.quantity += delta;
        if (item.quantity <= 0) cart.splice(idx, 1);
        saveCart();
        showCart();
    }
 
    function removeCartItem(idx) {
        cart.splice(idx, 1);
        saveCart();
        showCart();
    }
 
    // ============ MODALES ============
    // Une fenêtre « locked » (finalisation de l'inscription) reste ouverte : les autres
    // fenêtres s'ouvrent par-dessus et elle réapparaît quand on les ferme.
    function closeModal(force) {
        document.querySelectorAll('.modal.active').forEach(m => { if (force || !m.dataset.locked) m.remove(); });
    }
 
    function openModal(innerHtml, options = {}) {
        closeModal();
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-card">
                ${options.locked ? '' : '<button class="modal-close" onclick="this.closest(\'.modal\').remove()">&times;</button>'}
                ${innerHtml}
            </div>`;
        if (options.locked) modal.dataset.locked = '1';
        else modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);
        return modal;
    }
 
    function openLoginModal() {
        const modal = openModal(`
            <h3 style="margin-bottom:16px;">Connexion</h3>
            ${socialButtonsHtml('Continuer')}
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
 
        modal.classList.add('auth-modal');
        modal.querySelector('#loginPassword').addEventListener('keydown', e => {
            if (e.key === 'Enter') doLogin();
        });
        modal.querySelector('#loginEmail').focus();
    }
 
    function socialButtonsHtml(label) {
        return `
            <div class="social-auth">
                <button type="button" class="social-btn google" onclick="signInWithProvider('google')">
                    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>
                    ${label} avec Google
                </button>
            </div>
            <div class="auth-divider"><span>ou avec ton email</span></div>`;
    }
 
    function countryFieldsHtml(prefix, current = {}) {
        const cc = COUNTRIES[current.country] ? current.country : 'CG';
        return `
            <div class="form-row-2">
                <div class="form-group">
                    <label>Pays *</label>
                    <select id="${prefix}Country" onchange="onCountryChange('${prefix}')">
                        ${Object.entries(COUNTRIES).map(([code, c]) =>
                            `<option value="${code}" ${code === cc ? 'selected' : ''}>${c.flag} ${c.name}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Ville *</label>
                    <select id="${prefix}City" onchange="onCityChange('${prefix}')">
                        ${cityOptionsHtml(cc, current.city)}
                    </select>
                    <input type="text" id="${prefix}CityOther" placeholder="Nom de ta ville" style="display:none;margin-top:6px;" maxlength="60">
                </div>
            </div>
            <div class="form-group">
                <label>Téléphone (WhatsApp de préférence) *</label>
                <div class="phone-field">
                    <span class="phone-prefix" id="${prefix}Dial">+${COUNTRIES[cc].dial}</span>
                    <input type="tel" id="${prefix}Phone" inputmode="tel" autocomplete="tel-national"
                           placeholder="${COUNTRIES[cc].example}" value="${escapeHtml(current.phone || '')}">
                </div>
            </div>`;
    }
 
    function cityOptionsHtml(cc, selected) {
        return COUNTRIES[cc].cities.map(c => `<option ${c === selected ? 'selected' : ''}>${c}</option>`).join('') +
            '<option value="__other">Autre ville…</option>';
    }
 
    function onCountryChange(prefix) {
        const cc = document.getElementById(prefix + 'Country').value;
        document.getElementById(prefix + 'City').innerHTML = cityOptionsHtml(cc);
        document.getElementById(prefix + 'CityOther').style.display = 'none';
        document.getElementById(prefix + 'Dial').textContent = '+' + COUNTRIES[cc].dial;
        document.getElementById(prefix + 'Phone').placeholder = COUNTRIES[cc].example;
    }
 
    function onCityChange(prefix) {
        const other = document.getElementById(prefix + 'City').value === '__other';
        const input = document.getElementById(prefix + 'CityOther');
        input.style.display = other ? '' : 'none';
        if (other) input.focus();
    }
 
    // Lit pays / ville / téléphone ; renvoie { values } ou { error, field }
    function readCountryFields(prefix) {
        const cc = document.getElementById(prefix + 'Country')?.value || 'CG';
        let city = document.getElementById(prefix + 'City')?.value || '';
        if (city === '__other') city = (document.getElementById(prefix + 'CityOther')?.value || '').trim();
        const phone = normalizePhone(document.getElementById(prefix + 'Phone')?.value, cc);
        if (!city || city.length < 2) return { error: 'Indique ta ville.', field: prefix + 'CityOther' };
        if (!phone) return { error: `Numéro invalide. Exemple pour ${COUNTRIES[cc].name} : +${COUNTRIES[cc].dial} ${COUNTRIES[cc].example}`, field: prefix + 'Phone' };
        return { values: { country: COUNTRIES[cc].name, country_code: cc, city, phone } };
    }
 
    function showFormError(boxId, message, fieldId) {
        const box = document.getElementById(boxId);
        if (box) {
            box.textContent = message;
            box.style.display = message ? 'block' : 'none';
            if (message) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        if (fieldId) document.getElementById(fieldId)?.focus();
    }
 
    function togglePassword(id, btn) {
        const input = document.getElementById(id);
        if (!input) return;
        input.type = input.type === 'password' ? 'text' : 'password';
        btn.innerHTML = input.type === 'password' ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
    }
 
    function updatePasswordMeter() {
        const pw = document.getElementById('signupPassword')?.value || '';
        const meter = document.getElementById('pwMeter');
        if (!meter) return;
        const score = pw ? passwordScore(pw) : 0;
        const labels = ['Trop faible', 'Faible', 'Moyen', 'Bon', 'Solide'];
        meter.dataset.score = pw ? score : '';
        meter.querySelector('span').textContent = pw ? labels[score] : '8 caractères minimum, avec lettres et chiffres';
    }
 
    function openRegisterModal() {
        const modal = openModal(`
            <h3 style="margin-bottom:6px;">Créer un compte</h3>
            <p class="auth-sub">Ouenze, la marketplace du Congo-Brazzaville et de la RDC.</p>
            ${socialButtonsHtml("S'inscrire")}
            <form id="signupForm" onsubmit="event.preventDefault();doSignUp();" novalidate>
                <div class="form-group">
                    <label>Nom complet *</label>
                    <input type="text" id="signupName" placeholder="Ex : Grâce Mabiala" autocomplete="name" maxlength="60">
                </div>
                <div class="form-group">
                    <label>Email *</label>
                    <input type="email" id="signupEmail" placeholder="exemple@email.com" autocomplete="email" maxlength="120">
                </div>
                ${countryFieldsHtml('signup')}
                <div class="form-group">
                    <label>Je veux *</label>
                    <div class="account-types">
                        <label><input type="radio" name="signupType" value="client" checked><span><i class="fas fa-shopping-bag"></i> Acheter</span></label>
                        <label><input type="radio" name="signupType" value="vendeur"><span><i class="fas fa-store"></i> Vendre</span></label>
                    </div>
                    <p class="auth-note">Tu veux livrer ? <a href="delivery-register.html">Deviens livreur partenaire</a> (vérification du permis et du véhicule).</p>
                </div>
                <div class="form-group">
                    <label>Mot de passe *</label>
                    <div class="password-field">
                        <input type="password" id="signupPassword" autocomplete="new-password" oninput="updatePasswordMeter()" maxlength="72">
                        <button type="button" onclick="togglePassword('signupPassword', this)" aria-label="Afficher le mot de passe"><i class="fas fa-eye"></i></button>
                    </div>
                    <div class="pw-meter" id="pwMeter"><div class="pw-bar"><i></i><i></i><i></i><i></i></div><span>8 caractères minimum, avec lettres et chiffres</span></div>
                </div>
                <div class="form-group">
                    <label>Confirme le mot de passe *</label>
                    <input type="password" id="signupPassword2" autocomplete="new-password" maxlength="72">
                </div>
                <!-- Piège à robots : invisible pour les humains -->
                <input type="text" id="signupWebsite" name="website" tabindex="-1" autocomplete="off" class="hp-field" aria-hidden="true">
                <label class="terms-line">
                    <input type="checkbox" id="signupTerms">
                    <span>J'accepte les conditions d'utilisation et la <a href="privacy.html" target="_blank">politique de confidentialité</a>.</span>
                </label>
                <div class="form-error" id="signupError" role="alert"></div>
                <button type="submit" class="btn-submit" id="signupSubmit">Créer mon compte</button>
            </form>
            <div style="text-align:center;margin-top:12px;font-size:13px;">
                <a href="#" onclick="event.preventDefault();openLoginModal();" style="color:var(--primary);cursor:pointer;">
                    Déjà un compte ? Se connecter
                </a>
            </div>`);
        modal.classList.add('auth-modal');
        modal.querySelector('#signupName').focus();
    }
 
    // ============ CONNEXION GOOGLE / FACEBOOK ============
    const PROVIDER_NAMES = { google: 'Google' };

    // Avant de partir chez Google, on demande à Supabase si le fournisseur est activé :
    // sinon le visiteur atterrirait sur une page d'erreur brute (« Unsupported provider »).
    async function providerEnabled(provider) {
        try {
            const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } });
            if (!res.ok) return null;
            const external = (await res.json()).external || {};
            return external[provider] === true;
        } catch (e) {
            return null;   // inconnu : on tente quand même
        }
    }

    async function signInWithProvider(provider) {
        const name = PROVIDER_NAMES[provider] || provider;
        try {
            if (await providerEnabled(provider) === false) {
                console.error(`❌ OAuth ${provider} désactivé dans Supabase → Authentication → Sign In / Providers`);
                alert(`La connexion avec ${name} n'est pas encore activée sur Ouenze. Utilise ton email pour l'instant.`);
                return;
            }
            const { data, error } = await window.supabase.auth.signInWithOAuth({
                provider,
                options: { redirectTo: window.location.origin + '/', skipBrowserRedirect: true }
            });
            if (error) throw error;
            window.location.assign(data.url);
        } catch (e) {
            console.error('❌ OAuth', provider, e);
            alert(`Connexion avec ${name} impossible pour le moment.\n\nDétail : ${e?.message || e}`);
        }
    }

    // Retour de Google avec une erreur : Supabase la met dans l'adresse (?error=… ou #error=…)
    function handleOAuthReturnError() {
        const params = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const code = params.get('error') || hash.get('error');
        if (!code) return;
        const detail = params.get('error_description') || hash.get('error_description') || code;
        console.error('❌ Retour OAuth :', code, detail);
        let message = 'La connexion avec Google a échoué.';
        if (/access_denied/i.test(code)) message = 'Connexion annulée.';
        else if (/database error saving new user/i.test(detail)) message = 'Ton compte n\'a pas pu être créé (erreur de la base de données). Réessaie avec ton email.';
        alert(`${message}\n\nDétail : ${detail}`);
        ['error', 'error_code', 'error_description'].forEach(k => params.delete(k));
        const q = params.toString();
        history.replaceState(null, '', window.location.pathname + (q ? '?' + q : ''));
    }

    // Compte créé via Google : il manque le pays, la ville, le téléphone et le type de compte
    function needsProfileCompletion(user) {
        const provider = user?.app_metadata?.provider;
        return !!user && provider && provider !== 'email' && !user.user_metadata?.profile_completed;
    }
 
    function openCompleteProfileModal() {
        if (document.querySelector('.modal[data-locked]')) return;
        const meta = currentUser?.user_metadata || {};
        const modal = openModal(`
            <div class="complete-head">
                <span class="complete-badge"><i class="fas fa-check-circle"></i> Connecté avec Google</span>
                <h3>Plus qu'une étape</h3>
                <p class="auth-sub">${escapeHtml(currentUser?.email || '')} — indique ta ville, ton téléphone et ce que tu veux faire sur Ouenze.</p>
            </div>
            <form onsubmit="event.preventDefault();completeProfile();" novalidate>
                <div class="form-group">
                    <label>Nom complet *</label>
                    <input type="text" id="completeName" maxlength="60" value="${escapeHtml(meta.full_name || meta.name || '')}">
                </div>
                ${countryFieldsHtml('complete')}
                <div class="form-group">
                    <label>Je veux *</label>
                    <div class="account-types three">
                        <label><input type="radio" name="completeType" value="client" checked><span><i class="fas fa-shopping-bag"></i> Acheter</span></label>
                        <label><input type="radio" name="completeType" value="vendeur"><span><i class="fas fa-store"></i> Vendre</span></label>
                        <label><input type="radio" name="completeType" value="livreur"><span><i class="fas fa-motorcycle"></i> Livrer</span></label>
                    </div>
                    <p class="auth-note">Vendre : tu crées ta boutique juste après. Livrer : ton permis et ton véhicule seront vérifiés.</p>
                </div>
                <label class="terms-line">
                    <input type="checkbox" id="completeTerms">
                    <span>J'accepte les conditions d'utilisation et la <a href="privacy.html" target="_blank">politique de confidentialité</a>.</span>
                </label>
                <div class="form-error" id="completeError" role="alert"></div>
                <button type="submit" class="btn-submit" id="completeSubmit">Terminer mon inscription</button>
            </form>
            <p class="complete-out">Pas toi ? <button type="button" onclick="logout()">Se déconnecter</button></p>`, { locked: true });
        modal.classList.add('auth-modal');
    }
 
    async function completeProfile() {
        const fullName = (document.getElementById('completeName')?.value || '').trim();
        const choice = document.querySelector('input[name="completeType"]:checked')?.value || 'client';
        // Un livreur reste « client » tant que son dossier (permis, véhicule) n'est pas validé
        const userType = choice === 'vendeur' ? 'vendeur' : 'client';
        if (fullName.length < 2) return showFormError('completeError', 'Indique ton nom complet.', 'completeName');
        const loc = readCountryFields('complete');
        if (loc.error) return showFormError('completeError', loc.error, loc.field);
        if (!document.getElementById('completeTerms')?.checked) return showFormError('completeError', 'Merci d\'accepter les conditions d\'utilisation.');
 
        const btn = document.getElementById('completeSubmit');
        btn.disabled = true;
        btn.textContent = 'Enregistrement…';
        try {
            const data = { full_name: fullName, user_type: userType, ...loc.values, profile_completed: true, wants_delivery: choice === 'livreur' };
            const { error } = await window.supabase.auth.updateUser({ data });
            if (error) throw error;
            // Profil : toutes les colonnes si elles existent, sinon l'essentiel
            let res = await window.supabase.from('profiles')
                .update({ full_name: fullName, user_type: userType, phone: loc.values.phone, city: loc.values.city, country: loc.values.country })
                .eq('id', currentUser.id);
            if (res.error) {
                res = await window.supabase.from('profiles').update({ full_name: fullName, user_type: userType }).eq('id', currentUser.id);
            }
            if (res.error) console.error('❌ Profil:', res.error);
            closeModal(true);
            if (choice === 'vendeur') {
                window.location.href = 'shop-designer.html';
            } else if (choice === 'livreur') {
                window.location.href = 'delivery-register.html';
            } else {
                await initApp();
            }
        } catch (e) {
            console.error('❌ Finalisation:', e);
            showFormError('completeError', 'Enregistrement impossible : ' + (e?.message || 'réessaie dans un instant.'));
            btn.disabled = false;
            btn.textContent = 'Terminer mon inscription';
        }
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
            if (!document.getElementById('appContainer')) {
                const q = input?.value.trim();
                window.location.href = 'index.html' + (q ? '?q=' + encodeURIComponent(q) : '');
                return;
            }
            if (!document.getElementById('shopsGrid')) {
                showHomePage().then(() => performSearch(input?.value));
            } else {
                performSearch(input?.value);
            }
        };
        let typingTimer = null;
        if (input) {
            input.addEventListener('input', () => {
                clearTimeout(typingTimer);
                typingTimer = setTimeout(() => {
                    if (document.getElementById('shopsGrid')) performSearch(input.value);
                }, 300);
            });
            input.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(typingTimer); runSearch(); } });
        }
        if (btn) btn.addEventListener('click', runSearch);
 
        document.querySelectorAll('.search-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                currentSearchType = tab.dataset.type || 'all';
                document.querySelectorAll('.search-tab').forEach(t => t.classList.toggle('active', t === tab));
                input?.focus();
                runSearch();
            });
        });
 
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
 
    // Règles partagées avec les autres pages (inscription livreur)
    window.OuenzeForms = { COUNTRIES, normalizePhone, passwordProblem, passwordScore };
 
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
        signInWithProvider,
        completeProfile,
        onCountryChange,
        onCityChange,
        togglePassword,
        updatePasswordMeter,
        addToCart,
        setSort,
        viewShopDetail,
        filterShopProducts,
        openProductDetail,
        moveCarousel,
        goCarousel,
        showProductPhoto,
        selectProductOption,
        changeDetailQty,
        addDetailToCart,
        changeCartQty,
        removeCartItem
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
 
