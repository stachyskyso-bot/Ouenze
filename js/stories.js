// ============================================================
// STORIES.JS — Statuts façon WhatsApp
//
//   OuenzeStories.mountRow(boxId, { products, canPost })  → rangée de cercles (accueil)
//   OuenzeStories.openShop(shopId)                        → statuts d'une boutique
//   OuenzeStories.decorateLogo(shopId, element)           → anneau sur le logo d'une boutique
//   OuenzeStories.compose({ shopId, products, onDone })   → publier (vendeur ; shopId null = Ouenze)
//   OuenzeStories.preview(items, title)                   → aperçu (espace vendeur, admin)
//
// Ordre des cercles : Ouenze, puis « Nouveautés » (produits récents classés selon les goûts),
// puis les boutiques : non vus d'abord, boutiques en favori, boutiques que le client visite,
// sa ville, les plus récents. Un statut dure 24 h (migration 20261111_stories.sql).
// ============================================================

(function () {
    'use strict';

    const SEEN_KEY = 'ouenze_story_seen_v1';
    const LOGO = 'favicon/logo-mark-192.png?v=2';
    const IMAGE_MS = 5000;
    const COLORS = ['#1e40af', '#b45309', '#047857', '#b91c1c', '#6d28d9', '#0f172a'];
    const NEW_HOURS = 72;

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const safeUrl = u => {
        const s = String(u || '').trim();
        return /^(https:\/\/|data:image\/(jpeg|png|webp);base64,)/i.test(s) ? s.replace(/"/g, '%22') : '';
    };
    const money = n => Number(n || 0).toLocaleString('fr-FR') + ' FCFA';
    const sb = () => window.supabase;

    let groups = [];        // [{ key, kind, name, logo, shopId, items: [...] }]
    let rowBox = null;
    let rowOpts = {};
    let feedJob = null;
    let viewer = null;      // état de la visionneuse

    // ---------- Vu / pas vu ----------
    function seenMap() {
        try {
            const m = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
            return m && typeof m === 'object' ? m : {};
        } catch (e) { return {}; }
    }
    function markSeenLocal(key) {
        try {
            const m = seenMap();
            m[key] = Date.now();
            const limit = Date.now() - 4 * 86400000;
            Object.keys(m).forEach(k => { if (m[k] < limit) delete m[k]; });
            localStorage.setItem(SEEN_KEY, JSON.stringify(m));
        } catch (e) { /* stockage indisponible */ }
    }
    const itemKey = it => it.kind === 'product' ? 'p:' + it.id : it.id;
    const isSeen = (it, m) => !!(it.viewed || (m || seenMap())[itemKey(it)]);
    const groupSeen = (g, m) => g.items.every(it => isSeen(it, m));

    let pendingViews = [];
    let viewsTimer = null;
    let loggedIn = null;
    async function isLoggedIn() {
        if (loggedIn !== null) return loggedIn;
        try {
            const { data } = await sb().auth.getSession();
            loggedIn = !!data?.session?.user;
        } catch (e) { loggedIn = false; }
        return loggedIn;
    }
    function queueView(it) {
        markSeenLocal(itemKey(it));
        it.viewed = true;
        if (it.kind === 'product') return;
        pendingViews.push(it.id);
        clearTimeout(viewsTimer);
        viewsTimer = setTimeout(flushViews, 1500);
    }
    async function flushViews() {
        const ids = [...new Set(pendingViews)].slice(0, 50);
        pendingViews = [];
        if (!ids.length || !(await isLoggedIn())) return;
        try { await sb().rpc('mark_stories_viewed', { ids }); } catch (e) { /* sans gravité */ }
    }

    // ---------- Chargement ----------
    async function loadFeed() {
        const { data, error } = await sb().rpc('story_feed', { city: null });
        if (error) throw error;
        const rows = Array.isArray(data) ? data : [];
        // Stories déjà aimées (clients connectés ; migration 20261112, absente = aucun cœur rempli)
        if (rows.length && await isLoggedIn()) {
            try {
                const { data: liked } = await sb().rpc('my_story_likes', { ids: rows.map(r => r.id) });
                const set = new Set((liked || []).map(x => typeof x === 'object' ? Object.values(x)[0] : x));
                rows.forEach(r => { r.liked = set.has(r.id); });
            } catch (e) { /* sans gravité */ }
        }
        return rows;
    }

    // ---------- J'aime ----------
    function isLiked(it) {
        if (it.kind === 'product') return !!window.Ouenze4U?.isFav?.('product', it.id);
        return !!it.liked;
    }

    async function toggleLike(it, btn) {
        if (!(await isLoggedIn())) {
            closeViewer();
            if (typeof window.openLoginModal === 'function') window.openLoginModal();
            else if (window.uiAlert) window.uiAlert('Connecte-toi pour aimer les stories.');
            return;
        }
        const was = isLiked(it);
        const setUi = on => {
            btn.classList.toggle('on', on);
            btn.querySelector('i').className = (on ? 'fas' : 'far') + ' fa-heart';
            btn.setAttribute('aria-pressed', String(on));
        };
        setUi(!was);
        if (!was) burst();
        try {
            if (it.kind === 'product') {
                await window.Ouenze4U?.toggleFav?.('product', it.id);
            } else {
                const { data, error } = await sb().rpc('toggle_story_like', { target: it.id });
                if (error) throw error;
                it.liked = !!data;
                setUi(it.liked);
            }
        } catch (e) {
            it.liked = was;
            setUi(was);
        }
    }

    // Grand cœur au centre de la story
    function burst() {
        const stage = viewer?.box.querySelector('.st-stage');
        if (!stage) return;
        const h = document.createElement('i');
        h.className = 'fas fa-heart st-burst';
        stage.appendChild(h);
        setTimeout(() => h.remove(), 900);
    }

    function timeAgo(d) {
        const min = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
        if (min < 1) return "à l'instant";
        if (min < 60) return `il y a ${min} min`;
        return `il y a ${Math.floor(min / 60)} h`;
    }

    function buildGroups(rows, products) {
        const out = [];
        const byShop = new Map();
        rows.forEach(r => {
            const it = {
                kind: 'story', id: r.id, type: r.media_type, url: r.media_url, caption: r.caption,
                bg: r.bg_color, duration: r.duration_ms, productId: r.product_id, productName: r.product_name,
                productPrice: r.product_price, at: r.created_at, viewed: !!r.viewed, shopId: r.shop_id, liked: !!r.liked
            };
            const key = r.author_kind === 'ouenze' ? 'ouenze' : 'shop:' + r.shop_id;
            if (!byShop.has(key)) {
                byShop.set(key, {
                    key, kind: r.author_kind, shopId: r.shop_id, city: r.shop_city || '', verified: !!r.shop_verified,
                    name: r.author_kind === 'ouenze' ? 'Ouenze' : (r.shop_name || 'Boutique'),
                    logo: r.author_kind === 'ouenze' ? LOGO : safeUrl(r.shop_logo), items: []
                });
            }
            byShop.get(key).items.push(it);
        });
        // Nouveautés : produits récents avec photo, déjà classés selon les goûts du client
        const limit = Date.now() - NEW_HOURS * 3600000;
        const fresh = (products || []).filter(p => p && new Date(p.created_at || 0).getTime() > limit).slice(0, 10);
        const newGroup = fresh.length ? {
            key: 'new', kind: 'new', name: 'Nouveautés', logo: '', items: fresh.map(p => ({
                kind: 'product', id: p.id, type: 'product', productId: p.id, productName: p.name,
                productPrice: p.price, shopName: p.shop_name, shopId: p.shop_id, at: p.created_at, cover: ''
            }))
        } : null;

        const m = seenMap();
        const F = window.Ouenze4U;
        const city = (rowOpts.city || '').toLowerCase();
        const score = g => {
            const newest = Math.max(...g.items.map(it => new Date(it.at).getTime()));
            const hours = (Date.now() - newest) / 3600000;
            let s = groupSeen(g, m) ? 0 : 1000;
            if (g.kind === 'ouenze') s += 600;
            if (g.shopId && F?.isFav?.('shop', g.shopId)) s += 300;
            if (g.shopId && F?.shopAffinity) s += Math.min(200, F.shopAffinity(g.shopId) * 40);
            if (g.items.some(it => it.productId && F?.isFav?.('product', it.productId))) s += 120;
            if (city && g.city.toLowerCase() === city) s += 80;
            return s + Math.max(0, 48 - hours * 2);
        };
        const list = [...byShop.values()];
        list.forEach(g => g.items.sort((a, b) => new Date(a.at) - new Date(b.at)));
        list.sort((a, b) => score(b) - score(a));
        if (newGroup) {
            // juste après Ouenze, sauf si déjà vu en entier
            const pos = groupSeen(newGroup, m)
                ? list.length
                : (list[0]?.kind === 'ouenze' ? 1 : 0);
            list.splice(Math.min(pos, list.length), 0, newGroup);
        }
        list.forEach(g => out.push(g));
        return out;
    }

    // ---------- Rangée de cercles ----------
    function avatarHtml(g) {
        if (g.kind === 'new') return '<span class="st-av st-av-new"><i class="fas fa-bolt"></i></span>';
        if (g.logo) return `<span class="st-av"><img src="${g.logo}" alt="" loading="lazy"></span>`;
        return `<span class="st-av st-av-letter">${esc((g.name || '?').trim().charAt(0).toUpperCase())}</span>`;
    }

    // Cercle de la rangée : la photo de la dernière story (sinon le logo) + badge vidéo / photo / texte
    function circleHtml(g) {
        const last = g.items[g.items.length - 1] || {};
        const photo = last.type === 'image' ? safeUrl(last.url) : '';
        let inner;
        if (photo) inner = `<span class="st-av"><img src="${photo}" alt="" loading="lazy"></span>`;
        else if (last.type === 'text' && !g.logo) inner = `<span class="st-av st-av-text" style="background:${esc(last.bg || '#1e40af')}">Aa</span>`;
        else inner = avatarHtml(g);
        const badge = g.kind === 'new' ? '' : last.type === 'video' ? '<i class="fas fa-play"></i>'
            : last.type === 'text' ? '<i class="fas fa-font"></i>' : '<i class="fas fa-image"></i>';
        return inner + (badge ? `<b class="st-badge">${badge}</b>` : '');
    }


    function renderRow() {
        if (!rowBox || !document.body.contains(rowBox)) return;
        const m = seenMap();
        const section = rowBox.closest('section');
        const mine = rowOpts.canPost
            ? `<button type="button" class="st-circle st-mine" onclick="location.href='vendor-dashboard.html#statuts'">
                   <span class="st-ring seen"><span class="st-av">${safeUrl(rowOpts.avatar) ? `<img src="${safeUrl(rowOpts.avatar)}" alt="">` : '<i class="fas fa-store"></i>'}</span><b class="st-plus">+</b></span>
                   <small>Votre story</small></button>` : '';
        if (!groups.length && !mine) {
            if (section) section.hidden = true;
            return;
        }
        if (section) section.hidden = false;
        rowBox.innerHTML = mine + groups.map((g, i) => `
            <button type="button" class="st-circle" style="--i:${i}" onclick="OuenzeStories.open(${i})" aria-label="Stories de ${esc(g.name)}">
                <span class="st-ring ${groupSeen(g, m) ? 'seen' : ''} ${g.kind === 'ouenze' ? 'st-brand' : ''}">${circleHtml(g)}</span>
                <small><span>${esc(g.name)}</span>${g.verified ? ' <i class="fas fa-check-circle st-verified" title="Boutique vérifiée"></i>' : ''}</small>
            </button>`).join('');
    }

    async function mountRow(boxId, opts = {}) {
        rowBox = document.getElementById(boxId);
        rowOpts = opts;
        if (!rowBox) return;
        try {
            feedJob = feedJob || loadFeed();
            const rows = await feedJob;
            groups = buildGroups(rows, opts.products);
        } catch (e) {
            console.warn('Statuts indisponibles :', e?.message || e);
            feedJob = null;
            groups = buildGroups([], opts.products);
        }
        renderRow();
    }

    // Les nouveautés arrivent avec le catalogue : on complète la rangée sans recharger les statuts
    function setProducts(products) {
        rowOpts.products = products;
        if (!feedJob) return;
        feedJob.then(rows => { groups = buildGroups(rows, products); renderRow(); }, () => {
            groups = buildGroups([], products); renderRow();
        });
    }

    // Le profil arrive après l'accueil : cercle « Votre story » pour les vendeurs
    function setPoster(on, avatar) {
        rowOpts.canPost = !!on;
        rowOpts.avatar = avatar || rowOpts.avatar;
        renderRow();
    }

    // ---------- Boutique ----------
    async function shopGroup(shopId) {
        let g = groups.find(x => x.shopId === shopId);
        if (g) return g;
        try {
            feedJob = feedJob || loadFeed();
            const rows = (await feedJob).filter(r => r.shop_id === shopId);
            return buildGroups(rows, [])[0] || null;
        } catch (e) { return null; }
    }

    async function openShop(shopId) {
        const g = await shopGroup(shopId);
        if (g) openViewer([g], 0);
    }

    async function decorateLogo(shopId, el) {
        if (!el || !shopId) return;
        const g = await shopGroup(shopId);
        if (!g || !document.body.contains(el)) return;
        el.classList.add('st-logo-ring');
        if (groupSeen(g)) el.classList.add('seen');
        el.setAttribute('role', 'button');
        el.setAttribute('title', 'Voir les stories de la boutique');
        el.onclick = () => openViewer([g], 0);
    }

    // ---------- Visionneuse ----------
    function open(index) { if (groups[index]) openViewer(groups, index); }

    // Aperçu (espace vendeur, admin) : stories dans l'ordre donné, en commençant à « start »
    function preview(items, title, start) {
        const g = { key: 'preview', kind: 'preview', name: title || 'Aperçu', logo: '', items: items.map(r => ({
            kind: 'story', id: r.id, type: r.media_type, url: r.media_url, caption: r.caption, bg: r.bg_color,
            productId: r.product_id, productName: r.product_name, at: r.created_at, viewed: true, preview: true
        })) };
        if (g.items.length) openViewer([g], 0, Math.min(Math.max(0, Number(start) || 0), g.items.length - 1));
    }

    function openViewer(list, gi, start) {
        if (!list?.[gi]?.items?.length) return;
        closeViewer(true);
        const box = document.createElement('div');
        box.className = 'st-viewer';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', 'Stories');
        box.innerHTML = `
            <div class="st-stage">
                <div class="st-bars"></div>
                <div class="st-head">
                    <span class="st-head-av"></span>
                    <span class="st-head-txt"><b></b><small></small></span>
                    <button type="button" class="st-btn st-sound" hidden aria-label="Son"><i class="fas fa-volume-mute"></i></button>
                    <button type="button" class="st-btn st-more" aria-label="Signaler" hidden><i class="fas fa-flag"></i></button>
                    <button type="button" class="st-btn st-close" aria-label="Fermer"><i class="fas fa-times"></i></button>
                </div>
                <div class="st-media"></div>
                <div class="st-tap st-tap-prev" aria-hidden="true"></div>
                <div class="st-tap st-tap-next" aria-hidden="true"></div>
                <div class="st-foot"></div>
            </div>
            <button type="button" class="st-nav st-nav-prev" aria-label="Précédent"><i class="fas fa-chevron-left"></i></button>
            <button type="button" class="st-nav st-nav-next" aria-label="Suivant"><i class="fas fa-chevron-right"></i></button>`;
        document.body.appendChild(box);
        document.body.classList.add('st-open');
        viewer = { box, list, gi, ii: 0, start: 0, elapsed: 0, dur: IMAGE_MS, paused: false, raf: 0, video: null, muted: false };

        const g = list[gi];
        // Reprendre au premier statut non vu du groupe
        const m = seenMap();
        const firstNew = g.items.findIndex(it => !isSeen(it, m));
        viewer.ii = Number.isInteger(start) ? start : (firstNew > 0 ? firstNew : 0);

        box.querySelector('.st-close').onclick = () => closeViewer();
        box.querySelector('.st-nav-prev').onclick = () => step(-1);
        box.querySelector('.st-nav-next').onclick = () => step(1);
        box.querySelector('.st-sound').onclick = toggleSound;
        box.querySelector('.st-more').onclick = reportCurrent;
        bindPress(box.querySelector('.st-tap-prev'), () => step(-1));
        bindPress(box.querySelector('.st-tap-next'), () => step(1));
        box.addEventListener('click', e => { if (e.target === box) closeViewer(); });
        // Glisser vers le bas pour fermer
        let y0 = null;
        box.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; }, { passive: true });
        box.addEventListener('touchend', e => {
            if (y0 !== null && e.changedTouches[0].clientY - y0 > 90) closeViewer();
            y0 = null;
        });
        document.addEventListener('keydown', onKey);
        showItem();
    }

    // Appui court = suivant/précédent ; appui long = pause
    function bindPress(el, action) {
        let t0 = 0;
        el.addEventListener('pointerdown', () => { t0 = Date.now(); pause(true); });
        el.addEventListener('pointerup', () => {
            pause(false);
            if (Date.now() - t0 < 250) action();
        });
        el.addEventListener('pointerleave', () => { if (viewer?.paused) pause(false); });
        el.addEventListener('contextmenu', e => e.preventDefault());
    }

    function onKey(e) {
        if (!viewer) return;
        if (e.key === 'Escape') closeViewer();
        else if (e.key === 'ArrowRight') step(1);
        else if (e.key === 'ArrowLeft') step(-1);
        else if (e.key === ' ') { e.preventDefault(); pause(!viewer.paused); }
    }

    function pause(on) {
        if (!viewer) return;
        if (on && !viewer.paused) {
            viewer.paused = true;
            viewer.elapsed += performance.now() - viewer.start;
            viewer.video?.pause();
        } else if (!on && viewer.paused) {
            viewer.paused = false;
            viewer.start = performance.now();
            viewer.video?.play().catch(() => {});
        }
    }

    function toggleSound() {
        if (!viewer?.video) return;
        viewer.muted = !viewer.muted;
        viewer.video.muted = viewer.muted;
        viewer.box.querySelector('.st-sound i').className = 'fas ' + (viewer.muted ? 'fa-volume-mute' : 'fa-volume-up');
    }

    function reportCurrent() {
        const g = viewer?.list[viewer.gi];
        if (!g?.shopId || typeof window.openReport !== 'function') return;
        pause(true);
        window.openReport('vendor', null, g.shopId, g.name);
    }

    function step(dir) {
        if (!viewer) return;
        const g = viewer.list[viewer.gi];
        let ii = viewer.ii + dir, gi = viewer.gi;
        if (ii >= g.items.length) { gi += 1; ii = 0; }
        else if (ii < 0) {
            if (gi === 0) { ii = 0; } else { gi -= 1; ii = 0; }
        }
        if (gi >= viewer.list.length) { closeViewer(); return; }
        if (gi !== viewer.gi) {
            const m = seenMap();
            const ng = viewer.list[gi];
            const firstNew = ng.items.findIndex(it => !isSeen(it, m));
            ii = dir > 0 && firstNew > 0 ? firstNew : (dir < 0 ? ng.items.length - 1 : 0);
        }
        viewer.gi = gi;
        viewer.ii = ii;
        showItem();
    }

    async function coverFor(it) {
        if (it.cover) return it.cover;
        const g = viewer?.list[viewer.gi];
        const ids = (g?.items || []).filter(x => x.kind === 'product' && !x.cover).map(x => x.id).slice(0, 30);
        try {
            const { data } = await sb().rpc('product_covers', { ids });
            (data || []).forEach(r => {
                const x = g.items.find(y => y.id === r.id);
                if (x) x.cover = safeUrl(r.cover) || 'none';
            });
        } catch (e) { /* sans photo */ }
        return it.cover || 'none';
    }

    function showItem() {
        if (!viewer) return;
        cancelAnimationFrame(viewer.raf);
        if (viewer.video) { viewer.video.pause(); viewer.video = null; }
        const { box, list, gi, ii } = viewer;
        const g = list[gi];
        const it = g.items[ii];
        if (!it) { closeViewer(); return; }

        box.querySelector('.st-bars').innerHTML = g.items.map((x, i) =>
            `<span><i style="width:${i < ii ? 100 : 0}%"></i></span>`).join('');
        box.querySelector('.st-head-av').innerHTML = avatarHtml(g);
        box.querySelector('.st-head-txt b').textContent = it.kind === 'product' ? (it.shopName || 'Nouveauté') : g.name;
        box.querySelector('.st-head-txt small').textContent = it.kind === 'product' ? 'Nouveauté · ' + timeAgo(it.at).replace('il y a ', '') : timeAgo(it.at);
        box.querySelector('.st-more').hidden = !(g.shopId && g.kind === 'shop' && typeof window.openReport === 'function');
        box.querySelector('.st-sound').hidden = it.type !== 'video';
        box.querySelector('.st-nav-prev').style.visibility = gi === 0 && ii === 0 ? 'hidden' : '';

        const media = box.querySelector('.st-media');
        const foot = box.querySelector('.st-foot');
        media.style.background = '';
        let dur = IMAGE_MS;
        if (it.type === 'text') {
            media.style.background = it.bg || '#1e40af';
            media.innerHTML = `<div class="st-text">${esc(it.caption)}</div>`;
            dur = Math.min(9000, 4000 + (it.caption || '').length * 40);
        } else if (it.type === 'video') {
            media.innerHTML = `<video playsinline preload="auto" src="${safeUrl(it.url)}"></video>`;
            const v = media.querySelector('video');
            viewer.video = v;
            v.muted = viewer.muted;
            dur = it.duration || 15000;
            v.addEventListener('loadedmetadata', () => {
                if (viewer?.video === v && isFinite(v.duration)) viewer.dur = Math.min(31000, v.duration * 1000);
            });
            v.addEventListener('ended', () => { if (viewer?.video === v) step(1); });
            // Vidéo illisible (réseau, format) : message, puis story suivante
            v.addEventListener('error', () => {
                if (viewer?.video !== v) return;
                viewer.video = null;
                viewer.dur = 3000;
                viewer.elapsed = 0;
                viewer.start = performance.now();
                media.innerHTML = '<div class="st-text st-video-err"><i class="fas fa-video-slash"></i><br>Vidéo indisponible</div>';
            });
            v.play().catch(() => {
                // Lecture avec le son refusée par le navigateur : on coupe le son
                viewer.muted = true;
                v.muted = true;
                box.querySelector('.st-sound i').className = 'fas fa-volume-mute';
                v.play().catch(() => {});
            });
            box.querySelector('.st-sound i').className = 'fas ' + (v.muted ? 'fa-volume-mute' : 'fa-volume-up');
        } else if (it.type === 'product') {
            media.innerHTML = '<div class="st-product"><div class="st-spin"></div></div>';
            coverFor(it).then(cover => {
                if (!viewer || viewer.list[viewer.gi]?.items[viewer.ii] !== it) return;
                media.innerHTML = `<div class="st-product">
                    ${cover && cover !== 'none' ? `<img src="${cover}" alt="">` : '<i class="fas fa-box-open st-noimg"></i>'}
                    <span class="st-new-tag"><i class="fas fa-bolt"></i> Nouveau</span></div>`;
            });
        } else {
            media.innerHTML = `<img src="${safeUrl(it.url)}" alt="">`;
        }

        const caption = it.type !== 'text' && it.caption ? `<p class="st-caption">${esc(it.caption)}</p>` : '';
        const productLine = it.productName
            ? `<p class="st-prod-line"><b>${esc(it.productName)}</b>${it.productPrice ? ` · ${money(it.productPrice)}` : ''}</p>` : '';
        const actions = [];
        if (!it.preview && it.productId) actions.push(`<button type="button" class="st-cta" data-act="product"><i class="fas fa-shopping-bag"></i> Voir le produit</button>`);
        if (!it.preview && (g.shopId || it.shopId) && g.kind !== 'ouenze') actions.push(`<button type="button" class="st-cta ghost" data-act="shop"><i class="fas fa-store"></i> Boutique</button>`);
        const like = it.preview ? '' : `<button type="button" class="st-like ${isLiked(it) ? 'on' : ''}" aria-pressed="${isLiked(it)}"
                aria-label="${it.kind === 'product' ? 'Ajouter aux favoris' : "J'aime"}"><i class="${isLiked(it) ? 'fas' : 'far'} fa-heart"></i></button>`;
        foot.innerHTML = caption + productLine + `<div class="st-actions">${actions.join('')}${like}</div>`;
        foot.querySelectorAll('.st-cta').forEach(b => b.onclick = () => act(b.dataset.act, it, g));
        const likeBtn = foot.querySelector('.st-like');
        if (likeBtn) likeBtn.onclick = () => toggleLike(it, likeBtn);

        viewer.dur = dur;
        viewer.elapsed = 0;
        viewer.start = performance.now();
        viewer.paused = false;
        if (!it.preview) queueView(it);
        tick();
    }

    function tick() {
        if (!viewer) return;
        const bar = viewer.box.querySelectorAll('.st-bars i')[viewer.ii];
        let ratio;
        if (viewer.video && isFinite(viewer.video.duration) && viewer.video.duration > 0) {
            ratio = viewer.video.currentTime / viewer.video.duration;
        } else {
            const spent = viewer.elapsed + (viewer.paused ? 0 : performance.now() - viewer.start);
            ratio = spent / viewer.dur;
        }
        if (bar) bar.style.width = Math.min(100, ratio * 100) + '%';
        // Vidéo : elle passe à la suite à sa fin ; sans durée connue, au bout du temps prévu
        if (ratio >= 1 && (!viewer.video || !(viewer.video.duration > 0))) { step(1); return; }
        viewer.raf = requestAnimationFrame(tick);
    }

    function act(what, it, g) {
        const shopId = it.shopId || g.shopId;
        const productId = it.productId;
        closeViewer();
        if (what === 'product' && productId) {
            if (typeof window.openProductDetail === 'function') window.openProductDetail(productId);
            else location.href = 'index.html?shop=' + encodeURIComponent(shopId || '');
        } else if (what === 'shop' && shopId) {
            if (typeof window.viewShopDetail === 'function') window.viewShopDetail(shopId);
            else location.href = 'index.html?shop=' + encodeURIComponent(shopId);
        }
    }

    function closeViewer(silent) {
        if (!viewer) return;
        cancelAnimationFrame(viewer.raf);
        viewer.video?.pause();
        viewer.box.remove();
        viewer = null;
        document.body.classList.remove('st-open');
        document.removeEventListener('keydown', onKey);
        if (!silent) { flushViews(); renderRow(); }
    }

    // ---------- Publier ----------
    function compressImage(file, max, quality) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                const ratio = Math.min(1, max / Math.max(img.width, img.height));
                const c = document.createElement('canvas');
                c.width = Math.round(img.width * ratio);
                c.height = Math.round(img.height * ratio);
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, c.width, c.height);
                ctx.drawImage(img, 0, 0, c.width, c.height);
                URL.revokeObjectURL(url);
                c.toBlob(b => b ? resolve(b) : reject(new Error('Image illisible')), 'image/jpeg', quality);
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
            img.src = url;
        });
    }
    const blobToDataUrl = blob => new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error('Image illisible'));
        r.readAsDataURL(blob);
    });
    function videoDuration(file) {
        return new Promise(resolve => {
            const v = document.createElement('video');
            v.preload = 'metadata';
            const url = URL.createObjectURL(file);
            v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(v.duration); };
            v.onerror = () => { URL.revokeObjectURL(url); resolve(NaN); };
            v.src = url;
        });
    }

    let draft = null;

    function compose(opts = {}) {
        closeComposer();
        const shops = (opts.shops || []).filter(x => x && x.id);
        draft = { opts, shopId: opts.shopId || null, type: 'image', file: null, blob: null, previewUrl: '', durationMs: null, bg: COLORS[0] };
        const products = (opts.products || []).slice(0, 300);
        const shopChip = (x, on) => `<button type="button" class="st-shop ${on ? 'active' : ''}" data-shop="${esc(x.id)}" aria-pressed="${on}">
                <span class="st-shop-logo">${safeUrl(x.logo) ? `<img src="${safeUrl(x.logo)}" alt="">` : esc((x.name || '?').trim().charAt(0).toUpperCase())}</span>
                <span>${esc(x.name)}</span>${on ? '<i class="fas fa-check-circle"></i>' : ''}</button>`;
        // Boutique de la story : toujours affichée ; au choix si le vendeur en a plusieurs
        const shopBlock = !opts.shopId ? '' : `<div class="st-l st-shop-l">${shops.length > 1 ? 'Publier pour quelle boutique ?' : 'Boutique'}
                <div class="st-shops ${shops.length > 1 ? '' : 'single'}">${(shops.length ? shops : [{ id: opts.shopId, name: opts.shopName || 'Ma boutique' }])
                    .map(x => shopChip(x, x.id === opts.shopId)).join('')}</div></div>`;
        const box = document.createElement('div');
        box.className = 'st-compose-wrap';
        box.innerHTML = `
            <div class="st-compose" role="dialog" aria-label="Nouvelle story">
                <button type="button" class="st-x" aria-label="Fermer">&times;</button>
                <h3><i class="fas fa-circle-notch"></i> Nouvelle story</h3>
                <p class="st-sub">${opts.shopId ? `Visible 24 h par les clients, en haut de l'accueil et sur la page de la boutique.` : 'Story Ouenze : visible 24 h par tous les clients.'}</p>
                ${shopBlock}
                <div class="st-tabs">
                    <button type="button" data-type="image" class="active"><i class="fas fa-image"></i> Photo</button>
                    <button type="button" data-type="video"><i class="fas fa-video"></i> Vidéo</button>
                    <button type="button" data-type="text"><i class="fas fa-font"></i> Texte</button>
                </div>
                <div class="st-pick">
                    <label class="st-drop"><input type="file" hidden>
                        <span class="st-drop-in"><i class="fas fa-cloud-upload-alt"></i><b>Choisir une photo</b><small>JPG ou PNG</small></span>
                    </label>
                </div>
                <div class="st-textbox" hidden>
                    <textarea maxlength="250" rows="4" placeholder="Ex. : Arrivage de pagnes ce matin ! Livraison le jour même."></textarea>
                    <div class="st-colors">${COLORS.map((c, i) => `<button type="button" data-c="${c}" style="background:${c}" class="${i ? '' : 'active'}" aria-label="Couleur ${i + 1}"></button>`).join('')}</div>
                </div>
                <label class="st-l st-cap-l">Légende (facultatif)
                    <input type="text" class="st-cap" maxlength="250" placeholder="Ex. : Nouvelle collection, -20 % ce week-end">
                </label>
                <div class="st-prod-wrap">${productSelect(products)}</div>
                ${opts.shopId ? `<div class="st-l">Qui peut le voir ?
                    <div class="st-aud">
                        <label><input type="radio" name="stAud" value="all" checked><span><b>Tout le monde</b><small>Tous les clients de Ouenze</small></span></label>
                        <label><input type="radio" name="stAud" value="fans"><span><b>Mes fidèles</b><small>Clients qui ont ta boutique en favori ou y ont commandé</small></span></label>
                    </div></div>` : ''}
                <p class="st-err" hidden></p>
                <button type="button" class="st-publish"><i class="fas fa-paper-plane"></i> Publier la story</button>
            </div>`;
        document.body.appendChild(box);
        const q = s => box.querySelector(s);
        q('.st-x').onclick = closeComposer;
        box.addEventListener('click', e => { if (e.target === box) closeComposer(); });
        box.querySelectorAll('.st-tabs button').forEach(b => b.onclick = () => setType(b.dataset.type));
        q('.st-drop input').onchange = e => pickFile(e.target.files?.[0]);
        box.querySelectorAll('.st-colors button').forEach(b => b.onclick = () => {
            draft.bg = b.dataset.c;
            box.querySelectorAll('.st-colors button').forEach(x => x.classList.toggle('active', x === b));
            q('.st-textbox textarea').style.background = draft.bg;
        });
        q('.st-textbox textarea').style.background = draft.bg;
        q('.st-publish').onclick = publish;
        box.querySelectorAll('.st-shops:not(.single) .st-shop').forEach(b => b.onclick = () => chooseShop(b.dataset.shop));
        draft.box = box;
        setType('image');
        updatePublishLabel();
    }

    function productSelect(products) {
        return products.length ? `<label class="st-l">Produit à mettre en avant (facultatif)
                    <select class="st-prod"><option value="">Aucun</option>
                        ${products.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
                    </select></label>` : '';
    }

    function shopName(id) {
        const x = (draft?.opts.shops || []).find(s => s.id === id);
        return x?.name || draft?.opts.shopName || '';
    }

    function updatePublishLabel() {
        const btn = draft?.box.querySelector('.st-publish');
        if (!btn || btn.disabled) return;
        const name = draft.shopId ? shopName(draft.shopId) : '';
        btn.innerHTML = `<i class="fas fa-paper-plane"></i> ${name ? `Publier sur ${esc(name)}` : 'Publier la story'}`;
    }

    // Autre boutique : la puce change et la liste des produits est celle de cette boutique
    async function chooseShop(id) {
        if (!draft || !id || id === draft.shopId) return;
        draft.shopId = id;
        const box = draft.box;
        box.querySelectorAll('.st-shop').forEach(b => {
            const on = b.dataset.shop === id;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
            b.querySelector('.fa-check-circle')?.remove();
            if (on) b.insertAdjacentHTML('beforeend', '<i class="fas fa-check-circle"></i>');
        });
        updatePublishLabel();
        const wrap = box.querySelector('.st-prod-wrap');
        wrap.innerHTML = '';
        if (typeof draft.opts.loadProducts === 'function') {
            const list = await Promise.resolve(draft.opts.loadProducts(id)).catch(() => []);
            if (draft?.shopId === id) wrap.innerHTML = productSelect((list || []).slice(0, 300));
        }
    }

    function setType(type) {
        if (!draft) return;
        const box = draft.box;
        draft.type = type;
        draft.file = null;
        draft.blob = null;
        if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
        draft.previewUrl = '';
        box.querySelectorAll('.st-tabs button').forEach(b => b.classList.toggle('active', b.dataset.type === type));
        box.querySelector('.st-pick').hidden = type === 'text';
        box.querySelector('.st-textbox').hidden = type !== 'text';
        box.querySelector('.st-cap-l').hidden = type === 'text';
        const input = box.querySelector('.st-drop input');
        input.value = '';
        input.accept = type === 'video' ? 'video/mp4,video/webm,video/quicktime' : 'image/*';
        box.querySelector('.st-drop-in').innerHTML = type === 'video'
            ? '<i class="fas fa-film"></i><b>Choisir une vidéo</b><small>30 secondes et 15 Mo au plus</small>'
            : '<i class="fas fa-cloud-upload-alt"></i><b>Choisir une photo</b><small>JPG ou PNG</small>';
        setError('');
    }

    function setError(msg) {
        const el = draft?.box.querySelector('.st-err');
        if (!el) return;
        el.textContent = msg;
        el.hidden = !msg;
    }

    async function pickFile(file) {
        if (!draft || !file) return;
        setError('');
        const zone = draft.box.querySelector('.st-drop-in');
        try {
            if (draft.type === 'video') {
                if (!/^video\//.test(file.type)) throw new Error('Choisis un fichier vidéo.');
                if (file.size > 15 * 1024 * 1024) throw new Error('Vidéo trop lourde : 15 Mo au plus.');
                const d = await videoDuration(file);
                if (isFinite(d) && d > 30.5) throw new Error('Vidéo trop longue : 30 secondes au plus.');
                draft.file = file;
                draft.durationMs = isFinite(d) ? Math.max(1000, Math.round(d * 1000)) : null;
                draft.previewUrl = URL.createObjectURL(file);
                zone.innerHTML = `<video src="${draft.previewUrl}" muted playsinline autoplay loop></video><small>Toucher pour changer</small>`;
            } else {
                if (!/^image\//.test(file.type)) throw new Error('Choisis une photo.');
                draft.blob = await compressImage(file, 1280, 0.8);
                draft.file = file;
                draft.previewUrl = URL.createObjectURL(draft.blob);
                zone.innerHTML = `<img src="${draft.previewUrl}" alt=""><small>Toucher pour changer</small>`;
            }
        } catch (e) {
            draft.file = null;
            draft.blob = null;
            setError(e.message || 'Fichier illisible');
        }
    }

    async function upload(blob, ext, contentType) {
        const { data: s } = await sb().auth.getSession();
        const uid = s?.session?.user?.id;
        if (!uid) throw new Error('Connecte-toi pour publier une story.');
        const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await sb().storage.from('stories').upload(path, blob, { contentType, upsert: false });
        if (error) throw error;
        const { data } = sb().storage.from('stories').getPublicUrl(path);
        return { url: data?.publicUrl, path };
    }

    function friendly(e) {
        const m = String(e?.message || e || '');
        if (/could not find the function|schema cache|post_story|does not exist/i.test(m)) {
            return "Les stories ne sont pas encore activées sur le serveur. L'équipe Ouenze doit lancer la mise à jour de la base (20261111_stories.sql).";
        }
        if (/bucket not found|not found/i.test(m)) return "L'espace de stockage des stories n'est pas encore prêt. Préviens l'équipe Ouenze.";
        if (/row-level security|unauthorized|403/i.test(m)) return "Envoi du fichier refusé. Reconnecte-toi puis réessaie.";
        if (/payload too large|413|exceeded/i.test(m)) return 'Fichier trop lourd.';
        if (/fetch|network/i.test(m)) return 'Connexion perdue. Vérifie ton réseau puis réessaie.';
        return m || 'Publication impossible pour le moment.';
    }

    async function publish() {
        if (!draft) return;
        const box = draft.box;
        const btn = box.querySelector('.st-publish');
        const caption = draft.type === 'text'
            ? box.querySelector('.st-textbox textarea').value.trim()
            : box.querySelector('.st-cap').value.trim();
        const product = box.querySelector('.st-prod')?.value || null;
        const aud = box.querySelector('input[name="stAud"]:checked')?.value || 'all';
        setError('');
        if (draft.type === 'text' && !caption) return setError('Écris le texte de ta story.');
        if (draft.type !== 'text' && !draft.file) return setError(draft.type === 'video' ? 'Choisis une vidéo.' : 'Choisis une photo.');

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publication…';
        let uploaded = null;
        try {
            let url = null, path = null;
            if (draft.type === 'image') {
                try {
                    uploaded = await upload(draft.blob, 'jpg', 'image/jpeg');
                } catch (e) {
                    // Stockage indisponible : petite image intégrée au statut
                    const small = await compressImage(draft.file, 720, 0.7);
                    if (small.size > 450000) throw e;
                    url = await blobToDataUrl(small);
                }
            } else if (draft.type === 'video') {
                const ext = /webm/.test(draft.file.type) ? 'webm' : (/quicktime/.test(draft.file.type) ? 'mov' : 'mp4');
                uploaded = await upload(draft.file, ext, draft.file.type || 'video/mp4');
            }
            if (uploaded) { url = uploaded.url; path = uploaded.path; }
            const { error } = await sb().rpc('post_story', {
                target_shop: draft.shopId || null, kind: draft.type, url, path,
                caption: caption || null, bg: draft.type === 'text' ? draft.bg : null,
                product, aud, duration: draft.type === 'video' ? draft.durationMs : null
            });
            if (error) throw error;
            const done = draft.opts.onDone;
            closeComposer();
            feedJob = null;
            if (typeof done === 'function') done();
        } catch (e) {
            if (uploaded?.path) sb().storage.from('stories').remove([uploaded.path]).catch(() => {});
            setError(friendly(e));
            btn.disabled = false;
            updatePublishLabel();
        }
    }

    function closeComposer() {
        if (!draft) return;
        if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
        draft.box.remove();
        draft = null;
    }

    // Supprimer un statut (vendeur ou équipe pour les statuts Ouenze) et son fichier
    async function remove(id) {
        const { data, error } = await sb().rpc('delete_my_story', { target: id });
        if (error) throw error;
        if (data) await sb().storage.from('stories').remove([data]).catch(() => {});
        feedJob = null;
    }

    // Efface les fichiers des statuts expirés ou supprimés de l'utilisateur connecté
    async function cleanFiles() {
        try {
            const { data, error } = await sb().rpc('my_story_files_to_clean');
            if (error || !Array.isArray(data) || !data.length) return;
            const { error: rmErr } = await sb().storage.from('stories').remove(data.map(r => r.media_path));
            if (!rmErr) await sb().rpc('story_files_cleaned', { ids: data.map(r => r.id) });
        } catch (e) { /* on réessaiera plus tard */ }
    }

    // Nombre de J'aime de mes stories (vendeur) ou de toutes (équipe) : { id: nombre }
    async function likeCounts(ids) {
        if (!ids?.length) return {};
        try {
            const { data, error } = await sb().rpc('story_like_counts', { ids });
            if (error) return {};
            return Object.fromEntries((data || []).map(r => [r.story_id, Number(r.likes) || 0]));
        } catch (e) { return {}; }
    }

    window.OuenzeStories = {
        mountRow, setProducts, setPoster, open, likeCounts, openShop, decorateLogo, compose, preview, remove, cleanFiles, timeAgo,
        close: () => closeViewer()
    };
})();
