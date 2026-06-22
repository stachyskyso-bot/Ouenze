// ============ ALGORITHME DE LUHN POUR VALIDATION CARTE ============
function luhnCheck(cardNumber) {
    let sum = 0;
    let shouldDouble = false;
    const clean = cardNumber.replace(/\s/g, '');
    
    for (let i = clean.length - 1; i >= 0; i--) {
        let digit = parseInt(clean[i]);
        if (shouldDouble) {
            digit *= 2;
            if (digit > 9) digit -= 9;
        }
        sum += digit;
        shouldDouble = !shouldDouble;
    }
    return sum % 10 === 0;
}

// ============ VALIDATIONS ============
function validateCongolesePhone(number) {
    const clean = number.replace(/\s/g, '');
    return /^(\+242|0)[56]\d{8}$/.test(clean);
}

function validateCardNumber(number) {
    const clean = number.replace(/\s/g, '');
    return /^\d{16}$/.test(clean) && luhnCheck(clean);
}

function validateCVV(cvv) {
    return /^\d{3}$/.test(cvv);
}

function validateExpiry(expiry) {
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry)) return false;
    const [month, year] = expiry.split('/');
    const expiryDate = new Date(2000 + parseInt(year), parseInt(month), 1);
    return expiryDate > new Date();
}

function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>]/g, m => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[m]));
}

// ============ BASE DE DONNÉES CENTRALISÉE ============
let db = {
    currentUser: null,
    shops: [],
    portfolioInvestments: [],
    withdrawalHistory: [],
    investmentRequests: [],
    portfolioHistory: []
};

// Chargement des données
function loadData() {
    db.currentUser = JSON.parse(localStorage.getItem('ouenze_current_user') || 'null');
    db.shops = JSON.parse(localStorage.getItem('ouenze_shops') || '[]');
    db.portfolioInvestments = JSON.parse(localStorage.getItem('ouenze_portfolio_investments') || '[]');
    db.withdrawalHistory = JSON.parse(localStorage.getItem('ouenze_withdrawal_history') || '[]');
    db.investmentRequests = JSON.parse(localStorage.getItem('ouenze_investment_requests') || '[]');
    db.portfolioHistory = JSON.parse(localStorage.getItem('ouenze_portfolio_history') || '[]');
    
    if (db.shops.length === 0) {
        db.shops = [
            { id: 1, name: "Élégance Africaine", rating: 5.0, totalRatings: 342, products: [], city: "Brazzaville", assets: [], totalSales: 1250, hasPhysicalStore: true, totalShares: 10000 },
            { id: 2, name: "Tech Congo", rating: 4.8, totalRatings: 124, products: [], city: "Brazzaville", assets: [], totalSales: 342, hasPhysicalStore: false, totalShares: 8000 }
        ];
        localStorage.setItem('ouenze_shops', JSON.stringify(db.shops));
    }
}

function saveData() {
    localStorage.setItem('ouenze_shops', JSON.stringify(db.shops));
    localStorage.setItem('ouenze_portfolio_investments', JSON.stringify(db.portfolioInvestments));
    localStorage.setItem('ouenze_withdrawal_history', JSON.stringify(db.withdrawalHistory));
    localStorage.setItem('ouenze_investment_requests', JSON.stringify(db.investmentRequests));
    localStorage.setItem('ouenze_portfolio_history', JSON.stringify(db.portfolioHistory));
}

// ============ CALCULS FINANCIERS ============
function calculateShopValuation(shop) {
    const baseValue = 1000000;
    const productValue = (shop.products?.length || 0) * 50000;
    const ratingBonus = (shop.rating || 0) * 150000;
    const salesBonus = (shop.totalSales || 0) * 1000;
    const assetsValue = (shop.assets || []).reduce((sum, a) => sum + (a.value || 0), 0);
    return baseValue + productValue + ratingBonus + salesBonus + assetsValue;
}

function calculateSharePrice(shop) {
    const valuation = calculateShopValuation(shop);
    const totalShares = shop.totalShares || 10000;
    return valuation / totalShares;
}

