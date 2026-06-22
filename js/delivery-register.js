// ============ VARIABLES GLOBALES ============
let currentStep = 1;
let tempData = {};
let generatedCode = "";
let uploadedFiles = {
    photo: null,
    idCard: null,
    transport: null
};

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

function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePhone(phone) {
    const clean = phone.replace(/\s/g, '');
    return /^(\+242|0)[56]\d{8}$/.test(clean);
}

function sendEmail(to, subject, body) {
    console.log(`📧 Email envoyé à ${to}`);
    console.log(`Sujet: ${subject}`);
    console.log(`Message: ${body}`);
    return true;
}

// ============ AFFICHAGE DES ÉTAPES ============
function renderStep() {
    const container = document.getElementById('stepContent');
    if (!container) return;
    
    if (currentStep === 1) {
        container.innerHTML = `
            <div class="form-group">
                <label>Nom complet *</label>
                <input type="text" id="fullName" placeholder="Jean Dupont" autocomplete="name">
            </div>
            <div class="form-group">
                <label>Numéro de téléphone *</label>
                <input type="tel" id="phone" placeholder="+242 06 XX XX XX" autocomplete="tel">
                <div class="info-text">Format: +242 06 12 34 567</div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Ville *</label>
                    <input type="text" id="city" placeholder="Brazzaville" autocomplete="address-level2">
                </div>
                <div class="form-group">
                    <label>Quartier *</label>
                    <input type="text" id="quartier" placeholder="Votre quartier">
                </div>
            </div>
            <div class="form-group">
                <label>Email *</label>
                <input type="email" id="email" placeholder="exemple@email.com" autocomplete="email">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Mot de passe *</label>
                    <input type="password" id="password" placeholder="••••••••" autocomplete="new-password">
                </div>
                <div class="form-group">
                    <label>Confirmer *</label>
                    <input type="password" id="confirmPassword" placeholder="••••••••" autocomplete="new-password">
                </div>
            </div>
            <button class="btn-submit" onclick="window.validateStep1()">
                Continuer <i class="fas fa-arrow-right"></i>
            </button>
        `;
    } else if (currentStep === 2) {
        container.innerHTML = `
            <div class="form-group">
                <label>Photo de profil</label>
                <div class="file-upload" onclick="document.getElementById('profilePhoto').click()">
                    <i class="fas fa-camera"></i>
                    <span>Cliquez pour ajouter votre photo</span>
                </div>
                <input type="file" id="profilePhoto" accept="image/*" style="display:none;" onchange="window.previewFile(this, 'profile')">
                <div id="profilePreview" class="file-preview"></div>
                <div class="info-text">Photo récente, format JPG ou PNG</div>
            </div>
            <div class="form-group">
                <label>Photo de la pièce d'identité (CNI/Passeport)</label>
                <div class="file-upload" onclick="document.getElementById('idPhoto').click()">
                    <i class="fas fa-id-card"></i>
                    <span>Cliquez pour ajouter votre pièce d'identité</span>
                </div>
                <input type="file" id="idPhoto" accept="image/*" style="display:none;" onchange="window.previewFile(this, 'id')">
                <div id="idPreview" class="file-preview"></div>
                <div class="info-text">Recto visible, lisible</div>
            </div>
            <div class="form-group">
                <label>Photo du moyen de transport</label>
                <div class="file-upload" onclick="document.getElementById('transportPhoto').click()">
                    <i class="fas fa-motorcycle"></i>
                    <span>Cliquez pour ajouter la photo de votre véhicule</span>
                </div>
                <input type="file" id="transportPhoto" accept="image/*" style="display:none;" onchange="window.previewFile(this, 'transport')">
                <div id="transportPreview" class="file-preview"></div>
                <div class="info-text">Photo de votre moto, voiture ou vélo</div>
            </div>
            <div class="button-group">
                <button class="btn-submit btn-secondary" onclick="window.prevStep()">
                    <i class="fas fa-arrow-left"></i> Retour
                </button>
                <button class="btn-submit" onclick="window.validateStep2()">
                    Continuer <i class="fas fa-arrow-right"></i>
                </button>
            </div>
        `;
    } else if (currentStep === 3) {
        container.innerHTML = `
            <div class="form-group">
                <label>Code de vérification</label>
                <input type="text" id="verifCode" placeholder="123456" autocomplete="off">
                <div class="info-text">Un code a été envoyé à ${tempData.email || 'votre email'}</div>
            </div>
            <div class="button-group">
                <button class="btn-submit btn-secondary" onclick="window.prevStep()">
                    <i class="fas fa-arrow-left"></i> Retour
                </button>
                <button class="btn-submit" onclick="window.finalizeRegistration()">
                    Soumettre ma candidature
                </button>
            </div>
            <div class="info-text" style="margin-top:16px;">
                <i class="fas fa-clock"></i> Votre compte sera en attente de validation par notre équipe
            </div>
        `;
    }
    
    // Mettre à jour l'indicateur d'étapes
    const steps = document.querySelectorAll('.step');
    steps.forEach((el, idx) => {
        el.classList.remove('active', 'completed');
        if (idx + 1 === currentStep) {
            el.classList.add('active');
        } else if (idx + 1 < currentStep) {
            el.classList.add('completed');
        }
    });
}

