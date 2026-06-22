// ============ VARIABLES GLOBALES ============
let activeCharts = {};
let currentUser = null;
let shops = [];
let orders = [];
let investmentRequests = [];

// ============ FONCTIONS UTILITAIRES ============

// Escape HTML
function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"]/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;'
    }[m]));
}

// Calcul du chiffre d'affaires du vendeur
function getVendorRevenue(userShops) {
    return orders
        .filter(o => o.status === 'delivered' && o.items?.some(i => userShops.some(s => s.id === i.shopId)))
        .reduce((s, o) => s + (o.total || 0), 0);
}

// Données mensuelles de revenu
function getMonthlyRevenue(shopId) {
    const shopOrders = orders.filter(o => o.items?.some(i => i.shopId === shopId));
    const monthly = [];
    
    for (let i = 5; i >= 0; i--) {
        const target = new Date();
        target.setMonth(target.getMonth() - i);
        const month = target.getMonth();
        const year = target.getFullYear();
        
        const total = shopOrders
            .filter(o => {
                const d = new Date(o.date);
                return d.getMonth() === month && d.getFullYear() === year;
            })
            .reduce((s, o) => s + (o.total || 0), 0);
        
        monthly.push(total);
    }
    return monthly;
}

// Destruction des charts
function destroyChart(chartId) {
    if (activeCharts[chartId]) {
        activeCharts[chartId].destroy();
        delete activeCharts[chartId];
    }
}

// Calcul de la valorisation
function calculateValuation(shop) {
    const shopOrders = orders.filter(o => o.items?.some(i => i.shopId === shop.id));
    const revenue = shopOrders.reduce((s, o) => s + (o.total || 0), 0);
    const estimatedExpenses = revenue * 0.35;
    const result = revenue - estimatedExpenses;
    
    let multiple = 3;
    if (shop.rating >= 4.5) multiple = 6;
    else if (shop.rating >= 3.5) multiple = 4.5;
    else if (shop.rating >= 2.5) multiple = 3;
    else multiple = 2;
    
    if ((shop.products?.length || 0) > 50) multiple += 1;
    if ((shop.products?.length || 0) > 100) multiple += 0.5;
    
    const estimatedCash = revenue * 0.2;
    const debts = (shop.liabilities || []).reduce((sum, l) => sum + (l.value || 0), 0);
    const assets = (shop.assets || []).reduce((sum, a) => sum + (a.value || 0), 0);
    
    let valuation = (result * multiple) + estimatedCash + assets - debts;
    if (valuation < 500000) valuation = 500000;
    return Math.round(valuation);
}

// Niveau de la boutique
function getShopLevel(shop) {
    const shopOrders = orders.filter(o => o.items?.some(i => i.shopId === shop.id));
    const revenue = shopOrders.reduce((s, o) => s + (o.total || 0), 0);
    const annualRevenue = revenue * 12;
    const valuation = calculateValuation(shop);
    const rating = shop.rating || 0;
    const hasPhysicalStore = shop.hasPhysicalStore || false;
    
    if (rating >= 4.5 && annualRevenue > 10000000 && valuation > 1000000 && hasPhysicalStore) {
        return { level: 'gold', name: 'Or', ouenzeFee: 21, vendorBonus: 1, color: '#f59e0b', bg: '#fef3c7', class: 'level-gold' };
    } else if (rating >= 4 && rating < 5 && annualRevenue >= 5000000 && annualRevenue <= 10000000 && valuation > 500000) {
        return { level: 'silver', name: 'Argent', ouenzeFee: 21.5, vendorBonus: 0.5, color: '#94a3b8', bg: '#f1f5f9', class: 'level-silver' };
    } else if (rating >= 3) {
        return { level: 'bronze', name: 'Bronze', ouenzeFee: 22, vendorBonus: 0, color: '#b45309', bg: '#ffedd5', class: 'level-bronze' };
    }
    return { level: null, name: 'Non éligible', ouenzeFee: 22, vendorBonus: 0, color: '#64748b', bg: '#f1f5f9', class: '' };
}

// Génération des étoiles
function generateStars(rating) {
    let stars = '';
    for (let i = 0; i < Math.floor(rating); i++) stars += '<i class="fas fa-star"></i>';
    if (rating % 1 >= 0.5) stars += '<i class="fas fa-star-half-alt"></i>';
    for (let i = 0; i < 5 - Math.ceil(rating); i++) stars += '<i class="far fa-star"></i>';
    return stars;
}

