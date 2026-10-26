// ============================================================
// PLACE-PICKER.JS — Placer un lieu sur la carte (boutique, point de retrait)
//
// OuenzePlacePicker.open({ title, intro, lat, lng, district, address, saveLabel, onSave })
//   onSave({ lat, lng, district, address }) → message d'erreur (texte) ou rien si c'est bon.
// Le quartier / l'arrondissement est obligatoire : il est déduit du point (OpenStreetMap)
// et reste modifiable. Prérequis : Leaflet chargé sur la page.
// ============================================================

(function () {
    'use strict';

    const CENTER = { lat: -4.2634, lng: 15.2429, zoom: 13 };   // Brazzaville
    const SEARCH_BBOX = '11.0,-9.5,31.5,4.0';                    // Congo + RDC (ouest)
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    let st = null;   // { opts, map, marker, lat, lng, seq, timer, results }

    function el(id) { return document.getElementById(id); }

    function setError(msg) {
        const e = el('ppError');
        if (e) { e.textContent = msg || ''; e.style.display = msg ? 'block' : 'none'; }
    }

    function updateStatus() {
        const s = el('ppStatus');
        if (!s) return;
        s.className = 'pp-status' + (st.lat != null ? ' ok' : '');
        s.innerHTML = st.lat != null
            ? '<i class="fas fa-check-circle"></i> Point placé. Glisse le repère pour l\'ajuster.'
            : '<i class="fas fa-hand-pointer"></i> Touche la carte à l\'endroit exact, cherche un lieu ou utilise « Ma position ».';
    }

    function placeMarker(lat, lng, lookup) {
        st.lat = Number(Number(lat).toFixed(6));
        st.lng = Number(Number(lng).toFixed(6));
        if (st.map) {
            if (!st.marker) {
                st.marker = L.marker([st.lat, st.lng], { draggable: true }).addTo(st.map);
                st.marker.on('dragend', () => { const p = st.marker.getLatLng(); placeMarker(p.lat, p.lng, true); });
            } else {
                st.marker.setLatLng([st.lat, st.lng]);
            }
        }
        setError('');
        updateStatus();
        if (lookup) reverseGeocode(st.lat, st.lng);
    }

    // Quartier / rue déduits du point (le vendeur peut corriger)
    async function reverseGeocode(lat, lng) {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=fr&zoom=18`);
            if (!res.ok) return;
            const a = (await res.json()).address || {};
            if (!st || lat !== st.lat || lng !== st.lng) return;
            const district = a.suburb || a.neighbourhood || a.quarter || a.city_district || '';
            const street = [a.house_number, a.road].filter(Boolean).join(' ');
            if (district && el('ppDistrict')) el('ppDistrict').value = district;
            if (street && el('ppAddress') && !el('ppAddress').value) el('ppAddress').value = street;
        } catch (e) { /* hors ligne : le vendeur tape le quartier */ }
    }

    async function search(q, pickFirst) {
        q = String(q || '').trim();
        const ul = el('ppResults');
        if (q.length < 3) { ul.innerHTML = ''; return; }
        const seq = ++st.seq;
        const c = st.map ? st.map.getCenter() : CENTER;
        ul.innerHTML = '<li class="info"><i class="fas fa-spinner fa-spin"></i> Recherche…</li>';
        try {
            const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=fr&limit=6&bbox=${SEARCH_BBOX}&lat=${c.lat}&lon=${c.lng}`);
            const json = await res.json();
            if (seq !== st.seq) return;
            st.results = (json.features || [])
                .filter(f => ['CG', 'CD'].includes(f.properties?.countrycode) && Array.isArray(f.geometry?.coordinates))
                .map(f => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], p: f.properties }));
            if (pickFirst && st.results.length) { ppPick(0); return; }
            ul.innerHTML = st.results.length ? st.results.map((r, i) => {
                const main = r.p.name || [r.p.housenumber, r.p.street].filter(Boolean).join(' ') || r.p.district || r.p.city || '';
                const rest = [r.p.district || r.p.locality, r.p.city].filter(x => x && x !== main).join(', ');
                return `<li tabindex="0" onclick="ppPick(${i})" onkeydown="if(event.key==='Enter')ppPick(${i})"><i class="fas fa-map-marker-alt"></i><span><strong>${esc(main)}</strong><small>${esc(rest)}</small></span></li>`;
            }).join('') : '<li class="info">Aucun résultat : essaie un lieu connu proche (marché, école, église…).</li>';
        } catch (e) {
            if (seq === st.seq) ul.innerHTML = '<li class="info">Recherche indisponible : touche la carte ou utilise « Ma position ».</li>';
        }
    }

    function ppPick(i) {
        const r = st?.results?.[i];
        if (!r) return;
        if (st.map) st.map.setView([r.lat, r.lng], 17);
        placeMarker(r.lat, r.lng, false);
        const district = r.p.district || r.p.locality || '';
        if (district) el('ppDistrict').value = district;
        const street = [r.p.housenumber, r.p.street].filter(Boolean).join(' ') || r.p.name || '';
        if (street && !el('ppAddress').value) el('ppAddress').value = street;
        el('ppResults').innerHTML = '';
        if (!district) reverseGeocode(st.lat, st.lng);
    }

    function ppLocate() {
        if (!navigator.geolocation) { setError('Ton appareil ne donne pas sa position : touche la carte.'); return; }
        const btn = el('ppLocate');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Recherche…';
        navigator.geolocation.getCurrentPosition(p => {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-location-arrow"></i> Ma position';
            if (st.map) st.map.setView([p.coords.latitude, p.coords.longitude], 17);
            placeMarker(p.coords.latitude, p.coords.longitude, true);
        }, () => {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-location-arrow"></i> Ma position';
            setError('Position refusée ou introuvable : touche la carte à l\'endroit de ta boutique.');
        }, { enableHighAccuracy: true, timeout: 15000 });
    }

    async function ppSave() {
        const district = el('ppDistrict').value.trim();
        const address = el('ppAddress').value.trim();
        if (st.lat == null) { setError('Place d\'abord le repère sur la carte.'); return; }
        if (district.length < 2) { setError('Indique le quartier ou l\'arrondissement.'); el('ppDistrict').focus(); return; }
        const btn = el('ppSave');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement…';
        let err = null;
        try { err = await st.opts.onSave({ lat: st.lat, lng: st.lng, district, address }); } catch (e) { err = e.message || 'Enregistrement impossible.'; }
        if (err) {
            btn.disabled = false;
            btn.innerHTML = esc(st.opts.saveLabel || 'Enregistrer');
            setError(err);
            return;
        }
        ppClose();
    }

    function ppClose() {
        if (st?.map) st.map.remove();
        el('ppOverlay')?.remove();
        document.body.classList.remove('pp-open');
        st = null;
    }

    function open(opts) {
        if (st) ppClose();
        st = { opts: opts || {}, map: null, marker: null, lat: null, lng: null, seq: 0, timer: null, results: [] };
        const o = st.opts;
        const overlay = document.createElement('div');
        overlay.id = 'ppOverlay';
        overlay.className = 'pp-overlay';
        overlay.innerHTML = `
            <div class="pp-sheet" role="dialog" aria-label="${esc(o.title || 'Placer sur la carte')}">
                <button class="pp-close" onclick="ppClose()" aria-label="Fermer">&times;</button>
                <h3>${esc(o.title || 'Placer sur la carte')}</h3>
                ${o.intro ? `<p class="pp-intro">${esc(o.intro)}</p>` : ''}
                <div class="pp-search">
                    <input type="search" id="ppSearch" placeholder="Chercher un lieu (marché, école…)" autocomplete="off">
                    <button type="button" id="ppLocate" onclick="ppLocate()"><i class="fas fa-location-arrow"></i> Ma position</button>
                </div>
                <ul class="pp-results" id="ppResults"></ul>
                <div class="pp-map" id="ppMap"></div>
                <div class="pp-status" id="ppStatus"></div>
                <div class="pp-fields">
                    <label>Quartier / arrondissement *<input type="text" id="ppDistrict" maxlength="80" placeholder="Ex : Poto-Poto, Moungali, Bacongo…" value="${esc(o.district || '')}"></label>
                    <label>Adresse, repère (facultatif)<input type="text" id="ppAddress" maxlength="200" placeholder="Ex : Av. de la Paix, face à la pharmacie" value="${esc(o.address || '')}"></label>
                </div>
                <div class="pp-error" id="ppError" role="alert"></div>
                <button type="button" class="pp-save" id="ppSave" onclick="ppSave()">${esc(o.saveLabel || 'Enregistrer')}</button>
            </div>`;
        overlay.addEventListener('click', e => { if (e.target === overlay) ppClose(); });
        document.body.appendChild(overlay);
        document.body.classList.add('pp-open');

        const input = el('ppSearch');
        input.addEventListener('input', () => { clearTimeout(st.timer); st.timer = setTimeout(() => search(input.value, false), 350); });
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(st.timer); search(input.value, true); } });
        el('ppDistrict').addEventListener('input', () => setError(''));

        if (window.L) {
            const has = o.lat != null && o.lng != null;
            st.map = L.map('ppMap').setView(has ? [o.lat, o.lng] : [CENTER.lat, CENTER.lng], has ? 17 : CENTER.zoom);
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            }).addTo(st.map);
            st.map.on('click', e => placeMarker(e.latlng.lat, e.latlng.lng, true));
            if (has) placeMarker(o.lat, o.lng, false);
            setTimeout(() => st?.map && st.map.invalidateSize(), 150);
        } else {
            el('ppMap').innerHTML = '<p class="pp-nomap">Carte indisponible : recharge la page.</p>';
        }
        updateStatus();
    }

    window.OuenzePlacePicker = { open, close: ppClose };
    Object.assign(window, { ppPick, ppLocate, ppSave, ppClose });
})();
