// ============================================================
// TRADE.JS — Ouenze Trade, en SIMULATION (trade.html) : proposer une opération (vendeur),
// déclarer dépenses et ventes, outils de l'équipe. La vitrine des participants est invest.html.
//
// Une opération commerciale précise de 45 jours, financée par des participants et par
// l'apport du vendeur. Les fournisseurs sont payés directement par Ouenze ; les autres
// dépenses et les ventes sont déclarées avec justificatif puis validées par l'équipe.
// Migration 20261031_trade_simulation.sql.
//
// Volontairement absent (règles à valider avec le juriste et le prestataire de paiement) :
// partage des gains, ordre des pertes, fonds de garantie, garde des fonds, retrait du solde.
// ============================================================

(function () {
    'use strict';

    const STATUS = {
        submitted: ['En vérification', 'wait'], rejected: ['Refusée', 'ko'], collecting: ['Collecte ouverte', 'info'],
        running: ['En cours', 'info'], closed: ['Terminée', 'ok'], failed: ['En échec', 'ko'], cancelled: ['Annulée', 'ko']
    };
    const KIND = {
        vendor_contribution: ['Apport du vendeur', 'fa-hand-holding-usd'], supplier_payment: ['Fournisseur payé par Ouenze', 'fa-truck'],
        expense: ['Dépense', 'fa-receipt'], sale: ['Vente', 'fa-cash-register'], note: ['Note', 'fa-info-circle']
    };
    const ENTRY = { pending: ['À vérifier', 'wait'], validated: ['Validée', 'ok'], rejected: ['Refusée', 'ko'] };
    const state = { user: null, role: null, shops: [], tab: 'open', list: [], detail: null, lines: [] };

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = v => Number(v) || 0;
    const fcfa = n => `${Math.round(num(n)).toLocaleString('fr-FR')} FCFA`;
    const day = d => d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '';
    const daysLeft = d => Math.max(0, Math.ceil((new Date(d) - Date.now()) / 86400000));
    const box = () => document.getElementById('tradeApp');
    const rpc = (name, args) => window.supabase.rpc(name, args || {});
    const pct = (a, b) => b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0;
    const badge = ([label, tone]) => `<span class="tr-badge ${tone}">${esc(label)}</span>`;

    function message(html) { box().innerHTML = `<div class="dl-card"><div class="dl-status">${html}</div></div>`; }

    function errorText(error) {
        const msg = error?.message || '';
        return /trade_|schema cache|does not exist/i.test(msg) && /function|relation|schema/i.test(msg)
            ? 'Trade n\'est pas encore installé (migration 20261031 à exécuter).' : msg || 'Erreur inattendue.';
    }

    // Fenêtre dans la page (pas de prompt/confirm : bloqués dans certaines applis)
    function ask({ title, text, field, placeholder, ok, danger, optional }) {
        return new Promise(resolve => {
            const ov = document.createElement('div');
            ov.className = 'tm-dialog';
            ov.innerHTML = `<div class="tm-dialog-card" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
                ${field ? `<input id="trAsk" maxlength="300" placeholder="${esc(placeholder || '')}">` : ''}
                <p class="tm-dialog-err" id="trAskErr"></p>
                <div class="tm-dialog-actions"><button class="btn-cancel" data-v="0">Retour</button>
                <button class="btn-submit ${danger ? 'tm-danger' : ''}" data-v="1">${esc(ok || 'OK')}</button></div></div>`;
            const done = v => { ov.remove(); resolve(v); };
            ov.addEventListener('click', e => {
                const b = e.target.closest('button[data-v]');
                if (e.target === ov || (b && b.dataset.v === '0')) return done(null);
                if (!b) return;
                const val = field ? ov.querySelector('#trAsk').value.trim() : true;
                if (field && !optional && val.length < 2) { ov.querySelector('#trAskErr').textContent = 'Ce champ est obligatoire.'; return; }
                done(field ? val : true);
            });
            document.body.appendChild(ov);
            ov.querySelector('#trAsk')?.focus();
        });
    }

    function say(id, text, ok) {
        const el = document.getElementById(id);
        if (!el) return;
        el.hidden = false;
        el.className = 'tm-msg ' + (ok ? 'ok' : 'err');
        el.textContent = text;
    }

    // ============ LISTES ============
    function tabs() {
        const list = [['open', 'Opérations'], ['invested', 'Mes participations']];
        if (state.shops.length) list.push(['mine', 'Mes opérations'], ['new', 'Proposer']);
        if (state.role) list.push(['review', 'Équipe']);
        return `<div class="adm-tabs tr-tabs">${list.map(([k, l]) => `<button class="adm-tab ${state.tab === k ? 'active' : ''}" onclick="trTab('${k}')">${l}</button>`).join('')}</div>`;
    }

    function opCard(o) {
        const f = o.figures || {};
        const st = STATUS[o.status] || [o.status, 'info'];
        const when = o.status === 'collecting' && o.collect_ends_at ? `Collecte : encore ${daysLeft(o.collect_ends_at)} j`
            : o.status === 'running' && o.ends_at ? `Fin dans ${daysLeft(o.ends_at)} j (${day(o.ends_at)})`
            : o.status === 'submitted' ? 'En attente de vérification Ouenze' : `${o.duration_days} jours`;
        return `<button class="dl-card tr-card" onclick="trOpen('${esc(o.id)}')">
            <div class="tr-card-head"><strong>${esc(o.title)}</strong>${badge(st)}</div>
            <small class="tr-shop"><i class="fas fa-store"></i> ${esc(o.shop_name)} · ${esc(when)}</small>
            <div class="tr-bar"><i style="width:${pct(num(f.pledged), num(o.goal_amount))}%"></i></div>
            <div class="tr-card-nums">
                <span><b>${fcfa(f.pledged)}</b> sur ${fcfa(o.goal_amount)}</span>
                <span>Apport vendeur <b>${fcfa(o.vendor_contribution)}</b></span>
            </div>
            ${o.my_pledge ? `<span class="tr-mine">Ta participation : ${fcfa(o.my_pledge)}</span>` : ''}
        </button>`;
    }

    function listHtml() {
        const empty = {
            open: 'Aucune opération ouverte pour l\'instant.',
            invested: 'Tu ne participes à aucune opération.',
            mine: 'Tu n\'as encore proposé aucune opération.',
            review: 'Aucune opération.'
        }[state.tab];
        return state.list.length ? state.list.map(opCard).join('') : `<div class="dl-card tr-empty">${empty}</div>`;
    }

    async function loadList() {
        const { data, error } = await rpc('trade_list', { scope: state.tab });
        if (error) { message(`<p>${esc(errorText(error))}</p>`); return false; }
        state.list = data || [];
        return true;
    }

    // ============ PROPOSER (vendeur) ============
    function newHtml() {
        if (!state.lines.length) state.lines = [{ supplier_name: '', supplier_phone: '', item: '', amount: '', quote_ref: '' }];
        return `<div class="dl-card tr-form">
            <h3>Proposer une opération</h3>
            <p class="tr-help">Une opération précise de <b>45 jours</b> : ce que tu achètes, chez qui, combien, et à combien tu revends.
                Tu apportes une partie des fonds. <b>Ouenze paie directement tes fournisseurs</b> : tu ne reçois pas l'argent des achats.</p>
            <label>Boutique<select id="trShop">${state.shops.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label>
            <label>Titre de l'opération<input id="trTitle" maxlength="120" placeholder="Ex : 100 pagnes wax pour les fêtes"></label>
            <label>Description<textarea id="trDesc" rows="3" maxlength="2000" placeholder="Où tu achètes, comment tu revends, pourquoi ça marche"></textarea></label>
            <h4>Achats chez les fournisseurs</h4>
            <div id="trLines">${state.lines.map(lineHtml).join('')}</div>
            <button type="button" class="btn-cancel" onclick="trAddLine()"><i class="fas fa-plus"></i> Ajouter un achat</button>
            <div class="tr-grid">
                <label>Ton apport (FCFA)<input id="trContrib" type="number" min="1" inputmode="numeric" oninput="trBudget()"></label>
                <label>Financement demandé (FCFA)<input id="trGoal" type="number" min="1" inputmode="numeric" oninput="trBudget()"></label>
                <label>Ventes prévues (FCFA)<input id="trRevenue" type="number" min="0" inputmode="numeric" oninput="trBudget()"></label>
            </div>
            <p class="tr-budget" id="trBudget"></p>
            <p class="tm-msg" id="trNewMsg" hidden></p>
            <button class="btn-submit" id="trSubmit" onclick="trSubmit()"><i class="fas fa-paper-plane"></i> Envoyer à Ouenze pour vérification</button>
        </div>`;
    }

    function lineHtml(l, i) {
        return `<div class="tr-line">
            <input placeholder="Fournisseur" value="${esc(l.supplier_name)}" oninput="trLine(${i}, 'supplier_name', this.value)">
            <input placeholder="Téléphone" value="${esc(l.supplier_phone)}" inputmode="tel" oninput="trLine(${i}, 'supplier_phone', this.value)">
            <input placeholder="Article et quantité" value="${esc(l.item)}" oninput="trLine(${i}, 'item', this.value)">
            <input placeholder="Montant" type="number" min="1" value="${esc(l.amount)}" inputmode="numeric" oninput="trLine(${i}, 'amount', this.value);trBudget()">
            <input placeholder="N° devis (facultatif)" value="${esc(l.quote_ref)}" oninput="trLine(${i}, 'quote_ref', this.value)">
            ${state.lines.length > 1 ? `<button type="button" class="tr-line-del" onclick="trDelLine(${i})" aria-label="Retirer"><i class="fas fa-times"></i></button>` : ''}
        </div>`;
    }

    function trLine(i, k, v) { if (state.lines[i]) state.lines[i][k] = v; }
    function trAddLine() { state.lines.push({ supplier_name: '', supplier_phone: '', item: '', amount: '', quote_ref: '' }); document.getElementById('trLines').innerHTML = state.lines.map(lineHtml).join(''); }
    function trDelLine(i) { state.lines.splice(i, 1); document.getElementById('trLines').innerHTML = state.lines.map(lineHtml).join(''); trBudget(); }

    function trBudget() {
        const v = id => num(document.getElementById(id)?.value);
        const purchases = state.lines.reduce((s, l) => s + num(l.amount), 0);
        const budget = v('trContrib') + v('trGoal');
        const share = budget > 0 ? Math.round((v('trContrib') / budget) * 100) : 0;
        const el = document.getElementById('trBudget');
        if (!el) return;
        el.innerHTML = `Achats prévus <b>${fcfa(purchases)}</b> · budget (apport + financement) <b>${fcfa(budget)}</b>
            ${budget ? ` · ton apport = <b>${share} %</b> du budget` : ''}
            ${purchases > budget ? '<br><span class="tr-warn">Les achats dépassent le budget.</span>' : ''}
            ${v('trRevenue') && budget ? `<br>Résultat estimé si tout se vend : <b>${fcfa(v('trRevenue') - purchases)}</b> (estimation, non garantie)` : ''}`;
    }

    async function trSubmit() {
        const v = id => (document.getElementById(id)?.value || '').trim();
        const payload = {
            shop_id: v('trShop'), title: v('trTitle'), description: v('trDesc'),
            goal_amount: num(v('trGoal')), vendor_contribution: num(v('trContrib')), expected_revenue: num(v('trRevenue')),
            suppliers: state.lines.filter(l => l.supplier_name || l.item || l.amount).map(l => ({ ...l, amount: num(l.amount) }))
        };
        const btn = document.getElementById('trSubmit');
        btn.disabled = true;
        const { data, error } = await rpc('trade_submit', { payload });
        btn.disabled = false;
        if (error) return say('trNewMsg', errorText(error), false);
        state.lines = [];
        trOpen(data);
    }

    // ============ DÉTAIL ============
    function figuresHtml(o, f) {
        const capital = num(f.pledged) + num(f.vendor_in);
        const available = capital - num(f.suppliers_paid) - num(f.expenses);
        const result = num(f.sales) - num(f.suppliers_paid) - num(f.expenses);
        if (o.status === 'submitted' || o.status === 'collecting' || o.status === 'rejected' || o.status === 'cancelled') {
            return `<div class="tr-kpis">
                <div><span>Financement</span><b>${fcfa(f.pledged)}</b><small>sur ${fcfa(o.goal_amount)} · ${f.investors || 0} participant(s)</small></div>
                <div><span>Apport du vendeur</span><b>${fcfa(o.vendor_contribution)}</b><small>${pct(num(o.vendor_contribution), num(o.vendor_contribution) + num(o.goal_amount))} % du budget</small></div>
                <div><span>Achats prévus</span><b>${fcfa(f.planned_purchases)}</b><small>payés par Ouenze aux fournisseurs</small></div>
                ${o.expected_revenue ? `<div><span>Ventes prévues</span><b>${fcfa(o.expected_revenue)}</b><small>estimation du vendeur, non garantie</small></div>` : ''}
            </div>`;
        }
        return `<div class="tr-kpis">
            <div><span>Capital engagé</span><b>${fcfa(capital)}</b><small>participants ${fcfa(f.pledged)} + vendeur ${fcfa(f.vendor_in)}</small></div>
            <div><span>Fournisseurs payés</span><b>${fcfa(f.suppliers_paid)}</b><small>sur ${fcfa(f.planned_purchases)} prévus</small></div>
            <div><span>Autres dépenses</span><b>${fcfa(f.expenses)}</b><small>validées sur justificatif</small></div>
            <div><span>Ventes</span><b>${fcfa(f.sales)}</b><small>validées</small></div>
            <div><span>Fonds non utilisés</span><b>${fcfa(available)}</b><small>simulés</small></div>
            <div class="${result >= 0 ? 'tr-pos' : 'tr-neg'}"><span>${o.status === 'running' ? 'Résultat à ce jour' : 'Résultat final'}</span><b>${fcfa(result)}</b><small>ventes − achats − dépenses</small></div>
        </div>`;
    }

    function timelineHtml(o) {
        const steps = [
            ['submitted', 'Proposée', o.created_at], ['collecting', 'Collecte', o.collect_ends_at ? `jusqu'au ${day(o.collect_ends_at)}` : ''],
            ['running', '45 jours', o.started_at ? `${day(o.started_at)} → ${day(o.ends_at)}` : ''], ['closed', 'Clôture', o.closed_at ? day(o.closed_at) : '']
        ];
        const order = ['submitted', 'collecting', 'running', 'closed'];
        const at = o.status === 'failed' ? 3 : o.status === 'cancelled' || o.status === 'rejected' ? -1 : order.indexOf(o.status);
        return `<ol class="tr-steps">${steps.map(([k, l, d], i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}"><b>${l}</b><small>${esc(typeof d === 'string' && d.includes('T') ? day(d) : d || '')}</small></li>`).join('')}</ol>`;
    }

    function myShareHtml(d) {
        const o = d.operation;
        const f = d.figures;
        const mine = num(d.my_pledge);
        if (!mine) return '';
        const capital = num(f.pledged) + num(f.vendor_in);
        const share = capital > 0 ? (mine / capital) * 100 : 0;
        const snap = o.result_snapshot;
        return `<div class="dl-card tr-mybox">
            <strong><i class="fas fa-user"></i> Ta participation : ${fcfa(mine)}</strong>
            ${o.status !== 'collecting' ? `<p>Ta part du capital : <b>${share.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</b></p>` : ''}
            ${snap ? `<p>Résultat de l'opération : <b>${fcfa(snap.result)}</b>.</p>
                <p class="tr-rules"><i class="fas fa-balance-scale"></i> <b>Répartition : règles en cours de validation.</b> Le partage des gains ou des pertes,
                l'ordre des pertes et le versement du solde ne sont pas encore fixés. Aucun montant ne t'est dû ni retiré dans cette simulation.</p>` : ''}
            ${o.status === 'collecting' ? `<button class="btn-cancel" onclick="trWithdraw()">Retirer ma participation</button>` : ''}
        </div>`;
    }

    function pledgeHtml(d) {
        const o = d.operation;
        if (o.status !== 'collecting' || o.is_owner) return '';
        const left = num(o.goal_amount) - num(d.figures.pledged);
        if (left <= 0) return '<div class="dl-card tr-empty">Financement complet : l\'opération va bientôt démarrer.</div>';
        return `<div class="dl-card tr-pledge">
            <h4>Participer (simulation)</h4>
            <p class="tr-help">Il reste <b>${fcfa(left)}</b> à financer. Tu ne paies rien : c'est un essai du parcours.</p>
            <input id="trAmount" type="number" min="1" max="${left}" inputmode="numeric" placeholder="Montant en FCFA">
            <label class="terms-line"><input type="checkbox" id="trRisk"><span>Je comprends que je peux <b>perdre tout ou partie</b> de ma participation,
                que le résultat n'est pas garanti et que je ne peux pas retirer mon argent pendant les 45 jours.</span></label>
            <p class="tm-msg" id="trPledgeMsg" hidden></p>
            <button class="btn-submit" onclick="trPledge()"><i class="fas fa-check"></i> Je participe (simulation)</button>
        </div>`;
    }

    function suppliersHtml(d) {
        const o = d.operation;
        const admin = o.role === 'admin';
        return `<div class="dl-card"><h4><i class="fas fa-truck"></i> Achats fournisseurs <small>payés directement par Ouenze</small></h4>
            <ul class="tr-list">${d.suppliers.map(l => `<li>
                <div><b>${esc(l.item)}</b><small>${esc(l.supplier_name)}${l.supplier_phone ? ' · ' + esc(l.supplier_phone) : ''}${l.quote_ref ? ' · devis ' + esc(l.quote_ref) : ''}</small>
                    ${l.status === 'paid' ? `<small class="tr-okline"><i class="fas fa-check"></i> Payé le ${day(l.paid_at)}${l.paid_ref ? ' · réf. ' + esc(l.paid_ref) : ''}</small>` : ''}</div>
                <div class="tr-list-side"><b>${fcfa(l.amount)}</b>
                    ${l.status === 'planned' ? (admin && o.status === 'running' ? `<button class="btn-submit" onclick="trPaySupplier('${esc(l.id)}')">Payer (simulation)</button>` : badge(['Prévu', 'wait'])) : l.status === 'paid' ? badge(['Payé', 'ok']) : badge(['Annulé', 'ko'])}</div>
            </li>`).join('')}</ul></div>`;
    }

    function entriesHtml(d) {
        const o = d.operation;
        const canDeclare = (o.is_owner || o.is_team) && o.status === 'running';
        const list = d.entries.filter(e => e.kind !== 'note' || o.is_owner || o.is_team || e.label);
        return `<div class="dl-card"><h4><i class="fas fa-stream"></i> Suivi de l'argent</h4>
            ${canDeclare ? `<div class="tr-declare">
                <div class="tr-declare-kinds">
                    <label><input type="radio" name="trKind" value="expense" checked><span>Dépense</span></label>
                    <label><input type="radio" name="trKind" value="sale"><span>Vente</span></label>
                    <label><input type="radio" name="trKind" value="note"><span>Nouvelle</span></label>
                </div>
                <input id="trLabel" maxlength="200" placeholder="Ex : transport Kinshasa → Brazzaville, vente de 20 pagnes…">
                <input id="trEntryAmount" type="number" min="0" inputmode="numeric" placeholder="Montant (FCFA)">
                <input id="trProofRef" maxlength="200" placeholder="Référence du justificatif (n° de reçu, transaction…)">
                <label class="tr-file"><i class="fas fa-camera"></i> Photo du justificatif<input type="file" accept="image/*" capture="environment" onchange="trProof(this)"></label>
                <img id="trProofPreview" class="tr-proof-preview" hidden alt="">
                <p class="tm-msg" id="trEntryMsg" hidden></p>
                <button class="btn-submit" onclick="trDeclare()"><i class="fas fa-plus"></i> Ajouter au suivi</button>
            </div>` : ''}
            <ul class="tr-list tr-entries">${list.length ? list.map(e => {
                const k = KIND[e.kind] || [e.kind, 'fa-circle'];
                const isImg = /^data:image\//.test(e.proof || '');
                return `<li>
                    <span class="tr-ico"><i class="fas ${k[1]}"></i></span>
                    <div><b>${esc(e.label)}</b><small>${esc(k[0])} · ${day(e.created_at)}${e.author ? ' · ' + esc(e.author) : ''}</small>
                        ${e.proof && !isImg ? `<small>Justificatif : ${esc(e.proof)}</small>` : ''}
                        ${isImg ? `<a href="#" onclick="trShowProof('${esc(e.id)}');return false;" class="tr-proof-link"><i class="fas fa-image"></i> Voir le justificatif</a>` : ''}
                        ${e.review_note ? `<small>Note Ouenze : ${esc(e.review_note)}</small>` : ''}</div>
                    <div class="tr-list-side">${e.amount ? `<b class="${e.kind === 'sale' || e.kind === 'vendor_contribution' ? 'tr-in' : 'tr-out'}">${e.kind === 'sale' || e.kind === 'vendor_contribution' ? '+' : '−'}${fcfa(e.amount)}</b>` : ''}
                        ${e.kind !== 'note' ? badge(ENTRY[e.status] || [e.status, 'info']) : ''}
                        ${e.status === 'pending' && o.is_team ? `<span class="tr-review"><button class="btn-submit" onclick="trReviewEntry('${esc(e.id)}', true)">Valider</button>
                            <button class="btn-cancel" onclick="trReviewEntry('${esc(e.id)}', false)">Refuser</button></span>` : ''}</div>
                </li>`;
            }).join('') : '<li class="tr-empty">Rien pour l\'instant.</li>'}</ul></div>`;
    }

    function teamHtml(d) {
        const o = d.operation;
        if (o.role !== 'admin') return '';
        const actions = {
            submitted: `<button class="btn-submit" onclick="trReview('approve')"><i class="fas fa-check"></i> Vérifiée : ouvrir la collecte</button>
                <button class="btn-cancel tm-danger-text" onclick="trReview('reject')">Refuser</button>`,
            collecting: `<button class="btn-submit" onclick="trStart()"><i class="fas fa-play"></i> Lancer les 45 jours</button>
                <button class="btn-cancel tm-danger-text" onclick="trClose('cancelled')">Annuler l'opération</button>`,
            running: `<button class="btn-submit" onclick="trClose('closed')"><i class="fas fa-flag-checkered"></i> Clôturer</button>
                <button class="btn-cancel tm-danger-text" onclick="trClose('failed')">Déclarer en échec</button>`
        }[o.status];
        return `<div class="dl-card tr-team">
            <h4><i class="fas fa-user-shield"></i> Équipe Ouenze</h4>
            ${d.pledges?.length ? `<p class="tr-help">${d.pledges.length} participation(s) : ${d.pledges.map(p => `${esc(p.investor)} ${fcfa(p.amount)}${p.status === 'withdrawn' ? ' (retirée)' : ''}`).join(' · ')}</p>` : ''}
            ${actions ? `<div class="tr-team-actions">${actions}</div>` : '<p class="tr-help">Aucune action possible : opération terminée.</p>'}
            <p class="tm-msg" id="trTeamMsg" hidden></p>
        </div>`;
    }

    function detailHtml(d) {
        const o = d.operation;
        const st = STATUS[o.status] || [o.status, 'info'];
        return `<button class="tr-back" onclick="trTab('${state.tab === 'detail' ? 'open' : state.tab}')"><i class="fas fa-arrow-left"></i> Retour</button>
            <div class="dl-card tr-head">
                <div class="tr-card-head"><h3>${esc(o.title)}</h3>${badge(st)}</div>
                <small class="tr-shop"><i class="fas fa-store"></i> ${esc(o.shop_name)} · opération de ${o.duration_days} jours</small>
                ${o.description ? `<p>${esc(o.description)}</p>` : ''}
                ${o.review_note && (o.is_owner || o.is_team || o.status === 'rejected') ? `<p class="tr-help">Note Ouenze : ${esc(o.review_note)}</p>` : ''}
                ${timelineHtml(o)}
                ${figuresHtml(o, d.figures)}
                ${['closed', 'failed'].includes(o.status) ? `<p class="tr-rules"><i class="fas fa-balance-scale"></i> <b>Répartition non calculée :</b> les règles de partage des gains et des pertes,
                    le fonds de garantie et la garde des fonds sont en cours de validation.</p>` : ''}
            </div>
            ${teamHtml(d)}
            ${myShareHtml(d)}
            ${pledgeHtml(d)}
            ${suppliersHtml(d)}
            ${o.status !== 'submitted' || o.is_owner || o.is_team ? entriesHtml(d) : ''}`;
    }

    async function trOpen(id) {
        state.openId = id;
        box().innerHTML = '<p style="text-align:center;color:var(--gray-500);padding:30px 0;">Chargement…</p>';
        const { data, error } = await rpc('trade_detail', { target: id });
        if (error) { message(`<p>${esc(errorText(error))}</p><button class="btn-cancel" onclick="trTab('open')">Retour</button>`); return; }
        state.detail = data;
        box().innerHTML = detailHtml(data);
        window.scrollTo(0, 0);
    }
    const reopen = () => trOpen(state.openId);

    // ---------- Actions ----------
    async function trPledge() {
        const amount = num(document.getElementById('trAmount')?.value);
        const risk = document.getElementById('trRisk')?.checked;
        if (!amount) return say('trPledgeMsg', 'Indique un montant.', false);
        if (!risk) return say('trPledgeMsg', 'Coche la case sur les risques pour continuer.', false);
        const { error } = await rpc('trade_pledge', { target: state.openId, amount, risk_ack: true });
        if (error) return say('trPledgeMsg', errorText(error), false);
        reopen();
    }

    async function trWithdraw() {
        if (!await ask({ title: 'Retirer ta participation ?', text: 'Possible tant que la collecte est ouverte.', ok: 'Retirer', danger: true })) return;
        const { error } = await rpc('trade_withdraw_pledge', { target: state.openId });
        if (error) return ask({ title: 'Impossible', text: errorText(error), ok: 'OK' });
        reopen();
    }

    // Photo de justificatif : réduite pour rester légère (lisible à l'écran)
    let proofData = '';
    function trProof(input) {
        const file = input.files?.[0];
        proofData = '';
        if (!file) return;
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width = Math.round(img.width * scale);
            c.height = Math.round(img.height * scale);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            for (const q of [0.75, 0.6, 0.45]) { proofData = c.toDataURL('image/jpeg', q); if (proofData.length < 850000) break; }
            const p = document.getElementById('trProofPreview');
            if (p) { p.src = proofData; p.hidden = false; }
        };
        img.onerror = () => { URL.revokeObjectURL(url); say('trEntryMsg', 'Image illisible : essaie une autre photo.', false); };
        img.src = url;
    }

    async function trDeclare() {
        const kind = document.querySelector('input[name="trKind"]:checked')?.value || 'expense';
        const label = (document.getElementById('trLabel')?.value || '').trim();
        const amount = num(document.getElementById('trEntryAmount')?.value);
        const ref = (document.getElementById('trProofRef')?.value || '').trim();
        const proof = proofData || ref;
        const { error } = await rpc('trade_declare', { target: state.openId, k: kind, lbl: label, amt: amount, prf: proof || null });
        if (error) return say('trEntryMsg', errorText(error), false);
        proofData = '';
        reopen();
    }

    function trShowProof(id) {
        const e = state.detail?.entries.find(x => x.id === id);
        if (!e?.proof) return;
        const ov = document.createElement('div');
        ov.className = 'tm-dialog';
        ov.innerHTML = `<div class="tm-dialog-card tr-proof-card"><img src="${e.proof}" alt="Justificatif"><button class="btn-cancel">Fermer</button></div>`;
        ov.addEventListener('click', ev => { if (ev.target === ov || ev.target.tagName === 'BUTTON') ov.remove(); });
        document.body.appendChild(ov);
    }

    async function trReviewEntry(id, ok) {
        const note = ok ? await ask({ title: 'Valider cette ligne ?', text: 'Note facultative (vérification faite).', field: true, optional: true, ok: 'Valider' })
            : await ask({ title: 'Refuser cette ligne ?', text: 'Le vendeur verra le motif.', field: true, placeholder: 'Ex : reçu illisible', ok: 'Refuser', danger: true });
        if (note === null) return;
        const { error } = await rpc('trade_review_entry', { target_entry: id, ok, note: note || null });
        if (error) return ask({ title: 'Impossible', text: errorText(error), ok: 'OK' });
        reopen();
    }

    async function trPaySupplier(lineId) {
        const ref = await ask({ title: 'Fournisseur payé ?', text: 'Simulation : indique la référence qu\'aurait le paiement (aucun argent ne part).', field: true, placeholder: 'Ex : virement 991, MTN 4455', ok: 'Marquer payé' });
        if (!ref) return;
        const { error } = await rpc('trade_pay_supplier', { target_line: lineId, reference: ref });
        if (error) return ask({ title: 'Impossible', text: errorText(error), ok: 'OK' });
        reopen();
    }

    async function trReview(decision) {
        const note = decision === 'approve'
            ? await ask({ title: 'Ouvrir la collecte ?', text: 'Note facultative (vérifications faites). La collecte dure 7 jours.', field: true, optional: true, ok: 'Ouvrir la collecte' })
            : await ask({ title: 'Refuser l\'opération ?', text: 'Le vendeur verra le motif.', field: true, placeholder: 'Ex : devis fournisseur introuvable', ok: 'Refuser', danger: true });
        if (note === null) return;
        const { error } = await rpc('trade_review', { target: state.openId, decision, note: note || null, collect_days: 7 });
        if (error) return say('trTeamMsg', errorText(error), false);
        reopen();
    }

    async function trStart() {
        const ref = await ask({ title: 'Lancer les 45 jours ?', text: 'Simulation : indique la référence de l\'apport du vendeur.', field: true, placeholder: 'Ex : MTN 4455', ok: 'Lancer' });
        if (!ref) return;
        const { error } = await rpc('trade_start', { target: state.openId, contribution_ref: ref });
        if (error) return say('trTeamMsg', errorText(error), false);
        reopen();
    }

    async function trClose(outcome) {
        const titles = { closed: 'Clôturer l\'opération ?', failed: 'Déclarer l\'opération en échec ?', cancelled: 'Annuler l\'opération ?' };
        const note = await ask({ title: titles[outcome], text: 'Les chiffres seront figés. Note pour les participants :', field: true, optional: outcome === 'closed', placeholder: 'Ex : stock entièrement vendu', ok: 'Confirmer', danger: outcome !== 'closed' });
        if (note === null) return;
        const { error } = await rpc('trade_close', { target: state.openId, outcome, note: note || null });
        if (error) return say('trTeamMsg', errorText(error), false);
        reopen();
    }

    // ============ NAVIGATION ============
    async function trTab(k) {
        state.tab = k;
        state.openId = null;
        if (k === 'new') { box().innerHTML = tabs() + newHtml(); trBudget(); return; }
        box().innerHTML = tabs() + '<p style="text-align:center;color:var(--gray-500);padding:30px 0;">Chargement…</p>';
        if (!await loadList()) return;
        box().innerHTML = tabs() + (k === 'open' ? `<div class="dl-card tr-intro">
                <strong>Comment ça marche</strong>
                <ol><li>Un vendeur propose une <b>opération précise</b> de 45 jours et apporte une partie des fonds.</li>
                    <li>Ouenze vérifie, puis <b>paie directement les fournisseurs</b>.</li>
                    <li>Chaque dépense et chaque vente est <b>justifiée</b> et vérifiée par Ouenze.</li>
                    <li>À la fin, le résultat de l'opération est publié. Le résultat peut être un gain ou une perte.</li></ol></div>` : '') + listHtml();
    }

    async function init() {
        if (!window.supabase?.auth) { message('<p>Service indisponible.</p>'); return; }
        const { data } = await window.supabase.auth.getSession();
        state.user = data?.session?.user || null;
        if (!state.user) {
            message(`<i class="fas fa-lock"></i><h3>Ouenze Trade (simulation)</h3><p>Connecte-toi pour essayer le parcours.</p>
                <button class="btn-submit" onclick="openLoginModal()">Se connecter</button>`);
            window.supabase.auth.onAuthStateChange(event => { if (event === 'SIGNED_IN') location.reload(); });
            return;
        }
        const [role, shops] = await Promise.all([
            rpc('my_team_role'),
            window.supabase.from('shops').select('id, name').eq('owner_id', state.user.id)
        ]);
        state.role = role.error ? null : role.data;
        state.shops = shops.data || [];
        const params = new URLSearchParams(location.search);
        const id = params.get('op');
        if (id) trOpen(id);
        else if (params.get('new') && state.shops.length) {
            await trTab('new');
            const shop = params.get('shop');
            if (shop && document.getElementById('trShop')) document.getElementById('trShop').value = shop;
        } else trTab(state.role === 'admin' ? 'review' : state.shops.length ? 'mine' : 'open');
    }

    Object.assign(window, {
        trTab, trOpen, trLine, trAddLine, trDelLine, trBudget, trSubmit, trPledge, trWithdraw, trProof, trDeclare,
        trShowProof, trReviewEntry, trPaySupplier, trReview, trStart, trClose
    });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
