// ============ VARIABLES GLOBALES ============
let deliveryRequests = [];
let deliveries = [];
let currentTab = 'pending';

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

// ============ MISE À JOUR DES STATISTIQUES ============
function updateStats() {
    const pendingCount = document.getElementById('pendingCount');
    const activeCount = document.getElementById('activeCount');
    const suspendedCount = document.getElementById('suspendedCount');
    const totalDeliveries = document.getElementById('totalDeliveries');
    
    if (pendingCount) pendingCount.innerText = deliveryRequests.filter(r => r.status === 'pending').length;
    if (activeCount) activeCount.innerText = deliveryRequests.filter(r => r.status === 'approved').length;
    if (suspendedCount) suspendedCount.innerText = deliveryRequests.filter(r => r.status === 'suspended').length;
    if (totalDeliveries) totalDeliveries.innerText = deliveries.length;
}

// ============ AFFICHAGE DES PHOTOS ============
function viewPhotos(requestId) {
    const request = deliveryRequests.find(r => r.id === requestId);
    if (!request) return;
    
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-card">
            <div class="modal-header">
                <h3>Documents de ${escapeHtml(request.fullName)}</h3>
                <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            </div>
            <div class="photo-gallery">
                <div class="photo-item">
                    <strong>📷 Photo de profil</strong>
                    <img src="${request.photo}" alt="Photo de profil">
                </div>
                <div class="photo-item">
                    <strong>🪪 Pièce d'identité</strong>
                    <img src="${request.idCard}" alt="Pièce d'identité">
                </div>
                <div class="photo-item">
                    <strong>🚗 Moyen de transport</strong>
                    <img src="${request.transport}" alt="Moyen de transport">
                </div>
            </div>
            <button class="btn-approve" style="margin-top:16px;" onclick="this.closest('.modal').remove()">Fermer</button>
        </div>
    `;
    document.body.appendChild(modal);
}

// ============ ENVOI D'EMAIL ============
function sendEmail(to, subject, body) {
    console.log(`📧 Email envoyé à ${to}`);
    console.log(`Sujet: ${subject}`);
    console.log(`Message: ${body}`);
    return true;
}

// ============ MISE À JOUR DU STATUT ============
function updateStatus(requestId, newStatus) {
    const request = deliveryRequests.find(r => r.id === requestId);
    if (!request) return;
    
    const oldStatus = request.status;
    request.status = newStatus;
    localStorage.setItem('ouenze_delivery_requests', JSON.stringify(deliveryRequests));
    
    let message = '';
    let emailSubject = '';
    let emailBody = '';
    
    if (newStatus === 'approved') {
        message = `✅ Livreur "${request.fullName}" approuvé !`;
        emailSubject = "✅ Votre compte livreur Ouenze est activé";
        emailBody = `Bonjour ${request.fullName},\n\nFélicitations ! Votre candidature pour devenir livreur partenaire Ouenze a été acceptée.\n\nVous pouvez maintenant vous connecter à votre espace livreur et commencer à accepter des livraisons.\n\nCordialement,\nL'équipe Ouenze`;
        
        // Créer un compte utilisateur livreur si nécessaire
        const users = JSON.parse(localStorage.getItem('ouenze_all_users') || '[]');
        const existingUser = users.find(u => u.email === request.email);
        
        if (!existingUser) {
            users.push({
                email: request.email,
                fullName: request.fullName,
                password: request.password,
                type: 'livreur',
                status: 'active',
                createdAt: new Date().toISOString()
            });
            localStorage.setItem('ouenze_all_users', JSON.stringify(users));
        }
        
    } else if (newStatus === 'suspended') {
        message = `⚠️ Livreur "${request.fullName}" a été suspendu.`;
        emailSubject = "⚠️ Suspension de votre compte livreur";
        emailBody = `Bonjour ${request.fullName},\n\nVotre compte livreur a été suspendu. Veuillez contacter l'administration pour plus d'informations.\n\nCordialement,\nL'équipe Ouenze`;
        
    } else if (newStatus === 'rejected') {
        message = `❌ Livreur "${request.fullName}" a été refusé.`;
        emailSubject = "❌ Candidature livreur non retenue";
        emailBody = `Bonjour ${request.fullName},\n\nNous vous remercions pour votre candidature. Après examen, nous ne pouvons pas donner suite à votre demande.\n\nCordialement,\nL'équipe Ouenze`;
    }
    
    // Envoyer l'email
    if (newStatus !== oldStatus && newStatus !== 'pending') {
        sendEmail(request.email, emailSubject, emailBody);
    }
    
    alert(message);
    renderPage();
}

// ============ SUPPRESSION D'UN LIVREUR ============
function deleteDeliverer(requestId) {
    if (confirm("Êtes-vous sûr de vouloir supprimer définitivement ce livreur ?")) {
        const index = deliveryRequests.findIndex(r => r.id === requestId);
        if (index !== -1) {
            const request = deliveryRequests[index];
            deliveryRequests.splice(index, 1);
            localStorage.setItem('ouenze_delivery_requests', JSON.stringify(deliveryRequests));
            alert(`🗑️ Livreur "${request.fullName}" supprimé définitivement`);
            renderPage();
        }
    }
}

