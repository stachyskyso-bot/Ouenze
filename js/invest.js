// ============ VARIABLES GLOBALES ============
let currentUser = null;
let shops = [];
let investments = [];
let userHoldings = [];
let marketHistory = [];
let investmentRequests = [];
let currentSort = 'rating';
let currentShop = null;
let currentChart = null;

// ============ FONCTIONS UTILITAIRES ============

// Afficher une notification toast
function showToast(msg, isError = false) {
    const toast = document.createElement('div');
    toast.className = `toast ${isError ? 'error' : ''}`;
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// Échappement HTML
function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>]/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;'
    }[m]));
}

// Génération d'étoiles
function generateStars(rating) {
    let stars = '';
    for (let i = 0; i < Math.floor(rating); i++) stars += '⭐';
    if (rating % 1 >= 0.5) stars += '½';
    return stars;
}

// ============ GESTION DES NIVEAUX ============
function getSafeLevelClass(level) {
    if (level === 'gold') return 'level-gold';
    if (level === 'silver') return 'level-silver';
    if (level === 'bronze') return 'level-bronze';
    return 'level-none';
}

function getShopLevel(shop) {
    const annualRevenue = (shop.monthlyRevenue || 500000) * 12;
    const valuation = calculateValuation(shop);
    const rating = shop.rating || 0;
    const hasPhysicalStore = shop.hasPhysicalStore || false;
    
    if (rating >= 4.5 && annualRevenue > 10000000 && valuation > 1000000 && hasPhysicalStore) {
        return { 
            level: 'gold', 
            name: 'Or', 
            ouenzeFee: 21, 
            vendorBonus: 1, 
            minInvestment: 500000, 
            maxInvestment: 5000000, 
            color: '#f59e0b', 
            bg: '#fef3c7' 
        };
    } else if (rating >= 4 && rating < 5 && annualRevenue >= 5000000 && annualRevenue <= 10000000 && valuation > 500000) {
        return { 
            level: 'silver', 
            name: 'Argent', 
            ouenzeFee: 21.5, 
            vendorBonus: 0.5, 
            minInvestment: 250000, 
            maxInvestment: 2000000, 
            color: '#94a3b8', 
            bg: '#f1f5f9' 
        };
    } else if (rating >= 3) {
        return { 
            level: 'bronze', 
            name: 'Bronze', 
            ouenzeFee: 22, 
            vendorBonus: 0, 
            minInvestment: 100000, 
            maxInvestment: 1000000, 
            color: '#b45309', 
            bg: '#ffedd5' 
        };
    }
    return { 
        level: null, 
        name: 'Non éligible', 
        ouenzeFee: 22, 
        vendorBonus: 0, 
        minInvestment: 0, 
        maxInvestment: 0, 
        color: '#64748b', 
        bg: '#f1f5f9' 
    };
}

function calculateValuation(shop) {
    const baseValue = 1000000;
    const productValue = (shop.products?.length || 0) * 50000;
    const ratingBonus = (shop.rating || 0) * 150000;
    const salesBonus = (shop.totalSales || 0) * 1000;
    const assetsValue = (shop.assets || []).reduce((sum, a) => sum + (a.value || 0), 0);
    return baseValue + productValue + ratingBonus + salesBonus + assetsValue;
}

function calculateSharePrice(valuation) {
    return Math.max(100, Math.round(valuation / 1000));
}

// ============ GESTION DES INVESTISSEMENTS ============

// Calcul du prix moyen pondéré (FIFO)
function getAverageBuyPrice(shopId, userEmail) {
    const userInvestments = investments.filter(i => i.shopId === shopId && i.investor === userEmail);
    if (userInvestments.length === 0) return 0;
    const totalAmount = userInvestments.reduce((s, i) => s + i.amount, 0);
    const totalQuantity = userInvestments.reduce((s, i) => s + i.quantity, 0);
    return totalAmount / totalQuantity;
}

