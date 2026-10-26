// ============================================================
// ADMIN-STORIES.JS — Stories Ouenze et modération (admin-stories.html)
//
// Données : migration 20261111_stories.sql
//   admin_stories(only_active)     → stories en ligne (ou des 7 derniers jours)
//   post_story(null, …)            → story « Ouenze » (via OuenzeStories.compose)
//   admin_remove_story(id, raison) → retirer la story d'une boutique (raison visible par le vendeur)
// ============================================================

(function () {
    'use strict';

    const state = { list: [], onlyActive: true, filter: 'all' };
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const box = () => document.getElementById('adminApp');
    const missing = e => /admin_stories|stories|schema cache|does not exist/i.test(e?.message || '');

    function message(html) { box().innerHTML = `<div class="dl-card"><div class="dl-status">${html}</div></div>`; }

    async function load() {
        box().innerHTML = '<p style="text-align:center;color:var(--gray-500);padding:30px 0;">Chargement…</p>';
        const { data, error } = await window.supabase.rpc('admin_stories', { only_active: state.onlyActive });
        if (error) {
            return message(missing(error)
                ? '<i class="fas fa-tools"></i><h3>Base de données à mettre à jour</h3><p>Exécute la migration 20261111_stories.sql dans Supabase.</p>'
                : `<p>${esc(error.message)}</p>`);
        }
        state.list = Array.isArray(data) ? data : [];
        render();
    }

    function card(r, i) {
        const media = r.media_type === 'video'
            ? `<video src="${esc(r.media_url || '')}" muted preload="metadata" playsinline></video>`
            : r.media_type === 'text'
                ? `<div class="st-card-text" style="background:${/^#[0-9a-f]{6}$/i.test(r.bg_color || '') ? r.bg_color : '#1e40af'}">${esc(r.caption || '')}</div>`
                : `<img src="${esc(r.media_url || '')}" alt="" loading="lazy">`;
        const status = r.active ? window.OuenzeStories.timeAgo(r.created_at) : (r.removed_at ? 'Retirée' : 'Expirée');
        return `<div class="st-card ${r.active ? '' : 'off'}" role="button" tabindex="0" onclick="asPreview(${i})">
            ${media}
            <span class="st-card-badge">${r.media_type === 'video' ? '<i class="fas fa-video"></i> ' : ''}${esc(status)}</span>
            ${r.active ? `<button type="button" class="st-card-del" title="${r.author_kind === 'ouenze' ? 'Supprimer' : 'Retirer'}" onclick="event.stopPropagation();asRemove(${i})"><i class="fas ${r.author_kind === 'ouenze' ? 'fa-trash' : 'fa-ban'}"></i></button>` : ''}
            <span class="st-card-info"><b>${esc(r.shop_name || '')}</b>
                <small><i class="fas fa-eye"></i> ${Number(r.views) || 0} vue${Number(r.views) > 1 ? 's' : ''}${r.audience === 'fans' ? ' · fidèles' : ''}</small>
                ${r.product_name ? `<small><i class="fas fa-tag"></i> ${esc(r.product_name)}</small>` : ''}
                ${r.removed_reason ? `<small>${esc(r.removed_reason)}</small>` : ''}</span>
        </div>`;
    }

    function render() {
        const list = state.list.filter(r => state.filter === 'all' || (state.filter === 'ouenze') === (r.author_kind === 'ouenze'));
        const active = state.list.filter(r => r.active);
        const views = active.reduce((s, r) => s + Number(r.views || 0), 0);
        const shops = new Set(active.filter(r => r.shop_id).map(r => r.shop_id)).size;
        const tab = (key, label) => `<button type="button" class="${state.filter === key ? 'active' : ''}" onclick="asFilter('${key}')">${label}</button>`;
        box().innerHTML = `
            <div class="as-kpis">
                <div><span>Stories en ligne</span><b>${active.length}</b><small>disparaissent après 24 h</small></div>
                <div><span>Boutiques actives</span><b>${shops}</b><small>avec au moins une story</small></div>
                <div><span>Vues</span><b>${views.toLocaleString('fr-FR')}</b><small>clients connectés</small></div>
            </div>
            <div class="as-st-bar">
                <button type="button" class="btn-sm btn-primary" onclick="asNew()"><i class="fas fa-plus"></i> Publier une story Ouenze</button>
                <div class="st-tabs as-st-tabs">${tab('all', 'Toutes')}${tab('ouenze', 'Ouenze')}${tab('shop', 'Boutiques')}</div>
                <label class="as-st-old"><input type="checkbox" ${state.onlyActive ? '' : 'checked'} onchange="asToggleOld(this.checked)"> 7 derniers jours</label>
            </div>
            <p class="st-empty">Touchez une story pour la voir. <i class="fas fa-ban"></i> retire la story d'une boutique : indiquez la raison, le vendeur la verra.</p>
            ${list.length ? `<div class="st-mine-list">${list.map(r => card(r, state.list.indexOf(r))).join('')}</div>`
                : '<p class="st-empty">Aucune story pour le moment.</p>'}`;
    }

    async function asNew() {
        // Produits proposés : les plus récents du catalogue
        const { data } = await window.supabase.rpc('product_feed', { city: null, lim: 200 }).then(r => r, () => ({}));
        window.OuenzeStories.compose({ shopId: null, products: (data || []).map(p => ({ id: p.id, name: `${p.name} · ${p.shop_name || ''}` })), onDone: load });
    }

    function asPreview(i) {
        const r = state.list[i];
        if (r) window.OuenzeStories.preview([r], r.shop_name);
    }

    async function asRemove(i) {
        const r = state.list[i];
        if (!r) return;
        try {
            if (r.author_kind === 'ouenze') {
                if (!(await uiConfirm('Supprimer cette story Ouenze ?', 'Supprimer', true))) return;
                await window.OuenzeStories.remove(r.id);
            } else {
                const reason = await uiPrompt(`Retirer la story de « ${r.shop_name} » ? Indique la raison (le vendeur la verra) :`, '');
                if (reason === null) return;
                if (!reason.trim()) { uiAlert('Indique la raison du retrait.'); return; }
                const { error } = await window.supabase.rpc('admin_remove_story', { target: r.id, reason: reason.trim() });
                if (error) throw error;
            }
            await load();
        } catch (e) {
            uiAlert(e.message || 'Action impossible');
        }
    }

    function asFilter(key) { state.filter = key; render(); }
    function asToggleOld(on) { state.onlyActive = !on; load(); }

    async function init() {
        if (!window.supabase?.auth || !window.OuenzeStories) { message('<p>Service indisponible.</p>'); return; }
        const { data } = await window.supabase.auth.getSession();
        if (!data?.session) {
            message(`<i class="fas fa-lock"></i><h3>Espace administrateur</h3><p>Connecte-toi avec ton compte administrateur.</p>
                <button class="btn-submit" onclick="openEmailLoginModal()">Se connecter</button>`);
            return;
        }
        const { data: isAdmin } = await window.supabase.rpc('is_admin');
        if (!isAdmin) { message('<i class="fas fa-ban"></i><h3>Accès réservé</h3><p>Ce compte n\'est pas administrateur.</p>'); return; }
        load();
    }

    Object.assign(window, { asNew, asPreview, asRemove, asFilter, asToggleOld });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
