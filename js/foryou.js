// ============================================================
// FORYOU.JS — favoris et sélection « Pour toi »
//
// Favoris : boutiques et produits. Connecté → table favorites (migration 20261106),
// visiteur → gardés sur le téléphone puis envoyés au compte à la connexion.
//
// Goûts : ce que le client regarde, ajoute au panier, met en favori ou cherche
// (catégories, boutiques, produits, prix). Gardés sur le téléphone, et copiés dans
// user_taste pour un client connecté (au plus toutes les 2 minutes).
//
// rank() classe les produits pour une personne :
//   ses goûts + tendances (commandes 30 jours) + qualité de la boutique + nouveauté
//   + photo + prix habituel − produits déjà montrés sans clic,
//   + une part de découverte propre à chaque personne et à chaque jour
//   (deux clients ne voient pas la même chose, et un client ne revoit pas toujours la même chose),
//   puis on varie boutiques et catégories pour ne pas aligner 6 produits du même vendeur.
// ============================================================

(function () {
    'use strict';

    const TASTE_KEY = 'ouenze_taste_v1';
    const FAV_KEY = 'ouenze_favs_v1';
    const VID_KEY = 'ouenze_vid';
    const DAY = 86400000;

    const store = {
        get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage plein ou bloqué */ } }
    };

    let user = null;
    let db = () => window.supabase;

    // ---------- Identifiant de découverte (aléatoire, propre à ce téléphone) ----------
    function visitorId() {
        let v = store.get(VID_KEY, null);
        if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set(VID_KEY, v); }
        return String(v);
    }
    // Nombre stable entre 0 et 1 pour (personne, jour, produit)
    function seeded(...parts) {
        let h = 2166136261;
        const s = parts.join('|');
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
        return (h >>> 0) / 4294967296;
    }

    // ---------- Goûts ----------
    const emptyTaste = () => ({ c: {}, s: {}, p: {}, q: [], r: [], price: { sum: 0, n: 0 }, seen: {}, t: Date.now() });
    let taste = load();

    function load() {
        const t = Object.assign(emptyTaste(), store.get(TASTE_KEY, {}));
        // Les goûts anciens comptent moins (−5 % par jour)
        const days = Math.max(0, (Date.now() - (Number(t.t) || Date.now())) / DAY);
        if (days >= 1) {
            const f = Math.pow(0.95, days);
            ['c', 's', 'p'].forEach(m => Object.keys(t[m]).forEach(k => { t[m][k] *= f; if (t[m][k] < 0.05) delete t[m][k]; }));
            Object.keys(t.seen).forEach(k => { t.seen[k] *= Math.pow(0.8, days); if (t.seen[k] < 0.3) delete t.seen[k]; });
            t.t = Date.now();
        }
        return t;
    }

    function trim(map, max) {
        const keys = Object.keys(map);
        if (keys.length <= max) return;
        keys.sort((a, b) => map[b] - map[a]).slice(max).forEach(k => delete map[k]);
    }

    let syncTimer = null;
    function save() {
        trim(taste.c, 20); trim(taste.s, 40); trim(taste.p, 60); trim(taste.seen, 300);
        taste.q = taste.q.slice(0, 15); taste.r = taste.r.slice(0, 24);
        taste.t = Date.now();
        store.set(TASTE_KEY, taste);
        if (user && !syncTimer) syncTimer = setTimeout(pushTaste, 120000);
    }

    function add(map, key, n) { if (key) map[key] = (map[key] || 0) + n; }

    // Ce qui part dans user_taste (pas les « déjà vus », propres au téléphone)
    function portable() { return { c: taste.c, s: taste.s, p: taste.p, q: taste.q, r: taste.r, price: taste.price }; }

    async function pushTaste() {
        clearTimeout(syncTimer); syncTimer = null;
        if (!user || !db()?.from) return;
        try {
            await db().from('user_taste').upsert({ user_id: user.id, taste: portable(), updated_at: new Date().toISOString() });
        } catch (e) { /* table absente : les goûts restent sur le téléphone */ }
    }

    async function pullTaste() {
        try {
            const { data, error } = await db().from('user_taste').select('taste').eq('user_id', user.id).maybeSingle();
            if (error || !data?.taste) return;
            const r = data.taste;
            ['c', 's', 'p'].forEach(m => Object.entries(r[m] || {}).forEach(([k, v]) => {
                if (Number(v) > (taste[m][k] || 0)) taste[m][k] = Number(v);
            }));
            taste.q = [...new Set([...(taste.q || []), ...(r.q || [])])].slice(0, 15);
            taste.r = [...new Set([...(taste.r || []), ...(r.r || [])])].slice(0, 24);
            if ((r.price?.n || 0) > (taste.price?.n || 0)) taste.price = r.price;
            store.set(TASTE_KEY, taste);
        } catch (e) { /* hors ligne */ }
    }

    // Événements : le moteur ne reçoit que des identifiants, une catégorie et un prix
    function track(type, d = {}) {
        switch (type) {
            case 'view_product':
                add(taste.p, d.id, 3); add(taste.c, d.cat, 2); add(taste.s, d.shop, 1);
                taste.r = [d.id, ...taste.r.filter(x => x !== d.id)];
                if (d.id) delete taste.seen[d.id];
                if (Number(d.price) > 0) { taste.price.sum += Number(d.price); taste.price.n += 1; }
                break;
            case 'cart':
                add(taste.p, d.id, 6); add(taste.c, d.cat, 4); add(taste.s, d.shop, 3); break;
            case 'fav_product':
                add(taste.p, d.id, 8); add(taste.c, d.cat, 4); add(taste.s, d.shop, 2); break;
            case 'fav_shop':
                add(taste.s, d.id, 8); break;
            case 'view_shop':
                add(taste.s, d.id, 3); break;
            case 'category':
                add(taste.c, d.cat, 3); break;
            case 'search':
                if (d.q) taste.q = [String(d.q).slice(0, 40), ...taste.q.filter(x => x !== d.q)];
                (d.cats || []).forEach(c => add(taste.c, c, 2));
                break;
            case 'impression':
                (d.ids || []).forEach(id => { taste.seen[id] = (taste.seen[id] || 0) + 1; });
                break;
            default: return;
        }
        save();
    }

    function hasTaste() { return Object.keys(taste.c).length + Object.keys(taste.s).length + Object.keys(taste.p).length > 0; }
    function topCategories(n = 3) { return Object.keys(taste.c).sort((a, b) => taste.c[b] - taste.c[a]).slice(0, n); }
    function recent() { return taste.r.slice(); }

    // ---------- Classement ----------
    // products : liste ; ctx.catOf(p), ctx.priceOf(p), ctx.hasPhoto(p), ctx.inStock(p), ctx.shopScore(p) ∈ [0,1],
    // ctx.trend : Map id → nombre de commandes. opts.limit, opts.exclude (Set d'ids).
    function rank(products, ctx, opts = {}) {
        const vid = visitorId();
        const day = Math.floor(Date.now() / DAY);
        const max = m => Math.max(1, ...Object.values(m));
        const mc = max(taste.c), ms = max(taste.s), mp = max(taste.p);
        const maxTrend = Math.max(1, ...[...(ctx.trend || new Map()).values()]);
        const avgPrice = taste.price.n ? taste.price.sum / taste.price.n : 0;
        const known = hasTaste();
        const favP = new Set(favIds('product')), favS = new Set(favIds('shop'));
        const exclude = opts.exclude || new Set();

        const scored = products.filter(p => p && !exclude.has(p.id)).map(p => {
            const cat = ctx.catOf(p);
            const price = ctx.priceOf(p);
            const trend = ctx.trend?.get(p.id) || 0;
            const ageDays = (Date.now() - new Date(p.created_at || 0).getTime()) / DAY;
            const parts = {
                cat: 2.2 * ((taste.c[cat] || 0) / mc),
                shop: 1.0 * ((taste.s[p.shop_id] || 0) / ms),
                product: 0.6 * ((taste.p[p.id] || 0) / mp),
                fav: (favP.has(p.id) ? 1.2 : 0) + (favS.has(p.shop_id) ? 0.6 : 0),
                trend: 0.9 * (Math.log1p(trend) / Math.log1p(maxTrend)),
                quality: 0.5 * (ctx.shopScore(p) || 0),
                fresh: ageDays >= 0 && ageDays < 14 ? 0.4 * (1 - ageDays / 14) : 0,
                photo: ctx.hasPhoto(p) ? 0.5 : -1.5,
                stock: ctx.inStock(p) ? 0 : -2,
                price: avgPrice && price ? 0.4 * Math.exp(-Math.abs(Math.log(price / avgPrice))) : 0,
                tired: -0.25 * Math.min(taste.seen[p.id] || 0, 6),
                explore: (known ? 0.45 : 0.9) * seeded(vid, day, p.id) + 0.15 * Math.random()
            };
            const score = Object.values(parts).reduce((a, b) => a + b, 0);
            let reason = '';
            if (parts.fav >= 1.2) reason = 'Dans tes favoris';
            else if (parts.cat >= 1.1 && cat) reason = 'cat:' + cat;
            else if (parts.shop >= 0.6 || favS.has(p.shop_id)) reason = 'Une boutique que tu aimes';
            else if (parts.trend >= 0.45 && trend >= 2) reason = 'Tendance';
            else if (parts.fresh >= 0.25) reason = 'Nouveau';
            return { p, cat, score, reason };
        });

        // Variété : chaque produit de la même boutique ou catégorie déjà choisie coûte un peu
        const out = [];
        const perShop = {}, perCat = {};
        const limit = Math.min(opts.limit || scored.length, scored.length);
        while (out.length < limit && scored.length) {
            let best = 0, bestVal = -Infinity;
            for (let i = 0; i < scored.length; i++) {
                const s = scored[i];
                const v = s.score - 0.7 * (perShop[s.p.shop_id] || 0) - 0.3 * (perCat[s.cat] || 0);
                if (v > bestVal) { bestVal = v; best = i; }
            }
            const pick = scored.splice(best, 1)[0];
            perShop[pick.p.shop_id] = (perShop[pick.p.shop_id] || 0) + 1;
            perCat[pick.cat] = (perCat[pick.cat] || 0) + 1;
            out.push(pick);
        }
        return out;
    }

    // ---------- Favoris ----------
    let favs = new Set(store.get(FAV_KEY, []));
    const listeners = new Set();
    const keyOf = (kind, id) => `${kind}:${id}`;
    function favIds(kind) { return [...favs].filter(k => k.startsWith(kind + ':')).map(k => k.slice(kind.length + 1)); }
    function isFav(kind, id) { return favs.has(keyOf(kind, id)); }
    function emit() { store.set(FAV_KEY, [...favs]); listeners.forEach(fn => { try { fn(); } catch (e) { /* écran fermé */ } }); }
    function onFavChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

    // Renvoie le nouvel état (true = favori). Optimiste : l'écran change tout de suite.
    async function toggleFav(kind, id) {
        if (!id || !['shop', 'product'].includes(kind)) return false;
        const k = keyOf(kind, id);
        const now = !favs.has(k);
        if (now) favs.add(k); else favs.delete(k);
        emit();
        if (user && db()?.from) {
            try {
                const q = now
                    ? db().from('favorites').upsert({ user_id: user.id, kind, target_id: id }, { onConflict: 'user_id,kind,target_id', ignoreDuplicates: true })
                    : db().from('favorites').delete().eq('user_id', user.id).eq('kind', kind).eq('target_id', id);
                const { error } = await q;
                if (error && !/favorites|schema cache|does not exist/i.test(error.message || '')) {
                    // Refus réel : on revient en arrière
                    if (now) favs.delete(k); else favs.add(k);
                    emit();
                    return !now;
                }
            } catch (e) { /* hors ligne : gardé sur le téléphone */ }
        }
        return now;
    }

    async function pullFavorites() {
        try {
            const local = [...favs];
            const { data, error } = await db().from('favorites').select('kind, target_id').eq('user_id', user.id).limit(500);
            if (error) return;
            const remote = new Set((data || []).map(r => keyOf(r.kind, r.target_id)));
            // Favoris ajoutés avant la connexion : envoyés au compte
            const missing = local.filter(k => !remote.has(k)).map(k => {
                const [kind, target_id] = k.split(':');
                return { user_id: user.id, kind, target_id };
            }).filter(r => /^[0-9a-f-]{36}$/i.test(r.target_id));
            if (missing.length) {
                await db().from('favorites').upsert(missing, { onConflict: 'user_id,kind,target_id', ignoreDuplicates: true });
                missing.forEach(r => remote.add(keyOf(r.kind, r.target_id)));
            }
            favs = remote;
            emit();
        } catch (e) { /* hors ligne */ }
    }

    async function init(currentUser) {
        user = currentUser && currentUser.id ? currentUser : null;
        if (!user || !db()?.from) return;
        await Promise.all([pullFavorites(), pullTaste()]);
    }

    document.addEventListener('visibilitychange', () => { if (document.hidden && syncTimer) pushTaste(); });

    window.Ouenze4U = { init, track, rank, hasTaste, topCategories, recent, isFav, toggleFav, favIds, onFavChange, visitorId };
})();
