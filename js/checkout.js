// ============================================================
// CHECKOUT.JS — Validation de la commande
//
// 1. Panier (regroupé par boutique : chaque vendeur valide sa partie)
// 2. Livraison : recherche d'adresse sur la carte ou « Ma position », repères, téléphone
//    (quartier, rue, ville et pays sont déduits de la carte, modifiables)
// 3. Paiement + récapitulatif : Mobile Money (réseaux locaux) ou PayPal — jamais de carte
//    en physique — puis commande via place_order() et emails via « order-notify »
//    (pawaPay sera branché avant le passage en mode « live »)
//
// Le navigateur n'envoie que des identifiants et des quantités : les prix,
// les frais et le total sont recalculés côté serveur.
// Dépendances : supabase-js → supabase-config → database → app (OuenzeForms) → Leaflet
// ============================================================

(function () {
    'use strict';

    const DELIVERY_RATE = 0.10;              // frais de livraison : 10 % du sous-total
    // Réseaux Mobile Money (paiement à la livraison via CinetPay)
    const OPERATORS = {
        CG: [
            { id: 'MTN_CG', name: 'MTN Mobile Money', color: '#ffcc00', text: '#000' },
            { id: 'AIRTEL_CG', name: 'Airtel Money', color: '#e40000', text: '#fff' }
        ],
        CD: [
            { id: 'MPESA_CD', name: 'M-Pesa (Vodacom)', color: '#e60000', text: '#fff' },
            { id: 'ORANGE_CD', name: 'Orange Money', color: '#ff7900', text: '#000' },
            { id: 'AIRTEL_CD', name: 'Airtel Money', color: '#e40000', text: '#fff' }
        ]
    };
    let step = 1;
    let user = null;
    let cart = [];
    const delivery = { countryCode: 'CG', city: '', district: '', street: '', landmark: '', phone: '' };
    const payment = { method: 'mobile_money_cod', operator: '', phone: '' };

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
            ? `<button class="btn-submit co-pay" id="coPay" onclick="coSubmit()"><i class="fas fa-check"></i> Commander</button>`
            : `<button class="btn-submit" onclick="coNext()">${step === 1 ? 'Livraison' : 'Paiement'} <i class="fas fa-arrow-right"></i></button>`;
        return `<div class="co-bar">${back}<div class="co-bar-total"><small>Total</small><strong>${fcfa(totals().total)}</strong></div>${main}</div>`;
    }

    // ============ ÉCRANS ============
    function render() {
        const el = box();
        if (!cart.length) {
            el.innerHTML = `<div class="dl-status"><i class="fas fa-shopping-basket" style="color:#cbd5e1;"></i>
                <h3>Ton panier est vide</h3><p>Ajoute des articles depuis les boutiques, puis reviens ici.</p>
                <a class="btn-submit" href="index.html">Voir les boutiques</a></div>`;
            return;
        }
        // Ordinateur : le panier reste visible à droite pendant la livraison et le paiement
        el.innerHTML = `<div class="co-layout ${step > 1 ? 'with-aside' : ''}">
            <div class="co-main">${stepper() + [cartHtml, deliveryHtml, paymentHtml][step - 1]() + actionBarHtml()}</div>
            ${step > 1 ? asideHtml() : ''}</div>`;
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
                            <div class="co-item-side">
                                <div class="pd-qty small">
                                    <button onclick="coQty(${idx}, -1)" aria-label="Moins">−</button>
                                    <span>${i.quantity}</span>
                                    <button onclick="coQty(${idx}, 1)" aria-label="Plus">+</button>
                                </div>
                                <button class="co-remove" onclick="coRemove(${idx})" aria-label="Retirer"><i class="fas fa-trash-alt"></i></button>
                            </div>
                        </div>`;
                    }).join('')}
                </div>`).join('')}
            ${totalsHtml()}
            <div class="form-error" id="coError" role="alert"></div>`;
    }

    function asideHtml() {
        return `<aside class="co-aside">
            <h4>Ton panier <button type="button" onclick="coGo(1)">Modifier</button></h4>
            ${cart.map(i => {
                const img = safeImg(i.photo);
                return `<div class="co-aside-item"><span>${img ? `<img src="${img}" alt="">` : '<i class="fas fa-box"></i>'}<b>${i.quantity}</b></span>
                    <div><strong>${esc(i.productName)}</strong>${i.variantKey ? `<small>${esc(i.variantKey)}</small>` : ''}</div>
                    <em>${fcfa(i.price * i.quantity)}</em></div>`;
            }).join('')}
            ${totalsHtml()}
        </aside>`;
    }

    function coRemove(idx) {
        cart.splice(idx, 1);
        saveCart();
        render();
    }

    function deliveryHtml() {
        const C = F().COUNTRIES[delivery.countryCode];
        if (!delivery.city || !C.cities.includes(delivery.city)) delivery.city = C.cities[0];
        return `
            <h3 class="dl-title">Où te livrer ?</h3>
            <p class="dl-sub"><i class="fas fa-phone-alt" style="color:var(--primary);"></i> Pas besoin de carte : <strong>Ouenze t'appelle</strong> pour confirmer ton adresse avant la livraison.</p>
            <div class="form-row-2">
                <div class="form-group"><label for="coCountry">Pays</label>
                    <select id="coCountry" onchange="coCountry(this.value)">
                        ${Object.entries(F().COUNTRIES).map(([cc, c]) => `<option value="${cc}" ${cc === delivery.countryCode ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
                    </select></div>
                <div class="form-group"><label for="coCity">Ville *</label>
                    <select id="coCity">${C.cities.map(c => `<option ${c === delivery.city ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
            </div>
            <div class="form-group">
                <label for="coDistrict">Quartier *</label>
                <input type="text" id="coDistrict" maxlength="60" placeholder="Ex : Talangaï, Moungali, Poto-Poto…" value="${esc(delivery.district)}">
            </div>
            <div class="form-group">
                <label for="coLandmark">Rue, repère (facultatif)</label>
                <input type="text" id="coLandmark" maxlength="300" placeholder="Ex : rue Ndolo, portail noir après la pharmacie" value="${esc(delivery.landmark)}">
            </div>
            <div class="form-group">
                <label for="coPhone">Ton numéro de téléphone *</label>
                <div class="phone-field"><span class="phone-prefix" id="coDial">+${C.dial}</span>
                <input type="tel" id="coPhone" inputmode="tel" placeholder="${C.example}" value="${esc(nationalPart(delivery.phone))}"></div>
                <p class="auth-note">Ouenze et le livreur t'appellent à ce numéro. Ton code de remise arrive aussi par SMS.</p>
            </div>
            <div class="form-error" id="coError" role="alert"></div>`;
    }

    function paymentHtml() {
        const ops = OPERATORS[delivery.countryCode] || [];
        if (!ops.some(o => o.id === payment.operator)) payment.operator = '';
        const count = cart.reduce((s, i) => s + i.quantity, 0);
        return `
            <h3 class="dl-title">Paiement à la livraison</h3>
            <p class="dl-sub"><i class="fas fa-shield-alt" style="color:var(--success);"></i> Tu ne paies <strong>rien maintenant</strong>. Tu paies par Mobile Money <strong>quand tu as ton colis</strong>.</p>
            <p class="co-label">Ton réseau Mobile Money *</p>
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
            </div>

            <div class="co-summary">
                <div class="co-summary-row">
                    <i class="fas fa-shopping-bag"></i>
                    <span>${count} article${count > 1 ? 's' : ''} · ${groups().length} boutique${groups().length > 1 ? 's' : ''}</span>
                    <button onclick="coGo(1)">Modifier</button>
                </div>
                <div class="co-summary-row">
                    <i class="fas fa-map-marker-alt"></i>
                    <span>${esc(placeText())}<br><small>${esc([delivery.landmark, delivery.phone].filter(Boolean).join(' · '))}</small></span>
                    <button onclick="coGo(2)">Modifier</button>
                </div>
            </div>
            ${totalsHtml()}
            <div class="co-next">
                <strong>Comment ça se passe</strong>
                <ol>
                    <li><b>1</b><p>Ouenze t'<strong>appelle</strong> pour confirmer ton adresse.</p></li>
                    <li><b>2</b><p>Le livreur t'apporte ton colis. Tu lui donnes ton <strong>code de remise</strong>, reçu par SMS.</p></li>
                    <li><b>3</b><p>Tu reçois la demande de paiement sur ton téléphone : tape ton <strong>code secret Mobile Money</strong>. C'est payé.</p></li>
                </ol>
            </div>
            <label class="terms-line">
                <input type="checkbox" id="coTerms">
                <span>J'accepte les conditions de vente et la <a href="privacy.html" target="_blank">politique de confidentialité</a>.</span>
            </label>
            <div class="form-error" id="coError" role="alert"></div>`;
    }

    // ============ SAISIE ============
    function rememberDeliveryFields() {
        const v = id => document.getElementById(id) ? document.getElementById(id).value.trim() : null;
        if (v('coCity') !== null) delivery.city = v('coCity');
        if (v('coDistrict') !== null) delivery.district = v('coDistrict');
        if (v('coLandmark') !== null) delivery.landmark = v('coLandmark');
    }

    function readDelivery() {
        rememberDeliveryFields();
        const cc = delivery.countryCode;
        if (delivery.district.length < 2) return setError('Indique ton quartier.', 'coDistrict');
        const phone = F().normalizePhone(document.getElementById('coPhone')?.value, cc);
        if (!phone) { const C = F().COUNTRIES[cc]; return setError(`Numéro invalide. Exemple : +${C.dial} ${C.example}`, 'coPhone'); }
        delivery.phone = phone;
        if (!payment.phone) payment.phone = phone;
        saveAddress();
        return true;
    }

    function coCountry(cc) {
        if (!F().COUNTRIES[cc]) return;
        rememberDeliveryFields();
        delivery.countryCode = cc;
        delivery.city = '';
        payment.operator = '';
        render();
    }

    function rememberPayPhone() {
        const raw = document.getElementById('coPayPhone')?.value;
        if (raw) payment.phone = F().normalizePhone(raw, delivery.countryCode) || raw;
    }

    function readPayment() {
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
                country_code: delivery.countryCode, country: F().COUNTRIES[delivery.countryCode].name,
                city: delivery.city, district: delivery.district, street: delivery.street,
                landmark: delivery.landmark, phone: delivery.phone
            },
            payment: { method: 'mobile_money_cod', operator: payment.operator, phone: payment.phone }
        };
    }

    // Commande créée par la base (place_order : prix recalculés, une commande par boutique),
    // puis emails au vendeur et au client (Edge Function « order-notify »).
    // Mode test : commande sans paiement réservée aux admins, marquée TEST partout.
    async function coSubmit() {
        if (!readPayment()) return;
        if (!document.getElementById('coTerms')?.checked) return setError('Coche « J\'accepte les conditions de vente » pour commander.', 'coTerms');
        const btn = document.getElementById('coPay');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi…';
        setError('');
        const body = orderPayload();
        const { data, error } = await window.supabase.rpc('place_order', { items: body.items, delivery: body.delivery, payment: body.payment });
        if (error || !data?.orders?.length) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check"></i> Commander';
            // Fonction absente de la base = migration 20261017 pas encore exécutée.
            // Sinon on affiche le vrai message de la base (stock, adresse, mode test…).
            const msg = error?.message || '';
            const missing = /place_order/.test(msg) && /Could not find|does not exist|schema cache/i.test(msg);
            if (error) console.error('❌ place_order :', error);
            return setError(missing
                ? 'La commande en ligne n\'est pas encore activée (base de données à mettre à jour). Rien n\'a été débité : ton panier est conservé.'
                : (msg || 'Commande impossible pour le moment. Ton panier est conservé.'));
        }
        cart = [];
        saveCart();
        // Les emails ne bloquent pas la commande : si l'envoi échoue, elle est quand même passée
        let mailed = true;
        let mailError = '';
        let mailSent = [];
        try {
            const res = await window.supabase.functions.invoke('order-notify', { body: { action: 'placed', order_ids: data.orders.map(o => o.order_id) } });
            mailSent = res.data?.sent || [];
            if (res.error) {
                mailed = false;
                try { mailError = (await res.error.context?.json())?.error || res.error.message || ''; } catch (e) { mailError = res.error.message || ''; }
                console.error('❌ order-notify :', mailError);
            }
        } catch (e) { mailed = false; mailError = e?.message || ''; }
        const test = data.mode !== 'live';
        box().innerHTML = `<div class="dl-status ok"><i class="fas fa-check-circle"></i>
            <h3>Commande envoyée${data.orders.length > 1 ? ` à ${data.orders.length} boutiques` : ''} !</h3>
            ${test ? '<p class="co-test-badge">Commande de TEST : rien n\'est débité, le vendeur ne doit rien expédier.</p>' : ''}
            <ul class="co-done-list">${data.orders.map(o => `<li><strong>${esc(o.shop_name)}</strong> — ${esc(o.order_number)}<span>${fcfa(o.total)}</span></li>`).join('')}</ul>
            <p>Total à payer à la livraison : <strong>${fcfa(data.total)}</strong>. <strong>Ouenze va t'appeler</strong> pour confirmer ton adresse, puis le vendeur prépare ta commande.</p>
            ${!mailed && test ? `<p class="co-test-badge">Emails non envoyés : ${esc(mailError || 'fonction order-notify injoignable')}</p>` : ''}
            ${mailed && test ? `<p class="co-mail-check">${mailCheck(mailSent)}</p>` : ''}
            <a class="btn-submit" href="activities.html">Suivre mes commandes</a></div>`;
        window.scrollTo(0, 0);
    }

    // Mode test : ce que Brevo a accepté (si un email accepté n'arrive pas : spam, boîte pleine → journal Brevo)
    function mailCheck(sent) {
        const vendors = sent.filter(x => x.to === 'vendor').length;
        const client = sent.some(x => x.to === 'client');
        if (!vendors && !client) return '<i class="fas fa-info-circle"></i> Aucun email envoyé (commande déjà annoncée, ou fonction order-notify à redéployer).';
        return `<i class="fas fa-paper-plane"></i> Brevo a accepté : email au vendeur ${vendors ? '✓' : '✗ (adresse du vendeur introuvable)'} · email à toi ${client ? '✓' : '✗'}.
            Rien reçu ? Regarde les spams, puis Brevo → Transactional → Logs.`;
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
        if (saved) { ['countryCode', 'city', 'district', 'street', 'landmark', 'phone'].forEach(k => { if (saved[k] != null) delivery[k] = saved[k]; }); }
        else Object.assign(delivery, { countryCode: F().COUNTRIES[meta.country_code] ? meta.country_code : 'CG', city: meta.city || '', phone: meta.phone || '' });
        render();
    }

    Object.assign(window, { coNext, coBack, coGo, coQty, coRemove, coCountry, coOperator, coSubmit });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
