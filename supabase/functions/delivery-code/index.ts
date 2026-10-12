// ============================================================
// Edge Function « delivery-code » — code de remise au client par SMS et WhatsApp
//
// action "send" : { order_id }
//   Appelée par le LIVREUR de la commande (juste après « Prendre la course », ou
//   « Renvoyer le code »), ou par un admin. Le code est lu côté serveur et envoyé au
//   téléphone de livraison du client : le livreur ne le voit jamais.
//   Au plus 3 envois par code, 2 minutes minimum entre deux envois.
//
// Canaux (chacun s'active dès que ses secrets sont renseignés) :
//   SMS (Brevo)        : BREVO_API_KEY (déjà en place) + SMS_SENDER (ex. « Ouenze », 11 caractères max)
//                        → il faut des crédits SMS dans Brevo.
//   WhatsApp (Meta)    : WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE
//                        (+ WHATSAPP_LANG, « fr » par défaut). Modèle approuvé par Meta avec
//                        une variable {{1}} = le code, catégorie « Utilitaire ».
//
// Déploiement : Supabase → Edge Functions → Deploy a new function → Via Editor,
// nom « delivery-code », puis Settings → « Verify JWT with legacy secret » désactivé.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const MAX_SENDS = 3;
const MIN_GAP_MS = 2 * 60 * 1000;

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// « +242 06 216 63 98 » → « 242062166398 » (indicatif pays obligatoire)
function intlDigits(phone) {
    const d = String(phone || '').replace(/\D/g, '');
    return d.length >= 11 ? d : '';
}

async function sendSms(to, text) {
    const apiKey = Deno.env.get('BREVO_API_KEY');
    const sender = (Deno.env.get('SMS_SENDER') || '').slice(0, 11);
    if (!apiKey || !sender) return { channel: 'sms', status: 'off', detail: 'SMS non configuré (secret SMS_SENDER)' };
    const res = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender, recipient: to, content: text, type: 'transactional' })
    });
    const body = await res.text();
    return res.ok ? { channel: 'sms', status: 'sent' } : { channel: 'sms', status: 'error', detail: `Brevo ${res.status} : ${body.slice(0, 300)}` };
}

async function sendWhatsApp(to, code) {
    const token = Deno.env.get('WHATSAPP_TOKEN');
    const phoneId = Deno.env.get('WHATSAPP_PHONE_ID');
    const template = Deno.env.get('WHATSAPP_TEMPLATE');
    if (!token || !phoneId || !template) return { channel: 'whatsapp', status: 'off', detail: 'WhatsApp non configuré' };
    const lang = Deno.env.get('WHATSAPP_LANG') || 'fr';
    const res = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(phoneId)}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: {
                name: template,
                language: { code: lang },
                components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }]
            }
        })
    });
    const body = await res.text();
    return res.ok ? { channel: 'whatsapp', status: 'sent' } : { channel: 'whatsapp', status: 'error', detail: `Meta ${res.status} : ${body.slice(0, 300)}` };
}

Deno.serve(async req => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) return json({ error: 'Configuration incomplète' }, 500);

    const asUser = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'Connexion requise' }, 401);

    let payload;
    try { payload = await req.json(); } catch { return json({ error: 'Requête invalide' }, 400); }
    if (payload?.action !== 'send' || !payload?.order_id) return json({ error: 'Paramètres invalides' }, 400);

    const admin = createClient(url, serviceKey);
    const { data: order } = await admin.from('orders')
        .select('id, order_number, status, deliverer_id, delivery_info').eq('id', payload.order_id).maybeSingle();
    if (!order) return json({ error: 'Commande introuvable' }, 404);

    const isAdmin = !!(await admin.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()).data;
    if (order.deliverer_id !== user.id && !isAdmin) return json({ error: 'Accès refusé' }, 403);
    if (!['courier_assigned', 'in_transit', 'picked_up'].includes(order.status)) {
        return json({ error: 'Le code n\'est envoyé que pendant la course' }, 409);
    }

    const { data: dc } = await admin.from('delivery_codes').select('*').eq('order_id', order.id).maybeSingle();
    if (!dc) return json({ error: 'Pas de code pour cette commande' }, 404);

    // Compteur remis à zéro quand un nouveau code a été créé (nouveau livreur)
    const previous = dc.sent_at && new Date(dc.sent_at) >= new Date(dc.created_at) ? Number(dc.sends) || 0 : 0;
    if (previous >= MAX_SENDS) return json({ error: `Code déjà envoyé ${MAX_SENDS} fois. Le client le retrouve dans ses notifications Ouenze.` }, 429);
    if (previous > 0 && Date.now() - Date.parse(dc.sent_at) < MIN_GAP_MS) {
        return json({ error: 'Code envoyé il y a moins de 2 minutes : patiente un peu.' }, 429);
    }

    const to = intlDigits(order.delivery_info?.phone);
    if (!to) return json({ error: 'Numéro du client invalide ou sans indicatif pays' }, 422);

    const text = `Ouenze : ton code de remise pour la commande ${order.order_number} est ${dc.code}. `
        + 'Donne-le au livreur seulement quand tu as ton colis en main.';
    const results = await Promise.all([sendSms(to, text), sendWhatsApp(to, dc.code)]);
    const sent = results.filter(r => r.status === 'sent').map(r => r.channel);

    if (sent.length) {
        await admin.from('delivery_codes')
            .update({ sends: previous + 1, sent_at: new Date().toISOString(), sent_channels: sent.join(',') })
            .eq('order_id', order.id);
    }
    // Jamais le code dans la réponse : le livreur ne doit pas le connaître
    return json({ ok: sent.length > 0, sent, results, remaining: sent.length ? MAX_SENDS - previous - 1 : MAX_SENDS - previous },
        sent.length ? 200 : 502);
});
