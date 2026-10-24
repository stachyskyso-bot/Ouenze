// ============================================================
// Edge Function « payment » — paiement des commandes via CinetPay (ou simulation)
//
// action "create"   { order_id, channel?, send_sms? }  (client, livreur ou équipe — connecté)
//     → prépare la demande (RPC payment_prepare : droits et montant vérifiés par la base),
//       crée le paiement chez CinetPay et renvoie le lien. send_sms : envoie le lien au client.
// action "status"   { transaction_id }                  (page paiement.html — sans connexion)
//     → redemande le statut à CinetPay et marque la commande payée si c'est confirmé.
// action "simulate" { transaction_id }                  (équipe seulement, SANS clés CinetPay)
//     → simule un paiement réussi pour tester tout le parcours.
//
// Secrets : CINETPAY_APIKEY, CINETPAY_SITE_ID (sans eux : mode simulation),
//           SITE_URL, BREVO_API_KEY + SMS_SENDER (envoi du lien par SMS, facultatif).
// Déploiement : Edge Functions → nom « payment » → « Verify JWT with legacy secret » désactivé.
// API CinetPay utilisée (à confirmer avec ton compte) :
//   POST https://api-checkout.cinetpay.com/v2/payment        (création → data.payment_url)
//   POST https://api-checkout.cinetpay.com/v2/payment/check  (statut → data.status = ACCEPTED…)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const API = 'https://api-checkout.cinetpay.com/v2';

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function cinetpayKeys() {
    const apikey = Deno.env.get('CINETPAY_APIKEY');
    const site_id = Deno.env.get('CINETPAY_SITE_ID');
    return apikey && site_id ? { apikey, site_id } : null;
}