// ============ AFFICHAGE PRINCIPAL ============
function showDashboard() {
    const userShops = shops.filter(s => s.owner === currentUser.email);
    const totalProducts = userShops.reduce((s, shop) => s + (shop.products?.length || 0), 0);
    const totalOrders = orders.filter(o => o.items?.some(i => userShops.some(s => s.id === i.shopId))).length;
    const totalRevenue = getVendorRevenue(userShops);
    const pendingRequests = investmentRequests.filter(r => 
        r.shopId && userShops.some(s => s.id === r.shopId) && r.status === 'pending_review'
    );
    
    document.getElementById('appContainer').innerHTML = `
        <div class="stats-grid">
            <div class="stat-card"><h3>Mes boutiques</h3><div class="stat-value">${userShops.length}</div></div>
            <div class="stat-card"><h3>Produits</h3><div class="stat-value">${totalProducts}</div></div>
            <div class="stat-card"><h3>Commandes</h3><div class="stat-value">${totalOrders}</div></div>
            <div class="stat-card"><h3>Chiffre d'affaires</h3><div class="stat-value">${totalRevenue.toLocaleString()} FCFA</div></div>
            <div class="stat-card"><h3>Demandes en attente</h3><div class="stat-value">${pendingRequests.length}</div></div>
        </div>
        <div style="display:flex; gap:12px; margin-bottom:24px; flex-wrap:wrap;">
            <button class="btn-sm btn-primary" onclick="createNewShop()"><i class="fas fa-plus"></i> Créer une boutique</button>
            <button class="btn-sm btn-outline" onclick="openAddProduct()"><i class="fas fa-box"></i> Ajouter produit</button>
            <button class="btn-sm btn-outline" onclick="openRestock()"><i class="fas fa-truck"></i> Ravitailler</button>
            <button class="btn-sm btn-warning" onclick="openInvestmentRequests()"><i class="fas fa-chart-line"></i> Demandes (${pendingRequests.length})</button>
            <button class="btn-sm btn-success" onclick="window.location.href='accounting.html'"><i class="fas fa-calculator"></i> Comptabilité</button>
        </div>
        <h2 style="font-size: 20px; margin-bottom: 20px;">Mes boutiques</h2>
        ${userShops.length ? userShops.map(shop => renderShop(shop)).join('') : '<div class="stat-card" style="text-align:center;">Aucune boutique. Cliquez sur "Créer une boutique" pour commencer.</div>'}
    `;
    
    userShops.forEach(shop => {
        const monthlyData = getMonthlyRevenue(shop.id);
        const canvasId = `chart-${shop.id}`;
        const ctx = document.getElementById(canvasId)?.getContext('2d');
        if (ctx) {
            destroyChart(canvasId);
            activeCharts[canvasId] = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: ['Mois -5', 'Mois -4', 'Mois -3', 'Mois -2', 'Mois -1', 'Ce mois'],
                    datasets: [{
                        label: 'CA (FCFA)',
                        data: monthlyData,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59,130,246,0.1)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 3,
                        pointBackgroundColor: '#3b82f6'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: { color: '#9ca3af', font: { size: 10 } }
                        }
                    }
                }
            });
        }
    });
}

