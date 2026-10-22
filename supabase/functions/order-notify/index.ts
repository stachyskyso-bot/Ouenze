// ============================================================
// Edge Function « order-notify » — emails des commandes (Brevo)
//
// action "placed"   (client, juste après place_order) : { order_ids: [...] }
//                   → au VENDEUR de chaque commande : « Nouvelle commande à accepter »
//                   → au CLIENT : récapitulatif de sa commande
//                   → à OUENZE (ADMIN_EMAIL) : nom, numéro et adresse du client, pour l'appeler
// action "decision" (vendeur, après vendor_order_decision) : { order_id }
//                   → au CLIENT : commande acceptée, refusée (avec le motif) ou livrée
//
// Chaque email n'est envoyé qu'une fois par commande et par événement
// (trace dans orders.delivery_info.notified).
//
// Secrets (déjà utilisés par delivery-application) : BREVO_API_KEY, SENDER_EMAIL, SITE_URL, ADMIN_EMAIL
// SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const COMMISSION = { gold: 0.21, silver: 0.215, bronze: 0.2175, standard: 0.22 };   // = medal_commission()

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fcfa(n) {
    return Math.round(Number(n) || 0).toLocaleString('fr-FR') + ' FCFA';
}

async function sendEmail(to, subject, html) {
    const apiKey = Deno.env.get('BREVO_API_KEY');
    const sender = Deno.env.get('SENDER_EMAIL');
    if (!apiKey || !sender) throw new Error('BREVO_API_KEY ou SENDER_EMAIL manquant');
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender: { name: 'Ouenze', email: sender }, to: [{ email: to }], subject, htmlContent: html })
    });
    if (!res.ok) throw new Error(`Brevo ${res.status} : ${await res.text()}`);
}

function layout(title, body, test) {
    return `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#1e293b;">
<div style="max-width:640px;margin:0 auto;padding:24px 16px;">
  <div style="background:#1e40af;color:#fff;border-radius:16px 16px 0 0;padding:18px 22px;font-size:20px;font-weight:bold;">OUENZE</div>
  <div style="background:#fff;border-radius:0 0 16px 16px;padding:22px;">
    ${test ? '<p style="background:#fef3c7;color:#92400e;border-radius:10px;padding:10px 12px;margin:0 0 14px;font-weight:bold;">⚠️ Commande de TEST : rien n\'a été payé, ne rien expédier.</p>' : ''}
    <h2 style="margin:0 0 14px;font-size:18px;">${title}</h2>
    ${body}
  </div>
  <p style="text-align:center;color:#94a3b8;font-size:11px;margin-top:14px;">Ouenze - Marketplace Congo-Brazzaville</p>
</div></body></html>`;
}

function button(href, label) {
    return `<p style="text-align:center;margin:20px 0 6px;"><a href="${esc(href)}" style="display:inline-block;background:#1e40af;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:30px;">${esc(label)}</a></p>`;
}

