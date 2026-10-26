// ============================================================
// ADMIN-RESERVE.JS — Réserves de garantie des livreurs (admin-reserve.html)
//
// Données : migration 20261110_courier_reserve.sql (EN SIMULATION : rien n'est réellement retenu).
//   admin_reserves(search)      → liste des livreurs et de leur réserve
//   admin_reserve_detail(id)    → registre complet, réclamations, vérification des empreintes
//   admin_reserve_claim(...)    → ouvrir une réclamation (preuves obligatoires, 72 h pour contester)
//   admin_reserve_decide(...)   → retenir ou écarter (pas avant la fin du délai, sauf contestation)
//   admin_reserve_reverse(...)  → annuler une retenue (mouvement inverse)
//   admin_reserve_close(...)    → le livreur part : tout le solde non contesté lui est versé
//   admin_reserve_settings(...) → plafond, délai de blocage (30 à 60 jours), taux
// Le registre ne se modifie jamais : chaque correction est un nouveau mouvement.
// ============================================================

(function () {
    'use strict';

    const KIND = { contribution: 'Mise en réserve', release: 'Rendu', debit: 'Retenue', debit_reversal: 'Retenue annulée', closure: 'Clôture : versé' };
    const CLAIM = { loss: 'Perte', theft: 'Vol', fraud: 'Fraude', damage: 'Colis abîmé' };
    const CLAIM_STATUS = { open: 'Ouverte', contested: 'Contestée', upheld: 'Retenue', rejected: 'Écartée', cancelled: 'Annulée' };
    const state = { list: [], search: '', openId: null, detail: null };

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fcfa = v => `${Math.round(Number(v) || 0).toLocaleString('fr-FR')} FCFA`;
    const date = iso => iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    const dateTime = iso => iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    const box = () => document.getElementById('adminApp');
    const rpc = (n, a) => window.supabase.rpc(n, a || {});
    const missing = e => /admin_reserve|courier_reserve|schema cache|does not exist/i.test(e?.message || '');

    function message(html) { box().innerHTML = `<div class="dl-card"><div class="dl-status">${html}</div></div>`; }
    function migrationText() {
        return '<i class="fas fa-tools"></i><h3>Base de données à mettre à jour</h3><p>Exécute la migration 20261110_courier_reserve.sql dans Supabase.</p>';
    }
    function flash(text, ok) {
        const el = document.getElementById('rsMsg');
        if (!el) { uiAlert(text); return; }
        el.hidden = false;
        el.className = 'tm-msg ' + (ok ? 'ok' : 'err');
        el.textContent = text;
    }
    const simBanner = mode => mode === 'real' ? '' : `<div class="rs-sim-admin"><i class="fas fa-flask"></i> <b>Simulation</b> : le registre calcule tout, mais aucune somme n'est réellement retenue aux livreurs. Le passage à l'argent réel attend la validation du prestataire de paiement et du cadre juridique.</div>`;

    // ---------- Liste ----------
    async function showList() {
        state.openId = null;
        history.replaceState(null, '', 'admin-reserve.html');
        box().innerHTML = '<p style="text-align:center;color:var(--gray-500);padding:30px 0;">Chargement…</p>';
        const [{ data, error }, fees] = await Promise.all([rpc('admin_reserves', { search: state.search || null }), rpc('admin_reserve_todo')]);
        if (error) return message(missing(error) ? migrationText() : `<p>${esc(error.message)}</p>`);
        state.list = data || [];
        const total = state.list.reduce((s, x) => s + Number(x.balance || 0), 0);
        const claims = state.list.reduce((s, x) => s + Number(x.open_incidents || 0), 0);
        box().innerHTML = `
            ${simBanner('simulation')}
            <div class="as-kpis">
                <div><span>Total des réserves</span><b>${fcfa(total)}</b><small>appartient aux livreurs, pas à Ouenze</small></div>
                <div><span>Livreurs</span><b>${state.list.length}</b><small>avec une réserve ou validés</small></div>
                <div><span>Réclamations en cours</span><b>${claims}</b><small>${Number(fees.data) || 0} à trancher maintenant</small></div>
            </div>
            <form class="tm-search" onsubmit="event.preventDefault();rsSearch(this.q.value)">
                <input name="q" value="${esc(state.search)}" placeholder="Nom ou téléphone du livreur">
                <button class="btn-cancel" aria-label="Chercher"><i class="fas fa-search"></i></button>
            </form>
            ${settingsHtml()}
            ${state.list.length ? `<div class="rs-list">${state.list.map(x => `
                <button type="button" class="dl-card as-row rs-row" onclick="rsOpen('${esc(x.courier_id)}')">
                    <div class="as-row-head"><strong>${esc(x.name)}</strong>
                        ${x.closed ? '<span class="adm-badge rejected">Clôturée</span>' : Number(x.open_incidents) ? `<span class="adm-badge suspended">${x.open_incidents} réclamation(s)</span>` : '<span class="adm-badge approved">À jour</span>'}</div>
                    <small class="as-sub">${esc(x.phone || '')}${x.last_move ? ' · dernier mouvement ' + date(x.last_move) : ''}</small>
                    <div class="rs-line"><span>Solde <b>${fcfa(x.balance)}</b></span><span>Bloqué <b>${fcfa(x.locked)}</b></span><span>Réclamé <b>${fcfa(x.claimed)}</b></span></div>
                </button>`).join('')}</div>` : '<p class="as-empty">Aucun livreur pour l\'instant.</p>'}`;
        loadSettings();
    }

    function settingsHtml() {
        return `<details class="dl-card rs-settings"><summary><i class="fas fa-sliders-h"></i> Réglages de la réserve</summary>
            <div class="tm-fees">
                <label>Plafond <input id="rsCap" type="number" min="0" step="1000"> FCFA</label>
                <label>Blocage <input id="rsHold" type="number" min="30" max="60" step="1"> jours</label>
                <label>Part mise en réserve <input id="rsRate" type="number" min="0" max="10" step="0.5"> %</label>
                <button class="btn-submit" onclick="rsSaveSettings()">Enregistrer</button>
            </div>
            <p class="tm-hint">Décision de GOAT : 10 % des frais de livraison, blocage de 30 à 60 jours, plafond de 30 000 FCFA. Les nouveaux réglages valent pour les prochaines courses.</p>
            <p class="tm-msg" id="rsMsg" hidden></p></details>`;
    }

    async function loadSettings() {
        const { data } = await rpc('admin_reserve_settings_get');
        const f = data || { cap: 30000, hold_days: 45, rate: 0.10 };
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        set('rsCap', Number(f.cap)); set('rsHold', Number(f.hold_days)); set('rsRate', Math.round(Number(f.rate) * 1000) / 10);
    }

    async function rsSaveSettings() {
        const cap = Number(document.getElementById('rsCap')?.value);
        const hold = Number(document.getElementById('rsHold')?.value);
        const rate = Number(document.getElementById('rsRate')?.value);
        if (!(await uiConfirm(`Plafond ${fcfa(cap)}, blocage ${hold} jours, ${rate} % mis en réserve ?\n\nCes réglages valent pour les prochaines courses.`, 'Enregistrer'))) return;
        const { error } = await rpc('admin_reserve_settings', { cap, hold_days: hold, rate_percent: rate });
        flash(error ? error.message : 'Réglages enregistrés.', !error);
    }

    // ---------- Fiche d'un livreur ----------
    async function rsOpen(id) {
        state.openId = id;
        history.replaceState(null, '', 'admin-reserve.html?id=' + encodeURIComponent(id));
        box().innerHTML = '<p style="text-align:center;color:var(--gray-500);padding:30px 0;">Chargement…</p>';
        const { data: d, error } = await rpc('admin_reserve_detail', { target: id });
        if (error || !d) return message(missing(error) ? migrationText() : `<p>${esc(error?.message || 'Introuvable')}</p><button class="btn-cancel" onclick="rsBack()">Retour</button>`);
        state.detail = d;
        const c = d.courier || {};
        const open = (d.incidents || []).filter(i => ['open', 'contested'].includes(i.status));
        box().innerHTML = `
            <button class="tr-back as-back" onclick="rsBack()"><i class="fas fa-arrow-left"></i> Toutes les réserves</button>
            ${simBanner(d.mode)}
            <div class="dl-card">
                <div class="as-row-head"><h3 style="margin:0;">${esc(c.name || 'Livreur')}</h3>
                    ${d.closed ? '<span class="adm-badge rejected">Clôturée</span>' : ''}
                    <span class="adm-badge ${d.chain_ok ? 'approved' : 'rejected'}">${d.chain_ok ? 'Registre intact' : 'Registre altéré !'}</span></div>
                <small class="as-sub">${esc(c.phone || '')} · <a href="admin-search.html?u=${encodeURIComponent(id)}">fiche complète</a></small>
                <div class="as-kpis" style="margin-top:12px;">
                    <div><span>Solde</span><b>${fcfa(d.balance)}</b><small>plafond ${fcfa(d.cap)}</small></div>
                    <div><span>Bloqué</span><b>${fcfa(d.locked)}</b><small>${d.next_release ? 'prochain retour le ' + date(d.next_release) : '—'}</small></div>
                    <div><span>Réclamé</span><b>${fcfa(d.claimed)}</b><small>${open.length} réclamation(s) en cours</small></div>
                    <div><span>Rendable maintenant</span><b>${fcfa(d.releasable)}</b><small>rendu automatiquement chaque jour</small></div>
                </div>
                ${d.closed ? '' : `<div class="as-actions">
                    <button class="btn-cancel as-warn-btn" onclick="rsClaim()"><i class="fas fa-exclamation-triangle"></i> Ouvrir une réclamation</button>
                    <button class="btn-cancel" onclick="rsClose()"><i class="fas fa-door-open"></i> Le livreur quitte Ouenze</button>
                </div>`}
                <p class="tm-msg" id="rsMsg" hidden></p>
            </div>

            <div class="dl-card">
                <h4 class="as-h"><i class="fas fa-gavel"></i> Réclamations</h4>
                ${(d.incidents || []).length ? d.incidents.map(i => {
                    const early = i.status === 'open' && new Date(i.contest_deadline) > new Date();
                    return `<div class="rs-claim-admin ${i.status}">
                        <div class="as-row-head"><strong>${esc(CLAIM[i.kind] || i.kind)} · ${fcfa(i.amount)}</strong><span class="adm-badge ${i.status === 'upheld' ? 'rejected' : i.status === 'rejected' || i.status === 'cancelled' ? 'approved' : 'suspended'}">${esc(CLAIM_STATUS[i.status] || i.status)}</span></div>
                        <small class="as-sub">Ouverte le ${dateTime(i.opened_at)} · contestation possible jusqu'au ${dateTime(i.contest_deadline)}</small>
                        <p><b>Faits :</b> ${esc(i.description)}</p>
                        <p><b>Preuves :</b> ${esc(i.evidence)}</p>
                        ${i.contest_text ? `<p><b>Réponse du livreur (${dateTime(i.contest_at)}) :</b> ${esc(i.contest_text)}</p>` : ''}
                        ${i.decision_note ? `<p><b>Décision :</b> ${esc(i.decision_note)}${Number(i.debited) ? ` (${fcfa(i.debited)} retenus)` : ''}</p>` : ''}
                        ${['open', 'contested'].includes(i.status) ? `<div class="as-actions">
                            <button class="btn-cancel tm-danger-text" ${early ? 'disabled title="Attends la fin du délai de contestation"' : ''} onclick="rsDecide('${esc(i.id)}','upheld')"><i class="fas fa-check"></i> Retenir${early ? ' (après le délai)' : ''}</button>
                            <button class="btn-submit" onclick="rsDecide('${esc(i.id)}','rejected')"><i class="fas fa-times"></i> Écarter</button></div>` : ''}
                        ${i.status === 'upheld' ? `<div class="as-actions"><button class="btn-cancel" onclick="rsReverse('${esc(i.id)}')"><i class="fas fa-undo"></i> Annuler la retenue</button></div>` : ''}
                    </div>`;
                }).join('') : '<p class="as-empty">Aucune réclamation.</p>'}
            </div>

            <div class="dl-card">
                <h4 class="as-h"><i class="fas fa-book"></i> Registre (${(d.entries || []).length} mouvements, non modifiables)</h4>
                ${(d.entries || []).length ? `<ul class="as-list">${d.entries.map(e => `<li>
                    <span><b>${esc(KIND[e.kind] || e.kind)}</b><small>${dateTime(e.created_at)}${e.note ? ' · ' + esc(e.note) : ''}${e.kind === 'contribution' && e.available_at ? ' · rendable le ' + date(e.available_at) : ''}${e.simulation ? ' · simulation' : ''}</small></span>
                    <span class="as-right ${Number(e.amount) >= 0 ? 'as-in' : 'as-out'}">${Number(e.amount) >= 0 ? '+' : '−'}${fcfa(Math.abs(Number(e.amount)))}<small>n° ${esc(e.id)} · ${esc(String(e.hash || '').slice(0, 8))}</small></span></li>`).join('')}</ul>`
                    : '<p class="as-empty">Aucun mouvement : la réserve se remplit à chaque course livrée.</p>'}
            </div>`;
        window.scrollTo(0, 0);
    }

    async function rsClaim() {
        const d = state.detail;
        const orders = (d.recent_orders || []).filter(o => o.status === 'delivered' || o.status === 'in_transit' || o.status === 'picked_up');
        const kind = await uiPrompt('Type de réclamation : perte, vol, fraude ou dommage ?', 'perte');
        if (kind === null) return;
        const map = { perte: 'loss', vol: 'theft', fraude: 'fraud', dommage: 'damage', abime: 'damage', 'abîmé': 'damage' };
        const k = map[kind.trim().toLowerCase()];
        if (!k) return uiAlert('Choisis : perte, vol, fraude ou dommage.');
        const amount = Number(String(await uiPrompt('Montant réclamé (FCFA) :', '') || '').replace(/\s/g, ''));
        if (!(amount > 0)) return;
        let orderRef = null;
        if (orders.length) {
            const num = await uiPrompt(`Numéro de la commande concernée (laisser vide si aucune) :\n${orders.slice(0, 8).map(o => o.order_number).join(', ')}`, '');
            if (num === null) return;
            const hit = orders.find(o => o.order_number.toLowerCase() === num.trim().toLowerCase());
            if (num.trim() && !hit) return uiAlert('Commande introuvable parmi les courses de ce livreur.');
            orderRef = hit?.id || null;
        }
        const desc = await uiPrompt('Ce qui s\'est passé (envoyé au livreur) :', '');
        if (desc === null) return;
        const ev = await uiPrompt('Preuves (obligatoires) : code de remise, positions, photos, témoignages… :', '');
        if (ev === null) return;
        const { error } = await rpc('admin_reserve_claim', { target: state.openId, order_ref: orderRef, claim_kind: k, claim_amount: amount, claim_description: desc, claim_evidence: ev });
        if (error) return flash(error.message, false);
        await uiAlert('Réclamation ouverte. Le livreur est prévenu et a 72 heures pour contester. Rien n\'est retenu avant ta décision.');
        rsOpen(state.openId);
    }

    async function rsDecide(id, decision) {
        const note = await uiPrompt(decision === 'upheld'
            ? 'Retenir sur la réserve : explique ta décision (envoyée au livreur). La retenue ne dépasse jamais la réserve de CE livreur.'
            : 'Écarter la réclamation : explique ta décision (envoyée au livreur).', '');
        if (note === null) return;
        const { error } = await rpc('admin_reserve_decide', { target: id, decision, note });
        if (error) return flash(error.message, false);
        rsOpen(state.openId);
    }

    async function rsReverse(id) {
        const note = await uiPrompt('Annuler la retenue : pourquoi ? (envoyé au livreur)', '');
        if (note === null) return;
        const { error } = await rpc('admin_reserve_reverse', { target: id, note });
        if (error) return flash(error.message, false);
        rsOpen(state.openId);
    }

    async function rsClose() {
        const d = state.detail;
        if (!(await uiConfirm(`Le livreur quitte Ouenze ?\n\nTout son solde (${fcfa(d.balance)}) lui est versé et la réserve est clôturée. Impossible s'il reste une réclamation en cours.`, 'Clôturer'))) return;
        const { error } = await rpc('admin_reserve_close', { target: state.openId, note: '' });
        if (error) return flash(error.message, false);
        rsOpen(state.openId);
    }

    function rsSearch(q) { state.search = String(q || '').trim(); showList(); }
    function rsBack() { showList(); }

    async function init() {
        if (!window.supabase?.auth) { message('<p>Service indisponible.</p>'); return; }
        const { data } = await window.supabase.auth.getSession();
        if (!data?.session) {
            message(`<i class="fas fa-lock"></i><h3>Espace administrateur</h3><p>Connecte-toi avec ton compte administrateur.</p>
                <button class="btn-submit" onclick="openEmailLoginModal()">Se connecter</button>`);
            return;
        }
        const { data: isAdmin } = await rpc('is_admin');
        if (!isAdmin) { message('<i class="fas fa-ban"></i><h3>Accès réservé</h3><p>Ce compte n\'est pas administrateur.</p>'); return; }
        await rpc('reserve_release_due').then(() => null, () => null);
        const id = new URLSearchParams(location.search).get('id');
        if (id) rsOpen(id); else showList();
    }

    Object.assign(window, { rsOpen, rsBack, rsSearch, rsClaim, rsDecide, rsReverse, rsClose, rsSaveSettings });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