// Rendu d'une boutique
function renderShop(shop) {
    const shopOrders = orders.filter(o => o.items?.some(i => i.shopId === shop.id));
    const revenue = shopOrders.reduce((s, o) => s + (o.total || 0), 0);
    const rating = shop.rating || 0;
    const valuation = calculateValuation(shop);
    const level = getShopLevel(shop);
    const shopUrl = `${window.location.origin}/index.html?id=${shop.id}`;
    const stars = generateStars(rating);
    const annualRevenue = revenue * 12;
    
    return `
        <div class="shop-card">
            <div class="shop-header">
                <div class="shop-info">
                    <div class="shop-logo">${shop.logo ? `<img src="${shop.logo}">` : '<i class="fas fa-store" style="font-size:24px;color:var(--primary);"></i>'}</div>
                    <div>
                        <h3>${escapeHtml(shop.name)} ${level.level ? `<span class="level-badge ${level.class}"><i class="fas fa-crown"></i> ${level.name}</span>` : ''}</h3>
                        <div class="shop-rating">${stars} (${shop.totalRatings || 0} avis)</div>
                        <div style="font-size:12px; color:var(--gray-500);">Valorisation: ${valuation.toLocaleString()} FCFA</div>
                        <div style="font-size:11px; margin-top:4px;">
                            <span style="background:${level.bg}; color:${level.color}; padding:2px 8px; border-radius:20px;">
                                <i class="fas fa-percent"></i> Commission Ouenze: ${level.ouenzeFee}% 
                                ${level.vendorBonus > 0 ? `<span style="margin-left:6px;"><i class="fas fa-gift"></i> Bonus: +${level.vendorBonus}%</span>` : ''}
                            </span>
                        </div>
                    </div>
                </div>
                <div><button class="btn-sm btn-outline" onclick="viewStats(${shop.id})"><i class="fas fa-chart-simple"></i> Statistiques</button></div>
            </div>
            <div class="shop-body">
                <div class="metrics-grid">
                    <div class="metric-card"><div class="metric-value">${shop.products?.length || 0}</div><div class="metric-label">Produits</div></div>
                    <div class="metric-card"><div class="metric-value">${shopOrders.length}</div><div class="metric-label">Commandes</div></div>
                    <div class="metric-card"><div class="metric-value">${revenue.toLocaleString()} FCFA</div><div class="metric-label">Chiffre d'affaires</div></div>
                </div>
                
                <div class="info-box">
                    <strong><i class="fas fa-chart-line"></i> Indicateurs de niveau</strong><br>
                    <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; margin-top:8px;">
                        <span>📊 CA annuel: ${annualRevenue.toLocaleString()} FCFA</span>
                        <span>⭐ Note: ${rating}/5</span>
                        <span>🏢 ${shop.hasPhysicalStore ? 'Boutique physique ✓' : 'Pas de boutique physique'}</span>
                    </div>
                    ${level.level === 'gold' ? '<div style="margin-top:8px; color:var(--gold);"><i class="fas fa-crown"></i> Niveau Or - Commission réduite à 21% (+1% de bonus)</div>' : ''}
                    ${level.level === 'silver' ? '<div style="margin-top:8px; color:var(--silver);"><i class="fas fa-medal"></i> Niveau Argent - Commission réduite à 21.5% (+0.5% de bonus)</div>' : ''}
                    ${level.level === 'bronze' ? '<div style="margin-top:8px; color:var(--bronze);"><i class="fas fa-leaf"></i> Niveau Bronze - Commission standard à 22%</div>' : ''}
                </div>
                
                <div class="chart-container">
                    <canvas id="chart-${shop.id}"></canvas>
                </div>
                
                <div class="share-section">
                    <strong><i class="fas fa-share-alt"></i> Partager ma boutique</strong>
                    <div class="share-buttons">
                        <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shopUrl)}" target="_blank" class="share-btn share-facebook"><i class="fab fa-facebook-f"></i> Facebook</a>
                        <a href="https://twitter.com/intent/tweet?url=${encodeURIComponent(shopUrl)}&text=Découvrez ma boutique ${encodeURIComponent(shop.name)} sur Ouenze!" target="_blank" class="share-btn share-twitter"><i class="fab fa-twitter"></i> Twitter</a>
                        <a href="https://wa.me/?text=${encodeURIComponent(`Découvrez ma boutique ${shop.name} sur Ouenze! ${shopUrl}`)}" target="_blank" class="share-btn share-whatsapp"><i class="fab fa-whatsapp"></i> WhatsApp</a>
                        <a href="https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(shopUrl)}&title=${encodeURIComponent(shop.name)}" target="_blank" class="share-btn share-linkedin"><i class="fab fa-linkedin-in"></i> LinkedIn</a>
                        <button onclick="copyShopLink('${shopUrl}')" class="share-btn share-copy"><i class="fas fa-copy"></i> Copier lien</button>
                    </div>
                </div>
                
                <div class="assets-section">
                    <h4><i class="fas fa-building" style="color:var(--primary);"></i> Actifs</h4>
                    ${(shop.assets || []).map(a => `<div class="asset-item"><span>${escapeHtml(a.name)}</span><span>${a.value.toLocaleString()} FCFA</span></div>`).join('') || '<div style="font-size:12px; color:var(--gray-500);">Aucun actif enregistré</div>'}
                    <div style="margin-top: 8px;"><button class="btn-sm btn-outline" onclick="manageAssets(${shop.id})" style="width:100%;"><i class="fas fa-plus"></i> Gérer les actifs</button></div>
                </div>
                
                <div class="assets-section">
                    <h4><i class="fas fa-chart-line" style="color:var(--warning);"></i> Passifs</h4>
                    ${(shop.liabilities || []).map(l => `<div class="asset-item"><span>${escapeHtml(l.name)}</span><span>${l.value.toLocaleString()} FCFA</span></div>`).join('') || '<div style="font-size:12px; color:var(--gray-500);">Aucun passif enregistré</div>'}
                    <div style="margin-top: 8px;"><button class="btn-sm btn-outline" onclick="manageLiabilities(${shop.id})" style="width:100%;"><i class="fas fa-plus"></i> Gérer les passifs</button></div>
                </div>
                
                <h4 style="font-size: 13px; margin: 16px 0 8px;"><i class="fas fa-box"></i> Produits récents</h4>
                ${(shop.products || []).slice(0, 3).map(p => `
                    <div class="product-row">
                        <span class="product-name">${escapeHtml(p.name)}</span>
                        <span class="product-price">${typeof p.price === 'number' ? p.price.toLocaleString() : p.price} FCFA</span>
                        <span class="product-stock">Stock: ${p.stock || 0}</span>
                    </div>
                `).join('')}
                ${(!shop.products || !shop.products.length) ? '<div style="font-size:12px; color:var(--gray-500);">Aucun produit</div>' : ''}
                
                <div class="shop-actions">
                    <button class="btn-sm btn-outline" onclick="openAddProductToShop(${shop.id})"><i class="fas fa-plus"></i> Ajouter produit</button>
                    <button class="btn-sm btn-outline" onclick="openRestockToShop(${shop.id})"><i class="fas fa-truck"></i> Ravitailler</button>
                    ${shop.rating >= 3 ? `<button class="btn-sm btn-primary" onclick="openInvestmentOffer(${shop.id})"><i class="fas fa-chart-line"></i> Proposer à l'investissement</button>` : '<span class="btn-sm" style="background:#e2e8f0; color:#64748b;"><i class="fas fa-star"></i> 3 étoiles requises</span>'}
                    <button class="btn-sm btn-warning" onclick="openSellShopModal(${shop.id})"><i class="fas fa-store"></i> Vendre la boutique</button>
                    <button class="btn-sm btn-outline" onclick="openShopDesigner(${shop.id})"><i class="fas fa-edit"></i> Modifier le design</button>
                </div>
            </div>
        </div>
    `;
}

// ============ GESTION DES ACTIFS ET PASSIFS ============
function manageAssets(shopId) {
    const shop = shops.find(s => s.id === shopId);
    if (!shop) return;
    
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card">
            <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            <h3 style="margin-bottom: 20px;">Gestion des actifs - ${escapeHtml(shop.name)}</h3>
            <div id="assetsList">${(shop.assets || []).map((a, i) => `
                <div class="asset-item" style="background:var(--gray-200);padding:10px;border-radius:8px;margin-bottom:8px;">
                    <span><strong>${escapeHtml(a.name)}</strong> - ${a.value.toLocaleString()} FCFA</span>
                    <button class="btn-sm" style="background:var(--danger);color:white;" onclick="removeAsset(${shop.id}, ${i})">Supprimer</button>
                </div>
            `).join('')}</div>
            <div class="form-group"><label>Nom de l'actif</label><input type="text" id="assetName" placeholder="Ex: Camionnette, Matériel, Stock"></div>
            <div class="form-group"><label>Valeur (FCFA)</label><input type="number" id="assetValue" placeholder="0"></div>
            <div class="form-group"><label>Description</label><textarea id="assetDesc" rows="2"></textarea></div>
            <button class="btn-submit" onclick="addAsset(${shop.id})">Ajouter un actif</button>
            <button class="btn-sm btn-outline" style="margin-top:12px;" onclick="this.closest('.modal').remove()">Fermer</button>
        </div>`;
    document.body.appendChild(modal);
}

