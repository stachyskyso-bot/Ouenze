// ============================================================
// NOTIFICATIONS.JS — page notifications.html
//
// Sources (Supabase, migration 20261018_notifications.sql) :
//   • my_notifications()        → mes notifications + état ACTUEL de la commande liée
//   • vendor_orders()           → détail des commandes reçues (articles, net, quartier)
//   • vendor_order_decision()   → accepter / refuser depuis la notification
//   • mark_notifications_read() → marquer comme lu
// Les notifications sont créées par la base (triggers) : nouvelle commande, décision,
// livraison, annulation, avis boutique, note livreur.
// ============================================================

(function () {
    'use strict';

    const FILTERS = { all: 'Toutes', unread: 'Non lues', orders: 'Commandes', reviews: 'Avis' };
    const KINDS = {
        new_order: { icon: 'fa-shopping-bag', tone: 'action', group: 'orders' },
        order_cancelled: { icon: 'fa-ban', tone: 'ko', group: 'orders' },
        order_accepted: { icon: 'fa-check-circle', tone: 'ok', group: 'orders' },
        order_refused: { icon: 'fa-times-circle', tone: 'ko', group: 'orders' },
        order_courier: { icon: 'fa-motorcycle', tone: 'info', group: 'orders' },
        order_in_transit: { icon: 'fa-route', tone: 'info', group: 'orders' },
        order_delivered: { icon: 'fa-box-open', tone: 'ok', group: 'orders' },
        order_pickup: { icon: 'fa-motorcycle', tone: 'info', group: 'orders' },
        delivery_offer: { icon: 'fa-motorcycle', tone: 'action', group: 'orders' },
        delivery_assigned: { icon: 'fa-address-book', tone: 'info', group: 'orders' },
        vendor_application: { icon: 'fa-store', tone: 'action', group: 'orders' },
        courier_application: { icon: 'fa-motorcycle', tone: 'action', group: 'orders' },
        vendor_approved: { icon: 'fa-store', tone: 'ok', group: 'orders' },
        vendor_rejected: { icon: 'fa-store', tone: 'ko', group: 'orders' },
        vendor_suspended: { icon: 'fa-ban', tone: 'ko', group: 'orders' },
        team_new_order: { icon: 'fa-headset', tone: 'action', group: 'orders' },
        team_added: { icon: 'fa-headset', tone: 'ok', group: 'orders' },
        report: { icon: 'fa-flag', tone: 'ko', group: 'orders' },
        trade: { icon: 'fa-chart-line', tone: 'info', group: 'orders' },
        order_paid: { icon: 'fa-wallet', tone: 'ok', group: 'orders' },
        shop_review: { icon: 'fa-star', tone: 'star', group: 'reviews' },
        courier_review: { icon: 'fa-star', tone: 'star', group: 'reviews' }
    };
    const STATUS = {
        pending: 'En attente de ta réponse', accepted: 'Acceptée', courier_assigned: 'Livreur en route', picked_up: 'Récupérée',
        in_transit: 'En livraison', delivered: 'Livrée', refused: 'Refusée', cancelled: 'Annulée par le client'
    };
    const state = { user: null, items: [], orders: new Map(), filter: 'all', busy: false };
    const box = () => document.getElementById('notifContainer');

    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fcfa = n => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} FCFA`;

    function ago(date) {
        const s = Math.max(0, (Date.now() - new Date(date)) / 1000);
        if (s < 60) return "à l'instant";
        if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
        if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
        if (s < 7 * 86400) return `il y a ${Math.floor(s / 86400)} j`;
        return new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    // ---------- Données ----------
    async function load() {
        const { data, error } = await window.supabase.rpc('my_notifications', { max_rows: 100 });
        if (error) {
            state.items = null;
            state.error = /my_notifications|Could not find|does not exist|schema cache/i.test(error.message || '')
                ? 'Les notifications arrivent bientôt (base de données à mettre à jour).'
                : (error.message || 'Impossible de charger les notifications.');
            return;
        }
        state.items = data || [];
        state.orders = new Map();
        if (state.items.some(n => n.kind === 'new_order' && n.is_shop_owner)) {
            const { data: ord } = await window.supabase.rpc('vendor_orders');
            (ord || []).forEach(o => state.orders.set(o.order_id, o));
        }
    }

    // ---------- Affichage ----------
    function visible() {
        return (state.items || []).filter(n => state.filter === 'all'
            || (state.filter === 'unread' && !n.read_at)
            || KINDS[n.kind]?.group === state.filter);
    }

    function orderDetail(n) {
        const o = state.orders.get(n.order_id);
        if (!o) return '';
        const items = (o.items || []).map(i => `<li><span class="notif-item">${esc(i.name)}${i.variant ? ` <small>(${esc(i.variant)})</small>` : ''} × ${Number(i.quantity) || 1}</span>
            <span>${fcfa(i.total)}</span></li>`).join('');
        const rate = Number(o.commission_rate) || 0;
        const sub = Number(o.subtotal) || 0;
        const place = [o.district, o.city].filter(Boolean).join(', ');
        return `<div class="notif-order">
            <ul>${items}</ul>
            <div class="notif-order-sum">
                <span>Ventes</span><strong>${fcfa(sub)}</strong>
                ${rate ? `<span>Commission Ouenze (${(rate * 100).toLocaleString('fr-FR')} %)</span><strong>− ${fcfa(sub * rate)}</strong>
                <span>Tu recevras</span><strong class="ok">${fcfa(sub * (1 - rate))}</strong>` : ''}
            </div>
            ${place ? `<p class="notif-order-place"><i class="fas fa-map-marker-alt"></i> ${esc(place)}${o.client_name ? ` · ${esc(o.client_name)}` : ''}</p>` : ''}
        </div>`;
    }

    function actions(n) {
        const id = esc(n.id);
        const order = esc(n.order_id);
        if (n.kind === 'new_order' && n.is_shop_owner) {
            if (n.order_status === 'pending') {
                return `<div class="notif-actions">
                    <button class="notif-btn ok" onclick="notifDecide('${id}', '${order}', 'accept')"><i class="fas fa-check"></i> Accepter</button>
                    <button class="notif-btn" onclick="notifDecide('${id}', '${order}', 'refuse')"><i class="fas fa-times"></i> Refuser</button>
                </div>`;
            }
            if (n.order_status === 'accepted') {
                return '<span class="notif-status">En attente d\'un livreur : c\'est lui qui confirme la livraison avec le code du client.</span>';
            }
            return '';
        }
        if (n.kind === 'team_new_order' || n.kind === 'team_added') {
            return `<div class="notif-actions"><a class="notif-btn ok" href="equipe.html" onclick="notifRead('${id}')"><i class="fas fa-headset"></i> Ouvrir l'Espace équipe</a></div>`;
        }
        if (n.kind === 'trade') {
            return `<div class="notif-actions"><a class="notif-btn ok" href="trade.html" onclick="notifRead('${id}')"><i class="fas fa-chart-line"></i> Ouvrir Ouenze Trade</a></div>`;
        }
        if (n.kind === 'report') {
            return `<div class="notif-actions"><a class="notif-btn ok" href="admin-reports.html" onclick="notifRead('${id}')"><i class="fas fa-flag"></i> Voir les signalements</a></div>`;
        }
        if (n.kind === 'vendor_application') {
            return `<div class="notif-actions"><a class="notif-btn ok" href="admin-vendors.html" onclick="notifRead('${id}')"><i class="fas fa-user-check"></i> Voir les demandes</a></div>`;
        }
        if (n.kind === 'courier_application') {
            return `<div class="notif-actions"><a class="notif-btn ok" href="admin-deliverers.html" onclick="notifRead('${id}')"><i class="fas fa-user-check"></i> Voir les candidatures</a></div>`;
        }
        if (n.kind === 'vendor_approved') {
            return `<div class="notif-actions"><a class="notif-btn ok" href="shop-designer.html" onclick="notifRead('${id}')"><i class="fas fa-store"></i> Créer ma boutique</a></div>`;
        }
        if (n.kind === 'vendor_rejected') {
            return `<div class="notif-actions"><a class="notif-btn" href="vendor-register.html" onclick="notifRead('${id}')"><i class="fas fa-edit"></i> Compléter ma demande</a></div>`;
        }
        if (n.kind === 'delivery_offer') {
            return n.order_status === 'accepted'
                ? `<div class="notif-actions"><a class="notif-btn ok" href="delivery-dashboard.html" onclick="notifRead('${id}')"><i class="fas fa-motorcycle"></i> Voir la course</a></div>`
                : '<span class="notif-status">Déjà prise par un livreur</span>';
        }
        if (n.kind === 'delivery_assigned') {
            return `<div class="notif-actions"><a class="notif-btn ok" href="delivery-dashboard.html" onclick="notifRead('${id}')"><i class="fas fa-motorcycle"></i> Ouvrir mes courses</a></div>`;
        }
        if (n.kind === 'order_delivered' && n.order_id) {
            return `<div class="notif-actions"><button class="notif-btn primary" onclick="notifRate('${id}', '${order}')"><i class="fas fa-star"></i> Noter la boutique et le livreur</button></div>`;
        }
        if (['order_accepted', 'order_courier', 'order_in_transit'].includes(n.kind) && n.order_id
            && !['delivered', 'cancelled', 'refused'].includes(n.order_status)) {
            return `<div class="notif-actions"><a class="notif-btn" href="tracking.html?order=${encodeURIComponent(n.order_id)}" onclick="notifRead('${id}')"><i class="fas fa-route"></i> Suivre</a></div>`;
        }
        return '';
    }

    function cardHtml(n) {
        const k = KINDS[n.kind] || { icon: 'fa-bell', tone: 'info' };
        const pendingOrder = n.kind === 'new_order' && n.is_shop_owner && n.order_status === 'pending';
        const status = n.kind === 'new_order' && n.order_status && !pendingOrder ? `<span class="notif-status">${esc(STATUS[n.order_status] || n.order_status)}</span>` : '';
        return `<article class="notif-card tone-${k.tone} ${n.read_at ? '' : 'unread'}" data-id="${esc(n.id)}" onclick="notifRead('${esc(n.id)}')">
            <div class="notif-icon"><i class="fas ${k.icon}"></i></div>
            <div class="notif-body">
                <div class="notif-top"><strong>${esc(n.title)}</strong><time datetime="${esc(n.created_at)}">${ago(n.created_at)}</time></div>
                ${n.body ? `<p>${esc(pendingOrder || n.kind !== 'new_order' ? n.body : n.body.replace(/ ?Accepte-la ou refuse-la\.$/, ''))}</p>` : ''}
                ${status}
                ${pendingOrder ? orderDetail(n) : ''}
                ${actions(n)}
            </div>
        </article>`;
    }

    function render() {
        const el = box();
        if (!el) return;
        if (state.items === null) {
            el.innerHTML = `<div class="notif-empty"><i class="fas fa-tools"></i><p>${esc(state.error)}</p></div>`;
            return;
        }
        const unread = state.items.filter(n => !n.read_at).length;
        const toDo = state.items.filter(n => n.kind === 'new_order' && n.is_shop_owner && n.order_status === 'pending').length;
        document.getElementById('notifReadAll').hidden = !unread;
        const list = visible();
        el.innerHTML = `
            ${toDo ? `<div class="notif-todo"><i class="fas fa-exclamation-circle"></i> ${toDo} commande${toDo > 1 ? 's' : ''} attend${toDo > 1 ? 'ent' : ''} ta réponse.</div>` : ''}
            <div class="notif-filters" role="tablist">
                ${Object.entries(FILTERS).map(([key, label]) => `<button role="tab" aria-selected="${state.filter === key}" class="${state.filter === key ? 'active' : ''}" onclick="notifFilter('${key}')">${label}${key === 'unread' && unread ? ` (${unread})` : ''}</button>`).join('')}
            </div>
            ${list.length ? list.map(cardHtml).join('') : `<div class="notif-empty"><i class="far fa-bell"></i>
                <p>${state.filter === 'all' ? 'Aucune notification pour le moment. Tes commandes, ventes et avis apparaîtront ici.' : 'Rien dans cette catégorie.'}</p></div>`}`;
    }

    // ---------- Actions ----------
    async function markRead(ids) {
        const { error } = await window.supabase.rpc('mark_notifications_read', { ids });
        if (error) return;
        const now = new Date().toISOString();
        state.items.forEach(n => { if (!n.read_at && (!ids || ids.includes(n.id))) n.read_at = now; });
        window.refreshNotifCount?.();
    }

    async function notifRead(id) {
        const n = (state.items || []).find(x => x.id === id);
        if (!n || n.read_at) return;
        await markRead([id]);
        const card = document.querySelector(`.notif-card[data-id="${CSS.escape(id)}"]`);
        if (card) card.classList.remove('unread');
        const btn = document.getElementById('notifReadAll');
        if (btn) btn.hidden = !state.items.some(x => !x.read_at);
    }

    async function notifReadAll() {
        await markRead(null);
        render();
    }

    async function notifDecide(id, orderId, decision) {
        if (state.busy) return;
        const o = state.orders.get(orderId);
        const label = o?.order_number || 'cette commande';
        let reason = null;
        if (decision === 'refuse') {
            reason = await uiPrompt('Pourquoi refuses-tu cette commande ? (le client verra le motif)', 'Produit en rupture de stock');
            if (reason === null) return;
        } else if (decision === 'accept') {
            if (!(await uiConfirm(`Accepter la commande ${label} ? Prépare les articles : un livreur va venir les récupérer.`, 'Accepter'))) return;
        } else return;
        state.busy = true;
        try {
            const { error } = await window.supabase.rpc('vendor_order_decision', { target_order: orderId, decision, reason });
            if (error) {
                // Boutique pas encore placée sur la carte : on l'envoie au tableau de bord pour la placer
                if (/carte/i.test(error.message || '')) {
                    if (await uiConfirm(error.message + '\n\nOuvrir le tableau de bord pour placer ta boutique ?', 'Ouvrir')) location.href = 'vendor-dashboard.html';
                } else {
                    alert(error.message || 'Action impossible.');
                }
                return;
            }
            // Email au client : n'empêche pas la décision s'il échoue
            try {
                const { error: mailError } = await window.supabase.functions.invoke('order-notify', { body: { action: 'decision', order_id: orderId } });
                if (mailError) console.warn('Email client non envoyé :', mailError.message || mailError);
            } catch (e) { console.warn('Email client non envoyé :', e); }
            await markRead([id]);
            await load();
            render();
        } finally {
            state.busy = false;
        }
    }

    async function notifRate(id, orderId) {
        notifRead(id);
        if (typeof window.openRateOrder === 'function') window.openRateOrder(orderId);
    }

    function notifFilter(key) {
        state.filter = FILTERS[key] ? key : 'all';
        render();
    }

    async function init() {
        if (!window.supabase?.rpc) {
            box().innerHTML = '<div class="notif-empty"><p>Service indisponible. Recharge la page.</p></div>';
            return;
        }
        const { data } = await window.supabase.auth.getSession();
        state.user = data?.session?.user || null;
        if (!state.user) {
            window.supabase.auth.onAuthStateChange?.(e => { if (e === 'SIGNED_IN') location.reload(); });
            box().innerHTML = `<div class="notif-empty"><i class="fas fa-user-lock"></i><h3>Connecte-toi pour voir tes notifications</h3>
                <button class="btn-submit" onclick="openLoginModal()">Se connecter</button></div>`;
            return;
        }
        await load();
        render();
        // Après une note, le bouton reste mais la fenêtre indiquera « tout est noté »
        document.addEventListener('ouenze:rated', () => window.refreshNotifCount?.());
        // Nouvelles notifications pendant que la page est ouverte
        setInterval(async () => {
            if (document.hidden || state.busy) return;
            const before = (state.items || []).map(n => n.id).join();
            await load();
            if ((state.items || []).map(n => n.id).join() !== before) render();
        }, 60000);
    }

    Object.assign(window, { notifRead, notifReadAll, notifDecide, notifRate, notifFilter });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
