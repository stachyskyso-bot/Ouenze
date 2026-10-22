// ============================================================
// VENDOR-REGISTER.JS — Demande pour devenir vendeur (vendor-register.html)
//
// 1. Connexion (fenêtre du site)
// 2. Formulaire : nom, téléphone, WhatsApp, ville, activité, produits, description
// 3. Envoi : table vendor_applications (statut « pending »), puis email à l'admin
//    via l'Edge Function « vendor-application » (action notify). L'admin reçoit
//    aussi une notification sur le site (trigger SQL), même si l'email échoue.
// 4. Suivi : en attente / validée (→ créer ma boutique) / refusée (motif, corriger) / suspendue
// Dépendances : supabase-js → supabase-config → database → app (OuenzeForms)
// ============================================================

(function () {
    'use strict';

    const CATEGORIES = ['Alimentaire', 'Mode et vêtements', 'Beauté et cosmétiques', 'Électronique et téléphones', 'Maison et électroménager',
        'Bébés et enfants', 'Sport', 'Auto et moto', 'Artisanat', 'Autre'];
    const state = { user: null, app: null, editing: false };
    const box = () => document.getElementById('vendorApp');
    const F = () => window.OuenzeForms;

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function setError(msg, fieldId) {
        const el = document.getElementById('vrError');
        if (el) {
            el.textContent = msg || '';
            el.style.display = msg ? 'block' : 'none';
            if (msg) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        if (fieldId) document.getElementById(fieldId)?.focus();
        return false;
    }

    // Numéro saisi → format international (+242… / +243…), sinon null
    function phoneOf(raw, cc) {
        const v = String(raw || '').trim();
        if (!v) return null;
        return F().normalizePhone(v, cc) || F().normalizePhone(v, cc === 'CG' ? 'CD' : 'CG');
    }

    // ---------- Écrans ----------
    function loginHtml() {
        return `<div class="dl-status"><i class="fas fa-user-lock" style="color:var(--primary);"></i>
            <h3>Connecte-toi pour faire ta demande</h3>
            <p>Crée un compte gratuit ou connecte-toi : ta demande sera liée à ton compte.</p>
            <button class="btn-submit" onclick="openEmailLoginModal()">Se connecter</button>
            <p class="dl-switch">Pas encore de compte ? <a href="#" onclick="openEmailRegisterModal();return false;">Créer un compte</a></p></div>`;
    }

    function statusHtml(a) {
        const contact = `<p>Notre équipe va te contacter au <strong>${esc(a.phone)}</strong>${a.whatsapp ? ` (WhatsApp ${esc(a.whatsapp)})` : ''}.</p>`;
        if (a.status === 'pending') {
            return `<div class="dl-status"><i class="fas fa-hourglass-half" style="color:var(--warning);"></i>
                <h3>Demande envoyée</h3>
                <p>Merci ${esc(a.full_name)} ! Ta demande pour <strong>${esc(a.business_name)}</strong> est en cours d'examen.</p>
                ${contact}
                <p class="dl-note">Dès que ton compte est validé, tu pourras créer ta boutique. Tu seras prévenu par notification et par email.</p>
                ${remindHtml(a, 'vrRemind')}
                <button class="btn-cancel" onclick="vrEdit()">Modifier ma demande</button></div>`;
        }
        if (a.status === 'approved') {
            return `<div class="dl-status ok"><i class="fas fa-check-circle"></i>
                <h3>Tu es vendeur Ouenze</h3>
                <p>Ta demande est validée. Crée ta boutique, ajoute tes produits et reçois tes premières commandes.</p>
                <a class="btn-submit" href="shop-designer.html"><i class="fas fa-store"></i> Créer ma boutique</a>
                <a class="btn-cancel" href="vendor-dashboard.html" style="display:block;text-align:center;text-decoration:none;">Mon espace vendeur</a></div>`;
        }
        if (a.status === 'rejected') {
            return `<div class="dl-status rejected"><i class="fas fa-times-circle"></i>
                <h3>Demande non retenue</h3>
                ${a.review_note ? `<p><strong>Motif :</strong> ${esc(a.review_note)}</p>` : ''}
                <p>Tu peux compléter ta demande et la renvoyer.</p>
                <button class="btn-submit" onclick="vrEdit()">Compléter et renvoyer</button></div>`;
        }
        return `<div class="dl-status rejected"><i class="fas fa-ban"></i>
            <h3>Compte vendeur suspendu</h3>
            ${a.review_note ? `<p><strong>Motif :</strong> ${esc(a.review_note)}</p>` : ''}
            <p>Tes boutiques ne sont plus visibles. Contacte Ouenze pour en parler.</p>
            <a class="btn-cancel" href="help.html" style="display:block;text-align:center;text-decoration:none;">Contacter Ouenze</a></div>`;
    }

    // Relance : possible 24 h après l'envoi (ou la dernière relance) ; la base vérifie aussi
    function remindHtml(a, fn) {
        const last = Math.max(Date.parse(a.reminded_at || 0) || 0, Date.parse(a.updated_at || a.created_at) || 0);
        const next = last + 24 * 3600 * 1000;
        const when = new Date(next).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return `<div class="dl-remind">
            ${a.reminded_at ? `<small><i class="fas fa-bell"></i> Relance envoyée le ${new Date(a.reminded_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>` : ''}
            ${Date.now() >= next
                ? `<button class="btn-submit" id="remindBtn" onclick="${fn}()"><i class="fas fa-bell"></i> Pas de réponse ? Relancer Ouenze</button>`
                : `<small>Pas de réponse ? Tu pourras relancer Ouenze à partir du ${when}.</small>`}
        </div>`;
    }

    async function vrRemind() {
        const btn = document.getElementById('remindBtn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Relance…'; }
        const { data, error } = await window.supabase.rpc('remind_my_application', { kind: 'vendor' });
        if (error) {
            alert(error.message || 'Relance impossible.');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-bell"></i> Pas de réponse ? Relancer Ouenze'; }
            return;
        }
        state.app.reminded_at = data || new Date().toISOString();
        render();
        // Email à l'admin en plus de la notification sur le site (échec sans conséquence)
        try { await window.supabase.functions.invoke('vendor-application', { body: { action: 'notify', application_id: state.app.id } }); } catch (e) { /* notification déjà envoyée */ }
        alert('Relance envoyée. L\'équipe Ouenze a été prévenue.');
    }

    function formHtml() {
        const a = state.app || {};
        const meta = state.user?.user_metadata || {};
        const cc = String(a.phone || meta.phone || '').startsWith('+243') ? 'CD' : 'CG';
        const C = F().COUNTRIES[cc];
        const allCities = [...F().COUNTRIES.CG.cities, ...F().COUNTRIES.CD.cities];
        const city = a.city || meta.city || 'Brazzaville';
        return `
            <h3 class="dl-title">${state.app ? 'Ma demande vendeur' : 'Ta demande vendeur'}</h3>
            <p class="dl-sub">Ces informations servent à te contacter et à présenter ton activité. Elles ne sont visibles que par l'équipe Ouenze.</p>
            <div class="form-group"><label>Nom complet *</label><input type="text" id="vrName" maxlength="80" autocomplete="name" value="${esc(a.full_name || meta.full_name || '')}"></div>
            <div class="form-row-2">
                <div class="form-group"><label>Téléphone *</label>
                    <input type="tel" id="vrPhone" inputmode="tel" placeholder="+${C.dial} ${C.example}" value="${esc(a.phone || meta.phone || '')}"></div>
                <div class="form-group"><label>WhatsApp (si différent)</label>
                    <input type="tel" id="vrWhatsapp" inputmode="tel" placeholder="+${C.dial} ${C.example}" value="${esc(a.whatsapp && a.whatsapp !== a.phone ? a.whatsapp : '')}"></div>
            </div>
            <div class="form-row-2">
                <div class="form-group"><label>Ville *</label>
                    <select id="vrCity">${allCities.map(c => `<option ${c === city ? 'selected' : ''}>${esc(c)}</option>`).join('')}
                        ${allCities.includes(city) ? '' : `<option selected>${esc(city)}</option>`}</select></div>
                <div class="form-group"><label>Quartier</label><input type="text" id="vrDistrict" maxlength="60" placeholder="Ex : Poto-Poto" value="${esc(a.district || '')}"></div>
            </div>
            <div class="form-group"><label>Nom de ton activité ou de ta boutique *</label>
                <input type="text" id="vrBusiness" maxlength="80" placeholder="Ex : Le Panier du Congo" value="${esc(a.business_name || '')}"></div>
            <div class="form-group"><label>Ce que tu vends *</label>
                <select id="vrCategory">${CATEGORIES.map(c => `<option ${c === a.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
            <div class="form-group"><label>Présente ton activité</label>
                <textarea id="vrDescription" rows="4" maxlength="1000" placeholder="Tes produits, depuis quand tu vends, où tu stockes, comment tu travailles…">${esc(a.description || '')}</textarea></div>
            <div class="form-group"><label>Page Facebook, Instagram, TikTok ou site (facultatif)</label>
                <input type="url" id="vrSocial" maxlength="300" placeholder="https://…" value="${esc(a.social_link || '')}"></div>
            <label class="dl-check"><input type="checkbox" id="vrStore" ${a.has_physical_store ? 'checked' : ''}> J'ai une boutique physique ou un point de vente</label>
            <div class="form-error" id="vrError" role="alert"></div>
            <button class="btn-submit" id="vrSubmit" onclick="vrSubmit()"><i class="fas fa-paper-plane"></i> ${state.app ? 'Renvoyer ma demande' : 'Envoyer ma demande'}</button>
            ${state.app ? '<button class="btn-cancel" onclick="vrCancelEdit()">Annuler</button>' : ''}
            <p class="dl-note"><i class="fas fa-lock"></i> Ouenze t'appelle avant de valider ton compte vendeur.</p>`;
    }

    function render() {
        if (!state.user) { box().innerHTML = loginHtml(); return; }
        box().innerHTML = state.app && !state.editing ? statusHtml(state.app) : formHtml();
    }

    // ---------- Actions ----------
    async function vrSubmit() {
        const v = id => (document.getElementById(id)?.value || '').trim();
        const cc = v('vrPhone').startsWith('+243') ? 'CD' : 'CG';
        const phone = phoneOf(v('vrPhone'), cc);
        const whatsapp = v('vrWhatsapp') ? phoneOf(v('vrWhatsapp'), cc) : null;
        if (v('vrName').length < 2) return setError('Indique ton nom complet.', 'vrName');
        if (!phone) return setError('Numéro invalide. Exemple : +242 06 555 25 62 ou +243 81 234 5678', 'vrPhone');
        if (v('vrWhatsapp') && !whatsapp) return setError('Numéro WhatsApp invalide.', 'vrWhatsapp');
        if (v('vrBusiness').length < 2) return setError("Indique le nom de ton activité.", 'vrBusiness');
        const social = v('vrSocial');
        if (social && !/^https?:\/\/\S+\.\S+/.test(social)) return setError('Le lien doit commencer par https://', 'vrSocial');
        setError('');
        const row = {
            full_name: v('vrName'), email: state.user.email, phone, whatsapp: whatsapp || phone,
            city: v('vrCity'), district: v('vrDistrict') || null, business_name: v('vrBusiness'), category: v('vrCategory'),
            description: v('vrDescription') || null, social_link: social || null,
            has_physical_store: !!document.getElementById('vrStore')?.checked, status: 'pending'
        };
        const btn = document.getElementById('vrSubmit');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi…';
        try {
            // Nouvelle demande, ou demande corrigée (renvoyée « en attente », décision précédente effacée)
            const query = state.app
                ? window.supabase.from('vendor_applications')
                    .update({ ...row, reviewed_by: null, reviewed_at: null, review_note: null }).eq('id', state.app.id)
                : window.supabase.from('vendor_applications').insert({ ...row, user_id: state.user.id });
            const { data, error } = await query.select().single();
            if (error) {
                setError(/vendor_applications|does not exist|schema cache/i.test(error.message || '')
                    ? "Les demandes vendeur ouvrent bientôt (base de données à mettre à jour)." : error.message);
                return;
            }
            state.app = data;
            state.editing = false;
            render();
            // Email à l'admin : n'empêche pas la demande s'il échoue (l'admin a aussi une notification sur le site)
            try {
                const res = await window.supabase.functions.invoke('vendor-application', { body: { action: 'notify', application_id: data.id } });
                if (res.error) console.warn('Email admin non envoyé :', res.error.message);
            } catch (e) { console.warn('Email admin non envoyé :', e); }
        } finally {
            if (document.getElementById('vrSubmit')) {
                btn.disabled = false;
                btn.innerHTML = `<i class="fas fa-paper-plane"></i> ${state.app ? 'Renvoyer ma demande' : 'Envoyer ma demande'}`;
            }
        }
    }

    function vrEdit() { state.editing = true; render(); }
    function vrCancelEdit() { state.editing = false; render(); }

    async function init() {
        if (!window.supabase?.auth || !window.OuenzeForms) {
            box().innerHTML = '<div class="dl-status rejected"><p>Service indisponible. Recharge la page.</p></div>';
            return;
        }
        const { data } = await window.supabase.auth.getSession();
        state.user = data?.session?.user || null;
        if (!state.user) {
            window.supabase.auth.onAuthStateChange?.(e => { if (e === 'SIGNED_IN') location.reload(); });
            render();
            return;
        }
        const { data: app, error } = await window.supabase.from('vendor_applications').select('*').eq('user_id', state.user.id).maybeSingle();
        if (error && !/does not exist|schema cache/i.test(error.message || '')) console.warn(error);
        state.app = app || null;
        render();
    }

    Object.assign(window, { vrSubmit, vrEdit, vrCancelEdit, vrRemind });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