function addAsset(shopId) {
    const name = document.getElementById('assetName').value.trim();
    const value = parseInt(document.getElementById('assetValue').value);
    if (!name || !value) {
        alert("Nom et valeur requis");
        return;
    }
    const shop = shops.find(s => s.id === shopId);
    if (shop) {
        shop.assets = shop.assets || [];
        shop.assets.push({
            name,
            value,
            description: document.getElementById('assetDesc').value,
            addedAt: new Date().toISOString()
        });
        localStorage.setItem('ouenze_shops', JSON.stringify(shops));
        alert("Actif ajouté");
        document.querySelector('.modal.active')?.remove();
        showDashboard();
    }
}

function removeAsset(shopId, index) {
    const shop = shops.find(s => s.id === shopId);
    if (shop && shop.assets) {
        shop.assets.splice(index, 1);
        localStorage.setItem('ouenze_shops', JSON.stringify(shops));
        document.querySelector('.modal.active')?.remove();
        manageAssets(shopId);
    }
}

function manageLiabilities(shopId) {
    const shop = shops.find(s => s.id === shopId);
    if (!shop) return;
    
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card">
            <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            <h3 style="margin-bottom: 20px;">Gestion des passifs - ${escapeHtml(shop.name)}</h3>
            <div id="liabilitiesList">${(shop.liabilities || []).map((l, i) => `
                <div class="asset-item" style="background:var(--gray-200);padding:10px;border-radius:8px;margin-bottom:8px;">
                    <span><strong>${escapeHtml(l.name)}</strong> - ${l.value.toLocaleString()} FCFA</span>
                    <button class="btn-sm" style="background:var(--danger);color:white;" onclick="removeLiability(${shop.id}, ${i})">Supprimer</button>
                </div>
            `).join('')}</div>
            <div class="form-group"><label>Nom du passif</label><input type="text" id="liabilityName" placeholder="Ex: Dette fournisseur, Emprunt"></div>
            <div class="form-group"><label>Montant (FCFA)</label><input type="number" id="liabilityValue" placeholder="0"></div>
            <div class="form-group"><label>Description</label><textarea id="liabilityDesc" rows="2"></textarea></div>
            <button class="btn-submit" onclick="addLiability(${shop.id})">Ajouter un passif</button>
            <button class="btn-sm btn-outline" style="margin-top:12px;" onclick="this.closest('.modal').remove()">Fermer</button>
        </div>`;
    document.body.appendChild(modal);
}

function addLiability(shopId) {
    const name = document.getElementById('liabilityName').value.trim();
    const value = parseInt(document.getElementById('liabilityValue').value);
    if (!name || !value) {
        alert("Nom et montant requis");
        return;
    }
    const shop = shops.find(s => s.id === shopId);
    if (shop) {
        shop.liabilities = shop.liabilities || [];
        shop.liabilities.push({
            name,
            value,
            description: document.getElementById('liabilityDesc').value,
            addedAt: new Date().toISOString()
        });
        localStorage.setItem('ouenze_shops', JSON.stringify(shops));
        alert("Passif ajouté");
        document.querySelector('.modal.active')?.remove();
        showDashboard();
    }
}

function removeLiability(shopId, index) {
    const shop = shops.find(s => s.id === shopId);
    if (shop && shop.liabilities) {
        shop.liabilities.splice(index, 1);
        localStorage.setItem('ouenze_shops', JSON.stringify(shops));
        document.querySelector('.modal.active')?.remove();
        manageLiabilities(shopId);
    }
}

// ============ GESTION DES PRODUITS ============
function openAddProductToShop(shopId) {
    const shop = shops.find(s => s.id === shopId);
    if (!shop) return;
    
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card">
            <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            <h3 style="margin-bottom: 20px;">Ajouter un produit - ${escapeHtml(shop.name)}</h3>
            <div class="form-group"><label>Nom du produit *</label><input type="text" id="productName" placeholder="Nom du produit"></div>
            <div class="form-group"><label>Prix (FCFA) *</label><input type="number" id="productPrice" placeholder="0"></div>
            <div class="form-group"><label>Catégorie</label><input type="text" id="productCategory" placeholder="Catégorie"></div>
            <div class="form-group"><label>Quantité en stock *</label><input type="number" id="productStock" placeholder="0" value="1"></div>
            <div class="form-group"><label>Description</label><textarea id="productDesc" rows="2"></textarea></div>
            <div class="form-group"><label>Photo (optionnel)</label><input type="file" id="productPhoto" accept="image/*"></div>
            <button class="btn-submit" onclick="addProductToShop(${shop.id})">Ajouter le produit</button>
            <button class="btn-sm btn-outline" style="margin-top:12px;" onclick="this.closest('.modal').remove()">Annuler</button>
        </div>`;
    document.body.appendChild(modal);
}

