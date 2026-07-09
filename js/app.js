// ============================================================
// APP.JS - VERSION COMPLÈTE ET CORRIGÉE
// ============================================================

// ============================================================
// EMPÊCHER LE DOUBLE CHARGEMENT
// ============================================================
if (window.__APP_LOADED__) {
    console.warn('⚠️ app.js déjà chargé, abandon');
} else {
    window.__APP_LOADED__ = true;

    // ============================================================
    // VARIABLES GLOBALES
    // ============================================================
    let currentUser = null;
    let currentProfile = null;
    let currentUserType = null; // 'client', 'vendeur', 'livreur', 'admin'
    let shops = [];
    let orders = [];
    let cart = JSON.parse(localStorage.getItem('ouenze_cart') || '[]');
    let selectedPayment = null;

    // ============================================================
    // INITIALISATION
    // ============================================================

    async function initApp() {
        console.log('🚀 Initialisation de l\'application...');
        
        try {
            // Récupérer l'utilisateur connecté
            currentUser = await getCurrentUser();
            
            if (currentUser) {
                console.log('👤 Utilisateur connecté:', currentUser.email);
                currentProfile = await getProfile(currentUser.id);
                currentUserType = currentProfile?.user_type || 'client';
                console.log('📋 Profil:', currentProfile);
                
                // Mettre à jour l'interface
                updateHeaderUI();
                
                // Charger les données selon le type
                await loadUserData();
            } else {
                console.log('👤 Aucun utilisateur connecté');
            }
            
            // Afficher la page d'accueil
            showHomePage();
            
        } catch (error) {
            console.error("❌ Erreur d'initialisation:", error);
            showHomePage();
        }
    }

    async function loadUserData() {
        try {
            // Charger les boutiques
            shops = await getShops();
            console.log('🏪 Boutiques chargées:', shops.length);
            
            // Charger les commandes si client
            if (currentUserType === 'client') {
                orders = await getUserOrders(currentUser.id);
                console.log('📦 Commandes chargées:', orders.length);
            }
        } catch (error) {
            console.error("❌ Erreur de chargement des données:", error);
        }
    }

    // ============================================================
    // AUTHENTIFICATION - VERSION CORRIGÉE
    // ============================================================

    async function doLogin() {
        console.log('🔍 doLogin appelée !');
        
        // 1. Récupérer les valeurs du formulaire
        const emailInput = document.getElementById('loginEmail');
        const passwordInput = document.getElementById('loginPassword');
        
        if (!emailInput || !passwordInput) {
            console.error('❌ Champs de connexion introuvables !');
            alert('Erreur technique : formulaire de connexion non trouvé.');
            return;
        }
        
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        
        console.log('📧 Email saisi:', email);
        console.log('🔑 Mot de passe saisi:', password ? '✅ Rempli' : '❌ Vide');
        
        // 2. Validation des champs
        if (!email) {
            alert("Veuillez entrer votre email.");
            return;
        }
        if (!password) {
            alert("Veuillez entrer votre mot de passe.");
            return;
        }
        
        try {
            // 3. Connexion DIRECTE avec Supabase
            console.log('🔐 Tentative de connexion...');
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email,
                password: password
            });
            
            if (error) {
                console.error('❌ Erreur Supabase:', error.message);
                alert("Email ou mot de passe incorrect");
                return;
            }
            
            const user = data.user;
            console.log('✅ Connexion réussie !');
            console.log('👤 Utilisateur:', user.email);
            
            // 4. Mettre à jour l'état global
            currentUser = user;
            currentProfile = await getProfile(user.id);
            currentUserType = currentProfile?.user_type || 'client';
            
            // 5. Mettre à jour l'interface
            updateHeaderUI();
            
            // 6. Fermer la modale et recharger
            const modal = document.querySelector('.modal.active');
            if (modal) modal.remove();
            
            await loadUserData();
            showHomePage();
            
            alert(`Bienvenue ${currentProfile?.full_name || user.email}`);
            
        } catch (error) {
            console.error('❌ Erreur inattendue:', error);
            alert("Une erreur est survenue. Veuillez réessayer.");
        }
    }

    async function doSignUp() {
        console.log('🔍 doSignUp appelée !');
        
        const email = document.getElementById('signupEmail').value.trim();
        const password = document.getElementById('signupPassword').value;
        const fullName = document.getElementById('signupName').value.trim();
        const userType = document.getElementById('signupType').value;
        const phone = document.getElementById('signupPhone').value.trim();
        const city = document.getElementById('signupCity').value.trim();
        
        if (!email || !password || !fullName) {
            alert("Veuillez remplir tous les champs obligatoires");
            return;
        }
        
        if (password.length < 6) {
            alert("Le mot de passe doit contenir au moins 6 caractères");
            return;
        }
        
        try {
            console.log('🔐 Tentative d\'inscription...');
            const { data, error } = await supabase.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: {
                        full_name: fullName,
                        user_type: userType,
                        phone: phone || '',
                        city: city || 'Brazzaville',
                        country: 'Congo-Brazzaville'
                    }
                }
            });
            
            if (error) {
                console.error('❌ Erreur inscription:', error.message);
                alert("Erreur lors de l'inscription: " + error.message);
                return;
            }
            
            console.log('✅ Inscription réussie !');
            alert(`Inscription réussie ! Bienvenue ${fullName}`);
            
            // Fermer la modale
            const modal = document.querySelector('.modal.active');
            if (modal) modal.remove();
            
            // Rediriger vers la bonne page selon le type
            if (userType === 'vendeur') {
                alert("Redirection vers le créateur de boutique...");
                window.location.href = 'shop-designer.html';
            } else {
                initApp();
            }
            
        } catch (error) {
            console.error('❌ Erreur inattendue:', error);
            alert("Une erreur est survenue. Veuillez réessayer.");
        }
    }

    async function logout() {
        console.log('🔍 logout appelée !');
        
        try {
            await supabase.auth.signOut();
            currentUser = null;
            currentProfile = null;
            currentUserType = null;
            cart = [];
            localStorage.removeItem('ouenze_cart');
            updateHeaderUI();
            showHomePage();
            alert("Déconnexion réussie");
        } catch (error) {
            console.error("❌ Erreur de déconnexion:", error);
            alert("Erreur lors de la déconnexion");
        }
    }

    // ============================================================
    // AFFICHAGE
    // ============================================================

    function updateHeaderUI() {
        const container = document.getElementById('headerActions');
        if (!container) return;
        
        if (currentUser && currentProfile) {
            const userTypeLabels = {
                'client': 'Client',
                'vendeur': 'Vendeur',
                'livreur': 'Livreur',
                'admin': 'Admin'
            };
            
            container.innerHTML = `
                <div class="user-menu" onclick="showProfile()">
                    <div class="user-avatar">
                        ${currentProfile.avatar_url ? `<img src="${currentProfile.avatar_url}">` : currentProfile.full_name?.charAt(0) || 'U'}
                    </div>
                    <div class="user-info">
                        <div>${currentProfile.full_name?.split(' ')[0] || 'Utilisateur'}</div>
                        <small>${userTypeLabels[currentUserType] || 'Client'}</small>
                    </div>
                    <button onclick="event.stopPropagation();logout()" style="background:none;border:none;cursor:pointer;color:var(--gray-500);">
                        <i class="fas fa-sign-out-alt"></i>
                    </button>
                </div>
                <div class="cart-icon" onclick="showCart()">
                    <i class="fas fa-shopping-cart"></i>
                    <span class="cart-count">${cart.reduce((s, i) => s + i.quantity, 0)}</span>
                </div>
            `;
        } else {
            container.innerHTML = `
                <button class="auth-btn" onclick="openLoginModal()">Connexion</button>
                <button class="auth-btn" onclick="openRegisterModal()">Inscription</button>
                <div class="cart-icon" onclick="showCart()">
                    <i class="fas fa-shopping-cart"></i>
                    <span class="cart-count">${cart.reduce((s, i) => s + i.quantity, 0)}</span>
                </div>
            `;
        }
    }

    // ============================================================
    // PAGE D'ACCUEIL
    // ============================================================

    async function showHomePage() {
        console.log('🏠 Affichage de la page d\'accueil...');
        
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
    if (!grid) {
        console.error('❌ shopsGrid non trouvé');
        return;
    }
    
    try {
        console.log('🏪 Chargement des boutiques...');
        
        // 🔥 TEST DIRECT : Récupérer les boutiques de Supabase
        const { data: shopsList, error } = await supabase
            .from('shops')
            .select('*');
        
        if (error) {
            console.error('❌ Erreur Supabase:', error);
            return;
        }
        
        console.log('📊 Boutiques récupérées:', shopsList);
        
        if (!shopsList || shopsList.length === 0) {
            grid.innerHTML = `
                <div style="text-align:center;padding:60px;color:var(--gray-500);">
                    <i class="fas fa-store-slash" style="font-size:48px;margin-bottom:16px;"></i>
                    <p>Aucune boutique trouvée</p>
                    <p style="font-size:12px;margin-top:8px;">Connectez-vous pour créer votre première boutique</p>
                </div>`;
            return;
        }
        
        // Affichage des boutiques
        grid.innerHTML = shopsList.map(shop => {
            const rating = shop.rating || 0;
            const stars = generateStars(rating);
            const productCount = 0; // À remplacer par le vrai compteur
            
            return `
                <div class="shop-card" onclick="viewShopDetail('${shop.id}')">
                    <div class="shop-logo-area">
                        <div class="shop-logo-img">
                            ${shop.logo_url ? `<img src="${shop.logo_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : '<i class="fas fa-store" style="font-size:28px;"></i>'}
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
                            <span class="level-badge level-gold">
                                <i class="fas fa-crown"></i> Or
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
        
        console.log('✅ Affichage de', shopsList.length, 'boutiques');
        
    } catch (error) {
        console.error("❌ Erreur d'affichage des boutiques:", error);
        grid.innerHTML = `
            <div style="text-align:center;padding:60px;color:var(--danger);">
                <i class="fas fa-exclamation-circle" style="font-size:48px;margin-bottom:16px;"></i>
                <p>Erreur de chargement des boutiques</p>
                <p style="font-size:12px;">${error.message}</p>
            </div>`;
    }
}

    // ============================================================
    // PANIER
    // ============================================================

    function saveCart() {
        localStorage.setItem('ouenze_cart', JSON.stringify(cart));
        updateCartCount();
    }

    function updateCartCount() {
        const count = cart.reduce((s, i) => s + i.quantity, 0);
        document.querySelectorAll('#cartCountHeader, .cart-count').forEach(el => {
            if (el) el.innerText = count;
        });
    }

    function addToCart(shopId, productId, productName, price, variant = null) {
        if (!currentUser) {
            alert("Connectez-vous");
            openLoginModal();
            return;
        }
        
        const existing = cart.find(i => 
            i.productId === productId && 
            i.shopId === shopId &&
            i.variant === variant
        );
        
        if (existing) {
            existing.quantity++;
        } else {
            cart.push({ 
                productId, 
                productName, 
                price: parseFloat(price), 
                quantity: 1, 
                shopId, 
                variant
            });
        }
        
        saveCart();
        updateCartCount();
        alert(`${productName} ajouté au panier`);
    }

    // ============================================================
    // FONCTIONS UTILITAIRES
    // ============================================================

    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>]/g, m => ({
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
        const fullStars = Math.floor(rating);
        const hasHalfStar = rating % 1 >= 0.5;
        
        for (let i = 0; i < fullStars; i++) stars += '<i class="fas fa-star"></i>';
        if (hasHalfStar) stars += '<i class="fas fa-star-half-alt"></i>';
        for (let i = 0; i < 5 - Math.ceil(rating); i++) stars += '<i class="far fa-star"></i>';
        return stars;
    }

    function getShopLevel(shop) {
        const rating = shop.rating || 0;
        if (rating >= 4.5) return { level: 'gold', name: 'Or' };
        if (rating >= 4) return { level: 'silver', name: 'Argent' };
        if (rating >= 3) return { level: 'bronze', name: 'Bronze' };
        return { level: null, name: 'Standard' };
    }

    // ============================================================
    // MODALES
    // ============================================================

    function openLoginModal() {
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-card">
                <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
                <h3 style="margin-bottom:20px;">Connexion</h3>
                <div class="form-group">
                    <label>Email</label>
                    <input type="email" id="loginEmail" placeholder="exemple@email.com">
                </div>
                <div class="form-group">
                    <label>Mot de passe</label>
                    <input type="password" id="loginPassword" placeholder="••••••••">
                </div>
                <button class="btn-submit" onclick="doLogin()">Se connecter</button>
                <div style="text-align:center;margin-top:12px;">
                    <a href="#" onclick="this.closest('.modal').remove();openRegisterModal()" style="color:var(--primary);cursor:pointer;">Créer un compte</a>
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
                    <input type="password" id="signupPassword" placeholder="•••••••• (min 6 caractères)">
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
                <button class="btn-submit" onclick="doSignUp()">S'inscrire</button>
                <div style="text-align:center;margin-top:12px;">
                    <a href="#" onclick="this.closest('.modal').remove();openLoginModal()" style="color:var(--primary);cursor:pointer;">Déjà un compte ? Se connecter</a>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // ============================================================
    // NAVIGATION
    // ============================================================

    function resetToHome() {
        showHomePage();
    }

    function showCart() {
        alert("Panier: " + cart.length + " articles");
    }

    function showProfile() {
        if (!currentUser) {
            alert("Connectez-vous");
            openLoginModal();
            return;
        }
        alert("Profil utilisateur: " + currentUser.email);
    }

    function setSort(sort) {
        console.log("Tri par:", sort);
    }

    // ============================================================
    // INITIALISATION
    // ============================================================

    document.addEventListener('DOMContentLoaded', () => {
        console.log('📄 DOM chargé, initialisation...');
        initApp();
    });

    // ============================================================
    // EXPORTS GLOBAUX
    // ============================================================
    window.doLogin = doLogin;
    window.doSignUp = doSignUp;
    window.logout = logout;
    window.showHomePage = showHomePage;
    window.resetToHome = resetToHome;
    window.showCart = showCart;
    window.showProfile = showProfile;
    window.openLoginModal = openLoginModal;
    window.openRegisterModal = openRegisterModal;
    window.addToCart = addToCart;
    window.setSort = setSort;

    console.log('✅ app.js chargé avec succès');
} // Fin du guard
