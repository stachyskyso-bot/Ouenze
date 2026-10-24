// ============================================================
// ADMIN-REPORTS.JS — Signalements de vendeurs et de livreurs (admin-reports.html)
//
// RPC admin_reports (liste) et handle_report (traité / sans suite / rouvrir), migration 20261028.
// Pour suspendre un vendeur ou un livreur : pages Vendeurs et Livreurs.
// ============================================================

(function () {
    'use strict';

    const REASONS = {
        retard: 'Retard', colis_abime: 'Colis abîmé', non_conforme: 'Produit non conforme', comportement: 'Comportement',
        injoignable: 'Injoignable', arnaque: 'Arnaque', autre: 'Autre'
    };
    const STATUS = { open: ['À traiter', 'pending'], handled: ['Traité', 'approved'], dismissed: ['Sans suite', 'suspended'] };
    let reports = [];
    let currentTab = 'open';

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const digits = p => String(p || '').replace(/\D/g, '');
    // Numéro pour WhatsApp : chiffres avec indicatif (06… → 24206…)
    const waNum = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 9 && d.startsWith('0') ? '242' + d : d; };
    const box = () => document.getElementById('adminApp');

    function message(html) {
        box().innerHTML = `<div class="dl-card"><div class="dl-status">${html}</div></div>`;
    }

    function card(r) {
        const id = esc(r.id);
        const st = STATUS[r.status] || [r.status, 'pending'];
        const isCourier = r.target_kind === 'courier';
        const who = isCourier ? `Livreur : ${r.courier_name || 'inconnu'}` : `Boutique : ${r.shop_name || 'inconnue'}`;
        const tel = digits(isCourier ? r.courier_phone : '');
        const rtel = digits(r.reporter_phone);
        return `<div class="dl-card rp-item">
            <div class="rp-head">
                <strong><i class="fas ${isCourier ? 'fa-motorcycle' : 'fa-store'}"></i> ${esc(who)}</strong>
                <span class="adm-badge ${st[1]}">${st[0]}</span>
            </div>
            <p class="rp-reason"><b>${esc(REASONS[r.reason] || r.reason)}</b>${r.order_number ? ` · commande ${esc(r.order_number)}` : ''}
                · ${new Date(r.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</p>
            ${r.details ? `<blockquote class="rp-details">${esc(r.details)}</blockquote>` : ''}
            <p class="rp-meta">Signalé par ${esc(r.reporter_name || 'un utilisateur')}${rtel ? ` · <a href="https://wa.me/${waNum(rtel)}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> Appeler ${esc(r.reporter_phone)}</a>` : ''}
                ${Number(r.target_total) > 1 ? ` · <b class="rp-count">${r.target_total} signalements au total</b>` : ''}</p>
            ${tel ? `<p class="rp-meta">Livreur : <a href="https://wa.me/${waNum(tel)}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> Appeler ${esc(r.courier_phone)}</a></p>` : ''}
            <input class="rp-note" id="rpN-${id}" value="${esc(r.admin_note || '')}" placeholder="Note interne (ce que tu as fait)">
            <div class="rp-actions">
                ${r.status === 'open' ? `
                    <button class="btn-submit" onclick="rpSet('${id}', 'handled')"><i class="fas fa-check"></i> Traité</button>
                    <button class="btn-cancel" onclick="rpSet('${id}', 'dismissed')">Sans suite</button>`
                : `<button class="btn-cancel" onclick="rpSet('${id}', 'open')">Rouvrir</button>`}
                <a class="btn-cancel" href="${isCourier ? 'admin-deliverers.html' : 'admin-vendors.html'}">${isCourier ? 'Gérer les livreurs' : 'Gérer les vendeurs'}</a>
            </div>
            <p class="rp-msg" id="rpM-${id}" hidden></p>
        </div>`;
    }

    function render() {
        const open = reports.filter(r => r.status === 'open');
        const list = currentTab === 'open' ? open : currentTab === 'all' ? reports : reports.filter(r => r.status !== 'open');
        box().innerHTML = `
            <div class="adm-stats">
                <div class="adm-stat"><strong style="color:var(--danger);">${open.length}</strong><span>À traiter</span></div>
                <div class="adm-stat"><strong>${reports.filter(r => r.target_kind === 'vendor').length}</strong><span>Vendeurs</span></div>
                <div class="adm-stat"><strong>${reports.filter(r => r.target_kind === 'courier').length}</strong><span>Livreurs</span></div>
            </div>
            <div class="adm-tabs">
                ${[['open', 'À traiter'], ['closed', 'Traités'], ['all', 'Tous']].map(([k, l]) =>
                    `<button class="adm-tab ${k === currentTab ? 'active' : ''}" onclick="rpTab('${k}')">${l}</button>`).join('')}
            </div>
            ${list.length ? list.map(card).join('')
                : `<div class="dl-card" style="text-align:center;color:var(--gray-500);">${currentTab === 'open' ? 'Aucun signalement à traiter.' : 'Rien ici.'}</div>`}`;
    }

    async function rpSet(id, status) {
        const note = (document.getElementById(`rpN-${id}`)?.value || '').trim();
        const msg = document.getElementById(`rpM-${id}`);
        const { error } = await window.supabase.rpc('handle_report', { target_report: id, new_status: status, note: note || null });
        if (error) { msg.hidden = false; msg.textContent = 'Échec : ' + error.message; return; }
        const r = reports.find(x => x.id === id);
        if (r) Object.assign(r, { status, admin_note: note });
        render();
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
        const { data: rows, error } = await window.supabase.rpc('admin_reports');
        if (error) {
            message(/admin_reports|schema cache|does not exist/i.test(error.message || '')
                ? '<i class="fas fa-tools"></i><h3>Base de données à mettre à jour</h3><p>Exécute la migration 20261028_reports.sql dans Supabase.</p>'
                : '<p>Chargement impossible : ' + esc(error.message) + '</p>');
            return;
        }
        reports = rows || [];
        render();
    }

    Object.assign(window, { rpTab: k => { currentTab = k; render(); }, rpSet });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