function itemsTable(items, order) {
    const rows = items.map(i => `<tr>
        <td style="padding:8px 6px;border-bottom:1px solid #e2e8f0;">${esc(i.product_name)}${i.variant_name ? ` <span style="color:#64748b;">(${esc(i.variant_name)})</span>` : ''}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #e2e8f0;text-align:center;">× ${i.quantity}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #e2e8f0;text-align:right;">${fcfa(i.total_price)}</td></tr>`).join('');
    return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:12px;">${rows}
        <tr><td colspan="2" style="padding:8px 6px;color:#64748b;">Sous-total</td><td style="padding:8px 6px;text-align:right;">${fcfa(order.subtotal)}</td></tr>
        <tr><td colspan="2" style="padding:4px 6px;color:#64748b;">Livraison</td><td style="padding:4px 6px;text-align:right;">${fcfa(order.delivery_fees)}</td></tr>
        <tr><td colspan="2" style="padding:8px 6px;font-weight:bold;">Total</td><td style="padding:8px 6px;text-align:right;font-weight:bold;">${fcfa(order.total)}</td></tr></table>`;
}

Deno.serve(async req => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const siteUrl = (Deno.env.get('SITE_URL') || '').replace(/\/$/, '');
    if (!url || !anonKey || !serviceKey || !siteUrl) return json({ error: 'Configuration incomplète de la fonction (secrets)' }, 500);

    const asUser = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'Connexion requise' }, 401);

    let payload;
    try { payload = await req.json(); } catch { return json({ error: 'Requête invalide' }, 400); }
    const action = payload?.action;
    const ids = action === 'placed' ? payload?.order_ids : [payload?.order_id];
    if (!['placed', 'decision'].includes(action) || !Array.isArray(ids) || !ids.length || ids.length > 20 || ids.some(id => typeof id !== 'string')) {
        return json({ error: 'Paramètres invalides' }, 400);
    }

    const admin = createClient(url, serviceKey);
    const { data: orders, error } = await admin.from('orders')
        .select('id, order_number, client_id, status, payment_status, subtotal, delivery_fees, total, notes, delivery_info, created_at, order_items(product_name, variant_name, quantity, unit_price, total_price, shop_id)')
        .in('id', ids);
    if (error || !orders?.length) return json({ error: 'Commande introuvable' }, 404);

    const shopIds = [...new Set(orders.flatMap(o => (o.order_items || []).map(i => i.shop_id)))];
    const { data: shops } = await admin.from('shops').select('id, name, owner_id').in('id', shopIds);
    const shopOf = o => (shops || []).find(s => s.id === o.order_items?.[0]?.shop_id) || {};
    const emailOf = async id => (await admin.auth.admin.getUserById(id))?.data?.user?.email || '';

    // Trace des emails déjà envoyés (anti-doublon)
    async function markNotified(order, key) {
        const info = { ...(order.delivery_info || {}) };
        info.notified = { ...(info.notified || {}), [key]: new Date().toISOString() };
        await admin.from('orders').update({ delivery_info: info }).eq('id', order.id);
    }
    const already = (order, key) => !!order.delivery_info?.notified?.[key];
    const sent = [];

    try {
        if (action === 'placed') {
            // Seul le client de la commande, et seulement pour une commande en attente récente
            if (orders.some(o => o.client_id !== user.id)) return json({ error: 'Accès refusé' }, 403);
            const fresh = orders.filter(o => o.status === 'pending' && !already(o, 'placed')
                && Date.now() - Date.parse(o.created_at) < 30 * 60 * 1000);
            if (!fresh.length) return json({ ok: true, sent: [] });

            const { data: medals } = await admin.rpc('shop_medals');
            for (const o of fresh) {
                const shop = shopOf(o);
                const vendorEmail = await emailOf(shop.owner_id);
                const test = o.payment_status === 'test';
                const rate = COMMISSION[(medals || []).find(m => m.shop_id === shop.id)?.medal] ?? COMMISSION.standard;
                const net = Math.round(o.subtotal * (1 - rate));
                const where = [o.delivery_info?.district, o.delivery_info?.city].filter(Boolean).join(', ');
                if (vendorEmail) {
                    await sendEmail(vendorEmail, `${test ? '[TEST] ' : ''}🛒 Nouvelle commande ${o.order_number} à accepter`, layout(
                        `Nouvelle commande pour ${esc(shop.name)}`,
                        `<p style="margin:0 0 12px;">Commande <strong>${esc(o.order_number)}</strong>${where ? `, livraison à <strong>${esc(where)}</strong>` : ''}.</p>
                        ${itemsTable(o.order_items, o)}
                        <p style="font-size:14px;margin:0 0 6px;">Après livraison, tu reçois <strong>${fcfa(net)}</strong> (commission Ouenze ${(rate * 100).toLocaleString('fr-FR')} % sur ${fcfa(o.subtotal)}).</p>
                        <p style="font-size:14px;margin:0;"><strong>Accepte ou refuse la commande rapidement</strong> : le client attend ta réponse, puis un livreur proche vient la récupérer.</p>
                        ${button(`${siteUrl}/vendor-dashboard.html#commandes`, 'Accepter ou refuser')}`, test));
                    sent.push({ to: 'vendor', order: o.order_number });
                }
                await markNotified(o, 'placed');
            }
            // Email à Ouenze : de quoi appeler le client et confirmer son adresse
            const adminEmail = Deno.env.get('ADMIN_EMAIL');
            if (adminEmail) {
                const d = fresh[0].delivery_info || {};
                const meta = user.user_metadata || {};
                const name = meta.full_name || meta.name || 'Client';
                const phone = d.phone || meta.phone || (user.phone ? '+' + user.phone : '');
                const tel = String(phone).replace(/\D/g, '');
                const total = fresh.reduce((s, o) => s + Number(o.total), 0);
                const test = fresh.some(o => o.payment_status === 'test');
                const line = (label, value) => value ? `<tr><td style="padding:6px;color:#64748b;width:38%;">${label}</td><td style="padding:6px;font-weight:bold;">${esc(value)}</td></tr>` : '';
                await sendEmail(adminEmail, `${test ? '[TEST] ' : ''}📞 Nouvelle commande : ${name} · ${phone}`, layout(
                    'Nouvelle commande : appeler le client',
                    `<table style="width:100%;border-collapse:collapse;font-size:15px;margin-bottom:12px;">
                        ${line('Client', name)}${line('Téléphone', phone)}${line('Ville', d.city)}${line('Quartier', d.district)}
                        ${line('Rue', d.street)}${line('Repère', d.landmark)}
                        ${line('Mobile Money', [d.payment_operator, d.payment_phone].filter(Boolean).join(' · '))}
                        ${line('Commandes', fresh.map(o => `${o.order_number} (${shopOf(o).name || ''})`).join(', '))}
                        ${line('Total à payer à la livraison', fcfa(total))}
                    </table>
                    ${tel ? `<p style="text-align:center;margin:18px 0 6px;">
                        <a href="tel:+${tel}" style="display:inline-block;background:#1e40af;color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:30px;margin:4px;">Appeler</a>
                        <a href="https://wa.me/${tel}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:30px;margin:4px;">WhatsApp</a></p>` : ''}`, test));
                sent.push({ to: 'admin' });
            }

            const clientEmail = user.email;
            if (clientEmail) {
                const test = fresh.some(o => o.payment_status === 'test');
                const total = fresh.reduce((s, o) => s + Number(o.total), 0);
                await sendEmail(clientEmail, `${test ? '[TEST] ' : ''}Commande reçue : ${fresh.map(o => o.order_number).join(', ')}`, layout(
                    'Merci, ta commande est envoyée !',
                    `${fresh.map(o => `<p style="margin:14px 0 6px;font-weight:bold;">${esc(shopOf(o).name)} — ${esc(o.order_number)}</p>${itemsTable(o.order_items, o)}`).join('')}
                    <p style="font-size:15px;"><strong>Total : ${fcfa(total)}</strong></p>
                    <p style="font-size:14px;">Chaque vendeur va <strong>accepter</strong> sa partie de la commande. Tu reçois un email à chaque étape, puis un livreur proche te l'apporte.</p>
                    ${button(`${siteUrl}/activities.html`, 'Suivre ma commande')}`, test));
                sent.push({ to: 'client' });
            }
            return json({ ok: true, sent });
        }

        // action "decision" : seul le vendeur de la boutique
        const o = orders[0];
        const shop = shopOf(o);
        if (shop.owner_id !== user.id) return json({ error: 'Accès refusé' }, 403);
        if (!['accepted', 'refused', 'delivered'].includes(o.status)) return json({ error: 'Rien à annoncer pour cette commande' }, 409);
        if (already(o, o.status)) return json({ ok: true, sent: [] });
        const clientEmail = await emailOf(o.client_id);
        const test = o.payment_status === 'test';
        const content = {
            accepted: [`✅ ${shop.name} a accepté ta commande ${o.order_number}`, 'Commande acceptée',
                `<p><strong>${esc(shop.name)}</strong> prépare ta commande. Un livreur proche va venir la récupérer et te l'apporter.</p>${itemsTable(o.order_items, o)}`,
                `${siteUrl}/activities.html`, 'Suivre ma commande'],
            refused: [`Commande ${o.order_number} refusée par ${shop.name}`, 'Commande refusée',
                `<p><strong>${esc(shop.name)}</strong> ne peut pas honorer ta commande.${o.notes ? `<br>Motif : <em>${esc(o.notes)}</em>` : ''}</p>
                <p>${test ? 'Commande de test : rien n\'a été débité.' : 'Tu es intégralement remboursé.'}</p>`,
                `${siteUrl}/index.html`, 'Voir d\'autres boutiques'],
            delivered: [`📦 Commande ${o.order_number} livrée : donne ton avis`, 'Commande livrée',
                `<p>Ta commande de <strong>${esc(shop.name)}</strong> est livrée. Prends 10 secondes pour noter la boutique et le livreur : ton avis aide les autres clients.</p>`,
                `${siteUrl}/activities.html`, 'Noter ma commande']
        }[o.status];
        if (clientEmail) {
            await sendEmail(clientEmail, `${test ? '[TEST] ' : ''}${content[0]}`, layout(content[1], content[2] + button(content[3], content[4]), test));
            sent.push({ to: 'client', status: o.status });
        }
        await markNotified(o, o.status);
        return json({ ok: true, sent });
    } catch (e) {
        console.error('order-notify', e);
        return json({ error: 'Envoi de l\'email impossible : ' + (e?.message || e) }, 502);
    }
});
