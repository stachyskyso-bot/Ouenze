// ============================================================
// ACCOUNTING.JS — Comptabilité du vendeur
//
// Sources (Supabase) :
//   • vendor_sales()   : lignes de commandes Ouenze LIVRÉES des boutiques du vendeur
//   • vendor_entries   : opérations saisies par le vendeur (achats, loyer, ventes en boutique…)
// Chaque opération produit une écriture en partie double (débit = crédit) selon un
// plan SYSCOHADA simplifié : la balance est donc toujours équilibrée.
//
// Le compte de résultat porte sur la période choisie ; la trésorerie et ce qu'Ouenze
// doit au vendeur sont des soldes cumulés jusqu'à la fin de la période.
// Dépendances : supabase-js → supabase-config → database → app → Chart.js
// ============================================================

(function () {
    'use strict';

    const ACCOUNTS = {
        '103': 'Capital personnel (apports)',
        '104': 'Compte de l\'exploitant (retraits)',
        '411': 'Clients — Ouenze (ventes à encaisser)',
        '521': 'Banque / Mobile Money',
        '571': 'Caisse',
        '601': 'Achats de marchandises',
        '605': 'Fournitures et emballages',
        '618': 'Transport',
        '622': 'Loyer',
        '627': 'Publicité',
        '628': 'Téléphone et internet',
        '631': 'Frais bancaires et Mobile Money',
        '641': 'Impôts et taxes',
        '658': 'Autres charges',
        '661': 'Salaires',
        '701': 'Ventes de marchandises'
    };

    // Type d'opération → compte débité / crédité (« PAY » = caisse ou Mobile Money choisi)
    const KINDS = {
        sale_store:    { label: 'Vente hors Ouenze (boutique, téléphone…)', group: 'in',  debit: 'PAY', credit: '701' },
        payout:        { label: 'Versement reçu d\'Ouenze',                group: 'in',  debit: 'PAY', credit: '411' },
        contribution:  { label: 'Apport personnel (argent de départ…)',     group: 'in',  debit: 'PAY', credit: '103' },
        purchase:      { label: 'Achat de marchandises à revendre',         group: 'out', debit: '601', credit: 'PAY' },
        supplies:      { label: 'Fournitures, emballages',                  group: 'out', debit: '605', credit: 'PAY' },
        transport:     { label: 'Transport, carburant',                     group: 'out', debit: '618', credit: 'PAY' },
        rent:          { label: 'Loyer',                                    group: 'out', debit: '622', credit: 'PAY' },
        ads:           { label: 'Publicité',                                group: 'out', debit: '627', credit: 'PAY' },
        telecom:       { label: 'Téléphone, internet',                      group: 'out', debit: '628', credit: 'PAY' },
        fees:          { label: 'Frais bancaires / Mobile Money',           group: 'out', debit: '631', credit: 'PAY' },
        taxes:         { label: 'Impôts et taxes',                          group: 'out', debit: '641', credit: 'PAY' },
        salaries:      { label: 'Salaires',                                 group: 'out', debit: '661', credit: 'PAY' },
        other_expense: { label: 'Autre dépense',                            group: 'out', debit: '658', credit: 'PAY' },
        withdrawal:    { label: 'Retrait personnel',                        group: 'out', debit: '104', credit: 'PAY' }
    };
    const PAY_LABELS = { '521': 'Mobile Money / banque', '571': 'Espèces (caisse)' };

    const PERIODS = {
        month: 'Ce mois-ci',
        last_month: 'Mois dernier',
        quarter: '3 derniers mois',
        year: 'Cette année',
        all: 'Depuis le début'
    };

    const state = {
        user: null,
        shops: [],
        sales: [],      // lignes vendor_sales()
        entries: [],    // lignes vendor_entries
        shopId: 'all',
        period: 'month',
        tab: 'dashboard',
        tableMissing: false
    };
    const charts = {};

    // ============ UTILITAIRES ============
    const box = () => document.getElementById('accountingApp');

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function fcfa(n, signed) {
        const v = Math.round(Number(n) || 0);
        return (signed && v > 0 ? '+' : '') + v.toLocaleString('fr-FR') + ' FCFA';
    }

    function isoDate(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function frDate(iso) {
        const [y, m, d] = String(iso).slice(0, 10).split('-');
        return `${d}/${m}/${y}`;
    }

    // Bornes [début, fin] de la période, en dates « AAAA-MM-JJ » (début null = depuis toujours)
    function periodRange(period, now = new Date()) {
        const y = now.getFullYear(), m = now.getMonth();
        const last = (yy, mm) => new Date(yy, mm + 1, 0);
        switch (period) {
            case 'last_month': return { from: isoDate(new Date(y, m - 1, 1)), to: isoDate(last(y, m - 1)) };
            case 'quarter': return { from: isoDate(new Date(y, m - 2, 1)), to: isoDate(last(y, m)) };
            case 'year': return { from: `${y}-01-01`, to: `${y}-12-31` };
            case 'all': return { from: null, to: isoDate(last(y, m)) };
            default: return { from: isoDate(new Date(y, m, 1)), to: isoDate(last(y, m)) };
        }
    }

    // ============ OPÉRATIONS → ÉCRITURES ============
    // Une vente Ouenze = une commande livrée (toutes les lignes de la boutique regroupées)
    function salesOperations(sales) {
        const byOrder = new Map();
        sales.forEach(l => {
            const key = l.order_id + '|' + l.shop_id;
            if (!byOrder.has(key)) {
                byOrder.set(key, { id: key, source: 'ouenze', date: String(l.sold_at).slice(0, 10), shopId: l.shop_id, amount: 0, items: [] });
            }
            const op = byOrder.get(key);
            const qty = Number(l.quantity) || 0;
            op.amount += qty * (Number(l.unit_price) || 0);
            op.items.push(`${l.product_name} ×${qty}`);
        });
        return [...byOrder.values()].map(op => ({
            ...op,
            kind: 'ouenze_sale',
            label: `Vente Ouenze n° ${String(op.id).slice(0, 8)} — ${op.items.join(', ')}`,
            lines: [{ account: '411', debit: op.amount, credit: 0 }, { account: '701', debit: 0, credit: op.amount }]
        }));
    }

    function manualOperations(entries) {
        return entries.map(e => {
            const k = KINDS[e.kind];
            if (!k) return null;
            const amount = Number(e.amount) || 0;
            const acc = a => (a === 'PAY' ? e.pay_account : a);
            return {
                id: e.id, source: 'manual', kind: e.kind, date: e.entry_date, shopId: e.shop_id, amount,
                payAccount: e.pay_account,
                label: e.label ? `${k.label.split(' (')[0]} — ${e.label}` : k.label,
                lines: [{ account: acc(k.debit), debit: amount, credit: 0 }, { account: acc(k.credit), debit: 0, credit: amount }]
            };
        }).filter(Boolean);
    }

    // Toutes les opérations de la boutique choisie jusqu'à la fin de la période (les soldes en ont besoin)
    function operationsUntil(to) {
        const ops = [...salesOperations(state.sales), ...manualOperations(state.entries)]
            .filter(op => state.shopId === 'all' || op.shopId === state.shopId)
            .filter(op => !to || op.date <= to);
        return ops.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }

    function inPeriod(ops, range) {
        return ops.filter(op => (!range.from || op.date >= range.from) && op.date <= range.to);
    }

    function balanceOf(ops) {
        const accounts = {};
        ops.forEach(op => op.lines.forEach(l => {
            const a = accounts[l.account] || (accounts[l.account] = { debit: 0, credit: 0 });
            a.debit += l.debit;
            a.credit += l.credit;
        }));
        return accounts;
    }

    function resultOf(ops) {
        const bal = balanceOf(ops);
        const net = acc => (bal[acc] ? bal[acc].debit - bal[acc].credit : 0);
        const charges = Object.keys(ACCOUNTS).filter(a => a.startsWith('6'))
            .map(a => ({ account: a, amount: net(a) })).filter(c => c.amount !== 0);
        const sales = -net('701');
        const totalCharges = charges.reduce((s, c) => s + c.amount, 0);
        return {
            sales,
            ouenzeSales: ops.filter(o => o.kind === 'ouenze_sale').reduce((s, o) => s + o.amount, 0),
            purchases: net('601'),
            margin: sales - net('601'),
            charges,
            totalCharges,
            result: sales - totalCharges
        };
    }

    // ============ ÉCRANS ============
    function destroyCharts() {
        Object.keys(charts).forEach(k => { charts[k]?.destroy(); delete charts[k]; });
    }

    function render() {
        destroyCharts();
        const range = periodRange(state.period);
        const all = operationsUntil(range.to);
        const ops = inPeriod(all, range);
        const tabs = { dashboard: 'Tableau de bord', journal: 'Opérations', cpc: 'Compte de résultat', balance: 'Balance' };
        box().innerHTML = `
            ${state.tableMissing ? `<div class="acc-warning"><i class="fas fa-database"></i> La base de données n'est pas encore à jour : exécute le fichier <code>supabase/migrations/20261013_vendor_accounting.sql</code> dans Supabase → SQL Editor. En attendant, rien ne peut être enregistré.</div>` : ''}
            <div class="acc-toolbar">
                ${state.shops.length > 1 ? `<select id="accShop" aria-label="Boutique" onchange="accSetShop(this.value)">
                    <option value="all">Toutes mes boutiques</option>
                    ${state.shops.map(s => `<option value="${esc(s.id)}" ${state.shopId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
                </select>` : `<span class="acc-shop-name"><i class="fas fa-store"></i> ${esc(state.shops[0]?.name || '')}</span>`}
                <select id="accPeriod" aria-label="Période" onchange="accSetPeriod(this.value)">
                    ${Object.entries(PERIODS).map(([k, v]) => `<option value="${k}" ${state.period === k ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
                <button class="acc-add" onclick="accOpenEntry()" ${state.tableMissing ? 'disabled' : ''}><i class="fas fa-plus"></i> Ajouter une opération</button>
            </div>
            <div class="acc-tabs" role="tablist">
                ${Object.entries(tabs).map(([k, v]) => `<button role="tab" class="${state.tab === k ? 'active' : ''}" onclick="accSetTab('${k}')">${v}</button>`).join('')}
            </div>
            <div id="accView">${{ dashboard: dashboardHtml, journal: journalHtml, cpc: cpcHtml, balance: balanceHtml }[state.tab](ops, all, range)}</div>`;
        if (state.tab === 'dashboard') drawCharts(ops, range);
    }

    function kpi(label, value, note, cls = '') {
        return `<div class="acc-kpi ${cls}"><span>${label}</span><strong>${value}</strong>${note ? `<small>${note}</small>` : ''}</div>`;
    }

    function dashboardHtml(ops, all) {
        const r = resultOf(ops);
        const bal = balanceOf(all);
        const solde = acc => (bal[acc] ? bal[acc].debit - bal[acc].credit : 0);
        const cash = solde('521') + solde('571');
        const owed = solde('411');
        if (!all.length) {
            return `<div class="acc-empty">
                <i class="fas fa-book-open"></i>
                <h3>Ta comptabilité est prête</h3>
                <p>Chaque commande Ouenze <strong>livrée</strong> s'enregistre ici automatiquement.<br>
                Ajoute aussi ce qu'Ouenze ne voit pas : achats de marchandises, loyer, transport, ventes en boutique…</p>
                <p class="acc-tip">Commence par un <strong>apport personnel</strong> : l'argent avec lequel tu démarres (caisse ou Mobile Money).</p>
                <button class="btn-submit" onclick="accOpenEntry('contribution')" ${state.tableMissing ? 'disabled' : ''}><i class="fas fa-plus"></i> Première opération</button>
            </div>`;
        }
        return `
            <div class="acc-kpis">
                ${kpi('Chiffre d\'affaires', fcfa(r.sales), r.ouenzeSales ? `dont ${fcfa(r.ouenzeSales)} via Ouenze` : 'ventes de la période', 'blue')}
                ${kpi('Charges', fcfa(r.totalCharges), r.purchases ? `dont achats ${fcfa(r.purchases)}` : 'dépenses de la période', 'orange')}
                ${kpi('Résultat', fcfa(r.result, true), r.result >= 0 ? 'Bénéfice' : 'Perte', r.result >= 0 ? 'green' : 'red')}
                ${kpi('Trésorerie', fcfa(cash), `caisse ${fcfa(solde('571'))} · Mobile Money ${fcfa(solde('521'))}`, cash < 0 ? 'red' : '')}
                ${kpi('À recevoir d\'Ouenze', fcfa(owed), 'ventes livrées pas encore versées')}
            </div>
            ${cash < 0 ? `<p class="acc-hint"><i class="fas fa-info-circle"></i> Trésorerie négative : tu as noté plus de dépenses que d'entrées. Ajoute ton <strong>apport personnel</strong> de départ ou les <strong>versements reçus d'Ouenze</strong>.</p>` : ''}
            <div class="acc-charts">
                <div class="acc-card wide"><h3>Ventes, charges et résultat cumulé</h3><div class="acc-chart"><canvas id="accFlow"></canvas></div></div>
                <div class="acc-card"><h3>Répartition des charges</h3>${r.charges.length ? '<div class="acc-chart"><canvas id="accCharges"></canvas></div>' : '<p class="acc-none">Aucune charge sur la période.</p>'}</div>
                <div class="acc-card"><h3>Produits les plus vendus (Ouenze)</h3>${state.sales.length ? '<div class="acc-chart"><canvas id="accTop"></canvas></div>' : '<p class="acc-none">Aucune vente Ouenze livrée pour l\'instant.</p>'}</div>
            </div>`;
    }

    // Regroupement par jour (période ≤ 31 jours) ou par mois, arrêté à aujourd'hui
    function buckets(ops, range) {
        const last = range.to < isoDate(new Date()) ? range.to : isoDate(new Date());
        const first = range.from || (ops[0]?.date ?? last);
        const days = (new Date(last) - new Date(first)) / 86400000;
        const byDay = days <= 31;
        const keys = [];
        const d = new Date(first + 'T00:00:00');
        const end = new Date(last + 'T00:00:00');
        while (d <= end && keys.length < 400) {
            keys.push(byDay ? isoDate(d) : isoDate(d).slice(0, 7));
            if (byDay) d.setDate(d.getDate() + 1); else d.setMonth(d.getMonth() + 1, 1);
        }
        const uniq = [...new Set(keys)];
        const data = Object.fromEntries(uniq.map(k => [k, { sales: 0, charges: 0 }]));
        ops.forEach(op => {
            const k = byDay ? op.date : op.date.slice(0, 7);
            if (!data[k]) return;
            op.lines.forEach(l => {
                if (l.account === '701') data[k].sales += l.credit - l.debit;
                if (l.account.startsWith('6')) data[k].charges += l.debit - l.credit;
            });
        });
        const label = k => byDay
            ? new Date(k + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
            : new Date(k + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
        return { labels: uniq.map(label), rows: uniq.map(k => data[k]) };
    }

    // Le résultat cumulé finit exactement sur le résultat de la période
    function cumulative(rows) {
        let sum = 0;
        return rows.map(r => (sum += r.sales - r.charges));
    }

    function drawCharts(ops, range) {
        if (!window.Chart) {
            document.querySelectorAll('.acc-chart').forEach(c => { c.innerHTML = '<p class="acc-none">Graphique indisponible (pas de connexion).</p>'; });
            return;
        }
        const money = v => Math.round(v).toLocaleString('fr-FR') + ' FCFA';
        const tooltip = { callbacks: { label: c => `${c.dataset.label || c.label} : ${money(c.parsed.y ?? c.parsed.x ?? c.parsed)}` } };
        const flow = document.getElementById('accFlow');
        if (flow) {
            const b = buckets(ops, range);
            charts.flow = new Chart(flow, {
                data: {
                    labels: b.labels,
                    datasets: [
                        { type: 'bar', label: 'Ventes', data: b.rows.map(r => r.sales), backgroundColor: '#1e40af', borderRadius: 4, order: 2 },
                        { type: 'bar', label: 'Charges', data: b.rows.map(r => r.charges), backgroundColor: '#f59e0b', borderRadius: 4, order: 2 },
                        { type: 'line', label: 'Résultat cumulé', data: cumulative(b.rows), borderColor: '#10b981', backgroundColor: '#10b981', cubicInterpolationMode: 'monotone', pointRadius: 2, order: 1 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { position: 'bottom' }, tooltip },
                    scales: { y: { ticks: { callback: v => Number(v).toLocaleString('fr-FR') } } }
                }
            });
        }
        const r = resultOf(ops);
        const chargesCanvas = document.getElementById('accCharges');
        if (chargesCanvas) {
            const palette = ['#1e40af', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#0ea5e9', '#f97316', '#64748b', '#14b8a6', '#eab308'];
            charts.charges = new Chart(chargesCanvas, {
                type: 'doughnut',
                data: {
                    labels: r.charges.map(c => ACCOUNTS[c.account]),
                    datasets: [{ data: r.charges.map(c => c.amount), backgroundColor: palette }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${c.label} : ${money(c.parsed)}` } } }
                }
            });
        }
        const topCanvas = document.getElementById('accTop');
        if (topCanvas) {
            const totals = {};
            state.sales
                .filter(l => state.shopId === 'all' || l.shop_id === state.shopId)
                .filter(l => { const d = String(l.sold_at).slice(0, 10); return (!range.from || d >= range.from) && d <= range.to; })
                .forEach(l => { totals[l.product_name] = (totals[l.product_name] || 0) + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0); });
            const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 6);
            if (!top.length) { topCanvas.parentElement.outerHTML = '<p class="acc-none">Aucune vente Ouenze sur la période.</p>'; return; }
            charts.top = new Chart(topCanvas, {
                type: 'bar',
                data: { labels: top.map(t => t[0]), datasets: [{ label: 'Ventes', data: top.map(t => t[1]), backgroundColor: '#1e40af', borderRadius: 4 }] },
                options: {
                    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => money(c.parsed.x) } } },
                    scales: { x: { ticks: { callback: v => Number(v).toLocaleString('fr-FR') } } }
                }
            });
        }
    }

    function journalHtml(ops, all, range) {
        if (!ops.length) return `<div class="acc-empty small"><p>Aucune opération sur la période « ${PERIODS[state.period]} ».</p></div>`;
        return `
            <div class="acc-section-head">
                <p>${ops.length} opération${ops.length > 1 ? 's' : ''} · chaque opération = une écriture équilibrée (débit = crédit)</p>
                <button class="acc-link" onclick="accExport()"><i class="fas fa-download"></i> Exporter (CSV)</button>
            </div>
            <div class="acc-ops">
                ${[...ops].reverse().map(op => {
                    const k = KINDS[op.kind];
                    const income = op.kind === 'ouenze_sale' || k?.group === 'in';
                    return `
                    <div class="acc-op">
                        <div class="acc-op-main">
                            <span class="acc-op-icon ${income ? 'in' : 'out'}"><i class="fas ${op.kind === 'ouenze_sale' ? 'fa-shopping-bag' : income ? 'fa-arrow-down' : 'fa-arrow-up'}"></i></span>
                            <div class="acc-op-text">
                                <strong>${esc(op.label)}</strong>
                                <small>${frDate(op.date)} · ${op.source === 'ouenze' ? '<span class="acc-badge auto">Automatique</span>' : `<span class="acc-badge">Saisie</span> ${esc(PAY_LABELS[op.payAccount] || '')}`}</small>
                            </div>
                            <span class="acc-op-amount ${income ? 'in' : 'out'}">${income ? '+' : '−'}${fcfa(op.amount)}</span>
                            ${op.source === 'manual' ? `<button class="acc-del" onclick="accDelete('${esc(op.id)}')" aria-label="Supprimer"><i class="fas fa-trash"></i></button>` : ''}
                        </div>
                        <div class="acc-op-lines">
                            ${op.lines.map(l => `<span>${l.debit ? 'Débit' : 'Crédit'} ${l.account} ${esc(ACCOUNTS[l.account])}</span>`).join('')}
                        </div>
                    </div>`;
                }).join('')}
            </div>`;
    }

    function cpcHtml(ops) {
        const r = resultOf(ops);
        const pct = v => (r.sales ? ` <small>(${Math.round(v / r.sales * 100)} %)</small>` : '');
        return `
            <div class="acc-cpc">
                <div class="acc-card">
                    <h3>Produits</h3>
                    <div class="acc-row"><span>701 Ventes de marchandises</span><strong>${fcfa(r.sales)}</strong></div>
                    ${r.ouenzeSales ? `<div class="acc-row sub"><span>dont ventes Ouenze livrées</span><span>${fcfa(r.ouenzeSales)}</span></div>
                    <div class="acc-row sub"><span>dont ventes hors Ouenze</span><span>${fcfa(r.sales - r.ouenzeSales)}</span></div>` : ''}
                    <div class="acc-row total"><span>Total produits</span><strong>${fcfa(r.sales)}</strong></div>
                </div>
                <div class="acc-card">
                    <h3>Charges</h3>
                    ${r.charges.length ? r.charges.map(c => `<div class="acc-row"><span>${c.account} ${esc(ACCOUNTS[c.account])}</span><strong>${fcfa(c.amount)}${pct(c.amount)}</strong></div>`).join('') : '<p class="acc-none">Aucune charge.</p>'}
                    <div class="acc-row total"><span>Total charges</span><strong>${fcfa(r.totalCharges)}</strong></div>
                </div>
            </div>
            <div class="acc-card acc-result">
                <div class="acc-row"><span>Marge commerciale <small>(ventes − achats de marchandises)</small></span><strong>${fcfa(r.margin, true)}</strong></div>
                <div class="acc-row total big ${r.result >= 0 ? 'green' : 'red'}"><span>Résultat net — ${r.result >= 0 ? 'bénéfice' : 'perte'}</span><strong>${fcfa(r.result, true)}</strong></div>
                <p class="acc-note">Période : ${PERIODS[state.period]}. Les frais de livraison sont payés par le client : ils n'apparaissent pas dans tes comptes.</p>
            </div>`;
    }

    function balanceHtml(ops, all) {
        const bal = balanceOf(all);
        const rows = Object.keys(bal).sort().map(a => ({ account: a, ...bal[a], solde: bal[a].debit - bal[a].credit }));
        const tD = rows.reduce((s, r) => s + r.debit, 0);
        const tC = rows.reduce((s, r) => s + r.credit, 0);
        if (!rows.length) return '<div class="acc-empty small"><p>Aucune écriture pour l\'instant.</p></div>';
        return `
            <p class="acc-note">Soldes cumulés depuis le début jusqu'au ${frDate(periodRange(state.period).to)}.</p>
            <div class="acc-table-wrap">
                <table class="acc-table">
                    <thead><tr><th>Compte</th><th>Débit</th><th>Crédit</th><th>Solde</th></tr></thead>
                    <tbody>
                        ${rows.map(r => `<tr>
                            <td><strong>${r.account}</strong> ${esc(ACCOUNTS[r.account] || '')}</td>
                            <td>${r.debit ? Math.round(r.debit).toLocaleString('fr-FR') : '–'}</td>
                            <td>${r.credit ? Math.round(r.credit).toLocaleString('fr-FR') : '–'}</td>
                            <td class="${r.solde >= 0 ? '' : 'neg'}">${Math.round(Math.abs(r.solde)).toLocaleString('fr-FR')} ${r.solde > 0 ? 'D' : r.solde < 0 ? 'C' : ''}</td>
                        </tr>`).join('')}
                    </tbody>
                    <tfoot><tr><td>Totaux</td><td>${Math.round(tD).toLocaleString('fr-FR')}</td><td>${Math.round(tC).toLocaleString('fr-FR')}</td>
                        <td>${Math.round(tD) === Math.round(tC) ? '<span class="acc-ok"><i class="fas fa-check"></i> Équilibrée</span>' : '<span class="neg">Écart</span>'}</td></tr></tfoot>
                </table>
            </div>
            <p class="acc-note">D = solde débiteur (ce que tu possèdes ou dépenses) · C = solde créditeur (ce que tu as gagné ou apporté).</p>`;
    }

    // ============ SAISIE ============
    function accOpenEntry(kind) {
        const today = isoDate(new Date());
        const opts = group => Object.entries(KINDS).filter(([, k]) => k.group === group)
            .map(([id, k]) => `<option value="${id}" ${kind === id ? 'selected' : ''}>${k.label}</option>`).join('');
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-card">
                <button class="modal-close" onclick="this.closest('.modal').remove()" aria-label="Fermer">&times;</button>
                <h3 style="margin-bottom:14px;">Nouvelle opération</h3>
                <div class="form-group"><label for="accKind">Type *</label>
                    <select id="accKind" onchange="accPreview()">
                        <optgroup label="Entrées d'argent">${opts('in')}</optgroup>
                        <optgroup label="Sorties d'argent">${opts('out')}</optgroup>
                    </select></div>
                <div class="form-row-2">
                    <div class="form-group"><label for="accAmount">Montant (FCFA) *</label><input type="number" id="accAmount" inputmode="numeric" min="1" step="1" placeholder="0" oninput="accPreview()"></div>
                    <div class="form-group"><label for="accDate">Date *</label><input type="date" id="accDate" value="${today}" max="${today}"></div>
                </div>
                <div class="form-group"><label>Payé / encaissé en *</label>
                    <div class="acc-pay">
                        <label><input type="radio" name="accPay" value="521" checked onchange="accPreview()"><span><i class="fas fa-mobile-alt"></i> Mobile Money / banque</span></label>
                        <label><input type="radio" name="accPay" value="571" onchange="accPreview()"><span><i class="fas fa-money-bill-wave"></i> Espèces</span></label>
                    </div></div>
                ${state.shops.length > 1 ? `<div class="form-group"><label for="accEntryShop">Boutique</label><select id="accEntryShop">
                    ${state.shops.map(s => `<option value="${esc(s.id)}" ${state.shopId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>` : ''}
                <div class="form-group"><label for="accLabel">Détail <small>(facultatif)</small></label><input type="text" id="accLabel" maxlength="200" placeholder="Ex : 20 coques iPhone chez le grossiste"></div>
                <p class="acc-preview" id="accPreview"></p>
                <div class="form-error" id="accError" role="alert"></div>
                <button class="btn-submit" id="accSave" onclick="accSave()">Enregistrer</button>
            </div>`;
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);
        accPreview();
        document.getElementById('accAmount').focus();
    }

    // Montre l'écriture qui sera passée : le vendeur voit ce que fait la comptabilité
    function accPreview() {
        const k = KINDS[document.getElementById('accKind')?.value];
        const pay = document.querySelector('input[name="accPay"]:checked')?.value || '521';
        const amount = Math.round(Number(document.getElementById('accAmount')?.value) || 0);
        const el = document.getElementById('accPreview');
        if (!k || !el) return;
        const acc = a => (a === 'PAY' ? pay : a);
        el.innerHTML = `<i class="fas fa-book"></i> Écriture : <strong>Débit ${acc(k.debit)}</strong> ${esc(ACCOUNTS[acc(k.debit)])} / <strong>Crédit ${acc(k.credit)}</strong> ${esc(ACCOUNTS[acc(k.credit)])}${amount ? ` — ${fcfa(amount)}` : ''}`;
    }

    async function accSave() {
        const err = msg => { const e = document.getElementById('accError'); e.textContent = msg; e.style.display = 'block'; };
        const kind = document.getElementById('accKind').value;
        const amount = Math.round(Number(document.getElementById('accAmount').value));
        const date = document.getElementById('accDate').value;
        const pay = document.querySelector('input[name="accPay"]:checked')?.value || '521';
        const shopId = document.getElementById('accEntryShop')?.value || state.shops[0]?.id || null;
        const label = document.getElementById('accLabel').value.trim();
        if (!KINDS[kind]) return err('Choisis un type d\'opération.');
        if (!amount || amount <= 0) return err('Indique un montant supérieur à 0.');
        if (!date || date > isoDate(new Date())) return err('Indique une date (pas dans le futur).');
        const btn = document.getElementById('accSave');
        btn.disabled = true;
        btn.textContent = 'Enregistrement…';
        const { data, error } = await window.supabase.from('vendor_entries')
            .insert([{ kind, amount, entry_date: date, pay_account: pay, shop_id: shopId, label: label || null }])
            .select().single();
        if (error) {
            btn.disabled = false;
            btn.textContent = 'Enregistrer';
            console.error('❌ Écriture :', error);
            return err('Enregistrement impossible : ' + (error.message || 'réessaie.'));
        }
        state.entries.push(data);
        document.querySelector('.modal.active')?.remove();
        render();
    }

    async function accDelete(id) {
        const op = state.entries.find(e => e.id === id);
        if (!op || !confirm(`Supprimer cette opération de ${fcfa(op.amount)} ?`)) return;
        const { error } = await window.supabase.from('vendor_entries').delete().eq('id', id);
        if (error) { alert('Suppression impossible : ' + error.message); return; }
        state.entries = state.entries.filter(e => e.id !== id);
        render();
    }

    function accExport() {
        const range = periodRange(state.period);
        const ops = inPeriod(operationsUntil(range.to), range);
        const q = v => `"${String(v).replace(/"/g, '""')}"`;
        const rows = [['Date', 'Compte', 'Intitulé du compte', 'Libellé', 'Débit', 'Crédit'].map(q).join(';')];
        ops.forEach(op => op.lines.forEach(l => rows.push([frDate(op.date), l.account, ACCOUNTS[l.account], op.label, l.debit || '', l.credit || ''].map(q).join(';'))));
        const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ouenze_journal_${range.from || 'debut'}_${range.to}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    // ============ NAVIGATION ============
    function accSetTab(t) { state.tab = t; render(); }
    function accSetPeriod(p) { state.period = PERIODS[p] ? p : 'month'; render(); }
    function accSetShop(id) { state.shopId = id; render(); }

    // ============ DÉMARRAGE ============
    async function load() {
        const [shopsRes, salesRes, entriesRes] = await Promise.all([
            window.supabase.from('shops').select('id, name').eq('owner_id', state.user.id).is('archived_at', null),
            window.supabase.rpc('vendor_sales', {}),
            window.supabase.from('vendor_entries').select('*').order('entry_date')
        ]);
        state.shops = shopsRes.data || [];
        // Base sans colonne archived_at (migration 20261012 pas encore passée)
        if (shopsRes.error) {
            const retry = await window.supabase.from('shops').select('id, name').eq('owner_id', state.user.id);
            state.shops = retry.data || [];
        }
        state.sales = salesRes.error ? [] : (salesRes.data || []);
        if (salesRes.error) console.warn('⚠️ vendor_sales :', salesRes.error.message);
        state.tableMissing = !!entriesRes.error;
        state.entries = entriesRes.error ? [] : (entriesRes.data || []);
        if (entriesRes.error) console.warn('⚠️ vendor_entries :', entriesRes.error.message);
    }

    async function init() {
        if (!window.supabase?.auth) {
            box().innerHTML = '<div class="acc-empty"><p>Service indisponible. Recharge la page.</p></div>';
            return;
        }
        const { data } = await window.supabase.auth.getSession();
        state.user = data?.session?.user || null;
        if (!state.user) {
            box().innerHTML = `<div class="acc-empty"><i class="fas fa-user-lock"></i><h3>Connecte-toi pour voir ta comptabilité</h3>
                <button class="btn-submit" onclick="openLoginModal()">Se connecter</button></div>`;
            window.supabase.auth.onAuthStateChange(e => { if (e === 'SIGNED_IN') location.reload(); });
            return;
        }
        await load();
        if (!state.shops.length) {
            box().innerHTML = `<div class="acc-empty"><i class="fas fa-store"></i><h3>Pas encore de boutique</h3>
                <p>La comptabilité suit les ventes de ta boutique. Crée-la d'abord.</p>
                <a class="btn-submit" href="shop-designer.html">Créer ma boutique</a></div>`;
            return;
        }
        render();
    }

    Object.assign(window, { accSetTab, accSetPeriod, accSetShop, accOpenEntry, accPreview, accSave, accDelete, accExport });
    // Fonctions pures exposées pour les tests
    window.OuenzeAccounting = { periodRange, salesOperations, manualOperations, balanceOf, resultOf, KINDS, ACCOUNTS };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
