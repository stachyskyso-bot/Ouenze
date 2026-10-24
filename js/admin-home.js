// ============================================================
// ADMIN-HOME.JS — Tableau de bord admin (admin.html)
//
// Ce qui attend une action (commandes à appeler, demandes, signalements, Trade…)
// et les chiffres du jour et de la semaine. Données : RPC admin_overview (migration 20261103),
// réservée aux admins. Actualisé toutes les minutes.
// ============================================================

(function () {
    'use strict';

    const box = () => document.getElementById('adminHome');
    const num = v => Math.round(Number(v) || 0).toLocaleString('fr-FR');
    const fcfa = v => `${num(v)} FCFA`;
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function message(html) {
        box().innerHTML = `<div class="dl-card"><div class="dl-status">${html}</div></div>`;
    }

    function todo(d) {
        const items = [
            ['equipe.html', 'fa-phone-alt', d.to_call, 'Commande(s) à appeler', 'Confirmer l\'adresse avec le client'],
            ['admin-vendors.html', 'fa-store', d.vendor_apps, 'Demande(s) vendeur', 'À vérifier et valider'],
            ['admin-deliverers.html', 'fa-motorcycle', d.courier_apps, 'Candidature(s) livreur', 'Permis et véhicule à vérifier'],
            ['admin-reports.html', 'fa-flag', d.reports, 'Signalement(s) ouvert(s)', 'Vendeurs ou livreurs signalés'],
            ['equipe.html', 'fa-wallet', d.to_pay, 'Livrée(s) non payée(s)', 'Relancer le paiement ou marquer payée'],
            ['trade.html', 'fa-chart-line', d.trade_review, 'Opération(s) Trade à vérifier', 'Simulation'],
            ['trade.html', 'fa-receipt', d.trade_pending_lines, 'Justificatif(s) Trade à valider', 'Dépenses et ventes déclarées']
        ];
        const open = items.filter(i => Number(i[2]) > 0);
        if (!open.length) return '<div class="dl-card ah-clear"><i class="fas fa-check-circle"></i> Rien à traiter pour le moment.</div>';
        return `<div class="ah-todo">${open.map(([href, icon, n, label, sub]) => `
            <a class="ah-todo-item" href="${href}">
                <span class="ah-todo-ico"><i class="fas ${icon}"></i></span>
                <span class="ah-todo-txt"><b>${num(n)} ${esc(label)}</b><small>${esc(sub)}</small></span>
                <i class="fas fa-chevron-right"></i>
            </a>`).join('')}</div>`;
    }

    function render(d) {
        const live = d.orders_mode === 'live';
        box().innerHTML = `
            <div class="ah-mode ${live ? 'live' : 'test'}">
                <i class="fas ${live ? 'fa-circle' : 'fa-flask'}"></i>
                ${live ? '<b>Commandes ouvertes au public</b>' : `<b>Mode ${d.orders_mode === 'test' ? 'test (admins seulement)' : 'test ouvert'}</b> : les commandes sont marquées TEST`}
                · frais de livraison ${(Number(d.delivery_rate) * 100).toLocaleString('fr-FR')} %
            </div>

            <h3 class="ah-h">À traiter</h3>
            ${todo(d)}

            <h3 class="ah-h">Aujourd'hui et cette semaine</h3>
            <div class="ah-kpis">
                <div><span>Commandes aujourd'hui</span><b>${num(d.orders_today)}</b><small>${num(d.orders_week)} sur 7 jours</small></div>
                <div><span>Ventes aujourd'hui</span><b>${fcfa(d.sales_today)}</b><small>${fcfa(d.sales_week)} sur 7 jours</small></div>
                <div><span>Encaissé (7 jours)</span><b>${fcfa(d.paid_week)}</b><small>commandes payées</small></div>
                <div><span>Livrées (7 jours)</span><b>${num(d.delivered_week)}</b><small>${num(d.to_pay)} à payer</small></div>
            </div>

            <h3 class="ah-h">En ce moment</h3>
            <div class="ah-kpis">
                <div><span>Attendent le vendeur</span><b>${num(d.waiting_vendor)}</b><small>à accepter</small></div>
                <div><span>Attendent un livreur</span><b>${num(d.waiting_courier)}</b><small>acceptées</small></div>
                <div><span>En livraison</span><b>${num(d.in_delivery)}</b><small>livreur en route</small></div>
                <div><span>Livreurs en ligne</span><b>${num(d.couriers_online)}</b><small>${num(d.shops_active)} boutiques actives</small></div>
            </div>

            <h3 class="ah-h">Raccourcis</h3>
            <div class="ah-links">
                <a href="equipe.html"><i class="fas fa-headset"></i> Espace équipe</a>
                <a href="admin-vendors.html"><i class="fas fa-store"></i> Vendeurs</a>
                <a href="admin-deliverers.html"><i class="fas fa-motorcycle"></i> Livreurs</a>
                <a href="admin-reports.html"><i class="fas fa-flag"></i> Signalements</a>
                <a href="trade.html"><i class="fas fa-chart-line"></i> Trade</a>
                <a href="equipe.html" onclick="sessionStorage.setItem('tmTab','team')"><i class="fas fa-sliders-h"></i> Équipe et réglages</a>
                <a href="index.html"><i class="fas fa-eye"></i> Voir le site</a>
            </div>
            <p class="ah-foot">Mis à jour à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · actualisation automatique chaque minute.</p>`;
    }

    async function load() {
        const { data, error } = await window.supabase.rpc('admin_overview');
        if (error) {
            message(/admin_overview|schema cache|does not exist/i.test(error.message || '')
                ? '<i class="fas fa-tools"></i><h3>Base de données à mettre à jour</h3><p>Exécute la migration 20261103_admin_overview.sql dans Supabase.</p>'
                : '<p>Chargement impossible : ' + esc(error.message) + '</p>');
            return;
        }
        render(data || {});
    }

    async function init() {
        if (!window.supabase?.auth) { message('<p>Service indisponible.</p>'); return; }
        const { data } = await window.supabase.auth.getSession();
        if (!data?.session) {
            message(`<i class="fas fa-lock"></i><h3>Espace administrateur</h3><p>Connecte-toi avec ton compte administrateur (email).</p>
                <button class="btn-submit" onclick="openEmailLoginModal()">Se connecter</button>`);
            window.supabase.auth.onAuthStateChange(event => { if (event === 'SIGNED_IN') location.reload(); });
            return;
        }
        const { data: role } = await window.supabase.rpc('my_team_role');
        if (role === 'agent') { location.replace('equipe.html'); return; }
        if (role !== 'admin') {
            message(`<i class="fas fa-ban"></i><h3>Accès réservé</h3><p>Ce compte n'est pas administrateur.</p>
                <a class="btn-submit" href="index.html">Retour à l'accueil</a>`);
            return;
        }
        await load();
        setInterval(() => { if (!document.hidden) load(); }, 60000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