// Historique des prix
function getShopHistory(shopId) {
    let history = marketHistory.find(h => h.shopId === shopId);
    if (!history) {
        history = { shopId, data: generatePriceHistory(shopId) };
        marketHistory.push(history);
        localStorage.setItem('ouenze_market_history', JSON.stringify(marketHistory));
    }
    return history.data;
}

function generatePriceHistory(shopId) {
    const shop = shops.find(s => s.id === shopId);
    const valuation = calculateValuation(shop);
    let currentPrice = valuation / 1000;
    const history = [];
    for (let i = 30; i >= 0; i--) {
        const change = (Math.random() - 0.5) * 0.03;
        currentPrice = currentPrice * (1 + change);
        history.push({
            date: new Date(Date.now() - i * 86400000).toISOString().split('T')[0],
            price: Math.max(100, Math.round(currentPrice))
        });
    }
    return history;
}

// ============ AUTHENTIFICATION ============
function updateHeaderUI() {
    const container = document.getElementById('headerActions');
    if (container) {
        if (currentUser) {
            container.innerHTML = `
                <div class="user-menu" onclick="showProfile()">
                    <div class="user-avatar">${escapeHtml(currentUser.name.charAt(0))}</div>
                    <div>${escapeHtml(currentUser.name.split(' ')[0])}<br><small>Investisseur</small></div>
                    <button onclick="event.stopPropagation();logout()" style="background:none;border:none;cursor:pointer;color:var(--gray-500);">
                        <i class="fas fa-sign-out-alt"></i>
                    </button>
                </div>`;
        } else {
            container.innerHTML = `<button class="auth-btn" onclick="openLoginModal()">Connexion</button>`;
        }
    }
}

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
            <button class="btn-primary" style="width:100%;" onclick="doLogin()">Se connecter</button>
            <div style="text-align:center;margin-top:16px;">
                Pas de compte ? <a href="#" onclick="window.location.href='index.html'" style="color:var(--primary);">Inscription</a>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

function doLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    if (!email) {
        showToast("Email requis", true);
        return;
    }
    
    // Simulation de connexion
    const allUsers = JSON.parse(localStorage.getItem('ouenze_all_users') || '[]');
    const user = allUsers.find(u => u.email === email && u.password === password);
    
    if (user) {
        currentUser = { name: user.fullName, email: user.email, type: 'investor' };
    } else {
        currentUser = { name: email.split('@')[0], email: email, type: 'investor' };
    }
    
    localStorage.setItem('ouenze_current_user', JSON.stringify(currentUser));
    updateHeaderUI();
    document.querySelector('.modal')?.remove();
    showInvestPage();
    showToast(`Bienvenue ${currentUser.name}`);
}

function logout() {
    currentUser = null;
    localStorage.removeItem('ouenze_current_user');
    updateHeaderUI();
    showInvestPage();
    showToast("Déconnexion réussie");
}

function showProfile() {
    if (!currentUser) {
        openLoginModal();
        return;
    }
    
    document.getElementById('appContainer').innerHTML = `
        <div class="shop-detail-container profile-container">
            <div class="profile-avatar-large">${escapeHtml(currentUser.name.charAt(0))}</div>
            <h3 style="margin:15px 0;">${escapeHtml(currentUser.name)}</h3>
            <p>${escapeHtml(currentUser.email)}</p>
            <p>Type: Investisseur</p>
            ${currentUser.paymentMethod ? `<p>Mode de paiement: ${currentUser.paymentMethod}</p>` : ''}
            <div class="action-buttons" style="justify-content:center; margin-top:20px;">
                <button class="btn-primary" onclick="logout()">Se déconnecter</button>
                <button class="btn-outline" onclick="showInvestPage()">Retour</button>
            </div>
        </div>`;
}

