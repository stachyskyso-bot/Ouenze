// ============================================================
// APP.JS - VERSION COMPLÈTE SUPABASE
// ============================================================

(function() {
    'use strict';

    // ============ ÉTAT GLOBAL ============
    window.currentUser = null;
    window.currentProfile = null;
    window.currentUserType = null;
    window.shops = [];
    window.orders = [];
    window.cart = JSON.parse(localStorage.getItem('ouenze_cart') || '[]');
    window.selectedPayment = null;

    // ============ UTILITAIRES ============
    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>"]/g, m => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;'
        }[m]));
    }

    function formatPrice(price) {
        return Number(price || 0).toLocaleString();
    }

    function generateStars(rating) {
        let stars = '';
        const full = Math.floor(rating);
        const half = rating % 1 >= 0.5;
        for (let i = 0; i < full; i++) stars += '<i class="fas fa-star"></i>';
        if (half) stars += '<i class="fas fa-star-half-alt"></i>';
        for (let i = 0; i < 5 - Math.ceil(rating); i++) stars += '<i class="far fa-star"></i>';
        return stars;
    }

    function getShopLevel(shop) {
        const rating = shop.rating || 0;
        if (rating >= 4.5) return { level: 'gold', name: 'Or', class: 'level-gold' };
        if (rating >= 4) return { level: 'silver', name: 'Argent', class: 'level-silver' };
        if (rating >= 3) return { level: 'bronze', name: 'Bronze', class: 'level-bronze' };
        return { level: null, name: 'Standard', class: '' };
    }

    function saveCart() {
        localStorage.setItem('ouenze_cart', JSON.stringify(window.cart));
        updateCartCount();
    }

    function updateCartCount() {
        const count = window.cart.reduce((s, i) => s + i.quantity, 0);
        document.querySelectorAll('#cartCountHeader, .cart-count').forEach(el => {
            if (el) el.innerText = count;
        });
    }

    // ============ INITIALISATION ============
    async function initApp() {
        console.log('🚀 Initialisation...');
        
        if (typeof window.getCurrentUser !== 'function') {
            console.error('❌ getCurrentUser non disponible');
            updateHeaderUI();
            showHomePage();
            return;
        }

        try {
            window.currentUser = await window.getCurrentUser();
            
            if (window.currentUser) {
                console.log('👤 Connecté:', window.currentUser.email);
                window.currentProfile = await window.getProfile(window.currentUser.id);
                window.currentUserType = window.currentProfile?.user_type || 'client';
                console.log('📋 Type:', window.currentUserType);
                
                updateHeaderUI();
                await loadUserData();
            } else {
                console.log('👤 Non connecté');
            }
            
            showHomePage();
            
        } catch (error) {
            console.error("❌ Erreur init:", error);
            updateHeaderUI();
            showHomePage();
        }
    }

    async function loadUserData() {
        try {
            if (typeof window.getShops === 'function') {
                window.shops = await window.getShops();
                console.log('🏪 Boutiques:', window.shops.length);
            }
            
            if (window.currentUserType === 'client' && typeof window.getUserOrders === 'function') {
                window.orders = await window.getUserOrders(window.currentUser.id);
                console.log('📦 Commandes:', window.orders.length);
            }
        } catch (error) {
            console.error("❌ Erreur chargement:", error);
        }
    }

    // ============ HEADER ============
    function updateHeaderUI() {
        const container = document.getElementById('headerActions');
        if (!container) return;

        if (window.currentUser && window.currentProfile) {
            const labels = {
                'client': 'Client',
                'vendeur': 'Vendeur',
                'livreur': 'Livreur',
                'admin': 'Admin'
            };

            container.innerHTML = `
                <div class="user-menu" onclick="showProfile()">
                    <div class="user-avatar">
                        ${window.currentProfile.avatar_url 
                            ? '<img src="' + window.currentProfile.avatar_url + '">' 
                            : (window.currentProfile.full_name || 'U').charAt(0)}
                    </div>
                    <div class="user-info">
                        <div>${(window.currentProfile.full_name || 'Utilisateur').split(' ')[0]}</div>
                        <small>${labels[window.currentUserType] || 'Client'}</small>
                    </div>
                    <button onclick="event.stopPropagation();logout()" style="background:none;border:none;cursor:pointer;color:var(--gray-500);">
                        <i class="fas fa-sign-out-alt"></i>
                    </button>
                </div>
                <div class="cart-icon" onclick="showCart()">
                    <i class="fas fa-shopping-cart"></i>
                    <span class="cart-count">${window.cart.reduce((s, i) => s + i.quantity, 0)}</span>
                </div>
            `;
        } else {
            container.innerHTML = `
                <button class="auth-btn" onclick="openLoginModal()">Connexion</button>
                <button class="auth-btn" onclick="openRegisterModal()">Inscription</button>
                <div class="cart-icon" onclick="showCart()">
                    <i class="fas fa-shopping-cart"></i>
                    <span class="cart-count">${window.cart.reduce((s, i) => s + i.quantity, 0)}</span>
                </div>
            `;
        }
    }

    // ============ AUTHENTIFICATION ============
    async function doLogin() {
        console.log('🔍 doLogin...');

        const emailInput = document.getElementById('loginEmail');
        const passwordInput = document.getElementById('loginPassword');

        if (!emailInput || !passwordInput) {
            alert('Formulaire non trouvé');
            return;
        }

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (!email || !password) {
            alert("Email et mot de passe requis");
            return;
        }

        try {
            const { data, error } = await window.supabase.auth.signInWithPassword({ email, password });

            if (error) {
                alert("Email ou mot de passe incorrect");
                return;
            }

            window.currentUser = data.user;
            window.currentProfile = await window.getProfile(data.user.id);
            window.currentUserType = window.currentProfile?.user_type || 'client';

            const modal = document.querySelector('.modal.active');
            if (modal) modal.remove();

            updateHeaderUI();
            await loadUserData();

            alert('Bienvenue ' + (window.currentProfile?.full_name || data.user.email));

            setTimeout(() => {
                switch (window.currentUserType) {
                    case 'vendeur':
                        window.location.href = 'vendor-dashboard.html';
                        break;
                    case 'livreur':
                        window.location.href = 'delivery-dashboard.html';
                        break;
                    default:
                        showHomePage();
                }
            }, 500);

        } catch (e) {
            console.error('❌', e);
            alert("Une erreur est survenue");
        }
    }

    async function doSignUp() {
        console.log('🔍 doSignUp...');

        const email = document.getElementById('signupEmail')?.value.trim();
        const password = document.getElementById('signupPassword')?.value;
        const fullName = document.getElementById('signupName')?.value.trim();
        const userType = document.getElementById('signupType')?.value || 'client';
        const phone = document.getElementById('signupPhone')?.value.trim() || '';
        const city = document.getElementById('signupCity')?.value.trim() || '';

        if (!email || !password || !fullName) {
            alert("Veuillez remplir tous les champs obligatoires");
            return;
        }

        if (password.length < 6) {
            alert("Le mot de passe doit contenir au moins 6 caractères");
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
                alert("Erreur lors de l'inscription: " + error.message);
                return;
            }

            const modal = document.querySelector('.modal.active');
            if (modal) modal.remove();

            if (data.session) {
                alert('Bienvenue ' + fullName + ' !');
                if (userType === 'vendeur') {
                    window.location.href = 'shop-designer.html';
                } else {
                    initApp();
                }
            } else {
                alert('Inscription réussie !\n\nUn email de confirmation a été envoyé à ' + email);
                resetToHome();
            }

        } catch (e) {
            console.error('❌', e);
            alert("Une erreur est survenue");
        }
    }

    async function logout() {
        try {
            await window.supabase.auth.signOut();
            window.currentUser = null;
            window.currentProfile = null;
            window.currentUserType = null;
            window.cart = [];
            localStorage.removeItem('ouenze_cart');
            updateHeaderUI();
            showHomePage();
            alert("Déconnexion réussie");
        } catch (error) {
            console.error("❌", error);
        }
    }

    async function requestPasswordReset() {
        const email = document.getElementById('loginEmail')?.value.trim();

        if (!email) {
            alert("Entre d'abord ton email dans le champ Email.");
            document.getElementById('loginEmail')?.focus();
            return;
        }

        try {
            const redirectUrl = window.location.origin + '/reset-password.html';

            const { error } = await window.supabase.auth.resetPasswordForEmail(email, {
                redirectTo: redirectUrl
            });

            if (error) {
                alert("Impossible d'envoyer l'email de récupération.");
                return;
            }

            alert("Si un compte correspond à cette adresse, un email de réinitialisation vient d'être envoyé.\n\nVérifie également tes spams.");

        } catch (error) {
            console.error('❌', error);
            alert("Une erreur est survenue lors de la demande.");
        }
    }

    // ============ PAGE D'ACCUEIL ============
    async function showHomePage() {
        console.log('🏠 Page d\'accueil...');

        const container = document.getElementById('appContainer');
        if (!container) return;

        container.innerHTML = `
            <div class="ranking-bar">
                <div class="ranking-filters">
                    <button class="sort-btn active" data-sort="rating" onclick="setSort('rating')">
                        <i class="fas fa-sort-down"></i> Par note
                    </button>
                    <button class="sort-btn" data-sort="price" onclick="setSort('price')">
                        <i class="fas fa-sort"></i> Par prix
                    </button>
                    <button class="sort-btn" data-sort="sales" onclick="setSort('sales')">
                        <i class="fas fa-sort"></i> Par ventes
                    </button>
                </div>
                <div>
                    <span class="rating-badge gold"><i class="fas fa-crown"></i> Or</span>
                    <span class="rating-badge silver"><i class="fas fa-star"></i> Argent</span>
                    <span class="rating-badge bronze"><i class="fas fa-star-half-alt"></i> Bronze</span>
                </div>
            </div>
            <div id="shopsGrid" class="shops-grid"></div>
        `;

        await displayShops();
    }

    async function displayShops() {
        const grid = document.getElementById('shopsGrid');
        if (!grid) return;

        try {
            console.log('🏪 Chargement boutiques...');

            const { data: shopsList, error } = await window.supabase
                .from('shops')
                .select('*, products(count)');

            if (error) throw error;

            console.log('📊 Boutiques:', shopsList?.length);

            if (!shopsList || shopsList.length === 0) {
                grid.innerHTML = `
                    <div style="text-align:center;padding:60px;color:var(--gray-500);">
                        <i class="fas fa-store-slash" style="font-size:48px;margin-bottom:16px;"></i>
                        <p>Aucune boutique trouvée</p>
                    </div>`;
                return;
            }

            grid.innerHTML = shopsList.map(shop => {
                const rating = shop.rating || 0;
                const stars = generateStars(rating);
                const productCount = shop.products?.[0]?.count || 0;
                const level = getShopLevel(shop);

                return `
                    <div class="shop-card" onclick="viewShopDetail('${shop.id}')">
                        <div class="shop-logo-area">
                            <div class="shop-logo-img">
                                ${shop.logo_url 
                                    ? '<img src="' + shop.logo_url + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">' 
                                    : '<i class="fas fa-store" style="font-size:28px;"></i>'}
                            </div>
                            <div class="shop-name">${escapeHtml(shop.name)}</div>
                            <div class="shop-rating">
                                <div class="stars">${stars}</div>
                                <span>(${shop.total_ratings || 0})</span>
                            </div>
                            <div style="font-size:11px;color:var(--gray-500);margin-top:4px;">
                                <i class="fas fa-map-marker-alt"></i> ${escapeHtml(shop.city || 'Brazzaville')}
                            </div>
                            <div style="margin-top:6px;">
                                <span class="level-badge ${level.class}">
                                    <i class="fas fa-crown"></i> ${level.name}
                                </span>
                                <span style="font-size:10px;margin-left:6px;">
                                    <i class="fas fa-chart-line"></i> ${shop.total_sales || 0} ventes
                                </span>
                            </div>
                        </div>
                        <div class="shop-details">
                            <div class="shop-metrics">
                                <div class="metric">
                                    <div class="metric-value">${productCount}</div>
                                    <div>Produits</div>
                                </div>
                                <div class="metric">
                                    <div class="metric-value">${shop.total_sales || 0}</div>
                                    <div>Ventes</div>
                                </div>
                            </div>
                            <button class="btn-visit-shop" style="margin-top:10px;width:100%;background:var(--primary);color:white;border:none;padding:6px;border-radius:30px;cursor:pointer;font-size:11px;">
                                <i class="fas fa-eye"></i> Voir la boutique
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

        } catch (error) {
            console.error("❌ Erreur:", error);
            grid.innerHTML = `
                <div style="text-align:center;padding:60px;color:var(--danger);">
                    <i class="fas fa-exclamation-circle" style="font-size:48px;margin-bottom:16px;"></i>
                    <p>Erreur de chargement</p>
                </div>`;
        }
    }

    // ============ VUE BOUTIQUE ============
    async function viewShopDetail(shopId) {
        console.log('🔍 Détail boutique:', shopId);

        try {
            const { data: shop, error: shopError } = await window.supabase
                .from('shops')
                .select('*')
                .eq('id', shopId)
                .single();

            if (shopError) throw shopError;

            const { data: products, error: productsError } = await window.supabase
                .from('products')
                .select('*')
                .eq('shop_id', shopId);

            if (productsError) console.error('❌', productsError);

            const container = document.getElementById('appContainer');
            container.innerHTML = `
                <button onclick="resetToHome()" style="background:none;border:none;color:var(--primary);cursor:pointer;font-size:16px;margin-bottom:20px;">
                    ← Retour
                </button>

                <div style="background:white;border-radius:20px;padding:24px;border:1px solid var(--gray-200);">
                    <div style="display:flex;align-items:center;gap:20px;margin-bottom:20px;">
                        <div style="width:80px;height:80px;background:var(--gray-100);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:32px;">
                            ${shop.logo_url 
                                ? '<img src="' + shop.logo_url + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">' 
                                : '🏪'}
                        </div>
                        <div>
                            <h2 style="font-size:24px;">${escapeHtml(shop.name)}</h2>
                            <p style="color:var(--gray-500);">${escapeHtml(shop.description || '')}</p>
                            <p style="font-size:13px;color:var(--gray-500);">
                                <i class="fas fa-map-marker-alt"></i> ${escapeHtml(shop.city || 'Brazzaville')}
                            </p>
                            <p style="font-size:13px;color:var(--gray-500);">
                                ⭐ ${shop.rating || 0}/5 (${shop.total_ratings || 0} avis)
                            </p>
                        </div>
                    </div>

                    <h3 style="margin:20px 0 12px;">Produits (${products?.length || 0})</h3>
                    ${products && products.length > 0 ? `
                    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;">
                        ${products.map(p => `
                            <div style="background:var(--gray-100);border-radius:12px;padding:12px;text-align:center;">
                                ${p.photos && p.photos[0] 
                                    ? '<img src="' + p.photos[0] + '" style="width:100%;height:120px;object-fit:cover;border-radius:8px;">' 
                                    : '<div style="height:120px;background:#e2e8f0;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#94a3b8;">📦</div>'}
                                <h4 style="margin:8px 0 4px;">${escapeHtml(p.name)}</h4>
                                <p style="font-weight:700;color:var(--primary);">${formatPrice(p.price)} FCFA</p>
                                <button onclick="addToCart('${shop.id}', '${p.id}', '${escapeHtml(p.name)}', ${p.price})" 
                                        style="background:var(--primary);color:white;border:none;padding:6px 16px;border-radius:30px;cursor:pointer;margin-top:8px;">
                                    Ajouter
                                </button>
                            </div>
                        `).join('')}
                    </div>
                    ` : `
                    <div style="text-align:center;padding:40px;color:var(--gray-500);background:var(--gray-100);border-radius:12px;">
                        <p>Aucun produit</p>
                    </div>
                    `}
                </div>
            `;

        } catch (error) {
            console.error('❌ Erreur:', error);
            alert('Erreur chargement boutique');
        }
    }

    // ============ PANIER ============
    function addToCart(shopId, productId, productName, price) {
        if (!window.currentUser) {
            alert("Connectez-vous");
            openLoginModal();
            return;
        }

        const existing = window.cart.find(i => i.productId === productId && i.shopId === shopId);

        if (existing) {
            existing.quantity++;
        } else {
            window.cart.push({
                productId,
                productName,
                price: parseFloat(price),
                quantity: 1,
                shopId
            });
        }

        saveCart();
        alert(productName + ' ajouté au panier');
    }

    function showCart() {
        if (window.cart.length === 0) {
            alert("Panier vide");
            return;
        }
        let msg = "Panier:\n\n";
        window.cart.forEach(i => {
            msg += i.productName + ' x' + i.quantity + ' - ' + formatPrice(i.price * i.quantity) + ' FCFA\n';
        });
        msg += '\nTotal: ' + formatPrice(window.cart.reduce((s, i) => s + i.price * i.quantity, 0)) + ' FCFA';
        alert(msg);
    }

    // ============ PROFIL ============
    function showProfile() {
        if (!window.currentUser) {
            openLoginModal();
            return;
        }
        alert('Profil\n\nNom: ' + (window.currentProfile?.full_name || 'N/A') + '\nEmail: ' + window.currentUser.email + '\nType: ' + window.currentUserType);
    }

    // ============ MODALES ============
    function openLoginModal() {
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-card">
                <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
                <h3 style="margin-bottom:20px;">Connexion</h3>

                <div class="form-group">
                    <label>Email</label>
                    <input type="email" id="loginEmail" placeholder="exemple@email.com" autocomplete="email">
                </div>

                <div class="form-group">
                    <label>Mot de passe</label>
                    <input type="password" id="loginPassword" placeholder="••••••••" autocomplete="current-password">
                </div>

                <div style="text-align:right; margin-top:-4px; margin-bottom:16px;">
                    <button type="button" onclick="requestPasswordReset()"
                        style="background:none;border:none;padding:0;color:var(--primary);cursor:pointer;font-size:13px;">
                        Mot de passe oublié ?
                    </button>
                </div>

                <button class="btn-submit" onclick="doLogin()">
                    <i class="fas fa-sign-in-alt"></i> Se connecter
                </button>

                <div style="text-align:center;margin-top:16px;font-size:13px;">
                    <a href="#" onclick="event.preventDefault(); this.closest('.modal').remove(); openRegisterModal();"
                       style="color:var(--primary);cursor:pointer;">
                        Créer un compte
                    </a>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    function openRegisterModal() {
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-card">
                <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
                <h3 style="margin-bottom:20px;">Inscription</h3>

                <div class="form-group">
                    <label>Nom complet *</label>
                    <input type="text" id="signupName" placeholder="Jean Dupont">
                </div>

                <div class="form-group">
                    <label>Email *</label>
                    <input type="email" id="signupEmail" placeholder="exemple@email.com">
                </div>

                <div class="form-group">
                    <label>Mot de passe *</label>
                    <input type="password" id="signupPassword" placeholder="Min 6 caractères">
                </div>

                <div class="form-group">
                    <label>Téléphone</label>
                    <input type="tel" id="signupPhone" placeholder="+242 06 XX XX XX">
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

                <button class="btn-submit" onclick="doSignUp()">
                    <i class="fas fa-user-plus"></i> S'inscrire
                </button>

                <div style="text-align:center;margin-top:12px;font-size:13px;">
                    <a href="#" onclick="this.closest('.modal').remove();openLoginModal()" 
                       style="color:var(--primary);cursor:pointer;">
                        Déjà un compte ? Se connecter
                    </a>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // ============ NAVIGATION ============
    function resetToHome() {
        showHomePage();
    }

    function setSort(sort) {
        console.log("Tri par:", sort);
    }

    // ============ EXPORTS ============
    window.initApp = initApp;
    window.doLogin = doLogin;
    window.doSignUp = doSignUp;
    window.logout = logout;
    window.requestPasswordReset = requestPasswordReset;
    window.showHomePage = showHomePage;
    window.resetToHome = resetToHome;
    window.showCart = showCart;
    window.showProfile = showProfile;
    window.openLoginModal = openLoginModal;
    window.openRegisterModal = openRegisterModal;
    window.addToCart = addToCart;
    window.setSort = setSort;
    window.viewShopDetail = viewShopDetail;

    // ============ DÉMARRAGE ============
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }

    console.log('✅ app.js chargé');

})();