function calculateCurrentValue(investment) {
    const shop = db.shops.find(s => s.id === investment.shopId);
    if (!shop) return investment.investedAmount;
    const currentPrice = calculateSharePrice(shop);
    return investment.shares * currentPrice;
}

function getTotalPortfolioValue() {
    return db.portfolioInvestments
        .filter(inv => inv.investor === db.currentUser?.email)
        .reduce((sum, inv) => sum + calculateCurrentValue(inv), 0);
}

function getTotalInvested() {
    return db.portfolioInvestments
        .filter(inv => inv.investor === db.currentUser?.email)
        .reduce((sum, inv) => sum + inv.investedAmount, 0);
}

function getTotalProfit() {
    return getTotalPortfolioValue() - getTotalInvested();
}

function getProfitPercent() {
    const invested = getTotalInvested();
    return invested > 0 ? (getTotalProfit() / invested * 100) : 0;
}

// ============ HISTORIQUE ============
function generateInitialHistory() {
    const history = [];
    let baseValue = getTotalInvested();
    if (baseValue === 0) baseValue = 500000;
    
    for (let i = 30; i >= 0; i--) {
        let change = (Math.random() - 0.48) * 0.02;
        baseValue = baseValue * (1 + change);
        history.push({
            date: new Date(Date.now() - i * 86400000).toISOString().split('T')[0],
            value: Math.max(baseValue, getTotalInvested() * 0.85)
        });
    }
    return history;
}

function loadPortfolioHistory() {
    if (db.portfolioHistory.length === 0) {
        db.portfolioHistory = generateInitialHistory();
        saveData();
    }
}

function addHistorySnapshot() {
    const lastValue = db.portfolioHistory[db.portfolioHistory.length - 1]?.value || getTotalPortfolioValue();
    const newValue = getTotalPortfolioValue();
    if (Math.abs(newValue - lastValue) / lastValue > 0.005) {
        db.portfolioHistory.push({
            date: new Date().toISOString().split('T')[0],
            value: newValue
        });
        if (db.portfolioHistory.length > 60) db.portfolioHistory.shift();
        saveData();
    }
}

// ============ INTERVALLE DE MISE À JOUR ============
let liveUpdateInterval = null;
let portfolioChart = null;

function startLiveUpdates() {
    if (liveUpdateInterval) clearInterval(liveUpdateInterval);
    liveUpdateInterval = setInterval(() => {
        addHistorySnapshot();
        if (portfolioChart && db.portfolioHistory.length > 0) {
            portfolioChart.data.datasets[0].data = db.portfolioHistory.map(h => h.value);
            portfolioChart.update('none');
        }
        updateStatsDisplay();
    }, 30000);
}

function stopLiveUpdates() {
    if (liveUpdateInterval) {
        clearInterval(liveUpdateInterval);
        liveUpdateInterval = null;
    }
}

function updateStatsDisplay() {
    const totalValue = getTotalPortfolioValue();
    const totalInvested = getTotalInvested();
    const totalProfit = getTotalProfit();
    const profitPercent = getProfitPercent();
    
    const statValues = document.querySelectorAll('.stat-value');
    if (statValues[0]) statValues[0].innerText = totalValue.toLocaleString() + ' FCFA';
    if (statValues[1]) statValues[1].innerText = totalInvested.toLocaleString() + ' FCFA';
    if (statValues[2]) statValues[2].innerText = (profitPercent >= 0 ? '+' : '') + profitPercent.toFixed(2) + '%';
    
    const statChanges = document.querySelectorAll('.stat-change');
    if (statChanges[0]) {
        statChanges[0].innerHTML = (totalProfit >= 0 ? '+' : '') + totalProfit.toLocaleString() + ' FCFA';
        statChanges[0].className = `stat-change ${totalProfit >= 0 ? 'positive' : 'negative'}`;
    }
}