// ============ GESTION DES FICHIERS ============
function previewFile(input, type) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        
        // Vérifier le type de fichier
        if (!file.type.startsWith('image/')) {
            alert("Veuillez sélectionner une image (JPG, PNG, GIF)");
            input.value = '';
            return;
        }
        
        // Vérifier la taille (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            alert("L'image ne doit pas dépasser 5MB");
            input.value = '';
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const previewId = type === 'profile' ? 'profilePreview' : type === 'id' ? 'idPreview' : 'transportPreview';
            const preview = document.getElementById(previewId);
            if (preview) {
                preview.innerHTML = `
                    <div class="file-preview-item">
                        <img src="${e.target.result}">
                        <div class="remove-file" onclick="window.removeFile('${type}')">✕</div>
                    </div>
                `;
            }
            
            // Stocker l'image en base64
            const fileKey = type === 'profile' ? 'photo' : type === 'id' ? 'idCard' : 'transport';
            uploadedFiles[fileKey] = e.target.result;
        };
        reader.readAsDataURL(file);
    }
}

function removeFile(type) {
    const fileKey = type === 'profile' ? 'photo' : type === 'id' ? 'idCard' : 'transport';
    uploadedFiles[fileKey] = null;
    
    const previewId = type === 'profile' ? 'profilePreview' : type === 'id' ? 'idPreview' : 'transportPreview';
    const preview = document.getElementById(previewId);
    if (preview) preview.innerHTML = '';
    
    // Vider l'input file
    const inputId = type === 'profile' ? 'profilePhoto' : type === 'id' ? 'idPhoto' : 'transportPhoto';
    const input = document.getElementById(inputId);
    if (input) input.value = '';
}

// ============ VALIDATION DES ÉTAPES ============
function validateStep1() {
    const fullName = document.getElementById('fullName').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const city = document.getElementById('city').value.trim();
    const quartier = document.getElementById('quartier').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const confirm = document.getElementById('confirmPassword').value;
    
    // Validation des champs obligatoires
    if (!fullName || !phone || !city || !quartier || !email || !password) {
        alert("Veuillez remplir tous les champs obligatoires");
        return;
    }
    
    // Validation de l'email
    if (!validateEmail(email)) {
        alert("Veuillez entrer une adresse email valide");
        return;
    }
    
    // Validation du téléphone
    if (!validatePhone(phone)) {
        alert("Numéro de téléphone invalide. Format: +242 06 XX XX XX");
        return;
    }
    
    // Validation du mot de passe
    if (password !== confirm) {
        alert("Les mots de passe ne correspondent pas");
        return;
    }
    if (password.length < 4) {
        alert("Mot de passe trop court (minimum 4 caractères)");
        return;
    }
    
    // Stocker les données temporairement
    tempData = {
        fullName,
        phone,
        city,
        quartier,
        email,
        password
    };
    
    // Générer et envoyer le code de vérification
    generatedCode = Math.floor(100000 + Math.random() * 900000).toString();
    sendEmail(email, "Code de vérification Ouenze Livreur", 
        `Bonjour ${fullName},\n\nVotre code de vérification est : ${generatedCode}\n\nCe code est valable 10 minutes.\n\nCordialement,\nL'équipe Ouenze`);
    
    alert(`Un code de vérification a été envoyé à ${email}\n\nCode de démonstration: ${generatedCode}`);
    
    // Passer à l'étape suivante
    currentStep = 2;
    renderStep();
}

