// ============================================================
// ADMIN-VENDORS.JS — Demandes vendeurs (admin-vendors.html)
//
// Accès : comptes listés dans public.admin_users (is_admin()).
// Lien direct (email, notification) : admin-vendors.html?id=<demande>
// L'admin appelle / écrit sur WhatsApp au demandeur, puis valide, refuse ou suspend :
// RPC review_vendor_application, puis email au demandeur via l'Edge Function
// « vendor-application » (action decision). Bouton « Tester les emails » (action ping).
// ============================================================

(function () {
    'use strict';

    const STATUS = { pending: 'En attente', approved: 'Validé', rejected: 'Refusé', suspended: 'Suspendu' };
    let applications = [];
    let currentTab = 'pending';

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const digits = p => String(p || '').replace(/[^\d+]/g, '');
    const box = () => document.getElementById('adminApp');

    function message(html) {
        box().innerHTML = `<div class="dl-card"><div class="dl-status">${html}</div></div>`;
    }

    // ============ LISTE ============
    function renderList() {
        const counts = { pending: 0, approved: 0, rejected: 0, suspended: 0 };
        applications.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1; });
        const list = currentTab === 'all' ? applications : applications.filter(a => a.status === currentTab);
        box().innerHTML = `
            <div class="adm-stats">
                <div class="adm-stat"><strong style="color:var(--warning);">${counts.pending}</strong><span>En attente</span></div>
                <div class="adm-stat"><strong style="color:var(--success);">${counts.approved}</strong><span>Validés</span></div>
                <div class="adm-stat"><strong style="color:var(--danger);">${counts.rejected + counts.suspended}</strong><span>Refusés / suspendus</span></div>
            </div>
            <div class="adm-tabs">
                ${[['pending', 'En attente'], ['approved', 'Validés'], ['rejected', 'Refusés'], ['suspended', 'Suspendus'], ['all', 'Tous']].map(([k, l]) =>
                    `<button class="adm-tab ${k === currentTab ? 'active' : ''}" onclick="avTab('${k}')">${l}</button>`).join('')}
            </div>
            <div class="adm-list">
                ${list.length ? list.map(a => `
                    <div class="adm-item" role="button" tabindex="0" onclick="avOpen('${esc(a.id)}')" onkeydown="if(event.key==='Enter')avOpen('${esc(a.id)}')">
                        <i class="fas fa-store" style="font-size:22px;color:var(--primary);"></i>
                        <div class="adm-item-main">
                            <strong>${esc(a.business_name)} <span style="font-weight:400;color:var(--gray-500);">· ${esc(a.full_name)}</span></strong>
                            <small>${esc(a.phone)} · ${esc(a.city)} · ${esc(a.category)} · ${new Date(a.created_at).toLocaleDateString('fr-FR')}</small>
                        </div>
                        <span class="adm-badge ${esc(a.status)}">${STATUS[a.status] || esc(a.status)}</span>
                    </div>`).join('')
                : '<div class="dl-card" style="text-align:center;color:var(--gray-500);">Aucune demande ici.</div>'}
            </div>
            <div class="dl-card adm-mailtest">
                <strong><i class="fas fa-envelope"></i> Les emails ne partent pas ?</strong>
                <p>Envoie un email de test à l'adresse admin : la réponse exacte de Brevo s'affiche ici.</p>
                <button class="btn-cancel" id="avPing" onclick="avPing()">Tester l'envoi des emails</button>
                <pre id="avPingResult" hidden></pre>
            </div>`;
    }

    function avTab(tab) {
        currentTab = tab;
        history.replaceState(null, '', 'admin-vendors.html');
        renderList();
    }

    // ============ FICHE ============
    function avOpen(id) {
        const a = applications.find(x => String(x.id) === String(id));
        if (!a) { message('<i class="fas fa-search"></i><h3>Demande introuvable</h3><button class="btn-submit" onclick="avTab(\'all\')">Voir toutes les demandes</button>'); return; }
        history.replaceState(null, '', 'admin-vendors.html?id=' + encodeURIComponent(a.id));
        const wa = digits(a.whatsapp || a.phone).replace(/^\+/, '');
        const rows = [
            ['Nom', a.full_name], ['Email', a.email], ['Téléphone', a.phone], ['WhatsApp', a.whatsapp || a.phone],
            ['Ville', [a.district, a.city].filter(Boolean).join(', ')], ['Activité', a.business_name], ['Produits', a.category],
            ['Boutique physique', a.has_physical_store ? 'Oui' : 'Non'], ['Réseaux / site', a.social_link || '—'],
            ['Reçue le', new Date(a.created_at).toLocaleString('fr-FR')]
        ];
        if (a.reviewed_at) rows.push(['Décision', `${STATUS[a.status]} le ${new Date(a.reviewed_at).toLocaleString('fr-FR')}${a.review_note ? ' — ' + a.review_note : ''}`]);
        const btn = (decision, cls, icon, label) => `<button class="btn-submit ${cls}" onclick="avDecide('${esc(a.id)}', '${decision}')"><i class="fas ${icon}"></i> ${label}</button>`;
        box().innerHTML = `
            <button class="back-link" onclick="avTab('${esc(a.status)}')"><i class="fas fa-arrow-left"></i> Toutes les demandes</button>
            <div class="dl-card">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                    <h3 class="dl-title" style="margin:0;">${esc(a.business_name)}</h3>
                    <span class="adm-badge ${esc(a.status)}">${STATUS[a.status] || esc(a.status)}</span>
                </div>
                <div class="av-contact">
                    <a class="btn-submit" href="tel:${esc(digits(a.phone))}"><i class="fas fa-phone"></i> Appeler</a>
                    <a class="btn-submit av-wa" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> WhatsApp</a>
                    <a class="btn-cancel" href="mailto:${esc(a.email)}"><i class="fas fa-envelope"></i> Email</a>
                </div>
                <dl class="dl-recap">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
                ${a.description ? `<p class="av-desc">${esc(a.description)}</p>` : ''}
                <div class="form-error" id="avError" role="alert"></div>
                <div class="adm-decision">
                    ${a.status !== 'approved' ? btn('approved', 'btn-approve', 'fa-check', a.status === 'suspended' ? 'Réactiver le vendeur' : 'Valider le vendeur') : ''}
                    ${a.status === 'pending' ? btn('rejected', 'btn-reject', 'fa-times', 'Refuser') : ''}
                    ${a.status === 'approved' ? btn('suspended', 'btn-reject', 'fa-ban', 'Suspendre') : ''}
                </div>
                <p class="dl-note">Valider passe le compte en « vendeur » : il peut alors créer sa boutique. Suspendre masque ses boutiques.</p>
            </div>`;
        window.scrollTo(0, 0);
    }

    async function avDecide(id, decision) {
        let note = null;
        if (decision === 'approved') {
            if (!confirm('Valider ce vendeur ? Il pourra créer sa boutique et vendre sur Ouenze.')) return;
        } else {
            note = prompt(decision === 'rejected' ? 'Motif du refus (envoyé au demandeur) :' : 'Motif de la suspension (envoyé au vendeur) :', '');
            if (note === null) return;
            note = note.trim().slice(0, 300) || null;
        }
        document.querySelectorAll('.adm-decision button').forEach(b => { b.disabled = true; });
        const { data, error } = await window.supabase.rpc('review_vendor_application', { application_id: id, decision, note });
        if (error) {
            document.querySelectorAll('.adm-decision button').forEach(b => { b.disabled = false; });
            const el = document.getElementById('avError');
            if (el) { el.textContent = 'Décision impossible : ' + error.message; el.style.display = 'block'; }
            return;
        }
        const updated = Array.isArray(data) ? data[0] : data;
        const idx = applications.findIndex(a => String(a.id) === String(id));
        if (idx !== -1 && updated) applications[idx] = updated;
        let mailError = '';
        try {
            const res = await window.supabase.functions.invoke('vendor-application', { body: { action: 'decision', application_id: id } });
            if (res.error) mailError = (await res.error.context?.json?.().catch(() => null))?.detail || res.error.message;
        } catch (e) { mailError = e.message; }
        alert(`${{ approved: '✅ Vendeur validé.', rejected: 'Demande refusée.', suspended: 'Vendeur suspendu.' }[decision]}
Il est prévenu par notification sur le site${mailError ? '.\n\n(Email non envoyé : ' + mailError + ')' : ' et par email.'}`);
        avOpen(id);
    }

    async function avPing() {
        const btn = document.getElementById('avPing');
        const out = document.getElementById('avPingResult');
        btn.disabled = true;
        out.hidden = false;
        out.textContent = 'Envoi…';
        try {
            const res = await window.supabase.functions.invoke('vendor-application', { body: { action: 'ping' } });
            if (res.error) {
                const body = await res.error.context?.json?.().catch(() => null);
                out.textContent = '❌ ' + (body ? JSON.stringify(body, null, 2) : res.error.message)
                    + (/Failed to send|not found|404/i.test(res.error.message || '') ? '\n\nLa fonction « vendor-application » est-elle déployée ?' : '');
            } else {
                out.textContent = `✅ Brevo a accepté l'email.\nDestinataire : ${res.data.to}\nExpéditeur : ${res.data.sender}\nRéponse Brevo : ${JSON.stringify(res.data.brevo)}\n\nRien reçu ? Regarde les spams, puis Brevo → Transactional → Logs (recherche le messageId).`;
            }
        } catch (e) {
            out.textContent = '❌ ' + e.message;
        } finally {
            btn.disabled = false;
        }
    }

    // ============ DÉMARRAGE ============
    async function init() {
        if (!window.supabase?.auth) { message('<p>Service indisponible.</p>'); return; }
        const { data } = await window.supabase.auth.getSession();
        if (!data?.session) {
            message(`<i class="fas fa-lock"></i><h3>Espace administrateur</h3><p>Connecte-toi avec ton compte administrateur.</p>
                <button class="btn-submit" onclick="openLoginModal()">Se connecter</button>`);
            window.supabase.auth.onAuthStateChange(event => { if (event === 'SIGNED_IN') location.reload(); });
            return;
        }
        const { data: isAdmin, error: adminError } = await window.supabase.rpc('is_admin');
        if (adminError || !isAdmin) {
            message(`<i class="fas fa-ban"></i><h3>Accès réservé</h3><p>Ce compte n'est pas administrateur.</p>
                <a class="btn-submit" href="index.html">Retour à l'accueil</a>`);
            return;
        }
        const { data: rows, error } = await window.supabase.from('vendor_applications').select('*').order('created_at', { ascending: false });
        if (error) {
            message(/does not exist|schema cache/i.test(error.message || '')
                ? '<i class="fas fa-tools"></i><h3>Base de données à mettre à jour</h3><p>Exécute la migration 20261020_vendor_applications.sql dans Supabase.</p>'
                : '<p>Chargement impossible : ' + esc(error.message) + '</p>');
            return;
        }
        applications = rows || [];
        const id = new URLSearchParams(location.search).get('id');
        if (id) avOpen(id); else renderList();
    }

    Object.assign(window, { avTab, avOpen, avDecide, avPing });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