// ============ SYNCHRONISATION DES DEMANDES ============
function syncInvestmentRequests() {
    const requests = db.investmentRequests;
    const portfolio = db.portfolioInvestments;
    const toSync = requests.filter(r => 
        r.type === 'buy_shares' && 
        r.status === 'approved' && 
        !r.syncedToPortfolio &&
        r.investor === db.currentUser?.email
    );
    
    for (const req of toSync) {
        const existing = portfolio.find(p => p.shopId === req.shopId && p.investor === req.investor);
        if (existing) {
            existing.shares += req.quantity;
            existing.investedAmount += req.total;
            existing.averageBuyPrice = existing.investedAmount / existing.shares;
            existing.lastUpdate = new Date().toISOString();
        } else {
            portfolio.push({
                id: crypto.randomUUID(),
                investor: req.investor,
                investorName: req.investorName,
                shopId: req.shopId,
                shopName: req.shopName,
                shares: req.quantity,
                investedAmount: req.total,
                averageBuyPrice: req.total / req.quantity,
                date: req.date,
                lastUpdate: new Date().toISOString()
            });
        }
        req.syncedToPortfolio = true;
    }
    
    if (toSync.length > 0) {
        saveData();
        console.log(`${toSync.length} investissement(s) synchronisé(s)`);
    }
}

// ============ VENTE D'ACTIONS ============
let isSelling = false;

function sellShares(shopId, userEmail, quantity, sharePrice, shopName) {
    const portfolio = db.portfolioInvestments;
    const investmentIndex = portfolio.findIndex(p => p.shopId === shopId && p.investor === userEmail);
    
    if (investmentIndex === -1) return false;
    
    const investment = portfolio[investmentIndex];
    if (quantity > investment.shares) return false;
    
    // Mise à jour ou suppression de la position
    if (quantity === investment.shares) {
        portfolio.splice(investmentIndex, 1);
    } else {
        const ratio = quantity / investment.shares;
        investment.shares -= quantity;
        investment.investedAmount = investment.investedAmount * (1 - ratio);
        investment.averageBuyPrice = investment.investedAmount / investment.shares;
        investment.lastUpdate = new Date().toISOString();
    }
    
    // Enregistrer la vente
    const saleRecord = {
        id: crypto.randomUUID(),
        type: 'sell_shares',
        shopId: shopId,
        shopName: shopName,
        investor: userEmail,
        quantity: quantity,
        pricePerShare: sharePrice,
        total: quantity * sharePrice,
        date: new Date().toISOString(),
        status: 'completed'
    };
    db.investmentRequests.push(saleRecord);
    
    saveData();
    return true;
}

// ============ PAGE PORTEFEUILLE ============
let currentPortfolioFilter = 'all';

