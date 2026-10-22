// ============================================================
// Edge Function « sms-hook » — envoi du code de connexion par SMS (Brevo)
//
// Supabase appelle cette fonction à chaque connexion par numéro (hook « Send SMS »).
// Elle vérifie la signature de Supabase puis envoie le code au client via Brevo.
//
// Secrets (Supabase → Edge Functions → Secrets) :
//   BREVO_API_KEY         déjà en place
//   SMS_SENDER            nom affiché, 11 caractères max (ex. « Ouenze »)
//   SEND_SMS_HOOK_SECRET  copié depuis Authentication → Hooks → Send SMS (commence par « v1,whsec_ »)
//
// Déploiement : Edge Functions → Deploy a new function → Via Editor, nom « sms-hook »,
// puis Settings → « Verify JWT with legacy secret » désactivé.
// ============================================================

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

function fail(status: number, message: string) {
    return new Response(JSON.stringify({ error: { http_code: status, message } }), {
        status, headers: { 'Content-Type': 'application/json' }
    });
}

Deno.serve(async req => {
    if (req.method !== 'POST') return fail(405, 'Méthode non autorisée');

    const secret = (Deno.env.get('SEND_SMS_HOOK_SECRET') || '').replace('v1,whsec_', '');
    const apiKey = Deno.env.get('BREVO_API_KEY');
    const sender = (Deno.env.get('SMS_SENDER') || '').slice(0, 11);
    if (!secret || !apiKey || !sender) return fail(500, 'SMS non configuré (secrets SEND_SMS_HOOK_SECRET, BREVO_API_KEY, SMS_SENDER)');

    const body = await req.text();
    let data;
    try {
        data = new Webhook(secret).verify(body, Object.fromEntries(req.headers));
    } catch {
        return fail(401, 'Signature invalide');
    }

    const phone = String(data?.user?.phone || data?.user?.new_phone || '').replace(/\D/g, '');
    const otp = String(data?.sms?.otp || '');
    if (phone.length < 11 || !otp) return fail(400, 'Numéro ou code manquant');

    const res = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
            sender,
            recipient: phone,
            content: `Ouenze : ton code de connexion est ${otp}. Ne le donne à personne.`,
            type: 'transactional'
        })
    });
    if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        console.error('Brevo SMS', res.status, detail);
        return fail(502, `Envoi du SMS impossible (Brevo ${res.status})`);
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
});
