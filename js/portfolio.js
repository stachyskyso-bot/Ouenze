// ============================================================
// PORTFOLIO.JS — Mon portefeuille Trade (portfolio.html), même interface qu'avant
//
// Mes participations aux opérations Trade (trade_list scope « invested »).
//   • Engagé = mes participations dans les opérations en collecte ou en cours.
//   • Part du capital = ma participation / (participants + apport du vendeur).
//   • Résultat affiché = celui de l'OPÉRATION. Ma part de gain ou de perte n'est pas
//     calculée : les règles de répartition sont en cours de validation (simulation).
// ============================================================

(function () {
    'use strict';

    const I = window.OuenzeInvest;
    const { esc, fcfa, num, pct, logoHtml } = I;
    const STATUS = {
        collecting: ['Collecte', 'wait'], running: ['En cours', ''], closed: ['Terminée', 'ok'],
        failed: ['En échec', 'ko'], cancelled: ['Annulée', 'ko'], submitted: ['En vérification', 'wait'], rejected: ['Refusée', 'ko']
    };
    const state = { user: null, ops: [], missing: false };
    const box = () => document.getElementById('portfolioContainer');
    const n = v => Number(v) || 0;

    function rows(ops) {
        return ops.filter(o => n(o.my_pledge) > 0).map(o => {
            const f = o.figures || {};
            const started = ['running', 'closed', 'failed'].includes(o.status);
            const capital = n(f.pledged) + (started ? n(f.vendor_in) : n(o.vendor_contribution));
            return {
                ...o, mine: n(o.my_pledge), share: capital ? n(o.my_pledge) / capital : 0, started,
                result: started ? n(f.sales) - n(f.suppliers_paid) - n(f.expenses) : null
            };
        });
    }

    function totals(list) {
        const live = list.filter(r => ['collecting', 'running'].includes(r.status));
        const done = list.filter(r => ['closed', 'failed'].includes(r.status));
        return {
            engaged: live.reduce((s, r) => s + r.mine, 0),
            liveCount: live.length,
            total: list.reduce((s, r) => s + r.mine, 0),
            doneCount: done.length,
            doneResult: done.reduce((s, r) => s + n(r.result), 0)
        };
    }

    function render() {
        const list = rows(state.ops);
        if (!list.length) {
            box().innerHTML = `${state.missing ? I.migrationWarning() : ''}${I.simulationBanner()}
                <div class="inv-empty"><i class="fas fa-wallet"></i>
                    <h3>Ton portefeuille est vide</h3>
                    <p>Participe à une opération vérifiée par Ouenze : elle apparaîtra ici avec ta part du capital et son suivi.</p>
                    <a class="btn-submit" href="invest.html">Découvrir les opérations</a></div>`;
            return;
        }
        const t = totals(list);
        box().innerHTML = `
            ${I.simulationBanner()}
            <div class="inv-kpis">
                <div class="inv-kpi blue"><span>Engagé en ce moment</span><strong>${fcfa(t.engaged)}</strong><small>${t.liveCount} opération${t.liveCount > 1 ? 's' : ''} en collecte ou en cours</small></div>
                <div class="inv-kpi"><span>Total de mes participations</span><strong>${fcfa(t.total)}</strong><small>${list.length} opération${list.length > 1 ? 's' : ''}</small></div>
                <div class="inv-kpi ${t.doneResult > 0 ? 'green' : t.doneResult < 0 ? 'red' : ''}"><span>Résultat des opérations terminées</span><strong>${fcfa(t.doneResult, true)}</strong><small>${t.doneCount} terminée${t.doneCount > 1 ? 's' : ''} · résultat de l'opération, pas ta part</small></div>
                <div class="inv-kpi orange"><span>Répartition</span><strong>À valider</strong><small>règles de gains et de pertes en cours de validation</small></div>
            </div>
            <div class="inv-charts">
                <div class="inv-box"><h3>Répartition par opération</h3><div class="inv-chart"><canvas id="pfAlloc"></canvas></div></div>
                <div class="inv-box"><h3>Participations dans le temps</h3><div class="inv-chart"><canvas id="pfTime"></canvas></div></div>
            </div>
            <div class="inv-box">
                <h3>Mes opérations</h3>
                <div class="inv-table-wrap"><table class="inv-table">
                    <thead><tr><th>Opération</th><th>Ma participation</th><th class="hide-sm">Part du capital</th><th>Statut</th><th class="hide-sm">Résultat de l'opération</th></tr></thead>
                    <tbody>${list.map(r => {
                        const st = STATUS[r.status] || [r.status, ''];
                        return `<tr>
                        <td><a href="invest.html?op=${encodeURIComponent(r.id)}" style="display:flex;align-items:center;gap:8px;color:inherit;text-decoration:none;">${logoHtml(r.shop_name, r.shop_logo)}<span><strong>${esc(r.title)}</strong><br><small>${esc(r.shop_name)}</small></span></a></td>
                        <td>${fcfa(r.mine)}</td>
                        <td class="hide-sm">${r.started ? (r.share * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %' : '—'}</td>
                        <td><span class="inv-tag ${st[1]}">${esc(st[0])}</span>${r.status === 'running' && r.ends_at ? `<br><small>fin le ${I.frDate(r.ends_at)}</small>` : ''}</td>
                        <td class="hide-sm ${n(r.result) > 0 ? 'inv-pos' : n(r.result) < 0 ? 'inv-neg' : ''}">${r.result == null ? '—' : fcfa(r.result, true)}</td>
                    </tr>`;
                    }).join('')}</tbody>
                </table></div>
                <p class="auth-note">Le résultat affiché est celui de l'opération entière. Ta part de gain ou de perte sera calculée quand les règles de répartition seront validées. Simulation : aucun argent réel.</p>
            </div>`;
        drawCharts(list);
    }

    function drawCharts(list) {
        I.chart('pfAlloc', {
            type: 'doughnut',
            data: { labels: list.map(r => r.title), datasets: [{ data: list.map(r => r.mine), backgroundColor: I.PALETTE }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${c.label} : ${I.money(c.parsed)}` } } }
            }
        });
        const sortedList = [...list].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        let sum = 0;
        const points = sortedList.map(r => ({ x: I.frDate(r.created_at), y: (sum += r.mine) }));
        I.chart('pfTime', {
            type: 'line',
            data: { labels: points.map(p => p.x), datasets: [{ label: 'Participations', data: points.map(p => p.y), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.15)', fill: true, stepped: true, pointRadius: 3 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => I.money(c.parsed.y) } } },
                scales: { y: { beginAtZero: true, ticks: { callback: v => Number(v).toLocaleString('fr-FR') } } }
            }
        });
    }

    async function load() {
        const { data, error } = await window.supabase.rpc('trade_list', { scope: 'invested' });
        state.missing = I.isMissing(error);
        if (error && !state.missing) console.error('❌ Portefeuille :', error);
        state.ops = data || [];
    }

    async function init() {
        if (!window.supabase?.rpc) {
            box().innerHTML = '<div class="inv-empty"><p>Service indisponible. Recharge la page.</p></div>';
            return;
        }
        if (!await I.tradeAccess()) { box().innerHTML = I.comingSoon(); return; }
        state.user = await I.currentUser();
        if (!state.user) { box().innerHTML = I.loginBox('Connecte-toi pour voir ton portefeuille'); return; }
        await load();
        render();
    }

    window.OuenzePortfolio = { rows, totals };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
