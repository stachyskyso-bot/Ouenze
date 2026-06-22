// ============ CONFIGURATION ============
const activityConfig = {
    order: { icon: 'fa-shopping-cart', label: 'Commande', color: '#3b82f6' },
    investment: { icon: 'fa-chart-line', label: 'Investissement', color: '#22c55e' },
    buy_shares: { icon: 'fa-chart-line', label: 'Achat actions', color: '#22c55e' },
    sell_shares: { icon: 'fa-arrow-down', label: 'Vente actions', color: '#ef4444' },
    acquisition: { icon: 'fa-store', label: 'Acquisition', color: '#f59e0b' }
};

// ============ VARIABLES GLOBALES ============
let currentUser = null;
let shops = [];
let currentFilter = 'all';

// Map pour les recherches rapides
let shopsMap = new Map();

// ============ FONCTIONS UTILITAIRES ============
function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>]/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;'
    }[m]));
}

function formatNumber(value) {
    return Number(value || 0).toLocaleString();
}

function formatDate(dateString) {
    if (!dateString) return 'Date inconnue';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Date inconnue';
    return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function getShopById(id) {
    return shopsMap.get(id);
}

function getActivityStatusClass(type, status) {
    if (type === 'order') return 'status-completed';
    if (type === 'investment') return status === 'approved' || status === 'active' ? 'status-active' : 'status-pending';
    if (type === 'sell_shares') return status === 'approved' || status === 'completed' ? 'status-completed' : 'status-pending';
    if (type === 'acquisition') return status === 'approved' ? 'status-completed' : 'status-pending';
    if (type === 'buy_shares') return status === 'approved' ? 'status-active' : 'status-pending';
    return 'status-pending';
}

function getActivityStatusText(type, status) {
    if (type === 'order') return 'Terminé';
    if (type === 'investment') return status === 'approved' || status === 'active' ? 'Actif' : 'En attente';
    if (type === 'sell_shares') return status === 'approved' || status === 'completed' ? 'Vendu' : 'En attente';
    if (type === 'acquisition') return status === 'approved' ? 'Acceptée' : 'En attente';
    if (type === 'buy_shares') return status === 'approved' ? 'Confirmé' : 'En attente';
    return status === 'approved' ? 'Confirmé' : 'En attente';
}

function getActivityIcon(type) {
    const config = activityConfig[type];
    return config ? config.icon : 'fa-clock';
}

function getActivityLabel(type) {
    const config = activityConfig[type];
    return config ? config.label : type;
}

// ============ AUTHENTIFICATION ============
function updateHeaderUI() {
    const container = document.getElementById('headerActions');
    if (!container) return;
    
    if (currentUser) {
        container.innerHTML = `
            <div class="user-menu" onclick="window.location.href='vendor-dashboard.html'">
                <div class="user-avatar">${escapeHtml(currentUser.name.charAt(0))}</div>
                <div>${escapeHtml(currentUser.name.split(' ')[0])}<br><small>Investisseur</small></div>
                <button type="button" onclick="event.stopPropagation(); logout();" style="background:none;border:none;cursor:pointer;color:var(--gray-500);" aria-label="Se déconnecter">
                    <i class="fas fa-sign-out-alt"></i>
                </button>
            </div>`;
    } else {
        container.innerHTML = `<button class="auth-btn" onclick="openLoginModal()">Connexion</button>`;
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
            <button class="btn-primary" onclick="doLogin()">Se connecter</button>
            <div style="text-align:center;margin-top:16px;">
                <a href="#" onclick="window.location.href='index.html'" style="color:var(--primary);">Créer un compte</a>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

function doLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    if (!email) {
        alert("Email requis");
        return;
    }
    
    // Simulation de connexion (à adapter avec votre backend)
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
    showActivitiesPage();
}

function logout() {
    currentUser = null;
    localStorage.removeItem('ouenze_current_user');
    updateHeaderUI();
    window.location.href = 'index.html';
}

// ============ RÉCUPÉRATION DES ACTIVITÉS ============
function getAllActivities() {
    let activities = [];
    
    // Utiliser database.js si disponible
    let portfolio = [];
    let investmentRequests = [];
    let userInvestments = [];
    
    if (window.dbGet) {
        portfolio = window.dbGet(window.DB_KEYS.PORTFOLIO_INVESTMENTS) || [];
        investmentRequests = window.dbGet(window.DB_KEYS.INVESTMENT_REQUESTS) || [];
        userInvestments = window.dbGet(window.DB_KEYS.USER_INVESTMENTS) || [];
    } else {
        portfolio = JSON.parse(localStorage.getItem('ouenze_portfolio_investments') || '[]');
        investmentRequests = JSON.parse(localStorage.getItem('ouenze_investment_requests') || '[]');
        userInvestments = JSON.parse(localStorage.getItem('ouenze_user_investments') || '[]');
    }
    
    // Filtrer par utilisateur connecté
    const userPortfolio = portfolio.filter(p => p.investor === currentUser?.email);
    const userRequests = investmentRequests.filter(r => r.investor === currentUser?.email);
    const userInvests = userInvestments.filter(i => i.userId === currentUser?.email);
    
    // Ajouter les investissements du portefeuille
    userPortfolio.forEach(inv => {
        activities.push({
            id: inv.id,
            type: 'investment',
            shopId: inv.shopId,
            shopName: inv.shopName,
            amount: inv.investedAmount,
            quantity: inv.shares,
            date: inv.date,
            status: 'active',
            details: `${inv.shares} actions à ${Math.round(inv.averageBuyPrice || inv.pricePerShare || 0).toLocaleString()} FCFA/action`
        });
    });
    
    // Ajouter les demandes d'investissement
    userRequests.forEach(req => {
        let status = 'pending';
        if (req.status === 'approved') {
            status = req.type === 'sell_shares' ? 'completed' : 'active';
        } else if (req.status === 'rejected') {
            status = 'cancelled';
        }
        
        activities.push({
            id: req.id,
            type: req.type,
            shopId: req.shopId,
            shopName: req.shopName,
            amount: req.total || req.amount,
            quantity: req.quantity,
            date: req.date,
            status: status,
            details: getRequestDetails(req)
        });
    });
    
    // Ajouter les investissements directs
    userInvests.forEach(inv => {
        activities.push({
            id: inv.id,
            type: 'investment',
            shopId: inv.shopId,
            shopName: inv.shopName,
            amount: inv.amount,
            quantity: inv.quantity,
            date: inv.date,
            status: inv.status || 'active',
            details: `${inv.quantity || 1} part(s)`
        });
    });
    
    // Trier par date (plus récent en premier)
    activities.sort((a, b) => {
        const dateA = new Date(a.date || 0);
        const dateB = new Date(b.date || 0);
        return dateB - dateA;
    });
    
    return activities;
}

function getRequestDetails(req) {
    if (req.type === 'buy_shares') {
        return `${req.quantity} actions demandées`;
    } else if (req.type === 'sell_shares') {
        return `Vente de ${req.quantity} actions`;
    } else if (req.type === 'acquisition') {
        return `Offre d'acquisition de ${req.percentage || req.shares || 'parts'}`;
    }
    return req.message || 'Demande en cours';
}

// ============ STATISTIQUES ============
function calculateStats(activities) {
    const totalInvested = activities
        .filter(a => a.type === 'investment' && a.status === 'active')
        .reduce((sum, a) => sum + (a.amount || 0), 0);
    
    const totalValue = activities
        .filter(a => (a.type === 'investment' || a.type === 'buy_shares') && a.status === 'active')
        .reduce((sum, a) => sum + (a.amount || 0), 0);
    
    const activeCount = activities.filter(a => a.status === 'active').length;
    const pendingCount = activities.filter(a => a.status === 'pending').length;
    
    return { totalInvested, totalValue, activeCount, pendingCount };
}

// ============ AFFICHAGE ============
function showActivitiesPage() {
    if (!currentUser) {
        window.location.href = 'index.html';
        return;
    }
    
    // Afficher un indicateur de chargement
    document.getElementById('appContainer').innerHTML = `
        <div class="loading">
            <i class="fas fa-spinner fa-spin"></i>
            <p>Chargement de vos activités...</p>
        </div>
    `;
    
    // Récupérer les activités
    const activities = getAllActivities();
    const stats = calculateStats(activities);
    
    // Filtrer
    let filteredActivities = activities;
    if (currentFilter !== 'all') {
        filteredActivities = activities.filter(a => a.type === currentFilter);
    }
    
    // Afficher le contenu
    document.getElementById('appContainer').innerHTML = `
        <!-- Statistiques -->
        <div class="stats-grid">
            <div class="stat-card">
                <h3><i class="fas fa-chart-line"></i> Total investi</h3>
                <div class="stat-value">${formatNumber(stats.totalInvested)} FCFA</div>
                <div class="stat-change">${stats.activeCount} investissements actifs</div>
            </div>
            <div class="stat-card">
                <h3><i class="fas fa-coins"></i> Valeur estimée</h3>
                <div class="stat-value">${formatNumber(stats.totalValue)} FCFA</div>
                <div class="stat-change positive"><i class="fas fa-arrow-up"></i> En croissance</div>
            </div>
            <div class="stat-card">
                <h3><i class="fas fa-clock"></i> En attente</h3>
                <div class="stat-value">${stats.pendingCount}</div>
                <div class="stat-change">Demandes en cours</div>
            </div>
            <div class="stat-card">
                <h3><i class="fas fa-chart-simple"></i> Activités totales</h3>
                <div class="stat-value">${activities.length}</div>
                <div class="stat-change">Transactions réalisées</div>
            </div>
        </div>
        
        <!-- Filtres -->
        <div class="filter-buttons">
            <button class="filter-btn ${currentFilter === 'all' ? 'active' : ''}" onclick="filterActivities('all')">Toutes</button>
            <button class="filter-btn ${currentFilter === 'investment' ? 'active' : ''}" onclick="filterActivities('investment')">Investissements</button>
            <button class="filter-btn ${currentFilter === 'buy_shares' ? 'active' : ''}" onclick="filterActivities('buy_shares')">Achats</button>
            <button class="filter-btn ${currentFilter === 'sell_shares' ? 'active' : ''}" onclick="filterActivities('sell_shares')">Ventes</button>
            <button class="filter-btn ${currentFilter === 'acquisition' ? 'active' : ''}" onclick="filterActivities('acquisition')">Acquisitions</button>
        </div>
        
        <!-- Liste des activités -->
        <div class="activities-list">
            ${filteredActivities.length > 0 ? filteredActivities.map(activity => `
                <div class="activity-item" onclick="viewDetails('${activity.type}', ${activity.shopId || 'null'}, '${activity.id}')">
                    <div class="activity-info">
                        <h4>
                            <i class="fas ${getActivityIcon(activity.type)}" style="color:${activityConfig[activity.type]?.color || '#6b7280'}; margin-right: 8px;"></i>
                            ${escapeHtml(activity.shopName || getActivityLabel(activity.type))}
                        </h4>
                        <p>${formatDate(activity.date)}</p>
                        ${activity.details ? `<div class="activity-details">${escapeHtml(activity.details)}</div>` : ''}
                    </div>
                    <div class="activity-amount">
                        ${activity.amount ? formatNumber(activity.amount) + ' FCFA' : ''}
                        ${activity.quantity ? `<small style="display:block; font-size:11px;">${activity.quantity} actions</small>` : ''}
                    </div>
                    <div class="activity-status">
                        <span class="status-badge ${getActivityStatusClass(activity.type, activity.status)}">
                            ${getActivityStatusText(activity.type, activity.status)}
                        </span>
                    </div>
                </div>
            `).join('') : `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>Aucune activité trouvée</p>
                </div>
            `}
        </div>
    `;
}

// ============ FILTRES ET NAVIGATION ============
function filterActivities(type) {
    currentFilter = type;
    
    // Mettre à jour les classes actives des filtres
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll(`.filter-btn`).forEach(btn => {
        if (btn.textContent.trim().toLowerCase().includes(type === 'all' ? 'toutes' : 
            type === 'investment' ? 'investissements' :
            type === 'buy_shares' ? 'achats' :
            type === 'sell_shares' ? 'ventes' : 'acquisitions')) {
            btn.classList.add('active');
        }
    });
    
    showActivitiesPage();
}

function viewDetails(type, shopId, activityId) {
    if (type === 'order') {
        window.location.href = `tracking.html?id=${activityId}`;
    } else if (type === 'investment' || type === 'buy_shares') {
        if (shopId) {
            window.location.href = `invest.html?id=${shopId}`;
        } else {
            window.location.href = `invest.html`;
        }
    } else if (type === 'sell_shares') {
        window.location.href = `portfolio.html`;
    } else if (type === 'acquisition') {
        alert(`Détails de l'offre d'acquisition\n\nNotre équipe vous contactera sous 48h.`);
    } else {
        if (shopId) {
            window.location.href = `shop.html?id=${shopId}`;
        }
    }
}

// ============ INITIALISATION ============
function initData() {
    // Récupération des données
    shops = JSON.parse(localStorage.getItem('ouenze_shops') || '[]');
    currentUser = JSON.parse(localStorage.getItem('ouenze_current_user') || 'null');
    
    // Construction du Map pour les recherches rapides
    shopsMap.clear();
    shops.forEach(shop => shopsMap.set(shop.id, shop));
    
    // Données de démo si nécessaire
    if (shops.length === 0) {
        shops = [
            { id: 1, name: "Élégance Africaine", rating: 5.0, city: "Brazzaville", assets: [] },
            { id: 2, name: "Tech Congo", rating: 4.8, city: "Brazzaville", assets: [] },
            { id: 3, name: "Saveurs du Congo", rating: 4.2, city: "Pointe-Noire", assets: [] }
        ];
        localStorage.setItem('ouenze_shops', JSON.stringify(shops));
        shops.forEach(shop => shopsMap.set(shop.id, shop));
    }
}

// Initialisation au chargement
document.addEventListener('DOMContentLoaded', () => {
    initData();
    updateHeaderUI();
    
    if (!currentUser) {
        window.location.href = 'index.html';
        return;
    }
    
    showActivitiesPage();
});

// Exports globaux pour les appels onclick
window.showActivitiesPage = showActivitiesPage;
window.filterActivities = filterActivities;
window.viewDetails = viewDetails;
window.logout = logout;
window.openLoginModal = openLoginModal;
window.doLogin = doLogin;