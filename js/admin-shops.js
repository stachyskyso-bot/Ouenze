// ============================================================
// ADMIN-SHOPS.JS — Gestion des boutiques par les admins (admin-shops.html)
//
// Liste (actives, suspendues, supprimées), recherche, et fiche de chaque boutique :
// entrées / sorties d'argent, commandes, dernière connexion du vendeur, dernière commande,
// historique des décisions. Actions : suspendre, réactiver, supprimer (retirer du site,
// historique conservé), restaurer. Migration 20261104_admin_shops.sql.
// ============================================================

(function () {
    'use strict';

    const TABS = [['active', 'Actives'], ['suspended', 'Suspendues'], ['archived', 'Supprimées'], ['all', 'Toutes']];
    const ORDER_STATUS = {
        pending: 'À accepter', accepted: 'Acceptée', courier_assigned: 'Livreur en route', picked_up: 'Récupérée',
        in_transit: 'En livraison', delivered: 'Livrée', cancelled: 'Annulée', refused: 'Refusée', refunded: 'Remboursée'
    };
    const KIND = {
        sale_store: 'Vente hors Ouenze', payout: 'Versement reçu d\'Ouenze', contribution: 'Apport personnel', withdrawal: 'Retrait personnel',
        purchase: 'Achat de marchandises', supplies: 'Fournitures', transport: 'Transport', rent: 'Loyer', ads: 'Publicité',
        telecom: 'Téléphone, internet', fees: 'Frais bancaires', taxes: 'Impôts', salaries: 'Salaires', other_expense: 'Autre dépense'
    };
    const IN_KINDS = ['sale_store', 'payout', 'contribution'];
    const ACTION = { suspend: 'Suspendue', unsuspend: 'Réactivée', archive: 'Supprimée du site', restore: 'Restaurée', appeal: 'Justification du vendeur', purge: 'Effacée définitivement' };
    const state = { tab: 'active', search: '', list: [], openId: null };

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = v => Math.round(Number(v) || 0).toLocaleString('fr-FR');
    const fcfa = v => `${num(v)} FCFA`;
    const box = () => document.getElementById('adminApp');
    const waNum = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 9 && d.startsWith('0') ? '242' + d : d; };

    function ago(iso) {
        if (!iso) return 'jamais';
        const days = Math.floor((Date.now() - new Date(iso)) / 86400000);
        if (days <= 0) return 'aujourd\'hui';
        if (days === 1) return 'hier';
        if (days < 31) return `il y a ${days} jours`;
        return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    const date = iso => iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    const dateTime = iso => iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    // Temps restant avant l'effacement automatique
    function timeLeft(iso) {
        const ms = new Date(iso) - Date.now();
        if (!(ms > 0)) return 'délai dépassé : effacement imminent';
        const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
        return h >= 24 ? `${Math.floor(h / 24)} j ${h % 24} h restants` : h ? `${h} h ${m} min restantes` : `${m} min restantes`;
    }

    function message(html) {
        box().innerHTML = `<div class="dl-card"><div class="dl-status">${html}</div></div>`;
    }

    function badge(s) {
        if (s.purged_at) return '<span class="adm-badge rejected">Effacée</span>';
        if (s.archived_at) return '<span class="adm-badge rejected">Supprimée</span>';
        if (s.suspended_at) return '<span class="adm-badge suspended">Suspendue</span>';
        return '<span class="adm-badge approved">Active</span>';
    }

    // ---------- Liste ----------
    function listHtml() {
        return `
            <div class="adm-tabs">${TABS.map(([k, l]) => `<button class="adm-tab ${state.tab === k ? 'active' : ''}" onclick="asTab('${k}')">${l}</button>`).join('')}</div>
            <form class="tm-search" onsubmit="event.preventDefault();asSearch(this.q.value)">
                <input name="q" value="${esc(state.search)}" placeholder="Nom de boutique, ville, email ou téléphone du vendeur">
                <button class="btn-cancel" aria-label="Chercher"><i class="fas fa-search"></i></button>
            </form>
            ${state.list.length ? state.list.map(s => {
                const st = s.stats || {};
                const inactive = s.owner_last_login && (Date.now() - new Date(s.owner_last_login)) > 14 * 86400000;
                return `<button class="dl-card as-row" onclick="asOpen('${esc(s.shop_id)}')">
                    <div class="as-row-head"><strong>${esc(s.name)}</strong>${badge(s)}</div>
                    <small>${esc([s.district, s.city].filter(Boolean).join(', ') || '—')} · ${esc(s.owner_name || '')}</small>
                    <div class="as-row-nums">
                        <span><b>${num(st.orders_30d)}</b> cmd / 30 j</span>
                        <span><b>${fcfa(st.sales_30d)}</b> ventes / 30 j</span>
                        <span class="${inactive ? 'as-warn' : ''}">Connexion : <b>${ago(s.owner_last_login)}</b></span>
                        <span>Dernière cmd : <b>${ago(st.last_order_at)}</b></span>
                        ${Number(st.reports_open) ? `<span class="as-warn"><b>${num(st.reports_open)}</b> signalement(s)</span>` : ''}
                    </div>
                </button>`;
            }).join('') : '<div class="dl-card" style="text-align:center;color:var(--gray-500);">Aucune boutique ici.</div>'}`;
    }

    async function loadList() {
        const { data, error } = await window.supabase.rpc('admin_shop_list', { scope: state.tab, search: state.search || null });
        if (error) {
            message(/admin_shop_list|schema cache|does not exist/i.test(error.message || '')
                ? '<i class="fas fa-tools"></i><h3>Base de données à mettre à jour</h3><p>Exécute la migration 20261104_admin_shops.sql dans Supabase.</p>'
                : '<p>Chargement impossible : ' + esc(error.message) + '</p>');
            return false;
        }
        state.list = data || [];
        return true;
    }

    async function showList() {
        state.openId = null;
        if (await loadList()) box().innerHTML = listHtml();
    }

    // ---------- Fiche ----------
    function detailHtml(d) {
        const s = d.shop, o = d.owner || {}, st = d.stats || {};
        const tel = waNum(o.phone);
        // Les versements d'Ouenze au vendeur viennent de ses ventes Ouenze : on ne les ajoute pas une seconde fois
        const inTotal = Number(st.sales_total) + Number(st.in_store) + Number(st.in_contribution);
        const outTotal = Number(st.out_expenses) + Number(st.out_withdrawal);
        const actions = s.purged_at ? ''
            : s.archived_at
            ? `<button class="btn-submit" onclick="asAct('restore')"><i class="fas fa-undo"></i> Restaurer la boutique</button>
               ${s.deletion_due_at ? '<button class="btn-cancel tm-danger-text" onclick="asAct(\'purge\')"><i class="fas fa-eraser"></i> Effacer maintenant</button>' : ''}`
            : `${s.suspended_at
                ? '<button class="btn-submit" onclick="asAct(\'unsuspend\')"><i class="fas fa-play"></i> Réactiver</button>'
                : '<button class="btn-cancel as-warn-btn" onclick="asAct(\'suspend\')"><i class="fas fa-pause"></i> Suspendre</button>'}
               <button class="btn-cancel tm-danger-text" onclick="asAct('archive')"><i class="fas fa-trash-alt"></i> Supprimer du site</button>`;
        return `
            <button class="tr-back as-back" onclick="asBack()"><i class="fas fa-arrow-left"></i> Toutes les boutiques</button>
            <div class="dl-card">
                <div class="as-row-head"><h3 style="margin:0;">${esc(s.name)}</h3>${badge(s)}</div>
                <small class="as-sub">${esc([s.district, s.city].filter(Boolean).join(', ') || '—')} · créée le ${date(s.created_at)}${Number(s.rating) ? ` · ${Number(s.rating).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ★` : ''}</small>
                ${s.suspended_at ? `<p class="as-alert">Suspendue le ${date(s.suspended_at)} : ${esc(s.suspended_reason || '')}</p>` : ''}
                ${s.purged_at ? `<p class="as-alert">Effacée définitivement le ${date(s.purged_at)}. Seul l'historique des commandes est gardé, anonyme.</p>`
                    : s.archived_at ? `<p class="as-alert">Supprimée du site le ${date(s.archived_at)} : ${esc(s.archived_reason || '')}</p>
                    ${s.deletion_due_at ? `<div class="del-box">
                        <p><i class="fas fa-hourglass-half"></i> Effacement automatique le <b>${dateTime(s.deletion_due_at)}</b> (${timeLeft(s.deletion_due_at)}).</p>
                        ${s.deletion_appeal
                            ? `<p class="del-appeal-title"><i class="fas fa-comment-dots"></i> Justification du vendeur (${dateTime(s.deletion_appeal_at)}) :</p><blockquote>${esc(s.deletion_appeal)}</blockquote>
                               <p class="del-hint">Restaure la boutique si la justification te convainc, sinon efface-la maintenant ou laisse le délai courir.</p>`
                            : '<p class="del-hint">Le vendeur n\'a pas encore envoyé de justification.</p>'}</div>` : ''}` : ''}
                <div class="as-actions">${actions}
                    ${s.archived_at || s.suspended_at ? '' : `<a class="btn-cancel" href="index.html?shop=${encodeURIComponent(s.id)}" target="_blank" rel="noopener"><i class="fas fa-eye"></i> Voir la boutique</a>`}</div>
                <p class="tm-msg" id="asMsg" hidden></p>
            </div>

            <div class="dl-card">
                <h4 class="as-h"><i class="fas fa-user"></i> Vendeur</h4>
                <p class="as-line"><b>${esc(o.name || '—')}</b>${o.email ? ' · ' + esc(o.email) : ''}${o.phone ? ' · ' + esc(o.phone) : ''}</p>
                <p class="as-line">Dernière connexion : <b>${ago(o.last_login)}</b>${o.last_login ? ` (${date(o.last_login)})` : ''} · inscrit le ${date(o.joined)}</p>
                ${tel ? `<a class="btn-submit tm-wa as-call" href="https://wa.me/${tel}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> Appeler</a>` : ''}
                ${s.owner_id ? `<a class="btn-cancel as-call" href="admin-search.html?u=${encodeURIComponent(s.owner_id)}"><i class="fas fa-id-card"></i> Fiche complète du vendeur</a>` : ''}
            </div>

            <div class="as-kpis">
                <div class="in"><span>Entrées</span><b>${fcfa(inTotal)}</b>
                    <small>Ventes Ouenze livrées ${fcfa(st.sales_total)} (dont ${fcfa(st.in_payout)} déjà versés au vendeur)<br>Ventes hors Ouenze ${fcfa(st.in_store)}<br>Apports personnels ${fcfa(st.in_contribution)}</small></div>
                <div class="out"><span>Sorties</span><b>${fcfa(outTotal)}</b>
                    <small>Dépenses déclarées ${fcfa(st.out_expenses)}<br>Retraits personnels ${fcfa(st.out_withdrawal)}</small></div>
                <div><span>Commandes</span><b>${num(st.orders_total)}</b>
                    <small>${num(st.orders_30d)} sur 30 jours · ${num(st.orders_delivered)} livrées · ${num(st.orders_cancelled)} annulées ou refusées · ${num(st.orders_pending)} à accepter</small></div>
                <div><span>Dernière commande</span><b>${ago(st.last_order_at)}</b>
                    <small>${num(st.products)} produits en ligne · ${num(st.reports_total)} signalement(s), dont ${num(st.reports_open)} ouvert(s)</small></div>
            </div>
            <p class="as-note">Les ventes Ouenze viennent des commandes. Les autres montants sont déclarés par le vendeur dans sa comptabilité : Ouenze ne les vérifie pas.</p>

            <div class="dl-card">
                <h4 class="as-h"><i class="fas fa-receipt"></i> Dernières commandes</h4>
                ${d.orders.length ? `<ul class="as-list">${d.orders.map(c => `<li>
                    <span><b>${esc(c.order_number)}</b><small>${date(c.created_at)} · ${esc(c.client || '')}${c.payment_status === 'test' ? ' · TEST' : ''}</small></span>
                    <span class="as-right">${fcfa(c.amount)}<small>${esc(ORDER_STATUS[c.status] || c.status)}${c.payment_status === 'paid' ? ' · payée' : ''}</small></span></li>`).join('')}</ul>`
                    : '<p class="as-empty">Aucune commande.</p>'}
            </div>

            <div class="dl-card">
                <h4 class="as-h"><i class="fas fa-book"></i> Comptabilité déclarée (dernières lignes)</h4>
                ${d.entries.length ? `<ul class="as-list">${d.entries.map(e => {
                    const isIn = IN_KINDS.includes(e.kind);
                    return `<li><span><b>${esc(KIND[e.kind] || e.kind)}</b><small>${date(e.entry_date)}${e.label ? ' · ' + esc(e.label) : ''}</small></span>
                        <span class="as-right ${isIn ? 'as-in' : 'as-out'}">${isIn ? '+' : '−'}${fcfa(e.amount)}</span></li>`;
                }).join('')}</ul>` : '<p class="as-empty">Le vendeur n\'a rien déclaré.</p>'}
            </div>

            <div class="dl-card">
                <h4 class="as-h"><i class="fas fa-history"></i> Décisions d'Ouenze</h4>
                ${d.events.length ? `<ul class="as-list">${d.events.map(e => `<li><span><b>${esc(ACTION[e.action] || e.action)}</b><small>${date(e.created_at)} · ${esc(e.actor || '')}${e.note ? ' · ' + esc(e.note) : ''}</small></span></li>`).join('')}</ul>`
                    : '<p class="as-empty">Aucune décision pour l\'instant.</p>'}
            </div>`;
    }

    async function asOpen(id) {
        state.openId = id;
        box().innerHTML = '<p style="text-align:center;color:var(--gray-500);padding:30px 0;">Chargement…</p>';
        const { data, error } = await window.supabase.rpc('admin_shop_detail', { target: id });
        if (error || !data) { message(`<p>${esc(error?.message || 'Boutique introuvable')}</p><button class="btn-cancel" onclick="asBack()">Retour</button>`); return; }
        box().innerHTML = detailHtml(data);
        window.scrollTo(0, 0);
    }

    async function asAct(action) {
        const texts = {
            suspend: ['Suspendre cette boutique ?', 'Elle disparaît du site. Le vendeur est prévenu et ne peut pas la réactiver lui-même.\n\nMotif (envoyé au vendeur) :'],
            archive: ['Supprimer cette boutique ?', 'Elle disparaît du site. Le vendeur a 72 heures pour se justifier ; tu peux la restaurer pendant ce délai. Ensuite, la boutique et ses produits sont effacés automatiquement (les commandes déjà passées restent, anonymes).\n\nMotif (envoyé au vendeur) :'],
            purge: ['Effacer définitivement cette boutique maintenant ?', 'Produits, photos, design et comptabilité seront effacés. Les commandes déjà passées restent, anonymes. C\'est irréversible.'],
            unsuspend: ['Réactiver cette boutique ?', 'Elle redevient visible sur Ouenze.'],
            restore: ['Restaurer cette boutique ?', 'Elle revient sur Ouenze (sauf si elle est aussi suspendue).']
        }[action];
        let reason = null;
        if (action === 'suspend' || action === 'archive') {
            reason = await uiPrompt(`${texts[0]}\n\n${texts[1]}`, '');
            if (reason === null) return;
            if (reason.trim().length < 3) { uiAlert('Indique un motif.'); return; }
        } else if (!(await uiConfirm(`${texts[0]}\n\n${texts[1]}`, { unsuspend: 'Réactiver', purge: 'Effacer' }[action] || 'Restaurer'))) return;
        const { error } = action === 'purge'
            ? await window.supabase.rpc('admin_shop_purge_now', { target: state.openId })
            : await window.supabase.rpc('admin_shop_action', { target: state.openId, action, reason });
        if (error) {
            const el = document.getElementById('asMsg');
            if (el) { el.hidden = false; el.className = 'tm-msg err'; el.textContent = error.message; }
            return;
        }
        asOpen(state.openId);
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
        const { data: isAdmin } = await window.supabase.rpc('is_admin');
        if (!isAdmin) {
            message(`<i class="fas fa-ban"></i><h3>Accès réservé</h3><p>Ce compte n'est pas administrateur.</p>
                <a class="btn-submit" href="index.html">Retour à l'accueil</a>`);
            return;
        }
        const id = new URLSearchParams(location.search).get('id');
        if (id) asOpen(id); else showList();
    }

    Object.assign(window, {
        asTab: k => { state.tab = k; showList(); },
        asSearch: q => { state.search = String(q || '').trim(); showList(); },
        asOpen, asAct, asBack: showList
    });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