function showPortfolioPage() {
    if (!db.currentUser) {
        document.getElementById('appContainer').innerHTML = `
            <div class="empty-state">
                <i class="fas fa-lock"></i>
                <p>Veuillez vous connecter pour voir votre portefeuille</p>
                <button class="btn-primary" style="margin-top:16px; width:auto; padding:10px 24px;" onclick="openLoginModal()">Se connecter</button>
            </div>
        `;
        return;
    }
    
    // Synchroniser les demandes approuvées
    syncInvestmentRequests();
    
    // Récupérer les investissements de l'utilisateur
    const userInvestments = db.portfolioInvestments.filter(p => p.investor === db.currentUser.email);
    
    // Calculer les stats
    let totalInvested = 0;
    let totalCurrentValue = 0;
    
    for (const inv of userInvestments) {
        totalInvested += inv.investedAmount;
        const shop = db.shops.find(s => s.id === inv.shopId);
        if (shop) {
            const sharePrice = calculateSharePrice(shop);
            totalCurrentValue += inv.shares * sharePrice;
        } else {
            totalCurrentValue += inv.investedAmount;
        }
    }
    
    const totalProfit = totalCurrentValue - totalInvested;
    const profitPercent = totalInvested > 0 ? (totalProfit / totalInvested * 100) : 0;
    
    // Filtrer par catégorie
    const filteredInvestments = currentPortfolioFilter === 'all' 
        ? userInvestments 
        : userInvestments.filter(inv => inv.shopId === parseInt(currentPortfolioFilter));
    
    // Générer le HTML
    document.getElementById('appContainer').innerHTML = `
        <div class="portfolio-stats animated">
            <div class="stat-card">
                <h3>Valeur totale</h3>
                <div class="stat-value">${totalCurrentValue.toLocaleString()} FCFA</div>
                <div class="stat-change ${totalProfit >= 0 ? 'positive' : 'negative'}">
                    ${totalProfit >= 0 ? '+' : ''}${totalProfit.toLocaleString()} FCFA
                </div>
            </div>
            <div class="stat-card">
                <h3>Total investi</h3>
                <div class="stat-value">${totalInvested.toLocaleString()} FCFA</div>
                <div class="stat-change">${userInvestments.length} position(s)</div>
            </div>
            <div class="stat-card">
                <h3>Performance</h3>
                <div class="stat-value ${profitPercent >= 0 ? 'positive' : 'negative'}">
                    ${profitPercent >= 0 ? '+' : ''}${profitPercent.toFixed(2)}%
                </div>
                <div class="stat-change">depuis l'ouverture</div>
            </div>
            <div class="stat-card">
                <h3>Disponible</h3>
                <div class="stat-value">${totalCurrentValue.toLocaleString()} FCFA</div>
                <div class="stat-change">
                    <button onclick="openWithdrawModal()" style="background:var(--primary);border:none;padding:6px 12px;border-radius:20px;color:white;cursor:pointer;margin-top:8px;">
                        Retirer
                    </button>
                </div>
            </div>
        </div>
        
        <div class="chart-container animated">
            <h3><i class="fas fa-chart-line"></i> Évolution du portefeuille</h3>
            <div class="chart-wrapper">
                <canvas id="portfolioChart"></canvas>
            </div>
        </div>
        
        <div class="portfolio-filters">
            <button class="filter-btn ${currentPortfolioFilter === 'all' ? 'active' : ''}" onclick="filterPortfolio('all')">Tous</button>
            ${db.shops.filter(s => userInvestments.some(inv => inv.shopId === s.id)).map(shop => `
                <button class="filter-btn ${currentPortfolioFilter == shop.id ? 'active' : ''}" onclick="filterPortfolio(${shop.id})">
                    ${escapeHtml(shop.name)}
                </button>
            `).join('')}
        </div>
        
        <div class="investments-list animated">
            ${filteredInvestments.length ? filteredInvestments.map(inv => {
                const shop = db.shops.find(s => s.id === inv.shopId);
                const valuation = shop ? calculateShopValuation(shop) : 0;
                const sharePrice = shop ? valuation / (shop.totalShares || 10000) : inv.averageBuyPrice;
                const currentValue = inv.shares * sharePrice;
                const profit = currentValue - inv.investedAmount;
                const profitPct = inv.investedAmount > 0 ? (profit / inv.investedAmount * 100) : 0;
                return `
                    <div class="investment-item" onclick="showInvestmentDetail(${inv.shopId})">
                        <div class="investment-info">
                            <h4><i class="fas fa-store"></i> ${escapeHtml(shop?.name || inv.shopName)}</h4>
                            <p>${inv.shares} actions · Prix moyen: ${Math.round(inv.averageBuyPrice).toLocaleString()} FCFA</p>
                            <p style="font-size:11px;">Investi: ${inv.investedAmount.toLocaleString()} FCFA</p>
                        </div>
                        <div class="investment-value">
                            <div class="investment-amount">${currentValue.toLocaleString()} FCFA</div>
                            <div class="investment-change ${profit >= 0 ? 'positive' : 'negative'}">
                                ${profit >= 0 ? '+' : ''}${profit.toLocaleString()} FCFA (${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(2)}%)
                            </div>
                        </div>
                    </div>
                `;
            }).join('') : `
                <div class="empty-state">
                    <i class="fas fa-folder-open"></i>
                    <p>Aucun investissement. <a href="invest.html">Investir maintenant</a></p>
                </div>
            `}
        </div>
    `;
    
    // Dessiner le graphique
    drawPortfolioChart();
    startLiveUpdates();
}

