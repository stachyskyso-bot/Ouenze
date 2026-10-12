// ============================================================
// AROUND.JS — Boutiques autour de moi (autour.html)
//
// Carte des boutiques placées par les vendeurs (RPC nearby_shops, migration 20261022).
// « Me localiser » suit la position du téléphone en temps réel : le point bleu bouge
// et la liste se trie de la plus proche à la plus éloignée à chaque déplacement.
// ============================================================

(function () {
    'use strict';

    const CENTER = [-4.2634, 15.2429];   // Brazzaville
    const state = { shops: [], me: null, map: null, layer: null, meMarker: null, meCircle: null, watch: null, fitted: false };

    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const el = id => document.getElementById(id);
    const km = n => n == null ? '' : n < 1 ? `${Math.round(n * 1000)} m` : `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;

    function distance(a, b) {
        const r = x => x * Math.PI / 180;
        const dLat = r(b[0] - a[0]), dLng = r(b[1] - a[1]);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLng / 2) ** 2;
        return 6371 * 2 * Math.asin(Math.sqrt(h));
    }

    function status(html) { el('aroundStatus').innerHTML = html; }

    // ---------- Carte ----------
    function initMap() {
        if (!window.L) { el('aroundMap').innerHTML = '<p class="around-nomap">Carte indisponible : recharge la page.</p>'; return; }
        state.map = L.map('aroundMap', { scrollWheelZoom: false }).setView(CENTER, 13);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            maxZoom: 20, subdomains: 'abcd', attribution: '&copy; OpenStreetMap &copy; CARTO'
        }).addTo(state.map);
        state.layer = L.layerGroup().addTo(state.map);
    }

    function drawShops() {
        if (!state.map) return;
        state.layer.clearLayers();
        state.shops.forEach(s => {
            L.circleMarker([s.lat, s.lng], { radius: 8, color: '#fff', weight: 2, fillColor: '#1e40af', fillOpacity: 1 })
                .addTo(state.layer)
                .bindPopup(`<b>${esc(s.name)}</b><br>${esc(s.district || s.city || '')}${s.dist != null ? ' · ' + km(s.dist) : ''}
                    <br><a href="index.html?shop=${encodeURIComponent(s.shop_id)}">Voir la boutique</a>`);
        });
        if (!state.fitted && !state.me && state.shops.length) {
            state.map.fitBounds(state.shops.map(s => [s.lat, s.lng]), { padding: [30, 30], maxZoom: 15 });
        }
    }

    function drawMe() {
        if (!state.map || !state.me) return;
        const ll = [state.me.lat, state.me.lng];
        if (!state.meMarker) {
            state.meCircle = L.circle(ll, { radius: state.me.acc, color: '#3b82f6', weight: 1, fillOpacity: 0.1 }).addTo(state.map);
            state.meMarker = L.circleMarker(ll, { radius: 9, color: '#fff', weight: 3, fillColor: '#3b82f6', fillOpacity: 1 })
                .addTo(state.map).bindTooltip('Moi', { direction: 'top', offset: [0, -8] });
        } else {
            state.meMarker.setLatLng(ll);
            state.meCircle.setLatLng(ll).setRadius(state.me.acc);
        }
        if (!state.fitted) {
            state.fitted = true;
            const near = state.shops.slice(0, 5).map(s => [s.lat, s.lng]);
            if (near.length) state.map.fitBounds([ll, ...near], { padding: [40, 40], maxZoom: 16 });
            else state.map.setView(ll, 15);
        }
    }

    // ---------- Liste ----------
    function renderList() {
        const box = el('aroundList');
        if (!state.shops.length) {
            box.innerHTML = '<div class="notif-empty"><i class="fas fa-store"></i><p>Aucune boutique n\'est encore placée sur la carte.</p></div>';
            return;
        }
        box.innerHTML = state.shops.map(s => {
            const logo = /^https:\/\//.test(s.logo_url || '') ? s.logo_url : '';
            return `<article class="around-shop">
                <span class="around-logo">${logo ? `<img src="${esc(logo)}" alt="" loading="lazy">` : '<i class="fas fa-store"></i>'}</span>
                <span class="around-info">
                    <strong>${esc(s.name)}</strong>
                    <small><i class="fas fa-map-marker-alt"></i> ${esc([s.district, s.city].filter(Boolean).join(', '))}</small>
                    <small><i class="fas fa-star"></i> ${Number(s.rating || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} (${s.total_ratings || 0})</small>
                </span>
                <span class="around-side">
                    ${s.dist != null ? `<b class="around-dist">${km(s.dist)}</b>` : ''}
                    <a class="notif-btn ok" href="index.html?shop=${encodeURIComponent(s.shop_id)}">Voir</a>
                    <a class="notif-btn" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}" target="_blank" rel="noopener"><i class="fas fa-directions"></i> Y aller</a>
                </span>
            </article>`;
        }).join('');
    }

    // Distances recalculées à chaque déplacement, la plus proche en premier
    function sortByDistance() {
        if (!state.me) return;
        const me = [state.me.lat, state.me.lng];
        state.shops.forEach(s => { s.dist = distance(me, [s.lat, s.lng]); });
        state.shops.sort((a, b) => a.dist - b.dist);
    }

    async function load(lat, lng) {
        const { data, error } = await window.supabase.rpc('nearby_shops', { at_lat: lat ?? null, at_lng: lng ?? null, max_rows: 60 });
        if (error) {
            el('aroundList').innerHTML = `<div class="notif-empty"><i class="fas fa-tools"></i><p>${/nearby_shops|schema cache|does not exist/i.test(error.message || '')
                ? 'La carte des boutiques arrive bientôt (base de données à mettre à jour).' : esc(error.message)}</p></div>`;
            return false;
        }
        state.shops = (data || []).map(s => ({ ...s, lat: Number(s.lat), lng: Number(s.lng), dist: s.distance_km != null ? Number(s.distance_km) : null }));
        sortByDistance();
        drawShops();
        renderList();
        return true;
    }

    // ---------- Position en temps réel ----------
    function aroundLocate() {
        if (!navigator.geolocation) { status('Ton appareil ne donne pas sa position.'); return; }
        if (state.watch != null) { if (state.me && state.map) state.map.setView([state.me.lat, state.me.lng], 15); return; }
        const btn = el('aroundLocate');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Localisation…';
        let first = true;
        state.watch = navigator.geolocation.watchPosition(async p => {
            state.me = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.min(p.coords.accuracy || 50, 500) };
            btn.innerHTML = '<i class="fas fa-crosshairs"></i> Centrer sur moi';
            status('<i class="fas fa-circle around-live"></i> Position suivie en temps réel : les boutiques les plus proches sont en haut.');
            if (first) { first = false; await load(state.me.lat, state.me.lng); }
            else { sortByDistance(); drawShops(); renderList(); }
            drawMe();
        }, err => {
            // Signal GPS faible ou temporairement perdu : on continue de suivre
            if (err && err.code !== 1) {
                if (!state.me) status('Recherche de ta position… (active le GPS si besoin)');
                return;
            }
            navigator.geolocation.clearWatch(state.watch);
            state.watch = null;
            btn.innerHTML = '<i class="fas fa-location-arrow"></i> Me localiser';
            status('Position refusée : autorise la localisation dans ton navigateur pour voir les boutiques les plus proches.');
        }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
    }

    async function init() {
        if (!window.supabase?.rpc) { el('aroundList').innerHTML = '<p>Service indisponible.</p>'; return; }
        initMap();
        const ok = await load(null, null);
        // Position déjà autorisée : suivi automatique
        if (ok && navigator.permissions?.query) {
            try { if ((await navigator.permissions.query({ name: 'geolocation' })).state === 'granted') aroundLocate(); } catch (e) { /* ignoré */ }
        }
    }

    window.addEventListener('pagehide', () => { if (state.watch != null) navigator.geolocation.clearWatch(state.watch); });
    Object.assign(window, { aroundLocate });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
