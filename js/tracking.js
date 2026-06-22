// ============ CONSTANTES ============
const deliverySteps = [
    { name: 'Commande confirmée', icon: 'fa-check-circle', duration: 2000 },
    { name: 'Préparation en cours', icon: 'fa-box', duration: 3000 },
    { name: 'Expédiée', icon: 'fa-shipping-fast', duration: 2500 },
    { name: 'En transit', icon: 'fa-truck', duration: 4000 },
    { name: 'Arrivée en ville', icon: 'fa-city', duration: 3000 },
    { name: 'Livrée', icon: 'fa-home', duration: 0 }
];

// ============ VARIABLES GLOBALES ============
let currentUser = null;
let orders = [];
let shops = [];
let currentOrder = null;
let trackingInterval = null;

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

function formatDate(date) {
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'Date inconnue';
    return d.toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function updateUserUI() {
    const userAvatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');
    
    if (currentUser) {
        if (userAvatar) userAvatar.innerText = currentUser.name.charAt(0).toUpperCase();
        if (userName) userName.innerText = currentUser.name.split(' ')[0];
    } else {
        if (userAvatar) userAvatar.innerText = 'U';
        if (userName) userName.innerText = 'Invité';
    }
}

function getStepProgress(order) {
    if (!order) return 0;
    const stepIndex = order.trackingStep || 1;
    return (stepIndex / deliverySteps.length) * 100;
}

// ============ GESTION DES NOTES ============
function submitRating(orderId, rating, comment) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return false;
    
    // Récupérer les IDs uniques des boutiques concernées
    const shopIds = [...new Set(order.items.map(i => i.shopId))];
    
    shopIds.forEach(shopId => {
        const shop = shops.find(s => s.id === shopId);
        if (shop) {
            shop.totalRatings = (shop.totalRatings || 0) + 1;
            shop.ratingSum = (shop.ratingSum || 0) + rating;
            shop.rating = (shop.ratingSum / shop.totalRatings).toFixed(1);
            shop.reviews = shop.reviews || [];
            shop.reviews.unshift({
                user: currentUser?.name || 'Client',
                rating: rating,
                comment: comment,
                date: new Date().toISOString()
            });
            // Limiter à 20 avis récents
            if (shop.reviews.length > 20) shop.reviews.pop();
        }
    });
    
    order.rated = true;
    localStorage.setItem('ouenze_shops', JSON.stringify(shops));
    localStorage.setItem('ouenze_orders', JSON.stringify(orders));
    
    // Simulation d'envoi d'email
    console.log(`📧 Email envoyé à ${currentUser?.email || 'client@email.com'}`);
    console.log(`Merci pour votre avis sur la commande ${orderId}`);
    console.log(`Note: ${rating}/5 - Commentaire: ${comment || 'Aucun commentaire'}`);
    
    return true;
}

function openRatingModal() {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card">
            <div class="modal-header">
                <h3>Noter votre commande</h3>
                <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            </div>
            <p>Commande #${escapeHtml(currentOrder.id)}</p>
            <div class="rating-stars" id="ratingStars">
                <i class="far fa-star" data-value="1"></i>
                <i class="far fa-star" data-value="2"></i>
                <i class="far fa-star" data-value="3"></i>
                <i class="far fa-star" data-value="4"></i>
                <i class="far fa-star" data-value="5"></i>
            </div>
            <textarea id="reviewComment" class="review-textarea" rows="3" placeholder="Votre commentaire (optionnel)"></textarea>
            <button class="btn-primary" onclick="window.handleRatingSubmit()">Envoyer mon avis</button>
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
    
    window.handleRatingSubmit = () => {
        if (selectedRating === 0) {
            alert("Veuillez sélectionner une note");
            return;
        }
        
        const comment = modal.querySelector('#reviewComment').value;
        const success = submitRating(currentOrder.id, selectedRating, comment);
        
        if (success) {
            alert(`✅ Merci pour votre avis !\n\nUn email de confirmation a été envoyé à ${currentUser?.email || 'votre email'}\n\nVotre note aide les vendeurs à s'améliorer.`);
            modal.remove();
            renderTracking();
        } else {
            alert("Une erreur est survenue");
        }
    };
}