function drawPortfolioChart() {
    const ctx = document.getElementById('portfolioChart')?.getContext('2d');
    if (!ctx) return;
    if (portfolioChart) portfolioChart.destroy();
    
    if (db.portfolioHistory.length === 0) {
        loadPortfolioHistory();
    }
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(59,130,246,0.3)');
    gradient.addColorStop(1, 'rgba(59,130,246,0.0)');
    
    portfolioChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: db.portfolioHistory.map(h => h.date.slice(5)),
            datasets: [{
                label: 'Valeur du portefeuille (FCFA)',
                data: db.portfolioHistory.map(h => h.value),
                borderColor: '#3b82f6',
                backgroundColor: gradient,
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 6,
                pointHoverBackgroundColor: '#3b82f6'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { color: '#9ca3af', font: { size: 11 } } },
                tooltip: {
                    backgroundColor: '#1e293b',
                    titleColor: '#f1f5f9',
                    bodyColor: '#cbd5e1',
                    callbacks: { label: (ctx) => `${ctx.raw.toLocaleString()} FCFA` }
                }
            },
            scales: {
                x: { grid: { color: '#1e293b' }, ticks: { color: '#64748b' } },
                y: { 
                    grid: { color: '#1e293b' }, 
                    ticks: { color: '#64748b', callback: (val) => val.toLocaleString() + ' FCFA' } 
                }
            }
        }
    });
}

function filterPortfolio(filter) {
    currentPortfolioFilter = filter;
    showPortfolioPage();
}

// ============ DÉTAIL D'UN INVESTISSEMENT ============
function showInvestmentDetail(shopId) {
    stopLiveUpdates();
    
    const shop = db.shops.find(s => s.id === shopId);
    const investment = db.portfolioInvestments.find(inv => inv.shopId === shopId && inv.investor === db.currentUser?.email);
    if (!shop || !investment) return;
    
    const currentValue = calculateCurrentValue(investment);
    const profit = currentValue - investment.investedAmount;
    const currentPrice = calculateSharePrice(shop);
    const stars = '⭐'.repeat(Math.floor(shop.rating || 0));
    
    document.getElementById('appContainer').innerHTML = `
        <button class="back-btn" onclick="showPortfolioPage()">
            <i class="fas fa-arrow-left"></i> Retour au portefeuille
        </button>
        <div class="chart-container animated">
            <div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;margin-bottom:24px;">
                <div style="width:80px;height:80px;background:var(--gray-200);border-radius:50%;display:flex;align-items:center;justify-content:center;">
                    ${shop.logo ? `<img src="${shop.logo}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : '<i class="fas fa-store" style="font-size:40px;"></i>'}
                </div>
                <div>
                    <h2 style="font-size:24px;">${escapeHtml(shop.name)}</h2>
                    <div class="shop-rating">${stars} ${shop.rating || 0}/5</div>
                    <div><i class="fas fa-map-marker-alt"></i> ${escapeHtml(shop.city || 'Brazzaville')}</div>
                </div>
            </div>
            <div class="stats-grid">
                <div class="stat-card">
                    <h3>Actions</h3>
                    <div class="stat-value">${investment.shares}</div>
                    <div class="stat-change">Prix moyen: ${Math.round(investment.averageBuyPrice).toLocaleString()} FCFA</div>
                </div>
                <div class="stat-card">
                    <h3>Valeur actuelle</h3>
                    <div class="stat-value">${currentValue.toLocaleString()} FCFA</div>
                    <div class="stat-change">Prix actuel: ${Math.round(currentPrice).toLocaleString()} FCFA</div>
                </div>
                <div class="stat-card">
                    <h3>Plus-value</h3>
                    <div class="stat-value ${profit >= 0 ? 'positive' : 'negative'}">
                        ${profit >= 0 ? '+' : ''}${profit.toLocaleString()} FCFA
                    </div>
                    <div class="stat-change">${(profit / investment.investedAmount * 100).toFixed(2)}%</div>
                </div>
            </div>
            <div class="action-buttons">
                <button class="btn-primary" onclick="openSellModal(${shop.id}, ${investment.shares}, ${Math.round(currentPrice)})">
                    Vendre des actions
                </button>
                <button class="btn-success" onclick="window.location.href='invest.html'">
                    Acheter plus
                </button>
            </div>
        </div>
    `;
}

// ============ MODAL DE VENTE ============
function openSellModal(shopId, maxShares, sharePrice) {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card">
            <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            <h3 style="margin-bottom:20px;">Vendre des actions</h3>
            <div class="form-group">
                <label>Nombre d'actions (max ${maxShares})</label>
                <input type="number" id="sellQty" min="1" max="${maxShares}" value="1">
            </div>
            <div class="form-group">
                <label>Prix unitaire</label>
                <input type="text" value="${sharePrice.toLocaleString()} FCFA" readonly disabled style="background:var(--gray-100);">
            </div>
            <div class="form-group">
                <strong>Total: <span id="sellTotal">${sharePrice.toLocaleString()}</span> FCFA</strong>
            </div>
            <button class="btn-danger" style="width:100%;margin-top:16px;" id="confirmSellBtn" onclick="confirmSell(${shopId}, ${maxShares}, ${sharePrice})">
                Confirmer la vente
            </button>
            <button onclick="this.closest('.modal').remove()" style="margin-top:12px;background:none;border:none;cursor:pointer;color:var(--gray-500);width:100%;">
                Annuler
            </button>
        </div>`;
    document.body.appendChild(modal);
    
    const qtyInput = document.getElementById('sellQty');
    const totalSpan = document.getElementById('sellTotal');
    
    qtyInput.addEventListener('input', (e) => {
        const total = (parseInt(e.target.value) || 0) * sharePrice;
        totalSpan.innerText = total.toLocaleString();
    });
}

