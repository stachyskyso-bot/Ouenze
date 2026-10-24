-- ============================================================
-- Recherche admin et fiches complètes (admin-search.html)
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261016 (avis), 20261019 (livreurs), 20261028 (signalements),
--             20261030 (équipe), 20261031 (trade), 20261101 (paiements), 20261104 (boutiques).
--
-- admin_search(q)      : une seule barre pour trouver une personne (client, vendeur, livreur),
--                        une boutique ou une commande (numéro, code de remise, référence de paiement).
-- admin_person(id)     : tout sur une personne (profil, chiffre d'affaires, croissance, commandes…).
-- admin_order(id)      : tout sur une commande (articles, acteurs, paiement, historique).
-- Lecture seule, réservé aux administrateurs. Le code de remise lui-même n'est jamais affiché.
-- ============================================================

-- ---------- Recherche ----------
create or replace function public.admin_search(q text)
returns table (kind text, id uuid, title text, subtitle text, badge text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    term text := btrim(coalesce(q, ''));
    digits text := regexp_replace(coalesce(q, ''), '\D', '', 'g');
    like_term text;
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    if char_length(term) < 2 then return; end if;
    like_term := '%' || replace(replace(term, '%', ''), '_', '') || '%';

    return query
    -- Commandes : numéro, code de remise (exact), référence de paiement ou transaction
    (select 'order'::text, o.id, o.order_number::text,
            coalesce((select s.name::text from public.order_items oi join public.shops s on s.id = oi.shop_id where oi.order_id = o.id limit 1), '')
              || ' · ' || public.account_label(o.client_id) || ' · ' || public.fcfa(o.total),
            o.status::text, o.created_at
       from public.orders o
      where o.order_number ilike like_term
         or o.id::text = term
         or coalesce(o.delivery_info->>'payment_ref', '') ilike like_term
         or exists (select 1 from public.delivery_codes dc where dc.order_id = o.id and dc.code = term)
         or exists (select 1 from public.payment_transactions t where t.order_id = o.id
                     and (t.transaction_id ilike like_term or coalesce(t.provider_ref, '') ilike like_term))
      order by o.created_at desc limit 15)
    union all
    -- Personnes : nom, email, téléphone, plaque du véhicule (livreurs)
    (select 'person'::text, u.id, public.account_label(u.id),
            concat_ws(' · ', nullif(u.email, ''), coalesce(u.raw_user_meta_data->>'phone', case when u.phone <> '' then '+' || u.phone end), da.plate_number),
            concat_ws(', ',
                case when exists (select 1 from public.admin_users a where a.user_id = u.id) then 'admin' end,
                case when exists (select 1 from public.shops s where s.owner_id = u.id) or p.user_type = 'vendeur' then 'vendeur' end,
                case when da.status = 'approved' then 'livreur' when da.status = 'pending' then 'livreur (en attente)' end,
                case when exists (select 1 from public.orders o where o.client_id = u.id) then 'client' end),
            u.created_at
       from auth.users u
       left join public.profiles p on p.id = u.id
       left join public.delivery_applications da on da.user_id = u.id
      where coalesce(u.raw_user_meta_data->>'full_name', '') ilike like_term
         or coalesce(p.full_name, '') ilike like_term
         or coalesce(u.email, '') ilike like_term
         or coalesce(da.full_name, '') ilike like_term
         or coalesce(da.plate_number, '') ilike like_term
         or (char_length(digits) >= 4 and (
               regexp_replace(coalesce(u.raw_user_meta_data->>'phone', ''), '\D', '', 'g') like '%' || digits || '%'
            or coalesce(u.phone, '') like '%' || digits || '%'
            or regexp_replace(coalesce(da.phone, ''), '\D', '', 'g') like '%' || digits || '%'))
      order by u.created_at desc limit 15)
    union all
    -- Boutiques
    (select 'shop'::text, s.id, s.name::text,
            concat_ws(' · ', nullif(concat_ws(', ', s.district, s.city), ''), public.account_label(s.owner_id)),
            case when s.archived_at is not null then 'supprimée' when s.suspended_at is not null then 'suspendue' else 'active' end,
            s.created_at
       from public.shops s
      where s.name ilike like_term or coalesce(s.city, '') ilike like_term
      order by s.created_at desc limit 10);
end;
$$;
revoke all on function public.admin_search(text) from public, anon;
grant execute on function public.admin_search(text) to authenticated;

-- ---------- Série mensuelle (6 derniers mois) ----------
create or replace function public.admin_months()
returns table (m date)
language sql
stable
as $$
    select generate_series(date_trunc('month', now())::date - interval '5 months', date_trunc('month', now())::date, interval '1 month')::date;
$$;

-- ---------- Fiche d'une personne ----------
create or replace function public.admin_person(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    u record;
    p record;
    da record;
    r jsonb;
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    select * into u from auth.users where id = target;
    if u.id is null then raise exception 'Compte introuvable'; end if;
    select * into p from public.profiles where id = target;
    select * into da from public.delivery_applications where user_id = target;

    r := jsonb_build_object(
        'account', jsonb_build_object(
            'id', u.id, 'name', public.account_label(u.id), 'email', u.email,
            'phone', coalesce(u.raw_user_meta_data->>'phone', case when u.phone <> '' then '+' || u.phone end),
            'city', coalesce(u.raw_user_meta_data->>'city', to_jsonb(p)->>'city'), 'country', u.raw_user_meta_data->>'country',
            'provider', coalesce(u.raw_app_meta_data->>'provider', 'email'),
            'created_at', u.created_at, 'last_login', u.last_sign_in_at, 'user_type', to_jsonb(p)->>'user_type',
            'is_admin', exists (select 1 from public.admin_users a where a.user_id = u.id),
            'is_agent', exists (select 1 from public.team_members t where t.user_id = u.id),
            'vendor_status', (select status from public.vendor_applications v where v.user_id = u.id),
            'courier_status', da.status),

        -- Client : ce qu'il a commandé
        'client', (select jsonb_build_object(
            'orders', count(*),
            'delivered', count(*) filter (where o.status = 'delivered'),
            'cancelled', count(*) filter (where o.status in ('cancelled', 'refused', 'refunded')),
            'spent', coalesce(sum(o.total) filter (where o.status = 'delivered'), 0),
            'unpaid', count(*) filter (where o.status = 'delivered' and o.payment_status = 'cod'),
            'avg_basket', coalesce(round(avg(o.total) filter (where o.status = 'delivered')), 0),
            'last_order_at', max(o.created_at),
            'monthly', (select jsonb_agg(jsonb_build_object('month', mm.m, 'value',
                    coalesce((select sum(x.total) from public.orders x where x.client_id = target and x.status = 'delivered'
                               and coalesce(x.payment_status, '') <> 'test' and date_trunc('month', x.created_at)::date = mm.m), 0)) order by mm.m)
                from public.admin_months() mm))
            from public.orders o where o.client_id = target and coalesce(o.payment_status, '') <> 'test'),
        'client_orders', coalesce((select jsonb_agg(x order by x.created_at desc) from (
            select o.id, o.order_number, o.created_at, o.status, o.payment_status, o.total,
                   (select s.name from public.order_items oi join public.shops s on s.id = oi.shop_id where oi.order_id = o.id limit 1) as shop
              from public.orders o where o.client_id = target order by o.created_at desc limit 20) x), '[]'::jsonb),

        -- Vendeur : ses boutiques et leur chiffre d'affaires
        'shops', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'city', s.city,
                'status', case when s.archived_at is not null then 'supprimée' when s.suspended_at is not null then 'suspendue' else 'active' end,
                'rating', s.rating, 'stats', public.admin_shop_stats(s.id)) order by s.created_at)
            from public.shops s where s.owner_id = target), '[]'::jsonb),
        'vendor_monthly', (select jsonb_agg(jsonb_build_object('month', mm.m, 'value',
                coalesce((select sum(oi.total_price) from public.order_items oi join public.orders o on o.id = oi.order_id
                           join public.shops s on s.id = oi.shop_id
                          where s.owner_id = target and o.status = 'delivered' and coalesce(o.payment_status, '') <> 'test'
                            and date_trunc('month', o.created_at)::date = mm.m), 0)) order by mm.m)
            from public.admin_months() mm),

        -- Livreur : ses courses et ses gains
        'courier', case when da.id is null then null else jsonb_build_object(
            'full_name', da.full_name, 'phone', da.phone, 'city', da.city, 'district', da.district,
            'vehicle', da.vehicle_type, 'brand', da.vehicle_brand, 'plate', da.plate_number,
            'license_expiry', da.license_expiry, 'status', da.status, 'since', da.reviewed_at,
            'deliveries', (select count(*) from public.orders o where o.deliverer_id = target and o.status = 'delivered' and coalesce(o.payment_status, '') <> 'test'),
            'in_progress', (select count(*) from public.orders o where o.deliverer_id = target and o.status in ('courier_assigned', 'picked_up', 'in_transit')),
            'earnings', (select coalesce(sum(o.delivery_fees), 0) from public.orders o where o.deliverer_id = target and o.status = 'delivered' and coalesce(o.payment_status, '') <> 'test'),
            'last_delivery_at', (select max(o.updated_at) from public.orders o where o.deliverer_id = target and o.status = 'delivered'),
            'rating', (select round(avg(stars), 1) from public.courier_reviews cr where cr.courier_id = target),
            'reviews', (select count(*) from public.courier_reviews cr where cr.courier_id = target),
            'online', (select online and updated_at > now() - interval '15 minutes' from public.courier_presence cp where cp.courier_id = target),
            'monthly', (select jsonb_agg(jsonb_build_object('month', mm.m, 'value',
                    (select count(*) from public.orders x where x.deliverer_id = target and x.status = 'delivered'
                      and coalesce(x.payment_status, '') <> 'test' and date_trunc('month', x.updated_at)::date = mm.m)) order by mm.m)
                from public.admin_months() mm),
            'recent', coalesce((select jsonb_agg(x order by x.updated_at desc) from (
                select o.id, o.order_number, o.updated_at, o.status, o.delivery_fees from public.orders o
                 where o.deliverer_id = target order by o.updated_at desc limit 10) x), '[]'::jsonb)) end,

        -- Signalements, avis, Trade
        'reports_made', (select count(*) from public.reports r where r.reporter_id = target),
        'reports_against', (select count(*) from public.reports r
                             where r.courier_id = target or r.shop_id in (select s.id from public.shops s where s.owner_id = target)),
        'reviews_written', (select count(*) from public.shop_reviews sr where sr.client_id = target),
        'trade', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0))
                    from public.trade_pledges tp where tp.investor_id = target and tp.status in ('active', 'released'))
    );
    return r;
