-- ============================================================
-- Livreurs : niveaux, zone, courses, code de remise
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261011 (candidatures), 20261016 (notes), 20261017 (commandes), 20261018 (notifications).
--
-- Principe : n'importe qui ne livre pas n'importe quoi.
--   • Seuls les livreurs VALIDÉS par un admin (delivery_applications.status = 'approved') livrent.
--   • Score = livraisons réussies × note / 5. La note est « lissée » (3 avis fictifs à 3,5 ★)
--     pour qu'un seul 5 ★ ne suffise pas : il faut des livraisons ET des étoiles.
--   • Niveau ★1 à ★5 : plus le niveau est haut, plus la zone est grande et plus la commande
--     peut valoir cher. Les vrais 5 étoiles : 30 livraisons et une note ≥ 4,5.
--       ★1 Nouveau   : score < 5                      → 3 km  · commandes ≤ 30 000 FCFA
--       ★2 Confirmé  : score ≥ 5                      → 5 km  · ≤ 75 000 FCFA
--       ★3 Expert    : score ≥ 10                     → 8 km  · ≤ 150 000 FCFA
--       ★4 Élite     : score ≥ 15 et note ≥ 4         → 15 km · ≤ 400 000 FCFA
--       ★5 5 étoiles : 30 livraisons et note ≥ 4,5    → toute la ville (30 km), sans plafond (téléphones, TV…)
--     Suspendu       : note réelle < 2,5 avec au moins 5 avis → plus aucune course.
--   • Un admin peut accorder un niveau de départ à un livreur de confiance (admin_grant_courier_level) :
--     c'est un plancher, la suspension pour mauvaise note reste prioritaire.
--   • Zone : distance entre la position du livreur (bouton « Je suis disponible ») et la boutique
--     (position enregistrée par le vendeur ; à défaut, le point de livraison).
--   • Le client reçoit un CODE à 4 chiffres : le livreur doit le saisir pour marquer « livrée ».
-- ============================================================

-- ---------- Position des boutiques (point de retrait) ----------
alter table public.shops add column if not exists lat numeric;
alter table public.shops add column if not exists district text;
alter table public.shops add column if not exists address text;
alter table public.shops add column if not exists lng numeric;

create or replace function public.set_shop_location(target_shop uuid, new_lat numeric, new_lng numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if new_lat is null or new_lng is null or abs(new_lat) > 90 or abs(new_lng) > 180 then
        raise exception 'Position invalide';
    end if;
    update public.shops set lat = round(new_lat, 6), lng = round(new_lng, 6)
     where id = target_shop and owner_id = auth.uid();
    if not found then raise exception 'Boutique introuvable' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.set_shop_location(uuid, numeric, numeric) from public;
grant execute on function public.set_shop_location(uuid, numeric, numeric) to authenticated;

create or replace function public.my_shop_locations()
returns table (shop_id uuid, lat numeric, lng numeric)
language sql
stable
security definer
set search_path = public
as $$
    select id, lat, lng from public.shops where owner_id = auth.uid();
$$;
revoke all on function public.my_shop_locations() from public;
grant execute on function public.my_shop_locations() to authenticated;

-- ---------- Outils ----------
create or replace function public.distance_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns numeric
language sql
immutable
as $$
    select case when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null else
        round((6371 * 2 * asin(sqrt(
            power(sin(radians((lat2 - lat1)::float8) / 2), 2)
            + cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lng2 - lng1)::float8) / 2), 2)
        )))::numeric, 2) end;
$$;

