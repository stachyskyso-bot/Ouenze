// ============================================================
// CHECKOUT.JS — Validation de la commande
//
// 1. Panier (regroupé par boutique : chaque vendeur valide sa partie)
// 2. Livraison : recherche d'adresse sur la carte ou « Ma position », repères, téléphone
//    (quartier, rue, ville et pays sont déduits de la carte, modifiables)
// 3. Paiement + récapitulatif : Mobile Money (réseaux locaux) ou PayPal — jamais de carte
//    en physique — puis paiement via l'Edge Function « create-order » (pawaPay)
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
    // Recherche d'adresse (Photon / OpenStreetMap) limitée aux deux Congo : ouest, sud, est, nord
    const SEARCH_BBOX = '11.0,-13.5,31.5,5.5';

    let step = 1;
    let user = null;
    let cart = [];
    let map = null;
    let marker = null;
    let searchTimer = null;
    let searchSeq = 0;
    let suggestions = [];
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
            if (msg) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        if (fieldId) document.getElementById(fieldId)?.focus({ preventScroll: true });
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

    function placeText() {
        return [delivery.street, delivery.district, delivery.city].filter(Boolean).join(', ');
    }

    function stepper() {
        const labels = ['Panier', 'Livraison', 'Paiement'];
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

    // Barre d'action toujours visible en bas : retour, total, bouton principal
    function actionBarHtml() {
        const back = step > 1 ? `<button class="co-bar-back" onclick="coBack()" aria-label="Retour"><i class="fas fa-arrow-left"></i></button>` : '';
        const main = step === 3
            ? `<button class="btn-submit co-pay" id="coPay" onclick="coSubmit()"><i class="fas fa-lock"></i> Payer</button>`
            : `<button class="btn-submit" onclick="coNext()">${step === 1 ? 'Choisir la livraison' : 'Choisir le paiement'} <i class="fas fa-arrow-right"></i></button>`;
        return `<div class="co-bar">${back}<div class="co-bar-total"><small>Total</small><strong>${fcfa(totals().total)}</strong></div>${main}</div>`;
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
        el.innerHTML = stepper() + [cartHtml, deliveryHtml, paymentHtml][step - 1]() + actionBarHtml();
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
            <div class="form-error" id="coError" role="alert"></div>`;
    }

    function placeCardHtml() {
        if (!delivery.lat) {
            return `<i class="fas fa-search-location"></i><span><strong>Aucune adresse choisie</strong><small>Cherche ci-dessus, utilise « Ma position » ou touche la carte.</small></span>`;
        }
        return `<i class="fas fa-check-circle"></i><span><strong>${esc(placeText() || 'Position choisie sur la carte')}</strong><small>Fais glisser le repère rouge sur ta maison si besoin.</small></span>`;
    }

    function deliveryHtml() {
        const C = F().COUNTRIES[delivery.countryCode];
        return `
            <h3 class="dl-title">Où te livrer ?</h3>
            <p class="dl-sub">Tape ton quartier, ta rue ou un lieu connu près de chez toi.</p>
            <div class="co-search-box">
                <div class="co-search">
                    <i class="fas fa-search"></i>
                    <input type="search" id="coSearch" placeholder="Ex : Poto-Poto, Marché Total, avenue de la Paix…" autocomplete="off" enterkeyhint="search" aria-label="Rechercher une adresse">
                </div>
                <button type="button" class="co-locate-btn" onclick="coLocate()"><i class="fas fa-location-arrow"></i><span>Ma position</span></button>
                <ul class="co-suggestions" id="coSuggestions" role="listbox"></ul>
            </div>
            <div class="co-map-wrap"><div id="coMap" class="co-map"></div></div>
            <div class="co-place ${delivery.lat ? 'ok' : ''}" id="coPlace">${placeCardHtml()}</div>

            <div class="form-group">
                <label for="coLandmark">Repères pour le livreur *</label>
                <textarea id="coLandmark" rows="2" maxlength="300" placeholder="Ex : portail bleu, 2e maison après la pharmacie">${esc(delivery.landmark)}</textarea>
            </div>
            <div class="form-group">
                <label for="coPhone">Téléphone pour la livraison *</label>
                <div class="phone-field"><span class="phone-prefix" id="coDial">+${C.dial}</span>
                <input type="tel" id="coPhone" inputmode="tel" placeholder="${C.example}" value="${esc(nationalPart(delivery.phone))}"></div>
                <p class="auth-note">Le livreur t'appellera à ce numéro. Tu peux le modifier.</p>
            </div>
            <details class="co-more">
                <summary>Corriger le quartier ou la rue (facultatif)</summary>
                <div class="form-row-2">
                    <div class="form-group"><label for="coDistrict">Quartier</label><input type="text" id="coDistrict" maxlength="60" value="${esc(delivery.district)}"></div>
                    <div class="form-group"><label for="coStreet">Rue / numéro</label><input type="text" id="coStreet" maxlength="100" value="${esc(delivery.street)}"></div>
                </div>
            </details>
            <div class="form-error" id="coError" role="alert"></div>`;
    }

    function paymentHtml() {
        const ops = OPERATORS[delivery.countryCode] || [];
        if (payment.method === 'mobile_money' && !ops.some(o => o.id === payment.operator)) payment.operator = '';
        const count = cart.reduce((s, i) => s + i.quantity, 0);
        return `
            <h3 class="dl-title">Comment veux-tu payer ?</h3>
            <p class="dl-sub"><i class="fas fa-shield-alt" style="color:var(--success);"></i> Ton argent est bloqué par Ouenze et versé au vendeur <strong>seulement après la livraison</strong>. Commande refusée : tu es remboursé.</p>
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
                <p class="co-label">Ton réseau *</p>
                <div class="co-operators">
                    ${ops.map(o => `
                        <label class="co-operator ${payment.operator === o.id ? 'selected' : ''}">
                            <input type="radio" name="coOperator" value="${o.id}" ${payment.operator === o.id ? 'checked' : ''} onchange="coOperator('${o.id}')">
                            <span class="co-op-logo" style="background:${o.color};color:${o.text};">${esc(o.name.split(' ')[0])}</span>
                            <span>${esc(o.name)}</span>
                        </label>`).join('')}
                </div>
                <div class="form-group" style="margin-top:12px;"><label for="coPayPhone">Numéro Mobile Money *</label>
                    <div class="phone-field"><span class="phone-prefix">+${F().COUNTRIES[delivery.countryCode].dial}</span>
                    <input type="tel" id="coPayPhone" inputmode="tel" value="${esc(nationalPart(payment.phone || delivery.phone))}"></div>
                    <p class="auth-note">Tu recevras une demande sur ce téléphone : valide-la avec ton code secret Mobile Money.</p>
                </div>` : `
                <p class="co-paypal-note"><i class="fab fa-paypal"></i> Tu seras redirigé vers PayPal pour payer, puis ramené sur Ouenze.</p>`}
            <p class="co-no-card"><i class="fas fa-ban"></i> Le paiement par carte à la livraison n'est pas accepté.</p>

            <div class="co-summary">
                <div class="co-summary-row">
                    <i class="fas fa-shopping-bag"></i>
                    <span>${count} article${count > 1 ? 's' : ''} · ${groups().length} boutique${groups().length > 1 ? 's' : ''}</span>
                    <button onclick="coGo(1)">Modifier</button>
                </div>
                <div class="co-summary-row">
                    <i class="fas fa-map-marker-alt"></i>
                    <span>${esc(placeText() || 'Position sur la carte')}<br><small>${esc(delivery.landmark)} · ${esc(delivery.phone)}</small></span>
                    <button onclick="coGo(2)">Modifier</button>
                </div>
            </div>
            ${totalsHtml()}
            <div class="co-next">
                <strong>Après le paiement</strong>
                <ol>
                    <li><b>1</b><p>Le vendeur reçoit ta commande par email et l'<strong>accepte</strong>.</p></li>
                    <li><b>2</b><p>Un <strong>livreur proche</strong> la récupère.</p></li>
                    <li><b>3</b><p>Tu suis son trajet en direct jusqu'à chez toi.</p></li>
                </ol>
            </div>
            <label class="terms-line">
                <input type="checkbox" id="coTerms">
                <span>J'accepte les conditions de vente et la <a href="privacy.html" target="_blank">politique de confidentialité</a>.</span>
            </label>
            <div class="form-error" id="coError" role="alert"></div>`;
    }

    // ============ CARTE ============
    function initMap() {
        if (!window.L) {
            document.getElementById('coMap').innerHTML = '<p class="co-map-fallback">Carte indisponible : décris bien ton adresse et tes repères ci-dessous.</p>';
            bindSearch();
            return;
        }
        const c = CITY_CENTERS[delivery.countryCode] || CITY_CENTERS.CG;
        map = L.map('coMap', { zoomControl: true }).setView(delivery.lat ? [delivery.lat, delivery.lng] : [c.lat, c.lng], delivery.lat ? 17 : c.zoom);
        // Tuiles haute définition ({r} = « @2x » sur les écrans de téléphone) : carte nette et noms lisibles
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            maxZoom: 20, subdomains: 'abcd', attribution: '&copy; OpenStreetMap &copy; CARTO'
        }).addTo(map);
        if (delivery.lat) placeMarker(delivery.lat, delivery.lng, false);
        map.on('click', e => placeMarker(e.latlng.lat, e.latlng.lng, true));
        setTimeout(() => map && map.invalidateSize(), 150);
        bindSearch();
    }

    function placeMarker(lat, lng, lookup) {
        delivery.lat = Number(lat.toFixed(6));
        delivery.lng = Number(lng.toFixed(6));
        if (map) {
            if (!marker) {
                marker = L.marker([lat, lng], { draggable: true }).addTo(map);
                marker.on('dragend', () => { const p = marker.getLatLng(); placeMarker(p.lat, p.lng, true); });
            } else {
                marker.setLatLng([lat, lng]);
            }
        }
        setError('');
        updatePlaceCard();
        if (lookup) reverseGeocode(delivery.lat, delivery.lng);
    }

    function updatePlaceCard() {
        const card = document.getElementById('coPlace');
        if (card) {
            card.classList.toggle('ok', !!delivery.lat);
            card.innerHTML = placeCardHtml();
        }
        const d = document.getElementById('coDistrict');
        if (d) d.value = delivery.district;
        const st = document.getElementById('coStreet');
        if (st) st.value = delivery.street;
    }

    // Le pays suit la position choisie (indicatif téléphonique et réseaux Mobile Money)
    function setCountry(cc) {
        if (!F().COUNTRIES[cc] || cc === delivery.countryCode) return;
        delivery.countryCode = cc;
        payment.operator = '';
        const C = F().COUNTRIES[cc];
        const dial = document.getElementById('coDial');
        if (dial) dial.textContent = '+' + C.dial;
        const phone = document.getElementById('coPhone');
        if (phone) phone.placeholder = C.example;
    }

    // Déduit quartier, rue, ville et pays du point choisi (OpenStreetMap / Nominatim)
    async function reverseGeocode(lat, lng) {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=fr&zoom=18`);
            if (!res.ok) return;
            const a = (await res.json()).address || {};
            if (lat !== delivery.lat || lng !== delivery.lng) return;   // le client a déjà bougé le repère
            setCountry(String(a.country_code || '').toUpperCase());
            delivery.street = [a.house_number, a.road].filter(Boolean).join(' ');
            delivery.district = a.suburb || a.neighbourhood || a.quarter || a.city_district || '';
            delivery.city = a.city || a.town || a.village || a.county || delivery.city;
            updatePlaceCard();
        } catch (e) { /* pas de réseau : la position et les repères suffisent */ }
    }

    // ============ RECHERCHE D'ADRESSE ============
    function bindSearch() {
        const input = document.getElementById('coSearch');
        if (!input) return;
        input.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => searchPlaces(input.value, false), 350);
        });
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchTimer); searchPlaces(input.value, true); }
            if (e.key === 'Escape') showSuggestions(null);
        });
    }

    function suggestionLabel(p) {
        const main = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.district || p.city || '';
        const parts = [p.name ? p.street : '', p.district || p.locality, p.city || p.county, p.countrycode === 'CD' ? 'RDC' : 'Congo'];
        return { main, rest: [...new Set(parts.filter(x => x && x !== main))].join(', ') };
    }

    async function searchPlaces(query, pickFirst) {
        const q = String(query || '').trim();
        if (q.length < 3) { showSuggestions(null); return; }
        const seq = ++searchSeq;
        const center = map ? map.getCenter() : CITY_CENTERS[delivery.countryCode];
        showSuggestions('loading');
        try {
            const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=fr&limit=6&bbox=${SEARCH_BBOX}&lat=${center.lat}&lon=${center.lng}`);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const json = await res.json();
            if (seq !== searchSeq) return;   // une recherche plus récente est en cours
            suggestions = (json.features || [])
                .filter(f => ['CG', 'CD'].includes(f.properties?.countrycode) && Array.isArray(f.geometry?.coordinates))
                .map(f => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], props: f.properties }));
            if (pickFirst && suggestions.length) { coPickSuggestion(0); return; }
            showSuggestions(suggestions);
        } catch (e) {
            if (seq === searchSeq) showSuggestions('error');
        }
    }

    function showSuggestions(list) {
        const ul = document.getElementById('coSuggestions');
        if (!ul) return;
        if (!list) { ul.innerHTML = ''; return; }
        if (list === 'loading') { ul.innerHTML = '<li class="info"><i class="fas fa-spinner fa-spin"></i> Recherche…</li>'; return; }
        if (list === 'error') { ul.innerHTML = '<li class="info">Recherche indisponible : utilise « Ma position » ou touche la carte.</li>'; return; }
        ul.innerHTML = list.length ? list.map((s, i) => {
            const l = suggestionLabel(s.props);
            return `<li role="option" tabindex="0" onclick="coPickSuggestion(${i})" onkeydown="if(event.key==='Enter')coPickSuggestion(${i})">
                <i class="fas fa-map-marker-alt"></i><span><strong>${esc(l.main)}</strong><small>${esc(l.rest)}</small></span></li>`;
        }).join('') : '<li class="info">Aucun résultat. Essaie un lieu connu proche (marché, école, église…).</li>';
    }

    function coPickSuggestion(i) {
        const s = suggestions[i];
        if (!s) return;
        const p = s.props;
        setCountry(p.countrycode);
        delivery.city = p.city || p.county || delivery.city;
        delivery.district = p.district || p.locality || '';
        delivery.street = [p.housenumber, p.street].filter(Boolean).join(' ');
        if (map) map.setView([s.lat, s.lng], 17);
        placeMarker(s.lat, s.lng, false);
        showSuggestions(null);
        const input = document.getElementById('coSearch');
        if (input) input.value = suggestionLabel(p).main;
        const landmark = document.getElementById('coLandmark');
        if (landmark && !landmark.value) landmark.focus({ preventScroll: true });
    }

    function coLocate() {
        if (!navigator.geolocation) { setError('Ton téléphone ne donne pas sa position : cherche ton adresse ou touche la carte.'); return; }
        const btn = document.querySelector('.co-locate-btn');
        const idle = '<i class="fas fa-location-arrow"></i><span>Ma position</span>';
        if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Recherche…</span>';
        navigator.geolocation.getCurrentPosition(pos => {
            if (btn) btn.innerHTML = idle;
            if (map) map.setView([pos.coords.latitude, pos.coords.longitude], 17);
            placeMarker(pos.coords.latitude, pos.coords.longitude, true);
        }, () => {
            if (btn) btn.innerHTML = idle;
            setError('Position refusée ou introuvable : cherche ton adresse ou touche la carte.');
        }, { enableHighAccuracy: true, timeout: 15000 });
    }

    // ============ NAVIGATION ============
    function rememberDeliveryFields() {
        const v = id => document.getElementById(id) ? document.getElementById(id).value.trim() : null;
        if (v('coLandmark') !== null) delivery.landmark = v('coLandmark');
        if (v('coDistrict') !== null) delivery.district = v('coDistrict');
        if (v('coStreet') !== null) delivery.street = v('coStreet');
    }

    function readDelivery() {
        rememberDeliveryFields();
        const cc = delivery.countryCode;
        if (!delivery.lat) return setError('Choisis ton adresse : cherche-la, utilise « Ma position » ou touche la carte.', 'coSearch');
        if (delivery.landmark.length < 5) return setError('Ajoute un repère pour le livreur (ex : portail bleu, après la pharmacie).', 'coLandmark');
        const phone = F().normalizePhone(document.getElementById('coPhone')?.value, cc);
        if (!phone) { const C = F().COUNTRIES[cc]; return setError(`Numéro invalide. Exemple : +${C.dial} ${C.example}`, 'coPhone'); }
        delivery.phone = phone;
        if (!delivery.city) delivery.city = F().COUNTRIES[cc].cities[0];
        if (!payment.phone) payment.phone = phone;
        saveAddress();
        return true;
    }

    function rememberPayPhone() {
        const raw = document.getElementById('coPayPhone')?.value;
        if (raw) payment.phone = F().normalizePhone(raw, delivery.countryCode) || raw;
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
        step = Math.min(3, step + 1);
        render();
    }

    function coBack() {
        if (step === 2) rememberDeliveryFields();
        if (step === 3) rememberPayPhone();
        step = Math.max(1, step - 1);
        render();
    }

    function coGo(n) {
        if (step === 3) rememberPayPhone();
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

    function coMethod(method) {
        rememberPayPhone();
        payment.method = method;
        render();
    }

    function coOperator(id) {
        rememberPayPhone();
        payment.operator = id;
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
        if (!readPayment()) return;
        if (!document.getElementById('coTerms')?.checked) return setError('Coche « J\'accepte les conditions de vente » pour payer.', 'coTerms');
        const btn = document.getElementById('coPay');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connexion…';
        setError('');
        const { data, error } = await window.supabase.functions.invoke('create-order', { body: orderPayload() });
        if (error || !data?.ok) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-lock"></i> Payer';
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
        else Object.assign(delivery, { countryCode: F().COUNTRIES[meta.country_code] ? meta.country_code : 'CG', city: meta.city || '', phone: meta.phone || '' });
        render();
    }

    Object.assign(window, { coNext, coBack, coGo, coQty, coLocate, coMethod, coOperator, coSubmit, coPickSuggestion });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