function validateStep2() {
    if (!uploadedFiles.photo) {
        alert("Veuillez ajouter votre photo de profil");
        return;
    }
    if (!uploadedFiles.idCard) {
        alert("Veuillez ajouter votre pièce d'identité");
        return;
    }
    if (!uploadedFiles.transport) {
        alert("Veuillez ajouter la photo de votre moyen de transport");
        return;
    }
    
    currentStep = 3;
    renderStep();
}

function prevStep() {
    if (currentStep > 1) {
        currentStep--;
        renderStep();
    }
}

// ============ FINALISATION DE L'INSCRIPTION ============
function finalizeRegistration() {
    const codeInput = document.getElementById('verifCode');
    if (!codeInput) return;
    
    const code = codeInput.value.trim();
    
    if (code !== generatedCode) {
        alert("Code de vérification incorrect");
        return;
    }
    
    // Récupérer la liste des demandes livreurs existantes
    let deliveryRequests = JSON.parse(localStorage.getItem('ouenze_delivery_requests') || '[]');
    
    // Vérifier si l'email existe déjà
    if (deliveryRequests.some(r => r.email === tempData.email)) {
        alert("Une demande avec cet email existe déjà. Veuillez utiliser un autre email.");
        return;
    }
    
    // Créer la nouvelle demande
    const newRequest = {
        id: Date.now(),
        fullName: tempData.fullName,
        phone: tempData.phone,
        city: tempData.city,
        quartier: tempData.quartier,
        email: tempData.email,
        password: tempData.password,
        photo: uploadedFiles.photo,
        idCard: uploadedFiles.idCard,
        transport: uploadedFiles.transport,
        status: 'pending',
        date: new Date().toISOString(),
        earnings: 0,
        deliveries: 0,
        rating: 0,
        reviews: []
    };
    
    deliveryRequests.push(newRequest);
    localStorage.setItem('ouenze_delivery_requests', JSON.stringify(deliveryRequests));
    
    // Envoyer l'email de confirmation
    sendEmail(tempData.email, "Candidature livreur reçue - Ouenze",
        `Bonjour ${tempData.fullName},\n\nNous avons bien reçu votre candidature pour devenir livreur partenaire Ouenze.\n\nNotre équipe examinera votre dossier dans les plus brefs délais (24 à 48h).\n\nVous serez notifié par email dès que votre compte sera activé.\n\nCordialement,\nL'équipe Ouenze`);
    
    alert(`✅ Votre candidature a été envoyée avec succès !\n\nUn email de confirmation a été envoyé à ${tempData.email}\n\nNotre équipe examinera votre dossier et vous serez notifié dès que votre compte sera activé.\n\nDélai de traitement: 24 à 48h.`);
    
    // Rediriger vers la page d'accueil
    window.location.href = 'index.html';
}

// ============ EXPORTS GLOBAUX ============
window.validateStep1 = validateStep1;
window.validateStep2 = validateStep2;
window.prevStep = prevStep;
window.finalizeRegistration = finalizeRegistration;
window.previewFile = previewFile;
window.removeFile = removeFile;

// ============ INITIALISATION ============
function init() {
    renderStep();
}

// Démarrer l'application
init();