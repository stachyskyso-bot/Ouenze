// ============================================================
// ACTIVITIES.JS — Mes activités : tout ce que l'utilisateur a fait sur Ouenze
//
// Sources (Supabase, chacune facultative : une source absente n'empêche pas les autres) :
//   • orders (client_id = moi)            → mes achats
//   • vendor_sales()                       → mes ventes livrées (si je suis vendeur)
//   • my_share_orders()                    → mes réservations / achats de parts
//   • share_offerings (owner_id = moi)     → mes demandes d'entrée en bourse
//   • delivery_applications (user_id = moi)→ ma candidature livreur
// ============================================================

(function () {
    'use strict';

    const I = window.OuenzeInvest;
    const { esc, fcfa, num } = I;
    const FILTERS = { all: 'Tout', buy: 'Achats', sale: 'Ventes', invest: 'Investissements', other: 'Bourse & livraison' };
    const state = { user: null, items: [], filter: 'all', missing: false };
    const box = () => document.getElementById('activitiesContainer');

    const ORDER_STATUS = {
        pending: ['En attente', 'wait'], awaiting_payment: ['Paiement en attente', 'wait'], paid: ['Payée', 'info'],
        confirmed: ['Confirmée', 'info'], accepted: ['Acceptée par le vendeur', 'info'], preparing: ['En préparation', 'info'],
        courier_assigned: ['Livreur en route', 'info'], picked_up: ['Récupérée', 'info'], in_transit: ['En livraison', 'info'],
        delivered: ['Livrée', 'ok'], cancelled: ['Annulée', 'ko'], refused: ['Refusée', 'ko'], refunded: ['Remboursée', 'ko']
    };
    const SHARE_STATUS = { requested: ['À payer', 'wait'], paid: ['Payée', 'ok'], cancelled: ['Annulée', 'ko'], refunded: ['Remboursée', 'ko'] };
    const LISTING_STATUS = { pending: ['En vérification', 'wait'], open: ['En bourse', 'ok'], closed: ['Clôturée', 'info'], rejected: ['Refusée', 'ko'], cancelled: ['Annulée', 'ko'] };
    const COURIER_STATUS = { pending: ['En vérification', 'wait'], approved: ['Validée', 'ok'], rejected: ['Refusée', 'ko'] };

    // ---------- Transformation des données en activités homogènes ----------
    function fromOrders(orders) {
        return orders.map(o => {
            const items = o.items || o.order_items || [];
            const names = items.map(i => `${i.product_name}${i.quantity > 1 ? ' ×' + i.quantity : ''}`).join(', ');
            const total = Number(o.total ?? o.total_amount) || 0;
            const status = ORDER_STATUS[o.status] || [o.status || 'En cours', 'info'];
            const cancelled = ['cancelled', 'refused', 'refunded'].includes(o.status);
            return {
                type: 'buy', icon: 'fa-shopping-bag', date: o.created_at,
                title: names || `Commande n° ${String(o.id).slice(0, 8)}`,
                sub: `Commande n° ${String(o.id).slice(0, 8)}`,
                amount: total, sign: -1, counts: !cancelled, status,
                link: o.status === 'delivered' || cancelled ? null : `tracking.html?order=${encodeURIComponent(o.id)}`
            };
        });
    }

    function fromSales(lines) {
        const byOrder = new Map();
        lines.forEach(l => {
            const k = `${l.order_id}|${l.shop_id}`;
            const s = byOrder.get(k) || { date: l.sold_at, id: l.order_id, amount: 0, names: [] };
            s.amount += (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
            s.names.push(`${l.product_name}${l.quantity > 1 ? ' ×' + l.quantity : ''}`);
            byOrder.set(k, s);
        });
        return [...byOrder.values()].map(s => ({
            type: 'sale', icon: 'fa-cash-register', date: s.date,
            title: s.names.join(', '), sub: `Vente livrée · commande n° ${String(s.id).slice(0, 8)}`,
            amount: s.amount, sign: 1, counts: true, status: ['Livrée', 'ok'], link: 'accounting.html'
        }));
    }

    function fromShares(orders) {
        return orders.map(o => ({
            type: 'invest', icon: 'fa-chart-pie', date: o.paid_at || o.created_at,
            title: `${num(o.quantity)} parts de ${o.shop_name}`,
            sub: `${fcfa(o.price_per_share)} la part · ${o.status === 'paid' ? 'payée le ' + I.frDate(o.paid_at) : 'réservée le ' + I.frDate(o.created_at)}`,
            amount: Number(o.amount) || 0, sign: -1, counts: o.status === 'paid',
            status: SHARE_STATUS[o.status] || [o.status, 'info'], link: 'portfolio.html'
        }));
    }

    function fromListings(rows) {
        return rows.map(r => ({
            type: 'other', icon: 'fa-landmark', date: r.reviewed_at || r.created_at,
            title: `Entrée en bourse de ${r.shops?.name || 'ma boutique'}`,
            sub: `${Number(r.percent_offered).toLocaleString('fr-FR')} % du capital à ${fcfa(r.price_per_share)} la part`,
            amount: null, status: LISTING_STATUS[r.status] || [r.status, 'info'], link: r.status === 'open' ? 'invest.html' : null
        }));
    }

    function fromCourier(rows) {
        return rows.map(r => ({
            type: 'other', icon: 'fa-motorcycle', date: r.reviewed_at || r.created_at,
            title: 'Candidature livreur', sub: `Véhicule : ${r.vehicle_type === 'voiture' ? 'voiture' : 'moto'}`,
            amount: null, status: COURIER_STATUS[r.status] || [r.status, 'info'], link: 'delivery-register.html'
        }));
    }

    // ---------- Affichage ----------
    function summary(items) {
        const sum = type => items.filter(i => i.type === type && i.counts).reduce((s, i) => s + i.amount, 0);
        const monthKey = new Date().toISOString().slice(0, 7);
        return {
            spent: sum('buy'), sold: sum('sale'), invested: sum('invest'),
            thisMonth: items.filter(i => String(i.date).slice(0, 7) === monthKey).length
        };
    }

    function itemHtml(i) {
        const iconClass = { buy: 'buy', sale: 'sale', invest: 'invest' }[i.type] || (i.icon === 'fa-motorcycle' ? 'courier' : 'market');
        const inner = `
            <span class="inv-item-icon ${iconClass}"><i class="fas ${i.icon}"></i></span>
            <div class="inv-item-text"><strong>${esc(i.title)}</strong><small>${I.frDate(i.date)} · ${esc(i.sub)}</small></div>
            <div class="inv-item-side">
                ${i.amount != null ? `<strong class="${i.sign > 0 ? 'inv-pos' : ''}">${i.sign > 0 ? '+' : '−'}${fcfa(i.amount)}</strong>` : ''}
                <span class="inv-badge ${i.status[1]}">${esc(i.status[0])}</span>
            </div>`;
        return `<li class="inv-item">${i.link ? `<a class="inv-item-link" href="${esc(i.link)}" style="display:contents;">${inner}</a>` : inner}</li>`;
    }

    function render() {
        const items = state.items;
        if (!items.length) {
            box().innerHTML = `${state.missing ? I.migrationWarning() : ''}
                <div class="inv-empty"><i class="fas fa-history"></i><h3>Aucune activité pour l'instant</h3>
                <p>Tes commandes, tes ventes, tes investissements et ta candidature livreur apparaîtront ici.</p>
                <a class="btn-submit" href="index.html">Découvrir les boutiques</a></div>`;
            return;
        }
        const s = summary(items);
        const counts = Object.fromEntries(Object.keys(FILTERS).map(k => [k, k === 'all' ? items.length : items.filter(i => i.type === k).length]));
        const shown = items.filter(i => state.filter === 'all' || i.type === state.filter);
        const months = [];
        shown.forEach(i => {
            const k = String(i.date).slice(0, 7);
            if (!months.length || months[months.length - 1].key !== k) months.push({ key: k, items: [] });
            months[months.length - 1].items.push(i);
        });
        box().innerHTML = `
            ${state.missing ? I.migrationWarning() : ''}
            <div class="inv-kpis">
                <div class="inv-kpi blue"><span>Dépensé en achats</span><strong>${fcfa(s.spent)}</strong><small>commandes non annulées</small></div>
                <div class="inv-kpi green"><span>Ventes livrées</span><strong>${fcfa(s.sold)}</strong><small>ma boutique</small></div>
                <div class="inv-kpi"><span>Investi en parts</span><strong>${fcfa(s.invested)}</strong><small>parts payées</small></div>
                <div class="inv-kpi orange"><span>Ce mois-ci</span><strong>${num(s.thisMonth)}</strong><small>activité${s.thisMonth > 1 ? 's' : ''}</small></div>
            </div>
            <div class="inv-box"><h3>Mes 6 derniers mois</h3><div class="inv-chart"><canvas id="actMonths"></canvas></div></div>
            <div class="inv-filters" role="tablist">
                ${Object.entries(FILTERS).filter(([k]) => k === 'all' || counts[k]).map(([k, v]) => `<button class="${state.filter === k ? 'active' : ''}" onclick="actFilter('${k}')">${v} <span>${counts[k]}</span></button>`).join('')}
            </div>
            <div class="inv-box">
                ${months.map(m => `<p class="inv-month">${I.monthLabel(m.key)}</p><ul class="inv-list">${m.items.map(itemHtml).join('')}</ul>`).join('')}
            </div>`;
        drawChart(items);
    }

    // Montants par mois (achats, ventes, investissements) sur les 6 derniers mois
    function lastMonths(items, n = 6, now = new Date()) {
        const keys = [];
        for (let k = n - 1; k >= 0; k--) {
            const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
            keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        const rows = Object.fromEntries(keys.map(k => [k, { buy: 0, sale: 0, invest: 0 }]));
        items.forEach(i => {
            const k = String(i.date).slice(0, 7);
            if (rows[k] && i.counts && rows[k][i.type] != null) rows[k][i.type] += i.amount;
        });
        return { keys, rows };
    }

    function drawChart(items) {
        const { keys, rows } = lastMonths(items);
        const label = k => new Date(k + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'short' });
        I.chart('actMonths', {
            type: 'bar',
            data: {
                labels: keys.map(label),
                datasets: [
                    { label: 'Achats', data: keys.map(k => rows[k].buy), backgroundColor: '#3b82f6', borderRadius: 4 },
                    { label: 'Ventes', data: keys.map(k => rows[k].sale), backgroundColor: '#22c55e', borderRadius: 4 },
                    { label: 'Investissements', data: keys.map(k => rows[k].invest), backgroundColor: '#8b5cf6', borderRadius: 4 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label} : ${I.money(c.parsed.y)}` } } },
                scales: { y: { beginAtZero: true, ticks: { callback: v => Number(v).toLocaleString('fr-FR') } } }
            }
        });
    }

    function actFilter(f) {
        state.filter = FILTERS[f] ? f : 'all';
        render();
    }

    // ---------- Chargement ----------
    async function load() {
        const uid = state.user.id;
        const sb = window.supabase;
        const [orders, sales, shares, listings, courier] = await Promise.all([
            sb.from('orders').select('*, items:order_items(*)').eq('client_id', uid).order('created_at', { ascending: false }),
            sb.rpc('vendor_sales', {}),
            sb.rpc('my_share_orders'),
            sb.from('share_offerings').select('id, status, percent_offered, price_per_share, created_at, reviewed_at, shops(name)').eq('owner_id', uid),
            sb.from('delivery_applications').select('status, vehicle_type, created_at, reviewed_at').eq('user_id', uid)
        ]);
        [orders, sales, shares, listings, courier].forEach((r, n) => { if (r.error) console.warn('⚠️ Activités, source', n, ':', r.error.message); });
        state.missing = I.isMissing(shares.error);
        state.items = [
            ...fromOrders(orders.data || []),
            ...fromSales(sales.data || []),
            ...fromShares(shares.data || []),
            ...fromListings(listings.data || []),
            ...fromCourier(courier.data || [])
        ].filter(i => i.date).sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    async function init() {
        if (!window.supabase?.rpc) {
            box().innerHTML = '<div class="inv-empty"><p>Service indisponible. Recharge la page.</p></div>';
            return;
        }
        state.user = await I.currentUser();
        if (!state.user) { box().innerHTML = I.loginBox('Connecte-toi pour voir tes activités'); return; }
        await load();
        render();
    }

    window.actFilter = actFilter;
    window.OuenzeActivities = { fromOrders, fromSales, fromShares, summary, lastMonths };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
