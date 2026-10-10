// ============================================================
// CHECKOUT.JS — Validation de la commande
//
// 1. Panier (regroupé par boutique : chaque vendeur valide sa partie)
// 2. Livraison : position sur la carte, quartier, rue, repères, téléphone
// 3. Paiement : Mobile Money (réseaux locaux) ou PayPal — jamais de carte en physique
// 4. Récapitulatif → paiement via l'Edge Function « create-order » (pawaPay)
//
// Le navigateur n'envoie que des identifiants et des quantités : les prix,
// les frais et le total sont recalculés côté serveur.
// Dépendances : supabase-js → supabase-config → database → app (OuenzeForms) → Leaflet
// ============================================================

(function () {
    'use strict';

    const DELIVERY_RATE = 0.10;              // frais de livraison : 10 % du sous-total
    const CITY_CENTERS = {                   // centre de la carte par défaut
        CG: { lat: -4.2634, lng: 15.2429, zoom: 13 },   // Brazzaville
        CD: { lat: -4.3217, lng: 15.3125, zoom: 12 }    // Kinshasa
    };
    // Réseaux Mobile Money proposés via pawaPay (liste définitive confirmée à l'ouverture du compte)
    const OPERATORS = {
        CG: [
            { id: 'MTN_MOMO_COG', name: 'MTN Mobile Money', color: '#ffcc00', text: '#000' },
            { id: 'AIRTEL_COG', name: 'Airtel Money', color: '#e40000', text: '#fff' }
        ],
        CD: [
            { id: 'VODACOM_MPESA_COD', name: 'M-Pesa (Vodacom)', color: '#e60000', text: '#fff' },
            { id: 'ORANGE_COD', name: 'Orange Money', color: '#ff7900', text: '#000' },
            { id: 'AIRTEL_COD', name: 'Airtel Money', color: '#e40000', text: '#fff' }
        ]
    };

    let step = 1;
    let user = null;
    let cart = [];
    let map = null;
    let marker = null;
    const delivery = { lat: null, lng: null, countryCode: 'CG', city: '', district: '', street: '', landmark: '', phone: '' };
    const payment = { method: 'mobile_money', operator: '', phone: '' };

    // ============ UTILITAIRES ============
    const F = () => window.OuenzeForms;
    const box = () => document.getElementById('checkoutApp');

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function fcfa(n) {
        return Math.round(Number(n) || 0).toLocaleString('fr-FR') + ' FCFA';
    }

    // « +242 06 555 25 62 » → « 06 555 25 62 » (l'indicatif est déjà affiché à côté du champ)
    function nationalPart(phone) {
        return String(phone || '').replace(/^\+(242|243)\s*/, '');
    }

    function safeImg(url) {
        const u = String(url || '');
        return /^(https:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(u) ? u : '';
    }

    function setError(msg, fieldId) {
        const el = document.getElementById('coError');
        if (el) {
            el.textContent = msg || '';
            el.style.display = msg ? 'block' : 'none';
            if (msg) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        if (fieldId) document.getElementById(fieldId)?.focus();
        return false;
    }

    function loadCart() {
        try { return JSON.parse(localStorage.getItem('ouenze_cart') || '[]').filter(i => i && i.productId && i.quantity > 0); }
        catch (e) { return []; }
    }

    function saveCart() {
        try { localStorage.setItem('ouenze_cart', JSON.stringify(cart)); } catch (e) { /* stockage indisponible */ }
    }

    // Adresse mémorisée sur cet appareil, par compte (simple confort)
    function addressKey() { return 'ouenze_address_' + (user?.id || 'anon'); }
    function loadSavedAddress() {
        try { return JSON.parse(localStorage.getItem(addressKey()) || 'null'); } catch (e) { return null; }
    }
    function saveAddress() {
        try { localStorage.setItem(addressKey(), JSON.stringify(delivery)); } catch (e) { /* ignoré */ }
    }

    function groups() {
        const byShop = new Map();
        cart.forEach(i => {
            const key = String(i.shopId || 'inconnue');
            if (!byShop.has(key)) byShop.set(key, { shopId: i.shopId, shopName: i.shopName || '', items: [] });
            byShop.get(key).items.push(i);
        });
        return [...byShop.values()];
    }

    function totals() {
        const subtotal = cart.reduce((s, i) => s + (Number(i.price) || 0) * i.quantity, 0);
        const fees = Math.round(subtotal * DELIVERY_RATE);
        return { subtotal, fees, total: subtotal + fees };
    }

    function stepper() {
        const labels = ['Panier', 'Livraison', 'Paiement', 'Confirmation'];
        return `<ol class="dl-steps">${labels.map((l, i) => `
            <li class="${i + 1 < step ? 'done' : i + 1 === step ? 'active' : ''}"><span>${i + 1 < step ? '✓' : i + 1}</span>${l}</li>`).join('')}</ol>`;
    }

    function totalsHtml() {
        const t = totals();
        return `
            <div class="co-totals">
                <div><span>Sous-total</span><span>${fcfa(t.subtotal)}</span></div>
                <div><span>Livraison (${Math.round(DELIVERY_RATE * 100)} %)</span><span>${fcfa(t.fees)}</span></div>
                <div class="co-grand"><span>Total</span><span>${fcfa(t.total)}</span></div>
            </div>`;
    }

    // ============ ÉCRANS ============
    function render() {
        if (step !== 2 && map) { map.remove(); map = null; marker = null; }
        const el = box();
        if (!cart.length) {
            el.innerHTML = `<div class="dl-status"><i class="fas fa-shopping-basket" style="color:#cbd5e1;"></i>
                <h3>Ton panier est vide</h3><p>Ajoute des articles depuis les boutiques, puis reviens ici.</p>
                <a class="btn-submit" href="index.html">Voir les boutiques</a></div>`;
            return;
        }
        el.innerHTML = stepper() + [cartHtml, deliveryHtml, paymentHtml, reviewHtml][step - 1]();
        if (step === 2) initMap();
        window.scrollTo(0, 0);
    }

    function cartHtml() {
        return `
            <h3 class="dl-title">Ton panier</h3>
            <p class="dl-sub">Chaque boutique confirme sa partie de la commande, puis un livreur proche la récupère.</p>
            ${groups().map(g => `
                <div class="co-shop">
                    <div class="co-shop-name"><i class="fas fa-store"></i> ${esc(g.shopName || 'Boutique')}</div>
                    ${g.items.map(i => {
                        const idx = cart.indexOf(i);
                        const img = safeImg(i.photo);
                        return `
                        <div class="co-item">
                            <div class="co-item-img">${img ? `<img src="${img}" alt="">` : '<i class="fas fa-box"></i>'}</div>
                            <div class="co-item-info">
                                <strong>${esc(i.productName)}</strong>
                                ${i.variantKey ? `<small>${esc(i.variantKey)}</small>` : ''}
                                <span>${fcfa(i.price)}</span>
                            </div>
                            <div class="pd-qty small">
                                <button onclick="coQty(${idx}, -1)" aria-label="Moins">−</button>
                                <span>${i.quantity}</span>
                                <button onclick="coQty(${idx}, 1)" aria-label="Plus">+</button>
                            </div>
                        </div>`;
                    }).join('')}
                </div>`).join('')}
            ${totalsHtml()}
            <div class="form-error" id="coError" role="alert"></div>
            <button class="btn-submit" onclick="coNext()">Valider le panier <i class="fas fa-arrow-right"></i></button>`;
    }

    function deliveryHtml() {
        const cc = delivery.countryCode;
        const C = F().COUNTRIES[cc];
        const cities = C.cities;
        const isOther = delivery.city && !cities.includes(delivery.city);
        return `
            <h3 class="dl-title">Où te livrer ?</h3>
            <p class="dl-sub">Place le repère exactement sur ta maison : le livreur suivra ce point.</p>
            <div class="co-map-wrap">
                <div id="coMap" class="co-map"></div>
                <button class="co-locate" onclick="coLocate()"><i class="fas fa-location-arrow"></i> Ma position</button>
            </div>
            <p class="co-map-hint" id="coMapHint">${delivery.lat ? `<i class="fas fa-check-circle" style="color:var(--success);"></i> Position enregistrée. Déplace le repère pour corriger.` : 'Touche la carte ou utilise « Ma position ».'}</p>
            <div class="form-row-2">
                <div class="form-group"><label>Pays *</label>
                    <select id="coCountry" onchange="coCountryChange()">
                        ${Object.entries(F().COUNTRIES).map(([code, c]) => `<option value="${code}" ${code === cc ? 'selected' : ''}>${c.flag} ${c.name}</option>`).join('')}
                    </select></div>
                <div class="form-group"><label>Ville *</label>
                    <select id="coCity" onchange="document.getElementById('coCityOther').style.display=this.value==='__other'?'':'none'">
                        ${cities.map(c => `<option ${c === delivery.city ? 'selected' : ''}>${c}</option>`).join('')}
                        <option value="__other" ${isOther ? 'selected' : ''}>Autre ville…</option>
                    </select>
                    <input type="text" id="coCityOther" maxlength="60" placeholder="Nom de ta ville" value="${isOther ? esc(delivery.city) : ''}" style="${isOther ? '' : 'display:none;'}margin-top:6px;">
                </div>
            </div>
            <div class="form-group"><label>Quartier *</label><input type="text" id="coDistrict" maxlength="60" placeholder="Ex : Poto-Poto, Bacongo, Gombe…" value="${esc(delivery.district)}"></div>
            <div class="form-group"><label>Rue / avenue et numéro</label><input type="text" id="coStreet" maxlength="100" placeholder="Ex : 24 avenue de la Paix" value="${esc(delivery.street)}"></div>
            <div class="form-group"><label>Description et repères *</label>
                <textarea id="coLandmark" rows="2" maxlength="300" placeholder="Ex : maison à portail bleu, après la pharmacie du rond-point">${esc(delivery.landmark)}</textarea></div>
            <div class="form-group"><label>Téléphone pour la livraison *</label>
                <div class="phone-field"><span class="phone-prefix" id="coDial">+${C.dial}</span>
                <input type="tel" id="coPhone" inputmode="tel" placeholder="${C.example}" value="${esc(nationalPart(delivery.phone))}"></div>
                <p class="auth-note">Le livreur t'appellera à ce numéro. Tu peux le modifier.</p>
            </div>
            <div class="form-error" id="coError" role="alert"></div>
            <div class="dl-actions">
                <button class="btn-submit btn-light" onclick="coBack()"><i class="fas fa-arrow-left"></i> Retour</button>
                <button class="btn-submit" onclick="coNext()">Continuer <i class="fas fa-arrow-right"></i></button>
            </div>`;
    }

    function paymentHtml() {
        const ops = OPERATORS[delivery.countryCode] || [];
        if (payment.method === 'mobile_money' && !ops.some(o => o.id === payment.operator)) payment.operator = '';
        return `
            <h3 class="dl-title">Paiement</h3>
            <p class="dl-sub"><i class="fas fa-shield-alt" style="color:var(--success);"></i> Ton argent est bloqué par Ouenze et versé au vendeur seulement après la livraison.</p>
            <div class="co-methods">
                <label class="co-method ${payment.method === 'mobile_money' ? 'selected' : ''}">
                    <input type="radio" name="coMethod" value="mobile_money" ${payment.method === 'mobile_money' ? 'checked' : ''} onchange="coMethod('mobile_money')">
                    <i class="fas fa-mobile-alt"></i><span><strong>Mobile Money</strong><small>${ops.map(o => o.name).join(', ')}</small></span>
                </label>
                <label class="co-method ${payment.method === 'paypal' ? 'selected' : ''}">
                    <input type="radio" name="coMethod" value="paypal" ${payment.method === 'paypal' ? 'checked' : ''} onchange="coMethod('paypal')">
                    <i class="fab fa-paypal"></i><span><strong>PayPal</strong><small>Compte PayPal</small></span>
                </label>
            </div>
            ${payment.method === 'mobile_money' ? `
                <div class="form-group"><label>Réseau *</label>
                    <div class="co-operators">
                        ${ops.map(o => `
                            <label class="co-operator ${payment.operator === o.id ? 'selected' : ''}">
                                <input type="radio" name="coOperator" value="${o.id}" ${payment.operator === o.id ? 'checked' : ''} onchange="coOperator('${o.id}')">
                                <span class="co-op-logo" style="background:${o.color};color:${o.text};">${esc(o.name.split(' ')[0])}</span>
                                <span>${esc(o.name)}</span>
                            </label>`).join('')}
                    </div>
                </div>
                <div class="form-group"><label>Numéro Mobile Money *</label>
                    <div class="phone-field"><span class="phone-prefix">+${F().COUNTRIES[delivery.countryCode].dial}</span>
                    <input type="tel" id="coPayPhone" inputmode="tel" value="${esc(nationalPart(payment.phone || delivery.phone))}"></div>
                    <p class="auth-note">Tu recevras une demande de confirmation sur ce téléphone (code secret Mobile Money).</p>
                </div>` : `
                <p class="co-paypal-note"><i class="fab fa-paypal"></i> Tu seras redirigé vers PayPal pour payer en toute sécurité, puis ramené sur Ouenze.</p>`}
            <p class="co-no-card"><i class="fas fa-ban"></i> Le paiement par carte en physique (à la livraison) n'est pas accepté.</p>
            <div class="form-error" id="coError" role="alert"></div>
            <div class="dl-actions">
                <button class="btn-submit btn-light" onclick="coBack()"><i class="fas fa-arrow-left"></i> Retour</button>
                <button class="btn-submit" onclick="coNext()">Continuer <i class="fas fa-arrow-right"></i></button>
            </div>`;
    }

    function reviewHtml() {
        const op = (OPERATORS[delivery.countryCode] || []).find(o => o.id === payment.operator);
        const country = F().COUNTRIES[delivery.countryCode].name;
        return `
            <h3 class="dl-title">Vérifie ta commande</h3>
            <div class="co-review">
                <div class="co-review-block">
                    <div class="co-review-head"><span><i class="fas fa-shopping-bag"></i> Articles (${cart.reduce((s, i) => s + i.quantity, 0)})</span><button onclick="coGo(1)">Modifier</button></div>
                    ${cart.map(i => `<div class="co-review-line"><span>${i.quantity} × ${esc(i.productName)}${i.variantKey ? ` <small>(${esc(i.variantKey)})</small>` : ''}</span><span>${fcfa(i.price * i.quantity)}</span></div>`).join('')}
                </div>
                <div class="co-review-block">
                    <div class="co-review-head"><span><i class="fas fa-map-marker-alt"></i> Livraison</span><button onclick="coGo(2)">Modifier</button></div>
                    <p>${esc(delivery.district)}, ${esc(delivery.city)} (${esc(country)})${delivery.street ? '<br>' + esc(delivery.street) : ''}<br><em>${esc(delivery.landmark)}</em><br><i class="fas fa-phone"></i> ${esc(delivery.phone)}</p>
                </div>
                <div class="co-review-block">
                    <div class="co-review-head"><span><i class="fas fa-wallet"></i> Paiement</span><button onclick="coGo(3)">Modifier</button></div>
                    <p>${payment.method === 'paypal' ? 'PayPal' : `${esc(op?.name || 'Mobile Money')} — ${esc(payment.phone)}`}</p>
                </div>
            </div>
            ${totalsHtml()}
            <div class="co-steps-info">
                <strong>Et ensuite ?</strong>
                <ol>
                    <li>Tu confirmes le paiement sur ton téléphone.</li>
                    <li>Chaque vendeur vérifie et <strong>accepte</strong> ta commande.</li>
                    <li>Un <strong>livreur proche</strong> la récupère et te l'apporte. Tu suis son trajet en direct.</li>
                    <li>Le vendeur est payé après la livraison. Commande refusée : tu es remboursé.</li>
                </ol>
            </div>
            <label class="terms-line">
                <input type="checkbox" id="coTerms">
                <span>J'accepte les conditions de vente et la <a href="privacy.html" target="_blank">politique de confidentialité</a>.</span>
            </label>
            <div class="form-error" id="coError" role="alert"></div>
            <div class="dl-actions">
                <button class="btn-submit btn-light" onclick="coBack()"><i class="fas fa-arrow-left"></i> Retour</button>
                <button class="btn-submit co-pay" id="coPay" onclick="coSubmit()"><i class="fas fa-lock"></i> Payer ${fcfa(totals().total)}</button>
            </div>`;
    }

    // ============ CARTE ============
    function initMap() {
        if (!window.L) {
            document.getElementById('coMap').innerHTML = '<p class="co-map-fallback">Carte indisponible : décris bien ton adresse et tes repères ci-dessous.</p>';
            return;
        }
        const c = CITY_CENTERS[delivery.countryCode] || CITY_CENTERS.CG;
        map = L.map('coMap', { zoomControl: true }).setView(delivery.lat ? [delivery.lat, delivery.lng] : [c.lat, c.lng], delivery.lat ? 17 : c.zoom);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19, attribution: '&copy; OpenStreetMap'
        }).addTo(map);
        if (delivery.lat) placeMarker(delivery.lat, delivery.lng, false);
        map.on('click', e => placeMarker(e.latlng.lat, e.latlng.lng, true));
        setTimeout(() => map && map.invalidateSize(), 150);
    }

    function placeMarker(lat, lng, lookup) {
        delivery.lat = Number(lat.toFixed(6));
        delivery.lng = Number(lng.toFixed(6));
        if (!marker) {
            marker = L.marker([lat, lng], { draggable: true }).addTo(map);
            marker.on('dragend', () => { const p = marker.getLatLng(); placeMarker(p.lat, p.lng, true); });
        } else {
            marker.setLatLng([lat, lng]);
        }
        const hint = document.getElementById('coMapHint');
        if (hint) hint.innerHTML = '<i class="fas fa-check-circle" style="color:var(--success);"></i> Position enregistrée. Déplace le repère pour corriger.';
        if (lookup) reverseGeocode(delivery.lat, delivery.lng);
    }

    // Pré-remplit rue et quartier (OpenStreetMap / Nominatim), sans écraser ce que le client a tapé
    async function reverseGeocode(lat, lng) {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=fr`);
            if (!res.ok) return;
            const a = (await res.json()).address || {};
            const street = [a.house_number, a.road].filter(Boolean).join(' ');
            const district = a.suburb || a.neighbourhood || a.quarter || a.city_district || '';
            const streetInput = document.getElementById('coStreet');
            const districtInput = document.getElementById('coDistrict');
            if (streetInput && !streetInput.value && street) streetInput.value = street;
            if (districtInput && !districtInput.value && district) districtInput.value = district;
        } catch (e) { /* pas de réseau : le client tape lui-même */ }
    }

    function coLocate() {
        if (!navigator.geolocation) { setError('Ton téléphone ne donne pas sa position : touche la carte à l\'endroit de ta maison.'); return; }
        const btn = document.querySelector('.co-locate');
        if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Recherche…';
        navigator.geolocation.getCurrentPosition(pos => {
            if (btn) btn.innerHTML = '<i class="fas fa-location-arrow"></i> Ma position';
            if (!map) return;
            map.setView([pos.coords.latitude, pos.coords.longitude], 17);
            placeMarker(pos.coords.latitude, pos.coords.longitude, true);
            setError('');
        }, () => {
            if (btn) btn.innerHTML = '<i class="fas fa-location-arrow"></i> Ma position';
            setError('Position refusée ou introuvable : touche la carte à l\'endroit de ta maison.');
        }, { enableHighAccuracy: true, timeout: 15000 });
    }

    // ============ NAVIGATION ============
    function readDelivery() {
        const v = id => (document.getElementById(id)?.value || '').trim();
        const cc = v('coCountry') || 'CG';
        let city = v('coCity');
        if (city === '__other') city = v('coCityOther');
        Object.assign(delivery, { countryCode: cc, city, district: v('coDistrict'), street: v('coStreet'), landmark: v('coLandmark') });
        const phone = F().normalizePhone(v('coPhone'), cc);
        if (!delivery.lat) return setError('Place le repère sur la carte (ou utilise « Ma position »).');
        if (city.length < 2) return setError('Indique ta ville.', 'coCityOther');
        if (delivery.district.length < 2) return setError('Indique ton quartier.', 'coDistrict');
        if (delivery.landmark.length < 10) return setError('Décris un peu plus l\'endroit (repères visibles) pour aider le livreur.', 'coLandmark');
        if (!phone) { const C = F().COUNTRIES[cc]; return setError(`Numéro invalide. Exemple : +${C.dial} ${C.example}`, 'coPhone'); }
        delivery.phone = phone;
        if (!payment.phone) payment.phone = phone;
        saveAddress();
        return true;
    }

    function readPayment() {
        if (payment.method === 'paypal') return true;
        if (!payment.operator) return setError('Choisis ton réseau Mobile Money.');
        const phone = F().normalizePhone(document.getElementById('coPayPhone')?.value, delivery.countryCode);
        if (!phone) return setError('Numéro Mobile Money invalide.', 'coPayPhone');
        payment.phone = phone;
        return true;
    }

    function coNext() {
        if (step === 1 && !cart.length) return;
        if (step === 2 && !readDelivery()) return;
        if (step === 3 && !readPayment()) return;
        step = Math.min(4, step + 1);
        render();
    }

    function coBack() {
        if (step === 2) {
            const v = id => (document.getElementById(id)?.value || '').trim();
            Object.assign(delivery, { district: v('coDistrict') || delivery.district, street: v('coStreet') || delivery.street, landmark: v('coLandmark') || delivery.landmark });
        }
        step = Math.max(1, step - 1);
        render();
    }

    function coGo(n) {
        step = n;
        render();
    }

    function coQty(idx, delta) {
        const item = cart[idx];
        if (!item) return;
        item.quantity += delta;
        if (item.quantity <= 0) cart.splice(idx, 1);
        saveCart();
        render();
    }

    function coCountryChange() {
        delivery.countryCode = document.getElementById('coCountry').value;
        delivery.city = '';
        payment.operator = '';
        const v = id => (document.getElementById(id)?.value || '').trim();
        Object.assign(delivery, { district: v('coDistrict'), street: v('coStreet'), landmark: v('coLandmark'), phone: v('coPhone') });
        const keep = delivery.lat ? { lat: delivery.lat, lng: delivery.lng } : null;
        if (!keep) {
            const c = CITY_CENTERS[delivery.countryCode];
            if (map) map.setView([c.lat, c.lng], c.zoom);
        }
        render();
    }

    function coMethod(method) {
        payment.method = method;
        render();
    }

    function coOperator(id) {
        payment.operator = id;
        const phone = document.getElementById('coPayPhone')?.value;
        if (phone) payment.phone = phone;
        render();
    }

    // Ce qui part au serveur : identifiants, quantités, livraison, paiement (pas de prix)
    function orderPayload() {
        return {
            items: cart.map(i => ({ product_id: i.productId, variant_key: i.variantKey || null, quantity: i.quantity })),
            delivery: {
                lat: delivery.lat, lng: delivery.lng, country_code: delivery.countryCode,
                country: F().COUNTRIES[delivery.countryCode].name, city: delivery.city, district: delivery.district,
                street: delivery.street, landmark: delivery.landmark, phone: delivery.phone
            },
            payment: { method: payment.method, operator: payment.method === 'mobile_money' ? payment.operator : null, phone: payment.method === 'mobile_money' ? payment.phone : null },
            client_total: totals().total   // contrôle seulement : le serveur recalcule
        };
    }

    async function coSubmit() {
        if (!document.getElementById('coTerms')?.checked) return setError('Accepte les conditions de vente pour continuer.');
        const btn = document.getElementById('coPay');
        btn.disabled = true;
        btn.textContent = 'Connexion au paiement…';
        setError('');
        const { data, error } = await window.supabase.functions.invoke('create-order', { body: orderPayload() });
        if (error || !data?.ok) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fas fa-lock"></i> Payer ${fcfa(totals().total)}`;
            let message = '';
            try { message = (await error?.context?.json())?.error || ''; } catch (e) { /* réponse non JSON */ }
            if (!message || /not found|failed to send|FunctionsFetchError|FunctionsHttpError/i.test(String(error?.name || error?.message || ''))) {
                message = 'Le paiement en ligne (pawaPay) est en cours d\'activation. Ta commande n\'a pas été passée et rien n\'a été débité : ton panier est conservé.';
            }
            return setError(message);
        }
        // Mobile Money : confirmation sur le téléphone ; PayPal : redirection
        if (data.redirect_url) { window.location.href = data.redirect_url; return; }
        cart = [];
        saveCart();
        box().innerHTML = `<div class="dl-status ok"><i class="fas fa-mobile-alt"></i>
            <h3>Confirme le paiement sur ton téléphone</h3>
            <p>Une demande de ${fcfa(data.total)} a été envoyée au ${esc(payment.phone)}. Tape ton code secret Mobile Money pour valider.</p>
            <a class="btn-submit" href="tracking.html?order=${encodeURIComponent(data.order_id)}">Suivre ma commande</a></div>`;
    }

    // ============ DÉMARRAGE ============
    async function init() {
        if (!window.supabase?.auth || !window.OuenzeForms) {
            box().innerHTML = '<div class="dl-status rejected"><p>Service indisponible. Recharge la page.</p></div>';
            return;
        }
        cart = loadCart();
        const { data } = await window.supabase.auth.getSession();
        user = data?.session?.user || null;
        if (!user) {
            box().innerHTML = `<div class="dl-status"><i class="fas fa-user-lock" style="color:var(--primary);"></i>
                <h3>Connecte-toi pour commander</h3><p>Ton panier est conservé.</p>
                <div class="dl-actions"><button class="btn-submit" onclick="openLoginModal()">Se connecter</button>
                <button class="btn-submit btn-light" onclick="openRegisterModal()">Créer un compte</button></div></div>`;
            window.supabase.auth.onAuthStateChange(e => { if (e === 'SIGNED_IN') location.reload(); });
            return;
        }
        const meta = user.user_metadata || {};
        const saved = loadSavedAddress();
        if (saved) Object.assign(delivery, saved);
        else Object.assign(delivery, { countryCode: meta.country_code || 'CG', city: meta.city || '', phone: meta.phone || '' });
        render();
    }

    Object.assign(window, { coNext, coBack, coGo, coQty, coLocate, coCountryChange, coMethod, coOperator, coSubmit });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
