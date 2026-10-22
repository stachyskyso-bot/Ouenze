// ============================================================
// ADMIN-CALLS.JS — Centre d'appel (admin-calls.html)
//
// Le client ne place plus sa position sur une carte : Ouenze l'appelle pour confirmer
// le quartier, la rue et un repère. RPC call_center_orders (liste) et
// confirm_order_address (validation), migration 20261026. Réservé aux admins.
// ============================================================

(function () {
    'use strict';

    const STATUS = {
        pending: 'Nouvelle', confirmed: 'Acceptée', preparing: 'En préparation', ready: 'Prête',
        courier_assigned: 'Livreur en route', picked_up: 'Récupérée', in_transit: 'En livraison',
        delivered: 'Livrée', cancelled: 'Annulée', rejected: 'Refusée'
    };
    let orders = [];
    let currentTab = 'todo';

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const digits = p => String(p || '').replace(/\D/g, '');
    const box = () => document.getElementById('adminApp');
    const money = n => `${Number(n || 0).toLocaleString('fr-FR')} FCFA`;

    function message(html) {
        box().innerHTML = `<div class="dl-card"><div class="dl-status">${html}</div></div>`;
    }

    function orderCard(o) {
        const id = esc(o.order_id);
        const phone = digits(o.phone);
        const done = !!o.address_confirmed;
        return `<div class="dl-card ac-order" id="ac-${id}">
            <div class="ac-head">
                <strong>${esc(o.order_number)} · ${esc(o.client_name || 'Client')}</strong>
                <span class="adm-badge ${done ? 'approved' : 'pending'}">${done ? 'Adresse confirmée' : 'À appeler'}</span>
            </div>
            <small class="ac-meta">${esc(o.shop_name || '')} · ${money(o.total)} · ${STATUS[o.status] || esc(o.status)}
                · ${new Date(o.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</small>
            <div class="ac-actions">
                ${phone ? `<a class="btn-submit" href="tel:+${phone}"><i class="fas fa-phone"></i> Appeler ${esc(o.phone)}</a>
                <a class="btn-cancel" href="https://wa.me/${phone}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> WhatsApp</a>`
                : '<span class="ac-warn">Pas de numéro</span>'}
            </div>
            <div class="ac-fields">
                <label>Ville<input value="${esc(o.city || '')}" disabled></label>
                <label>Quartier<input id="acD-${id}" value="${esc(o.district || '')}"></label>
                <label>Rue / numéro<input id="acS-${id}" value="${esc(o.street || '')}"></label>
                <label>Repère<input id="acL-${id}" value="${esc(o.landmark || '')}" placeholder="Ex. derrière l'église, portail bleu"></label>
                <label class="ac-wide">Note d'appel<input id="acN-${id}" value="${esc(o.call_note || '')}" placeholder="Ex. rappeler après 17 h"></label>
            </div>
            <button class="btn-submit ac-confirm" id="acB-${id}" onclick="acConfirm('${id}')">
                <i class="fas fa-check"></i> ${done ? 'Mettre à jour l\'adresse' : 'Adresse confirmée'}</button>
            <p class="ac-msg" id="acM-${id}" hidden></p>
        </div>`;
    }

    function renderList() {
        const todo = orders.filter(o => !o.address_confirmed);
        const list = currentTab === 'todo' ? todo : orders.filter(o => o.address_confirmed);
        box().innerHTML = `
            <div class="adm-stats">
                <div class="adm-stat"><strong style="color:var(--warning);">${todo.length}</strong><span>À appeler</span></div>
                <div class="adm-stat"><strong style="color:var(--success);">${orders.length - todo.length}</strong><span>Confirmées</span></div>
            </div>
            <div class="adm-tabs">
                ${[['todo', 'À appeler'], ['done', 'Confirmées']].map(([k, l]) =>
                    `<button class="adm-tab ${k === currentTab ? 'active' : ''}" onclick="acTab('${k}')">${l}</button>`).join('')}
                <button class="adm-tab" onclick="acReload()"><i class="fas fa-sync-alt"></i> Actualiser</button>
            </div>
            ${list.length ? list.map(orderCard).join('')
                : `<div class="dl-card" style="text-align:center;color:var(--gray-500);">${currentTab === 'todo' ? 'Aucun client à appeler pour le moment.' : 'Aucune adresse confirmée.'}</div>`}`;
    }

    async function acConfirm(id) {
        const val = k => (document.getElementById(`ac${k}-${id}`)?.value || '').trim();
        const msg = document.getElementById(`acM-${id}`);
        const btn = document.getElementById(`acB-${id}`);
        const show = (text, ok) => { msg.hidden = false; msg.textContent = text; msg.className = 'ac-msg ' + (ok ? 'ok' : 'err'); };
        if (!val('D')) { show('Le quartier est obligatoire.', false); return; }
        btn.disabled = true;
        const { error } = await window.supabase.rpc('confirm_order_address', {
            target_order: id, new_district: val('D'), new_street: val('S') || null, new_landmark: val('L') || null, note: val('N') || null
        });
        btn.disabled = false;
        if (error) { show('Échec : ' + error.message, false); return; }
        const o = orders.find(x => x.order_id === id);
        if (o) Object.assign(o, { address_confirmed: true, district: val('D'), street: val('S'), landmark: val('L'), call_note: val('N') });
        show('Adresse confirmée. Le vendeur et le livreur voient la nouvelle adresse.', true);
        setTimeout(renderList, 1200);
    }

    async function load() {
        const { data, error } = await window.supabase.rpc('call_center_orders');
        if (error) {
            message(/call_center_orders|schema cache|does not exist/i.test(error.message || '')
                ? '<i class="fas fa-tools"></i><h3>Base de données à mettre à jour</h3><p>Exécute la migration 20261026_simple_checkout.sql dans Supabase.</p>'
                : '<p>Chargement impossible : ' + esc(error.message) + '</p>');
            return;
        }
        orders = data || [];
        renderList();
    }

    async function init() {
        if (!window.supabase?.auth) { message('<p>Service indisponible.</p>'); return; }
        const { data } = await window.supabase.auth.getSession();
        if (!data?.session) {
            message(`<i class="fas fa-lock"></i><h3>Espace administrateur</h3><p>Connecte-toi avec ton compte administrateur.</p>
                <button class="btn-submit" onclick="openEmailLoginModal()">Se connecter</button>`);
            window.supabase.auth.onAuthStateChange(event => { if (event === 'SIGNED_IN') location.reload(); });
            return;
        }
        const { data: isAdmin, error: adminError } = await window.supabase.rpc('is_admin');
        if (adminError || !isAdmin) {
            message(`<i class="fas fa-ban"></i><h3>Accès réservé</h3><p>Ce compte n'est pas administrateur.</p>
                <a class="btn-submit" href="index.html">Retour à l'accueil</a>`);
            return;
        }
        await load();
    }

    Object.assign(window, {
        acTab: k => { currentTab = k; renderList(); },
        acReload: load,
        acConfirm
    });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