// ============ PAGE INVESTISSEMENT ============
function showInvestPage() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        if (tab.dataset.tab === 'invest') tab.classList.add('active');
        else tab.classList.remove('active');
    });
    
    const eligibleShops = shops.filter(s => s.rating >= 3);
    const sortedShops = sortShops(eligibleShops, currentSort);
    
    document.getElementById('appContainer').innerHTML = `
        <div class="filters-bar">
            <div class="sort-buttons">
                <button class="sort-btn ${currentSort === 'rating' ? 'active' : ''}" onclick="setSort('rating')">Par note</button>
                <button class="sort-btn ${currentSort === 'price' ? 'active' : ''}" onclick="setSort('price')">Par prix</button>
                <button class="sort-btn ${currentSort === 'level' ? 'active' : ''}" onclick="setSort('level')">Par niveau</button>
            </div>
            <input type="text" id="searchShop" class="search-input" placeholder="Rechercher une boutique..." onkeyup="filterShops()">
        </div>
        <div class="shops-grid" id="shopsGrid"></div>
    `;
    renderShopsGrid(sortedShops);
}

function sortShops(shopsList, sortBy) {
    return [...shopsList].sort((a, b) => {
        if (sortBy === 'rating') return (b.rating || 0) - (a.rating || 0);
        if (sortBy === 'price') return calculateValuation(b) - calculateValuation(a);
        if (sortBy === 'level') {
            const levelA = getShopLevel(a).level;
            const levelB = getShopLevel(b).level;
            const order = { gold: 3, silver: 2, bronze: 1 };
            return (order[levelB] || 0) - (order[levelA] || 0);
        }
        return 0;
    });
}

function renderShopsGrid(shopsList) {
    const grid = document.getElementById('shopsGrid');
    if (!grid) return;
    
    if (!shopsList.length) {
        grid.innerHTML = '<div style="text-align:center;padding:60px;color:var(--gray-500);"><i class="fas fa-store-slash" style="font-size:48px;margin-bottom:16px;"></i><p>Aucune boutique éligible (minimum 3 étoiles requises)</p></div>';
        return;
    }
    
    grid.innerHTML = shopsList.map(shop => {
        const level = getShopLevel(shop);
        const valuation = calculateValuation(shop);
        const levelClass = level.level === 'gold' ? 'gold' : level.level === 'silver' ? 'silver' : 'bronze';
        const levelBadgeClass = getSafeLevelClass(level.level);
        
        return `
            <div class="shop-card ${levelClass}" onclick="showShopDetail(${shop.id})">
                <div class="shop-logo">
                    <div class="shop-logo-img">
                        ${shop.logo ? `<img src="${shop.logo}">` : '<i class="fas fa-store" style="font-size:32px;"></i>'}
                    </div>
                    <div class="shop-name">${escapeHtml(shop.name)}</div>
                    <div class="shop-rating">${generateStars(shop.rating || 0)} ${shop.rating || 0}/5</div>
                    <div class="shop-price">${valuation.toLocaleString()} FCFA</div>
                    <div class="shop-level">
                        <span class="level-badge ${levelBadgeClass}">
                            <i class="fas fa-crown"></i> ${level.name || 'Standard'}
                        </span>
                    </div>
                </div>
                <div class="shop-stats">
                    <span><i class="fas fa-box"></i> ${shop.products?.length || 0} produits</span>
                    <span class="trend-up"><i class="fas fa-arrow-up"></i> ${shop.growthRate || 12}%</span>
                </div>
            </div>
        `;
    }).join('');
}

function filterShops() {
    const query = document.getElementById('searchShop')?.value.toLowerCase() || '';
    const eligibleShops = shops.filter(s => s.rating >= 3);
    const filtered = eligibleShops.filter(s => s.name.toLowerCase().includes(query));
    renderShopsGrid(sortShops(filtered, currentSort));
}

function setSort(type) {
    currentSort = type;
    showInvestPage();
}

