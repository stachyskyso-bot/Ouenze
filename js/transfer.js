// ============================================================
// TRANSFER.JS — Confirmation du transfert d'une boutique
// Lien reçu par email / SMS / WhatsApp : transfer.html?t=<jeton>
// L'acheteur doit être connecté avec l'email indiqué par le vendeur.
// ============================================================

(function () {
    'use strict';

    const token = new URLSearchParams(location.search).get('t') || '';
    const box = () => document.getElementById('transferApp');

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function safeImg(url) {
        const u = String(url || '');
        return /^(https:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(u) ? u : '';
    }

    function status(icon, cls, title, text, extra = '') {
        box().innerHTML = `<div class="dl-status ${cls}"><i class="fas ${icon}"></i><h3>${title}</h3><p>${text}</p>${extra}</div>`;
    }

    async function call(body) {
        const { data, error } = await window.supabase.functions.invoke('shop-transfer', { body });
        if (error) {
            // Les erreurs métier (403, 409…) arrivent dans error.context
            let message = 'Service indisponible, réessaie plus tard.';
            try { message = (await error.context.json()).error || message; } catch (e) { /* réponse non JSON */ }
            return { error: message };
        }
        return { data };
    }

    async function render() {
        if (!/^[a-f0-9]{64}$/.test(token)) {
            status('fa-unlink', 'rejected', 'Lien invalide', 'Ce lien de transfert est incomplet. Copie-le en entier depuis le message reçu.');
            return;
        }
        const { data: t, error } = await call({ action: 'preview', token });
        if (error) { status('fa-unlink', 'rejected', 'Lien invalide', esc(error)); return; }
        if (t.status !== 'pending') {
            const msg = { accepted: 'Ce transfert a déjà été accepté.', cancelled: 'Le vendeur a annulé ce transfert.', expired: 'Ce lien a expiré (72 h). Demande au vendeur de t\'en envoyer un nouveau.' };
            status('fa-hourglass-end', 'rejected', 'Lien plus valable', msg[t.status] || 'Ce transfert n\'est plus disponible.');
            return;
        }

        const { data: s } = await window.supabase.auth.getSession();
        const user = s?.session?.user;
        const logo = safeImg(t.logo_url);
        box().innerHTML = `
            <div class="transfer-shop">
                <div class="transfer-logo">${logo ? `<img src="${logo}" alt="">` : '<i class="fas fa-store"></i>'}</div>
                <div>
                    <h3>${esc(t.shop_name)}</h3>
                    <p>${t.shop_city ? `<i class="fas fa-map-marker-alt"></i> ${esc(t.shop_city)} · ` : ''}proposée par <strong>${esc(t.seller_name)}</strong></p>
                </div>
            </div>
            <dl class="dl-recap">
                ${t.price !== null && t.price !== undefined ? `<dt>Prix convenu</dt><dd>${Number(t.price).toLocaleString('fr-FR')} FCFA</dd>` : ''}
                <dt>Destinataire</dt><dd>${esc(t.to_email_masked)}</dd>
                <dt>Valable jusqu'au</dt><dd>${new Date(t.expires_at).toLocaleString('fr-FR')}</dd>
            </dl>
            <div class="transfer-warning">
                <i class="fas fa-shield-alt"></i>
                <span>En acceptant, la boutique, ses produits et son historique passent sur <strong>ton compte</strong>. Ne paie le vendeur qu'après avoir vérifié la boutique. Ouenze n'encaisse pas ce paiement.</span>
            </div>
            <div class="form-error" id="dlError" role="alert"></div>
            ${user ? `
                <p class="dl-note">Connecté en tant que <strong>${esc(user.email)}</strong>.</p>
                <button class="btn-submit" id="acceptBtn" onclick="acceptTransfer()"><i class="fas fa-check"></i> Accepter le transfert</button>` : `
                <p class="dl-note">Connecte-toi (ou crée ton compte) avec l'adresse <strong>${esc(t.to_email_masked)}</strong> pour accepter.</p>
                <div class="dl-actions">
                    <button class="btn-submit" onclick="openLoginModal()">Se connecter</button>
                    <button class="btn-submit btn-light" onclick="openRegisterModal()">Créer un compte</button>
                </div>`}`;
    }

    async function acceptTransfer() {
        const btn = document.getElementById('acceptBtn');
        if (!confirm('Confirmer : cette boutique passe sur ton compte ?')) return;
        btn.disabled = true;
        btn.textContent = 'Transfert en cours…';
        const { data, error } = await call({ action: 'accept', token });
        if (error) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check"></i> Accepter le transfert';
            const el = document.getElementById('dlError');
            el.textContent = error;
            el.style.display = 'block';
            return;
        }
        status('fa-check-circle', 'ok', 'Boutique transférée 🎉', 'La boutique est maintenant sur ton compte. Tu peux la gérer depuis ton tableau de bord vendeur.',
            `<a class="btn-submit" href="vendor-dashboard.html">Ouvrir mon tableau de bord</a>`);
        return data;
    }

    async function init() {
        if (!window.supabase?.functions) { status('fa-exclamation-circle', 'rejected', 'Service indisponible', 'Recharge la page.'); return; }
        await render();
        window.supabase.auth.onAuthStateChange(event => { if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') render(); });
    }

    window.acceptTransfer = acceptTransfer;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
