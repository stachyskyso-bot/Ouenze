// ============================================================
// DELETION-GUARD.JS — suppression par Ouenze : 72 heures pour se justifier
//
// Compte supprimé par un admin → écran bloquant : motif, heure limite, compte à rebours,
// formulaire de justification, déconnexion.
// Boutique supprimée par un admin → bandeau en haut de page avec « Me justifier ».
// Données : RPC my_deletion_status, account_appeal, shop_appeal (migration 20261107).
// Chargé sur toutes les pages après supabase-config.js. Sans session : ne fait rien.
// ============================================================

(function () {
    'use strict';

    const CACHE_KEY = 'ouenze_del_check';
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const dateTime = iso => new Date(iso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    function timeLeft(iso) {
        const ms = new Date(iso) - Date.now();
        if (!(ms > 0)) return null;
        const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
        return h >= 24 ? `${Math.floor(h / 24)} jour${h >= 48 ? 's' : ''} et ${h % 24} h` : h ? `${h} h ${m} min` : `${m} min`;
    }

    function addStyles() {
        if (document.getElementById('delGuardCss')) return;
        const css = document.createElement('style');
        css.id = 'delGuardCss';
        css.textContent = `
.dg-overlay { position: fixed; inset: 0; z-index: 5000; background: rgba(15, 23, 42, .75); display: flex; align-items: center; justify-content: center; padding: 16px; overflow-y: auto; }
.dg-card { width: 100%; max-width: 480px; background: #fff; border-radius: 20px; padding: 24px 20px; box-shadow: 0 20px 50px rgba(0, 0, 0, .35); font-family: inherit; color: #0f172a; }
.dg-card h2 { font-size: 20px; margin: 6px 0 8px; }
.dg-ico { width: 54px; height: 54px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #fee2e2; color: #b91c1c; font-size: 24px; }
.dg-reason { background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 10px 12px; font-size: 14px; margin: 10px 0; }
.dg-time { display: flex; gap: 10px; align-items: center; background: #fff7e6; border: 1px solid #fde68a; border-radius: 12px; padding: 10px 12px; font-size: 14px; margin-bottom: 12px; }
.dg-time b { color: #b45309; }
.dg-card p { font-size: 14px; line-height: 1.55; color: #334155; margin: 6px 0; }
.dg-card textarea { width: 100%; min-height: 120px; border: 2px solid #e2e8f0; border-radius: 12px; padding: 10px 12px; font: inherit; font-size: 14px; resize: vertical; box-sizing: border-box; }
.dg-card textarea:focus { outline: none; border-color: #1e40af; }
.dg-btn { width: 100%; margin-top: 10px; padding: 13px; border: none; border-radius: 12px; background: #1e40af; color: #fff; font: inherit; font-weight: 700; font-size: 15px; cursor: pointer; }
.dg-btn:disabled { opacity: .6; cursor: default; }
.dg-link { display: block; width: 100%; margin-top: 8px; padding: 10px; border: none; background: none; color: #64748b; font: inherit; font-size: 14px; cursor: pointer; text-decoration: underline; }
.dg-msg { font-size: 13px; margin-top: 8px; }
.dg-msg.ok { color: #15803d; }
.dg-msg.err { color: #b91c1c; }
.dg-sent { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 10px 12px; font-size: 13px; color: #166534; margin-bottom: 8px; }
.dg-banner { position: relative; z-index: 1500; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding: 12px 16px; background: #fef2f2; border-bottom: 2px solid #fca5a5; color: #7f1d1d; font-size: 14px; }
.dg-banner b { color: #991b1b; }
.dg-banner span { flex: 1; min-width: 220px; }
.dg-banner button { border: none; border-radius: 10px; padding: 9px 14px; background: #b91c1c; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
.dg-banner button.dg-x { background: none; color: #7f1d1d; padding: 6px; font-size: 18px; line-height: 1; }`;
        document.head.appendChild(css);
    }

    // ---------- Formulaire commun ----------
    function formHtml(item, kind) {
        const left = timeLeft(item.due_at);
        return `
            ${item.reason ? `<div class="dg-reason"><b>Motif :</b> ${esc(item.reason)}</div>` : ''}
            ${left ? `<div class="dg-time"><span>⏳</span><span>Il te reste <b>${left}</b> pour te justifier, jusqu'au <b>${dateTime(item.due_at)}</b>.</span></div>
                ${item.appeal ? `<div class="dg-sent">✔ Justification envoyée le ${dateTime(item.appeal_at)}. Ouenze va la lire. Tu peux la compléter jusqu'à l'heure limite.</div>` : ''}
                <p>Explique à Ouenze pourquoi ${kind === 'shop' ? 'ta boutique' : 'ton compte'} devrait être rétabli${kind === 'shop' ? 'e' : ''}. Passé ce délai, tout sera effacé automatiquement.</p>
                <textarea id="dgText" maxlength="2000" placeholder="Ta justification…">${esc(item.appeal || '')}</textarea>
                <button class="dg-btn" id="dgSend">${item.appeal ? 'Mettre à jour ma justification' : 'Envoyer ma justification'}</button>
                <p class="dg-msg" id="dgMsg"></p>`
            : `<div class="dg-time"><span>⌛</span><span>Le délai de 72 heures est dépassé. ${kind === 'shop' ? 'La boutique' : 'Le compte'} va être effacé${kind === 'shop' ? 'e' : ''}.</span></div>`}`;
    }

    function bindSend(onSend) {
        const btn = document.getElementById('dgSend');
        if (!btn) return;
        btn.onclick = async () => {
            const text = (document.getElementById('dgText')?.value || '').trim();
            const msg = document.getElementById('dgMsg');
            if (text.length < 10) { msg.className = 'dg-msg err'; msg.textContent = 'Écris quelques phrases pour expliquer ta situation.'; return; }
            btn.disabled = true;
            btn.textContent = 'Envoi…';
            const { error } = await onSend(text);
            btn.disabled = false;
            btn.textContent = 'Mettre à jour ma justification';
            msg.className = 'dg-msg ' + (error ? 'err' : 'ok');
            msg.textContent = error ? error.message : 'Justification envoyée. Ouenze va la lire et te répondre.';
            try { sessionStorage.removeItem(CACHE_KEY); } catch (e) { /* stockage bloqué */ }
        };
    }

    async function logout() {
        try { await window.supabase.auth.signOut(); } catch (e) { /* déjà déconnecté */ }
        try { sessionStorage.removeItem(CACHE_KEY); } catch (e) { /* stockage bloqué */ }
        window.location.href = 'index.html';
    }

    // ---------- Compte supprimé : écran bloquant ----------
    function showAccount(acc) {
        addStyles();
        document.getElementById('dgOverlay')?.remove();
        const el = document.createElement('div');
        el.className = 'dg-overlay';
        el.id = 'dgOverlay';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.innerHTML = `<div class="dg-card">
            <div class="dg-ico">!</div>
            ${acc.purged
                ? `<h2>Ton compte a été effacé</h2><p>Ce compte n'existe plus sur Ouenze.</p>`
                : `<h2>Ton compte a été supprimé par Ouenze</h2>${formHtml(acc, 'account')}`}
            <button class="dg-link" id="dgLogout">Se déconnecter</button>
        </div>`;
        document.body.appendChild(el);
        document.body.style.overflow = 'hidden';
        document.getElementById('dgLogout').onclick = logout;
        bindSend(text => window.supabase.rpc('account_appeal', { message: text }));
        if (acc.purged) setTimeout(logout, 4000);
    }

    // ---------- Boutique supprimée : bandeau + formulaire ----------
    function showShops(shops) {
        addStyles();
        let dismissed = [];
        try { dismissed = JSON.parse(sessionStorage.getItem('ouenze_del_banner') || '[]'); } catch (e) { /* rien */ }
        const visible = shops.filter(s => !dismissed.includes(s.id));
        document.querySelectorAll('.dg-banner').forEach(b => b.remove());
        visible.forEach(s => {
            const left = timeLeft(s.due_at);
            const bar = document.createElement('div');
            bar.className = 'dg-banner';
            bar.innerHTML = `<span>Ta boutique <b>${esc(s.name)}</b> a été supprimée par Ouenze.
                ${left ? (s.appeal ? ` Justification envoyée, en cours de lecture (encore ${left}).` : ` Il te reste <b>${left}</b> pour te justifier.`) : ' Le délai de 72 heures est dépassé.'}</span>
                ${left ? `<button type="button">${s.appeal ? 'Voir ma justification' : 'Me justifier'}</button>` : ''}
                <button type="button" class="dg-x" aria-label="Masquer">×</button>`;
            if (left) bar.querySelector('button:not(.dg-x)').onclick = () => openShop(s);
            bar.querySelector('.dg-x').onclick = () => {
                bar.remove();
                try { sessionStorage.setItem('ouenze_del_banner', JSON.stringify([...dismissed, s.id])); } catch (e) { /* rien */ }
            };
            document.body.prepend(bar);
        });
    }

    function openShop(s) {
        document.getElementById('dgOverlay')?.remove();
        const el = document.createElement('div');
        el.className = 'dg-overlay';
        el.id = 'dgOverlay';
        el.innerHTML = `<div class="dg-card">
            <div class="dg-ico">!</div>
            <h2>Boutique ${esc(s.name)} supprimée</h2>
            ${formHtml(s, 'shop')}
            <button class="dg-link" id="dgClose">Fermer</button>
        </div>`;
        document.body.appendChild(el);
        el.addEventListener('click', e => { if (e.target === el) el.remove(); });
        document.getElementById('dgClose').onclick = () => el.remove();
        bindSend(async text => {
            const res = await window.supabase.rpc('shop_appeal', { target: s.id, message: text });
            if (!res.error) { s.appeal = text; s.appeal_at = new Date().toISOString(); showShops(lastShops); }
            return res;
        });
    }

    let lastShops = [];
    async function check() {
        if (!window.supabase?.auth || !window.supabase.rpc) return;
        let session = null;
        try { session = (await window.supabase.auth.getSession()).data?.session; } catch (e) { return; }
        if (!session) return;
        // Rien en cours lors de la dernière vérification (moins de 5 minutes) : pas de requête
        try {
            const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
            if (c && c.user === session.user.id && c.clear && Date.now() - c.at < 300000) return;
        } catch (e) { /* rien */ }
        const { data, error } = await window.supabase.rpc('my_deletion_status');
        if (error || !data) return;   // migration 20261107 pas encore exécutée
        const clear = !data.account && !(data.shops || []).length;
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ user: session.user.id, clear, at: Date.now() })); } catch (e) { /* rien */ }
        if (data.account) { showAccount(data.account); return; }
        lastShops = data.shops || [];
        if (lastShops.length) showShops(lastShops);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(check, 300));
    else setTimeout(check, 300);
})();
