// ============================================================
// DELIVERY-DASHBOARD.JS — Espace livreur (delivery-dashboard.html)
//
// Sources (Supabase, migration 20261019_couriers.sql) :
//   • my_courier_profile()     → niveau, note, zone, plafond, gains, disponibilité
//   • courier_set_presence()   → « Je suis disponible » + position GPS
//   • available_deliveries()   → courses à prendre (et celles réservées aux niveaux supérieurs)
//   • take_delivery()          → prendre une course (code de remise envoyé au client)
//   • courier_step()           → colis récupéré · livrée (avec le code du client) · abandon
//   • my_deliveries()          → mes courses en cours et terminées
// Les règles (niveau, zone, plafond) sont vérifiées par la base : l'écran ne fait qu'afficher.
// ============================================================

(function () {
    'use strict';

    // Copie des règles de courier_level() (SQL) pour expliquer comment monter de niveau
    const LEVELS = [
        { level: 1, name: 'Nouveau', need: 'Au départ', zone: '3 km', max: '30 000 FCFA' },
        { level: 2, name: 'Confirmé', need: 'Score ≥ 5', zone: '5 km', max: '75 000 FCFA' },
        { level: 3, name: 'Expert', need: 'Score ≥ 10', zone: '8 km', max: '150 000 FCFA' },
        { level: 4, name: 'Élite', need: 'Score ≥ 15 et note ≥ 4', zone: '15 km', max: '400 000 FCFA' },
        { level: 5, name: '5 étoiles', need: '30 livraisons et note ≥ 4,5', zone: 'Toute la ville (30 km)', max: 'Sans plafond' }
    ];
    const STATUS = {
        courier_assigned: 'À récupérer', in_transit: 'En route vers le client', picked_up: 'En route vers le client',
        delivered: 'Livrée', accepted: 'Rendue', cancelled: 'Annulée', refused: 'Refusée'
    };
    const state = { profile: null, available: [], mine: [], tab: 'available', busy: false, timer: null, geoTimer: null };
    const app = () => document.getElementById('courierApp');

    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fcfa = n => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} FCFA`;
    const km = n => n == null ? '—' : `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;
    const starsTxt = n => '★'.repeat(n) + '☆'.repeat(5 - n);
    const mapsLink = (lat, lng, text) => lat != null && lng != null
        ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text || '')}`;
    const rpc = (name, args) => window.supabase.rpc(name, args);

    // ---------- Position ----------
    function position() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) { reject(new Error('Ton appareil ne donne pas sa position.')); return; }
            navigator.geolocation.getCurrentPosition(
                p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
                () => reject(new Error('Autorise la localisation pour recevoir les courses proches de toi.')),
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
        });
    }

    async function goOnline() {
        if (state.busy) return;
        state.busy = true;
        try {
            const pos = await position();
            const { error } = await rpc('courier_set_presence', { is_online: true, new_lat: pos.lat, new_lng: pos.lng });
            if (error) throw error;
            await refresh();
        } catch (e) {
            say('Impossible de passer en disponible', e.message || 'Active ta localisation puis réessaie.');
        } finally {
            state.busy = false;
        }
    }

    async function goOffline() {
        await rpc('courier_set_presence', { is_online: false });
        await refresh();
    }

    // Garde la position à jour tant que le livreur est disponible (toutes les 5 min)
    function keepPosition() {
        clearInterval(state.geoTimer);
        if (!state.profile?.online) return;
        state.geoTimer = setInterval(async () => {
            if (!state.profile?.online) return;
            try {
                const pos = await position();
                await rpc('courier_set_presence', { is_online: true, new_lat: pos.lat, new_lng: pos.lng });
            } catch (e) { /* on garde la dernière position */ }
        }, 5 * 60 * 1000);
    }

    // ---------- Données ----------
    async function refresh() {
        const { data: profile, error } = await rpc('my_courier_profile');
        if (error) {
            state.profile = { status: 'error', message: /my_courier_profile|Could not find|does not exist|schema cache/i.test(error.message || '')
                ? "L'espace livreur arrive bientôt (base de données à mettre à jour)." : error.message };
            render();
            return;
        }
        state.profile = profile;
        if (profile.status === 'approved') {
            const [a, m] = await Promise.all([rpc('available_deliveries'), rpc('my_deliveries')]);
            state.available = a.data || [];
            state.mine = m.data || [];
        }
        render();
        keepPosition();
    }

    // ---------- Affichage ----------
    function gateHtml(p) {
        const msg = {
            none: ['fa-motorcycle', 'Deviens livreur Ouenze', 'Inscris-toi : un administrateur vérifie ton permis, ta pièce d\'identité et ton véhicule.', '<a class="btn-submit" href="delivery-register.html">Devenir livreur</a>'],
            pending: ['fa-hourglass-half', 'Candidature en vérification', 'Un administrateur vérifie ton dossier. Tu recevras un email dès qu\'il est validé.', '<a class="notif-btn" href="delivery-register.html">Voir ma candidature</a>'],
            rejected: ['fa-times-circle', 'Candidature refusée', 'Corrige ton dossier puis renvoie-le.', '<a class="btn-submit" href="delivery-register.html">Corriger mon dossier</a>'],
            error: ['fa-tools', 'Espace livreur indisponible', p.message || '', '']
        }[p.status] || ['fa-user-lock', 'Accès réservé', '', ''];
        return `<div class="notif-empty courier-gate"><i class="fas ${msg[0]}"></i><h3>${esc(msg[1])}</h3><p>${esc(msg[2])}</p>${msg[3]}</div>`;
    }

    function headerHtml(p) {
        const lv = LEVELS.find(l => l.level === p.level);
        const next = LEVELS.find(l => l.level === p.level + 1);
        return `
        <section class="courier-card level-${p.level}">
            <div class="courier-id">
                <div class="courier-badge" aria-label="Niveau ${p.level}">${p.level ? '★'.repeat(p.level) : '⛔'}</div>
                <div>
                    <small>Livreur ${esc(p.vehicle_type === 'voiture' ? 'en voiture' : 'à moto')} · ${esc(p.city || '')}</small>
                    <h2>${esc(p.full_name || 'Livreur')}</h2>
                    <strong class="courier-level">Niveau ${p.level} · ${esc(p.level_name)}</strong>
                </div>
            </div>
            <div class="courier-stats">
                <div><b>${p.deliveries}</b><span>livraisons</span></div>
                <div><b>${p.reviews ? Number(p.rating).toLocaleString('fr-FR') + ' ★' : '—'}</b><span>${p.reviews} avis</span></div>
                <div><b>${Number(p.score).toLocaleString('fr-FR')}</b><span>score</span></div>
                <div><b>${fcfa(p.earned)}</b><span>gagnés</span></div>
            </div>
            <div class="courier-rights">
                <span><i class="fas fa-bullseye"></i> Zone : <b>${p.level === 5 ? 'toute la ville' : p.radius_km + ' km autour de toi'}</b></span>
                <span><i class="fas fa-box"></i> ${p.max_amount == null ? 'Commandes <b>sans plafond</b>' : `Commandes jusqu'à <b>${fcfa(p.max_amount)}</b>`}</span>
            </div>
            ${next ? `<p class="courier-next"><i class="fas fa-arrow-up"></i> Prochain niveau, <b>${esc(next.name)}</b> : ${esc(next.need)} → zone ${esc(next.zone)}, commandes jusqu'à ${esc(next.max)}.</p>` : (lv ? '<p class="courier-next"><i class="fas fa-crown"></i> Tu es au niveau maximum. Bravo !</p>' : '')}
            <div class="courier-online ${p.online ? 'on' : ''}">
                ${p.online
                    ? `<span><i class="fas fa-circle"></i> Disponible : tu reçois les courses de ta zone</span><button class="notif-btn" onclick="courierOffline()">Faire une pause</button>`
                    : `<span><i class="far fa-circle"></i> Hors ligne : tu ne reçois pas de courses</span><button class="notif-btn ok" onclick="courierOnline()"><i class="fas fa-location-arrow"></i> Je suis disponible</button>`}
            </div>
        </section>`;
    }

    function availableHtml() {
        if (!state.profile.online) return '<div class="notif-empty"><i class="fas fa-power-off"></i><p>Passe en « disponible » pour voir les courses près de toi.</p></div>';
        if (!state.available.length) return '<div class="notif-empty"><i class="fas fa-mug-hot"></i><p>Aucune course pour le moment. Cette page se met à jour toute seule.</p></div>';
        return state.available.map(d => `
            <article class="course ${d.allowed ? '' : 'locked'}">
                <div class="course-top">
                    <strong>${esc(d.shop_name)} → ${esc(d.dropoff_area || 'client')}</strong>
                    <span class="course-fee">${fcfa(d.fee)}</span>
                </div>
                <p class="course-route"><i class="fas fa-store"></i> ${esc(d.pickup_area || '—')} · à ${km(d.to_pickup_km)} de toi${d.trip_km != null ? ` · trajet ${km(d.trip_km)}` : ''}</p>
                <p class="course-meta">${d.items} article${d.items > 1 ? 's' : ''} · valeur ${fcfa(d.amount)}${d.is_test ? ' · <b>TEST</b>' : ''}</p>
                ${d.allowed
                    ? `<button class="notif-btn ok" onclick="courierTake('${esc(d.order_id)}')"><i class="fas fa-hand-paper"></i> Prendre la course</button>`
                    : `<p class="course-lock"><i class="fas fa-lock"></i> ${esc(d.reason)}</p>`}
            </article>`).join('');
    }

    // Contacts du vendeur et du client (visibles tant que la course est en cours)
    function contactHtml(role, icon, name, sub, phone, email) {
        const tel = String(phone || '').replace(/[^\d+]/g, '');
        const wa = tel.replace(/^\+/, '');
        return `<div class="course-contact">
                <div><i class="fas ${icon}"></i> <b>${esc(role)}</b> · ${esc(name || '—')}${sub ? `<br><small>${esc(sub)}</small>` : ''}
                    <br><small>${phone ? esc(phone) : 'Téléphone non renseigné'}${email ? ' · ' + esc(email) : ''}</small></div>
                <div class="notif-actions">
                    ${tel ? `<a class="notif-btn" href="tel:${esc(tel)}"><i class="fas fa-phone"></i> Appeler</a>
                    <a class="notif-btn" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> WhatsApp</a>` : ''}
                    ${email ? `<a class="notif-btn" href="mailto:${esc(email)}"><i class="fas fa-envelope"></i> Email</a>` : ''}
                </div>
            </div>`;
    }

    // Carte : boutique (bleu) et client (vert)
    function drawCourseMaps() {
        (state.maps || []).forEach(m => m.remove());
        state.maps = [];
        if (!window.L) return;
        document.querySelectorAll('.course-map[data-order]').forEach(div => {
            const d = state.mine.find(x => String(x.order_id) === div.dataset.order);
            if (!d) return;
            const pts = [];
            const map = L.map(div, { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
            L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
                maxZoom: 20, subdomains: 'abcd', attribution: '&copy; OpenStreetMap &copy; CARTO'
            }).addTo(map);
            const dot = (lat, lng, color, label) => {
                if (lat == null || lng == null) return;
                pts.push([Number(lat), Number(lng)]);
                L.circleMarker([Number(lat), Number(lng)], { radius: 9, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 })
                    .addTo(map).bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -8] });
            };
            dot(d.shop_lat, d.shop_lng, '#1e40af', '🏪 ' + (d.shop_name || 'Boutique'));
            dot(d.client_lat, d.client_lng, '#16a34a', '🏠 Client');
            if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 });
            else if (pts.length) map.setView(pts[0], 15);
            else { div.remove(); map.remove(); return; }
            state.maps.push(map);
        });
    }

    function activeCard(d) {
        const toShop = d.status === 'courier_assigned';
        const items = (d.items || []).map(i => `${esc(i.name)}${i.variant ? ` (${esc(i.variant)})` : ''} × ${i.quantity}`).join(', ');
        return `
            <article class="course active">
                <div class="course-top"><strong>Commande ${esc(d.order_number)}${d.is_test ? ' · TEST' : ''}</strong><span class="notif-status">${esc(STATUS[d.status] || d.status)}</span></div>
                <div class="course-map" data-order="${esc(d.order_id)}"></div>
                <div class="course-contacts">
                    ${contactHtml('Vendeur', 'fa-store', d.vendor_name, d.shop_name, d.vendor_phone, d.vendor_email)}
                    ${contactHtml('Client', 'fa-user', d.client_name, null, d.client_phone, d.client_email)}
                </div>
                <ol class="course-steps">
                    <li class="${toShop ? 'now' : 'done'}"><i class="fas fa-store"></i> <b>Récupérer</b> chez ${esc(d.shop_name)}<br><small>${esc(d.shop_address || '')}</small>
                        ${toShop ? `<div class="notif-actions"><a class="notif-btn" target="_blank" rel="noopener" href="${mapsLink(d.shop_lat, d.shop_lng, d.shop_address)}"><i class="fas fa-directions"></i> Itinéraire</a>
                        <button class="notif-btn ok" onclick="courierStep('${esc(d.order_id)}', 'pickup')"><i class="fas fa-box"></i> J'ai récupéré le colis</button></div>` : ''}</li>
                    <li class="${toShop ? '' : 'now'}"><i class="fas fa-home"></i> <b>Livrer</b> à ${esc(d.client_name)} · ${esc(d.dropoff_area || '')}<br>
                        <small>${d.landmark ? 'Repère : ' + esc(d.landmark) : ''}</small>
                        ${toShop ? '' : `<div class="notif-actions"><a class="notif-btn" target="_blank" rel="noopener" href="${mapsLink(d.client_lat, d.client_lng, d.dropoff_area)}"><i class="fas fa-directions"></i> Itinéraire</a>
                        <button class="notif-btn ok" onclick="courierDeliver('${esc(d.order_id)}')"><i class="fas fa-check"></i> Livrée : entrer le code</button></div>`}</li>
                </ol>
                <p class="course-meta">${items} · valeur ${fcfa(d.amount)} · ton gain <b>${fcfa(d.fee)}</b></p>
                ${toShop ? `<button class="course-release" onclick="courierRelease('${esc(d.order_id)}')">Je ne peux plus faire cette course</button>` : ''}
            </article>`;
    }

    function historyHtml(list) {
        if (!list.length) return '<div class="notif-empty"><i class="fas fa-history"></i><p>Tes livraisons terminées apparaîtront ici, avec la note du client.</p></div>';
        return list.map(d => `
            <article class="course done">
                <div class="course-top"><strong>${esc(d.order_number)}${d.is_test ? ' · TEST' : ''}</strong><span class="course-fee">${fcfa(d.fee)}</span></div>
                <p class="course-meta">${esc(d.shop_name)} → ${esc(d.dropoff_area || '')} · ${new Date(d.updated_at).toLocaleDateString('fr-FR')}</p>
                ${d.stars ? `<p class="course-review"><span>${starsTxt(d.stars)}</span>${d.review ? ' « ' + esc(d.review) + ' »' : ''}</p>` : '<p class="course-meta">Pas encore noté par le client.</p>'}
            </article>`).join('');
    }

    function levelsHtml(current) {
        return `<details class="courier-levels" ${state.levelsOpen ? 'open' : ''} ontoggle="courierLevels(this.open)">
            <summary><i class="fas fa-info-circle"></i> Comment monter de niveau ?</summary>
            <p><b>Score = livraisons × note ÷ 5.</b> La note compte 3 avis de départ à 3,5 ★ : il faut des livraisons <b>et</b> de bonnes étoiles.
               Plus ton niveau monte, plus ta zone s'étend et plus tu peux livrer des commandes chères (téléphones, TV…).
               Une note sous 2,5 ★ (après 5 avis) suspend le compte.</p>
            <table><thead><tr><th>Niveau</th><th>Condition</th><th>Zone</th><th>Commandes</th></tr></thead>
            <tbody>${LEVELS.map(l => `<tr class="${l.level === current ? 'me' : ''}"><td>${'★'.repeat(l.level)} ${esc(l.name)}</td><td>${esc(l.need)}</td><td>${esc(l.zone)}</td><td>${esc(l.max)}</td></tr>`).join('')}</tbody></table>
        </details>`;
    }

    function render() {
        const p = state.profile;
        if (!p) return;
        if (p.status !== 'approved') { app().innerHTML = gateHtml(p); return; }
        const active = state.mine.filter(d => ['courier_assigned', 'in_transit', 'picked_up'].includes(d.status));
        const done = state.mine.filter(d => d.status === 'delivered');
        const allowed = state.available.filter(d => d.allowed).length;
        const tabs = { available: `Courses dispo${allowed ? ` (${allowed})` : ''}`, active: `En cours${active.length ? ` (${active.length})` : ''}`, history: 'Historique' };
        if (active.length && state.tab === 'available' && !state.tabChosen) state.tab = 'active';
        app().innerHTML = `
            ${headerHtml(p)}
            <div class="notif-filters" role="tablist">${Object.entries(tabs).map(([k, label]) =>
                `<button role="tab" aria-selected="${state.tab === k}" class="${state.tab === k ? 'active' : ''}" onclick="courierTab('${k}')">${label}</button>`).join('')}</div>
            <div class="course-list">${state.tab === 'available' ? availableHtml() : state.tab === 'active'
                ? (active.length ? active.map(activeCard).join('') : '<div class="notif-empty"><i class="fas fa-route"></i><p>Aucune course en cours.</p></div>')
                : historyHtml(done)}</div>
            ${levelsHtml(p.level)}`;
        drawCourseMaps();
    }

    // ---------- Fenêtres dans la page ----------
    // Certains navigateurs intégrés (appli Google, Facebook…) bloquent confirm / alert / prompt
    // sans rien afficher : on utilise donc nos propres fenêtres.
    function dialog({ title, text = '', input = false, ok = 'OK', cancel = 'Annuler', danger = false }) {
        return new Promise(resolve => {
            document.getElementById('cdOverlay')?.remove();
            const o = document.createElement('div');
            o.id = 'cdOverlay';
            o.className = 'cd-overlay';
            o.innerHTML = `<div class="cd-box" role="dialog" aria-modal="true" aria-labelledby="cdTitle">
                    <h3 id="cdTitle">${esc(title)}</h3>
                    ${text ? `<p>${esc(text).replace(/\n/g, '<br>')}</p>` : ''}
                    ${input ? '<input id="cdInput" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="Code à 4 chiffres">' : ''}
                    <div class="cd-actions">
                        ${cancel ? `<button type="button" class="cd-cancel">${esc(cancel)}</button>` : ''}
                        <button type="button" class="cd-ok ${danger ? 'danger' : ''}">${esc(ok)}</button>
                    </div>
                </div>`;
            const close = v => { o.remove(); resolve(v); };
            o.querySelector('.cd-ok').onclick = () => close(input ? o.querySelector('#cdInput').value.trim() : true);
            o.querySelector('.cd-cancel')?.addEventListener('click', () => close(input ? null : false));
            o.addEventListener('click', e => { if (e.target === o && cancel) close(input ? null : false); });
            document.body.appendChild(o);
            const field = o.querySelector('#cdInput');
            if (field) {
                field.addEventListener('keydown', e => { if (e.key === 'Enter') o.querySelector('.cd-ok').click(); });
                setTimeout(() => field.focus(), 50);
            }
        });
    }
    const say = (title, text) => dialog({ title, text, cancel: null });

    // ---------- Actions ----------
    // Renvoie true si l'action a réussi
    async function act(fn) {
        if (state.busy) return false;
        state.busy = true;
        try {
            const { error } = await fn();
            if (error) { await say('Action impossible', error.message || 'Réessaie dans un instant.'); return false; }
            window.refreshNotifCount?.();
        } finally {
            state.busy = false;
        }
        await refresh();
        return true;
    }

    async function courierTake(orderId) {
        const d = state.available.find(x => x.order_id === orderId);
        const yes = await dialog({ title: 'Prendre cette course ?',
            text: `${d?.shop_name || ''} → ${d?.dropoff_area || ''}\nGain : ${fcfa(d?.fee)}\n\nVa d'abord récupérer le colis à la boutique.`,
            ok: 'Oui, je la prends' });
        if (!yes) return;
        if (await act(() => rpc('take_delivery', { target_order: orderId }))) { state.tab = 'active'; state.tabChosen = true; render(); }
    }

    async function courierStep(orderId, step) {
        if (step === 'pickup' && !(await dialog({ title: 'Colis récupéré ?', text: 'Tu as bien le colis en main ? Le client va être prévenu que tu arrives.', ok: 'Oui, je l\'ai' }))) return;
        act(() => rpc('courier_step', { target_order: orderId, step }));
    }

    async function courierDeliver(orderId) {
        const code = await dialog({ title: 'Code de remise', text: 'Demande au client son code à 4 chiffres (il l\'a reçu dans ses notifications), puis saisis-le ici.', input: true, ok: 'Valider la livraison' });
        if (code === null) return;
        if (!code) { await say('Code manquant', 'Saisis le code à 4 chiffres donné par le client.'); return; }
        if (await act(() => rpc('courier_step', { target_order: orderId, step: 'delivered', client_code: code }))) {
            state.tab = 'history';
            state.tabChosen = true;
            render();
            await say('Livraison confirmée ✅', 'Merci ! La commande est marquée « livrée » et le client peut te noter.');
        }
    }

    async function courierRelease(orderId) {
        if (!(await dialog({ title: 'Rendre cette course ?', text: 'Elle sera proposée à un autre livreur.', ok: 'Rendre la course', danger: true }))) return;
        act(() => rpc('courier_step', { target_order: orderId, step: 'release' }));
    }

    function courierTab(t) {
        state.tab = t;
        state.tabChosen = true;
        render();
    }

    async function init() {
        if (!window.supabase?.rpc) { app().innerHTML = '<div class="notif-empty"><p>Service indisponible. Recharge la page.</p></div>'; return; }
        const { data } = await window.supabase.auth.getSession();
        if (!data?.session?.user) {
            window.supabase.auth.onAuthStateChange?.(e => { if (e === 'SIGNED_IN') location.reload(); });
            app().innerHTML = `<div class="notif-empty"><i class="fas fa-user-lock"></i><h3>Connecte-toi à ton espace livreur</h3>
                <button class="btn-submit" onclick="openLoginModal()">Se connecter</button></div>`;
            return;
        }
        await refresh();
        // Nouvelles courses : mise à jour toutes les 30 s quand la page est visible
        state.timer = setInterval(() => { if (!document.hidden && !state.busy && state.profile?.status === 'approved') refresh(); }, 30000);
    }

    Object.assign(window, { courierLevels: open => { state.levelsOpen = open; }, courierOnline: goOnline, courierOffline: goOffline, courierTake, courierStep, courierDeliver, courierRelease, courierTab });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
