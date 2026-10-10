// ============================================================
// Edge Function « delivery-application »
//
// action "notify"   : appelée par le livreur juste après sa candidature.
//                     → email à l'admin avec toutes les infos, les 4 photos
//                       (liens signés valables 7 jours) et un bouton « Vérifier ».
//                     → email d'accusé de réception au livreur.
// action "decision" : appelée par l'admin après validation / refus.
//                     → email au livreur avec la décision.
//
// Secrets à définir (Supabase → Edge Functions → Secrets) :
//   BREVO_API_KEY  clé API Brevo (xkeysib-…, PAS la clé SMTP)
//   ADMIN_EMAIL    adresse qui reçoit les candidatures
//   SENDER_EMAIL   expéditeur validé dans Brevo
//   SITE_URL       ex. https://ouenze.pages.dev
// SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournis par Supabase.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const PHOTO_FIELDS = [
    ['profile_photo_path', 'Photo du livreur'],
    ['id_photo_path', "Pièce d'identité"],
    ['license_photo_path', 'Permis de conduire'],
    ['vehicle_photo_path', 'Véhicule']
];

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
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

function layout(title, body) {
    return `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#1e293b;">
<div style="max-width:640px;margin:0 auto;padding:24px 16px;">
  <div style="background:#1e40af;color:#fff;border-radius:16px 16px 0 0;padding:18px 22px;font-size:20px;font-weight:bold;">OUENZE</div>
  <div style="background:#fff;border-radius:0 0 16px 16px;padding:22px;">
    <h2 style="margin:0 0 14px;font-size:18px;">${title}</h2>
    ${body}
  </div>
  <p style="text-align:center;color:#94a3b8;font-size:11px;margin-top:14px;">Ouenze - Marketplace Congo-Brazzaville</p>
</div></body></html>`;
}

function row(label, value) {
    return `<tr><td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;color:#64748b;width:42%;">${esc(label)}</td>
<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-weight:bold;">${esc(value)}</td></tr>`;
}

