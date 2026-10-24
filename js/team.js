// ============================================================
// TEAM.JS — Espace équipe (equipe.html)
//
// Pour les employés Ouenze : appeler les clients, noter le quartier, confirmer,
// annuler (client qui change d'avis), marquer payé, voir l'historique.
// Rôles (migration 20261030) : agent = commandes ; admin = commandes + gestion de l'équipe.
// Tout passe par des fonctions de la base : personne n'a besoin d'accéder à Supabase.
// ============================================================

(function () {
    'use strict';

    const STATUS = {
        pending: 'Attend le vendeur', accepted: 'Acceptée par le vendeur', courier_assigned: 'Livreur en route',
        picked_up: 'Colis récupéré', in_transit: 'En livraison', delivered: 'Livrée', cancelled: 'Annulée',
        refused: 'Refusée par le vendeur', refunded: 'Remboursée'
    };
    const PAYMENT = {
        MTN_CG: 'MTN Mobile Money', AIRTEL_CG: 'Airtel Money', MPESA_CD: 'M-Pesa', ORANGE_CD: 'Orange Money',
        AIRTEL_CD: 'Airtel Money', CARD: 'Carte bancaire', PAYPAL: 'PayPal'
    };
    const ACTIONS = { confirmed: 'Adresse confirmée', cancelled: 'Annulée', paid: 'Payée', note: 'Note' };
    const TABS = [['to_call', 'À appeler'], ['active', 'Confirmées'], ['done', 'Terminées'], ['team', 'Équipe']];
    const state = { role: null, tab: 'to_call', search: '', orders: [], members: [], counts: {}, timer: null, open: null };

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const digits = p => String(p || '').replace(/\D/g, '');
    const fcfa = n => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} FCFA`;
    const when = d => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const box = () => document.getElementById('teamApp');
    const rpc = (name, args) => window.supabase.rpc(name, args || {});

    function message(html) {
        box().innerHTML = `<div class="dl-card"><div class="dl-status">${html}</div></div>`;
    }

    // ---------- Fenêtre dans la page (les fenêtres du navigateur sont bloquées dans certaines applis) ----------
    function ask({ title, text, field, placeholder, ok, danger }) {
        return new Promise(resolve => {
            const ov = document.createElement('div');
            ov.className = 'tm-dialog';
            ov.innerHTML = `<div class="tm-dialog-card" role="dialog" aria-modal="true">
                <h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
                ${field ? `<input id="tmAsk" maxlength="300" placeholder="${esc(placeholder || '')}">` : ''}
                <p class="tm-dialog-err" id="tmAskErr"></p>
                <div class="tm-dialog-actions"><button class="btn-cancel" data-v="0">Retour</button>
                <button class="btn-submit ${danger ? 'tm-danger' : ''}" data-v="1">${esc(ok || 'OK')}</button></div></div>`;
            const done = v => { ov.remove(); resolve(v); };
            ov.addEventListener('click', e => {
                const b = e.target.closest('button[data-v]');
                if (e.target === ov || (b && b.dataset.v === '0')) return done(null);
                if (!b) return;
                const val = field ? ov.querySelector('#tmAsk').value.trim() : true;
                if (field && val.length < 2) { ov.querySelector('#tmAskErr').textContent = 'Écris quelques mots.'; return; }
                done(val);
            });
            document.body.appendChild(ov);
            ov.querySelector('#tmAsk')?.focus();
        });
    }

    function flash(id, text, ok) {
        const el = document.getElementById(`tmM-${id}`);
        if (!el) return;
        el.hidden = false;
        el.className = 'tm-msg ' + (ok ? 'ok' : 'err');
        el.textContent = text;
    }

    // ---------- Commandes ----------
    function orderCard(o) {
        const id = esc(o.order_id);
        const tel = digits(o.phone);
        const finished = ['delivered', 'cancelled', 'refused', 'refunded'].includes(o.status);
        const pay = PAYMENT[o.payment_operator] || (o.payment_method === 'card' ? 'Carte bancaire' : o.payment_method === 'paypal' ? 'PayPal' : 'Mobile Money');
        const needsLink = ['card', 'paypal'].includes(o.payment_method) && o.payment_status !== 'paid';
        return `<div class="dl-card tm-order ${o.confirmed ? '' : 'tm-todo'}">
            <div class="tm-head">
                <div><strong>${esc(o.client_name || 'Client')}</strong><small>${esc(o.order_number)} · ${when(o.created_at)}</small></div>
                <span class="tm-total">${fcfa(o.total)}</span>
            </div>
            <div class="tm-tags">
                <span class="tm-tag">${esc(STATUS[o.status] || o.status)}</span>
                <span class="tm-tag ${o.payment_status === 'paid' ? 'ok' : needsLink ? 'warn' : ''}">${o.payment_status === 'paid' ? 'Payée' : o.payment_status === 'test' ? 'Test' : 'À payer'} · ${esc(pay)}</span>
                ${o.shop_name ? `<span class="tm-tag"><i class="fas fa-store"></i> ${esc(o.shop_name)}</span>` : ''}
                ${o.deliverer_name ? `<span class="tm-tag"><i class="fas fa-motorcycle"></i> ${esc(o.deliverer_name)}</span>` : ''}
            </div>
            ${needsLink && !finished ? '<p class="tm-hint"><i class="fas fa-link"></i> Envoie le lien de paiement au client pendant l\'appel.</p>' : ''}
            <div class="tm-call">
                ${tel ? `<a class="btn-submit tm-wa" href="https://wa.me/${tel}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> WhatsApp ${esc(o.phone)}</a>
                <a class="btn-cancel" href="tel:+${tel}"><i class="fas fa-phone"></i> Appel normal</a>` : '<span class="tm-hint">Pas de numéro</span>'}
            </div>
            ${tel ? '<p class="tm-hint tm-wa-hint">WhatsApp ouvre la discussion : appuie sur l\'icône d\'appel en haut. Si le client n\'a pas WhatsApp, utilise l\'appel normal.</p>' : ''}
            ${finished ? `<p class="tm-hint">${esc(o.city || '')}${o.district ? ', ' + esc(o.district) : ''}</p>` : `
            <div class="tm-fields">
                <label>Quartier *<input id="tmD-${id}" maxlength="60" value="${esc(o.district || '')}" placeholder="Ex : Moungali"></label>
                <label>Repère<input id="tmL-${id}" maxlength="300" value="${esc(o.landmark || '')}" placeholder="Ex : portail bleu après la pharmacie"></label>
                <label class="tm-wide">Note d'appel<input id="tmN-${id}" maxlength="300" value="${esc(o.call_note || '')}" placeholder="Ex : rappeler après 17 h"></label>
            </div>
            <div class="tm-actions">
                <button class="btn-submit" onclick="tmConfirm('${id}')"><i class="fas fa-check"></i> ${o.confirmed ? 'Mettre à jour' : 'Adresse confirmée'}</button>
                <button class="btn-cancel" onclick="tmNote('${id}')"><i class="fas fa-phone-slash"></i> Injoignable / note</button>
                ${o.payment_status === 'cod' && o.payment_method !== 'paypal' ? `<button class="btn-cancel" onclick="tmPayLink('${id}')"><i class="fas fa-link"></i> Lien de paiement</button>` : ''}
                ${o.payment_status !== 'paid' && o.payment_status !== 'test' ? `<button class="btn-cancel" onclick="tmPaid('${id}')"><i class="fas fa-wallet"></i> Payée</button>` : ''}
                <button class="btn-cancel tm-danger-text" onclick="tmCancel('${id}')"><i class="fas fa-ban"></i> Annuler</button>
            </div>`}
            <button class="tm-history-btn" onclick="tmHistory('${id}')">${o.last_action ? `${esc(ACTIONS[o.last_action] || o.last_action)} par ${esc(o.last_actor || '?')} · ${when(o.last_at)}` : 'Historique'} <i class="fas fa-chevron-down"></i></button>
            <div class="tm-history" id="tmH-${id}" hidden></div>
            <p class="tm-msg" id="tmM-${id}" hidden></p>
        </div>`;
    }

    function render() {
        const tabs = TABS.filter(([k]) => k !== 'team' || state.role === 'admin');
        const head = `
            <div class="adm-tabs tm-tabs">
                ${tabs.map(([k, l]) => `<button class="adm-tab ${state.tab === k ? 'active' : ''}" onclick="tmTab('${k}')">${l}${state.counts[k] != null ? ` <span class="tm-count">${state.counts[k]}</span>` : ''}</button>`).join('')}
            </div>`;
        if (state.tab === 'team') { box().innerHTML = head + teamHtml(); return; }
        box().innerHTML = head + `
            <form class="tm-search" onsubmit="event.preventDefault();tmSearch(this.q.value)">
                <input name="q" value="${esc(state.search)}" placeholder="Chercher un numéro de commande ou de téléphone" inputmode="search">
                <button class="btn-cancel" aria-label="Chercher"><i class="fas fa-search"></i></button>
            </form>
            ${state.orders.length ? state.orders.map(orderCard).join('')
                : `<div class="dl-card" style="text-align:center;color:var(--gray-500);">${{ to_call: 'Aucun client à appeler. Les nouvelles commandes arrivent ici (et dans tes notifications).', active: 'Aucune commande confirmée en cours.', done: 'Aucune commande terminée ces 30 derniers jours.' }[state.tab] || 'Rien ici.'}</div>`}
            <p class="tm-refresh">Mise à jour automatique toutes les minutes.</p>`;
    }

    async function loadOrders() {
        const [{ data, error }, todo] = await Promise.all([
            rpc('team_orders', { scope: state.tab, search: state.search || null }),
            state.tab === 'to_call' && !state.search ? Promise.resolve(null) : rpc('team_orders', { scope: 'to_call', search: null })
        ]);
        if (error) { message('<p>Chargement impossible : ' + esc(error.message) + '</p>'); return false; }
        state.orders = data || [];
        state.counts.to_call = (todo ? todo.data || [] : state.orders).length;
        return true;
    }

    async function refresh() {
        if (state.tab === 'team') await loadMembers();
        else if (!await loadOrders()) return;
        // Ne pas effacer ce qu'un employé est en train de taper
        if (document.activeElement?.closest?.('.tm-fields, .tm-search, .tm-team-add')) return;
        render();
    }

    async function tmTab(k) {
        state.tab = k;
        state.search = '';
        box().innerHTML = '<p style="text-align:center;color:var(--gray-500);padding:30px 0;">Chargement…</p>';
        await refresh();
        render();
    }

    async function tmSearch(q) {
        state.search = String(q || '').trim();
        if (state.search && state.tab === 'to_call') state.tab = 'all';
        await loadOrders();
        render();
    }

    async function tmConfirm(id) {
        const v = k => (document.getElementById(`tm${k}-${id}`)?.value || '').trim();
        if (v('D').length < 2) { flash(id, 'Indique le quartier.', false); document.getElementById(`tmD-${id}`)?.focus(); return; }
        const { error } = await rpc('team_confirm_order', { target_order: id, new_district: v('D'), new_landmark: v('L') || null, note: v('N') || null });
        if (error) return flash(id, error.message, false);
        flash(id, 'Adresse confirmée : le vendeur et le livreur la voient.', true);
        setTimeout(async () => { await loadOrders(); render(); }, 900);
    }

    async function tmNote(id) {
        const typed = (document.getElementById(`tmN-${id}`)?.value || '').trim();
        const note = typed || await ask({ title: 'Note d\'appel', text: 'Ex : injoignable, messagerie, rappeler à 17 h.', field: true, placeholder: 'Injoignable à 10 h', ok: 'Enregistrer' });
        if (!note) return;
        const { error } = await rpc('team_note_order', { target_order: id, note });
        if (error) return flash(id, error.message, false);
        flash(id, 'Note enregistrée.', true);
    }

    async function tmPaid(id) {
        const ref = await ask({ title: 'Paiement reçu ?', text: 'Indique la référence (numéro de transaction PayPal, Mobile Money…) si tu l\'as.', field: true, placeholder: 'Référence ou « espèces »', ok: 'Marquer payée' });
        if (!ref) return;
        const { error } = await rpc('team_mark_paid', { target_order: id, reference: ref });
        if (error) return flash(id, error.message, false);
        flash(id, 'Commande marquée payée.', true);
        setTimeout(async () => { await loadOrders(); render(); }, 900);
    }

    // Envoie au client le lien de paiement (carte pendant l'appel, ou Mobile Money) par SMS
    async function tmPayLink(id) {
        const res = await window.supabase.functions.invoke('payment', { body: { action: 'create', order_id: id, send_sms: true } });
        if (res.error || !res.data?.link) {
            let text = '';
            try { text = (await res.error?.context?.json())?.error || ''; } catch (e) { /* réponse illisible */ }
            return flash(id, text || 'Lien de paiement impossible pour le moment.', false);
        }
        const d = res.data;
        try { await navigator.clipboard?.writeText(d.link); } catch (e) { /* copie refusée */ }
        flash(id, `${d.sms === 'sent' ? 'Lien envoyé par SMS au client.' : 'SMS non envoyé : lien copié, envoie-le par WhatsApp.'} ${d.link}${d.simulation ? ' (simulation)' : ''}`, true);
    }

    async function tmCancel(id) {
        const reason = await ask({ title: 'Annuler la commande ?', text: 'Le client, le vendeur et le livreur sont prévenus. C\'est définitif.', field: true, placeholder: 'Ex : le client a changé d\'avis', ok: 'Annuler la commande', danger: true });
        if (!reason) return;
        const { error } = await rpc('team_cancel_order', { target_order: id, reason });
        if (error) return flash(id, error.message, false);
        flash(id, 'Commande annulée.', true);
        setTimeout(async () => { await loadOrders(); render(); }, 900);
    }

    async function tmHistory(id) {
        const el = document.getElementById(`tmH-${id}`);
        if (!el) return;
        if (!el.hidden) { el.hidden = true; return; }
        el.hidden = false;
        el.innerHTML = '<small>Chargement…</small>';
        const { data, error } = await rpc('team_order_history', { target_order: id });
        el.innerHTML = error ? `<small>${esc(error.message)}</small>`
            : (data || []).length ? `<ul>${data.map(e => `<li><b>${esc(ACTIONS[e.action] || e.action)}</b> · ${esc(e.actor || '?')} · ${when(e.created_at)}${e.details ? `<br><small>${esc(e.details)}</small>` : ''}</li>`).join('')}</ul>`
                : '<small>Aucune action de l\'équipe pour l\'instant.</small>';
    }

    // ---------- Équipe (admins) ----------
    function teamHtml() {
        return `
            <div class="dl-card tm-team-add">
                <strong><i class="fas fa-sliders-h"></i> Réglages : frais de livraison</strong>
                <p class="tm-hint">Pourcentage du montant des articles, ajouté à chaque commande. Il s'applique aux nouvelles commandes.</p>
                <div class="tm-search" style="margin:8px 0 0;">
                    <input id="tmRate" type="number" min="0" max="50" step="0.5" inputmode="decimal" value="${state.rate != null ? (state.rate * 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''}" aria-label="Pourcentage">
                    <button class="btn-submit" onclick="tmSetRate()">Enregistrer</button>
                </div>
                <p class="tm-msg" id="tmM-rate" hidden></p>
            </div>
            <div class="dl-card tm-team-add">
                <strong><i class="fas fa-user-plus"></i> Ajouter un membre</strong>
                <p class="tm-hint">La personne doit d'abord se connecter une fois sur Ouenze (avec son numéro ou son email).</p>
                <input id="tmWho" placeholder="Numéro (06 123 45 67) ou email">
                <div class="tm-role">
                    <label><input type="radio" name="tmRole" value="agent" checked><span><b>Agent</b><small>Commandes : appeler, confirmer, annuler, payée</small></span></label>
                    <label><input type="radio" name="tmRole" value="admin"><span><b>Admin</b><small>Tout, y compris l'équipe, les vendeurs et les livreurs</small></span></label>
                </div>
                <button class="btn-submit" onclick="tmAdd()"><i class="fas fa-plus"></i> Ajouter</button>
                <p class="tm-msg" id="tmM-team" hidden></p>
            </div>
            ${state.members.map(m => `<div class="dl-card tm-member">
                <span class="tm-avatar"><i class="fas ${m.role === 'admin' ? 'fa-user-shield' : 'fa-headset'}"></i></span>
                <div><strong>${esc(m.label)}</strong><small>${m.role === 'admin' ? 'Admin' : 'Agent'}${m.phone ? ' · ' + esc(m.phone) : ''}${m.email ? ' · ' + esc(m.email) : ''}</small></div>
                <button class="btn-cancel tm-danger-text" onclick="tmRemove('${esc(m.user_id)}', '${esc(String(m.label).replace(/'/g, ' '))}')">Retirer</button>
            </div>`).join('')}`;
    }

    async function loadMembers() {
        const [{ data, error }, rate] = await Promise.all([rpc('team_list'), rpc('delivery_rate')]);
        state.members = error ? [] : data || [];
        state.rate = rate.error ? null : Number(rate.data);
    }

    async function tmSetRate() {
        const v = Number(String(document.getElementById('tmRate')?.value || '').replace(',', '.'));
        if (!Number.isFinite(v) || v < 0 || v > 50) return flash('rate', 'Choisis un pourcentage entre 0 et 50.', false);
        if (!await ask({ title: `Frais de livraison à ${v.toLocaleString('fr-FR')} % ?`, text: 'Les nouvelles commandes utiliseront ce pourcentage.', ok: 'Enregistrer' })) return;
        const { data, error } = await rpc('set_delivery_rate', { percent: v });
        if (error) return flash('rate', /set_delivery_rate|schema cache/i.test(error.message) ? 'Exécute d\'abord la migration 20261102_delivery_rate.sql.' : error.message, false);
        state.rate = Number(data);
        flash('rate', `Enregistré : ${(state.rate * 100).toLocaleString('fr-FR')} % pour les nouvelles commandes.`, true);
    }

    async function tmAdd() {
        const who = (document.getElementById('tmWho')?.value || '').trim();
        const role = document.querySelector('input[name="tmRole"]:checked')?.value || 'agent';
        if (who.length < 5) return flash('team', 'Indique un numéro ou un email.', false);
        const { data, error } = await rpc('team_add', { who, new_role: role });
        if (error) return flash('team', error.message, false);
        await loadMembers();
        render();
        flash('team', `${data || 'Membre'} ajouté comme ${role === 'admin' ? 'admin' : 'agent'}.`, true);
    }

    async function tmRemove(uid, label) {
        if (!await ask({ title: `Retirer ${label} ?`, text: 'Cette personne n\'aura plus accès à l\'Espace équipe.', ok: 'Retirer', danger: true })) return;
        const { error } = await rpc('team_remove', { target: uid });
        if (error) return flash('team', error.message, false);
        await loadMembers();
        render();
    }

    // ---------- Démarrage ----------
    async function init() {
        if (!window.supabase?.auth) { message('<p>Service indisponible.</p>'); return; }
        const { data } = await window.supabase.auth.getSession();
        if (!data?.session) {
            message(`<i class="fas fa-lock"></i><h3>Espace équipe</h3><p>Connecte-toi avec ton compte Ouenze.</p>
                <button class="btn-submit" onclick="openLoginModal()">Se connecter</button>`);
            window.supabase.auth.onAuthStateChange(event => { if (event === 'SIGNED_IN') location.reload(); });
            return;
        }
        const { data: role, error } = await rpc('my_team_role');
        if (error) {
            message(/my_team_role|schema cache|does not exist/i.test(error.message || '')
                ? '<i class="fas fa-tools"></i><h3>Base de données à mettre à jour</h3><p>Exécute la migration 20261030_team_space.sql dans Supabase.</p>'
                : '<p>Chargement impossible : ' + esc(error.message) + '</p>');
            return;
        }
        if (!role) {
            message(`<i class="fas fa-ban"></i><h3>Accès réservé à l'équipe</h3><p>Demande à un administrateur Ouenze de t'ajouter.</p>
                <a class="btn-submit" href="index.html">Retour à l'accueil</a>`);
            return;
        }
        state.role = role;
        await refresh();
        render();
        state.timer = setInterval(() => { if (!document.hidden && !document.querySelector('.tm-dialog')) refresh(); }, 60000);
    }

    Object.assign(window, { tmTab, tmSearch, tmConfirm, tmNote, tmPaid, tmPayLink, tmSetRate, tmCancel, tmHistory, tmAdd, tmRemove });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
