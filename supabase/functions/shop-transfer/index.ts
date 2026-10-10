// ============================================================
// Edge Function « shop-transfer » — vente / transfert d'une boutique
//
// action "create"  (vendeur connecté)  : crée le transfert, envoie le lien de
//                  confirmation par email, SMS et WhatsApp (selon la configuration).
// action "preview" (tout le monde)     : infos affichées sur transfer.html?t=<jeton>
// action "accept"  (acheteur connecté) : l'email du compte doit être celui indiqué
//                  par le vendeur et confirmé → la boutique change de propriétaire.
// action "cancel"  (vendeur connecté)  : annule un transfert en attente.
//
// Secrets : BREVO_API_KEY, SENDER_EMAIL, SITE_URL (déjà utilisés par delivery-application)
// Optionnels : BREVO_SMS_SENDER (≤ 11 caractères, ex. « Ouenze ») → active les SMS
//              BREVO_WHATSAPP_SENDER + BREVO_WHATSAPP_TEMPLATE_ID → active WhatsApp
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const TRANSFER_HOURS = 72;

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

// +242 06 555 25 62 → 242065552562 (format attendu par Brevo SMS / WhatsApp)
function phoneDigits(phone) {
    const d = String(phone || '').replace(/[^\d]/g, '');
    return /^(242|243)\d{9}$/.test(d) ? d : '';
}

