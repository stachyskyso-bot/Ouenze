// ============================================================
// INVEST-COMMON.JS — outils partagés par Investir, Mes activités et Mon portefeuille
// Chargé après app.js et Chart.js, avant le script de la page.
// ============================================================

window.OuenzeInvest = (function () {
    'use strict';

    const SHARES_PER_COMPANY = 10000;   // une boutique = 10 000 parts (voir migration 20261014)
    const MIGRATION_FILE = 'supabase/migrations/20261014_stock_market.sql';

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function fcfa(n, signed) {
        const v = Math.round(Number(n) || 0);
        return (signed && v > 0 ? '+' : '') + v.toLocaleString('fr-FR') + ' FCFA';
    }

    function num(n) {
        return Math.round(Number(n) || 0).toLocaleString('fr-FR');
    }

    function pct(part, total, digits = 1) {
        if (!total) return '0 %';
        return (part / total * 100).toLocaleString('fr-FR', { maximumFractionDigits: digits }) + ' %';
    }

    function frDate(iso) {
        if (!iso) return '';
        return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function monthLabel(key) {
        const s = new Date(key + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function stars(rating) {
        const r = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
        return '★'.repeat(r) + '☆'.repeat(5 - r);
    }

    function safeImg(url) {
        const u = String(url || '');
        return /^(https:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(u) ? u : '';
    }

    function logoHtml(name, url) {
        const img = safeImg(url);
        return `<span class="inv-logo">${img ? `<img src="${esc(img)}" alt="">` : esc(String(name || '?').charAt(0).toUpperCase())}</span>`;
    }

    // Une fonction ou une table manquante = la migration n'a pas encore été exécutée
    function isMissing(error) {
        return !!error && /42P01|42883|PGRST20[0-9]|does not exist|Could not find/i.test(`${error.code} ${error.message}`);
    }

    function migrationWarning() {
        return `<div class="inv-warning"><i class="fas fa-database"></i> La bourse n'est pas encore activée dans la base de données : exécute <code>${MIGRATION_FILE}</code> dans Supabase → SQL Editor.</div>`;
    }

    function loginBox(title) {
        window.supabase?.auth?.onAuthStateChange?.(e => { if (e === 'SIGNED_IN') location.reload(); });
        return `<div class="inv-empty"><i class="fas fa-user-lock"></i><h3>${esc(title)}</h3>
            <p>Connecte-toi ou crée un compte gratuit.</p>
            <button class="btn-submit" onclick="openLoginModal()">Se connecter</button></div>`;
    }

    async function currentUser() {
        const { data } = await window.supabase.auth.getSession();
        return data?.session?.user || null;
    }

    const charts = {};
    // Couleurs des graphiques adaptées au fond bleu nuit des pages investissement
    function darkChartDefaults() {
        if (!window.Chart || darkChartDefaults.done) return;
        darkChartDefaults.done = true;
        Chart.defaults.color = '#8da2c0';
        Chart.defaults.borderColor = 'rgba(141, 162, 192, 0.14)';
        Chart.defaults.font.family = "'Inter', sans-serif";
        Chart.defaults.plugins.tooltip.backgroundColor = '#0b1628';
        Chart.defaults.plugins.tooltip.borderColor = '#1f3050';
        Chart.defaults.plugins.tooltip.borderWidth = 1;
        Chart.defaults.elements.arc.borderColor = '#0f1b31';
    }

    function chart(id, config) {
        charts[id]?.destroy();
        const el = document.getElementById(id);
        if (!el) return null;
        if (!window.Chart) {
            el.parentElement.innerHTML = '<p class="inv-none">Graphique indisponible (pas de connexion).</p>';
            return null;
        }
        if (document.body.classList.contains('invest-body')) darkChartDefaults();
        charts[id] = new Chart(el, config);
        return charts[id];
    }

    const money = v => Math.round(v).toLocaleString('fr-FR') + ' FCFA';
    const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9', '#f97316', '#14b8a6', '#64748b', '#eab308'];

    return { SHARES_PER_COMPANY, esc, fcfa, num, pct, frDate, monthLabel, stars, logoHtml, isMissing, migrationWarning, loginBox, currentUser, chart, money, PALETTE };
})();
