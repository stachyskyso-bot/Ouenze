// ============================================================
// Edge Function « vendor-application »
//
// action "notify"   : appelée par le demandeur juste après sa demande vendeur.
//                     → email à l'admin (nom, téléphone, WhatsApp, email, ville, activité…)
//                       avec un bouton « Voir la demande » ;
//                     → accusé de réception au demandeur.
// action "decision" : appelée par l'admin après validation / refus / suspension.
//                     → email au demandeur avec la décision.
// action "ping"     : admin uniquement. Envoie un email de test à ADMIN_EMAIL et renvoie
//                     la réponse exacte de Brevo (pour diagnostiquer les emails).
//
// Secrets (les mêmes que delivery-application) : BREVO_API_KEY, SENDER_EMAIL, ADMIN_EMAIL, SITE_URL.
// Déploiement : Supabase → Edge Functions → Deploy a new function → Via Editor,
// nom « vendor-application », puis Settings → « Verify JWT with legacy secret » désactivé.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Renvoie la réponse de Brevo ({ messageId }) ; lève une erreur lisible sinon
async function sendEmail(to, subject, html) {
    const apiKey = Deno.env.get('BREVO_API_KEY');
    const sender = Deno.env.get('SENDER_EMAIL');
    if (!apiKey || !sender) throw new Error('BREVO_API_KEY ou SENDER_EMAIL manquant dans les secrets');
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender: { name: 'Ouenze', email: sender }, to: [{ email: to }], subject, htmlContent: html })
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Brevo ${res.status} : ${text}`);
    try { return JSON.parse(text); } catch { return { raw: text }; }
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
    if (!value) return '';
    return `<tr><td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;color:#64748b;width:38%;">${esc(label)}</td>
<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-weight:bold;">${value}</td></tr>`;
}

function button(href, label, color = '#1e40af') {
    return `<div style="text-align:center;margin:20px 0 6px;"><a href="${esc(href)}" style="background:${color};color:#fff;text-decoration:none;padding:13px 24px;border-radius:30px;font-weight:bold;display:inline-block;">${esc(label)}</a></div>`;
}

const digits = phone => String(phone || '').replace(/[^\d+]/g, '');