// ============ DÉTAIL BOUTIQUE ============
function showShopDetail(shopId) {
    const shop = shops.find(s => s.id === shopId);
    if (!shop) return;
    currentShop = shop;
    
    const level = getShopLevel(shop);
    const valuation = calculateValuation(shop);
    const sharePrice = calculateSharePrice(valuation);
    const history = getShopHistory(shopId);
    const userInvestments = investments.filter(i => i.investor === currentUser?.email && i.shopId === shopId);
    const totalInvested = userInvestments.reduce((s, i) => s + i.amount, 0);
    const totalShares = userInvestments.reduce((s, i) => s + i.quantity, 0);
    const avgPrice = getAverageBuyPrice(shopId, currentUser?.email);
    
    document.getElementById('appContainer').innerHTML = `
        <button class="back-btn" onclick="showInvestPage()">
            <i class="fas fa-arrow-left"></i> Retour
        </button>
        <div class="shop-detail-container">
            <div class="shop-detail-header">
                <div class="shop-detail-logo">
                    ${shop.logo ? `<img src="${shop.logo}">` : '<i class="fas fa-store" style="font-size:48px;"></i>'}
                </div>
                <div>
                    <h1>${escapeHtml(shop.name)}</h1>
                    <div class="shop-rating">${generateStars(shop.rating || 0)} ${shop.rating || 0}/5 (${shop.totalRatings || 0} avis)</div>
                    <div class="shop-level">
                        <span class="level-badge ${getSafeLevelClass(level.level)}">
                            <i class="fas fa-crown"></i> Niveau ${level.name || 'Standard'}
                        </span>
                        <span class="fee-info fee-${level.level || 'none'}">
                            <i class="fas fa-percent"></i> Commission: ${level.ouenzeFee}%
                        </span>
                    </div>
                    <div>📍 ${escapeHtml(shop.city || 'Brazzaville')}, ${escapeHtml(shop.quartier || '')}</div>
                </div>
            </div>
            
            ${currentUser ? `
            <div class="investment-range">
                <strong><i class="fas fa-chart-line"></i> Fourchette d'investissement</strong><br>
                Minimum: ${level.minInvestment.toLocaleString()} FCFA | Maximum: ${level.maxInvestment.toLocaleString()} FCFA
                ${totalInvested > 0 ? `<br><span style="color:var(--primary);">💰 Votre investissement: ${totalInvested.toLocaleString()} FCFA (${totalShares} actions)</span>` : ''}
                ${avgPrice > 0 ? `<br><span style="color:var(--gray-500);">📊 Prix moyen d'achat: ${Math.round(avgPrice).toLocaleString()} FCFA/action</span>` : ''}
            </div>
            ` : ''}
            
            <div class="chart-tabs">
                <button class="chart-tab active" onclick="switchChart(event, 'price')">Évolution du prix</button>
                <button class="chart-tab" onclick="switchChart(event, 'volume')">Volume des transactions</button>
                <button class="chart-tab" onclick="switchChart(event, 'revenue')">Chiffre d'affaires</button>
            </div>
            <div class="chart-container">
                <canvas id="shopChart"></canvas>
            </div>
            
            <div class="table-container">
                <h3>Indicateurs financiers</h3>
                <table class="data-table">
                    <tr><th>Valorisation totale</th><td>${valuation.toLocaleString()} FCFA</td></tr>
                    <tr><th>Prix par action (0.1%)</th><td>${sharePrice.toLocaleString()} FCFA</td></tr>
                    <tr><th>Chiffre d'affaires annuel</th><td>${((shop.monthlyRevenue || valuation * 0.1) * 12).toLocaleString()} FCFA</td></tr>
                    <tr><th>Croissance estimée</th><td class="trend-up">+${shop.growthRate || 12}%</td></tr>
                </table>
            </div>
            
            ${currentUser ? `
            <div class="action-buttons">
                <button class="btn-primary" onclick="openBuySharesModal(${shop.id}, ${sharePrice}, ${level.minInvestment}, ${level.maxInvestment})">
                    <i class="fas fa-shopping-cart"></i> Acheter des actions
                </button>
                ${totalShares > 0 ? `
                <button class="btn-danger" onclick="openSellSharesModal(${shop.id}, ${sharePrice}, ${totalShares})">
                    <i class="fas fa-exchange-alt"></i> Vendre des actions
                </button>
                ` : ''}
                <button class="btn-outline" onclick="window.location.href='index.html?id=${shop.id}'">
                    <i class="fas fa-store"></i> Voir la boutique
                </button>
            </div>
            ` : `
            <div style="background:var(--gray-100);padding:16px;border-radius:12px;text-align:center;">
                <i class="fas fa-lock" style="margin-right:8px;"></i>
                Connectez-vous pour investir dans cette boutique
            </div>
            `}
        </div>
    `;
    
    drawChart('price', history);
}

