// ============================================================
// REPORT.JS — Signaler un vendeur (boutique) ou un livreur
//
// Fichier autonome (fenêtre et styles intégrés) : utilisable sur toutes les pages,
// y compris le tableau de bord vendeur qui ne charge pas app.js.
//   openReport('vendor', orderId|null, shopId|null, nomBoutique)
//   openReport('courier', orderId)
//   openOrderReport(orderId, avecLivreur)   → choix « Le vendeur » / « Le livreur »
// RPC report_problem (migration 20261028). L'équipe Ouenze traite sur admin-reports.html.
// ============================================================

(function () {
    'use strict';

    const REASONS = [
        ['retard', 'Retard'], ['colis_abime', 'Colis abîmé'], ['non_conforme', 'Produit non conforme'],
        ['comportement', 'Comportement'], ['injoignable', 'Injoignable'], ['arnaque', 'Arnaque'], ['autre', 'Autre']
    ];
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let target = null;

    function injectStyles() {
        if (document.getElementById('rpStyles')) return;
        const st = document.createElement('style');
        st.id = 'rpStyles';
        st.textContent = `
            .rp-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:flex-end;justify-content:center;z-index:5000;}
            @media(min-width:600px){.rp-overlay{align-items:center;}}
            .rp-card{background:#fff;color:#1e293b;width:100%;max-width:440px;border-radius:20px 20px 0 0;padding:20px 18px 24px;max-height:92vh;overflow:auto;position:relative;font-family:inherit;}
            @media(min-width:600px){.rp-card{border-radius:20px;}}
            .rp-card h3{font-size:19px;margin:0 30px 6px 0;}
            .rp-card p.rp-sub{font-size:13px;color:#64748b;margin:0 0 14px;}
            .rp-close{position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:50%;border:none;background:#f1f5f9;font-size:20px;cursor:pointer;}
            .rp-reasons{display:flex;flex-wrap:wrap;gap:8px;}
            .rp-reasons label{cursor:pointer;}
            .rp-reasons input{position:absolute;opacity:0;pointer-events:none;}
            .rp-reasons span{display:inline-block;padding:9px 14px;border:1.5px solid #e2e8f0;border-radius:30px;font-size:14px;}
            .rp-reasons input:checked+span{border-color:#dc2626;background:#fef2f2;color:#b91c1c;font-weight:600;}
            .rp-card textarea{width:100%;margin-top:6px;padding:10px;border:1px solid #cbd5e1;border-radius:12px;font:inherit;font-size:14px;resize:vertical;box-sizing:border-box;}
            .rp-card label.rp-l{display:block;margin-top:14px;font-size:13px;font-weight:600;}
            .rp-err{color:#dc2626;font-size:13px;margin-top:10px;min-height:1em;}
            .rp-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:12px;padding:13px;border:none;border-radius:14px;background:#1e40af;color:#fff;font:inherit;font-size:16px;font-weight:600;cursor:pointer;}
            .rp-btn.danger{background:#dc2626;}
            .rp-btn:disabled{opacity:.6;}
            .rp-done{text-align:center;}
            .rp-done i{font-size:42px;color:#16a34a;}`;
        document.head.appendChild(st);
    }

    function close() { document.getElementById('rpOverlay')?.remove(); }

    function show(html) {
        injectStyles();
        close();
        const ov = document.createElement('div');
        ov.className = 'rp-overlay';
        ov.id = 'rpOverlay';
        ov.innerHTML = `<div class="rp-card" role="dialog" aria-modal="true"><button class="rp-close" aria-label="Fermer" onclick="closeReport()">&times;</button>${html}</div>`;
        ov.addEventListener('click', e => { if (e.target === ov) close(); });
        document.body.appendChild(ov);
    }

    async function signedIn() {
        try { return !!(await window.supabase?.auth?.getSession())?.data?.session; } catch (e) { return false; }
    }

    async function openReport(kind, orderId, shopId, label) {
        if (!await signedIn()) {
            if (typeof window.openLoginModal === 'function') window.openLoginModal();
            else show('<h3>Connecte-toi</h3><p class="rp-sub">Connecte-toi pour signaler un problème.</p>');
            return;
        }
        target = { kind, orderId: orderId || null, shopId: shopId || null };
        const who = kind === 'courier' ? 'le livreur' : (label ? `la boutique ${label}` : 'le vendeur');
        show(`
            <h3><i class="fas fa-flag" style="color:#dc2626;"></i> Signaler ${esc(who)}</h3>
            <p class="rp-sub">Ton signalement part à l'équipe Ouenze. La personne signalée ne voit pas ton nom.</p>
            <div class="rp-reasons">${REASONS.map(([k, l]) => `<label><input type="radio" name="rpReason" value="${k}"><span>${l}</span></label>`).join('')}</div>
            <label class="rp-l" for="rpDetails">Explique en quelques mots (facultatif)</label>
            <textarea id="rpDetails" rows="3" maxlength="1000" placeholder="Que s'est-il passé ?"></textarea>
            <div class="rp-err" id="rpError" role="alert"></div>
            <button class="rp-btn danger" id="rpSend" onclick="sendReport()"><i class="fas fa-paper-plane"></i> Envoyer le signalement</button>`);
    }

    async function sendReport() {
        const err = m => { document.getElementById('rpError').textContent = m; };
        const reason = document.querySelector('input[name="rpReason"]:checked')?.value;
        const details = (document.getElementById('rpDetails')?.value || '').trim();
        if (!reason) return err('Choisis un motif.');
        if (reason === 'autre' && details.length < 5) return err('Explique le problème en quelques mots.');
        const btn = document.getElementById('rpSend');
        btn.disabled = true;
        const { error } = await window.supabase.rpc('report_problem', {
            target_kind: target.kind, target_order: target.orderId, target_shop: target.shopId, reason, details: details || null
        });
        btn.disabled = false;
        if (error) {
            const msg = error.message || '';
            return err(/report_problem|schema cache|does not exist/i.test(msg) ? 'Les signalements arrivent bientôt (base de données à mettre à jour).' : msg);
        }
        show(`<div class="rp-done"><i class="fas fa-check-circle"></i><h3 style="margin:10px 0 6px;">Merci, c'est envoyé</h3>
            <p class="rp-sub">L'équipe Ouenze va regarder ton signalement et agir si besoin.</p>
            <button class="rp-btn" onclick="closeReport()">Fermer</button></div>`);
    }

    function openOrderReport(orderId, hasCourier) {
        if (!hasCourier) return openReport('vendor', orderId);
        show(`<h3><i class="fas fa-flag" style="color:#dc2626;"></i> Signaler un problème</h3>
            <p class="rp-sub">Qui veux-tu signaler ?</p>
            <button class="rp-btn" onclick="openReport('vendor', '${esc(orderId)}')"><i class="fas fa-store"></i> Le vendeur</button>
            <button class="rp-btn" onclick="openReport('courier', '${esc(orderId)}')"><i class="fas fa-motorcycle"></i> Le livreur</button>`);
    }

    Object.assign(window, { openReport, sendReport, openOrderReport, closeReport: close });
})();