// ============ AFFICHAGE DES LIVREURS ============
function renderPage() {
    let filteredRequests = [];
    
    if (currentTab === 'pending') {
        filteredRequests = deliveryRequests.filter(r => r.status === 'pending');
    } else if (currentTab === 'active') {
        filteredRequests = deliveryRequests.filter(r => r.status === 'approved');
    } else if (currentTab === 'suspended') {
        filteredRequests = deliveryRequests.filter(r => r.status === 'suspended');
    } else {
        filteredRequests = deliveryRequests;
    }
    
    const container = document.getElementById('appContainer');
    if (!container) return;
    
    container.innerHTML = `
        <div class="requests-list">
            ${filteredRequests.length ? filteredRequests.map(req => `
                <div class="request-item">
                    <div class="request-info">
                        <h4>${escapeHtml(req.fullName)}</h4>
                        <p>📞 ${escapeHtml(req.phone)} | 📧 ${escapeHtml(req.email)}</p>
                        <p>📍 ${escapeHtml(req.city)}, ${escapeHtml(req.quartier)}</p>
                        <p>📅 Inscription: ${new Date(req.date).toLocaleDateString()}</p>
                        ${req.deliveries ? `<p>🚚 Livraisons: ${req.deliveries} | ⭐ Note: ${req.rating || 0}/5</p>` : ''}
                        <div style="display:flex; gap:8px; margin-top:8px;">
                            <button class="btn-view" onclick="viewPhotos(${req.id})">
                                <i class="fas fa-images"></i> Voir documents
                            </button>
                        </div>
                    </div>
                    <div class="action-buttons">
                        ${req.status === 'pending' ? `
                            <button class="btn-approve" onclick="updateStatus(${req.id}, 'approved')">
                                <i class="fas fa-check"></i> Approuver
                            </button>
                            <button class="btn-reject" onclick="updateStatus(${req.id}, 'rejected')">
                                <i class="fas fa-times"></i> Refuser
                            </button>
                        ` : req.status === 'approved' ? `
                            <button class="btn-suspend" onclick="updateStatus(${req.id}, 'suspended')">
                                <i class="fas fa-pause"></i> Suspendre
                            </button>
                            <button class="btn-reject" onclick="deleteDeliverer(${req.id})">
                                <i class="fas fa-trash"></i> Supprimer
                            </button>
                        ` : req.status === 'suspended' ? `
                            <button class="btn-approve" onclick="updateStatus(${req.id}, 'approved')">
                                <i class="fas fa-play"></i> Réactiver
                            </button>
                            <button class="btn-reject" onclick="deleteDeliverer(${req.id})">
                                <i class="fas fa-trash"></i> Supprimer
                            </button>
                        ` : ''}
                    </div>
                </div>
            `).join('') : `
                <div class="empty-state">
                    <i class="fas fa-users"></i>
                    <p>Aucun livreur trouvé</p>
                </div>
            `}
        </div>
    `;
    
    updateStats();
}

// ============ NAVIGATION ============
function setupTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentTab = tab.dataset.tab;
            renderPage();
        });
    });
}

// ============ INITIALISATION ============
function init() {
    // Récupérer les données
    deliveryRequests = JSON.parse(localStorage.getItem('ouenze_delivery_requests') || '[]');
    deliveries = JSON.parse(localStorage.getItem('ouenze_deliveries') || '[]');
    
    // Ajouter des données de démonstration si nécessaire
    if (deliveryRequests.length === 0) {
        // Données de démonstration
        const demoRequests = [
            {
                id: 1,
                fullName: "Jean Dupont",
                phone: "+242 06 123 4567",
                city: "Brazzaville",
                quartier: "Moungali",
                email: "jean.dupont@email.com",
                password: "password123",
                photo: "https://via.placeholder.com/150",
                idCard: "https://via.placeholder.com/150",
                transport: "https://via.placeholder.com/150",
                status: "pending",
                date: new Date().toISOString(),
                earnings: 0,
                deliveries: 0,
                rating: 0
            },
            {
                id: 2,
                fullName: "Marie Ngoma",
                phone: "+242 05 987 6543",
                city: "Pointe-Noire",
                quartier: "Centre",
                email: "marie.ngoma@email.com",
                password: "password123",
                photo: "https://via.placeholder.com/150",
                idCard: "https://via.placeholder.com/150",
                transport: "https://via.placeholder.com/150",
                status: "approved",
                date: new Date(Date.now() - 7 * 86400000).toISOString(),
                earnings: 25000,
                deliveries: 5,
                rating: 4.5
            }
        ];
        deliveryRequests = demoRequests;
        localStorage.setItem('ouenze_delivery_requests', JSON.stringify(deliveryRequests));
    }
    
    // Configurer les onglets
    setupTabs();
    
    // Afficher la page
    renderPage();
}

// Exports globaux
window.viewPhotos = viewPhotos;
window.updateStatus = updateStatus;
window.deleteDeliverer = deleteDeliverer;

// Démarrer l'application
init();