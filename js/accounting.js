// ============ DONNÉES ============
let currentUser = null;
let shops = [];
let orders = [];
let accountingEntries = [];
let manualEntries = [];

// Stockage des charts pour les détruire
let activeCharts = {};

// ============ ESCAPE HTML ============
function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>]/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;'
    }[m]));
}

// ============ GÉNÉRATION DES ÉCRITURES ============
function generateAccountingEntriesForOrder(order, userShopIds) {
    const entries = [];
    const orderDate = order.date || new Date().toISOString();
    
    // Vente (crédit)
    entries.push({
        id: crypto.randomUUID(),
        date: orderDate,
        account: "Ventes",
        debit: 0,
        credit: order.total,
        description: `Vente #${order.id}`,
        type: "auto",
        orderId: order.id,
        createdAt: new Date().toISOString()
    });
    
    // Banque / Caisse (débit)
    entries.push({
        id: crypto.randomUUID(),
        date: orderDate,
        account: order.paymentMethod === 'cash' ? "Caisse" : "Banque",
        debit: order.total,
        credit: 0,
        description: `Règlement commande #${order.id}`,
        type: "auto",
        orderId: order.id,
        createdAt: new Date().toISOString()
    });
    
    // Frais de livraison (10%)
    const deliveryFees = order.deliveryFees || (order.total * 0.1);
    if (deliveryFees > 0) {
        entries.push({
            id: crypto.randomUUID(),
            date: orderDate,
            account: "Frais de livraison",
            debit: deliveryFees,
            credit: 0,
            description: `Frais de livraison commande #${order.id}`,
            type: "auto",
            orderId: order.id,
            createdAt: new Date().toISOString()
        });
    }
    
    return entries;
}

// Synchroniser toutes les commandes existantes
function syncAllOrdersToAccounting() {
    const userShops = shops.filter(s => s.owner === currentUser.email);
    const userShopIds = userShops.map(s => s.id);
    const userOrders = orders.filter(o => o.items?.some(i => userShopIds.includes(i.shopId)));
    
    // Récupérer les IDs des commandes déjà traitées
    const processedOrderIds = new Set(accountingEntries.map(e => e.orderId).filter(id => id));
    
    let newEntries = [];
    for (const order of userOrders) {
        if (!processedOrderIds.has(order.id)) {
            const orderEntries = generateAccountingEntriesForOrder(order, userShopIds);
            newEntries.push(...orderEntries);
        }
    }
    
    if (newEntries.length > 0) {
        accountingEntries.push(...newEntries);
        accountingEntries.sort((a, b) => new Date(a.date) - new Date(b.date));
        localStorage.setItem('ouenze_accounting_entries', JSON.stringify(accountingEntries));
        console.log(`${newEntries.length} nouvelle(s) écriture(s) comptable(s) générée(s)`);
    }
}

// ============ RÉCUPÉRATION DE TOUTES LES ÉCRITURES ============
function getAllEntries() {
    syncAllOrdersToAccounting();
    const allEntries = [...accountingEntries, ...manualEntries];
    allEntries.sort((a, b) => new Date(a.date) - new Date(b.date));
    return allEntries;
}

// ============ CALCUL DU CPC ============
function calculateCPC() {
    const entries = getAllEntries();
    let ventes = 0, achats = 0, fraisLivraison = 0, fraisDivers = 0, autresCharges = 0, caisseBanque = 0;
    
    entries.forEach(e => {
        if (e.account === "Ventes") ventes += e.credit;
        else if (e.account === "Achats") achats += e.debit;
        else if (e.account === "Frais de livraison") fraisLivraison += e.debit;
        else if (e.account === "Frais divers") fraisDivers += e.debit;
        else if (e.account === "Autres charges") autresCharges += e.debit;
        else if (e.account === "Caisse" || e.account === "Banque") caisseBanque += e.debit;
    });
    
    const totalCharges = achats + fraisLivraison + fraisDivers + autresCharges;
    const resultat = ventes - totalCharges;
    
    return { ventes, achats, fraisLivraison, fraisDivers, autresCharges, totalCharges, resultat, caisseBanque };
}

// ============ CALCUL DE LA BALANCE ============
function calculateBalance() {
    const entries = getAllEntries();
    const balances = {};
    
    entries.forEach(e => {
        if (!balances[e.account]) balances[e.account] = 0;
        balances[e.account] += e.debit - e.credit;
    });
    
    return balances;
}

// ============ DESTRUCTION DES CHARTS ============
function destroyChart(chartId) {
    if (activeCharts[chartId]) {
        activeCharts[chartId].destroy();
        delete activeCharts[chartId];
    }
}

