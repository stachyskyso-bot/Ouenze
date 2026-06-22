// ============ VARIABLES GLOBALES ============
let currentUser = null;
let deliveryRequests = [];
let orders = [];
let shops = [];
let deliveries = [];
let currentTab = 'available';
let isOnline = true;
let currentDeliveryUser = null;

// ============ FONCTIONS UTILITAIRES ============
function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>]/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;'
    }[m]));
}

function calculateDeliveryFee(shopId, totalAmount) {
    const baseFee = 1500;
    const percentageFee = totalAmount * 0.05;
    return Math.max(baseFee, Math.min(percentageFee, 5000));
}

function getStatusText(status) {
    const statusMap = {
        accepted: 'Acceptée',
        delivering: 'En livraison',
        completed: 'Livrée',
        pending: 'En attente'
    };
    return statusMap[status] || status;
}

// ============ GESTION DES DONNÉES ============
function getAvailableDeliveries() {
    // Commandes en attente de livraison
    const pendingOrders = orders.filter(o => o.status === 'confirmée' && !o.deliveryId);
    return pendingOrders.map(order => {
        const shop = shops.find(s => s.id === order.items[0]?.shopId);
        const deliveryFee = calculateDeliveryFee(shop?.id, order.total);
        return { ...order, deliveryFee, shop };
    });
}

function getMyDeliveries() {
    return deliveries.filter(d => d.deliveryUserId === currentUser.email && d.status !== 'completed');
}

function getDeliveryHistory() {
    return deliveries.filter(d => d.deliveryUserId === currentUser.email && d.status === 'completed');
}

// ============ ACTIONS DE LIVRAISON ============
function acceptDelivery(orderId, fee) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    
    const newDelivery = {
        id: Date.now(),
        orderId: orderId,
        deliveryUserId: currentUser.email,
        deliveryUserName: currentUser.name,
        fee: fee,
        status: 'accepted',
        date: new Date().toISOString(),
        shopId: order.items[0]?.shopId,
        customerName: order.userName,
        customerPhone: order.deliveryInfo?.phone,
        customerAddress: `${order.deliveryInfo?.quartier || ''}, ${order.deliveryInfo?.address || ''}`,
        shopName: shops.find(s => s.id === order.items[0]?.shopId)?.name
    };
    
    deliveries.push(newDelivery);
    localStorage.setItem('ouenze_deliveries', JSON.stringify(deliveries));
    
    // Mettre à jour la commande
    order.deliveryId = newDelivery.id;
    order.deliveryStatus = 'accepted';
    localStorage.setItem('ouenze_orders', JSON.stringify(orders));
    
    // Notifications
    console.log(`📧 Notification envoyée au client ${order.userName}: Un livreur a accepté votre livraison !`);
    console.log(`📧 Notification envoyée au vendeur: Le livreur ${currentUser.name} a accepté la livraison`);
    
    alert(`✅ Livraison acceptée !\n\nClient: ${order.userName}\nTéléphone: ${order.deliveryInfo?.phone}\nAdresse: ${order.deliveryInfo?.quartier}, ${order.deliveryInfo?.address}\n\nUn email de confirmation a été envoyé.`);
    
    renderPage();
}

function updateDeliveryStatus(deliveryId, newStatus) {
    const delivery = deliveries.find(d => d.id == deliveryId);
    if (!delivery) return;
    
    delivery.status = newStatus;
    
    if (newStatus === 'completed') {
        delivery.completedDate = new Date().toISOString();
        
        // Mettre à jour les gains du livreur
        if (currentDeliveryUser) {
            currentDeliveryUser.earnings = (currentDeliveryUser.earnings || 0) + delivery.fee;
            currentDeliveryUser.deliveries = (currentDeliveryUser.deliveries || 0) + 1;
            
            const index = deliveryRequests.findIndex(d => d.email === currentUser.email);
            if (index !== -1) {
                deliveryRequests[index] = currentDeliveryUser;
                localStorage.setItem('ouenze_delivery_requests', JSON.stringify(deliveryRequests));
            }
        }
        
        // Mettre à jour la commande
        const order = orders.find(o => o.id === delivery.orderId);
        if (order) {
            order.deliveryStatus = newStatus;
            order.status = 'livrée';
            localStorage.setItem('ouenze_orders', JSON.stringify(orders));
        }
        
        // Ouvrir la modale de notation
        openRatingModal(delivery.orderId);
    }
    
    localStorage.setItem('ouenze_deliveries', JSON.stringify(deliveries));
    renderPage();
}