Deno.serve(async req => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const siteUrl = (Deno.env.get('SITE_URL') || '').replace(/\/$/, '');
    const adminEmail = Deno.env.get('ADMIN_EMAIL');
    if (!url || !anonKey || !serviceKey || !siteUrl || !adminEmail) {
        return json({ error: 'Configuration incomplète de la fonction (secrets)' }, 500);
    }

    // Qui appelle ? (jeton de l'utilisateur connecté)
    const authHeader = req.headers.get('Authorization') || '';
    const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'Connexion requise' }, 401);

    let payload;
    try { payload = await req.json(); } catch { return json({ error: 'Requête invalide' }, 400); }
    const { action, application_id: applicationId } = payload || {};
    if (!applicationId || !['notify', 'decision'].includes(action)) return json({ error: 'Paramètres invalides' }, 400);

    const admin = createClient(url, serviceKey);
    const { data: app, error } = await admin.from('delivery_applications').select('*').eq('id', applicationId).maybeSingle();
    if (error || !app) return json({ error: 'Candidature introuvable' }, 404);

    try {
        if (action === 'notify') {
            // Seul le candidat lui-même peut déclencher l'envoi de SA candidature, et seulement en attente
            if (app.user_id !== user.id) return json({ error: 'Accès refusé' }, 403);
            if (app.status !== 'pending') return json({ error: 'Candidature déjà traitée' }, 409);
            // Anti-spam : un email admin au plus toutes les 10 minutes par candidature
            if (app.notified_at && Date.now() - Date.parse(app.notified_at) < 10 * 60 * 1000) {
                return json({ error: 'Candidature déjà envoyée, patiente quelques minutes' }, 429);
            }

            const photos = await Promise.all(PHOTO_FIELDS.map(async ([field, label]) => {
                const { data } = await admin.storage.from('delivery-docs').createSignedUrl(app[field], 60 * 60 * 24 * 7);
                return { label, url: data?.signedUrl || '' };
            }));
            const reviewLink = `${siteUrl}/admin-deliverers.html?id=${encodeURIComponent(app.id)}`;
            const vehicle = app.vehicle_type === 'voiture' ? 'Voiture' : 'Moto';

            const adminHtml = layout('🛵 Nouvelle candidature livreur', `
<p style="margin:0 0 16px;">${esc(app.full_name)} souhaite devenir livreur partenaire. Vérifie le dossier puis valide ou refuse.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:18px;">
  ${row('Nom', app.full_name)}
  ${row('Email', app.email)}
  ${row('Téléphone', app.phone)}
  ${row('Pays / ville', `${app.country} — ${app.city}, ${app.district}`)}
  ${row('Véhicule', `${vehicle}${app.vehicle_brand ? ' — ' + app.vehicle_brand : ''}`)}
  ${row('Immatriculation', app.plate_number)}
  ${row('N° de permis', app.license_number)}
  ${row('Permis valable jusqu\'au', formatDate(app.license_expiry))}
  ${row('Reçue le', new Date(app.created_at).toLocaleString('fr-FR', { timeZone: 'Africa/Brazzaville' }))}
</table>
<table style="width:100%;border-collapse:collapse;"><tr>
  ${photos.map(p => `<td style="width:50%;padding:4px;vertical-align:top;text-align:center;font-size:12px;color:#64748b;">
    ${p.url ? `<a href="${esc(p.url)}"><img src="${esc(p.url)}" alt="${esc(p.label)}" style="width:100%;max-width:280px;border-radius:10px;border:1px solid #e2e8f0;"></a>` : '(photo indisponible)'}
    <div style="margin-top:4px;">${esc(p.label)}</div></td>`).reduce((rows, cell, i) => rows + (i === 2 ? '</tr><tr>' : '') + cell, '')}
</tr></table>
<p style="font-size:11px;color:#94a3b8;">Liens des photos valables 7 jours.</p>
<div style="text-align:center;margin:22px 0 6px;">
  <a href="${esc(reviewLink)}" style="background:#16a34a;color:#fff;text-decoration:none;padding:14px 26px;border-radius:30px;font-weight:bold;display:inline-block;">Vérifier et valider la candidature</a>
</div>`);
            await sendEmail(adminEmail, `🛵 Candidature livreur : ${app.full_name} (${vehicle}, ${app.plate_number})`, adminHtml);
            await admin.from('delivery_applications').update({ notified_at: new Date().toISOString() }).eq('id', app.id);

            await sendEmail(app.email, 'Ouenze : candidature livreur reçue', layout('Candidature reçue ✅', `
<p>Bonjour ${esc(app.full_name)},</p>
<p>Nous avons bien reçu ta candidature pour devenir livreur partenaire Ouenze. Notre équipe vérifie ton permis et ton véhicule sous 24 à 48 h.</p>
<p>Tu recevras un email dès que ton compte sera validé.</p>`));
            return json({ ok: true });
        }

        // action === 'decision' : réservé aux admins, après review_delivery_application()
        const { data: isAdmin } = await admin.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
        if (!isAdmin) return json({ error: 'Accès refusé' }, 403);
        if (app.status === 'approved') {
            await sendEmail(app.email, 'Ouenze : ton compte livreur est validé 🎉', layout('Bienvenue dans l\'équipe ! 🎉', `
<p>Bonjour ${esc(app.full_name)},</p>
<p>Ta candidature de livreur partenaire est <strong>validée</strong>. Tu peux dès maintenant accepter des livraisons.</p>
<div style="text-align:center;margin:20px 0;"><a href="${esc(siteUrl)}/delivery-dashboard.html" style="background:#1e40af;color:#fff;text-decoration:none;padding:12px 24px;border-radius:30px;font-weight:bold;display:inline-block;">Ouvrir mon espace livreur</a></div>`));
        } else if (app.status === 'rejected') {
            await sendEmail(app.email, 'Ouenze : ta candidature livreur', layout('Candidature non retenue', `
<p>Bonjour ${esc(app.full_name)},</p>
<p>Nous ne pouvons pas valider ta candidature pour le moment.</p>
${app.review_note ? `<p><strong>Motif :</strong> ${esc(app.review_note)}</p>` : ''}
<p>Tu peux corriger ton dossier et le renvoyer depuis la page « Devenir livreur ».</p>
<div style="text-align:center;margin:20px 0;"><a href="${esc(siteUrl)}/delivery-register.html" style="background:#1e40af;color:#fff;text-decoration:none;padding:12px 24px;border-radius:30px;font-weight:bold;display:inline-block;">Corriger mon dossier</a></div>`));
        } else {
            return json({ error: 'Aucune décision enregistrée' }, 409);
        }
        return json({ ok: true });
    } catch (e) {
        console.error(e);
        return json({ error: 'Envoi de l\'email impossible', detail: String(e?.message || e) }, 502);
    }
});
