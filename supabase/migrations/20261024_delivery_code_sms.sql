-- ============================================================
-- Code de remise envoyé au client par SMS et WhatsApp
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261019 (livreurs, table delivery_codes).
--
-- L'Edge Function « delivery-code » lit le code (clé service_role) et l'envoie au téléphone
-- de livraison du client. Le livreur déclenche l'envoi mais ne voit jamais le code.
-- Au plus 3 envois par commande (coût des SMS / WhatsApp).
-- ============================================================

alter table public.delivery_codes add column if not exists sends integer not null default 0;
alter table public.delivery_codes add column if not exists sent_at timestamptz;
alter table public.delivery_codes add column if not exists sent_channels text;

notify pgrst, 'reload schema';