function viewDeliveryDetails(deliveryId) {
    const delivery = deliveries.find(d => d.id == deliveryId);
    if (delivery) {
        alert(`📦 Détails de la livraison\n\nCommande: #${delivery.orderId}\nClient: ${delivery.customerName}\nTéléphone: ${delivery.customerPhone}\nAdresse: ${delivery.customerAddress}\nBoutique: ${delivery.shopName}\nStatut: ${getStatusText(delivery.status)}\nGain: ${delivery.fee.toLocaleString()} FCFA`);
    }
}

// ============ NOTATION ============
function openRatingModal(orderId) {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card">
            <div class="modal-header">
                <h3>Noter le livreur</h3>
                <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            </div>
            <div class="form-group">
                <label>Note (1 à 5 étoiles)</label>
                <div class="rating-stars" id="ratingStars">
                    <i class="far fa-star" data-value="1"></i>
                    <i class="far fa-star" data-value="2"></i>
                    <i class="far fa-star" data-value="3"></i>
                    <i class="far fa-star" data-value="4"></i>
                    <i class="far fa-star" data-value="5"></i>
                </div>
            </div>
            <div class="form-group">
                <label>Commentaire</label>
                <textarea id="ratingComment" rows="3" placeholder="Votre avis sur le livreur..."></textarea>
            </div>
            <button class="btn-primary" onclick="window.submitDeliveryRating('${orderId}')">Envoyer ma note</button>
            <button onclick="this.closest('.modal').remove()" style="margin-top:12px;background:none;border:none;cursor:pointer;width:100%;">Passer</button>
        </div>
    `;
    document.body.appendChild(modal);
    
    let selectedRating = 0;
    const stars = modal.querySelectorAll('#ratingStars i');
    stars.forEach(star => {
        star.addEventListener('click', () => {
            selectedRating = parseInt(star.dataset.value);
            stars.forEach((s, idx) => {
                if (idx < selectedRating) {
                    s.className = 'fas fa-star active';
                } else {
                    s.className = 'far fa-star';
                }
            });
        });
    });
}

function submitDeliveryRating(orderId) {
    const comment = document.getElementById('ratingComment')?.value || '';
    const selectedRating = document.querySelectorAll('#ratingStars i.active').length;
    
    if (selectedRating === 0) {
        alert("Veuillez sélectionner une note");
        return;
    }
    
    const delivery = deliveries.find(d => d.orderId === orderId);
    if (delivery) {
        delivery.rating = selectedRating;
        delivery.comment = comment;
        localStorage.setItem('ouenze_deliveries', JSON.stringify(deliveries));
        
        // Mettre à jour la note moyenne du livreur
        const allDeliveries = deliveries.filter(d => d.deliveryUserId === currentUser.email && d.rating);
        if (allDeliveries.length > 0) {
            const avgRating = allDeliveries.reduce((s, d) => s + d.rating, 0) / allDeliveries.length;
            if (currentDeliveryUser) {
                currentDeliveryUser.rating = avgRating.toFixed(1);
                const index = deliveryRequests.findIndex(d => d.email === currentUser.email);
                if (index !== -1) {
                    deliveryRequests[index] = currentDeliveryUser;
                    localStorage.setItem('ouenze_delivery_requests', JSON.stringify(deliveryRequests));
                }
            }
        }
    }
    
    alert("Merci pour votre avis !");
    document.querySelector('.modal.active')?.remove();
    renderPage();
}

// ============ STATUT ============
function setStatus(online) {
    isOnline = online;
    renderPage();
}

// ============ DÉCONNEXION ============
function logout() {
    localStorage.removeItem('ouenze_current_user');
    window.location.href = 'index.html';
}

// ============ AFFICHAGE ============
function renderPage() {
    const container = document.getElementById('appContainer');
    if (!container) return;
    
    if (currentTab === 'available') {
        const availableDeliveries = getAvailableDeliveries();
        container.innerHTML = `
            <div class="status-toggle">
                <button class="status-btn ${isOnline ? 'active' : ''}" onclick="setStatus(true)">En ligne</button>
                <button class="status-btn ${!isOnline ? 'active' : ''}" onclick="setStatus(false)">Hors ligne</button>
            </div>
            <div class="stats-grid">
                <div class="stat-card">
                    <h3>Gains totaux</h3>
                    <div class="stat-value">${(currentDeliveryUser?.earnings || 0).toLocaleString()} FCFA</div>
                </div>
                <div class="stat-card">
                    <h3>Livraisons effectuées</h3>
                    <div class="stat-value">${currentDeliveryUser?.deliveries || 0}</div>
                </div>
                <div class="stat-card">
                    <h3>Note moyenne</h3>
                    <div class="stat-value">${currentDeliveryUser?.rating || 0}/5</div>
                </div>
            </div>
            <h3 class="section-title">📦 Livraisons disponibles (${isOnline ? availableDeliveries.length : 'hors ligne'})</h3>
            <div class="orders-list">
                ${isOnline && availableDeliveries.length ? availableDeliveries.map(order => `
                    <div class="order-item">
                        <div class="order-info">
                            <h4>${escapeHtml(order.shop?.name || 'Boutique')}</h4>
                            <p>📍 ${escapeHtml(order.shop?.quartier || 'Quartier')} → ${escapeHtml(order.deliveryInfo?.quartier || 'Livraison')}</p>
                            <p>🛒 ${order.items.length} produit(s) - Total: ${order.total.toLocaleString()} FCFA</p>
                            <div class="order-items">📦 ${order.items.map(i => i.productName).join(', ')}</div>
                        </div>
                        <div class="order-actions">
                            <div class="delivery-fee">💰 ${order.deliveryFee.toLocaleString()} FCFA</div>
                            <button class="btn-accept" onclick="acceptDelivery('${order.id}', ${order.deliveryFee})">Accepter</button>
                        </div>
                    </div>
                `).join('') : `
                    <div class="empty-state">
                        <i class="fas fa-box-open"></i>
                        <p>Aucune livraison disponible pour le moment</p>
                    </div>
                `}
            </div>
        `;
    } else if (currentTab === 'active') {
        const myDeliveries = getMyDeliveries();
        container.innerHTML = `
            <h3 class="section-title">🚚 Mes livraisons en cours</h3>
            <div class="orders-list">
                ${myDeliveries.length ? myDeliveries.map(delivery => {
                    const order = orders.find(o => o.id === delivery.orderId);
                    const shop = shops.find(s => s.id === order?.items[0]?.shopId);
                    return `
                        <div class="order-item">
                            <div class="order-info">
                                <h4>Commande #${delivery.orderId}</h4>
                                <p>🏪 ${escapeHtml(shop?.name)} → 📍 ${escapeHtml(order?.deliveryInfo?.quartier)}</p>
                                <p>👤 Client: ${escapeHtml(order?.userName)} - 📞 ${escapeHtml(order?.deliveryInfo?.phone)}</p>
                                <p>📦 Produits: ${order?.items.map(i => i.productName).join(', ')}</p>
                                <p>💰 Livraison: ${delivery.fee.toLocaleString()} FCFA</p>
                                <div style="margin-top:8px;">
                                    <span class="delivery-status status-${delivery.status === 'accepted' ? 'accepted' : delivery.status === 'delivering' ? 'delivering' : 'completed'}">
                                        ${getStatusText(delivery.status)}
                                    </span>
                                </div>
                            </div>
                            <div class="order-actions">
                                ${delivery.status === 'accepted' ? `
                                    <button class="btn-accept" onclick="updateDeliveryStatus('${delivery.id}', 'delivering')">Démarrer livraison</button>
                                ` : ''}
                                ${delivery.status === 'delivering' ? `
                                    <button class="btn-accept" onclick="updateDeliveryStatus('${delivery.id}', 'completed')">Marquer livrée</button>
                                ` : ''}
                                <button class="btn-accept btn-warning" style="margin-top:8px;" onclick="viewDeliveryDetails('${delivery.id}')">Détails</button>
                            </div>
                        </div>
                    `;
                }).join('') : `
                    <div class="empty-state">
                        <i class="fas fa-truck"></i>
                        <p>Aucune livraison en cours</p>
                    </div>
                `}
            </div>
        `;
    } else if (currentTab === 'history') {
        const history = getDeliveryHistory();
        container.innerHTML = `
            <h3 class="section-title">📋 Historique des livraisons</h3>
            <div class="orders-list">
                ${history.length ? history.map(delivery => {
                    const order = orders.find(o => o.id === delivery.orderId);
                    return `
                        <div class="order-item">
                            <div class="order-info">
                                <h4>Commande #${delivery.orderId}</h4>
                                <p>📅 ${new Date(delivery.completedDate || delivery.date).toLocaleDateString()}</p>
                                <p>💰 Gain: ${delivery.fee.toLocaleString()} FCFA</p>
                                ${delivery.rating ? `<p>⭐ Note reçue: ${delivery.rating}/5</p>` : ''}
                                ${delivery.comment ? `<p>💬 Commentaire: "${escapeHtml(delivery.comment)}"</p>` : ''}
                            </div>
                        </div>
                    `;
                }).join('') : `
                    <div class="empty-state">
                        <i class="fas fa-history"></i>
                        <p>Aucun historique de livraison</p>
                    </div>
                `}
            </div>
        `;
    } else if (currentTab === 'profile') {
        container.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <h3>Statut</h3>
                    <div class="stat-value ${currentDeliveryUser?.status === 'approved' ? 'positive' : ''}">
                        ${currentDeliveryUser?.status === 'approved' ? '✅ Actif' : currentDeliveryUser?.status === 'pending' ? '⏳ En attente' : '❌ Suspendu'}
                    </div>
                </div>
                <div class="stat-card">
                    <h3>Livraisons</h3>
                    <div class="stat-value">${currentDeliveryUser?.deliveries || 0}</div>
                </div>
                <div class="stat-card">
                    <h3>Gains totaux</h3>
                    <div class="stat-value">${(currentDeliveryUser?.earnings || 0).toLocaleString()} FCFA</div>
                </div>
                <div class="stat-card">
                    <h3>Note</h3>
                    <div class="stat-value">${currentDeliveryUser?.rating || 0}/5</div>
                </div>
            </div>
            <div class="profile-info">
                <p><strong>👤 Nom:</strong> ${escapeHtml(currentDeliveryUser?.fullName)}</p>
                <p><strong>📞 Téléphone:</strong> ${escapeHtml(currentDeliveryUser?.phone)}</p>
                <p><strong>📍 Ville:</strong> ${escapeHtml(currentDeliveryUser?.city)}</p>
                <p><strong>🏠 Quartier:</strong> ${escapeHtml(currentDeliveryUser?.quartier)}</p>
                <p><strong>📧 Email:</strong> ${escapeHtml(currentDeliveryUser?.email)}</p>
                <p><strong>📅 Inscription:</strong> ${currentDeliveryUser?.date ? new Date(currentDeliveryUser.date).toLocaleDateString() : 'Non renseignée'}</p>
            </div>
            <button class="btn-primary" style="margin-top:20px;" onclick="logout()">Se déconnecter</button>
        `;
    }
}

