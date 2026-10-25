// ============================================================
// ADMIN-SEARCH.JS — Recherche admin et fiches complètes (admin-search.html)
//
// Une seule barre : personne (client, vendeur, livreur), boutique, commande
// (numéro, code de remise, référence de paiement). Fiches :
//   admin-search.html?u=<id>      tout sur une personne (profil, chiffre d'affaires, croissance…)
//   admin-search.html?order=<id>  tout sur une commande
// Boutique → admin-shops.html?id=<id>. RPC admin_search / admin_person / admin_order (20261105).
// ============================================================

(function () {
    'use strict';

    const ORDER_STATUS = {
        pending: ['À accepter', 'wait'], accepted: ['Acceptée', 'info'], courier_assigned: ['Livreur en route', 'info'],
        picked_up: ['Récupérée', 'info'], in_transit: ['En livraison', 'info'], delivered: ['Livrée', 'ok'],
        cancelled: ['Annulée', 'ko'], refused: ['Refusée', 'ko'], refunded: ['Remboursée', 'ko']
    };
    const PAY = { cod: 'À payer', paid: 'Payée', test: 'Test' };
    const PAY_OP = { MTN_CG: 'MTN Mobile Money', AIRTEL_CG: 'Airtel Money', MPESA_CD: 'M-Pesa', ORANGE_CD: 'Orange Money', AIRTEL_CD: 'Airtel Money', CARD: 'Carte bancaire', PAYPAL: 'PayPal' };
    const EVENT = { confirmed: 'Adresse confirmée', cancelled: 'Annulée', paid: 'Payée', note: 'Note d\'appel' };
    const PROVIDER = { email: 'email', phone: 'numéro + code SMS', google: 'Google' };

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = v => Math.round(Number(v) || 0).toLocaleString('fr-FR');
    const fcfa = v => `${num(v)} FCFA`;
    const date = iso => iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    const dateTime = iso => iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    const waNum = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 9 && d.startsWith('0') ? '242' + d : d; };
    const box = () => document.getElementById('srApp');
    const rpc = (n, a) => window.supabase.rpc(n, a || {});
    const pill = ([label, tone]) => `<span class="sr-pill ${tone || ''}">${esc(label)}</span>`;
    let timer = null;
    let seq = 0;

    function ago(iso) {
        if (!iso) return 'jamais';
        const days = Math.floor((Date.now() - new Date(iso)) / 86400000);
        if (days <= 0) return 'aujourd\'hui';
        if (days === 1) return 'hier';
        if (days < 31) return `il y a ${days} jours`;
        return date(iso);
    }

    function message(html) { box().innerHTML = `<div class="dl-card"><div class="dl-status">${html}</div></div>`; }
    function loading() { box().innerHTML = '<p class="sr-loading">Chargement…</p>'; }

    // Croissance : mois en cours comparé au mois précédent
    function growth(series) {
        if (!Array.isArray(series) || series.length < 2) return null;
        const cur = Number(series[series.length - 1].value) || 0;
        const prev = Number(series[series.length - 2].value) || 0;
        if (!prev) return cur ? { label: 'Nouveau', tone: 'ok' } : null;
        const pct = Math.round(((cur - prev) / prev) * 100);
        return { label: `${pct > 0 ? '+' : ''}${pct} %`, tone: pct >= 0 ? 'ok' : 'ko' };
    }

    // Petit graphique en barres (6 derniers mois)
    function bars(series, money) {
        if (!Array.isArray(series) || !series.length) return '';
        const max = Math.max(1, ...series.map(s => Number(s.value) || 0));
        return `<div class="sr-bars">${series.map(s => {
            const v = Number(s.value) || 0;
            const label = new Date(s.month + 'T00:00:00').toLocaleDateString('fr-FR', { month: 'short' });
            return `<div class="sr-bar" title="${esc(label)} : ${money ? fcfa(v) : num(v)}">
                <span class="sr-bar-val">${v ? (money ? num(v / 1000) + ' k' : num(v)) : ''}</span>
                <i style="height:${Math.max(3, Math.round((v / max) * 100))}%"></i><small>${esc(label)}</small></div>`;
        }).join('')}</div>`;
    }

    function kpi(label, value, sub, extra) {
        return `<div><span>${esc(label)}</span><b>${value}</b>${extra || ''}${sub ? `<small>${sub}</small>` : ''}</div>`;
    }

    // ============ RECHERCHE ============
    async function search(q) {
        const term = String(q || '').trim();
        if (term.length < 2) { box().innerHTML = helpHtml(); return; }
        const my = ++seq;
        loading();
        const { data, error } = await rpc('admin_search', { q: term });
        if (my !== seq) return;
        if (error) { return message(missing(error) ? migrationText() : '<p>Recherche impossible : ' + esc(error.message) + '</p>'); }
        const rows = data || [];
        if (!rows.length) { box().innerHTML = `<div class="dl-card sr-empty">Aucun résultat pour « ${esc(term)} ».</div>`; return; }
        const group = (kind, title, icon) => {
            const list = rows.filter(r => r.kind === kind);
            if (!list.length) return '';
            return `<h3 class="sr-h"><i class="fas ${icon}"></i> ${title} <small>${list.length}</small></h3>
                <div class="sr-results">${list.map(r => {
                    const href = kind === 'order' ? `?order=${r.id}` : kind === 'person' ? `?u=${r.id}` : `admin-shops.html?id=${r.id}`;
                    const badge = kind === 'order' ? pill(ORDER_STATUS[r.badge] || [r.badge]) : r.badge ? `<span class="sr-pill">${esc(r.badge)}</span>` : '';
                    return `<a class="sr-result" href="${href}">
                        <span class="sr-ico ${kind}"><i class="fas ${kind === 'order' ? 'fa-receipt' : kind === 'person' ? 'fa-user' : 'fa-store'}"></i></span>
                        <span class="sr-res-txt"><b>${esc(r.title)}</b><small>${esc(r.subtitle || '')}</small></span>${badge}</a>`;
                }).join('')}</div>`;
        };
        box().innerHTML = group('order', 'Commandes', 'fa-receipt') + group('person', 'Personnes', 'fa-users') + group('shop', 'Boutiques', 'fa-store');
    }

    function helpHtml() {
        return `<div class="dl-card sr-help">
            <b>Que peux-tu chercher ?</b>
            <ul><li><b>Une personne</b> (client, vendeur, livreur) : nom, téléphone, email, plaque du véhicule</li>
                <li><b>Une commande</b> : numéro (OZ-…), code de remise à 4 chiffres, référence de paiement</li>
                <li><b>Une boutique</b> : nom ou ville</li></ul></div>`;
    }

    const missing = e => /admin_search|admin_person|admin_order|schema cache|does not exist/i.test(e?.message || '');
    const migrationText = () => '<i class="fas fa-tools"></i><h3>Base de données à mettre à jour</h3><p>Exécute la migration 20261105_admin_search.sql dans Supabase.</p>';

    // ============ FICHE PERSONNE ============
    async function showPerson(id) {
        loading();
        const { data: d, error } = await rpc('admin_person', { target: id });
        if (error || !d) return message(missing(error) ? migrationText() : `<p>${esc(error?.message || 'Compte introuvable')}</p>`);
        const a = d.account || {}, c = d.client || {}, cr = d.courier;
        const shops = d.shops || [];
        const roles = [
            a.is_admin && ['Admin', 'info'], a.is_agent && ['Agent', 'info'],
            shops.length && ['Vendeur', 'ok'], a.vendor_status === 'pending' && ['Vendeur en attente', 'wait'],
            cr && cr.status === 'approved' && ['Livreur', 'ok'], cr && cr.status === 'pending' && ['Livreur en attente', 'wait'],
            Number(c.orders) && ['Client', '']
        ].filter(Boolean);
        const tel = waNum(a.phone || cr?.phone);

        // Vendeur
        const sales = shops.reduce((s, x) => s + Number(x.stats?.sales_total || 0), 0);
        const sales30 = shops.reduce((s, x) => s + Number(x.stats?.sales_30d || 0), 0);
        const vOrders = shops.reduce((s, x) => s + Number(x.stats?.orders_total || 0), 0);
        const vGrowth = growth(d.vendor_monthly);
        const vendorHtml = shops.length ? `
            <section class="sr-section">
                <h3 class="sr-h"><i class="fas fa-store"></i> Vendeur</h3>
                <div class="sr-kpis">
                    ${kpi('Chiffre d\'affaires', fcfa(sales), 'ventes Ouenze livrées')}
                    ${kpi('Sur 30 jours', fcfa(sales30), '')}
                    ${kpi('Croissance', vGrowth ? `<span class="sr-g ${vGrowth.tone}">${vGrowth.label}</span>` : '—', 'ce mois-ci vs mois dernier (mois en cours partiel)')}
                    ${kpi('Commandes reçues', num(vOrders), `${shops.length} boutique${shops.length > 1 ? 's' : ''}`)}
                </div>
                <div class="dl-card"><b class="sr-sub">Chiffre d'affaires par mois</b>${bars(d.vendor_monthly, true)}</div>
                <div class="sr-results">${shops.map(s => `<a class="sr-result" href="admin-shops.html?id=${esc(s.id)}">
                    <span class="sr-ico shop"><i class="fas fa-store"></i></span>
                    <span class="sr-res-txt"><b>${esc(s.name)}</b><small>${esc(s.city || '')} · ${fcfa(s.stats?.sales_total)} · dernière commande ${ago(s.stats?.last_order_at)}</small></span>
                    <span class="sr-pill ${s.status === 'active' ? 'ok' : 'ko'}">${esc(s.status)}</span></a>`).join('')}</div>
            </section>` : '';

        // Client
        const cGrowth = growth(c.monthly);
        const clientHtml = Number(c.orders) ? `
            <section class="sr-section">
                <h3 class="sr-h"><i class="fas fa-shopping-bag"></i> Client</h3>
                <div class="sr-kpis">
                    ${kpi('Total dépensé', fcfa(c.spent), 'commandes livrées')}
                    ${kpi('Commandes', num(c.orders), `${num(c.delivered)} livrées · ${num(c.cancelled)} annulées`)}
                    ${kpi('Panier moyen', fcfa(c.avg_basket), cGrowth ? `évolution ce mois : <span class="sr-g ${cGrowth.tone}">${cGrowth.label}</span>` : '')}
                    ${kpi('Dernière commande', ago(c.last_order_at), Number(c.unpaid) ? `<span class="sr-g ko">${num(c.unpaid)} livrée(s) non payée(s)</span>` : '')}
                </div>
                <div class="dl-card"><b class="sr-sub">Dépenses par mois</b>${bars(c.monthly, true)}</div>
                <div class="dl-card"><b class="sr-sub">Dernières commandes</b>
                    <ul class="as-list">${(d.client_orders || []).map(o => `<li><a class="sr-line" href="?order=${esc(o.id)}">
                        <span><b>${esc(o.order_number)}</b><small>${date(o.created_at)} · ${esc(o.shop || '')}</small></span>
                        <span class="as-right">${fcfa(o.total)}<small>${esc((ORDER_STATUS[o.status] || [o.status])[0])} · ${esc(PAY[o.payment_status] || o.payment_status || '')}</small></span></a></li>`).join('')}</ul></div>
            </section>` : '';

        // Livreur
        const expired = cr?.license_expiry && new Date(cr.license_expiry) < new Date();
        const courierHtml = cr ? `
            <section class="sr-section">
                <h3 class="sr-h"><i class="fas fa-motorcycle"></i> Livreur ${cr.online ? '<span class="sr-pill ok">En ligne</span>' : ''}</h3>
                <div class="sr-kpis">
                    ${kpi('Courses livrées', num(cr.deliveries), `${num(cr.in_progress)} en cours · dernière ${ago(cr.last_delivery_at)}`)}
                    ${kpi('Gains', fcfa(cr.earnings), 'frais de livraison des courses livrées')}
                    ${kpi('Note', cr.rating ? `${Number(cr.rating).toLocaleString('fr-FR')} ★` : '—', `${num(cr.reviews)} avis`)}
                    ${kpi('Véhicule', esc(cr.vehicle === 'voiture' ? 'Voiture' : 'Moto'), `${esc([cr.brand, cr.plate].filter(Boolean).join(' · '))}<br>permis ${expired ? '<span class="sr-g ko">expiré</span>' : 'valable'} jusqu'au ${date(cr.license_expiry)}`)}
                </div>
                <div class="dl-card"><b class="sr-sub">Courses livrées par mois</b>${bars(cr.monthly, false)}</div>
                ${(cr.recent || []).length ? `<div class="dl-card"><b class="sr-sub">Dernières courses</b><ul class="as-list">${cr.recent.map(o => `<li><a class="sr-line" href="?order=${esc(o.id)}">
                    <span><b>${esc(o.order_number)}</b><small>${dateTime(o.updated_at)}</small></span>
                    <span class="as-right">${fcfa(o.delivery_fees)}<small>${esc((ORDER_STATUS[o.status] || [o.status])[0])}</small></span></a></li>`).join('')}</ul></div>` : ''}
            </section>` : '';

        box().innerHTML = `
            <button class="as-back" onclick="history.length > 1 ? history.back() : location.assign('admin-search.html')"><i class="fas fa-arrow-left"></i> Retour</button>
            <div class="dl-card sr-profile">
                <span class="sr-avatar">${esc(String(a.name || '?').charAt(0).toUpperCase())}</span>
                <div class="sr-profile-main">
                    <h2>${esc(a.name || 'Compte')}</h2>
                    <div class="sr-roles">${roles.length ? roles.map(pill).join('') : '<span class="sr-pill">Compte sans activité</span>'}</div>
                    <p>${[a.phone && esc(a.phone), a.email && esc(a.email), (a.city || cr?.city) && esc(a.city || cr?.city)].filter(Boolean).join(' · ') || '—'}</p>
                    <p class="sr-muted">Inscrit le ${date(a.created_at)} · dernière connexion <b>${ago(a.last_login)}</b> · connexion par ${esc(PROVIDER[a.provider] || a.provider || 'email')}</p>
                </div>
                <div class="sr-profile-actions">
                    ${tel ? `<a class="btn-submit as-call" href="https://wa.me/${tel}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> Appeler</a>` : ''}
                    ${a.email ? `<a class="btn-cancel" href="mailto:${esc(a.email)}"><i class="fas fa-envelope"></i> Email</a>` : ''}
                </div>
            </div>
            ${vendorHtml}${courierHtml}${clientHtml}
            <section class="sr-section">
                <h3 class="sr-h"><i class="fas fa-info-circle"></i> Autres informations</h3>
                <div class="sr-kpis">
                    ${kpi('Signalements reçus', num(d.reports_against), Number(d.reports_against) ? '<a href="admin-reports.html">voir les signalements</a>' : '')}
                    ${kpi('Signalements faits', num(d.reports_made), '')}
                    ${kpi('Avis laissés', num(d.reviews_written), 'sur des boutiques')}
                    ${kpi('Trade (simulation)', fcfa(d.trade?.amount), `${num(d.trade?.count)} participation(s)`)}
                </div>
            </section>
            ${a.is_admin ? '' : '<section class="sr-section" id="srDeletion"></section>'}`;
        window.scrollTo(0, 0);
        if (!a.is_admin) loadDeletion(id);
    }

    // ============ SUPPRESSION DU COMPTE (72 heures pour se justifier) ============
    function timeLeft(iso) {
        const ms = new Date(iso) - Date.now();
        if (!(ms > 0)) return 'délai dépassé : effacement imminent';
        const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
        return h >= 24 ? `${Math.floor(h / 24)} j ${h % 24} h restants` : h ? `${h} h ${m} min restantes` : `${m} min restantes`;
    }

    async function loadDeletion(id) {
        const el = document.getElementById('srDeletion');
        if (!el) return;
        const { data, error } = await rpc('admin_deletions');
        if (error) { el.innerHTML = ''; return; }   // migration 20261107 pas encore exécutée
        const del = (data || []).find(x => x.kind === 'account' && x.id === id);
        el.innerHTML = `<h3 class="sr-h"><i class="fas fa-user-slash"></i> Compte</h3>
            <div class="dl-card">${del ? `
                <p class="as-alert">Compte supprimé : ${esc(del.reason || '')}</p>
                <div class="del-box">
                    <p><i class="fas fa-hourglass-half"></i> Effacement automatique le <b>${dateTime(del.due_at)}</b> (${timeLeft(del.due_at)}).</p>
                    ${del.appeal
                        ? `<p class="del-appeal-title"><i class="fas fa-comment-dots"></i> Justification (${dateTime(del.appeal_at)}) :</p><blockquote>${esc(del.appeal)}</blockquote>`
                        : '<p class="del-hint">Pas encore de justification.</p>'}
                </div>
                <div class="as-actions">
                    <button class="btn-submit" onclick="srAccount('${esc(id)}','restore')"><i class="fas fa-undo"></i> Rétablir le compte</button>
                    <button class="btn-cancel tm-danger-text" onclick="srAccount('${esc(id)}','purge_now')"><i class="fas fa-eraser"></i> Effacer maintenant</button>
                </div>` : `
                <p class="del-hint">Supprimer ce compte : la personne est prévenue et a 72 heures pour se justifier. Sans décision de ta part, tout est ensuite effacé automatiquement (ses boutiques aussi). Les commandes déjà passées restent, anonymes.</p>
                <div class="as-actions"><button class="btn-cancel tm-danger-text" onclick="srAccount('${esc(id)}','delete')"><i class="fas fa-user-times"></i> Supprimer le compte</button></div>`}
                <p class="tm-msg" id="srDelMsg" hidden></p>
            </div>`;
    }

    async function srAccount(id, action) {
        let reason = null;
        if (action === 'delete') {
            reason = await uiPrompt('Supprimer ce compte ?\n\nLa personne a 72 heures pour se justifier, puis tout est effacé.\n\nMotif (envoyé à la personne) :', '');
            if (reason === null) return;
            if (reason.trim().length < 3) { uiAlert('Indique un motif.'); return; }
        } else if (action === 'restore') {
            if (!(await uiConfirm('Rétablir ce compte ? Ses boutiques supprimées avec le compte reviennent aussi.', 'Rétablir'))) return;
        } else if (!(await uiConfirm('Effacer définitivement ce compte maintenant ?\n\nCoordonnées, boutiques, produits, favoris et préférences seront effacés et la personne ne pourra plus se connecter. C\'est irréversible.', 'Effacer'))) return;
        const { error } = await rpc('admin_account_action', { target: id, action, reason });
        if (error) {
            const el = document.getElementById('srDelMsg');
            if (el) { el.hidden = false; el.className = 'tm-msg err'; el.textContent = error.message; }
            return;
        }
        showPerson(id);
    }
    window.srAccount = srAccount;

    // ============ FICHE COMMANDE ============
    async function showOrder(id) {
        loading();
        const { data: d, error } = await rpc('admin_order', { target: id });
        if (error || !d) return message(missing(error) ? migrationText() : `<p>${esc(error?.message || 'Commande introuvable')}</p>`);
        const o = d.order, di = o.delivery || {};
        const st = ORDER_STATUS[o.status] || [o.status];
        const pay = PAY_OP[di.payment_operator] || (o.payment_method === 'card' ? 'Carte bancaire' : o.payment_method === 'paypal' ? 'PayPal' : 'Mobile Money');
        const person = (role, p, icon) => p ? `<a class="sr-result" href="${p.href}">
            <span class="sr-ico person"><i class="fas ${icon}"></i></span><span class="sr-res-txt"><b>${esc(p.name || '—')}</b><small>${esc(role)}${p.phone ? ' · ' + esc(p.phone) : ''}</small></span></a>` : '';
        box().innerHTML = `
            <button class="as-back" onclick="history.length > 1 ? history.back() : location.assign('admin-search.html')"><i class="fas fa-arrow-left"></i> Retour</button>
            <div class="dl-card sr-order-head">
                <div class="as-row-head"><h2 style="margin:0;">${esc(o.order_number)}</h2>${pill(st)}</div>
                <p class="sr-muted">Passée le ${dateTime(o.created_at)} · mise à jour ${dateTime(o.updated_at)}${o.payment_status === 'test' ? ' · <b>commande de TEST</b>' : ''}</p>
                <div class="sr-kpis">
                    ${kpi('Total', fcfa(o.total), `articles ${fcfa(o.subtotal)} + livraison ${fcfa(o.delivery_fees)}`)}
                    ${kpi('Paiement', esc(PAY[o.payment_status] || o.payment_status || '—'), esc(pay) + (di.payment_ref ? ` · réf. ${esc(di.payment_ref)}` : ''))}
                    ${kpi('Livraison', esc([di.district, di.city].filter(Boolean).join(', ') || '—'), [di.landmark && esc(di.landmark), di.call_confirmed ? 'adresse confirmée' : 'adresse non confirmée'].filter(Boolean).join(' · '))}
                    ${kpi('Code de remise', d.code ? `${num(d.code.sends)} envoi(s)` : '—', d.code ? `${num(d.code.attempts)} essai(s) du livreur` : 'pas encore de livreur')}
                </div>
                ${o.notes ? `<p class="as-alert">${esc(o.notes)}</p>` : ''}
            </div>
            <section class="sr-section">
                <h3 class="sr-h"><i class="fas fa-users"></i> Qui</h3>
                <div class="sr-results">
                    ${d.shop?.id ? `<a class="sr-result" href="admin-shops.html?id=${esc(d.shop.id)}"><span class="sr-ico shop"><i class="fas fa-store"></i></span>
                        <span class="sr-res-txt"><b>${esc(d.shop.name)}</b><small>Boutique · ${esc(d.shop.owner || '')}${d.shop.owner_phone ? ' · ' + esc(d.shop.owner_phone) : ''}</small></span></a>` : ''}
                    ${person('Client', { ...d.client, phone: di.phone, href: `?u=${d.client.id}` }, 'fa-user')}
                    ${d.courier ? person('Livreur', { ...d.courier, href: `?u=${d.courier.id}` }, 'fa-motorcycle') : ''}
                </div>
            </section>
            <div class="dl-card"><b class="sr-sub">Articles</b>
                <ul class="as-list">${d.items.map(i => `<li><span><b>${esc(i.name)}</b><small>${i.variant ? esc(i.variant) + ' · ' : ''}${num(i.quantity)} × ${fcfa(i.unit_price)}</small></span><span class="as-right">${fcfa(i.total)}</span></li>`).join('')}</ul></div>
            ${d.payments.length ? `<div class="dl-card"><b class="sr-sub">Paiements en ligne</b><ul class="as-list">${d.payments.map(t => `<li>
                <span><b>${esc(t.channel === 'CREDIT_CARD' ? 'Carte' : 'Mobile Money')} · ${esc(t.provider)}</b><small>${esc(t.transaction_id)} · ${dateTime(t.created_at)}${t.provider_ref ? ' · réf. ' + esc(t.provider_ref) : ''}</small></span>
                <span class="as-right">${fcfa(t.amount)}<small>${esc(t.status)}</small></span></li>`).join('')}</ul></div>` : ''}
            <div class="dl-card"><b class="sr-sub">Historique de l'équipe</b>
                ${d.events.length ? `<ul class="as-list">${d.events.map(e => `<li><span><b>${esc(EVENT[e.action] || e.action)}</b><small>${dateTime(e.created_at)} · ${esc(e.actor)}${e.details ? ' · ' + esc(e.details) : ''}</small></span></li>`).join('')}</ul>`
                    : '<p class="as-empty">Aucune action de l\'équipe.</p>'}</div>
            ${d.reviews?.shop || d.reviews?.courier ? `<div class="dl-card"><b class="sr-sub">Avis du client</b>
                ${d.reviews.shop ? `<p class="as-line">Boutique : ${'★'.repeat(d.reviews.shop.stars)}${d.reviews.shop.comment ? ' « ' + esc(d.reviews.shop.comment) + ' »' : ''}</p>` : ''}
                ${d.reviews.courier ? `<p class="as-line">Livreur : ${'★'.repeat(d.reviews.courier.stars)}${d.reviews.courier.comment ? ' « ' + esc(d.reviews.courier.comment) + ' »' : ''}</p>` : ''}</div>` : ''}
            ${Number(d.reports) ? `<p class="as-alert">${num(d.reports)} signalement(s) sur cette commande : <a href="admin-reports.html">voir</a></p>` : ''}
            <p class="as-note"><a href="equipe.html">Agir sur la commande (confirmer, annuler, payée) dans l'Espace équipe</a></p>`;
        window.scrollTo(0, 0);
    }

    // ============ NAVIGATION ============
    function srGo(q) {
        const term = String(q || '').trim();
        history.replaceState(null, '', term ? `?q=${encodeURIComponent(term)}` : location.pathname);
        search(term);
    }

    async function init() {
        if (!window.supabase?.auth) { message('<p>Service indisponible.</p>'); return; }
        const { data } = await window.supabase.auth.getSession();
        if (!data?.session) {
            document.getElementById('srForm').hidden = true;
            message(`<i class="fas fa-lock"></i><h3>Espace administrateur</h3><p>Connecte-toi avec ton compte administrateur.</p>
                <button class="btn-submit" onclick="openEmailLoginModal()">Se connecter</button>`);
            window.supabase.auth.onAuthStateChange(event => { if (event === 'SIGNED_IN') location.reload(); });
            return;
        }
        const { data: isAdmin } = await rpc('is_admin');
        if (!isAdmin) {
            document.getElementById('srForm').hidden = true;
            message(`<i class="fas fa-ban"></i><h3>Accès réservé</h3><p>Ce compte n'est pas administrateur.</p><a class="btn-submit" href="index.html">Retour à l'accueil</a>`);
            return;
        }
        const params = new URLSearchParams(location.search);
        const input = document.getElementById('srInput');
        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => srGo(input.value), 350);
        });
        if (params.get('u')) showPerson(params.get('u'));
        else if (params.get('order')) showOrder(params.get('order'));
        else {
            input.value = params.get('q') || '';
            search(input.value);
            input.focus();
        }
    }

    window.srGo = srGo;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