function maskEmail(email) {
    const [user, domain] = String(email).split('@');
    if (!domain) return '';
    return `${user.slice(0, 2)}${'•'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

function formatFcfa(n) {
    return Number(n).toLocaleString('fr-FR') + ' FCFA';
}

async function brevo(path, body) {
    const res = await fetch(`https://api.brevo.com/v3/${path}`, {
        method: 'POST',
        headers: { 'api-key': Deno.env.get('BREVO_API_KEY') || '', 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Brevo ${path} ${res.status} : ${await res.text()}`);
}

function emailLayout(title, body) {
    return `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#1e293b;">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;">
  <div style="background:#1e40af;color:#fff;border-radius:16px 16px 0 0;padding:18px 22px;font-size:20px;font-weight:bold;">OUENZE</div>
  <div style="background:#fff;border-radius:0 0 16px 16px;padding:22px;"><h2 style="margin:0 0 14px;font-size:18px;">${title}</h2>${body}</div>
</div></body></html>`;
}

async function sendEmail(to, subject, html) {
    await brevo('smtp/email', { sender: { name: 'Ouenze', email: Deno.env.get('SENDER_EMAIL') }, to: [{ email: to }], subject, htmlContent: html });
}

Deno.serve(async req => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const siteUrl = (Deno.env.get('SITE_URL') || '').replace(/\/$/, '');
    if (!url || !anonKey || !serviceKey || !siteUrl || !Deno.env.get('BREVO_API_KEY') || !Deno.env.get('SENDER_EMAIL')) {
        return json({ error: 'Configuration incomplète de la fonction (secrets)' }, 500);
    }

    let payload;
    try { payload = await req.json(); } catch { return json({ error: 'Requête invalide' }, 400); }
    const action = payload?.action;
    const admin = createClient(url, serviceKey);

    const authHeader = req.headers.get('Authorization') || '';
    const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await asUser.auth.getUser();

    // ---------- Aperçu (public) ----------
    if (action === 'preview' || action === 'accept') {
        const token = String(payload?.token || '');
        if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: 'Lien invalide' }, 400);
        const { data: t } = await admin.from('shop_transfers').select('*').eq('token_hash', await sha256(token)).maybeSingle();
        if (!t) return json({ error: 'Lien invalide ou déjà utilisé' }, 404);
        if (t.status === 'pending' && Date.parse(t.expires_at) < Date.now()) {
            await admin.from('shop_transfers').update({ status: 'expired' }).eq('id', t.id);
            t.status = 'expired';
        }
        const { data: shop } = await admin.from('shops').select('id, name, logo_url, city, owner_id').eq('id', t.shop_id).maybeSingle();
        const { data: seller } = await admin.from('profiles').select('full_name').eq('id', t.from_user).maybeSingle();

        if (action === 'preview') {
            return json({
                status: t.status, shop_name: shop?.name || '', shop_city: shop?.city || '', logo_url: shop?.logo_url || '',
                seller_name: seller?.full_name || 'Le vendeur', price: t.price, expires_at: t.expires_at, to_email_masked: maskEmail(t.to_email)
            });
        }

        // ---------- Acceptation ----------
        if (!user) return json({ error: 'Connecte-toi pour accepter le transfert' }, 401);
        if (t.status !== 'pending') return json({ error: t.status === 'accepted' ? 'Ce transfert a déjà été accepté' : 'Ce lien n\'est plus valable' }, 409);
        if (String(user.email || '').toLowerCase() !== t.to_email.toLowerCase()) {
            return json({ error: `Ce transfert est destiné à ${maskEmail(t.to_email)}. Connecte-toi avec ce compte.` }, 403);
        }
        if (!user.email_confirmed_at) return json({ error: 'Confirme d\'abord ton adresse email' }, 403);
        if (!shop || shop.owner_id !== t.from_user) {
            await admin.from('shop_transfers').update({ status: 'cancelled' }).eq('id', t.id);
            return json({ error: 'Le vendeur n\'est plus propriétaire de cette boutique' }, 409);
        }

        // Changement de propriétaire, seulement si le vendeur l'est toujours (garde-fou concurrence)
        const { data: moved, error: moveError } = await admin.from('shops')
            .update({ owner_id: user.id }).eq('id', shop.id).eq('owner_id', t.from_user).select('id');
        if (moveError || !moved?.length) return json({ error: 'Transfert impossible, réessaie' }, 409);
        await admin.from('shop_transfers').update({ status: 'accepted', accepted_by: user.id, accepted_at: new Date().toISOString() }).eq('id', t.id);
        // Le nouveau propriétaire devient vendeur (sans toucher aux admins / livreurs)
        await admin.from('profiles').update({ user_type: 'vendeur' }).eq('id', user.id).eq('user_type', 'client');

        const { data: sellerUser } = await admin.auth.admin.getUserById(t.from_user);
        if (sellerUser?.user?.email) {
            await sendEmail(sellerUser.user.email, `Ouenze : transfert de « ${shop.name} » confirmé`, emailLayout('Transfert confirmé ✅',
                `<p>Le transfert de ta boutique <strong>${esc(shop.name)}</strong> vers ${esc(t.to_email)} est confirmé. Elle n'apparaît plus dans ton tableau de bord.</p>`)).catch(console.error);
        }
        return json({ ok: true, shop_id: shop.id });
    }

    if (!user) return json({ error: 'Connexion requise' }, 401);

    // ---------- Annulation ----------
    if (action === 'cancel') {
        const { data: t } = await admin.from('shop_transfers').select('id, from_user, status').eq('id', payload?.transfer_id).maybeSingle();
        if (!t || t.from_user !== user.id) return json({ error: 'Transfert introuvable' }, 404);
        if (t.status !== 'pending') return json({ error: 'Ce transfert n\'est plus en attente' }, 409);
        await admin.from('shop_transfers').update({ status: 'cancelled' }).eq('id', t.id);
        return json({ ok: true });
    }

    // ---------- Création ----------
    if (action !== 'create') return json({ error: 'Action inconnue' }, 400);
    const toEmail = String(payload?.to_email || '').trim().toLowerCase();
    const toPhone = String(payload?.to_phone || '').trim();
    const price = payload?.price === null || payload?.price === undefined || payload?.price === '' ? null : Number(payload.price);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(toEmail)) return json({ error: 'Email du nouveau propriétaire invalide' }, 400);
    if (toEmail === String(user.email || '').toLowerCase()) return json({ error: 'Tu ne peux pas te transférer ta propre boutique' }, 400);
    if (toPhone && !phoneDigits(toPhone)) return json({ error: 'Numéro du nouveau propriétaire invalide (+242 ou +243)' }, 400);
    if (price !== null && (!Number.isFinite(price) || price < 0)) return json({ error: 'Prix invalide' }, 400);

    const { data: shop } = await admin.from('shops').select('id, name, owner_id, archived_at').eq('id', payload?.shop_id).maybeSingle();
    if (!shop || shop.owner_id !== user.id) return json({ error: 'Boutique introuvable' }, 404);
    if (shop.archived_at) return json({ error: 'Cette boutique est archivée' }, 409);

    // Un seul transfert en cours : l'ancien est annulé
    await admin.from('shop_transfers').update({ status: 'cancelled' }).eq('shop_id', shop.id).eq('status', 'pending');
    const token = randomToken();
    const { data: transfer, error } = await admin.from('shop_transfers').insert({
        shop_id: shop.id, from_user: user.id, to_email: toEmail, to_phone: toPhone || null, price,
        token_hash: await sha256(token), expires_at: new Date(Date.now() + TRANSFER_HOURS * 3600 * 1000).toISOString()
    }).select('id').single();
    if (error) return json({ error: 'Création du transfert impossible' }, 500);

    const { data: seller } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
    const sellerName = seller?.full_name || user.email;
    const link = `${siteUrl}/transfer.html?t=${token}`;
    const priceText = price !== null ? ` pour ${formatFcfa(price)}` : '';
    const channels = { email: false, sms: 'non configuré', whatsapp: 'non configuré' };

    try {
        await sendEmail(toEmail, `Ouenze : ${sellerName} te transfère la boutique « ${shop.name} »`, emailLayout('Transfert de boutique 🏪', `
<p>${esc(sellerName)} souhaite te transférer sa boutique <strong>${esc(shop.name)}</strong> sur Ouenze${esc(priceText)}.</p>
<p>Pour accepter, clique sur le bouton puis connecte-toi (ou crée ton compte) avec l'adresse <strong>${esc(toEmail)}</strong>.</p>
<div style="text-align:center;margin:22px 0;"><a href="${esc(link)}" style="background:#16a34a;color:#fff;text-decoration:none;padding:14px 26px;border-radius:30px;font-weight:bold;display:inline-block;">Voir et confirmer le transfert</a></div>
<p style="font-size:12px;color:#64748b;">Ce lien est valable ${TRANSFER_HOURS} heures. Si tu n'attendais pas ce message, ignore-le : rien ne se passera.</p>`));
        channels.email = true;
    } catch (e) { console.error(e); channels.email = 'échec'; }

    const digits = phoneDigits(toPhone);
    const smsSender = Deno.env.get('BREVO_SMS_SENDER');
    if (digits && smsSender) {
        try {
            await brevo('transactionalSMS/send', {
                sender: smsSender.slice(0, 11), recipient: digits, type: 'transactional',
                content: `Ouenze : ${sellerName} vous transfere la boutique "${shop.name}"${priceText}. Confirmez ici (72h) : ${link}`
            });
            channels.sms = true;
        } catch (e) { console.error(e); channels.sms = 'échec'; }
    }
    const waSender = Deno.env.get('BREVO_WHATSAPP_SENDER');
    const waTemplate = Number(Deno.env.get('BREVO_WHATSAPP_TEMPLATE_ID'));
    if (digits && waSender && waTemplate) {
        try {
            // Le modèle WhatsApp (créé et validé dans Brevo) doit contenir les variables SHOP, SELLER et LINK
            await brevo('whatsapp/sendMessage', {
                senderNumber: waSender, contactNumbers: [digits], templateId: waTemplate,
                params: { SHOP: shop.name, SELLER: sellerName, LINK: link }
            });
            channels.whatsapp = true;
        } catch (e) { console.error(e); channels.whatsapp = 'échec'; }
    }
    await admin.from('shop_transfers').update({ channels }).eq('id', transfer.id);

    // Le lien est aussi rendu au vendeur : il ne permet d'accepter qu'au compte destinataire
    return json({ ok: true, transfer_id: transfer.id, channels, link, expires_in_hours: TRANSFER_HOURS });
});
