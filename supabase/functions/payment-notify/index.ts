// ============================================================
// Edge Function « payment-notify » — notifications de paiement envoyées par CinetPay
//
// CinetPay appelle cette adresse après chaque paiement (cpm_trans_id, cpm_site_id).
// On ne croit JAMAIS le contenu de la notification : on redemande le statut à CinetPay
// avec notre clé (/v2/payment/check) avant de marquer la commande payée.
// Une notification falsifiée ne peut donc rien valider.
//
// Secrets : CINETPAY_APIKEY, CINETPAY_SITE_ID.
// Déploiement : Edge Functions → nom « payment-notify » → « Verify JWT with legacy secret » désactivé
// (CinetPay n'a pas de compte Supabase).
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const API = 'https://api-checkout.cinetpay.com/v2';

Deno.serve(async req => {
    // CinetPay vérifie parfois que l'adresse répond : on répond simplement OK
    if (req.method !== 'POST') return new Response('OK', { status: 200 });

    const apikey = Deno.env.get('CINETPAY_APIKEY');
    const siteId = Deno.env.get('CINETPAY_SITE_ID');
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!apikey || !siteId || !url || !serviceKey) return new Response('OK', { status: 200 });

    // Formulaire (habituel) ou JSON
    let fields = {};
    const type = req.headers.get('content-type') || '';
    try {
        if (type.includes('application/json')) fields = await req.json();
        else fields = Object.fromEntries(new URLSearchParams(await req.text()));
    } catch { return new Response('OK', { status: 200 }); }

    const tx = String(fields.cpm_trans_id || fields.transaction_id || '');
    if (!tx || String(fields.cpm_site_id || siteId) !== String(siteId)) return new Response('OK', { status: 200 });

    const admin = createClient(url, serviceKey);
    const { data: t } = await admin.from('payment_transactions').select('*').eq('transaction_id', tx).maybeSingle();
    if (!t || t.status === 'accepted') return new Response('OK', { status: 200 });

    const res = await fetch(`${API}/payment/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apikey, site_id: siteId, transaction_id: tx })
    });
    const body = await res.json().catch(() => ({}));
    const st = String(body?.data?.status || '').toUpperCase();
    if (st === 'ACCEPTED') {
        if (Math.round(Number(body.data.amount)) === Math.round(Number(t.amount)) && (!body.data.currency || body.data.currency === t.currency)) {
            await admin.rpc('payment_settle', { tx, accepted: true, ref: body.data.operator_id || body.data.payment_method || null, info: body.data });
        } else {
            console.error('payment-notify: montant ou devise différents', tx, body.data);
        }
    } else if (st === 'REFUSED' || st === 'CANCELED' || st === 'CANCELLED') {
        await admin.rpc('payment_settle', { tx, accepted: false, ref: null, info: body.data || body });
    }
    return new Response('OK', { status: 200 });
});
