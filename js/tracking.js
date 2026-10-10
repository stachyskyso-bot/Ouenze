// ============================================================
// TRACKING.JS — Suivi animé de la livraison
//
// Étapes : payée → acceptée par le vendeur → livreur trouvé → colis récupéré
//          → en route → livrée.
// Le livreur (🛵) part de sa position, passe à la boutique puis rejoint le client,
// le long de l'itinéraire routier (OSRM / OpenStreetMap, ligne courbe sinon).
//
// tracking.html?demo=1      : démonstration animée (Brazzaville)
// tracking.html?order=<id>  : commande réelle — branchée avec la base des commandes
// API : window.OuenzeTracking.show({ status, shop, client, courier, courierPos })
// ============================================================

(function () {
    'use strict';

    const STEPS = [
        { key: 'paid', icon: 'fa-wallet', label: 'Paiement confirmé', text: 'Ton argent est bloqué en sécurité jusqu\'à la livraison.' },
        { key: 'accepted', icon: 'fa-store', label: 'Acceptée par le vendeur', text: 'Le vendeur prépare ta commande.' },
        { key: 'courier_assigned', icon: 'fa-motorcycle', label: 'Livreur trouvé', text: 'Un livreur proche se rend à la boutique.' },
        { key: 'picked_up', icon: 'fa-box', label: 'Colis récupéré', text: 'Le livreur a ta commande.' },
        { key: 'in_transit', icon: 'fa-route', label: 'En route vers toi', text: 'Prépare-toi, il arrive !' },
        { key: 'delivered', icon: 'fa-check-circle', label: 'Livrée', text: 'Bonne réception ! Le vendeur va être payé.' }
    ];
    const SPEED_KMH = 25;   // vitesse moyenne d'une moto en ville
    const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let map = null;
    let layers = {};
    let routeToShop = [];
    let routeToClient = [];
    let state = null;
    let animation = null;

    const box = () => document.getElementById('trackingApp');

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // ============ GÉOMÉTRIE ============
    function distanceKm(a, b) {
        const R = 6371, toRad = d => d * Math.PI / 180;
        const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    }

    function pathLength(path) {
        let d = 0;
        for (let i = 1; i < path.length; i++) d += distanceKm(path[i - 1], path[i]);
        return d;
    }

    // Point à la fraction t (0..1) du trajet
    function pointAt(path, t) {
        if (path.length < 2) return path[0];
        const total = pathLength(path);
        let target = total * Math.min(Math.max(t, 0), 1);
        for (let i = 1; i < path.length; i++) {
            const seg = distanceKm(path[i - 1], path[i]);
            if (target <= seg || i === path.length - 1) {
                const f = seg ? target / seg : 0;
                return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * f, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * f];
            }
            target -= seg;
        }
        return path[path.length - 1];
    }

    // Ligne légèrement courbe quand l'itinéraire routier n'est pas disponible
    function curve(a, b) {
        const mid = [(a[0] + b[0]) / 2 + (b[1] - a[1]) * 0.15, (a[1] + b[1]) / 2 - (b[0] - a[0]) * 0.15];
        const pts = [];
        for (let i = 0; i <= 30; i++) {
            const t = i / 30;
            pts.push([(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * mid[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * mid[1] + t * t * b[1]]);
        }
        return pts;
    }

    async function roadRoute(a, b) {
        try {
            const ctrl = new AbortController();
            setTimeout(() => ctrl.abort(), 6000);
            const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`, { signal: ctrl.signal });
            const json = await res.json();
            const coords = json?.routes?.[0]?.geometry?.coordinates;
            if (Array.isArray(coords) && coords.length > 1) return coords.map(([lng, lat]) => [lat, lng]);
        } catch (e) { /* hors ligne ou service indisponible */ }
        return curve(a, b);
    }

    // ============ CARTE ============
    function icon(emoji, cls) {
        return L.divIcon({ className: '', html: `<div class="trk-pin ${cls}">${emoji}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] });
    }

    async function buildMap(s) {
        const shop = [s.shop.lat, s.shop.lng], client = [s.client.lat, s.client.lng], start = [s.courierStart.lat, s.courierStart.lng];
        [routeToShop, routeToClient] = await Promise.all([roadRoute(start, shop), roadRoute(shop, client)]);
        if (!window.L) return;
        map = L.map('trkMap', { zoomControl: false, attributionControl: true });
        // Tuiles haute définition ({r} = « @2x » sur téléphone) : carte nette et noms lisibles
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 20, subdomains: 'abcd', attribution: '&copy; OpenStreetMap &copy; CARTO' }).addTo(map);
        layers.toShop = L.polyline(routeToShop, { color: '#94a3b8', weight: 4, dashArray: '6 8' }).addTo(map);
        layers.toClient = L.polyline(routeToClient, { color: '#1e40af', weight: 5, opacity: 0.85 }).addTo(map);
        layers.done = L.polyline([], { color: '#16a34a', weight: 6 }).addTo(map);
        L.marker(shop, { icon: icon('🏪', 'shop') }).addTo(map).bindTooltip(esc(s.shop.name));
        L.marker(client, { icon: icon('🏠', 'home') }).addTo(map).bindTooltip('Toi');
        layers.courier = L.marker(start, { icon: icon('🛵', 'courier'), zIndexOffset: 1000 }).addTo(map);
        map.fitBounds(L.latLngBounds([...routeToShop, ...routeToClient]), { padding: [30, 30] });
        setTimeout(() => map && map.invalidateSize(), 150);
    }

    // ============ AFFICHAGE ============
    function stepIndex(status) {
        return Math.max(0, STEPS.findIndex(s => s.key === status));
    }

    function renderShell(s) {
        box().innerHTML = `
            ${s.demo ? `<div class="trk-demo"><i class="fas fa-play-circle"></i> Démonstration : voici comment tu suivras ta livraison.</div>` : ''}
            <div class="trk-layout">
                <div class="trk-map-card">
                    <div id="trkMap" class="trk-map"></div>
                    <div class="trk-eta" id="trkEta"></div>
                </div>
                <div class="trk-side">
                    <div class="trk-progress"><div class="trk-progress-bar" id="trkBar"></div></div>
                    <div class="trk-current" id="trkCurrent"></div>
                    <ol class="trk-steps" id="trkSteps"></ol>
                    <div class="trk-courier" id="trkCourier"></div>
                </div>
            </div>`;
    }

    function updatePanel(s, travel) {
        const idx = stepIndex(s.status);
        const step = STEPS[idx];
        document.getElementById('trkBar').style.width = `${Math.round(((idx + (travel || 0)) / (STEPS.length - 1)) * 100)}%`;
        document.getElementById('trkCurrent').innerHTML = `<i class="fas ${step.icon}"></i><div><strong>${step.label}</strong><span>${step.text}</span></div>`;
        document.getElementById('trkSteps').innerHTML = STEPS.map((st, i) => `
            <li class="${i < idx ? 'done' : i === idx ? 'active' : ''}">
                <span class="trk-dot"><i class="fas ${i < idx ? 'fa-check' : st.icon}"></i></span>
                <span>${st.label}${s.times?.[st.key] ? `<small>${esc(s.times[st.key])}</small>` : ''}</span>
            </li>`).join('');

        const c = s.courier;
        const courierCard = document.getElementById('trkCourier');
        courierCard.innerHTML = idx >= 2 && c ? `
            <div class="trk-courier-avatar">${esc((c.name || '?').charAt(0))}</div>
            <div class="trk-courier-info"><strong>${esc(c.name)}</strong><span>${c.vehicle === 'voiture' ? 'Voiture' : 'Moto'} · ${esc(c.plate || '')}${c.rating ? ` · ⭐ ${esc(c.rating)}` : ''}</span></div>
            ${c.phone && idx < 5 ? `<a class="trk-call" href="tel:${esc(c.phone.replace(/\s/g, ''))}" aria-label="Appeler le livreur"><i class="fas fa-phone"></i></a>` : ''}` : '';
        courierCard.style.display = courierCard.innerHTML ? '' : 'none';

        const eta = document.getElementById('trkEta');
        if (idx >= 5) eta.innerHTML = '<i class="fas fa-check-circle"></i> Livrée';
        else if (idx >= 2) {
            const remaining = idx <= 2 ? pathLength(routeToShop) * (1 - (travel || 0)) + pathLength(routeToClient)
                            : idx === 3 ? pathLength(routeToClient) : pathLength(routeToClient) * (1 - (travel || 0));
            const min = Math.max(1, Math.round(remaining / SPEED_KMH * 60) + (idx <= 3 ? 5 : 0));
            const at = new Date(Date.now() + min * 60000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            eta.innerHTML = `<i class="fas fa-clock"></i> Arrivée vers <strong>${at}</strong> (≈ ${min} min)`;
        } else eta.innerHTML = '<i class="fas fa-hourglass-half"></i> En attente du vendeur';
    }

    function moveCourier(path, t, donePath) {
        if (!layers.courier) return;
        const p = pointAt(path, t);
        layers.courier.setLatLng(p);
        if (donePath) {
            const total = pathLength(path);
            const pts = [];
            let acc = 0;
            pts.push(path[0]);
            for (let i = 1; i < path.length; i++) {
                acc += distanceKm(path[i - 1], path[i]);
                if (acc / total > t) break;
                pts.push(path[i]);
            }
            pts.push(p);
            layers.done.setLatLngs(pts);
        }
    }

    // Anime le livreur sur un trajet en `ms` millisecondes
    function travel(path, ms, onFrame, donePath) {
        return new Promise(resolve => {
            if (REDUCED_MOTION || !layers.courier) { moveCourier(path, 1, donePath); onFrame(1); resolve(); return; }
            const start = performance.now();
            const frame = now => {
                const t = Math.min(1, (now - start) / ms);
                const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                moveCourier(path, eased, donePath);
                onFrame(eased);
                if (t < 1) animation = requestAnimationFrame(frame);
                else resolve();
            };
            animation = requestAnimationFrame(frame);
        });
    }

    const wait = ms => new Promise(r => setTimeout(r, REDUCED_MOTION ? 0 : ms));

    // ============ DÉMONSTRATION ============
    function demoState() {
        const now = new Date();
        const t = m => new Date(now.getTime() + m * 60000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        return {
            demo: true,
            status: 'paid',
            shop: { name: 'Tech BZV — Marché Total', lat: -4.2781, lng: 15.2731 },
            client: { lat: -4.2612, lng: 15.2868 },
            courierStart: { lat: -4.2872, lng: 15.2648 },
            courier: { name: 'Jean Mabiala', vehicle: 'moto', plate: '123 AB 4', rating: '4.9', phone: '+242 06 555 25 62' },
            times: { paid: t(0) }
        };
    }

    async function playDemo() {
        const s = state;
        const t = () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        updatePanel(s);
        await wait(1800);
        s.status = 'accepted'; s.times.accepted = t(); updatePanel(s);
        await wait(1800);
        s.status = 'courier_assigned'; s.times.courier_assigned = t(); updatePanel(s);
        await travel(routeToShop, 5000, f => updatePanel(s, f), false);
        s.status = 'picked_up'; s.times.picked_up = t(); updatePanel(s);
        layers.toShop?.setStyle({ opacity: 0.25 });
        await wait(1500);
        s.status = 'in_transit'; s.times.in_transit = t(); updatePanel(s);
        await travel(routeToClient, 8000, f => updatePanel(s, f), true);
        s.status = 'delivered'; s.times.delivered = t(); updatePanel(s);
        box().insertAdjacentHTML('beforeend', `
            <div class="trk-done">
                <p>Commande livrée ✅ Tu pourras ensuite noter la boutique et le livreur.</p>
                <button class="btn-submit" onclick="location.reload()"><i class="fas fa-redo"></i> Revoir l'animation</button>
            </div>`);
    }

    // ============ COMMANDE RÉELLE ============
    // Branché dès que le schéma des commandes est en place : appelle show() avec
    // la commande et la position du livreur (mise à jour en temps réel).
    async function show(order) {
        state = order;
        renderShell(order);
        await buildMap(order);
        const idx = stepIndex(order.status);
        if (idx >= 3) moveCourier(routeToClient, idx >= 5 ? 1 : 0, true);
        updatePanel(order);
        if (order.status === 'delivered' && order.id && window.openRateOrder) {
            box().insertAdjacentHTML('beforeend', `
                <div class="trk-done">
                    <p>Commande livrée ✅ Comment s'est passé ton achat ?</p>
                    <button class="btn-submit" onclick="openRateOrder('${String(order.id).replace(/[^a-zA-Z0-9-]/g, '')}')"><i class="fas fa-star"></i> Noter la boutique et le livreur</button>
                </div>`);
        }
    }

    async function init() {
        const params = new URLSearchParams(location.search);
        if (params.get('order') && !params.has('demo')) {
            box().innerHTML = `<div class="dl-card"><div class="dl-status"><i class="fas fa-route" style="color:var(--primary);"></i>
                <h3>Suivi de ta commande</h3>
                <p>Le suivi en direct des commandes s'active avec le paiement en ligne. Tu recevras un SMS à chaque étape.</p>
                <a class="btn-submit" href="tracking.html?demo=1">Voir une démonstration</a></div></div>`;
            return;
        }
        state = demoState();
        renderShell(state);
        await buildMap(state);
        playDemo();
    }

    window.OuenzeTracking = { show };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