end;
$$;
revoke all on function public.admin_person(uuid) from public, anon;
grant execute on function public.admin_person(uuid) to authenticated;

-- ---------- Fiche d'une commande ----------
create or replace function public.admin_order(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    o public.orders;
    s record;
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    select * into o from public.orders where id = target;
    if o.id is null then raise exception 'Commande introuvable'; end if;
    select * into s from public.order_shop(o.id);
    return jsonb_build_object(
        'order', jsonb_build_object('id', o.id, 'order_number', o.order_number, 'created_at', o.created_at, 'updated_at', o.updated_at,
            'status', o.status, 'payment_status', o.payment_status, 'payment_method', o.payment_method,
            'subtotal', o.subtotal, 'delivery_fees', o.delivery_fees, 'total', o.total, 'notes', o.notes,
            'delivery', o.delivery_info - 'notified'),
        'items', coalesce((select jsonb_agg(jsonb_build_object('name', oi.product_name, 'variant', oi.variant_name,
                'quantity', oi.quantity, 'unit_price', oi.unit_price, 'total', oi.total_price))
            from public.order_items oi where oi.order_id = o.id), '[]'::jsonb),
        'shop', jsonb_build_object('id', s.shop_id, 'name', s.shop_name, 'owner_id', s.owner_id, 'owner', public.account_label(s.owner_id),
            'owner_phone', (select coalesce(raw_user_meta_data->>'phone', case when phone <> '' then '+' || phone end) from auth.users where id = s.owner_id)),
        'client', jsonb_build_object('id', o.client_id, 'name', public.account_label(o.client_id)),
        'courier', case when o.deliverer_id is null then null else jsonb_build_object('id', o.deliverer_id, 'name', public.account_label(o.deliverer_id),
            'phone', (select phone from public.delivery_applications where user_id = o.deliverer_id)) end,
        -- Jamais le code lui-même : seulement combien de fois il a été envoyé et essayé
        'code', (select jsonb_build_object('sends', to_jsonb(dc)->'sends', 'sent_at', to_jsonb(dc)->'sent_at', 'attempts', dc.attempts)
                   from public.delivery_codes dc where dc.order_id = o.id),
        'payments', coalesce((select jsonb_agg(jsonb_build_object('transaction_id', t.transaction_id, 'channel', t.channel, 'provider', t.provider,
                'status', t.status, 'amount', t.amount, 'provider_ref', t.provider_ref, 'created_at', t.created_at, 'paid_at', t.paid_at) order by t.created_at desc)
            from public.payment_transactions t where t.order_id = o.id), '[]'::jsonb),
        'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'details', e.details, 'created_at', e.created_at,
                'actor', coalesce(public.account_label(e.actor_id), 'Système')) order by e.created_at desc)
            from public.order_events e where e.order_id = o.id), '[]'::jsonb),
        'reviews', jsonb_build_object(
            'shop', (select jsonb_build_object('stars', sr.stars, 'comment', sr.comment) from public.shop_reviews sr where sr.order_id = o.id limit 1),
            'courier', (select jsonb_build_object('stars', cr.stars, 'comment', cr.comment) from public.courier_reviews cr where cr.order_id = o.id limit 1)),
        'reports', (select count(*) from public.reports r where r.order_id = o.id)
    );
end;
$$;
revoke all on function public.admin_order(uuid) from public, anon;
grant execute on function public.admin_order(uuid) to authenticated;

notify pgrst, 'reload schema';
