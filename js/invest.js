// ============================================================
// INVEST.JS — Le marché : boutiques entrées en bourse et réservation de parts
//
// Données : market_offerings() (public) et reserve_shares() (connecté).
// Une boutique = 10 000 parts ; le vendeur en met 1 à 49 % en vente après
// vérification par Ouenze. Les parts réservées deviennent les tiennes une fois
// le paiement confirmé (paiement Mobile Money en ligne : bientôt).
// ============================================================

(function () {
    'use strict';

    const I = window.OuenzeInvest;
    const { esc, fcfa, num, pct, stars, logoHtml } = I;
    const state = { user: null, offers: [], missing: false, search: '', sort: 'valuation' };
    const box = () => document.getElementById('investContainer');

    function soldPart(o) {
        return o.total_shares - o.remaining_shares;
    }

    function sorted(list) {
        const q = state.search.trim().toLowerCase();
        const by = {
            valuation: (a, b) => b.valuation - a.valuation,
            price: (a, b) => a.price_per_share - b.price_per_share,
            rating: (a, b) => b.rating - a.rating,
            remaining: (a, b) => b.remaining_shares / b.total_shares - a.remaining_shares / a.total_shares
        }[state.sort];
        return list.filter(o => !q || `${o.shop_name} ${o.shop_city || ''}`.toLowerCase().includes(q)).sort(by);
    }

    function render() {
        const list = sorted(state.offers);
        box().innerHTML = `
            ${state.missing ? I.migrationWarning() : ''}
            <section class="inv-hero">
                <h2>Investis dans les boutiques du Congo</h2>
                <p>Achète des parts de boutiques sérieuses, vérifiées sur place par l'équipe Ouenze, et deviens copropriétaire de leur réussite.</p>
                <div class="inv-steps">
                    <div><b>1</b>Choisis une boutique : note ≥ 3,5 ★ et au moins 75 commandes livrées.</div>
                    <div><b>2</b>Réserve tes parts. Une boutique = ${num(I.SHARES_PER_COMPANY)} parts ; le vendeur en garde au moins 51 %.</div>
                    <div><b>3</b>Paie par Mobile Money : les parts apparaissent dans ton portefeuille.</div>
                </div>
            </section>
            ${state.offers.length ? tickerHtml() : ''}
            <p class="inv-risk"><i class="fas fa-exclamation-triangle"></i> Investir comporte un risque de perte en capital. Les parts ne sont pas cotées sur un marché réglementé et peuvent être difficiles à revendre. N'investis que l'argent dont tu n'as pas besoin.</p>
            ${state.offers.length ? `
                <div class="inv-toolbar">
                    <input type="search" id="invSearch" placeholder="Rechercher une boutique ou une ville" value="${esc(state.search)}" oninput="invSearch(this.value)" aria-label="Rechercher">
                    <select onchange="invSort(this.value)" aria-label="Trier">
                        <option value="valuation" ${state.sort === 'valuation' ? 'selected' : ''}>Valorisation la plus haute</option>
                        <option value="price" ${state.sort === 'price' ? 'selected' : ''}>Prix de la part le plus bas</option>
                        <option value="rating" ${state.sort === 'rating' ? 'selected' : ''}>Meilleure note</option>
                        <option value="remaining" ${state.sort === 'remaining' ? 'selected' : ''}>Le plus de parts disponibles</option>
                    </select>
                </div>
                <div class="inv-grid">${list.length ? list.map(cardHtml).join('') : '<p class="inv-none">Aucune boutique ne correspond à ta recherche.</p>'}</div>`
            : `<div class="inv-empty"><i class="fas fa-seedling"></i>
                <h3>Aucune boutique en bourse pour l'instant</h3>
                <p>Les premières boutiques arrivent dès qu'elles remplissent les conditions et sont vérifiées par Ouenze.</p>
                <p><strong>Tu es vendeur ?</strong> Avec 3,5 ★ et 75 commandes livrées, demande l'entrée en bourse depuis ton espace boutique.</p>
                <a class="btn-submit" href="vendor-dashboard.html">Mon espace boutique</a></div>`}`;
    }

    // Indices du marché, calculés sur les offres ouvertes (aucun chiffre inventé)
    function tickerHtml() {
        const offers = state.offers;
        const cap = offers.reduce((s, o) => s + o.valuation, 0);
        const available = offers.reduce((s, o) => s + o.remaining_shares * o.price_per_share, 0);
        const avgRating = offers.reduce((s, o) => s + o.rating, 0) / offers.length;
        return `<div class="inv-ticker">
            <div><span>Boutiques cotées</span><strong>${num(offers.length)}</strong></div>
            <div><span>Capitalisation</span><strong>${fcfa(cap)}</strong></div>
            <div><span>Parts disponibles</span><strong>${fcfa(available)}</strong></div>
            <div><span>Note moyenne</span><strong>${avgRating.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ★</strong></div>
        </div>`;
    }

    function cardHtml(o) {
        const sold = soldPart(o);
        return `
            <button class="inv-card" onclick="invOpen('${esc(o.offering_id)}')">
                <div class="inv-card-head">
                    ${logoHtml(o.shop_name, o.shop_logo)}
                    <div><strong>${esc(o.shop_name)}</strong>
                    <small><span class="inv-stars">${stars(o.rating)}</span> ${Number(o.rating).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} · ${num(o.delivered_orders)} commandes livrées${o.shop_city ? ' · ' + esc(o.shop_city) : ''}</small></div>
                </div>
                <div class="inv-figures">
                    <div><span>Prix d'une part</span><strong>${fcfa(o.price_per_share)}</strong></div>
                    <div><span>Valorisation</span><strong>${fcfa(o.valuation)}</strong></div>
                </div>
                <div class="inv-progress"><div style="width:${Math.min(100, sold / o.total_shares * 100)}%"></div></div>
                <div class="inv-progress-label"><span>${pct(sold, o.total_shares, 0)} réservé</span><span>${num(o.remaining_shares)} parts dispo. sur ${num(o.total_shares)} (${Number(o.percent_offered).toLocaleString('fr-FR')} % du capital)</span></div>
            </button>`;
    }

    function invOpen(id) {
        const o = state.offers.find(x => x.offering_id === id);
        if (!o) return;
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-card">
                <button class="modal-close" onclick="this.closest('.modal').remove()" aria-label="Fermer">&times;</button>
                <div class="inv-card-head">${logoHtml(o.shop_name, o.shop_logo)}
                    <div><strong>${esc(o.shop_name)}</strong><small><span class="inv-stars">${stars(o.rating)}</span> ${o.total_ratings} avis · ${num(o.delivered_orders)} commandes livrées</small></div></div>
                ${o.pitch ? `<p class="inv-pitch"><i class="fas fa-quote-left"></i> ${esc(o.pitch)}</p>` : ''}
                <div class="inv-detail-figures">
                    <div><span>Prix d'une part</span><strong>${fcfa(o.price_per_share)}</strong></div>
                    <div><span>Valorisation de la boutique</span><strong>${fcfa(o.valuation)}</strong></div>
                    <div><span>Part du capital en vente</span><strong>${Number(o.percent_offered).toLocaleString('fr-FR')} %</strong></div>
                    <div><span>Parts encore disponibles</span><strong>${num(o.remaining_shares)}</strong></div>
                    <div><span>Investisseurs</span><strong>${num(o.investors)}</strong></div>
                    <div><span>Vérifiée par Ouenze</span><strong>${o.opened_at ? I.frDate(o.opened_at) : 'Oui'}</strong></div>
                </div>
                <div id="invReserve">${reserveFormHtml(o)}</div>
            </div>`;
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);
        invCalc();
    }

    function reserveFormHtml(o) {
        if (!o.remaining_shares) return '<p class="inv-none">Toutes les parts sont réservées.</p>';
        if (!state.user) {
            return `<p class="inv-none">Connecte-toi pour réserver des parts.</p>
                <button class="btn-submit" onclick="this.closest('.modal').remove();openLoginModal()">Se connecter</button>`;
        }
        const max = o.remaining_shares;
        return `
            <div class="form-group"><label for="invQty">Nombre de parts</label>
                <div class="inv-qty">
                    <input type="number" id="invQty" inputmode="numeric" min="1" max="${max}" step="1" value="${Math.min(10, max)}" oninput="invCalc()">
                    <button type="button" onclick="invSetQty(${Math.min(100, max)})">${num(Math.min(100, max))}</button>
                    <button type="button" onclick="invSetQty(${max})">Max</button>
                </div></div>
            <div class="inv-calc" id="invCalc" data-price="${o.price_per_share}" data-max="${max}"></div>
            <div class="form-error" id="invError" role="alert"></div>
            <button class="btn-submit" id="invSubmit" onclick="invReserve('${esc(o.offering_id)}')"><i class="fas fa-handshake"></i> Réserver ces parts</button>
            <p class="auth-note">Réservation sans paiement immédiat. Les parts sont à toi une fois le paiement Mobile Money confirmé. Tu peux annuler tant que tu n'as pas payé.</p>`;
    }

    function invSetQty(n) {
        const input = document.getElementById('invQty');
        if (input) { input.value = n; invCalc(); }
    }

    function invCalc() {
        const el = document.getElementById('invCalc');
        const qty = Math.floor(Number(document.getElementById('invQty')?.value) || 0);
        if (!el) return;
        const price = Number(el.dataset.price);
        el.innerHTML = `Montant : <strong>${fcfa(qty * price)}</strong><br>
            Tu détiendrais <strong>${pct(qty, I.SHARES_PER_COMPANY, 2)}</strong> de la boutique (${num(qty)} part${qty > 1 ? 's' : ''} sur ${num(I.SHARES_PER_COMPANY)}).`;
    }

    async function invReserve(id) {
        const qty = Math.floor(Number(document.getElementById('invQty')?.value) || 0);
        const max = Number(document.getElementById('invCalc')?.dataset.max) || 0;
        const err = m => { const e = document.getElementById('invError'); e.textContent = m; e.style.display = m ? 'block' : 'none'; };
        if (qty < 1) return err('Indique au moins 1 part.');
        if (qty > max) return err(`Il ne reste que ${num(max)} parts.`);
        const btn = document.getElementById('invSubmit');
        btn.disabled = true;
        btn.textContent = 'Réservation…';
        const { error } = await window.supabase.rpc('reserve_shares', { offering: id, qty });
        if (error) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-handshake"></i> Réserver ces parts';
            return err(error.message || 'Réservation impossible, réessaie.');
        }
        const o = state.offers.find(x => x.offering_id === id);
        document.getElementById('invReserve').innerHTML = `
            <div class="inv-success"><i class="fas fa-check-circle"></i>
                <p><strong>${num(qty)} parts de ${esc(o?.shop_name || '')} réservées</strong> pour ${fcfa(qty * (o?.price_per_share || 0))}.<br>
                Le paiement Mobile Money en ligne arrive bientôt : en attendant, l'équipe Ouenze te contacte pour le règlement. Les parts passent dans ton portefeuille dès que le paiement est confirmé.</p>
                <a class="btn-submit" href="portfolio.html">Voir mon portefeuille</a></div>`;
        await load();
        render();
    }

    function invSearch(v) {
        state.search = v;
        const grid = document.querySelector('.inv-grid');
        if (grid) {
            const list = sorted(state.offers);
            grid.innerHTML = list.length ? list.map(cardHtml).join('') : '<p class="inv-none">Aucune boutique ne correspond à ta recherche.</p>';
        }
    }

    function invSort(v) {
        state.sort = v;
        render();
    }

    async function load() {
        const { data, error } = await window.supabase.rpc('market_offerings');
        state.missing = I.isMissing(error);
        if (error && !state.missing) console.error('❌ Marché :', error);
        state.offers = (data || []).map(o => ({
            ...o,
            rating: Number(o.rating) || 0,
            total_shares: Number(o.total_shares) || 0,
            remaining_shares: Math.max(0, Number(o.remaining_shares) || 0),
            price_per_share: Number(o.price_per_share) || 0,
            valuation: Number(o.valuation) || 0
        }));
    }

    async function init() {
        if (!window.supabase?.rpc) {
            box().innerHTML = '<div class="inv-empty"><p>Service indisponible. Recharge la page.</p></div>';
            return;
        }
        state.user = await I.currentUser();
        await load();
        render();
        const id = new URLSearchParams(location.search).get('offre');
        if (id) invOpen(id);
    }

    Object.assign(window, { invOpen, invCalc, invSetQty, invReserve, invSearch, invSort });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
