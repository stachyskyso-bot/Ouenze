// ============ DATABASE.JS - SOURCE DE VÉRITÉ UNIQUE ============

// Clés localStorage
const DB_KEYS = {
    USERS: 'ouenze_users',
    CURRENT_USER: 'ouenze_current_user',
    SHOPS: 'ouenze_shops',
    ORDERS: 'ouenze_orders',
    INVESTMENTS: 'ouenze_investments',
    INVESTMENT_REQUESTS: 'ouenze_investment_requests',
    PORTFOLIO_INVESTMENTS: 'ouenze_portfolio_investments',
    WITHDRAWAL_HISTORY: 'ouenze_withdrawal_history',
    PORTFOLIO_HISTORY: 'ouenze_portfolio_history',
    SHOP_SALES: 'ouenze_shop_sales'
};

// Fonctions de base
function dbGet(key) {
    try {
        return JSON.parse(localStorage.getItem(key) || '[]');
    } catch(e) {
        console.error(`Erreur lecture ${key}:`, e);
        return [];
    }
}

function dbGetObject(key) {
    try {
        return JSON.parse(localStorage.getItem(key) || 'null');
    } catch(e) {
        return null;
    }
}

function dbSet(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

// ============ STRUCTURES DE DONNÉES ============

// Structure d'une demande d'investissement
function createInvestmentRequest(data) {
    return {
        id: crypto.randomUUID(),
        type: data.type, // 'buy_shares', 'sell_shares', 'acquisition'
        shopId: data.shopId,
        shopName: data.shopName,
        investor: data.investor,
        investorName: data.investorName,
        quantity: data.quantity || 0,
        pricePerShare: data.pricePerShare,
        total: data.total,
        message: data.message || '',
        date: new Date().toISOString(),
        status: 'pending_review', // pending_review, approved, rejected
        syncedToPortfolio: false, // Flag CRITIQUE anti-duplication
        processedAt: null
    };
}

// Structure d'un investissement dans le portefeuille
function createPortfolioInvestment(data) {
    return {
        id: crypto.randomUUID(),
        investor: data.investor,
        investorName: data.investorName,
        shopId: data.shopId,
        shopName: data.shopName,
        shares: data.shares,
        investedAmount: data.investedAmount,
        averageBuyPrice: data.averageBuyPrice,
        date: data.date || new Date().toISOString(),
        lastUpdate: new Date().toISOString()
    };
}

// ============ OPÉRATIONS CRITIQUES SYNCHRONISÉES ============

/**
 * Approuver une demande d'achat d'actions et synchroniser le portefeuille
 * À utiliser dans vendor-dashboard.html
 */
function approveBuyRequest(requestId) {
    const requests = dbGet(DB_KEYS.INVESTMENT_REQUESTS);
    const request = requests.find(r => r.id === requestId);
    
    if (!request) {
        console.error(`Demande ${requestId} non trouvée`);
        return false;
    }
    
    if (request.status === 'approved') {
        console.warn(`Demande ${requestId} déjà approuvée`);
        return false;
    }
    
    // Mettre à jour le statut
    request.status = 'approved';
    request.processedAt = new Date().toISOString();
    dbSet(DB_KEYS.INVESTMENT_REQUESTS, requests);
    
    // Synchroniser avec le portefeuille
    syncPortfolioInvestment(request);
    
    // Envoyer notification (simulée)
    console.log(`✅ Demande ${requestId} approuvée - ${request.shopName} - ${request.quantity} actions`);
    
    return true;
}

/**
 * Synchroniser une demande approuvée avec le portefeuille
 * Vérifie le flag syncedToPortfolio pour éviter les doublons
 */
function syncPortfolioInvestment(request) {
    // Ne traiter que les demandes d'achat approuvées non encore synchronisées
    if (request.type !== 'buy_shares' || request.status !== 'approved' || request.syncedToPortfolio) {
        return false;
    }
    
    const portfolio = dbGet(DB_KEYS.PORTFOLIO_INVESTMENTS);
    
    // Chercher un investissement existant pour cette boutique et cet investisseur
    const existing = portfolio.find(p => 
        p.shopId === request.shopId && 
        p.investor === request.investor
    );
    
    if (existing) {
        // Mettre à jour l'investissement existant
        const newTotalShares = existing.shares + request.quantity;
        const newTotalAmount = existing.investedAmount + request.total;
        existing.shares = newTotalShares;
        existing.investedAmount = newTotalAmount;
        existing.averageBuyPrice = newTotalAmount / newTotalShares;
        existing.lastUpdate = new Date().toISOString();
    } else {
        // Créer un nouvel investissement
        const newInvestment = createPortfolioInvestment({
            investor: request.investor,
            investorName: request.investorName,
            shopId: request.shopId,
            shopName: request.shopName,
            shares: request.quantity,
            investedAmount: request.total,
            averageBuyPrice: request.total / request.quantity,
            date: request.date
        });
        portfolio.push(newInvestment);
    }
    
    dbSet(DB_KEYS.PORTFOLIO_INVESTMENTS, portfolio);
    
    // Marquer la demande comme synchronisée
    request.syncedToPortfolio = true;
    const allRequests = dbGet(DB_KEYS.INVESTMENT_REQUESTS);
    const idx = allRequests.findIndex(r => r.id === request.id);
    if (idx !== -1) {
        allRequests[idx].syncedToPortfolio = true;
        dbSet(DB_KEYS.INVESTMENT_REQUESTS, allRequests);
    }
    
    console.log(`🔄 Portefeuille synchronisé: ${request.shopName} - +${request.quantity} actions`);
    return true;
}

/**
 * Synchroniser toutes les demandes approuvées non encore traitées
 * À appeler au chargement de portfolio.html
 */
function syncAllPendingApprovals() {
    const requests = dbGet(DB_KEYS.INVESTMENT_REQUESTS);
    const pendingSync = requests.filter(r => 
        r.status === 'approved' && 
        r.type === 'buy_shares' && 
        !r.syncedToPortfolio
    );
    
    let syncedCount = 0;
    for (const request of pendingSync) {
        if (syncPortfolioInvestment(request)) {
            syncedCount++;
        }
    }
    
    if (syncedCount > 0) {
        console.log(`📊 ${syncedCount} nouvelle(s) demande(s) synchronisée(s) au portefeuille`);
    }
    
    return syncedCount;
}

/**
 * Vendre des actions - met à jour le portefeuille et enregistre la demande
 */
function sellShares(shopId, investorEmail, quantity, sharePrice) {
    const portfolio = dbGet(DB_KEYS.PORTFOLIO_INVESTMENTS);
    const investment = portfolio.find(p => 
        p.shopId === shopId && 
        p.investor === investorEmail
    );
    
    if (!investment) {
        console.error("Investissement non trouvé");
        return false;
    }
    
    if (quantity > investment.shares) {
        console.error("Quantité supérieure aux actions détenues");
        return false;
    }
    
    const total = quantity * sharePrice;
    
    // Mettre à jour ou supprimer l'investissement
    if (quantity === investment.shares) {
        const idx = portfolio.findIndex(p => p.id === investment.id);
        portfolio.splice(idx, 1);
    } else {
        const ratio = quantity / investment.shares;
        const soldAmount = investment.investedAmount * ratio;
        investment.shares -= quantity;
        investment.investedAmount -= soldAmount;
        investment.averageBuyPrice = investment.investedAmount / investment.shares;
        investment.lastUpdate = new Date().toISOString();
    }
    
    dbSet(DB_KEYS.PORTFOLIO_INVESTMENTS, portfolio);
    
    // Enregistrer la demande de vente
    const sellRequest = createInvestmentRequest({
        type: 'sell_shares',
        shopId: shopId,
        shopName: investment.shopName,
        investor: investorEmail,
        investorName: investment.investorName,
        quantity: quantity,
        pricePerShare: sharePrice,
        total: total
    });
    sellRequest.status = 'approved';
    sellRequest.syncedToPortfolio = true;
    
    const requests = dbGet(DB_KEYS.INVESTMENT_REQUESTS);
    requests.push(sellRequest);
    dbSet(DB_KEYS.INVESTMENT_REQUESTS, requests);
    
    console.log(`💰 Vente: ${quantity} actions de ${investment.shopName} - ${total.toLocaleString()} FCFA`);
    return true;
}

/**
 * Obtenir la valorisation d'une boutique
 */
function calculateShopValuation(shop) {
    const baseValue = 1000000;
    const productValue = (shop.products?.length || 0) * 50000;
    const ratingBonus = (shop.rating || 0) * 150000;
    const salesBonus = (shop.totalSales || 0) * 1000;
    const assetsValue = (shop.assets || []).reduce((sum, a) => sum + (a.value || 0), 0);
    return baseValue + productValue + ratingBonus + salesBonus + assetsValue;
}

/**
 * Obtenir le prix d'une action
 */
function calculateSharePrice(shop) {
    const valuation = calculateShopValuation(shop);
    const totalShares = shop.totalShares || 10000;
    return valuation / totalShares;
}

/**
 * Obtenir la valeur actuelle d'un investissement
 */
function calculateCurrentPortfolioValue(investment) {
    const shops = dbGet(DB_KEYS.SHOPS);
    const shop = shops.find(s => s.id === investment.shopId);
    if (!shop) return investment.investedAmount;
    const currentPrice = calculateSharePrice(shop);
    return investment.shares * currentPrice;
}

/**
 * Obtenir les statistiques globales du portefeuille
 */
function getPortfolioStats(investorEmail) {
    const portfolio = dbGet(DB_KEYS.PORTFOLIO_INVESTMENTS);
    const userInvestments = portfolio.filter(p => p.investor === investorEmail);
    
    let totalInvested = 0;
    let totalCurrentValue = 0;
    
    for (const inv of userInvestments) {
        totalInvested += inv.investedAmount;
        totalCurrentValue += calculateCurrentPortfolioValue(inv);
    }
    
    const totalProfit = totalCurrentValue - totalInvested;
    const profitPercent = totalInvested > 0 ? (totalProfit / totalInvested * 100) : 0;
    
    return {
        totalInvested,
        totalCurrentValue,
        totalProfit,
        profitPercent,
        positionsCount: userInvestments.length
    };
}

// Exporter pour les autres pages
window.DB_KEYS = DB_KEYS;
window.dbGet = dbGet;
window.dbGetObject = dbGetObject;
window.dbSet = dbSet;
window.createInvestmentRequest = createInvestmentRequest;
window.createPortfolioInvestment = createPortfolioInvestment;
window.approveBuyRequest = approveBuyRequest;
window.syncPortfolioInvestment = syncPortfolioInvestment;
window.syncAllPendingApprovals = syncAllPendingApprovals;
window.sellShares = sellShares;
window.calculateShopValuation = calculateShopValuation;
window.calculateSharePrice = calculateSharePrice;
window.calculateCurrentPortfolioValue = calculateCurrentPortfolioValue;
window.getPortfolioStats = getPortfolioStats;
