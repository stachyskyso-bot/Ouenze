// ============================================================
// ADMIN-MARKET.JS — Administration de la bourse
//
// Accès : comptes listés dans public.admin_users (fonction is_admin()).
//   • Demandes d'entrée en bourse : ouvrir (après vérification sur place) ou refuser ; clôturer une offre
//   • Réservations de parts : confirmer le paiement reçu (référence obligatoire) en attendant pawaPay
// Toutes les actions passent par des fonctions de la base qui revérifient is_admin().
// ============================================================

(function () {
    'use strict';

    const LISTING = { pending: ['À vérifier', 'pending'], open: ['En bourse', 'approved'], closed: ['Clôturée', ''], rejected: ['Refusée', 'rejected'], cancelled: ['Annulée', 'rejected'] };
    const ORDER = { requested: ['À encaisser', 'pending'], paid: ['Payée', 'approved'], cancelled: ['Annulée', 'rejected'], refunded: ['Remboursée', 'rejected'] };
    let listings = [];
    let orders = [];
    let tab = 'listings';

    const box = () => document.getElementById('adminApp');
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fcfa = n => Math.round(Number(n) || 0).toLocaleString('fr-FR') + ' FCFA';
    const date = iso => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '');

    function message(html) {
        box().innerHTML = `<div class="dl-card"><div class="dl-status">${html}</div></div>`;
    }

    function render() {
        const pendingListings = listings.filter(l => l.status === 'pending').length;
        const toCollect = orders.filter(o => o.status === 'requested');
        box().innerHTML = `
            <div class="adm-stats">
                <div class="adm-stat"><strong style="color:var(--warning);">${pendingListings}</strong><span>Boutiques à vérifier</span></div>
                <div class="adm-stat"><strong style="color:var(--success);">${listings.filter(l => l.status === 'open').length}</strong><span>En bourse</span></div>
                <div class="adm-stat"><strong style="color:var(--primary);">${toCollect.length}</strong><span>Paiements à encaisser (${fcfa(toCollect.reduce((s, o) => s + Number(o.amount), 0))})</span></div>
            </div>
            <div class="adm-tabs">
                <button class="adm-tab ${tab === 'listings' ? 'active' : ''}" onclick="mkTab('listings')">Entrées en bourse</button>
                <button class="adm-tab ${tab === 'orders' ? 'active' : ''}" onclick="mkTab('orders')">Réservations de parts</button>
            </div>
            <div class="adm-list">${tab === 'listings' ? listingsHtml() : ordersHtml()}</div>`;
    }

    function listingsHtml() {
        if (!listings.length) return '<p style="text-align:center;color:var(--gray-500);padding:20px;">Aucune demande pour l\'instant.</p>';
        return listings.map(l => {
            const st = LISTING[l.status] || [l.status, ''];
            return `
            <div class="adm-item" style="cursor:default;flex-wrap:wrap;">
                <i class="fas fa-store" style="font-size:22px;color:var(--primary);"></i>
                <div class="adm-item-main">
                    <strong>${esc(l.shop_name)} <span class="adm-badge ${st[1]}">${st[0]}</span></strong>
                    <small>${esc(l.shop_city || '')} · ${Number(l.rating).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ★ · ${l.delivered_orders} commandes livrées · vendeur : <a href="mailto:${esc(l.owner_email)}">${esc(l.owner_email)}</a></small>
                    <small><strong>${Number(l.percent_offered).toLocaleString('fr-FR')} %</strong> (${Number(l.total_shares).toLocaleString('fr-FR')} parts) à <strong>${fcfa(l.price_per_share)}</strong> · valorisation ${fcfa(l.valuation)} · reste ${Number(l.remaining_shares).toLocaleString('fr-FR')} parts · demandé le ${date(l.created_at)}</small>
                    ${l.pitch ? `<small><em>« ${esc(l.pitch)} »</em></small>` : ''}
                    ${l.admin_note ? `<small>Note : ${esc(l.admin_note)}</small>` : ''}
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    ${l.status === 'pending' ? `
                        <button class="btn-submit" style="width:auto;padding:8px 14px;" onclick="mkReview('${esc(l.offering_id)}','open')">Ouvrir (vérifiée)</button>
                        <button class="btn-submit btn-light" style="width:auto;padding:8px 14px;" onclick="mkReview('${esc(l.offering_id)}','rejected')">Refuser</button>` : ''}
                    ${l.status === 'open' ? `<button class="btn-submit btn-light" style="width:auto;padding:8px 14px;" onclick="mkReview('${esc(l.offering_id)}','closed')">Clôturer</button>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    function ordersHtml() {
        if (!orders.length) return '<p style="text-align:center;color:var(--gray-500);padding:20px;">Aucune réservation pour l\'instant.</p>';
        return orders.map(o => {
            const st = ORDER[o.status] || [o.status, ''];
            return `
            <div class="adm-item" style="cursor:default;flex-wrap:wrap;">
                <i class="fas fa-chart-pie" style="font-size:22px;color:var(--primary);"></i>
                <div class="adm-item-main">
                    <strong>${Number(o.quantity).toLocaleString('fr-FR')} parts de ${esc(o.shop_name)} — ${fcfa(o.amount)} <span class="adm-badge ${st[1]}">${st[0]}</span></strong>
                    <small>Investisseur : <a href="mailto:${esc(o.investor_email)}">${esc(o.investor_email)}</a> · réservé le ${date(o.created_at)}${o.paid_at ? ` · payé le ${date(o.paid_at)} (réf. ${esc(o.payment_ref)})` : ''}</small>
                </div>
                ${o.status === 'requested' ? `<button class="btn-submit" style="width:auto;padding:8px 14px;" onclick="mkConfirm('${esc(o.order_id)}')">Paiement reçu</button>` : ''}
            </div>`;
        }).join('');
    }

    async function mkReview(id, decision) {
        const l = listings.find(x => x.offering_id === id);
        const labels = { open: `Ouvrir « ${l?.shop_name} » aux investisseurs ? Confirme que la boutique a été vérifiée sur place.`, rejected: `Refuser la demande de « ${l?.shop_name} » ?`, closed: `Clôturer l'offre de « ${l?.shop_name} » ? Les réservations non payées seront annulées.` };
        if (!confirm(labels[decision])) return;
        const note = decision === 'open' ? null : prompt('Note (motif, visible par l\'équipe) :', '') ?? null;
        const { error } = await window.supabase.rpc('review_listing', { offering: id, decision, note });
        if (error) { alert(error.message); return; }
        await load();
        render();
    }

    async function mkConfirm(id) {
        const o = orders.find(x => x.order_id === id);
        const ref = prompt(`Paiement de ${fcfa(o?.amount)} reçu de ${o?.investor_email} ?\nRéférence de la transaction Mobile Money :`, '');
        if (ref === null) return;
        if (!ref.trim()) { alert('La référence de paiement est obligatoire.'); return; }
        const { error } = await window.supabase.rpc('confirm_share_payment', { share_order: id, reference: ref.trim() });
        if (error) { alert(error.message); return; }
        await load();
        render();
    }

    function mkTab(t) { tab = t; render(); }

    async function load() {
        const [l, o] = await Promise.all([window.supabase.rpc('admin_listings'), window.supabase.rpc('admin_share_orders')]);
        if (l.error || o.error) throw (l.error || o.error);
        listings = l.data || [];
        orders = o.data || [];
    }

    async function init() {
        const { data } = await window.supabase.auth.getSession();
        if (!data?.session) { message('<h3>Connecte-toi</h3><p>Page réservée à l\'équipe Ouenze.</p><button class="btn-submit" onclick="openLoginModal()">Se connecter</button>'); return; }
        const { data: admin } = await window.supabase.rpc('is_admin');
        if (!admin) { message('<h3>Accès refusé</h3><p>Page réservée à l\'équipe Ouenze.</p>'); return; }
        try {
            await load();
            render();
        } catch (e) {
            console.error('❌ Admin bourse :', e);
            message(/function|does not exist|Could not find/i.test(e?.message || '')
                ? '<h3>Bourse pas encore activée</h3><p>Exécute <code>supabase/migrations/20261014_stock_market.sql</code> dans Supabase → SQL Editor.</p>'
                : `<h3>Erreur</h3><p>${esc(e?.message || 'Chargement impossible.')}</p>`);
        }
    }

    Object.assign(window, { mkTab, mkReview, mkConfirm });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
