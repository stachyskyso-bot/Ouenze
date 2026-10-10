// ============================================================
// PORTFOLIO.JS — Mon portefeuille : parts détenues et réservations
//
// Données : my_share_orders() (réservations et achats de l'investisseur connecté).
//   • Parts détenues = réservations PAYÉES, regroupées par boutique.
//   • Valeur actuelle = parts × prix actuel de la part (prix de l'offre).
//     Tant qu'il n'y a pas de revente entre investisseurs, le prix ne bouge pas :
//     la plus-value affichée reste donc à 0, sans chiffre inventé.
//   • Réservations en attente = pas encore payées (annulables).
// ============================================================

(function () {
    'use strict';

    const I = window.OuenzeInvest;
    const { esc, fcfa, num, pct, logoHtml } = I;
    const state = { user: null, orders: [], missing: false };
    const box = () => document.getElementById('portfolioContainer');

    // Regroupe les achats payés par boutique : parts, montant investi, prix moyen, valeur
    function holdings(orders) {
        const byShop = new Map();
        orders.filter(o => o.status === 'paid').forEach(o => {
            const h = byShop.get(o.shop_id) || { shopId: o.shop_id, name: o.shop_name, logo: o.shop_logo, offeringId: o.offering_id, shares: 0, invested: 0, price: 0 };
            h.shares += Number(o.quantity) || 0;
            h.invested += Number(o.amount) || 0;
            h.price = Number(o.current_price) || h.price;
            byShop.set(o.shop_id, h);
        });
        return [...byShop.values()].map(h => {
            const value = h.shares * h.price;
            return { ...h, avgPrice: h.shares ? h.invested / h.shares : 0, value, gain: value - h.invested, ownership: h.shares / I.SHARES_PER_COMPANY };
        }).sort((a, b) => b.value - a.value);
    }

    function totals(list, orders) {
        const invested = list.reduce((s, h) => s + h.invested, 0);
        const value = list.reduce((s, h) => s + h.value, 0);
        const pending = orders.filter(o => o.status === 'requested');
        return {
            invested, value, gain: value - invested,
            shares: list.reduce((s, h) => s + h.shares, 0),
            pendingCount: pending.length,
            pendingAmount: pending.reduce((s, o) => s + (Number(o.amount) || 0), 0)
        };
    }

    function render() {
        const list = holdings(state.orders);
        const t = totals(list, state.orders);
        const pending = state.orders.filter(o => o.status === 'requested');
        if (!state.orders.length) {
            box().innerHTML = `${state.missing ? I.migrationWarning() : ''}
                <div class="inv-empty"><i class="fas fa-wallet"></i>
                    <h3>Ton portefeuille est vide</h3>
                    <p>Réserve des parts d'une boutique vérifiée : elles apparaîtront ici avec leur valeur et ta part du capital.</p>
                    <a class="btn-submit" href="invest.html">Découvrir les boutiques</a></div>`;
            return;
        }
        box().innerHTML = `
            <div class="inv-kpis">
                <div class="inv-kpi blue"><span>Valeur du portefeuille</span><strong>${fcfa(t.value)}</strong><small>${num(t.shares)} parts · ${list.length} boutique${list.length > 1 ? 's' : ''}</small></div>
                <div class="inv-kpi"><span>Capital investi</span><strong>${fcfa(t.invested)}</strong><small>parts payées</small></div>
                <div class="inv-kpi ${t.gain > 0 ? 'green' : t.gain < 0 ? 'red' : ''}"><span>Plus-value</span><strong>${fcfa(t.gain, true)}</strong><small>${t.invested ? pct(t.gain, t.invested) : '—'} · au prix actuel des parts</small></div>
                <div class="inv-kpi orange"><span>Réservations à payer</span><strong>${fcfa(t.pendingAmount)}</strong><small>${t.pendingCount} en attente</small></div>
            </div>
            ${list.length ? `
            <div class="inv-charts">
                <div class="inv-box"><h3>Répartition par boutique</h3><div class="inv-chart"><canvas id="pfAlloc"></canvas></div></div>
                <div class="inv-box"><h3>Capital investi dans le temps</h3><div class="inv-chart"><canvas id="pfTime"></canvas></div></div>
            </div>
            <div class="inv-box">
                <h3>Mes parts</h3>
                <div class="inv-table-wrap"><table class="inv-table">
                    <thead><tr><th>Boutique</th><th>Parts</th><th class="hide-sm">Part du capital</th><th class="hide-sm">Prix moyen</th><th>Valeur</th><th class="hide-sm">Plus-value</th></tr></thead>
                    <tbody>${list.map(h => `<tr>
                        <td><a href="invest.html?offre=${encodeURIComponent(h.offeringId)}" style="display:flex;align-items:center;gap:8px;color:inherit;text-decoration:none;">${logoHtml(h.name, h.logo)}<strong>${esc(h.name)}</strong></a></td>
                        <td>${num(h.shares)}</td>
                        <td class="hide-sm">${(h.ownership * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %</td>
                        <td class="hide-sm">${fcfa(h.avgPrice)}</td>
                        <td><strong>${fcfa(h.value)}</strong></td>
                        <td class="hide-sm ${h.gain > 0 ? 'inv-pos' : h.gain < 0 ? 'inv-neg' : ''}">${fcfa(h.gain, true)}</td>
                    </tr>`).join('')}</tbody>
                </table></div>
                <p class="auth-note">Le prix d'une part est celui de l'offre validée par Ouenze. Il évoluera quand la revente de parts entre investisseurs sera ouverte.</p>
            </div>` : `<div class="inv-box"><p class="inv-none">Aucune part payée pour l'instant : tes réservations apparaissent ci-dessous.</p></div>`}
            ${pending.length ? `
            <div class="inv-box">
                <h3>Réservations en attente de paiement</h3>
                <ul class="inv-list">${pending.map(o => `
                    <li class="inv-item">
                        <span class="inv-item-icon invest"><i class="fas fa-hourglass-half"></i></span>
                        <div class="inv-item-text"><strong>${num(o.quantity)} parts de ${esc(o.shop_name)}</strong>
                            <small>Réservées le ${I.frDate(o.created_at)} · ${fcfa(o.price_per_share)} la part${o.offering_status !== 'open' ? ' · offre fermée' : ''}</small></div>
                        <div class="inv-item-side"><strong>${fcfa(o.amount)}</strong>
                            <button class="inv-link-btn" onclick="pfCancel('${esc(o.order_id)}')">Annuler</button></div>
                    </li>`).join('')}</ul>
                <p class="auth-note">Paiement Mobile Money en ligne bientôt disponible. En attendant, l'équipe Ouenze te contacte pour le règlement.</p>
            </div>` : ''}`;
        if (list.length) drawCharts(list);
    }

    function drawCharts(list) {
        I.chart('pfAlloc', {
            type: 'doughnut',
            data: { labels: list.map(h => h.name), datasets: [{ data: list.map(h => h.value), backgroundColor: I.PALETTE }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${c.label} : ${I.money(c.parsed)}` } } }
            }
        });
        // Capital investi cumulé, à chaque paiement confirmé
        const paid = state.orders.filter(o => o.status === 'paid').sort((a, b) => new Date(a.paid_at || a.created_at) - new Date(b.paid_at || b.created_at));
        let sum = 0;
        const points = paid.map(o => ({ x: I.frDate(o.paid_at || o.created_at), y: (sum += Number(o.amount) || 0) }));
        I.chart('pfTime', {
            type: 'line',
            data: { labels: points.map(p => p.x), datasets: [{ label: 'Capital investi', data: points.map(p => p.y), borderColor: '#1e40af', backgroundColor: 'rgba(30,64,175,0.12)', fill: true, stepped: true, pointRadius: 3 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => I.money(c.parsed.y) } } },
                scales: { y: { beginAtZero: true, ticks: { callback: v => Number(v).toLocaleString('fr-FR') } } }
            }
        });
    }

    async function pfCancel(id) {
        const o = state.orders.find(x => x.order_id === id);
        if (!o || !confirm(`Annuler la réservation de ${num(o.quantity)} parts de ${o.shop_name} ?`)) return;
        const { error } = await window.supabase.rpc('cancel_share_order', { share_order: id });
        if (error) { alert(error.message || 'Annulation impossible.'); return; }
        await load();
        render();
    }

    async function load() {
        const { data, error } = await window.supabase.rpc('my_share_orders');
        state.missing = I.isMissing(error);
        if (error && !state.missing) console.error('❌ Portefeuille :', error);
        state.orders = data || [];
    }

    async function init() {
        if (!window.supabase?.rpc) {
            box().innerHTML = '<div class="inv-empty"><p>Service indisponible. Recharge la page.</p></div>';
            return;
        }
        state.user = await I.currentUser();
        if (!state.user) { box().innerHTML = I.loginBox('Connecte-toi pour voir ton portefeuille'); return; }
        await load();
        render();
    }

    window.pfCancel = pfCancel;
    window.OuenzePortfolio = { holdings, totals };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