function confirmSell(shopId, maxShares, sharePrice) {
    if (isSelling) return;
    isSelling = true;
    
    const btn = document.getElementById('confirmSellBtn');
    if (btn) btn.disabled = true;
    
    const quantity = parseInt(document.getElementById('sellQty').value);
    if (!quantity || quantity < 1 || quantity > maxShares) {
        alert("Quantité invalide");
        isSelling = false;
        if (btn) btn.disabled = false;
        return;
    }
    
    const shop = db.shops.find(s => s.id === shopId);
    const shopName = shop?.name || 'Boutique';
    
    const success = sellShares(shopId, db.currentUser.email, quantity, sharePrice, shopName);
    
    if (success) {
        alert(`✅ Vente de ${quantity} actions effectuée !\nMontant: ${(quantity * sharePrice).toLocaleString()} FCFA`);
        document.querySelector('.modal.active')?.remove();
        showPortfolioPage();
    } else {
        alert("Erreur lors de la vente");
    }
    
    isSelling = false;
}

// ============ RETRAIT DE FONDS ============
function openWithdrawModal() {
    const totalValue = getTotalPortfolioValue();
    
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card">
            <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            <h3 style="margin-bottom:20px;">Retirer des fonds</h3>
            <div class="payment-methods" id="paymentMethods">
                <div class="payment-card" data-method="airtel">
                    <i class="fas fa-mobile-alt"></i><span>Airtel Money</span>
                </div>
                <div class="payment-card" data-method="mtn">
                    <i class="fas fa-mobile-alt"></i><span>MTN Mobile Money</span>
                </div>
                <div class="payment-card" data-method="visa">
                    <i class="fab fa-cc-visa"></i><span>Carte bancaire</span>
                </div>
                <div class="payment-card" data-method="paypal">
                    <i class="fab fa-paypal"></i><span>PayPal</span>
                </div>
            </div>
            <div id="paymentFormContainer"></div>
            <button class="btn-success" id="submitWithdrawBtn" style="width:100%;margin-top:16px;">Confirmer le retrait</button>
        </div>`;
    document.body.appendChild(modal);
    
    let selectedMethod = 'airtel';
    
    function updatePaymentForm() {
        const container = document.getElementById('paymentFormContainer');
        if (selectedMethod === 'airtel' || selectedMethod === 'mtn') {
            container.innerHTML = `
                <div class="form-group">
                    <label>Montant (FCFA)</label>
                    <input type="number" id="withdrawAmount" min="10000" max="${totalValue}" value="${Math.min(100000, totalValue)}">
                </div>
                <div class="form-group">
                    <label>Numéro Mobile Money (${selectedMethod === 'airtel' ? 'Airtel' : 'MTN'})</label>
                    <input type="tel" id="withdrawAccount" placeholder="+242 06 XX XX XX ou 06 XX XX XX">
                </div>
                <div class="info-text">Format: +242 06 123 45 67</div>
            `;
        } else if (selectedMethod === 'visa') {
            container.innerHTML = `
                <div class="form-group">
                    <label>Montant (FCFA)</label>
                    <input type="number" id="withdrawAmount" min="10000" max="${totalValue}" value="${Math.min(100000, totalValue)}">
                </div>
                <div class="form-group">
                    <label>Nom sur la carte</label>
                    <input type="text" id="cardName" placeholder="JEAN DUPONT">
                </div>
                <div class="form-group">
                    <label>Numéro de carte</label>
                    <input type="text" id="cardNumber" maxlength="19" placeholder="XXXX XXXX XXXX XXXX">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Date d'expiration</label>
                        <input type="text" id="cardExpiry" placeholder="MM/AA">
                    </div>
                    <div class="form-group">
                        <label>CVV</label>
                        <input type="password" id="cardCvv" maxlength="3" placeholder="XXX">
                    </div>
                </div>
                <div id="cardTypeDisplay" style="font-size:11px;color:var(--gray-500);"></div>
                <div id="cardValidationMsg" style="font-size:11px;margin-top:4px;"></div>
            `;
            
            const cardInput = document.getElementById('cardNumber');
            if (cardInput) {
                cardInput.addEventListener('input', (e) => {
                    let val = e.target.value.replace(/\s/g, '');
                    if (val.length > 16) val = val.slice(0, 16);
                    e.target.value = val.replace(/(\d{4})/g, '$1 ').trim();
                    
                    const firstDigit = val.charAt(0);
                    const typeDisplay = document.getElementById('cardTypeDisplay');
                    const validationMsg = document.getElementById('cardValidationMsg');
                    
                    if (firstDigit === '4') typeDisplay.innerHTML = '<i class="fab fa-cc-visa"></i> VISA';
                    else if (firstDigit === '5') typeDisplay.innerHTML = '<i class="fab fa-cc-mastercard"></i> MasterCard';
                    else typeDisplay.innerHTML = '';
                    
                    if (val.length === 16) {
                        if (luhnCheck(val)) {
                            validationMsg.innerHTML = '✅ Numéro valide';
                            validationMsg.style.color = '#22c55e';
                        } else {
                            validationMsg.innerHTML = '❌ Numéro invalide';
                            validationMsg.style.color = '#ef4444';
                        }
                    } else {
                        validationMsg.innerHTML = '';
                    }
                });
            }
        } else if (selectedMethod === 'paypal') {
            container.innerHTML = `
                <div class="form-group">
                    <label>Montant (FCFA)</label>
                    <input type="number" id="withdrawAmount" min="10000" max="${totalValue}" value="${Math.min(100000, totalValue)}">
                </div>
                <div class="form-group">
                    <label>Email PayPal</label>
                    <input type="email" id="withdrawAccount" placeholder="exemple@paypal.com">
                </div>
            `;
        }
    }
    
    document.querySelectorAll('.payment-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.payment-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            selectedMethod = card.dataset.method;
            updatePaymentForm();
        });
    });
    
    updatePaymentForm();
    
    document.getElementById('submitWithdrawBtn').onclick = () => {
        const amount = parseInt(document.getElementById('withdrawAmount')?.value);
        if (!amount || amount < 10000) {
            alert("Montant minimum 10 000 FCFA");
            return;
        }
        if (amount > totalValue) {
            alert("Montant supérieur au solde disponible");
            return;
        }
        
        if (selectedMethod === 'airtel' || selectedMethod === 'mtn') {
            const phone = document.getElementById('withdrawAccount')?.value.trim();
            if (!phone) {
                alert("Numéro de téléphone requis");
                return;
            }
            if (!validateCongolesePhone(phone)) {
                alert("Numéro invalide. Format: +242 06 XX XX XX");
                return;
            }
        } else if (selectedMethod === 'visa') {
            const cardName = document.getElementById('cardName')?.value.trim();
            const cardNumber = document.getElementById('cardNumber')?.value.replace(/\s/g, '');
            const cardExpiry = document.getElementById('cardExpiry')?.value.trim();
            const cardCvv = document.getElementById('cardCvv')?.value.trim();
            
            if (!cardName || !cardNumber || !cardExpiry || !cardCvv) {
                alert("Veuillez remplir toutes les informations de la carte");
                return;
            }
            if (!validateCardNumber(cardNumber)) {
                alert("Numéro de carte invalide");
                return;
            }
            if (!validateExpiry(cardExpiry)) {
                alert("Date d'expiration invalide ou expirée");
                return;
            }
            if (!validateCVV(cardCvv)) {
                alert("CVV invalide (3 chiffres)");
                return;
            }
        } else if (selectedMethod === 'paypal') {
            const email = document.getElementById('withdrawAccount')?.value.trim();
            if (!email) {
                alert("Email PayPal requis");
                return;
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                alert("Email invalide");
                return;
            }
        }
        
        db.withdrawalHistory.push({
            id: crypto.randomUUID(),
            amount: amount,
            method: selectedMethod,
            date: new Date().toISOString(),
            status: 'pending'
        });
        saveData();
        
        alert(`Demande de retrait de ${amount.toLocaleString()} FCFA enregistrée !\nMode: ${selectedMethod.toUpperCase()}\nTraitement sous 48h.`);
        modal.remove();
    };
}

// ============ AUTHENTIFICATION ============
function updateHeaderUI() {
    const container = document.getElementById('headerActions');
    if (db.currentUser) {
        container.innerHTML = `
            <div class="user-menu">
                <div class="user-avatar">${escapeHtml(db.currentUser.name.charAt(0))}</div>
                <div>${escapeHtml(db.currentUser.name.split(' ')[0])}<br><small>Investisseur</small></div>
                <button onclick="event.stopPropagation();logout()" style="background:none;border:none;cursor:pointer;">
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
                <input type="email" id="loginEmail" placeholder="Email">
            </div>
            <div class="form-group">
                <input type="password" id="loginPassword" placeholder="Mot de passe">
            </div>
            <button class="btn-primary" onclick="doLogin()">Se connecter</button>
            <div style="text-align:center;margin-top:16px;">
                <a href="#" onclick="window.location.href='index.html'">Créer un compte</a>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

function doLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    if (email) {
        db.currentUser = { name: email.split('@')[0], email: email, type: 'investor' };
        localStorage.setItem('ouenze_current_user', JSON.stringify(db.currentUser));
        loadData();
        updateHeaderUI();
        document.querySelector('.modal')?.remove();
        showPortfolioPage();
        alert(`Bienvenue ${db.currentUser.name}`);
    } else {
        alert("Email requis");
    }
}

function logout() {
    stopLiveUpdates();
    db.currentUser = null;
    localStorage.removeItem('ouenze_current_user');
    updateHeaderUI();
    window.location.href = 'index.html';
}

// ============ NETTOYAGE AU DÉCHARGEMENT ============
window.addEventListener('beforeunload', () => {
    stopLiveUpdates();
});

// ============ INITIALISATION ============
loadData();
loadPortfolioHistory();
updateHeaderUI();

// Exports globaux
window.showPortfolioPage = showPortfolioPage;
window.filterPortfolio = filterPortfolio;
window.showInvestmentDetail = showInvestmentDetail;
window.openSellModal = openSellModal;
window.confirmSell = confirmSell;
window.openWithdrawModal = openWithdrawModal;
window.logout = logout;
window.openLoginModal = openLoginModal;
window.doLogin = doLogin;

// Démarrer l'application
document.addEventListener('DOMContentLoaded', () => {
    showPortfolioPage();
});