// ============ AFFICHAGE DU SUIVI ============
function renderTracking() {
    const container = document.getElementById('appContainer');
    if (!container) return;
    
    if (!currentOrder) {
        container.innerHTML = `
            <div class="tracking-card">
                <div class="tracking-header">
                    <h2>Commande non trouvée</h2>
                    <p>Veuillez vérifier le numéro de commande</p>
                </div>
                <div class="tracking-body empty-state">
                    <i class="fas fa-search"></i>
                    <p>Aucune commande trouvée avec cet identifiant.</p>
                    <button onclick="window.location.href='index.html'" class="btn-primary btn-inline">Retour à l'accueil</button>
                </div>
            </div>
        `;
        return;
    }
    
    const stepIndex = currentOrder.trackingStep || 1;
    const progress = getStepProgress(currentOrder);
    const isCompleted = stepIndex >= deliverySteps.length;
    
    container.innerHTML = `
        <div class="tracking-card">
            <div class="tracking-header">
                <h2><i class="fas fa-truck"></i> Suivi de livraison</h2>
                <p>Commande #${escapeHtml(currentOrder.id)} - ${formatDate(currentOrder.date)}</p>
                <p><strong>Total:</strong> ${(currentOrder.total || 0).toLocaleString()} FCFA</p>
            </div>
            <div class="tracking-body">
                
                <!-- Jauge de progression -->
                <div class="progress-container">
                    <div class="progress-bar-bg">
                        <div class="progress-bar-fill" style="width: ${progress}%;"></div>
                    </div>
                    <div class="progress-stats">
                        <span>Commande</span>
                        <span>Préparation</span>
                        <span>Expédition</span>
                        <span>Transit</span>
                        <span>Livraison</span>
                    </div>
                </div>
                
                <!-- Animation voiture -->
                <div class="delivery-animation">
                    <div class="delivery-car"><i class="fas fa-truck"></i> Livraison en cours</div>
                    <div class="delivery-road"></div>
                    <div style="font-size:12px;color:var(--gray-500);margin-top:12px;">Votre colis est en route vers son destinataire</div>
                </div>
                
                <!-- Étapes -->
                <div class="steps-container">
                    ${deliverySteps.map((step, idx) => `
                        <div class="step ${idx + 1 < stepIndex ? 'completed' : idx + 1 === stepIndex ? 'active' : ''}">
                            <div class="step-icon"><i class="fas ${step.icon}"></i></div>
                            <div class="step-label">${escapeHtml(step.name)}</div>
                            ${currentOrder.statusHistory?.find(h => h.status === step.name) ? 
                                `<div class="step-date">${formatDate(currentOrder.statusHistory.find(h => h.status === step.name).date)}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
                
                <!-- Historique détaillé -->
                <div class="timeline">
                    <h3>Historique de livraison</h3>
                    ${currentOrder.statusHistory?.length ? currentOrder.statusHistory.map((h, idx) => `
                        <div class="timeline-item">
                            <div class="timeline-icon ${idx === 0 ? 'completed' : ''}">
                                <i class="fas ${deliverySteps.find(s => s.name === h.status)?.icon || 'fa-clock'}"></i>
                            </div>
                            <div class="timeline-content">
                                <div class="timeline-title">${escapeHtml(h.status)}</div>
                                <div class="timeline-desc">${escapeHtml(h.message || 'Mise à jour du statut')}</div>
                                <div class="timeline-date">${formatDate(h.date)}</div>
                            </div>
                        </div>
                    `).join('') : ''}
                </div>
                
                ${isCompleted && !currentOrder.rated ? `
                    <div class="review-section">
                        <i class="fas fa-star"></i>
                        <h3>Votre commande est livrée !</h3>
                        <p>Nous serions ravis de connaître votre avis sur cette boutique.</p>
                        <button onclick="window.openRatingModal()" class="btn-primary" style="margin-top:12px;">Noter et commenter</button>
                    </div>
                ` : ''}
                
                <button onclick="window.location.href='index.html'" class="btn-secondary">Retour à l'accueil</button>
            </div>
        </div>
    `;
}

// ============ SIMULATION DE SUIVI ============
function startTrackingSimulation() {
    if (!currentOrder || currentOrder.trackingStep >= deliverySteps.length || currentOrder.trackingSimulated) {
        return;
    }
    
    currentOrder.trackingSimulated = true;
    let currentStep = currentOrder.trackingStep || 1;
    
    function processNextStep() {
        if (currentStep >= deliverySteps.length) {
            if (trackingInterval) clearInterval(trackingInterval);
            // Envoyer email de livraison
            console.log(`📧 Email de livraison envoyé à ${currentUser?.email || 'client@email.com'}`);
            console.log(`Votre commande ${currentOrder.id} a été livrée avec succès !`);
            renderTracking();
            return;
        }
        
        const step = deliverySteps[currentStep - 1];
        currentOrder.trackingStep = currentStep;
        currentOrder.status = step.name;
        currentOrder.statusHistory = currentOrder.statusHistory || [];
        currentOrder.statusHistory.unshift({
            status: step.name,
            date: new Date().toISOString(),
            message: step.name === 'Livrée' ? 'Colis livré avec succès' : `Votre commande est ${step.name.toLowerCase()}`
        });
        
        localStorage.setItem('ouenze_orders', JSON.stringify(orders));
        renderTracking();
        
        // Simuler l'envoi d'email à chaque étape
        console.log(`📧 Email: Votre commande ${currentOrder.id} est ${step.name.toLowerCase()}`);
        
        currentStep++;
        
        if (currentStep <= deliverySteps.length) {
            const duration = deliverySteps[currentStep - 2]?.duration || 3000;
            setTimeout(processNextStep, duration);
        }
    }
    
    setTimeout(processNextStep, 1000);
}

// ============ CHARGEMENT DE LA COMMANDE ============
function loadOrder() {
    const urlParams = new URLSearchParams(window.location.search);
    const orderId = urlParams.get('id');
    
    if (orderId) {
        currentOrder = orders.find(o => o.id === orderId);
    } else if (currentUser) {
        const pendingOrders = orders.filter(o => 
            o.userId === currentUser.email && 
            o.trackingStep < deliverySteps.length
        );
        if (pendingOrders.length > 0) currentOrder = pendingOrders[0];
    }
    
    // Si aucune commande trouvée, prendre la dernière
    if (!currentOrder && orders.length > 0) {
        currentOrder = orders[orders.length - 1];
    }
    
    // Initialiser le tracking si nécessaire
    if (currentOrder && (!currentOrder.trackingStep || currentOrder.trackingStep === 0)) {
        currentOrder.trackingStep = 1;
        currentOrder.statusHistory = currentOrder.statusHistory || [];
        if (currentOrder.statusHistory.length === 0) {
            currentOrder.statusHistory.push({
                status: 'Commande confirmée',
                date: currentOrder.date || new Date().toISOString(),
                message: 'Votre commande a été confirmée'
            });
        }
        localStorage.setItem('ouenze_orders', JSON.stringify(orders));
    }
    
    renderTracking();
    
    if (currentOrder && currentOrder.trackingStep < deliverySteps.length && !currentOrder.trackingSimulated) {
        startTrackingSimulation();
    }
}

// ============ INITIALISATION ============
function init() {
    // Récupérer les données
    currentUser = JSON.parse(localStorage.getItem('ouenze_current_user') || 'null');
    orders = JSON.parse(localStorage.getItem('ouenze_orders') || '[]');
    shops = JSON.parse(localStorage.getItem('ouenze_shops') || '[]');
    
    // Mettre à jour l'interface utilisateur
    updateUserUI();
    
    // Charger la commande
    loadOrder();
}

// Nettoyage au déchargement
window.addEventListener('beforeunload', () => {
    if (trackingInterval) clearInterval(trackingInterval);
});

// Exports globaux pour les appels onclick
window.openRatingModal = openRatingModal;
window.handleRatingSubmit = null; // Sera défini dans openRatingModal

// Démarrer l'application
init();