function addProductToShop(shopId) {
    const name = document.getElementById('productName').value.trim();
    const price = parseFloat(document.getElementById('productPrice').value);
    const stock = parseInt(document.getElementById('productStock').value);
    const category = document.getElementById('productCategory').value.trim();
    const description = document.getElementById('productDesc').value;
    const fileInput = document.getElementById('productPhoto');
    
    if (!name || !price || stock < 0) {
        alert("Nom, prix et stock sont obligatoires");
        return;
    }
    
    const shop = shops.find(s => s.id === shopId);
    if (shop) {
        const newProduct = {
            id: Date.now(),
            name: name,
            price: price,
            category: category || "Général",
            stock: stock,
            description: description,
            photos: [],
            productType: "standard"
        };
        
        if (fileInput.files && fileInput.files[0]) {
            const reader = new FileReader();
            reader.onload = function(e) {
                newProduct.photos = [e.target.result];
                shop.products.push(newProduct);
                if (category && !(shop.categories || []).includes(category)) {
                    shop.categories = shop.categories || [];
                    shop.categories.push(category);
                }
                localStorage.setItem('ouenze_shops', JSON.stringify(shops));
                alert(`Produit "${name}" ajouté avec succès (Stock: ${stock})`);
                document.querySelector('.modal.active')?.remove();
                showDashboard();
            };
            reader.readAsDataURL(fileInput.files[0]);
        } else {
            shop.products.push(newProduct);
            if (category && !(shop.categories || []).includes(category)) {
                shop.categories = shop.categories || [];
                shop.categories.push(category);
            }
            localStorage.setItem('ouenze_shops', JSON.stringify(shops));
            alert(`Produit "${name}" ajouté avec succès (Stock: ${stock})`);
            document.querySelector('.modal.active')?.remove();
            showDashboard();
        }
    }
}