function drawChart(type, history) {
    const ctx = document.getElementById('shopChart')?.getContext('2d');
    if (!ctx) return;
    if (currentChart) currentChart.destroy();
    
    let labels, data, label, color;
    if (type === 'price') {
        labels = history.map(h => h.date.slice(5));
        data = history.map(h => h.price);
        label = 'Prix par action (FCFA)';
        color = '#3b82f6';
    } else if (type === 'volume') {
        labels = history.slice(-10).map(h => h.date.slice(5));
        data = labels.map(() => Math.floor(Math.random() * 100 + 20));
        label = 'Volume transacted';
        color = '#22c55e';
    } else {
        labels = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
        data = labels.map(() => Math.floor(Math.random() * 500000 + 200000));
        label = 'CA mensuel (FCFA)';
        color = '#f59e0b';
    }
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, color + '40');
    gradient.addColorStop(1, color + '00');
    
    currentChart = new Chart(ctx, {
        type: 'line',
        data: { 
            labels, 
            datasets: [{ 
                label, 
                data, 
                borderColor: color, 
                backgroundColor: gradient, 
                fill: true, 
                tension: 0.3, 
                pointRadius: 2 
            }] 
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { 
                legend: { 
                    position: 'top', 
                    labels: { color: '#9ca3af', font: { size: 11 } } 
                } 
            },
            scales: {
                y: { grid: { color: '#2a3140' }, ticks: { color: '#9ca3af' } },
                x: { grid: { color: '#2a3140' }, ticks: { color: '#9ca3af' } }
            }
        }
    });
}