// ============ NAVIGATION ============
function setupNavigation() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentTab = tab.dataset.tab;
            renderPage();
        });
    });
}

// ============ INITIALISATION ============
function init() {
    // Récupérer les données
    currentUser = JSON.parse(localStorage.getItem('ouenze_current_user') || 'null');
    deliveryRequests = JSON.parse(localStorage.getItem('ouenze_delivery_requests') || '[]');
    orders = JSON.parse(localStorage.getItem('ouenze_orders') || '[]');
    shops = JSON.parse(localStorage.getItem('ouenze_shops') || '[]');
    deliveries = JSON.parse(localStorage.getItem('ouenze_deliveries') || '[]');
    
    // Vérifier si l'utilisateur est un livreur validé
    if (currentUser && currentUser.type === 'livreur') {
        currentDeliveryUser = deliveryRequests.find(d => d.email === currentUser.email && d.status === 'approved');
        
        if (!currentDeliveryUser) {
            alert("Votre compte livreur n'est pas encore activé. Veuillez attendre la validation.");
            window.location.href = 'index.html';
            return;
        }
    } else {
        // Rediriger si ce n'est pas un livreur
        window.location.href = 'index.html';
        return;
    }
    
    // Mettre à jour l'interface utilisateur
    const userAvatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');
    if (userAvatar) userAvatar.innerText = currentUser.name.charAt(0).toUpperCase();
    if (userName) userName.innerText = currentUser.name;
    
    // Configurer la navigation
    setupNavigation();
    
    // Afficher la page
    renderPage();
}

// Exports globaux
window.setStatus = setStatus;
window.acceptDelivery = acceptDelivery;
window.updateDeliveryStatus = updateDeliveryStatus;
window.viewDeliveryDetails = viewDeliveryDetails;
window.submitDeliveryRating = submitDeliveryRating;
window.logout = logout;

// Démarrer l'application
init();