function openRestockToShop(shopId) {
    const shop = shops.find(s => s.id === shopId);
    if (!shop || !shop.products || shop.products.length === 0) {
        alert("Aucun produit à ravitailler");
        return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card">
            <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            <h3 style="margin-bottom: 20px;">Ravitaillement - ${escapeHtml(shop.name)}</h3>
            <div class="form-group"><label>Produit</label>
                <select id="restockProduct">
                    ${shop.products.map(p => `<option value="${p.id}" data-stock="${p.stock || 0}">${escapeHtml(p.name)} - Stock actuel: ${p.stock || 0}</option>`).join('')}
                </select>
            </div>
            <div class="form-group"><label>Quantité à ajouter *</label><input type="number" id="restockQuantity" placeholder="0" value="1" min="1"></div>
            <button class="btn-submit" onclick="processRestock(${shop.id})">Ajouter au stock</button>
            <button class="btn-sm btn-outline" style="margin-top:12px;" onclick="this.closest('.modal').remove()">Annuler</button>
        </div>`;
    document.body.appendChild(modal);
}

function processRestock(shopId) {
    const productId = parseInt(document.getElementById('restockProduct').value);
    const quantity = parseInt(document.getElementById('restockQuantity').value);
    
    if (!quantity || quantity <= 0) {
        alert("Quantité invalide");
        return;
    }
    
    const shop = shops.find(s => s.id === shopId);
    const product = shop?.products?.find(p => p.id === productId);
    
    if (product) {
        product.stock = (product.stock || 0) + quantity;
        localStorage.setItem('ouenze_shops', JSON.stringify(shops));
        alert(`Stock mis à jour: ${product.name} → ${product.stock} unités (+${quantity})`);
        document.querySelector('.modal.active')?.remove();
        showDashboard();
    }
}

function openAddProduct() {
    const userShops = shops.filter(s => s.owner === currentUser.email);
    if (!userShops.length) {
        alert("Créez d'abord une boutique");
        return;
    }
    openAddProductToShop(userShops[0].id);
}

function openRestock() {
    const userShops = shops.filter(s => s.owner === currentUser.email);
    if (!userShops.length) {
        alert("Créez d'abord une boutique");
        return;
    }
    openRestockToShop(userShops[0].id);
}

// ============ VENTE DE BOUTIQUE ============
function openSellShopModal(shopId) {
    const shop = shops.find(s => s.id === shopId);
    if (!shop) return;
    
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card">
            <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            <h3 style="margin-bottom: 20px;">Vendre la boutique</h3>
            <div style="background:var(--gray-200);padding:12px;border-radius:12px;margin-bottom:16px;">
                <strong>${escapeHtml(shop.name)}</strong><br>
                Valorisation estimée: ${calculateValuation(shop).toLocaleString()} FCFA
            </div>
            <div class="form-group">
                <label>Action à effectuer</label>
                <select id="sellAction" style="width:100%;padding:10px; background:var(--gray-200); border:1px solid var(--gray-200); border-radius:10px; color:white;">
                    <option value="transfer">Affecter la boutique à un nouvel acheteur</option>
                    <option value="delete">Supprimer définitivement la boutique</option>
                </select>
            </div>
            <div id="buyerFields">
                <div class="form-group"><label>Email de l'acheteur</label><input type="email" id="buyerEmail" placeholder="acheteur@email.com"></div>
                <div class="form-group"><label>Nom complet de l'acheteur</label><input type="text" id="buyerName" placeholder="Nom et prénom"></div>
                <div class="form-group"><label>Prix de vente (FCFA)</label><input type="number" id="salePrice" placeholder="0" value="${calculateValuation(shop)}"></div>
            </div>
            <div id="deleteWarning" style="display:none; background:#fee2e2; padding:12px; border-radius:12px; margin-bottom:16px;">
                <i class="fas fa-exclamation-triangle"></i> Attention: Cette action est irréversible.
            </div>
            <button class="btn-submit" onclick="submitShopSale(${shop.id})">Confirmer</button>
            <button class="btn-sm btn-outline" style="margin-top:12px;" onclick="this.closest('.modal').remove()">Annuler</button>
        </div>`;
    document.body.appendChild(modal);
    
    document.getElementById('sellAction').addEventListener('change', (e) => {
        const buyerFields = document.getElementById('buyerFields');
        const deleteWarning = document.getElementById('deleteWarning');
        if (e.target.value === 'delete') {
            buyerFields.style.display = 'none';
            deleteWarning.style.display = 'block';
        } else {
            buyerFields.style.display = 'block';
            deleteWarning.style.display = 'none';
        }
    });
}

function submitShopSale(shopId) {
    const action = document.getElementById('sellAction').value;
    const shop = shops.find(s => s.id === shopId);
    
    if (action === 'transfer') {
        const buyerEmail = document.getElementById('buyerEmail').value.trim();
        const buyerName = document.getElementById('buyerName').value.trim();
        const salePrice = parseInt(document.getElementById('salePrice').value);
        
        if (!buyerEmail || !buyerName || !salePrice) {
            alert("Veuillez remplir tous les champs");
            return;
        }
        
        const purchaseLink = `${window.location.origin}/purchase-shop.html?shop=${shopId}&email=${encodeURIComponent(buyerEmail)}&price=${salePrice}`;
        console.log(`📧 Email envoyé à ${buyerEmail}`);
        alert(`✅ Demande envoyée à ${buyerEmail}\n\nUn email contenant le lien pour finaliser l'acquisition a été envoyé.`);
        
        let saleRequests = JSON.parse(localStorage.getItem('ouenze_shop_sales') || '[]');
        saleRequests.push({
            id: Date.now(),
            shopId,
            shopName: shop.name,
            seller: currentUser.email,
            buyerEmail,
            buyerName,
            price: salePrice,
            date: new Date().toISOString(),
            status: 'pending'
        });
        localStorage.setItem('ouenze_shop_sales', JSON.stringify(saleRequests));
    } else if (action === 'delete') {
        if (confirm(`Êtes-vous sûr de vouloir supprimer définitivement la boutique "${shop.name}" ?`)) {
            const index = shops.findIndex(s => s.id === shopId);
            if (index !== -1) {
                shops.splice(index, 1);
                localStorage.setItem('ouenze_shops', JSON.stringify(shops));
                alert(`Boutique "${shop.name}" supprimée avec succès.`);
                document.querySelector('.modal.active')?.remove();
                showDashboard();
            }
        }
    }
    document.querySelector('.modal.active')?.remove();
}

// ============ INVESTISSEMENTS ============
function openInvestmentOffer(shopId) {
    const shop = shops.find(s => s.id === shopId);
    if (!shop || shop.rating < 3) {
        alert("Cette boutique n'est pas éligible (minimum 3 étoiles)");
        return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card">
            <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            <h3 style="margin-bottom: 20px;">Proposer à l'investissement</h3>
            <div style="background:var(--gray-200);padding:12px;border-radius:12px;margin-bottom:16px;">
                Boutique: ${escapeHtml(shop.name)}<br>
                Note actuelle: ${shop.rating}/5<br>
                Valorisation estimée: ${calculateValuation(shop).toLocaleString()} FCFA
            </div>
            <div class="form-group"><label>Pourcentage du capital à céder</label><input type="number" id="offerPercent" min="1" max="100" value="10"></div>
            <div class="form-group"><label>Prix demandé (FCFA)</label><input type="number" id="offerPrice" placeholder="0"></div>
            <div class="form-group"><label>Message aux investisseurs</label><textarea id="offerMessage" rows="3"></textarea></div>
            <button class="btn-submit" onclick="submitInvestmentOffer(${shop.id})">Envoyer la demande</button>
            <button class="btn-sm btn-outline" style="margin-top:12px;" onclick="this.closest('.modal').remove()">Annuler</button>
        </div>`;
    document.body.appendChild(modal);
}

function submitInvestmentOffer(shopId) {
    const shop = shops.find(s => s.id === shopId);
    const percent = parseInt(document.getElementById('offerPercent').value);
    const price = parseInt(document.getElementById('offerPrice').value);
    const message = document.getElementById('offerMessage').value;
    
    if (!percent || percent < 1 || percent > 100) {
        alert("Pourcentage invalide (1-100%)");
        return;
    }
    if (!price || price < 10000) {
        alert("Prix minimum 10 000 FCFA");
        return;
    }
    
    const offer = {
        id: Date.now(),
        shopId,
        shopName: shop.name,
        seller: currentUser.email,
        sellerName: currentUser.name,
        percentage: percent,
        price,
        valuation: calculateValuation(shop),
        message,
        date: new Date().toISOString(),
        status: 'pending_review'
    };
    
    let offers = JSON.parse(localStorage.getItem('ouenze_investment_offers') || '[]');
    offers.push(offer);
    localStorage.setItem('ouenze_investment_offers', JSON.stringify(offers));
    
    alert(`Demande envoyée !\n\nNotre équipe examinera votre proposition sous 48h.\nUn email de confirmation a été envoyé.`);
    document.querySelector('.modal')?.remove();
    showDashboard();
}

function openInvestmentRequests() {
    const userShops = shops.filter(s => s.owner === currentUser.email);
    const relevantRequests = investmentRequests.filter(r => 
        userShops.some(s => s.id === r.shopId) && 
        r.status === 'pending_review'
    );
    
    if (!relevantRequests.length) {
        alert("Aucune demande en attente");
        return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card">
            <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            <h3 style="margin-bottom: 20px;">Demandes d'investissement</h3>
            ${relevantRequests.map(r => `
                <div style="background:var(--gray-200);padding:16px;border-radius:12px;margin-bottom:16px;">
                    <strong>${r.type === 'buy_shares' ? 'Achat d\'actions' : r.type === 'sell_shares' ? 'Vente d\'actions' : 'Acquisition'}</strong><br>
                    Investisseur: ${escapeHtml(r.investorName)}<br>
                    ${r.type === 'buy_shares' ? `Quantité: ${r.quantity} actions<br>Prix total: ${r.total.toLocaleString()} FCFA` : 
                      r.type === 'sell_shares' ? `Quantité: ${r.quantity} actions<br>Prix total: ${r.total.toLocaleString()} FCFA` :
                      `Offre: ${r.amount.toLocaleString()} FCFA`}<br>
                    Date: ${new Date(r.date).toLocaleDateString()}<br>
                    <div style="margin-top:12px; display:flex; gap:8px;">
                        <button class="btn-sm btn-primary" onclick="approveInvestmentRequest('${r.id}')">Approuver</button>
                        <button class="btn-sm btn-danger" onclick="rejectInvestmentRequest('${r.id}')">Refuser</button>
                    </div>
                </div>
            `).join('')}
            <button onclick="this.closest('.modal').remove()" class="btn-sm btn-outline">Fermer</button>
        </div>`;
    document.body.appendChild(modal);
}

function approveInvestmentRequest(requestId) {
    if (window.approveBuyRequest) {
        const success = window.approveBuyRequest(requestId);
        if (success) {
            alert("✅ Demande approuvée ! Le portefeuille de l'investisseur a été mis à jour.");
            document.querySelector('.modal.active')?.remove();
            showDashboard();
        } else {
            alert("❌ Erreur lors de l'approbation");
        }
    } else {
        console.error("database.js non chargé");
        alert("Erreur système");
    }
}

function rejectInvestmentRequest(requestId) {
    let requests = JSON.parse(localStorage.getItem('ouenze_investment_requests') || '[]');
    const request = requests.find(r => r.id === requestId);
    if (request) {
        request.status = 'rejected';
        localStorage.setItem('ouenze_investment_requests', JSON.stringify(requests));
        alert("Demande refusée.");
        document.querySelector('.modal.active')?.remove();
        showDashboard();
    }
}

// ============ STATISTIQUES ============
function viewStats(shopId) {
    const shop = shops.find(s => s.id === shopId);
    if (!shop) return;
    
    const shopOrders = orders.filter(o => o.items?.some(i => i.shopId === shopId));
    const monthlyData = [];
    
    for (let i = 5; i >= 0; i--) {
        const target = new Date();
        target.setMonth(target.getMonth() - i);
        const month = target.getMonth();
        const year = target.getFullYear();
        monthlyData.push(shopOrders.filter(o => {
            const d = new Date(o.date);
            return d.getMonth() === month && d.getFullYear() === year;
        }).reduce((s, o) => s + (o.total || 0), 0));
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card" style="max-width:700px;">
            <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            <h3 style="margin-bottom: 20px;">Statistiques - ${escapeHtml(shop.name)}</h3>
            <div style="height: 250px;"><canvas id="statsChart"></canvas></div>
            <div style="background:var(--gray-200);padding:12px;border-radius:12px;margin-top:16px;">
                <strong>Chiffre d'affaires total:</strong> ${shopOrders.reduce((s, o) => s + (o.total || 0), 0).toLocaleString()} FCFA<br>
                <strong>Commandes:</strong> ${shopOrders.length}<br>
                <strong>Note moyenne:</strong> ${shop.rating || 0}/5 (${shop.totalRatings || 0} avis)
            </div>
            <button class="btn-sm btn-outline" style="margin-top:16px;" onclick="this.closest('.modal').remove()">Fermer</button>
        </div>`;
    document.body.appendChild(modal);
    
    setTimeout(() => {
        const ctx = document.getElementById('statsChart')?.getContext('2d');
        if (ctx) {
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: ['Mois -5', 'Mois -4', 'Mois -3', 'Mois -2', 'Mois -1', 'Ce mois'],
                    datasets: [{
                        label: 'CA (FCFA)',
                        data: monthlyData,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59,130,246,0.1)',
                        fill: true,
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: { labels: { color: '#9ca3af' } }
                    }
                }
            });
        }
    }, 100);
}

// ============ AUTRES FONCTIONS ============
function copyShopLink(url) {
    navigator.clipboard.writeText(url);
    alert("Lien de la boutique copié !");
}

function openShopDesigner(shopId) {
    window.open(`shop-designer.html?edit=${shopId}`, '_blank');
}

function createNewShop() {
    alert("Un email avec le lien de création a été envoyé");
    window.open('shop-designer.html', '_blank');
}

// ============ INITIALISATION ============
function init() {
    currentUser = JSON.parse(localStorage.getItem('ouenze_current_user') || 'null');
    shops = JSON.parse(localStorage.getItem('ouenze_shops') || '[]');
    orders = JSON.parse(localStorage.getItem('ouenze_orders') || '[]');
    investmentRequests = JSON.parse(localStorage.getItem('ouenze_investment_requests') || '[]');
    
    if (!currentUser || currentUser.type !== 'vendeur') {
        window.location.href = 'index.html';
        return;
    }
    
    document.getElementById('userAvatar').innerText = currentUser.name.charAt(0).toUpperCase();
    document.getElementById('userName').innerText = currentUser.name;
    
    showDashboard();
}

// Nettoyage avant déchargement
window.addEventListener('beforeunload', () => {
    Object.keys(activeCharts).forEach(key => {
        if (activeCharts[key]) activeCharts[key].destroy();
    });
});

// Démarrage
init();