// Demande le statut réel à CinetPay, puis enregistre le résultat (seule source de vérité)
async function verifyAndSettle(admin, tx) {
    const { data: t } = await admin.from('payment_transactions').select('*').eq('transaction_id', tx).maybeSingle();
    if (!t) return { status: 'unknown' };
    if (t.status === 'accepted' || t.provider !== 'cinetpay') return { status: t.status };
    const keys = cinetpayKeys();
    if (!keys) return { status: t.status };
    const res = await fetch(`${API}/payment/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...keys, transaction_id: tx })
    });
    const body = await res.json().catch(() => ({}));
    const st = String(body?.data?.status || '').toUpperCase();
    if (st === 'ACCEPTED') {
        // Le montant payé doit correspondre exactement au montant demandé
        if (Math.round(Number(body.data.amount)) !== Math.round(Number(t.amount)) || (body.data.currency && body.data.currency !== t.currency)) {
            console.error('payment: montant ou devise différents', tx, body.data);
            return { status: 'mismatch' };
        }
        const ref = body.data.operator_id || body.data.payment_method || null;
        const { data } = await admin.rpc('payment_settle', { tx, accepted: true, ref, info: body.data });
        return data || { status: 'accepted' };
    }
    if (st === 'REFUSED' || st === 'CANCELED' || st === 'CANCELLED') {
        await admin.rpc('payment_settle', { tx, accepted: false, ref: null, info: body.data || body });
        return { status: 'refused' };
    }
    return { status: t.status };
}

async function sendSms(to, text) {
    const apiKey = Deno.env.get('BREVO_API_KEY');
    const sender = (Deno.env.get('SMS_SENDER') || '').slice(0, 11);
    const digits = String(to || '').replace(/\D/g, '');
    if (!apiKey || !sender || digits.length < 11) return 'off';
    const res = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender, recipient: digits, content: text, type: 'transactional' })
    });
    return res.ok ? 'sent' : 'error';
}

Deno.serve(async req => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const siteUrl = (Deno.env.get('SITE_URL') || '').replace(/\/$/, '');
    if (!url || !anonKey || !serviceKey || !siteUrl) return json({ error: 'Configuration incomplète (secrets SITE_URL…)' }, 500);
    const admin = createClient(url, serviceKey);

    let payload;
    try { payload = await req.json(); } catch { return json({ error: 'Requête invalide' }, 400); }
    const action = payload?.action;

    // ---------- Statut (page de paiement, sans connexion) ----------
    if (action === 'status') {
        const tx = String(payload?.transaction_id || '');
        if (tx.length < 12) return json({ error: 'Transaction invalide' }, 400);
        const result = await verifyAndSettle(admin, tx);
        const { data } = await admin.rpc('payment_public', { tx });
        return json({ ...(data || {}), check: result.status });
    }

    // Les autres actions demandent un compte connecté
    const asUser = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'Connexion requise' }, 401);

    // ---------- Simulation (équipe, sans clés CinetPay) ----------
    if (action === 'simulate') {
        if (cinetpayKeys()) return json({ error: 'CinetPay est configuré : la simulation est désactivée' }, 409);
        const { data: team } = await asUser.rpc('is_team');
        if (!team) return json({ error: 'Simulation réservée à l\'équipe Ouenze' }, 403);
        const tx = String(payload?.transaction_id || '');
        const { data: t } = await admin.from('payment_transactions').select('provider, status').eq('transaction_id', tx).maybeSingle();
        if (!t || t.provider !== 'simulation') return json({ error: 'Transaction de simulation introuvable' }, 404);
        const { data, error } = await admin.rpc('payment_settle', { tx, accepted: true, ref: 'SIMULATION', info: { simulated_by: user.id } });
        if (error) return json({ error: error.message }, 400);
        return json(data);
    }

    if (action !== 'create' || !payload?.order_id) return json({ error: 'Paramètres invalides' }, 400);

    // ---------- Créer la demande de paiement ----------
    const { data: prep, error: prepError } = await asUser.rpc('payment_prepare', {
        target_order: payload.order_id, wanted_channel: payload.channel || null
    });
    if (prepError) return json({ error: prepError.message }, 400);

    let paymentUrl = prep.payment_url;
    let provider = prep.provider;
    if (!prep.reuse) {
        const keys = cinetpayKeys();
        if (keys) {
            const res = await fetch(`${API}/payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...keys,
                    transaction_id: prep.transaction_id,
                    amount: prep.amount,
                    currency: prep.currency,
                    description: `Commande Ouenze ${prep.order_number}`.replace(/[^A-Za-z0-9 ]/g, ' '),
                    notify_url: `${url}/functions/v1/payment-notify`,
                    return_url: `${siteUrl}/paiement.html?tx=${prep.transaction_id}`,
                    channels: prep.channel,
                    lang: 'fr',
                    metadata: payload.order_id,
                    customer_name: String(prep.client_name || 'Client').slice(0, 60),
                    customer_surname: 'Ouenze',
                    customer_phone_number: String(prep.phone || '').replace(/[^\d+]/g, ''),
                    customer_email: user.email || 'client@ouenze.com',
                    customer_address: 'Brazzaville',
                    customer_city: 'Brazzaville',
                    customer_country: 'CG',
                    customer_state: 'CG',
                    customer_zip_code: '00000'
                })
            });
            const body = await res.json().catch(() => ({}));
            if (String(body?.code) !== '201' || !body?.data?.payment_url) {
                console.error('payment: CinetPay a refusé la création', body);
                return json({ error: `CinetPay : ${body?.description || body?.message || 'création du paiement impossible'}` }, 502);
            }
            paymentUrl = body.data.payment_url;
            provider = 'cinetpay';
            await admin.rpc('payment_attach', { tx: prep.transaction_id, new_provider: 'cinetpay', url: paymentUrl, info: { payment_token: body.data.payment_token } });
        } else {
            paymentUrl = `${siteUrl}/paiement.html?tx=${prep.transaction_id}`;
            provider = 'simulation';
            await admin.rpc('payment_attach', { tx: prep.transaction_id, new_provider: 'simulation', url: paymentUrl, info: null });
        }
    }

    // Le client reçoit toujours le lien de la page Ouenze (elle redirige vers CinetPay)
    const link = `${siteUrl}/paiement.html?tx=${prep.transaction_id}`;
    let sms = 'not_requested';
    if (payload.send_sms) {
        const amount = Math.round(prep.amount).toLocaleString('fr-FR');
        sms = await sendSms(prep.phone, `Ouenze : paye ta commande ${prep.order_number} (${amount} FCFA) ici : ${link}`);
    }
    return json({ ok: true, transaction_id: prep.transaction_id, link, payment_url: paymentUrl, provider,
                  amount: prep.amount, channel: prep.channel, sms, simulation: provider === 'simulation' });
});
