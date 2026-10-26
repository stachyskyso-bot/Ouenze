// ============================================================
// ADMIN-NAV.JS — interface propre à l'équipe Ouenze sur les pages d'administration
//
// Pour un admin ou un agent connecté :
//   • masque les éléments « client » (recherche, ville, panier, onglets du bas) ;
//   • ajoute une barre de navigation admin avec des pastilles (choses à traiter).
// Agents : seulement « Commandes ». Admins : tout.
// La sécurité ne dépend pas de cette barre : chaque action est vérifiée par la base.
// À charger après app.js sur : admin.html, equipe.html, admin-*.html, trade.html.
// ============================================================

(function () {
    'use strict';

    const LINKS = [
        { href: 'admin.html', icon: 'fa-tachometer-alt', label: 'Tableau de bord', admin: true },
        { href: 'admin-search.html', icon: 'fa-search', label: 'Rechercher', admin: true },
        { href: 'equipe.html', icon: 'fa-headset', label: 'Commandes', count: 'to_call' },
        { href: 'admin-shops.html', icon: 'fa-store', label: 'Boutiques', admin: true },
        { href: 'admin-vendors.html', icon: 'fa-user-tie', label: 'Vendeurs', admin: true, count: 'vendor_apps' },
        { href: 'admin-deliverers.html', icon: 'fa-motorcycle', label: 'Livreurs', admin: true, count: 'courier_apps' },
        { href: 'admin-reserve.html', icon: 'fa-piggy-bank', label: 'Réserves', admin: true, count: 'reserve_todo' },
        { href: 'admin-stories.html', icon: 'fa-circle-notch', label: 'Stories', admin: true },
        { href: 'admin-reports.html', icon: 'fa-flag', label: 'Signalements', admin: true, count: 'reports' },
        { href: 'trade.html', icon: 'fa-chart-line', label: 'Trade', admin: true, count: 'trade_total' },
        { href: 'index.html?site=1', icon: 'fa-eye', label: 'Voir le site', external: true }
    ];

    function render(role, counts) {
        const here = location.pathname.split('/').pop() || 'index.html';
        const links = LINKS.filter(l => role === 'admin' || !l.admin);
        let bar = document.getElementById('admNav');
        if (!bar) {
            bar = document.createElement('nav');
            bar.id = 'admNav';
            bar.className = 'adm-nav';
            bar.setAttribute('aria-label', 'Administration Ouenze');
            const header = document.querySelector('.header');
            if (header) header.after(bar); else document.body.prepend(bar);
        }
        bar.innerHTML = `<div class="adm-nav-inner">
            <span class="adm-nav-badge"><i class="fas fa-user-shield"></i> ${role === 'admin' ? 'Admin' : 'Équipe'}</span>
            ${links.map(l => {
                const n = counts && l.count ? Number(counts[l.count]) || 0 : 0;
                return `<a href="${l.href}" class="${here === l.href ? 'active' : ''} ${l.external ? 'ext' : ''}">
                    <i class="fas ${l.icon}"></i><span>${l.label}</span>${n ? `<b>${n > 99 ? '99+' : n}</b>` : ''}</a>`;
            }).join('')}
        </div>`;
    }

    async function init() {
        if (!window.supabase?.rpc) return;
        const { data: session } = await window.supabase.auth.getSession();
        if (!session?.session) return;
        let { data: role, error } = await window.supabase.rpc('my_team_role');
        // Migration 20261030 pas encore exécutée : on reconnaît au moins les admins
        if (error) role = (await window.supabase.rpc('is_admin')).data ? 'admin' : null;
        if (!role) return;
        document.body.classList.add('admin-mode');
        render(role, null);
        // Sous le nom, dans l'en-tête : le rôle d'équipe plutôt que « Client »
        const showRole = () => document.querySelectorAll('.user-info small').forEach(el => { el.textContent = role === 'admin' ? 'Admin' : 'Équipe'; });
        showRole();
        setTimeout(showRole, 1500);
        if (role !== 'admin') return;
        const refresh = async () => {
            const [{ data }, todo] = await Promise.all([
                window.supabase.rpc('admin_overview'),
                window.supabase.rpc('admin_reserve_todo').then(r => r, () => ({}))
            ]);
            if (data) render(role, { ...data, reserve_todo: Number(todo?.data) || 0, trade_total: (Number(data.trade_review) || 0) + (Number(data.trade_pending_lines) || 0) });
        };
        refresh();
        setInterval(() => { if (!document.hidden) refresh(); }, 60000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