// ============ TABLEAU DE BORD ============
function showDashboard() {
    const entries = getAllEntries();
    const cpc = calculateCPC();
    const balances = calculateBalance();
    
    // Statistiques mensuelles
    const monthlyData = {};
    entries.forEach(e => {
        if (e.account === "Ventes") {
            const month = new Date(e.date).toLocaleString('fr', { month: 'short', year: 'numeric' });
            if (!monthlyData[month]) monthlyData[month] = 0;
            monthlyData[month] += e.credit;
        }
    });
    
    const labels = Object.keys(monthlyData).slice(-6);
    const data = labels.map(l => monthlyData[l]);
    
    const totalEntries = entries.length;
    const manualCount = manualEntries.length;
    
    document.getElementById('appContainer').innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <h3>Chiffre d'affaires</h3>
                <div class="stat-value positive">${cpc.ventes.toLocaleString()} FCFA</div>
                <div class="stat-change positive"><i class="fas fa-arrow-up"></i> Total ventes</div>
            </div>
            <div class="stat-card">
                <h3>Total charges</h3>
                <div class="stat-value negative">${cpc.totalCharges.toLocaleString()} FCFA</div>
                <div class="stat-change negative"><i class="fas fa-arrow-down"></i> Dépenses</div>
            </div>
            <div class="stat-card">
                <h3>Résultat net</h3>
                <div class="stat-value ${cpc.resultat >= 0 ? 'positive' : 'negative'}">
                    ${cpc.resultat >= 0 ? '+' : ''}${cpc.resultat.toLocaleString()} FCFA
                </div>
                <div class="stat-change">${cpc.resultat >= 0 ? 'Bénéfice' : 'Perte'}</div>
            </div>
            <div class="stat-card">
                <h3>Nombre d'écritures</h3>
                <div class="stat-value">${totalEntries}</div>
                <div class="stat-change">Dont ${manualCount} manuelles</div>
            </div>
        </div>
        
        <div class="chart-container">
            <h3>Évolution du chiffre d'affaires</h3>
            <canvas id="revenueChart" style="max-height: 250px;"></canvas>
        </div>
        
        <div class="cpc-grid">
            <div class="cpc-card">
                <h3>Produits</h3>
                <div class="cpc-row">
                    <span>Ventes de marchandises</span>
                    <span>${cpc.ventes.toLocaleString()} FCFA</span>
                </div>
                <div class="cpc-total">Total produits: ${cpc.ventes.toLocaleString()} FCFA</div>
            </div>
            <div class="cpc-card">
                <h3>Charges</h3>
                <div class="cpc-row"><span>Achats de marchandises</span><span>${cpc.achats.toLocaleString()} FCFA</span></div>
                <div class="cpc-row"><span>Frais de livraison</span><span>${cpc.fraisLivraison.toLocaleString()} FCFA</span></div>
                <div class="cpc-row"><span>Frais divers</span><span>${cpc.fraisDivers.toLocaleString()} FCFA</span></div>
                <div class="cpc-row"><span>Autres charges</span><span>${cpc.autresCharges.toLocaleString()} FCFA</span></div>
                <div class="cpc-total">Total charges: ${cpc.totalCharges.toLocaleString()} FCFA</div>
                <div class="cpc-total" style="border-top-color: var(--primary); margin-top: 16px;">
                    Résultat: ${cpc.resultat >= 0 ? '+' : ''}${cpc.resultat.toLocaleString()} FCFA
                </div>
            </div>
        </div>
        
        <div class="chart-container">
            <h3>Balance par compte (sélection)</h3>
            <canvas id="balanceChart" style="max-height: 250px;"></canvas>
        </div>
    `;
    
    setTimeout(() => {
        const ctx1 = document.getElementById('revenueChart')?.getContext('2d');
        if (ctx1) {
            destroyChart('revenueChart');
            activeCharts.revenueChart = new Chart(ctx1, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'CA (FCFA)',
                        data,
                        borderColor: '#1e40af',
                        backgroundColor: 'rgba(30,64,175,0.1)',
                        fill: true,
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: { position: 'top' }
                    }
                }
            });
        }
        
        const topBalances = Object.entries(balances).slice(0, 6);
        const ctx2 = document.getElementById('balanceChart')?.getContext('2d');
        if (ctx2) {
            destroyChart('balanceChart');
            activeCharts.balanceChart = new Chart(ctx2, {
                type: 'bar',
                data: {
                    labels: topBalances.map(b => b[0]),
                    datasets: [{
                        label: 'Solde (FCFA)',
                        data: topBalances.map(b => b[1]),
                        backgroundColor: '#3b82f6',
                        borderRadius: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: { position: 'top' }
                    }
                }
            });
        }
    }, 100);
}

// ============ LIVRE JOURNAL ============
function showJournal() {
    const entries = getAllEntries();
    
    document.getElementById('appContainer').innerHTML = `
        <div class="section-header">
            <h2>Livre journal</h2>
            <button class="btn-primary" onclick="window.exportJournal()">
                <i class="fas fa-download"></i> Exporter (CSV)
            </button>
        </div>
        <div class="journal-table">
            <table>
                <thead>
                    <tr><th>Date</th><th>Compte</th><th>Libellé</th><th>Débit (FCFA)</th><th>Crédit (FCFA)</th><th>Type</th></tr>
                </thead>
                <tbody>
                    ${entries.length ? entries.map(e => `
                        <tr>
                            <td>${new Date(e.date).toLocaleDateString()}</td>
                            <td><strong>${escapeHtml(e.account)}</strong></td>
                            <td>${escapeHtml(e.description)}</td>
                            <td>${e.debit > 0 ? e.debit.toLocaleString() : '-'}</td>
                            <td>${e.credit > 0 ? e.credit.toLocaleString() : '-'}</td>
                            <td><span class="${e.type === 'auto' ? 'badge-auto' : 'badge-manual'}">${e.type === 'auto' ? 'Auto' : 'Manuelle'}</span></td>
                        </tr>
                    `).join('') : `
                        <tr><td colspan="6" style="text-align:center;">Aucune écriture</td></tr>
                    `}
                </tbody>
            </table>
        </div>
    `;
}

// ============ COMPTE DE RÉSULTAT ============
function showCPC() {
    const cpc = calculateCPC();
    
    document.getElementById('appContainer').innerHTML = `
        <div class="cpc-grid">
            <div class="cpc-card">
                <h3>Produits</h3>
                <div class="cpc-row">
                    <span>Ventes de marchandises</span>
                    <span>${cpc.ventes.toLocaleString()} FCFA</span>
                </div>
                <div class="cpc-total">Total des produits: ${cpc.ventes.toLocaleString()} FCFA</div>
            </div>
            <div class="cpc-card">
                <h3>Charges</h3>
                <div class="cpc-row"><span>Achats de marchandises</span><span>${cpc.achats.toLocaleString()} FCFA</span></div>
                <div class="cpc-row"><span>Frais de livraison</span><span>${cpc.fraisLivraison.toLocaleString()} FCFA</span></div>
                <div class="cpc-row"><span>Frais divers</span><span>${cpc.fraisDivers.toLocaleString()} FCFA</span></div>
                <div class="cpc-row"><span>Autres charges</span><span>${cpc.autresCharges.toLocaleString()} FCFA</span></div>
                <div class="cpc-total">Total des charges: ${cpc.totalCharges.toLocaleString()} FCFA</div>
            </div>
        </div>
        <div class="stat-card" style="text-align:center; padding:24px;">
            <h3>RÉSULTAT NET</h3>
            <div class="stat-value ${cpc.resultat >= 0 ? 'positive' : 'negative'}" style="font-size:32px;">
                ${cpc.resultat >= 0 ? '+' : ''}${cpc.resultat.toLocaleString()} FCFA
            </div>
            <div class="stat-change">${cpc.resultat >= 0 ? 'Bénéfice' : 'Perte'} de l'exercice</div>
        </div>
    `;
}

// ============ BALANCE GÉNÉRALE ============
function showBalance() {
    const balances = calculateBalance();
    
    document.getElementById('appContainer').innerHTML = `
        <h2 style="margin-bottom:20px;">Balance générale</h2>
        <div class="journal-table">
            <table>
                <thead>
                    <tr><th>Compte</th><th>Total Débit (FCFA)</th><th>Total Crédit (FCFA)</th><th>Solde (FCFA)</th></tr>
                </thead>
                <tbody>
                    ${Object.entries(balances).length ? Object.entries(balances).map(([account, balance]) => `
                        <tr>
                            <td><strong>${escapeHtml(account)}</strong></td>
                            <td>${balance > 0 ? balance.toLocaleString() : '-'}</td>
                            <td>${balance < 0 ? Math.abs(balance).toLocaleString() : '-'}</td>
                            <td class="${balance >= 0 ? 'positive' : 'negative'}">${balance.toLocaleString()} FCFA</td>
                        </tr>
                    `).join('') : `
                        <tr><td colspan="4" style="text-align:center;">Aucune donnée</td></tr>
                    `}
                </tbody>
            </table>
        </div>
    `;
}

// ============ SAISIE MANUELLE ============
function showManualEntry() {
    document.getElementById('appContainer').innerHTML = `
        <div class="stat-card center-card">
            <h2 style="margin-bottom:20px;">Saisie manuelle d'écriture comptable</h2>
            <div class="form-group">
                <label>Date *</label>
                <input type="date" id="entryDate" value="${new Date().toISOString().split('T')[0]}">
            </div>
            <div class="form-group">
                <label>Compte *</label>
                <select id="entryAccount">
                    <option value="Achats">Achats de marchandises</option>
                    <option value="Frais de livraison">Frais de livraison</option>
                    <option value="Frais divers">Frais divers</option>
                    <option value="Autres charges">Autres charges</option>
                    <option value="Caisse">Caisse</option>
                    <option value="Banque">Banque</option>
                    <option value="Ventes">Ventes</option>
                </select>
            </div>
            <div class="form-group">
                <label>Type d'opération</label>
                <select id="entryType">
                    <option value="debit">Débit (charge/actif)</option>
                    <option value="credit">Crédit (produit/passif)</option>
                </select>
            </div>
            <div class="form-group">
                <label>Montant (FCFA) *</label>
                <input type="number" id="entryAmount" placeholder="0">
            </div>
            <div class="form-group">
                <label>Libellé / Description</label>
                <textarea id="entryDesc" rows="2" placeholder="Description de l'opération..."></textarea>
            </div>
            <button class="btn-primary" onclick="window.addManualEntry()" style="width:100%;">Ajouter l'écriture</button>
        </div>
    `;
}

function addManualEntry() {
    const date = document.getElementById('entryDate').value;
    const account = document.getElementById('entryAccount').value;
    const type = document.getElementById('entryType').value;
    const amount = parseFloat(document.getElementById('entryAmount').value);
    const description = document.getElementById('entryDesc').value;
    
    if (!date || !account || !amount || amount <= 0) {
        alert("Veuillez remplir tous les champs obligatoires");
        return;
    }
    
    const newEntry = {
        id: crypto.randomUUID(),
        date: new Date(date).toISOString(),
        account: account,
        debit: type === 'debit' ? amount : 0,
        credit: type === 'credit' ? amount : 0,
        description: description || `Saisie manuelle - ${account}`,
        type: "manual",
        createdAt: new Date().toISOString()
    };
    
    manualEntries.push(newEntry);
    localStorage.setItem('ouenze_manual_entries', JSON.stringify(manualEntries));
    
    alert("Écriture comptable ajoutée avec succès !");
    showJournal();
}

// ============ EXPORT CSV ============
function exportJournal() {
    const entries = getAllEntries();
    let csv = "Date,Compte,Libellé,Débit (FCFA),Crédit (FCFA),Type\n";
    entries.forEach(e => {
        csv += `${new Date(e.date).toLocaleDateString()},"${e.account}","${e.description.replace(/"/g, '""')}",${e.debit},${e.credit},${e.type}\n`;
    });
    
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `journal_comptable_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    alert("Export CSV effectué !");
}

// ============ NAVIGATION ============
function setupNavigation() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabName = tab.dataset.tab;
            if (tabName === 'dashboard') showDashboard();
            else if (tabName === 'journal') showJournal();
            else if (tabName === 'cpc') showCPC();
            else if (tabName === 'balance') showBalance();
            else if (tabName === 'entry') showManualEntry();
        });
    });
}

// ============ INITIALISATION ============
function init() {
    // Récupérer les données
    currentUser = JSON.parse(localStorage.getItem('ouenze_current_user') || 'null');
    shops = JSON.parse(localStorage.getItem('ouenze_shops') || '[]');
    orders = JSON.parse(localStorage.getItem('ouenze_orders') || '[]');
    accountingEntries = JSON.parse(localStorage.getItem('ouenze_accounting_entries') || '[]');
    manualEntries = JSON.parse(localStorage.getItem('ouenze_manual_entries') || '[]');
    
    // Vérifier que l'utilisateur est un vendeur
    if (!currentUser || currentUser.type !== 'vendeur') {
        window.location.href = 'index.html';
        return;
    }
    
    // Mettre à jour l'interface utilisateur
    const userAvatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');
    if (userAvatar) userAvatar.innerText = currentUser.name.charAt(0).toUpperCase();
    if (userName) userName.innerText = currentUser.name;
    
    // Synchroniser les commandes avec la comptabilité
    syncAllOrdersToAccounting();
    
    // Configurer la navigation
    setupNavigation();
    
    // Afficher le tableau de bord par défaut
    showDashboard();
}

// Nettoyage au déchargement
window.addEventListener('beforeunload', () => {
    Object.keys(activeCharts).forEach(key => {
        if (activeCharts[key]) activeCharts[key].destroy();
    });
});

// Exports globaux
window.showDashboard = showDashboard;
window.showJournal = showJournal;
window.showCPC = showCPC;
window.showBalance = showBalance;
window.showManualEntry = showManualEntry;
window.addManualEntry = addManualEntry;
window.exportJournal = exportJournal;

// Démarrer l'application
init();