function switchChart(event, type) {
    const history = getShopHistory(currentShop.id);
    drawChart(type, history);
    document.querySelectorAll('.chart-tab').forEach(tab => tab.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');
}

// ============ ACHAT/VENTE D'ACTIONS ============
function openBuySharesModal(shopId, sharePrice, minInvestment, maxInvestment) {
    if (!currentUser) {
        showToast("Connectez-vous", true);
        return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card">
            <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            <h3 style="margin-bottom:20px;"><i class="fas fa-shopping-cart"></i> Acheter des actions</h3>
            <div class="investment-range" style="margin-bottom:16px;">
                Fourchette d'investissement:<br>
                Minimum: ${minInvestment.toLocaleString()} FCFA | Maximum: ${maxInvestment.toLocaleString()} FCFA
            </div>
            <div class="form-group">
                <label>Nombre d'actions</label>
                <input type="number" id="sharesQty" min="1" value="1">
            </div>
            <div class="form-group">
                <label>Prix unitaire</label>
                <input type="text" id="sharePrice" value="${sharePrice}" readonly disabled>
            </div>
            <div class="form-group">
                <strong>Total: <span id="totalPrice">${sharePrice}</span> FCFA</strong>
            </div>
            <div id="investmentWarning" style="font-size:12px;margin-top:8px;"></div>
            <div class="form-group">
                <label>Mode de paiement</label>
                <select id="paymentMethod">
                    <option value="airtel">Airtel Money</option>
                    <option value="mtn">MTN Mobile Money</option>
                    <option value="orange">Orange Money</option>
                    <option value="visa">Carte bancaire</option>
                </select>
            </div>
            <div class="form-group">
                <label>Numéro / Identifiant</label>
                <input type="text" id="paymentDetails" placeholder="Numéro de téléphone ou email">
            </div>
            <button class="btn-primary" style="width:100%;" onclick="submitBuyRequest(${shopId}, ${sharePrice}, ${minInvestment}, ${maxInvestment})">
                Confirmer l'achat
            </button>
        </div>`;
    document.body.appendChild(modal);
    
    const qtyInput = document.getElementById('sharesQty');
    const totalSpan = document.getElementById('totalPrice');
    const warningSpan = document.getElementById('investmentWarning');
    
    qtyInput.addEventListener('input', (e) => {
        const qty = parseInt(e.target.value) || 0;
        const total = qty * sharePrice;
        totalSpan.innerText = total.toLocaleString();
        
        if (total < minInvestment && total > 0) {
            warningSpan.innerHTML = '⚠️ Montant inférieur au minimum recommandé';
            warningSpan.style.color = '#ef4444';
        } else if (total > maxInvestment) {
            warningSpan.innerHTML = '⚠️ Montant supérieur au maximum recommandé';
            warningSpan.style.color = '#ef4444';
        } else if (total > 0) {
            warningSpan.innerHTML = '✅ Montant dans la fourchette recommandée';
            warningSpan.style.color = '#22c55e';
        } else {
            warningSpan.innerHTML = '';
        }
    });
}

function submitBuyRequest(shopId, sharePrice, minInvestment, maxInvestment) {
    const quantity = parseInt(document.getElementById('sharesQty').value);
    const paymentMethod = document.getElementById('paymentMethod').value;
    const paymentDetails = document.getElementById('paymentDetails').value;
    
    if (!quantity || quantity < 1) {
        showToast("Quantité invalide", true);
        return;
    }
    if (!paymentDetails) {
        showToast("Veuillez renseigner vos coordonnées de paiement", true);
        return;
    }
    
    const total = quantity * sharePrice;
    if (total < minInvestment && total > 0) {
        if (!confirm(`Le montant (${total.toLocaleString()} FCFA) est inférieur au minimum recommandé. Continuer ?`)) return;
    }
    if (total > maxInvestment) {
        if (!confirm(`Le montant (${total.toLocaleString()} FCFA) est supérieur au maximum recommandé. Continuer ?`)) return;
    }
    
    // Mettre à jour les infos de paiement
    currentUser.paymentMethod = paymentMethod;
    currentUser.paymentDetails = paymentDetails;
    localStorage.setItem('ouenze_current_user', JSON.stringify(currentUser));
    
    // Créer la demande d'investissement
    if (window.createInvestmentRequest) {
        const newRequest = window.createInvestmentRequest({
            type: 'buy_shares',
            shopId: shopId,
            shopName: shops.find(s => s.id === shopId)?.name,
            investor: currentUser.email,
            investorName: currentUser.name,
            quantity: quantity,
            pricePerShare: sharePrice,
            total: total,
            message: `Achat de ${quantity} actions via ${paymentMethod}`
        });
        
        let requests = window.dbGet(window.DB_KEYS.INVESTMENT_REQUESTS);
        requests.push(newRequest);
        window.dbSet(window.DB_KEYS.INVESTMENT_REQUESTS, requests);
    } else {
        const request = {
            id: Date.now(),
            type: 'buy_shares',
            shopId: shopId,
            shopName: shops.find(s => s.id === shopId)?.name,
            investor: currentUser.email,
            investorName: currentUser.name,
            quantity: quantity,
            pricePerShare: sharePrice,
            total: total,
            paymentMethod: paymentMethod,
            paymentDetails: paymentDetails,
            date: new Date().toISOString(),
            status: 'pending_review',
            syncedToPortfolio: false
        };
        let requests = JSON.parse(localStorage.getItem('ouenze_investment_requests') || '[]');
        requests.push(request);
        localStorage.setItem('ouenze_investment_requests', JSON.stringify(requests));
    }
    
    showToast(`✅ Demande d'achat envoyée ! ${total.toLocaleString()} FCFA - ${quantity} actions`);
    document.querySelector('.modal')?.remove();
    showShopDetail(shopId);
}

function openSellSharesModal(shopId, sharePrice, maxQuantity) {
    if (!currentUser) {
        showToast("Connectez-vous", true);
        return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card">
            <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            <h3 style="margin-bottom:20px;"><i class="fas fa-exchange-alt"></i> Vendre des actions</h3>
            <div class="form-group">
                <label>Nombre d'actions (max ${maxQuantity})</label>
                <input type="number" id="sellQty" min="1" max="${maxQuantity}" value="1">
            </div>
            <div class="form-group">
                <label>Prix unitaire</label>
                <input type="text" value="${sharePrice}" readonly disabled>
            </div>
            <div class="form-group">
                <strong>Total: <span id="sellTotal">${sharePrice}</span> FCFA</strong>
            </div>
            <div class="form-group">
                <label>Mode de réception</label>
                <select id="withdrawMethod">
                    <option value="airtel">Airtel Money</option>
                    <option value="mtn">MTN Mobile Money</option>
                    <option value="orange">Orange Money</option>
                    <option value="bank">Virement bancaire</option>
                </select>
            </div>
            <div class="form-group">
                <label>Compte de réception</label>
                <input type="text" id="receiveAccount" placeholder="Numéro ou IBAN">
            </div>
            <button class="btn-danger" style="width:100%;" onclick="submitSellRequest(${shopId}, ${sharePrice}, ${maxQuantity})">
                Confirmer la vente
            </button>
        </div>`;
    document.body.appendChild(modal);
    
    document.getElementById('sellQty').addEventListener('input', (e) => {
        const total = (parseInt(e.target.value) || 0) * sharePrice;
        document.getElementById('sellTotal').innerText = total.toLocaleString();
    });
}

function submitSellRequest(shopId, sharePrice, maxQuantity) {
    const quantity = parseInt(document.getElementById('sellQty').value);
    const withdrawMethod = document.getElementById('withdrawMethod').value;
    const receiveAccount = document.getElementById('receiveAccount').value;
    
    if (!quantity || quantity < 1 || quantity > maxQuantity) {
        showToast("Quantité invalide", true);
        return;
    }
    if (!receiveAccount) {
        showToast("Veuillez renseigner un compte de réception", true);
        return;
    }
    
    const total = quantity * sharePrice;
    
    // Gestion FIFO : supprimer les plus anciens investissements en premier
    let remainingToSell = quantity;
    const updatedInvestments = [...investments];
    const userInvestments = investments.filter(i => i.shopId === shopId && i.investor === currentUser.email);
    
    for (let i = 0; i < userInvestments.length && remainingToSell > 0; i++) {
        const invIndex = updatedInvestments.findIndex(ui => ui.id === userInvestments[i].id);
        if (invIndex !== -1) {
            if (updatedInvestments[invIndex].quantity <= remainingToSell) {
                remainingToSell -= updatedInvestments[invIndex].quantity;
                updatedInvestments.splice(invIndex, 1);
            } else {
                updatedInvestments[invIndex].quantity -= remainingToSell;
                updatedInvestments[invIndex].amount = updatedInvestments[invIndex].quantity * updatedInvestments[invIndex].pricePerShare;
                remainingToSell = 0;
            }
        }
    }
    
    investments.length = 0;
    investments.push(...updatedInvestments);
    localStorage.setItem('ouenze_investments', JSON.stringify(investments));
    
    // Mettre à jour les holdings
    const holdingIndex = userHoldings.findIndex(h => h.shopId === shopId && h.userId === currentUser.email);
    if (holdingIndex !== -1) {
        const holding = userHoldings[holdingIndex];
        if (quantity >= holding.quantity) {
            userHoldings.splice(holdingIndex, 1);
        } else {
            const ratio = quantity / holding.quantity;
            holding.quantity -= quantity;
            holding.amount = holding.amount * (1 - ratio);
        }
        localStorage.setItem('ouenze_holdings', JSON.stringify(userHoldings));
    }
    
    const request = {
        id: Date.now(),
        type: 'sell_shares',
        shopId: shopId,
        shopName: shops.find(s => s.id === shopId)?.name,
        investor: currentUser.email,
        investorName: currentUser.name,
        quantity: quantity,
        pricePerShare: sharePrice,
        total: total,
        withdrawMethod: withdrawMethod,
        receiveAccount: receiveAccount,
        date: new Date().toISOString(),
        status: 'approved'
    };
    investmentRequests.push(request);
    localStorage.setItem('ouenze_investment_requests', JSON.stringify(investmentRequests));
    
    showToast(`✅ Vente confirmée ! ${total.toLocaleString()} FCFA - ${quantity} actions vendues`);
    document.querySelector('.modal')?.remove();
    showShopDetail(shopId);
}

// ============ INITIALISATION DES DONNÉES ============
function initData() {
    if (shops.length === 0) {
        shops = [
            { 
                id: 1, 
                name: "Élégance Africaine", 
                rating: 5.0, 
                totalRatings: 342, 
                products: [], 
                city: "Brazzaville", 
                quartier: "Moungali", 
                monthlyRevenue: 950000, 
                growthRate: 18, 
                hasPhysicalStore: true, 
                assets: [{ name: "Boutique physique", value: 2500000 }], 
                liabilities: [], 
                totalSales: 1250 
            },
            { 
                id: 2, 
                name: "Tech Congo", 
                rating: 4.8, 
                totalRatings: 124, 
                products: [], 
                city: "Brazzaville", 
                quartier: "Centre-ville", 
                monthlyRevenue: 450000, 
                growthRate: 15, 
                hasPhysicalStore: false, 
                assets: [{ name: "Matériel informatique", value: 850000 }], 
                liabilities: [], 
                totalSales: 342 
            },
            { 
                id: 3, 
                name: "Saveurs du Congo", 
                rating: 4.2, 
                totalRatings: 203, 
                products: [], 
                city: "Pointe-Noire", 
                quartier: "Centre", 
                monthlyRevenue: 380000, 
                growthRate: 12, 
                hasPhysicalStore: true, 
                assets: [{ name: "Équipement cuisine", value: 600000 }], 
                liabilities: [], 
                totalSales: 567 
            }
        ];
        localStorage.setItem('ouenze_shops', JSON.stringify(shops));
    }
    
    // Récupération des données existantes
    shops = JSON.parse(localStorage.getItem('ouenze_shops') || '[]');
    investments = JSON.parse(localStorage.getItem('ouenze_investments') || '[]');
    userHoldings = JSON.parse(localStorage.getItem('ouenze_holdings') || '[]');
    marketHistory = JSON.parse(localStorage.getItem('ouenze_market_history') || '[]');
    investmentRequests = JSON.parse(localStorage.getItem('ouenze_investment_requests') || '[]');
    currentUser = JSON.parse(localStorage.getItem('ouenze_current_user') || 'null');
}

// ============ INITIALISATION ============
document.addEventListener('DOMContentLoaded', () => {
    initData();
    updateHeaderUI();
    showInvestPage();
});

// Exports globaux
window.showInvestPage = showInvestPage;
window.showShopDetail = showShopDetail;
window.setSort = setSort;
window.filterShops = filterShops;
window.switchChart = switchChart;
window.openBuySharesModal = openBuySharesModal;
window.openSellSharesModal = openSellSharesModal;
window.submitBuyRequest = submitBuyRequest;
window.submitSellRequest = submitSellRequest;
window.showProfile = showProfile;
window.doLogin = doLogin;
window.logout = logout;
window.openLoginModal = openLoginModal;