Deno.serve(async req => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const siteUrl = (Deno.env.get('SITE_URL') || '').replace(/\/$/, '');
    const adminEmail = Deno.env.get('ADMIN_EMAIL');
    if (!url || !anonKey || !serviceKey || !siteUrl || !adminEmail) {
        return json({ error: 'Configuration incomplète de la fonction (secrets SITE_URL / ADMIN_EMAIL ?)' }, 500);
    }

    const authHeader = req.headers.get('Authorization') || '';
    const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'Connexion requise' }, 401);

    let payload;
    try { payload = await req.json(); } catch { return json({ error: 'Requête invalide' }, 400); }
    const { action, application_id: applicationId } = payload || {};
    if (!['notify', 'decision', 'ping'].includes(action)) return json({ error: 'Paramètres invalides' }, 400);

    const admin = createClient(url, serviceKey);
    const isAdmin = async () => !!(await admin.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()).data;

    try {
        // ---------- Test des emails (admin) ----------
        if (action === 'ping') {
            if (!(await isAdmin())) return json({ error: 'Accès refusé' }, 403);
            const brevo = await sendEmail(adminEmail, 'Ouenze : test d\'envoi des emails ✅', layout('Les emails fonctionnent ✅',
                `<p>Si tu lis ce message, Brevo accepte et livre les emails d'Ouenze.</p>
                 <p style="color:#64748b;font-size:13px;">Expéditeur : ${esc(Deno.env.get('SENDER_EMAIL'))}<br>Destinataire (ADMIN_EMAIL) : ${esc(adminEmail)}</p>`));
            return json({ ok: true, to: adminEmail, sender: Deno.env.get('SENDER_EMAIL'), brevo });
        }

        if (!applicationId) return json({ error: 'Paramètres invalides' }, 400);
        const { data: app, error } = await admin.from('vendor_applications').select('*').eq('id', applicationId).maybeSingle();
        if (error || !app) return json({ error: 'Demande introuvable' }, 404);

        // ---------- Nouvelle demande → admin + accusé de réception ----------
        if (action === 'notify') {
            if (app.user_id !== user.id) return json({ error: 'Accès refusé' }, 403);
            if (app.status !== 'pending') return json({ error: 'Demande déjà traitée' }, 409);
            if (app.notified_at && Date.now() - Date.parse(app.notified_at) < 10 * 60 * 1000) {
                return json({ error: 'Demande déjà envoyée, patiente quelques minutes' }, 429);
            }
            const tel = digits(app.phone);
            const wa = digits(app.whatsapp || app.phone).replace(/^\+/, '');
            const adminHtml = layout('🏪 Nouvelle demande vendeur', `
<p style="margin:0 0 16px;"><strong>${esc(app.full_name)}</strong> souhaite vendre sur Ouenze. Contacte cette personne, puis valide ou refuse la demande.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:12px;">
  ${row('Nom', esc(app.full_name))}
  ${row('Téléphone', `<a href="https://wa.me/${esc(tel.replace(/\D/g, '').replace(/^0(\d{8})$/, '2420$1'))}">${esc(app.phone)}</a> (WhatsApp)`)}
  ${row('WhatsApp', app.whatsapp ? `<a href="https://wa.me/${esc(wa)}">${esc(app.whatsapp)}</a>` : '')}
  ${row('Email', `<a href="mailto:${esc(app.email)}">${esc(app.email)}</a>`)}
  ${row('Ville', esc([app.district, app.city].filter(Boolean).join(', ')))}
  ${row('Activité', esc(app.business_name))}
  ${row('Produits', esc(app.category))}
  ${row('Boutique physique', app.has_physical_store ? 'Oui' : 'Non')}
  ${row('Réseaux / site', app.social_link ? `<a href="${esc(app.social_link)}">${esc(app.social_link)}</a>` : '')}
  ${row('Reçue le', esc(new Date(app.created_at).toLocaleString('fr-FR', { timeZone: 'Africa/Brazzaville' })))}
</table>
${app.description ? `<p style="background:#f1f5f9;border-radius:10px;padding:12px;font-size:14px;margin:0 0 8px;">${esc(app.description)}</p>` : ''}
${button(`${siteUrl}/admin-vendors.html?id=${encodeURIComponent(app.id)}`, 'Voir la demande et décider', '#16a34a')}`);
            await sendEmail(adminEmail, `🏪 Demande vendeur : ${app.business_name} (${app.full_name}, ${app.phone})`, adminHtml);
            await admin.from('vendor_applications').update({ notified_at: new Date().toISOString() }).eq('id', app.id);
            await sendEmail(app.email, 'Ouenze : demande vendeur reçue', layout('Demande reçue ✅', `
<p>Bonjour ${esc(app.full_name)},</p>
<p>Nous avons bien reçu ta demande pour vendre sur Ouenze avec <strong>${esc(app.business_name)}</strong>.</p>
<p>Notre équipe va te contacter au <strong>${esc(app.phone)}</strong> pour faire connaissance. Tu recevras un email dès que ton compte vendeur sera validé.</p>`));
            return json({ ok: true });
        }

        // ---------- Décision (admin) ----------
        if (!(await isAdmin())) return json({ error: 'Accès refusé' }, 403);
        if (app.status === 'approved') {
            await sendEmail(app.email, 'Ouenze : ton compte vendeur est validé 🎉', layout('Bienvenue chez les vendeurs Ouenze ! 🎉', `
<p>Bonjour ${esc(app.full_name)},</p>
<p>Ta demande est <strong>validée</strong>. Tu peux maintenant créer ta boutique, ajouter tes produits et recevoir tes premières commandes.</p>
${button(`${siteUrl}/shop-designer.html`, 'Créer ma boutique')}`));
        } else if (app.status === 'rejected') {
            await sendEmail(app.email, 'Ouenze : ta demande vendeur', layout('Demande non retenue', `
<p>Bonjour ${esc(app.full_name)},</p>
<p>Nous ne pouvons pas valider ta demande vendeur pour le moment.</p>
${app.review_note ? `<p><strong>Motif :</strong> ${esc(app.review_note)}</p>` : ''}
<p>Tu peux compléter ta demande et la renvoyer depuis la page « Devenir vendeur ».</p>
${button(`${siteUrl}/vendor-register.html`, 'Compléter ma demande')}`));
        } else if (app.status === 'suspended') {
            await sendEmail(app.email, 'Ouenze : compte vendeur suspendu', layout('Compte vendeur suspendu', `
<p>Bonjour ${esc(app.full_name)},</p>
<p>Ton compte vendeur est suspendu : tes boutiques ne sont plus visibles sur Ouenze.</p>
${app.review_note ? `<p><strong>Motif :</strong> ${esc(app.review_note)}</p>` : ''}
<p>Contacte Ouenze pour en parler.</p>`));
        } else {
            return json({ error: 'Aucune décision enregistrée' }, 409);
        }
        return json({ ok: true });
    } catch (e) {
        console.error(e);
        return json({ error: 'Envoi de l\'email impossible', detail: String(e?.message || e) }, 502);
    }
});