create or replace function public.is_courier(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (select 1 from public.delivery_applications where user_id = target and status = 'approved');
$$;
revoke all on function public.is_courier(uuid) from public, anon;
grant execute on function public.is_courier(uuid) to authenticated;

-- ---------- Niveau d'un livreur ----------
-- Droits de chaque niveau
create or replace function public.courier_level_info(lvl integer, out name text, out radius_km numeric, out max_amount numeric)
language sql
immutable
as $$
    select case lvl when 5 then '5 étoiles' when 4 then 'Élite' when 3 then 'Expert' when 2 then 'Confirmé' when 1 then 'Nouveau' else 'Suspendu' end,
           case lvl when 5 then 30 when 4 then 15 when 3 then 8 when 2 then 5 when 1 then 3 else 0 end,
           case lvl when 5 then null when 4 then 400000 when 3 then 150000 when 2 then 75000 when 1 then 30000 else 0 end;
$$;
grant execute on function public.courier_level_info(integer) to anon, authenticated;

-- granted : niveau de départ accordé par un admin (livreur de confiance) ; plancher, sauf suspension
create or replace function public.courier_level(deliveries integer, smooth_rating numeric, raw_rating numeric, reviews integer,
    granted integer default null,
    out level integer, out name text, out radius_km numeric, out max_amount numeric, out score numeric)
language plpgsql
immutable
as $$
begin
    score := round(coalesce(deliveries, 0) * coalesce(smooth_rating, 3.5) / 5, 1);
    if coalesce(reviews, 0) >= 5 and coalesce(raw_rating, 0) < 2.5 then
        level := 0;
    elsif coalesce(deliveries, 0) >= 30 and coalesce(smooth_rating, 0) >= 4.5 then
        level := 5;
    elsif score >= 15 and coalesce(smooth_rating, 0) >= 4 then
        level := 4;
    elsif score >= 10 then
        level := 3;
    elsif score >= 5 then
        level := 2;
    else
        level := 1;
    end if;
    if level > 0 and coalesce(granted, 0) > level then level := least(granted, 5); end if;
    select i.name, i.radius_km, i.max_amount into name, radius_km, max_amount from public.courier_level_info(level) i;
end;
$$;
drop function if exists public.courier_level(integer, numeric, numeric, integer);
grant execute on function public.courier_level(integer, numeric, numeric, integer, integer) to anon, authenticated;

alter table public.delivery_applications add column if not exists granted_level smallint
    check (granted_level between 1 and 5);

-- L'admin accorde (ou retire avec null) un niveau de départ
create or replace function public.admin_grant_courier_level(target_email text, lvl integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is not null and not public.is_admin() then
        raise exception 'Réservé aux administrateurs' using errcode = '42501';
    end if;
    if lvl is not null and lvl not between 1 and 5 then raise exception 'Niveau de 1 à 5'; end if;
    update public.delivery_applications set granted_level = lvl
     where lower(email) = lower(btrim(target_email)) and status = 'approved';
    if not found then raise exception 'Aucun livreur validé avec l''email %', target_email; end if;
    return 'Niveau de départ : ' || coalesce(lvl::text, 'aucun');
end;
$$;
revoke all on function public.admin_grant_courier_level(text, integer) from public, anon;
grant execute on function public.admin_grant_courier_level(text, integer) to authenticated;

-- Statistiques + niveau (la note lissée compte 3 avis fictifs à 3,5 ★)
drop function if exists public.courier_card(uuid);
create or replace function public.courier_card(target uuid)
returns table (deliveries integer, reviews integer, rating numeric, smooth_rating numeric,
               level integer, level_name text, radius_km numeric, max_amount numeric, score numeric, granted integer)
language sql
stable
security definer
set search_path = public
as $$
    with d as (select count(*)::integer n from public.orders where deliverer_id = target and status = 'delivered'),
         r as (select count(*)::integer n, coalesce(sum(stars), 0) s from public.courier_reviews where courier_id = target),
         g as (select max(granted_level)::integer lvl from public.delivery_applications where user_id = target and status = 'approved')
    select d.n, r.n,
           case when r.n > 0 then round(r.s::numeric / r.n, 2) else 0 end,
           round((r.s + 3 * 3.5)::numeric / (r.n + 3), 2),
           lv.level, lv.name, lv.radius_km, lv.max_amount, lv.score, g.lvl
      from d, r, g,
           lateral public.courier_level(d.n, round((r.s + 3 * 3.5)::numeric / (r.n + 3), 2),
                                        case when r.n > 0 then r.s::numeric / r.n else 0 end, r.n, g.lvl) lv;
$$;
revoke all on function public.courier_card(uuid) from public, anon;

-- ---------- Disponibilité et position du livreur ----------
create table if not exists public.courier_presence (
    courier_id uuid primary key references auth.users (id) on delete cascade,
    online boolean not null default false,
    lat numeric,
    lng numeric,
    updated_at timestamptz not null default now()
);
alter table public.courier_presence enable row level security;
-- Aucune policy : lecture et écriture uniquement par les fonctions ci-dessous

create or replace function public.courier_set_presence(is_online boolean, new_lat numeric default null, new_lng numeric default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_courier(auth.uid()) then
        raise exception 'Réservé aux livreurs validés' using errcode = '42501';
    end if;
    if is_online and (new_lat is null or new_lng is null or abs(new_lat) > 90 or abs(new_lng) > 180) then
        raise exception 'Active ta localisation pour recevoir des courses';
    end if;
    insert into public.courier_presence (courier_id, online, lat, lng, updated_at)
    values (auth.uid(), is_online, round(new_lat, 6), round(new_lng, 6), now())
    on conflict (courier_id) do update
       set online = excluded.online,
           lat = coalesce(excluded.lat, courier_presence.lat),
           lng = coalesce(excluded.lng, courier_presence.lng),
           updated_at = now();
end;
$$;
revoke all on function public.courier_set_presence(boolean, numeric, numeric) from public;
grant execute on function public.courier_set_presence(boolean, numeric, numeric) to authenticated;

-- ---------- Règle centrale : ce livreur peut-il prendre cette commande ? ----------
-- Renvoie null si oui, sinon la raison (affichée au livreur).
create or replace function public.courier_block_reason(target uuid, target_order uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    c record;
    p record;
    o record;
    s record;
    dist numeric;
begin
    if not public.is_courier(target) then return 'Réservé aux livreurs validés'; end if;
    select * into c from public.courier_card(target);
    if c.level = 0 then return 'Compte suspendu : note trop basse. Contacte Ouenze.'; end if;
    select * into p from public.courier_presence where courier_id = target;
    if p.courier_id is null or not p.online or p.updated_at < now() - interval '3 hours' or p.lat is null then
        return 'Passe en « disponible » pour prendre des courses';
    end if;
    select id, status, deliverer_id, coalesce(subtotal, total - coalesce(delivery_fees, 0)) as amount,
           (delivery_info->>'lat')::numeric as lat, (delivery_info->>'lng')::numeric as lng, client_id
      into o from public.orders where id = target_order;
    if o.id is null or o.status <> 'accepted' or o.deliverer_id is not null then return 'Course déjà prise'; end if;
    if o.client_id = target then return 'Tu ne peux pas livrer ta propre commande'; end if;
    select sh.id, sh.owner_id, sh.lat, sh.lng into s
      from public.order_items oi join public.shops sh on sh.id = oi.shop_id where oi.order_id = o.id limit 1;
    if s.owner_id = target then return 'Tu ne peux pas livrer ta propre boutique'; end if;
    if c.max_amount is not null and o.amount > c.max_amount then
        return 'Commande de ' || public.fcfa(o.amount) || ' : réservée aux livreurs de niveau supérieur';
    end if;
    dist := public.distance_km(p.lat, p.lng, coalesce(s.lat, o.lat), coalesce(s.lng, o.lng));
    if c.radius_km is not null and (dist is null or dist > c.radius_km) then
        return 'Hors de ta zone (' || coalesce(replace(dist::text, '.', ','), '?') || ' km, ta zone : ' || c.radius_km || ' km)';
    end if;
    return null;
end;
$$;
revoke all on function public.courier_block_reason(uuid, uuid) from public, anon, authenticated;

-- ---------- Mon profil livreur ----------
create or replace function public.my_courier_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    app record;
    c record;
    p record;
begin
    select status, full_name, vehicle_type, city into app from public.delivery_applications where user_id = auth.uid();
    if app.status is null then return jsonb_build_object('status', 'none'); end if;
    if app.status <> 'approved' then return jsonb_build_object('status', app.status); end if;
    select * into c from public.courier_card(auth.uid());
    select * into p from public.courier_presence where courier_id = auth.uid();
    return jsonb_build_object(
        'status', 'approved', 'full_name', app.full_name, 'vehicle_type', app.vehicle_type, 'city', app.city,
        'deliveries', c.deliveries, 'reviews', c.reviews, 'rating', c.rating, 'smooth_rating', c.smooth_rating,
        'score', c.score, 'level', c.level, 'level_name', c.level_name, 'radius_km', c.radius_km, 'max_amount', c.max_amount,
        'granted', c.granted,
        'online', coalesce(p.online and p.updated_at > now() - interval '3 hours', false),
        'earned', (select coalesce(sum(delivery_fees), 0) from public.orders where deliverer_id = auth.uid() and status = 'delivered'));
end;
$$;
revoke all on function public.my_courier_profile() from public;
grant execute on function public.my_courier_profile() to authenticated;

-- ---------- Courses à prendre ----------
-- Les courses autorisées arrivent avec le détail utile ; les autres seulement avec la raison
-- (pour montrer au livreur ce qu'il débloquera en montant de niveau). Jamais l'adresse exacte
-- ni le téléphone du client avant d'avoir pris la course.
create or replace function public.available_deliveries()
returns table (order_id uuid, order_number text, shop_name text, pickup_area text, dropoff_area text,
               amount numeric, fee numeric, items integer, to_pickup_km numeric, trip_km numeric,
               is_test boolean, accepted_at timestamptz, allowed boolean, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    p record;
begin
    if not public.is_courier(auth.uid()) then
        raise exception 'Réservé aux livreurs validés' using errcode = '42501';
    end if;
    select * into p from public.courier_presence where courier_id = auth.uid();
    return query
    select o.id, o.order_number, s.name::text,
           nullif(concat_ws(', ', nullif(s.district, ''), s.city), ''),
           nullif(concat_ws(', ', nullif(o.delivery_info->>'district', ''), o.delivery_info->>'city'), ''),
           coalesce(o.subtotal, o.total - coalesce(o.delivery_fees, 0)), coalesce(o.delivery_fees, 0),
           (select coalesce(sum(oq.quantity), 0)::integer from public.order_items oq where oq.order_id = o.id),
           public.distance_km(p.lat, p.lng, coalesce(s.lat, (o.delivery_info->>'lat')::numeric), coalesce(s.lng, (o.delivery_info->>'lng')::numeric)),
           public.distance_km(s.lat, s.lng, (o.delivery_info->>'lat')::numeric, (o.delivery_info->>'lng')::numeric),
           o.payment_status = 'test', o.updated_at,
           r.reason is null, r.reason
      from public.orders o
      join lateral (select sh.* from public.order_items oi join public.shops sh on sh.id = oi.shop_id
                     where oi.order_id = o.id limit 1) s on true
      cross join lateral (select public.courier_block_reason(auth.uid(), o.id) as reason) r
     where o.status = 'accepted' and o.deliverer_id is null
       and o.payment_status in ('test', 'paid')
       and o.updated_at > now() - interval '3 days'
     order by r.reason is null desc, o.updated_at
     limit 50;
end;
$$;
revoke all on function public.available_deliveries() from public;
grant execute on function public.available_deliveries() to authenticated;

-- ---------- Code de remise (lisible par personne : seulement via les fonctions) ----------
create table if not exists public.delivery_codes (
    order_id uuid primary key references public.orders (id) on delete cascade,
    code text not null,
    attempts integer not null default 0,
    created_at timestamptz not null default now()
);
alter table public.delivery_codes enable row level security;

-- ---------- Prendre une course ----------
create or replace function public.take_delivery(target_order uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    why text;
begin
    perform 1 from public.orders where id = target_order for update;
    why := public.courier_block_reason(auth.uid(), target_order);
    if why is not null then raise exception '%', why; end if;
    insert into public.delivery_codes (order_id, code, attempts)
    values (target_order, lpad((floor(random() * 10000))::integer::text, 4, '0'), 0)
    on conflict (order_id) do update set code = excluded.code, attempts = 0, created_at = now();
    update public.orders set deliverer_id = auth.uid(), status = 'courier_assigned', tracking_step = 3, updated_at = now()
     where id = target_order;
    return 'courier_assigned';
end;
$$;
revoke all on function public.take_delivery(uuid) from public;
grant execute on function public.take_delivery(uuid) to authenticated;

-- ---------- Étapes de la course ----------
-- step : 'pickup' (colis récupéré) · 'delivered' (avec le code du client) · 'release' (abandon avant retrait)
create or replace function public.courier_step(target_order uuid, step text, client_code text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    o record;
    dc record;
begin
    select id, status into o from public.orders where id = target_order and deliverer_id = auth.uid() for update;
    if o.id is null then raise exception 'Course introuvable' using errcode = '42501'; end if;
    if step = 'pickup' and o.status = 'courier_assigned' then
        update public.orders set status = 'in_transit', tracking_step = 5, updated_at = now() where id = o.id;
        return 'in_transit';
    elsif step = 'release' and o.status = 'courier_assigned' then
        delete from public.delivery_codes where order_id = o.id;
        -- Le prochain livreur aura un nouveau code : le client et le vendeur seront de nouveau prévenus
        delete from public.app_notifications where order_id = o.id and kind in ('order_courier', 'order_pickup', 'delivery_offer');
        update public.orders set status = 'accepted', deliverer_id = null, tracking_step = 2, updated_at = now() where id = o.id;
        return 'accepted';
    elsif step = 'delivered' and o.status in ('in_transit', 'picked_up') then
        select * into dc from public.delivery_codes where order_id = o.id for update;
        if dc.order_id is not null then
            if dc.attempts >= 5 then
                raise exception 'Trop de codes faux : contacte Ouenze pour valider cette livraison';
            end if;
            if btrim(coalesce(client_code, '')) <> dc.code then
                update public.delivery_codes set attempts = attempts + 1 where order_id = o.id;
                raise exception 'Code incorrect (% essai(s) restant(s)). Demande le code au client.', 4 - dc.attempts;
            end if;
        end if;
        update public.orders set status = 'delivered', tracking_step = 6, updated_at = now() where id = o.id;
        return 'delivered';
    end if;
    raise exception 'Action impossible : la course est « % »', o.status;
end;
$$;
revoke all on function public.courier_step(uuid, text, text) from public;
grant execute on function public.courier_step(uuid, text, text) to authenticated;

-- ---------- Mes courses (le détail complet n'est visible qu'une fois la course prise) ----------
create or replace function public.my_deliveries()
returns table (order_id uuid, order_number text, status text, is_test boolean, updated_at timestamptz,
               shop_name text, shop_address text, shop_lat numeric, shop_lng numeric,
               client_name text, client_phone text, dropoff_area text, landmark text, client_lat numeric, client_lng numeric,
               amount numeric, fee numeric, items jsonb, stars integer, review text)
language sql
stable
security definer
set search_path = public
as $$
    select o.id, o.order_number, o.status, o.payment_status = 'test', o.updated_at,
           s.name::text, nullif(concat_ws(', ', nullif(s.address, ''), nullif(s.district, ''), s.city), ''), s.lat, s.lng,
           coalesce(nullif(split_part(btrim(u.raw_user_meta_data->>'full_name'), ' ', 1), ''), 'Client'),
           case when o.status in ('courier_assigned', 'in_transit', 'picked_up') then o.delivery_info->>'phone' end,
           nullif(concat_ws(', ', nullif(o.delivery_info->>'street', ''), nullif(o.delivery_info->>'district', ''), o.delivery_info->>'city'), ''),
           case when o.status in ('courier_assigned', 'in_transit', 'picked_up') then o.delivery_info->>'landmark' end,
           (o.delivery_info->>'lat')::numeric, (o.delivery_info->>'lng')::numeric,
           coalesce(o.subtotal, o.total - coalesce(o.delivery_fees, 0)), coalesce(o.delivery_fees, 0),
           (select jsonb_agg(jsonb_build_object('name', oi.product_name, 'variant', oi.variant_name, 'quantity', oi.quantity))
              from public.order_items oi where oi.order_id = o.id),
           cr.stars::integer, cr.comment
      from public.orders o
      join lateral (select sh.* from public.order_items oi join public.shops sh on sh.id = oi.shop_id
                     where oi.order_id = o.id limit 1) s on true
      left join auth.users u on u.id = o.client_id
      left join public.courier_reviews cr on cr.order_id = o.id
     where o.deliverer_id = auth.uid()
     order by o.updated_at desc
     limit 100;
$$;
revoke all on function public.my_deliveries() from public;
grant execute on function public.my_deliveries() to authenticated;

-- ---------- Le vendeur ne peut plus « marquer livrée » une commande prise par un livreur ----------
create or replace function public.vendor_order_decision(target_order uuid, decision text, reason text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    o record;
begin
    select ord.id, ord.status, ord.payment_status, ord.deliverer_id into o
      from public.orders ord
     where ord.id = target_order
       and exists (select 1 from public.order_items oi join public.shops s on s.id = oi.shop_id
                    where oi.order_id = ord.id and s.owner_id = auth.uid())
     for update;
    if o.id is null then raise exception 'Commande introuvable' using errcode = '42501'; end if;
    if decision = 'accept' and o.status = 'pending' then
        update public.orders set status = 'accepted', tracking_step = 2, updated_at = now() where id = o.id;
        return 'accepted';
    elsif decision = 'refuse' and o.status = 'pending' then
        update public.orders set status = 'refused', updated_at = now(),
               notes = nullif(left(btrim(coalesce(reason, '')), 300), '') where id = o.id;
        return 'refused';
    elsif decision = 'delivered' and o.status = 'accepted' and o.payment_status = 'test' and o.deliverer_id is null then
        -- Test sans livreur uniquement : en vrai, c'est le livreur qui confirme avec le code du client
        update public.orders set status = 'delivered', tracking_step = 6, updated_at = now() where id = o.id;
        return 'delivered';
    end if;
    raise exception 'Action impossible : la commande est « % »', o.status;
end;
$$;
revoke all on function public.vendor_order_decision(uuid, text, text) from public;
grant execute on function public.vendor_order_decision(uuid, text, text) to authenticated;

-- ---------- Notifications : livreurs prévenus, code au client, vendeur informé ----------
create or replace function public.notify_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    s record;
    num text := coalesce(new.order_number, '');
    code text;
    courier_name text;
    c record;
begin
    if new.status is not distinct from old.status then return new; end if;
    select * into s from public.order_shop(new.id);
    if new.status = 'accepted' then
        perform public.notify_user(new.client_id, 'order_accepted', 'Commande ' || num || ' acceptée',
            coalesce(s.shop_name, 'Le vendeur') || ' prépare ta commande. Un livreur va la récupérer.', new.id, s.shop_id);
        -- Livreurs disponibles qui ont le droit de la prendre (les mieux classés d'abord, 20 au plus)
        for c in
            select pr.courier_id from public.courier_presence pr
             where pr.online and pr.updated_at > now() - interval '3 hours'
               and public.courier_block_reason(pr.courier_id, new.id) is null
             order by (select level from public.courier_card(pr.courier_id)) desc
             limit 20
        loop
            perform public.notify_user(c.courier_id, 'delivery_offer', 'Nouvelle course disponible',
                coalesce(s.shop_name, 'Une boutique') || ' → ' || coalesce(nullif(new.delivery_info->>'district', ''), new.delivery_info->>'city', 'client')
                || ' · gain ' || public.fcfa(new.delivery_fees) || '. Premier arrivé, premier servi.', new.id, null);
        end loop;
    elsif new.status = 'refused' then
        perform public.notify_user(new.client_id, 'order_refused', 'Commande ' || num || ' refusée',
            coalesce(s.shop_name, 'Le vendeur') || ' ne peut pas la préparer'
            || coalesce(' : ' || nullif(btrim(new.notes), ''), '.')
            || case when new.payment_status = 'paid' then ' Tu seras remboursé.' else '' end, new.id, s.shop_id);
    elsif new.status = 'courier_assigned' then
        select dc.code into code from public.delivery_codes dc where dc.order_id = new.id;
        select coalesce(nullif(split_part(btrim(full_name), ' ', 1), ''), 'Ton livreur') into courier_name
          from public.delivery_applications where user_id = new.deliverer_id;
        perform public.notify_user(new.client_id, 'order_courier', coalesce(courier_name, 'Un livreur') || ' livre ta commande ' || num,
            'Il va la récupérer chez ' || coalesce(s.shop_name, 'le vendeur') || '.'
            || coalesce(' Ton code de remise : ' || code || ' — donne-le au livreur seulement quand tu as ton colis.', ''),
            new.id, s.shop_id);
        perform public.notify_user(s.owner_id, 'order_pickup', 'Un livreur arrive pour ' || num,
            coalesce(courier_name, 'Le livreur') || ' vient récupérer la commande. Prépare le colis.', new.id, s.shop_id);
    elsif new.status in ('picked_up', 'in_transit') then
        perform public.notify_user(new.client_id, 'order_in_transit', 'Commande ' || num || ' en route',
            'Ton livreur a récupéré la commande. Garde ton code de remise à portée de main.', new.id, s.shop_id);
    elsif new.status = 'delivered' then
        perform public.notify_user(new.client_id, 'order_delivered', 'Commande ' || num || ' livrée',
            'Donne ta note à ' || coalesce(s.shop_name, 'la boutique') || ' et au livreur : ton avis aide les autres clients.',
            new.id, s.shop_id);
    elsif new.status = 'cancelled' then
        perform public.notify_user(s.owner_id, 'order_cancelled', 'Commande ' || num || ' annulée',
            'Le client a annulé sa commande avant ton acceptation. Rien à préparer.', new.id, s.shop_id);
    end if;
    return new;
end;
$$;
drop trigger if exists orders_status_notify on public.orders;
create trigger orders_status_notify after update of status on public.orders
    for each row execute function public.notify_order_status();

notify pgrst, 'reload schema';
