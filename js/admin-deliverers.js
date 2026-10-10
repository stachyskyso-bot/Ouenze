// ============================================================
// ADMIN-DELIVERERS.JS — Validation des candidatures livreurs
//
// Accès : comptes listés dans public.admin_users (fonction is_admin()).
// Lien direct depuis l'email : admin-deliverers.html?id=<candidature>
// Validation / refus : RPC review_delivery_application, puis email au
// livreur via l'Edge Function « delivery-application » (action decision).
// ============================================================

(function () {
    'use strict';

    const PHOTOS = [
        ['license_photo_path', 'Permis de conduire'],
        ['vehicle_photo_path', 'Véhicule'],
        ['id_photo_path', "Pièce d'identité"],
        ['profile_photo_path', 'Photo du livreur']
    ];
    const STATUS = { pending: 'En attente', approved: 'Validé', rejected: 'Refusé' };

    let applications = [];
    let currentTab = 'pending';

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function formatDate(iso) {
        if (!iso) return '';
        const [y, m, d] = String(iso).slice(0, 10).split('-');
        return `${d}/${m}/${y}`;
    }

    const box = () => document.getElementById('adminApp');

    function message(html) {
        box().innerHTML = `<div class="dl-card"><div class="dl-status">${html}</div></div>`;
    }

    // ============ LISTE ============
    function renderList() {
        const counts = { pending: 0, approved: 0, rejected: 0 };
        applications.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1; });
        const list = currentTab === 'all' ? applications : applications.filter(a => a.status === currentTab);
        box().innerHTML = `
            <div class="adm-stats">
                <div class="adm-stat"><strong style="color:var(--warning);">${counts.pending}</strong><span>En attente</span></div>
                <div class="adm-stat"><strong style="color:var(--success);">${counts.approved}</strong><span>Validés</span></div>
                <div class="adm-stat"><strong style="color:var(--danger);">${counts.rejected}</strong><span>Refusés</span></div>
            </div>
            <div class="adm-tabs">
                ${[['pending', 'En attente'], ['approved', 'Validés'], ['rejected', 'Refusés'], ['all', 'Toutes']].map(([k, l]) =>
                    `<button class="adm-tab ${k === currentTab ? 'active' : ''}" onclick="admTab('${k}')">${l}</button>`).join('')}
            </div>
            <div class="adm-list">
                ${list.length ? list.map(a => `
                    <div class="adm-item" role="button" tabindex="0" onclick="admOpen('${esc(a.id)}')">
                        <i class="fas ${a.vehicle_type === 'voiture' ? 'fa-car' : 'fa-motorcycle'}" style="font-size:22px;color:var(--primary);"></i>
                        <div class="adm-item-main">
                            <strong>${esc(a.full_name)}</strong>
                            <small>${esc(a.city)} · ${esc(a.plate_number)} · ${new Date(a.created_at).toLocaleDateString('fr-FR')}</small>
                        </div>
                        <span class="adm-badge ${esc(a.status)}">${STATUS[a.status] || esc(a.status)}</span>
                    </div>`).join('')
                : '<div class="dl-card" style="text-align:center;color:var(--gray-500);">Aucune candidature ici.</div>'}
            </div>`;
    }

    function admTab(tab) {
        currentTab = tab;
        history.replaceState(null, '', 'admin-deliverers.html');
        renderList();
    }

    // ============ FICHE ============
    async function admOpen(id) {
        const a = applications.find(x => String(x.id) === String(id));
        if (!a) { message('<i class="fas fa-search"></i><h3>Candidature introuvable</h3><button class="btn-submit" onclick="admTab(\'all\')">Voir toutes les candidatures</button>'); return; }
        history.replaceState(null, '', 'admin-deliverers.html?id=' + encodeURIComponent(a.id));
        const expired = a.license_expiry && a.license_expiry < new Date().toISOString().slice(0, 10);
        const rows = [
            ['Email', a.email], ['Téléphone', a.phone], ['Pays / ville', `${a.country} — ${a.city}, ${a.district}`],
            ['Véhicule', `${a.vehicle_type === 'voiture' ? 'Voiture' : 'Moto'}${a.vehicle_brand ? ' — ' + a.vehicle_brand : ''}`],
            ['Immatriculation', a.plate_number], ['N° de permis', a.license_number],
            ['Permis valable jusqu\'au', formatDate(a.license_expiry) + (expired ? ' ⚠️ EXPIRÉ' : '')],
            ['Reçue le', new Date(a.created_at).toLocaleString('fr-FR')]
        ];
        if (a.reviewed_at) rows.push(['Décision', `${STATUS[a.status]} le ${new Date(a.reviewed_at).toLocaleString('fr-FR')}${a.review_note ? ' — ' + a.review_note : ''}`]);

        box().innerHTML = `
            <button class="back-link" onclick="admTab('${esc(a.status)}')"><i class="fas fa-arrow-left"></i> Toutes les candidatures</button>
            <div class="dl-card">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                    <h3 class="dl-title" style="margin:0;">${esc(a.full_name)}</h3>
                    <span class="adm-badge ${esc(a.status)}">${STATUS[a.status] || esc(a.status)}</span>
                </div>
                <dl class="dl-recap">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
                <div class="adm-detail-photos" id="admPhotos">${PHOTOS.map(([, label]) => `<figure><div class="dl-photo-preview">Chargement…</div><figcaption>${label}</figcaption></figure>`).join('')}</div>
                ${a.status === 'pending' ? `
                    <div class="form-error" id="dlError" role="alert"></div>
                    <div class="adm-decision">
                        <button class="btn-submit btn-approve" id="admApprove" onclick="admDecide('${esc(a.id)}', 'approved')"><i class="fas fa-check"></i> Valider le livreur</button>
                        <button class="btn-submit btn-reject" id="admReject" onclick="admDecide('${esc(a.id)}', 'rejected')"><i class="fas fa-times"></i> Refuser</button>
                    </div>
                    <p class="dl-note">La validation passe le compte en « livreur » et lui envoie un email.</p>` : ''}
            </div>`;
        window.scrollTo(0, 0);

        // Photos privées : liens signés valables 1 heure
        const paths = PHOTOS.map(([field]) => a[field]).filter(Boolean);
        const { data: signed, error } = await window.supabase.storage.from('delivery-docs').createSignedUrls(paths, 3600);
        const holder = document.getElementById('admPhotos');
        if (!holder) return;
        holder.innerHTML = PHOTOS.map(([field, label]) => {
            const url = (signed || []).find(s => s.path === a[field])?.signedUrl;
            return `<figure>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="${label}"></a>`
                                 : `<div class="dl-photo-preview">${error ? 'Accès refusé' : 'Photo manquante'}</div>`}<figcaption>${label}</figcaption></figure>`;
        }).join('');
    }

    async function admDecide(id, decision) {
        let note = null;
        if (decision === 'rejected') {
            note = prompt('Motif du refus (envoyé au livreur) :', 'Photo du permis illisible');
            if (note === null) return;
            note = note.trim().slice(0, 300) || null;
        } else if (!confirm('Valider ce livreur ? Son compte pourra accepter des livraisons.')) {
            return;
        }
        ['admApprove', 'admReject'].forEach(b => { const el = document.getElementById(b); if (el) el.disabled = true; });
        const { data, error } = await window.supabase.rpc('review_delivery_application', { application_id: id, decision, note });
        if (error) {
            ['admApprove', 'admReject'].forEach(b => { const el = document.getElementById(b); if (el) el.disabled = false; });
            const box = document.getElementById('dlError');
            if (box) { box.textContent = 'Décision impossible : ' + error.message; box.style.display = 'block'; }
            return;
        }
        const updated = Array.isArray(data) ? data[0] : data;
        const idx = applications.findIndex(a => String(a.id) === String(id));
        if (idx !== -1 && updated) applications[idx] = updated;
        const { error: fnError } = await window.supabase.functions.invoke('delivery-application', { body: { action: 'decision', application_id: id } });
        if (fnError) console.warn('⚠️ Email au livreur non envoyé :', fnError);
        alert(decision === 'approved'
            ? `✅ Livreur validé.${fnError ? '\n\n(L\'email de confirmation n\'a pas pu être envoyé.)' : ' Un email lui a été envoyé.'}`
            : `Candidature refusée.${fnError ? '' : ' Le livreur a reçu le motif par email.'}`);
        admOpen(id);
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
        const { data: rows, error } = await window.supabase.from('delivery_applications').select('*').order('created_at', { ascending: false });
        if (error) { message('<p>Chargement impossible : ' + esc(error.message) + '</p>'); return; }
        applications = rows || [];
        const id = new URLSearchParams(location.search).get('id');
        if (id) admOpen(id); else renderList();
    }

    Object.assign(window, { admTab, admOpen, admDecide });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
