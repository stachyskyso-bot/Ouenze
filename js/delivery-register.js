// ============================================================
// DELIVERY-REGISTER.JS — Candidature livreur partenaire
//
// 1. Compte Supabase (création ou connexion)
// 2. Informations, véhicule (moto / voiture), immatriculation, permis
// 3. Photos (permis, véhicule, pièce d'identité, livreur) → bucket privé delivery-docs
// 4. Candidature dans delivery_applications, puis email à l'admin
//    via l'Edge Function « delivery-application »
// Dépendances : supabase-js → supabase-config → database → app (window.OuenzeForms)
// ============================================================

(function () {
    'use strict';

    const PHOTOS = [
        { key: 'license', field: 'license_photo_path', label: 'Permis de conduire', hint: 'Recto du permis, bien lisible', icon: 'fa-id-badge' },
        { key: 'vehicle', field: 'vehicle_photo_path', label: 'Photo du véhicule', hint: 'Véhicule entier, plaque d\'immatriculation visible', icon: 'fa-motorcycle' },
        { key: 'id', field: 'id_photo_path', label: "Pièce d'identité", hint: 'CNI ou passeport, recto lisible', icon: 'fa-address-card' },
        { key: 'profile', field: 'profile_photo_path', label: 'Ta photo', hint: 'Visage bien visible, sans lunettes de soleil', icon: 'fa-user' }
    ];

    let user = null;
    let application = null;      // candidature existante
    let step = 1;
    const form = {};              // valeurs saisies
    const photos = {};            // key → dataURL compressée (nouvelle photo)

    // ============ UTILITAIRES ============
    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    const F = () => window.OuenzeForms;
    const box = () => document.getElementById('deliveryApp');

    function todayIso() {
        const d = new Date();
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    }

    function formatDate(iso) {
        if (!iso) return '';
        const [y, m, d] = String(iso).slice(0, 10).split('-');
        return `${d}/${m}/${y}`;
    }

    function setError(msg, fieldId) {
        const el = document.getElementById('dlError');
        if (el) {
            el.textContent = msg || '';
            el.style.display = msg ? 'block' : 'none';
            if (msg) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        if (fieldId) document.getElementById(fieldId)?.focus();
        return false;
    }

    function compressImage(file, maxSize = 1600, quality = 0.85) {
        return new Promise((resolve, reject) => {
            if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) && !file.type.startsWith('image/')) {
                reject(new Error('Ce fichier n\'est pas une image')); return;
            }
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error('Image illisible (essaie une photo JPG)'));
                img.onload = () => {
                    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.round(img.width * scale);
                    canvas.height = Math.round(img.height * scale);
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#fff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', quality));
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function dataUrlToBlob(dataUrl) {
        const [head, b64] = dataUrl.split(',');
        const mime = head.match(/data:(.*?);/)[1];
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: mime });
    }

    function stepper() {
        const labels = ['Compte', 'Informations', 'Véhicule & permis', 'Envoi'];
        return `<ol class="dl-steps">${labels.map((l, i) => `
            <li class="${i + 1 < step ? 'done' : i + 1 === step ? 'active' : ''}"><span>${i + 1 < step ? '✓' : i + 1}</span>${l}</li>`).join('')}</ol>`;
    }

    // ============ ÉCRANS ============
    function render() {
        const el = box();
        if (!el) return;
        if (!user) { step = 1; el.innerHTML = stepper() + accountHtml(); return; }
        if (application && application.status === 'pending' && step === 1) { el.innerHTML = statusHtml(); return; }
        if (application && application.status === 'approved') { el.innerHTML = statusHtml(); return; }
        if (step < 2) step = 2;
        el.innerHTML = stepper() + (step === 2 ? infoHtml() : step === 3 ? vehicleHtml() : recapHtml());
        if (step === 3) PHOTOS.forEach(p => renderPhoto(p.key));
    }

    function accountHtml(mode = 'signup') {
        if (mode === 'login') {
            return `
            <h3 class="dl-title">Connexion</h3>
            <p class="dl-sub">Connecte-toi pour continuer ta candidature.</p>
            <div class="form-group"><label>Email</label><input type="email" id="dlLoginEmail" autocomplete="email"></div>
            <div class="form-group"><label>Mot de passe</label><input type="password" id="dlLoginPassword" autocomplete="current-password"></div>
            <div class="form-error" id="dlError" role="alert"></div>
            <button class="btn-submit" id="dlBtn" onclick="dlLogin()">Se connecter</button>
            <p class="dl-switch">Pas encore de compte ? <a href="#" onclick="dlShowAccount('signup');return false;">Créer un compte livreur</a></p>`;
        }
        return `
            <h3 class="dl-title">Crée ton compte livreur</h3>
            <p class="dl-sub">Ensuite : tes informations, ton véhicule et ton permis. Notre équipe vérifie ton dossier sous 24 à 48 h.</p>
            <div class="form-group"><label>Nom complet *</label><input type="text" id="dlName" maxlength="60" autocomplete="name" placeholder="Ex : Jean Mabiala"></div>
            <div class="form-group"><label>Email *</label><input type="email" id="dlEmail" maxlength="120" autocomplete="email" placeholder="exemple@email.com"></div>
            <div class="form-group"><label>Mot de passe *</label><input type="password" id="dlPassword" maxlength="72" autocomplete="new-password" placeholder="8 caractères, lettres et chiffres"></div>
            <div class="form-group"><label>Confirme le mot de passe *</label><input type="password" id="dlPassword2" maxlength="72" autocomplete="new-password"></div>
            <input type="text" id="dlWebsite" tabindex="-1" autocomplete="off" class="hp-field" aria-hidden="true">
            <div class="form-error" id="dlError" role="alert"></div>
            <button class="btn-submit" id="dlBtn" onclick="dlSignUp()">Créer mon compte et continuer</button>
            <p class="dl-switch">Déjà un compte Ouenze ? <a href="#" onclick="dlShowAccount('login');return false;">Se connecter</a></p>
            <p class="dl-note"><i class="fas fa-lock"></i> Tes documents sont stockés de façon privée : seuls toi et l'équipe Ouenze peuvent les voir.</p>
            `;
    }

    function countryOptions(selected) {
        return Object.entries(F().COUNTRIES).map(([code, c]) =>
            `<option value="${code}" ${code === selected ? 'selected' : ''}>${c.flag} ${c.name}</option>`).join('');
    }

    function cityOptions(cc, selected) {
        const cities = F().COUNTRIES[cc].cities;
        const isOther = selected && !cities.includes(selected);
        return cities.map(c => `<option ${c === selected ? 'selected' : ''}>${c}</option>`).join('') +
            `<option value="__other" ${isOther ? 'selected' : ''}>Autre ville…</option>`;
    }

    function infoHtml() {
        const cc = form.countryCode || 'CG';
        const C = F().COUNTRIES[cc];
        const otherCity = form.city && !C.cities.includes(form.city) ? form.city : '';
        return `
            <h3 class="dl-title">Tes informations</h3>
            <div class="form-group"><label>Nom complet *</label><input type="text" id="dlName" maxlength="60" value="${esc(form.fullName)}"></div>
            <div class="form-row-2">
                <div class="form-group"><label>Pays *</label><select id="dlCountry" onchange="dlCountryChange()">${countryOptions(cc)}</select></div>
                <div class="form-group"><label>Ville *</label>
                    <select id="dlCity" onchange="document.getElementById('dlCityOther').style.display=this.value==='__other'?'':'none'">${cityOptions(cc, form.city)}</select>
                    <input type="text" id="dlCityOther" maxlength="60" placeholder="Nom de ta ville" value="${esc(otherCity)}" style="${otherCity ? '' : 'display:none;'}margin-top:6px;">
                </div>
            </div>
            <div class="form-group"><label>Quartier *</label><input type="text" id="dlDistrict" maxlength="60" placeholder="Ex : Poto-Poto, Moungali, Gombe…" value="${esc(form.district)}"></div>
            <div class="form-group"><label>Téléphone (WhatsApp de préférence) *</label>
                <div class="phone-field"><span class="phone-prefix" id="dlDial">+${C.dial}</span>
                <input type="tel" id="dlPhone" inputmode="tel" placeholder="${C.example}" value="${esc(form.phoneRaw || '')}"></div>
            </div>
            <div class="form-error" id="dlError" role="alert"></div>
            <button class="btn-submit" onclick="dlNext()">Continuer <i class="fas fa-arrow-right"></i></button>
            <p class="dl-switch"><a href="#" onclick="dlLogout();return false;">Ce n'est pas toi ? Se déconnecter</a></p>`;
    }

    function vehicleHtml() {
        return `
            <h3 class="dl-title">Véhicule et permis</h3>
            <div class="form-group"><label>Type de véhicule *</label>
                <div class="vehicle-types">
                    <label><input type="radio" name="dlVehicle" value="moto" ${form.vehicleType === 'moto' ? 'checked' : ''}><span><i class="fas fa-motorcycle"></i> Moto</span></label>
                    <label><input type="radio" name="dlVehicle" value="voiture" ${form.vehicleType === 'voiture' ? 'checked' : ''}><span><i class="fas fa-car"></i> Voiture</span></label>
                </div>
            </div>
            <div class="form-row-2">
                <div class="form-group"><label>Numéro d'immatriculation *</label>
                    <input type="text" id="dlPlate" maxlength="15" placeholder="Ex : 123 AB 4" value="${esc(form.plate)}" style="text-transform:uppercase;"></div>
                <div class="form-group"><label>Marque et modèle</label>
                    <input type="text" id="dlBrand" maxlength="40" placeholder="Ex : Yamaha Crypton" value="${esc(form.brand)}"></div>
            </div>
            <div class="form-row-2">
                <div class="form-group"><label>Numéro du permis de conduire *</label>
                    <input type="text" id="dlLicense" maxlength="30" value="${esc(form.license)}" style="text-transform:uppercase;"></div>
                <div class="form-group"><label>Permis valable jusqu'au *</label>
                    <input type="date" id="dlLicenseExpiry" min="${todayIso()}" value="${esc(form.licenseExpiry)}"></div>
            </div>
            <div class="dl-photos">
                ${PHOTOS.map(p => `
                    <div class="dl-photo" id="dlPhoto-${p.key}">
                        <div class="dl-photo-label">${p.label} *</div>
                        <label class="dl-photo-drop">
                            <input type="file" accept="image/*" capture="environment" onchange="dlPickPhoto('${p.key}', this)">
                            <div class="dl-photo-preview"></div>
                        </label>
                        <div class="dl-photo-hint">${p.hint}</div>
                    </div>`).join('')}
            </div>
            <div class="form-error" id="dlError" role="alert"></div>
            <div class="dl-actions">
                <button class="btn-submit btn-light" onclick="dlBack()"><i class="fas fa-arrow-left"></i> Retour</button>
                <button class="btn-submit" onclick="dlNext()">Continuer <i class="fas fa-arrow-right"></i></button>
            </div>`;
    }

    function recapHtml() {
        const vehicle = form.vehicleType === 'voiture' ? 'Voiture' : 'Moto';
        const rows = [
            ['Nom', form.fullName], ['Téléphone', form.phone], ['Ville', `${form.city}, ${form.district} (${form.country})`],
            ['Véhicule', vehicle + (form.brand ? ' — ' + form.brand : '')], ['Immatriculation', form.plate],
            ['Permis', `${form.license} — valable jusqu'au ${formatDate(form.licenseExpiry)}`]
        ];
        return `
            <h3 class="dl-title">Vérifie et envoie</h3>
            <dl class="dl-recap">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
            <div class="dl-recap-photos">${PHOTOS.map(p => `
                <figure>${photoSrc(p) ? `<img src="${photoSrc(p)}" alt="">` : ''}<figcaption>${p.label}</figcaption></figure>`).join('')}</div>
            <label class="terms-line">
                <input type="checkbox" id="dlTerms">
                <span>Je certifie que ces informations sont exactes, que mon permis est valide et que mon véhicule est assuré. J'accepte les <a href="privacy.html" target="_blank">conditions d'utilisation</a>.</span>
            </label>
            <div class="form-error" id="dlError" role="alert"></div>
            <div class="dl-actions">
                <button class="btn-submit btn-light" onclick="dlBack()"><i class="fas fa-arrow-left"></i> Retour</button>
                <button class="btn-submit" id="dlBtn" onclick="dlSubmit()"><i class="fas fa-paper-plane"></i> Envoyer ma candidature</button>
            </div>
            <div class="dl-progress" id="dlProgress"></div>`;
    }

    function statusHtml() {
        const a = application;
        if (a.status === 'approved') {
            return `<div class="dl-status ok"><i class="fas fa-check-circle"></i>
                <h3>Ton compte livreur est validé 🎉</h3>
                <p>Tu peux accepter des livraisons depuis ton espace livreur.</p>
                <a class="btn-submit" href="delivery-dashboard.html">Ouvrir mon espace livreur</a></div>`;
        }
        return `<div class="dl-status pending"><i class="fas fa-hourglass-half"></i>
            <h3>Candidature en cours de vérification</h3>
            <p>Envoyée le ${new Date(a.created_at).toLocaleDateString('fr-FR')}. Notre équipe vérifie ton permis (${esc(a.license_number)}) et ton véhicule (${esc(a.plate_number)}) sous 24 à 48 h. Tu recevras un email à ${esc(a.email)}.</p>
            <button class="btn-submit btn-light" onclick="dlEdit()"><i class="fas fa-pen"></i> Modifier mon dossier</button></div>`;
    }

    // ============ PHOTOS ============
    function photoSrc(p) {
        return photos[p.key] || form.existingPhotoUrls?.[p.key] || '';
    }

    function renderPhoto(key) {
        const p = PHOTOS.find(x => x.key === key);
        const el = document.querySelector(`#dlPhoto-${key} .dl-photo-preview`);
        if (!p || !el) return;
        const src = photoSrc(p);
        el.innerHTML = src ? `<img src="${src}" alt=""><span class="dl-photo-change">Changer</span>`
                           : `<i class="fas ${p.icon}"></i><span>Prendre / choisir une photo</span>`;
        document.getElementById(`dlPhoto-${key}`)?.classList.toggle('has-photo', !!src);
    }

    async function dlPickPhoto(key, input) {
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        if (file.size > 15 * 1024 * 1024) { setError('Photo trop lourde (15 Mo maximum).'); return; }
        try {
            photos[key] = await compressImage(file);
            setError('');
            renderPhoto(key);
        } catch (e) {
            setError(e.message || 'Image illisible');
        }
    }

    // ============ NAVIGATION ============
    function readInfo() {
        const v = id => (document.getElementById(id)?.value || '').trim();
        const cc = v('dlCountry') || 'CG';
        let city = v('dlCity');
        if (city === '__other') city = v('dlCityOther');
        const phone = F().normalizePhone(v('dlPhone'), cc);
        if (v('dlName').length < 2) return setError('Indique ton nom complet.', 'dlName');
        if (city.length < 2) return setError('Indique ta ville.', 'dlCityOther');
        if (v('dlDistrict').length < 2) return setError('Indique ton quartier.', 'dlDistrict');
        const C = F().COUNTRIES[cc];
        if (!phone) return setError(`Numéro invalide. Exemple : +${C.dial} ${C.example}`, 'dlPhone');
        Object.assign(form, { fullName: v('dlName'), countryCode: cc, country: C.name, city, district: v('dlDistrict'), phone, phoneRaw: v('dlPhone') });
        return true;
    }

    function readVehicle() {
        const v = id => (document.getElementById(id)?.value || '').trim();
        const vehicleType = document.querySelector('input[name="dlVehicle"]:checked')?.value;
        const plate = v('dlPlate').toUpperCase().replace(/\s+/g, ' ');
        const license = v('dlLicense').toUpperCase();
        const expiry = v('dlLicenseExpiry');
        Object.assign(form, { vehicleType, plate, license, licenseExpiry: expiry, brand: v('dlBrand') });
        if (!vehicleType) return setError('Choisis ton type de véhicule : moto ou voiture.');
        if (!/^[A-Z0-9][A-Z0-9 \-]{2,14}$/.test(plate)) return setError('Numéro d\'immatriculation invalide (lettres et chiffres, 3 à 15 caractères).', 'dlPlate');
        if (!/^[A-Z0-9][A-Z0-9 \-\/]{3,29}$/.test(license)) return setError('Numéro de permis invalide.', 'dlLicense');
        if (!expiry) return setError('Indique la date de fin de validité de ton permis.', 'dlLicenseExpiry');
        if (expiry < todayIso()) return setError('Ton permis est expiré : il doit être valide pour livrer.', 'dlLicenseExpiry');
        const missing = PHOTOS.filter(p => !photoSrc(p)).map(p => p.label.toLowerCase());
        if (missing.length) return setError('Photo manquante : ' + missing.join(', ') + '.');
        return true;
    }

    function dlNext() {
        if (step === 2 && !readInfo()) return;
        if (step === 3 && !readVehicle()) return;
        step++;
        render();
        window.scrollTo(0, 0);
    }

    function dlBack() {
        if (step === 3) readVehicleSilently();
        step = Math.max(2, step - 1);
        render();
    }

    function readVehicleSilently() {
        const v = id => (document.getElementById(id)?.value || '').trim();
        Object.assign(form, {
            vehicleType: document.querySelector('input[name="dlVehicle"]:checked')?.value || form.vehicleType,
            plate: v('dlPlate') || form.plate, license: v('dlLicense') || form.license,
            licenseExpiry: v('dlLicenseExpiry') || form.licenseExpiry, brand: v('dlBrand') || form.brand
        });
    }

    function dlCountryChange() {
        const cc = document.getElementById('dlCountry').value;
        const C = F().COUNTRIES[cc];
        document.getElementById('dlCity').innerHTML = cityOptions(cc);
        document.getElementById('dlCityOther').style.display = 'none';
        document.getElementById('dlDial').textContent = '+' + C.dial;
        document.getElementById('dlPhone').placeholder = C.example;
    }

    function dlShowAccount(mode) {
        box().innerHTML = stepper() + accountHtml(mode);
    }

    function dlEdit() {
        step = 2;
        render();
    }

    // ============ COMPTE ============
    async function dlSignUp() {
        const v = id => (document.getElementById(id)?.value || '').trim();
        if (v('dlWebsite')) return;  // robot
        const name = v('dlName');
        const email = v('dlEmail').toLowerCase();
        const pw = document.getElementById('dlPassword').value;
        if (name.length < 2) return setError('Indique ton nom complet.', 'dlName');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return setError('Adresse email invalide.', 'dlEmail');
        const issue = F().passwordProblem(pw, email);
        if (issue) return setError(issue, 'dlPassword');
        if (pw !== document.getElementById('dlPassword2').value) return setError('Les deux mots de passe ne sont pas identiques.', 'dlPassword2');
        const btn = document.getElementById('dlBtn');
        btn.disabled = true;
        btn.textContent = 'Création du compte…';
        // Le compte reste « client » : il passe « livreur » seulement après validation par un admin
        const { data, error } = await window.supabase.auth.signUp({
            email, password: pw,
            options: { emailRedirectTo: window.location.origin + '/delivery-register.html', data: { full_name: name, user_type: 'client', wants_delivery: true } }
        });
        btn.disabled = false;
        btn.textContent = 'Créer mon compte et continuer';
        if (error) {
            if (/already registered|already exists/i.test(error.message)) {
                dlShowAccount('login');
                document.getElementById('dlLoginEmail').value = email;
                return setError('Un compte existe déjà avec cet email : connecte-toi pour continuer.', 'dlLoginPassword');
            }
            return setError(/rate limit|too many/i.test(error.message) ? 'Trop de tentatives, réessaie dans quelques minutes.' : 'Inscription impossible : ' + error.message);
        }
        form.fullName = name;
        if (!data.session) {
            box().innerHTML = `<div class="dl-status pending"><i class="fas fa-envelope-open-text"></i>
                <h3>Confirme ton adresse email</h3>
                <p>Nous avons envoyé un lien à <strong>${esc(email)}</strong>. Clique dessus : tu reviendras ici, connecté, pour terminer ta candidature.</p>
                <p class="dl-note">Pense à regarder dans les spams.</p></div>`;
            return;
        }
        await loadUser();
    }

    async function dlLogin() {
        const email = (document.getElementById('dlLoginEmail').value || '').trim().toLowerCase();
        const password = document.getElementById('dlLoginPassword').value;
        if (!email || !password) return setError('Email et mot de passe requis.');
        const btn = document.getElementById('dlBtn');
        btn.disabled = true;
        const { error } = await window.supabase.auth.signInWithPassword({ email, password });
        btn.disabled = false;
        if (error) return setError(/confirm/i.test(error.message) ? 'Confirme d\'abord ton adresse email (lien reçu par email).' : 'Email ou mot de passe incorrect.');
        await loadUser();
    }

    async function dlLogout() {
        await window.supabase.auth.signOut();
        location.reload();
    }

    // ============ ENVOI ============
    async function dlSubmit() {
        if (!document.getElementById('dlTerms')?.checked) return setError('Coche la case de certification pour envoyer ta candidature.');
        const btn = document.getElementById('dlBtn');
        const progress = document.getElementById('dlProgress');
        btn.disabled = true;
        setError('');
        try {
            // 1. Photos dans le bucket privé : <user_id>/<type>-<horodatage>.jpg
            const paths = {};
            let n = 0;
            for (const p of PHOTOS) {
                if (photos[p.key]) {
                    progress.textContent = `Envoi des photos… ${++n}/${PHOTOS.filter(x => photos[x.key]).length}`;
                    const path = `${user.id}/${p.key}-${Date.now()}.jpg`;
                    const { error } = await window.supabase.storage.from('delivery-docs')
                        .upload(path, dataUrlToBlob(photos[p.key]), { contentType: 'image/jpeg', upsert: false });
                    if (error) throw new Error('Photo « ' + p.label + ' » : ' + error.message);
                    paths[p.field] = path;
                } else if (application?.[p.field]) {
                    paths[p.field] = application[p.field];  // photo déjà envoyée, inchangée
                }
            }
            // 2. Candidature
            progress.textContent = 'Enregistrement de la candidature…';
            const row = {
                user_id: user.id, full_name: form.fullName, email: user.email, phone: form.phone,
                country: form.country, city: form.city, district: form.district,
                vehicle_type: form.vehicleType, vehicle_brand: form.brand || null, plate_number: form.plate,
                license_number: form.license, license_expiry: form.licenseExpiry, status: 'pending', ...paths
            };
            const query = application
                ? window.supabase.from('delivery_applications').update(row).eq('id', application.id).select().single()
                : window.supabase.from('delivery_applications').insert(row).select().single();
            const { data: saved, error } = await query;
            if (error) throw new Error(/relation .* does not exist|schema cache/i.test(error.message)
                ? 'Le service des candidatures n\'est pas encore activé. Réessaie plus tard.' : error.message);
            application = saved;
            // 3. Email à l'admin (si l'envoi échoue, la candidature reste enregistrée et visible côté admin)
            progress.textContent = 'Notification de l\'équipe Ouenze…';
            const { error: fnError } = await window.supabase.functions.invoke('delivery-application', { body: { action: 'notify', application_id: saved.id } });
            if (fnError) console.warn('⚠️ Email admin non envoyé :', fnError);
            box().innerHTML = `<div class="dl-status ok"><i class="fas fa-check-circle"></i>
                <h3>Candidature envoyée ✅</h3>
                <p>Merci ${esc(form.fullName)} ! Notre équipe vérifie ton permis et ton véhicule sous 24 à 48 h. Tu recevras un email à <strong>${esc(user.email)}</strong>.</p>
                <a class="btn-submit" href="index.html">Retour à l'accueil</a></div>`;
            window.scrollTo(0, 0);
        } catch (e) {
            console.error('❌ Candidature:', e);
            btn.disabled = false;
            progress.textContent = '';
            setError('Envoi impossible : ' + (e.message || e));
        }
    }

    // ============ DÉMARRAGE ============
    async function loadUser() {
        const { data } = await window.supabase.auth.getSession();
        user = data?.session?.user || null;
        if (user) {
            const meta = user.user_metadata || {};
            form.fullName = form.fullName || meta.full_name || meta.name || '';
            form.countryCode = form.countryCode || meta.country_code || 'CG';
            form.city = form.city || meta.city || '';
            form.phoneRaw = form.phoneRaw || meta.phone || '';
            const { data: existing } = await window.supabase.from('delivery_applications').select('*').eq('user_id', user.id).maybeSingle();
            application = existing || null;
            if (application) {
                Object.assign(form, {
                    fullName: application.full_name, phoneRaw: application.phone, city: application.city, district: application.district,
                    countryCode: Object.entries(F().COUNTRIES).find(([, c]) => c.name === application.country)?.[0] || 'CG',
                    vehicleType: application.vehicle_type, plate: application.plate_number, brand: application.vehicle_brand || '',
                    license: application.license_number, licenseExpiry: application.license_expiry
                });
                // Aperçu des photos déjà envoyées (liens privés temporaires)
                const files = PHOTOS.map(p => application[p.field]).filter(Boolean);
                const { data: signed } = await window.supabase.storage.from('delivery-docs').createSignedUrls(files, 3600);
                form.existingPhotoUrls = {};
                PHOTOS.forEach(p => {
                    const s = (signed || []).find(x => x.path === application[p.field]);
                    if (s?.signedUrl) form.existingPhotoUrls[p.key] = s.signedUrl;
                });
            }
        }
        step = user ? 2 : 1;
        if (application?.status === 'rejected') {
            box().innerHTML = `<div class="dl-status rejected"><i class="fas fa-exclamation-circle"></i>
                <h3>Candidature à corriger</h3>
                ${application.review_note ? `<p><strong>Motif :</strong> ${esc(application.review_note)}</p>` : ''}
                <p>Corrige ton dossier puis renvoie-le.</p>
                <button class="btn-submit" onclick="dlEdit()">Corriger mon dossier</button></div>`;
            return;
        }
        if (application?.status === 'pending') step = 1;
        render();
    }

    async function init() {
        if (!window.supabase?.auth || !window.OuenzeForms) {
            box().innerHTML = '<div class="dl-status rejected"><p>Service indisponible. Vérifie ta connexion et recharge la page.</p></div>';
            return;
        }
        try {
            await loadUser();
        } catch (e) {
            console.error('❌ init livreur:', e);
            box().innerHTML = '<div class="dl-status rejected"><p>Une erreur est survenue. Recharge la page.</p></div>';
        }
    }

    Object.assign(window, { dlSignUp, dlLogin, dlLogout, dlShowAccount, dlNext, dlBack, dlPickPhoto, dlCountryChange, dlSubmit, dlEdit });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
