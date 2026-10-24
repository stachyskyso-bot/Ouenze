-- ============================================================
-- Paiements CinetPay (Mobile Money et carte) — commandes payées à la livraison
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261030_team_space.sql (is_team, log_order_event).
--
-- Parcours :
--   • Mobile Money : le livreur valide le code de remise → une demande de paiement part
--     au client (lien par SMS + bouton dans « Mes commandes ») → il choisit son réseau,
--     reçoit la demande sur son téléphone et tape son code secret.
--   • Carte bancaire : l'équipe envoie le lien de paiement pendant l'appel.
-- Une commande n'est marquée « payée » qu'après VÉRIFICATION auprès de CinetPay
-- (Edge Functions « payment » et « payment-notify »), jamais sur la seule parole du navigateur.
-- Sans clés CinetPay, tout fonctionne en simulation (provider = 'simulation').
-- ============================================================

create table if not exists public.payment_transactions (
    id uuid primary key default gen_random_uuid(),
    transaction_id text not null unique,            -- identifiant envoyé à CinetPay (imprévisible)
    order_id uuid not null references public.orders (id) on delete cascade,
    amount numeric not null check (amount > 0),
    currency text not null default 'XAF',
    channel text not null check (channel in ('MOBILE_MONEY', 'CREDIT_CARD')),
    phone text,
    provider text not null default 'cinetpay' check (provider in ('cinetpay', 'simulation')),
    status text not null default 'created' check (status in ('created', 'pending', 'accepted', 'refused', 'cancelled')),
    payment_url text,
    provider_ref text,
    provider_data jsonb,
    created_by uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    paid_at timestamptz
);
alter table public.payment_transactions enable row level security;   -- aucune lecture directe
create index if not exists payment_transactions_order on public.payment_transactions (order_id, created_at desc);

-- ---------- Préparer une demande de paiement (appelée avec le compte de l'utilisateur) ----------
-- Qui : le client de la commande, son livreur, ou l'équipe.
-- Mobile Money : après la livraison (code validé). Carte : à tout moment avant la fin.
-- Réutilise une demande encore valable (moins de 30 minutes) au lieu d'en créer une autre.
create or replace function public.payment_prepare(target_order uuid, wanted_channel text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    o record;
    ch text;
    t public.payment_transactions;
    amt numeric;
begin
    if auth.uid() is null then raise exception 'Connecte-toi' using errcode = '42501'; end if;
    select id, order_number, client_id, deliverer_id, status, payment_status, payment_method, total, delivery_info
      into o from public.orders where id = target_order for update;
    if o.id is null then raise exception 'Commande introuvable'; end if;
    if auth.uid() is distinct from o.client_id and auth.uid() is distinct from o.deliverer_id and not public.is_team() then
        raise exception 'Accès refusé' using errcode = '42501';
    end if;
    if o.payment_status = 'paid' then raise exception 'Cette commande est déjà payée'; end if;
    if o.payment_status = 'test' then raise exception 'Commande de test : rien à payer'; end if;
    if o.status in ('cancelled', 'refused', 'refunded') then raise exception 'Commande annulée : rien à payer'; end if;
    if coalesce(o.delivery_info->>'country_code', 'CG') <> 'CG' then
        raise exception 'Le paiement en ligne n''est pas encore disponible en RDC : le livreur encaisse directement.';
    end if;
    if o.payment_method = 'paypal' then raise exception 'PayPal : Ouenze t''envoie le lien de paiement séparément.'; end if;

    ch := coalesce(wanted_channel, case when o.payment_method = 'card' then 'CREDIT_CARD' else 'MOBILE_MONEY' end);
    if ch not in ('MOBILE_MONEY', 'CREDIT_CARD') then raise exception 'Moyen de paiement inconnu'; end if;
    if ch = 'MOBILE_MONEY' and o.status <> 'delivered' and not public.is_team() then
        raise exception 'Le paiement Mobile Money se fait à la livraison, après le code de remise.';
    end if;

    select * into t from public.payment_transactions
     where order_id = o.id and channel = ch and status in ('created', 'pending')
       and payment_url is not null and created_at > now() - interval '30 minutes'
     order by created_at desc limit 1;
    if t.id is not null then
        return jsonb_build_object('reuse', true, 'transaction_id', t.transaction_id, 'payment_url', t.payment_url,
            'amount', t.amount, 'currency', t.currency, 'channel', t.channel, 'phone', t.phone,
            'order_number', o.order_number, 'provider', t.provider);
    end if;

    -- CinetPay demande un montant multiple de 5 : on arrondit au multiple de 5 inférieur (au profit du client)
    amt := floor(o.total / 5) * 5;
    if amt < 100 then raise exception 'Montant trop faible pour un paiement en ligne'; end if;
    insert into public.payment_transactions (transaction_id, order_id, amount, currency, channel, phone, created_by)
    values ('OZ' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 18)), o.id, amt, 'XAF', ch,
            coalesce(o.delivery_info->>'payment_phone', o.delivery_info->>'phone'), auth.uid())
    returning * into t;
    return jsonb_build_object('reuse', false, 'transaction_id', t.transaction_id, 'amount', t.amount, 'currency', t.currency,
        'channel', t.channel, 'phone', t.phone, 'order_number', o.order_number,
        'client_name', public.account_label(o.client_id));
