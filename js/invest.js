// ============================================================
// INVEST.JS — Ouenze Trade (invest.html), même interface que l'ancienne page Investir
//
// Le concept change : on ne vend plus de parts de boutique. On participe à une
// OPÉRATION commerciale précise de 45 jours, proposée par un vendeur qui apporte
// aussi une partie des fonds. Ouenze paie directement les fournisseurs et vérifie
// chaque dépense et chaque vente (justificatifs). Résultat : gain ou perte.
//
// SIMULATION : aucun argent réel. Les règles de répartition des gains et des pertes,
// le fonds de garantie et la garde des fonds ne sont pas codés (en cours de validation).
// Données : trade_list / trade_detail / trade_pledge (migration 20261031).
// Proposer une opération et outils de l'équipe : trade.html.
// ============================================================

(function () {
    'use strict';

    const I = window.OuenzeInvest;
    const { esc, fcfa, num, pct, logoHtml } = I;
    const STATUS = {
        submitted: ['En vérification', 'wait'], collecting: ['Collecte ouverte', ''], running: ['En cours', ''],
        closed: ['Terminée', 'ok'], failed: ['En échec', 'ko'], cancelled: ['Annulée', 'ko'], rejected: ['Refusée', 'ko']
    };
    const KIND = { vendor_contribution: 'Apport du vendeur', supplier_payment: 'Fournisseur payé par Ouenze', expense: 'Dépense', sale: 'Vente', note: 'Étape' };
    const state = { user: null, role: null, hasShop: false, ops: [], missing: false, search: '', sort: 'ending' };
    const box = () => document.getElementById('investContainer');
    const n = v => Number(v) || 0;
    const daysLeft = d => Math.max(0, Math.ceil((new Date(d) - Date.now()) / 86400000));

    function sorted(list) {
        const q = state.search.trim().toLowerCase();
        const left = o => n(o.goal_amount) - n(o.figures?.pledged);
        const by = {
            ending: (a, b) => (a.status === 'collecting' ? 0 : 1) - (b.status === 'collecting' ? 0 : 1)
                || new Date(a.collect_ends_at || a.ends_at || 0) - new Date(b.collect_ends_at || b.ends_at || 0),
            remaining: (a, b) => left(b) - left(a),
            contribution: (a, b) => n(b.vendor_contribution) / (n(b.vendor_contribution) + n(b.goal_amount)) - n(a.vendor_contribution) / (n(a.vendor_contribution) + n(a.goal_amount)),
            recent: (a, b) => new Date(b.created_at) - new Date(a.created_at)
        }[state.sort];
        return list.filter(o => !q || `${o.title} ${o.shop_name} ${o.shop_city || ''}`.toLowerCase().includes(q)).sort(by);
    }

    function render() {
        const list = sorted(state.ops);
        box().innerHTML = `
            ${state.missing ? I.migrationWarning() : ''}
            ${I.simulationBanner()}
            <section class="inv-hero">
                <h2>Participe aux opérations des boutiques</h2>
                <p>Finance une opération commerciale précise de 45 jours, vérifiée par Ouenze : un achat de marchandises pour les revendre. Tu n'achètes pas de part de la boutique.</p>
                <div class="inv-steps">
                    <div><b>1</b>Le vendeur présente son opération (achats, fournisseurs, ventes prévues) et apporte lui-même une partie des fonds.</div>
                    <div><b>2</b>Ouenze paie directement les fournisseurs et vérifie chaque dépense et chaque vente sur justificatif.</div>
                    <div><b>3</b>Au bout de 45 jours, le résultat de l'opération est publié : il peut être un gain ou une perte.</div>
                </div>
            </section>
            ${state.ops.length ? tickerHtml() : ''}
            <p class="inv-risk"><i class="fas fa-exclamation-triangle"></i> Participer à une opération comporte un risque de perte de tout ou partie de ta participation. Le résultat n'est pas garanti et l'argent reste engagé pendant les 45 jours. Ne participe qu'avec de l'argent dont tu n'as pas besoin.</p>
            ${state.hasShop || state.role ? `<div class="inv-actions-row">
                ${state.hasShop ? '<a class="btn-submit" href="trade.html?new=1"><i class="fas fa-plus"></i> Proposer une opération</a>' : ''}
                ${state.role === 'admin' ? '<a class="btn-cancel" href="trade.html"><i class="fas fa-user-shield"></i> Gérer les opérations</a>' : ''}</div>` : ''}
            ${state.ops.length ? `
                <div class="inv-toolbar">
                    <input type="search" id="invSearch" placeholder="Rechercher une opération, une boutique ou une ville" value="${esc(state.search)}" oninput="invSearch(this.value)" aria-label="Rechercher">
                    <select onchange="invSort(this.value)" aria-label="Trier">
                        <option value="ending" ${state.sort === 'ending' ? 'selected' : ''}>Collecte qui se termine bientôt</option>
                        <option value="remaining" ${state.sort === 'remaining' ? 'selected' : ''}>Le plus à financer</option>
                        <option value="contribution" ${state.sort === 'contribution' ? 'selected' : ''}>Plus gros apport du vendeur</option>
                        <option value="recent" ${state.sort === 'recent' ? 'selected' : ''}>Les plus récentes</option>
                    </select>
                </div>
                <div class="inv-grid">${list.length ? list.map(cardHtml).join('') : '<p class="inv-none">Aucune opération ne correspond à ta recherche.</p>'}</div>`
            : `<div class="inv-empty"><i class="fas fa-seedling"></i>
                <h3>Aucune opération ouverte pour l'instant</h3>
                <p>Les premières opérations arrivent dès qu'elles sont vérifiées par Ouenze.</p>
                <p><strong>Tu es vendeur ?</strong> Propose une opération : ce que tu achètes, chez qui, et ton apport.</p>
                <a class="btn-submit" href="${state.hasShop ? 'trade.html?new=1' : 'vendor-dashboard.html'}">${state.hasShop ? 'Proposer une opération' : 'Mon espace boutique'}</a></div>`}`;
    }

    // Indicateurs calculés sur les opérations visibles (aucun chiffre inventé)
    function tickerHtml() {
        const ops = state.ops;
        const open = ops.filter(o => o.status === 'collecting');
        const sought = open.reduce((s, o) => s + Math.max(0, n(o.goal_amount) - n(o.figures?.pledged)), 0);
        const engaged = ops.filter(o => ['running', 'closed', 'failed'].includes(o.status))
            .reduce((s, o) => s + n(o.figures?.pledged) + n(o.figures?.vendor_in), 0);
        return `<div class="inv-ticker">
            <div><span>Collectes ouvertes</span><strong>${num(open.length)}</strong></div>
            <div><span>Reste à financer</span><strong>${fcfa(sought)}</strong></div>
            <div><span>Opérations en cours</span><strong>${num(ops.filter(o => o.status === 'running').length)}</strong></div>
            <div><span>Capital engagé</span><strong>${fcfa(engaged)}</strong></div>
        </div>`;
    }

    function when(o) {
        if (o.status === 'collecting' && o.collect_ends_at) return `Collecte : encore ${daysLeft(o.collect_ends_at)} j`;
        if (o.status === 'running' && o.ends_at) return `Fin dans ${daysLeft(o.ends_at)} j`;
        return `${o.duration_days} jours`;
    }

    function cardHtml(o) {
        const f = o.figures || {};
        const st = STATUS[o.status] || [o.status, ''];
        const budget = n(o.goal_amount) + n(o.vendor_contribution);
        return `
            <button class="inv-card" onclick="invOpen('${esc(o.id)}')">
                <div class="inv-card-head">
                    ${logoHtml(o.shop_name, o.shop_logo)}
                    <div><strong>${esc(o.shop_name)}<span class="inv-tag ${st[1]}">${esc(st[0])}</span></strong>
                    <small>${o.shop_city ? esc(o.shop_city) + ' · ' : ''}${esc(when(o))}</small></div>
                </div>
                <span class="inv-op-title">${esc(o.title)}</span>
                <div class="inv-figures">
                    <div><span>Financement recherché</span><strong>${fcfa(o.goal_amount)}</strong></div>
                    <div><span>Apport du vendeur</span><strong>${fcfa(o.vendor_contribution)}</strong></div>
                </div>
                <div class="inv-progress"><div style="width:${Math.min(100, n(f.pledged) / n(o.goal_amount) * 100)}%"></div></div>
                <div class="inv-progress-label"><span>${pct(n(f.pledged), n(o.goal_amount), 0)} financé</span><span>${fcfa(f.pledged)} sur ${fcfa(o.goal_amount)} · apport vendeur ${pct(n(o.vendor_contribution), budget, 0)} du budget</span></div>
                ${o.my_pledge ? `<div class="inv-progress-label"><span>Ta participation : <strong>${fcfa(o.my_pledge)}</strong></span></div>` : ''}
            </button>`;
    }

    // ---------- Détail (même fenêtre que l'ancienne fiche boutique) ----------
    async function invOpen(id) {
        const o = state.ops.find(x => x.id === id);
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.id = 'invModal';
        modal.innerHTML = `<div class="modal-card"><button class="modal-close" onclick="this.closest('.modal').remove()" aria-label="Fermer">&times;</button>
            <p class="inv-none">Chargement…</p></div>`;
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
        document.querySelector('#invModal')?.remove();
        document.body.appendChild(modal);
        const { data, error } = await window.supabase.rpc('trade_detail', { target: id });
        const card = modal.querySelector('.modal-card');
        if (error || !data) { card.innerHTML += `<p class="inv-none">${esc(error?.message || 'Opération introuvable.')}</p>`; return; }
        const op = data.operation;
        const f = data.figures;
        const st = STATUS[op.status] || [op.status, ''];
        const capital = n(f.pledged) + n(f.vendor_in);
        const result = n(f.sales) - n(f.suppliers_paid) - n(f.expenses);
        const started = ['running', 'closed', 'failed'].includes(op.status);
        card.innerHTML = `
            <button class="modal-close" onclick="this.closest('.modal').remove()" aria-label="Fermer">&times;</button>
            <div class="inv-card-head">${logoHtml(op.shop_name, o?.shop_logo)}
                <div><strong>${esc(op.shop_name)}<span class="inv-tag ${st[1]}">${esc(st[0])}</span></strong><small>Opération de ${op.duration_days} jours${op.ends_at ? ` · fin prévue le ${I.frDate(op.ends_at)}` : ''}</small></div></div>
            <p class="inv-pitch"><strong>${esc(op.title)}</strong>${op.description ? `<br>${esc(op.description)}` : ''}</p>
            <div class="inv-detail-figures">
                <div><span>Financement recherché</span><strong>${fcfa(op.goal_amount)}</strong></div>
                <div><span>Déjà engagé</span><strong>${fcfa(f.pledged)}</strong></div>
                <div><span>Apport du vendeur</span><strong>${fcfa(op.vendor_contribution)}</strong></div>
                <div><span>Achats fournisseurs prévus</span><strong>${fcfa(f.planned_purchases)}</strong></div>
                ${op.expected_revenue ? `<div><span>Ventes prévues (estimation)</span><strong>${fcfa(op.expected_revenue)}</strong></div>` : ''}
                <div><span>Participants</span><strong>${num(f.investors)}</strong></div>
                ${started ? `
                <div><span>Fournisseurs payés par Ouenze</span><strong>${fcfa(f.suppliers_paid)}</strong></div>
                <div><span>Autres dépenses justifiées</span><strong>${fcfa(f.expenses)}</strong></div>
                <div><span>Ventes validées</span><strong>${fcfa(f.sales)}</strong></div>
                <div><span>${op.status === 'running' ? 'Résultat à ce jour' : 'Résultat final'}</span><strong class="${result >= 0 ? 'inv-pos' : 'inv-neg'}">${fcfa(result, true)}</strong></div>` : ''}
            </div>
            ${data.my_pledge ? `<p class="inv-rules">Ta participation : <strong>${fcfa(data.my_pledge)}</strong>${started && capital ? ` · ta part du capital : <strong>${pct(n(data.my_pledge), capital)}</strong>` : ''}</p>` : ''}
            ${['closed', 'failed'].includes(op.status) ? `<p class="inv-rules"><i class="fas fa-balance-scale"></i> <strong>Répartition : règles en cours de validation.</strong> Le partage des gains ou des pertes et le versement du solde ne sont pas encore fixés. Aucun montant n'est dû ni retiré dans cette simulation.</p>` : ''}
            <h4>Achats fournisseurs <small>(payés directement par Ouenze)</small></h4>
            <ul class="inv-track">${data.suppliers.map(l => `<li><span>${esc(l.item)}<small>${esc(l.supplier_name)}${l.status === 'paid' ? ` · payé le ${I.frDate(l.paid_at)}` : ' · prévu'}</small></span><b>${fcfa(l.amount)}</b></li>`).join('')}</ul>
            ${started ? `<h4>Suivi de l'argent</h4>
                <ul class="inv-track">${data.entries.filter(e => e.kind !== 'note' && e.status === 'validated').map(e => `<li><span>${esc(e.label)}<small>${esc(KIND[e.kind] || e.kind)} · ${I.frDate(e.created_at)}</small></span>
                    <b class="${e.kind === 'sale' || e.kind === 'vendor_contribution' ? 'in' : 'out'}">${e.kind === 'sale' || e.kind === 'vendor_contribution' ? '+' : '−'}${fcfa(e.amount)}</b></li>`).join('') || '<li><span>Aucun mouvement validé pour l\'instant.</span></li>'}</ul>` : ''}
            <div id="invReserve">${pledgeFormHtml(op, f, data)}</div>
            ${op.is_owner || op.role === 'admin' ? `<div class="inv-actions-row"><a class="btn-cancel" href="trade.html?op=${encodeURIComponent(op.id)}"><i class="fas fa-cog"></i> ${op.is_owner ? 'Déclarer dépenses et ventes' : 'Gérer l\'opération'}</a></div>` : ''}`;
    }

    function pledgeFormHtml(op, f, data) {
        if (op.status !== 'collecting') return '';
        if (op.is_owner) return '<p class="inv-none">Tu participes avec ton apport de vendeur.</p>';
        const left = n(op.goal_amount) - n(f.pledged);
        if (left <= 0) return '<p class="inv-none">Financement complet : l\'opération va bientôt démarrer.</p>';
        return `
            <div class="form-group"><label for="invQty">Montant de ta participation (FCFA)</label>
                <div class="inv-qty">
                    <input type="number" id="invQty" inputmode="numeric" min="1" max="${left}" step="500" value="${Math.min(10000, left)}">
                    <button type="button" onclick="invSetQty(${Math.min(25000, left)})">${num(Math.min(25000, left))}</button>
                    <button type="button" onclick="invSetQty(${left})">Max</button>
                </div></div>
            <p class="auth-note">Il reste ${fcfa(left)} à financer.</p>
            <label class="inv-ack"><input type="checkbox" id="invRisk"><span>Je comprends que je peux <b>perdre tout ou partie</b> de ma participation, que le résultat n'est pas garanti et que mon argent reste engagé pendant les 45 jours.</span></label>
            <div class="form-error" id="invError" role="alert"></div>
            <button class="btn-submit" id="invSubmit" onclick="invReserve('${esc(op.id)}')"><i class="fas fa-handshake"></i> Participer (simulation)</button>
            <p class="auth-note">Simulation : rien n'est payé. ${data.my_pledge ? 'Tu peux encore retirer ta participation tant que la collecte est ouverte.' : ''}</p>
            ${data.my_pledge ? `<button class="inv-link-btn" onclick="invWithdraw('${esc(op.id)}')">Retirer ma participation</button>` : ''}`;
    }

    function invSetQty(v) {
        const input = document.getElementById('invQty');
        if (input) input.value = v;
    }

    async function invReserve(id) {
        const amount = Math.floor(Number(document.getElementById('invQty')?.value) || 0);
        const err = m => { const e = document.getElementById('invError'); e.textContent = m; e.style.display = m ? 'block' : 'none'; };
        if (amount < 1) return err('Indique un montant.');
        if (!document.getElementById('invRisk')?.checked) return err('Coche la case sur les risques pour continuer.');
        const btn = document.getElementById('invSubmit');
        btn.disabled = true;
        const { error } = await window.supabase.rpc('trade_pledge', { target: id, amount, risk_ack: true });
        btn.disabled = false;
        if (error) return err(error.message || 'Participation impossible, réessaie.');
        await load();
        render();
        invOpen(id);
    }

    async function invWithdraw(id) {
        const { error } = await window.supabase.rpc('trade_withdraw_pledge', { target: id });
        if (error) { const e = document.getElementById('invError'); if (e) { e.textContent = error.message; e.style.display = 'block'; } return; }
        await load();
        render();
        invOpen(id);
    }

    function invSearch(v) {
        state.search = v;
        const grid = document.querySelector('.inv-grid');
        if (grid) {
            const list = sorted(state.ops);
            grid.innerHTML = list.length ? list.map(cardHtml).join('') : '<p class="inv-none">Aucune opération ne correspond à ta recherche.</p>';
        }
    }

    function invSort(v) {
        state.sort = v;
        render();
    }

    async function load() {
        const { data, error } = await window.supabase.rpc('trade_list', { scope: 'open' });
        state.missing = I.isMissing(error);
        if (error && !state.missing) console.error('❌ Trade :', error);
        state.ops = data || [];
    }

    async function init() {
        if (!window.supabase?.rpc) {
            box().innerHTML = '<div class="inv-empty"><p>Service indisponible. Recharge la page.</p></div>';
            return;
        }
        if (!await I.tradeAccess()) { box().innerHTML = I.comingSoon(); return; }
        state.user = await I.currentUser();
        if (!state.user) { box().innerHTML = I.simulationBanner() + I.loginBox('Connecte-toi pour essayer Ouenze Trade'); return; }
        const [role, shops] = await Promise.all([
            window.supabase.rpc('my_team_role'),
            window.supabase.from('shops').select('id').eq('owner_id', state.user.id).limit(1)
        ]);
        state.role = role.error ? null : role.data;
        state.hasShop = !!(shops.data || []).length;
        await load();
        render();
        const id = new URLSearchParams(location.search).get('op');
        if (id) invOpen(id);
    }

    Object.assign(window, { invOpen, invSetQty, invReserve, invWithdraw, invSearch, invSort });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
