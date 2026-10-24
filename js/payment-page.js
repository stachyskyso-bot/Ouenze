// ============================================================
// PAYMENT-PAGE.JS — Page de paiement d'une commande (paiement.html?tx=…)
//
// Lien reçu par SMS après la livraison (Mobile Money) ou pendant l'appel (carte).
// Le bouton « Payer » ouvre la page sécurisée CinetPay : le client choisit son réseau,
// reçoit la demande sur son téléphone et tape son code secret.
// Au retour, la page redemande le statut au serveur (qui vérifie auprès de CinetPay).
// Sans clés CinetPay : mode simulation (seule l'équipe peut simuler un paiement).
// ============================================================

(function () {
    'use strict';

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fcfa = n => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} FCFA`;
    const box = () => document.getElementById('payApp');
    const tx = new URLSearchParams(location.search).get('tx') || '';
    const state = { info: null, team: false, polls: 0, timer: null };

    async function fetchStatus() {
        const res = await window.supabase.functions.invoke('payment', { body: { action: 'status', transaction_id: tx } });
        if (res.error) {
            let msg = '';
            try { msg = (await res.error.context?.json())?.error || ''; } catch (e) { /* réponse illisible */ }
            throw new Error(msg || 'Paiement introuvable.');
        }
        return res.data;
    }

    function render() {
        const p = state.info;
        if (!p || !p.transaction_id) {
            box().innerHTML = `<div class="dl-card"><div class="dl-status"><i class="fas fa-question-circle"></i><h3>Lien de paiement introuvable</h3>
                <p>Vérifie le lien reçu par SMS, ou appelle Ouenze.</p><a class="btn-submit" href="activities.html">Mes commandes</a></div></div>`;
            return;
        }
        const card = p.channel === 'CREDIT_CARD';
        const paid = p.status === 'accepted' || p.order_paid;
        const head = `<div class="pay-head"><span class="pay-amount">${fcfa(p.amount)}</span>
            <small>Commande ${esc(p.order_number)}${p.shop_name ? ' · ' + esc(p.shop_name) : ''}</small></div>`;
        if (paid) {
            box().innerHTML = `<div class="dl-card pay-card">${head}<div class="dl-status ok"><i class="fas fa-check-circle"></i>
                <h3>Paiement reçu, merci !</h3><p>Ta commande est payée. Tu peux noter la boutique et le livreur dans « Mes commandes ».</p>
                <a class="btn-submit" href="activities.html">Mes commandes</a></div></div>`;
            return;
        }
        const refused = p.status === 'refused';
        box().innerHTML = `<div class="dl-card pay-card">${head}
            ${refused ? '<p class="pay-alert"><i class="fas fa-times-circle"></i> Le paiement n\'a pas abouti. Tu peux réessayer.</p>' : ''}
            ${p.provider === 'simulation' ? `
                <p class="pay-alert sim"><i class="fas fa-flask"></i> <b>Mode simulation</b> : le paiement en ligne n'est pas encore branché. Aucun argent n'est demandé ici.</p>
                ${state.team ? '<button class="btn-submit big" onclick="paySimulate()"><i class="fas fa-check"></i> Simuler un paiement réussi (équipe)</button>'
                    : '<p class="pay-help">Pour l\'instant, règle directement avec le livreur ou au numéro que Ouenze t\'a donné par téléphone.</p>'}`
            : `
                <ol class="pay-steps">
                    ${card ? `<li>Appuie sur <b>Payer par carte</b>.</li><li>Entre les informations de ta carte <b>Visa</b>, <b>Mastercard</b> ou prépayée sur la page sécurisée.</li><li>Valide : c'est payé.</li>`
                        : `<li>Appuie sur <b>Payer avec Mobile Money</b>.</li><li>Choisis ton réseau (MTN, Airtel) et vérifie ton numéro.</li><li>Tu reçois une demande sur ton téléphone : <b>tape ton code secret</b>. C'est payé.</li>`}
                </ol>
                <a class="btn-submit big" href="${esc(p.payment_url)}" rel="noopener"><i class="fas ${card ? 'fa-credit-card' : 'fa-mobile-alt'}"></i> ${card ? 'Payer par carte' : 'Payer avec Mobile Money'}</a>
                <p class="pay-help"><i class="fas fa-lock"></i> Paiement sécurisé par CinetPay. Ouenze ne voit jamais ton code secret ni ta carte.</p>`}
            <p class="pay-wait" id="payWait" ${state.timer ? '' : 'hidden'}><i class="fas fa-spinner fa-spin"></i> Vérification du paiement…</p>
            <p class="pay-msg" id="payMsg" hidden></p>
        </div>`;
    }

    // Après le retour de CinetPay : on vérifie quelques fois (la confirmation peut prendre un peu de temps)
    function poll() {
        clearInterval(state.timer);
        state.polls = 0;
        state.timer = setInterval(async () => {
            state.polls += 1;
            try { state.info = await fetchStatus(); } catch (e) { /* on réessaie */ }
            if (state.info?.status === 'accepted' || state.info?.order_paid || state.polls >= 24) {
                clearInterval(state.timer);
                state.timer = null;
            }
            render();
        }, 5000);
    }

    async function paySimulate() {
        const msg = document.getElementById('payMsg');
        const res = await window.supabase.functions.invoke('payment', { body: { action: 'simulate', transaction_id: tx } });
        if (res.error) {
            let text = '';
            try { text = (await res.error.context?.json())?.error || ''; } catch (e) { /* réponse illisible */ }
            msg.hidden = false;
            msg.textContent = text || 'Simulation impossible.';
            return;
        }
        state.info = await fetchStatus();
        render();
    }

    async function init() {
        if (!window.supabase?.functions) { box().innerHTML = '<p>Service indisponible.</p>'; return; }
        if (tx.length < 12) { render(); return; }
        try { state.info = await fetchStatus(); } catch (e) { state.info = null; }
        try {
            const { data } = await window.supabase.auth.getSession();
            if (data?.session) state.team = !!(await window.supabase.rpc('is_team')).data;
        } catch (e) { /* pas connecté */ }
        render();
        if (state.info && state.info.provider === 'cinetpay' && state.info.status !== 'accepted' && !state.info.order_paid) poll();
    }

    window.paySimulate = paySimulate;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