end;
$$;
revoke all on function public.payment_prepare(uuid, text) from public, anon;
grant execute on function public.payment_prepare(uuid, text) to authenticated;

-- ---------- Réservé au serveur (clé service_role) ----------
create or replace function public.payment_attach(tx text, new_provider text, url text, info jsonb default null)
returns void
language sql
security definer
set search_path = public
as $$
    update public.payment_transactions
       set provider = new_provider, payment_url = url, status = 'pending', provider_data = coalesce(info, provider_data), updated_at = now()
     where transaction_id = tx and status = 'created';
$$;
revoke all on function public.payment_attach(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.payment_attach(text, text, text, jsonb) to service_role;

-- Paiement vérifié auprès de CinetPay (ou simulation par l'équipe) → commande payée
create or replace function public.payment_settle(tx text, accepted boolean, ref text default null, info jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    t public.payment_transactions;
    o record;
    a record;
begin
    select * into t from public.payment_transactions where transaction_id = tx for update;
    if t.id is null then raise exception 'Transaction inconnue'; end if;
    if t.status = 'accepted' then return jsonb_build_object('status', 'accepted', 'already', true); end if;
    if not accepted then
        update public.payment_transactions set status = 'refused', provider_data = coalesce(info, provider_data), updated_at = now()
         where id = t.id and status in ('created', 'pending');
        return jsonb_build_object('status', 'refused');
    end if;
    update public.payment_transactions
       set status = 'accepted', provider_ref = left(ref, 100), provider_data = coalesce(info, provider_data), paid_at = now(), updated_at = now()
     where id = t.id;
    select id, order_number, client_id, payment_status into o from public.orders where id = t.order_id for update;
    if o.payment_status <> 'paid' then
        update public.orders
           set payment_status = 'paid',
               delivery_info = delivery_info || jsonb_build_object('payment_ref', coalesce(left(ref, 100), t.transaction_id),
                   'paid_at', now(), 'payment_provider', t.provider, 'payment_channel', t.channel),
               updated_at = now()
         where id = o.id;
        insert into public.order_events (order_id, actor_id, action, details)
        values (o.id, null, 'paid', (case when t.provider = 'simulation' then 'SIMULATION · ' else 'CinetPay · ' end)
                || case t.channel when 'CREDIT_CARD' then 'carte' else 'Mobile Money' end || ' · ' || public.fcfa(t.amount)
                || coalesce(' · réf. ' || ref, ''));
        perform public.notify_user(o.client_id, 'order_paid', 'Paiement reçu pour ' || o.order_number,
            'Merci ! Ton paiement de ' || public.fcfa(t.amount) || ' est confirmé.', o.id, null);
        for a in select user_id from public.admin_users union select user_id from public.team_members loop
            perform public.notify_user(a.user_id, 'order_paid', 'Commande ' || o.order_number || ' payée',
                public.fcfa(t.amount) || ' · ' || case t.channel when 'CREDIT_CARD' then 'carte bancaire' else 'Mobile Money' end
                || case when t.provider = 'simulation' then ' (simulation)' else '' end, o.id, null);
        end loop;
    end if;
    return jsonb_build_object('status', 'accepted', 'order_number', o.order_number);
end;
$$;
revoke all on function public.payment_settle(text, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.payment_settle(text, boolean, text, jsonb) to service_role;

-- ---------- Page de paiement (lien envoyé par SMS) : lecture par l'identifiant imprévisible ----------
create or replace function public.payment_public(tx text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object('transaction_id', t.transaction_id, 'amount', t.amount, 'currency', t.currency,
               'channel', t.channel, 'status', t.status, 'provider', t.provider, 'payment_url', t.payment_url,
               'order_number', o.order_number, 'order_paid', o.payment_status = 'paid', 'created_at', t.created_at,
               'shop_name', (select s.name from public.order_items oi join public.shops s on s.id = oi.shop_id where oi.order_id = o.id limit 1))
      from public.payment_transactions t
      join public.orders o on o.id = t.order_id
     where t.transaction_id = tx and length(tx) >= 12;
$$;
revoke all on function public.payment_public(text) from public;
grant execute on function public.payment_public(text) to anon, authenticated;

notify pgrst, 'reload schema';
