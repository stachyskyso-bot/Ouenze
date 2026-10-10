-- ============================================================
-- Bourse Ouenze : entrée en bourse des boutiques et réservation de parts
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261011_delivery_applications.sql (is_admin) et 20261013_vendor_accounting.sql.
--
-- Règles :
--   • Une boutique = 10 000 parts. Le vendeur en met en vente 1 à 49 % (il garde le contrôle).
--   • Conditions pour demander : note ≥ 3,5 et au moins 75 commandes livrées.
--   • L'admin (vérification physique de la boutique) ouvre ou refuse la demande.
--   • Les investisseurs RÉSERVENT des parts ; elles deviennent « payées » quand le paiement
--     est confirmé (pawaPay plus tard ; pour l'instant confirmation par l'admin).
-- Tout passe par des fonctions security definer : aucune écriture directe depuis le navigateur.
-- ============================================================

create table if not exists public.share_offerings (
    id uuid primary key default gen_random_uuid(),
    shop_id uuid not null references public.shops (id) on delete cascade,
    owner_id uuid not null references auth.users (id),
    percent_offered numeric(5, 2) not null check (percent_offered >= 1 and percent_offered <= 49),
    total_shares integer not null check (total_shares > 0),
    price_per_share numeric(14, 0) not null check (price_per_share >= 100),
    status text not null default 'pending' check (status in ('pending', 'open', 'closed', 'rejected', 'cancelled')),
    pitch text check (char_length(pitch) <= 1000),
    admin_note text,
    created_at timestamptz not null default now(),
    reviewed_at timestamptz,
    reviewed_by uuid references auth.users (id)
);
alter table public.share_offerings enable row level security;

-- Une seule demande en cours (en attente ou ouverte) par boutique
create unique index if not exists share_offerings_one_active
    on public.share_offerings (shop_id) where status in ('pending', 'open');

drop policy if exists "offres: publiques si ouvertes, sinon vendeur et admins" on public.share_offerings;
create policy "offres: publiques si ouvertes, sinon vendeur et admins" on public.share_offerings
    for select using (status in ('open', 'closed') or owner_id = auth.uid() or public.is_admin());

create table if not exists public.share_orders (
    id uuid primary key default gen_random_uuid(),
    offering_id uuid not null references public.share_offerings (id) on delete cascade,
    investor_id uuid not null references auth.users (id),
    quantity integer not null check (quantity > 0),
    price_per_share numeric(14, 0) not null check (price_per_share > 0),
    amount numeric(16, 0) generated always as (quantity * price_per_share) stored,
    status text not null default 'requested' check (status in ('requested', 'paid', 'cancelled', 'refunded')),
    payment_ref text,
    created_at timestamptz not null default now(),
    paid_at timestamptz
);
alter table public.share_orders enable row level security;
create index if not exists share_orders_investor on public.share_orders (investor_id, created_at);
create index if not exists share_orders_offering on public.share_orders (offering_id, status);

drop policy if exists "parts: l'investisseur, le vendeur concerné et les admins lisent" on public.share_orders;
create policy "parts: l'investisseur, le vendeur concerné et les admins lisent" on public.share_orders
    for select to authenticated using (
        investor_id = auth.uid()
        or public.is_admin()
        or exists (select 1 from public.share_offerings o where o.id = offering_id and o.owner_id = auth.uid())
    );

-- ---------- Nombre de commandes livrées d'une boutique ----------
create or replace function public.shop_delivered_orders(target_shop uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    n integer := 0;
begin
    begin
        execute 'select count(distinct oi.order_id) from public.order_items oi
                   join public.orders o on o.id = oi.order_id
                  where oi.shop_id = $1 and o.status = ''delivered'''
           into n using target_shop;
    exception when undefined_table or undefined_column then
        n := 0;
    end;
    return coalesce(n, 0);
end;
$$;
grant execute on function public.shop_delivered_orders(uuid) to anon, authenticated;

-- ---------- Éligibilité d'une boutique ----------
create or replace function public.listing_eligibility(target_shop uuid)
returns table (rating numeric, delivered_orders integer, min_rating numeric, min_orders integer, eligible boolean, active_status text)
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(s.rating, 0)::numeric,
           public.shop_delivered_orders(s.id),
           3.5::numeric,
           75,
           coalesce(s.rating, 0) >= 3.5 and public.shop_delivered_orders(s.id) >= 75,
           (select o.status from public.share_offerings o
             where o.shop_id = s.id and o.status in ('pending', 'open') limit 1)
      from public.shops s
     where s.id = target_shop;
$$;
grant execute on function public.listing_eligibility(uuid) to authenticated;

-- ---------- Le vendeur demande l'entrée en bourse ----------
create or replace function public.request_listing(target_shop uuid, percent numeric, share_price numeric, pitch_text text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    shop_owner uuid;
    e record;
    new_id uuid;
begin
    select owner_id into shop_owner from public.shops where id = target_shop;
    if shop_owner is null then raise exception 'Boutique introuvable'; end if;
    if shop_owner <> auth.uid() then
        raise exception 'Seul le propriétaire peut demander l''entrée en bourse' using errcode = '42501';
    end if;
    select * into e from public.listing_eligibility(target_shop);
    if not e.eligible then
        raise exception 'Boutique pas encore éligible : note %/5 (minimum 3,5) et % commandes livrées (minimum 75)',
            round(e.rating, 1), e.delivered_orders;
    end if;
    if e.active_status is not null then
        raise exception 'Une demande est déjà en cours pour cette boutique';
    end if;
    if percent is null or percent < 1 or percent > 49 then
        raise exception 'Le pourcentage mis en vente doit être entre 1 et 49 %%';
    end if;
    if share_price is null or share_price < 100 then
        raise exception 'Le prix d''une part doit être d''au moins 100 FCFA';
    end if;
    insert into public.share_offerings (shop_id, owner_id, percent_offered, total_shares, price_per_share, pitch)
    values (target_shop, auth.uid(), round(percent, 2), round(percent * 100)::integer, round(share_price), nullif(btrim(pitch_text), ''))
    returning id into new_id;
    return new_id;
end;
$$;
revoke all on function public.request_listing(uuid, numeric, numeric, text) from public;
grant execute on function public.request_listing(uuid, numeric, numeric, text) to authenticated;

-- ---------- L'admin ouvre, refuse ou clôture ----------
create or replace function public.review_listing(offering uuid, decision text, note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'Réservé aux administrateurs' using errcode = '42501';
    end if;
    if decision not in ('open', 'rejected', 'closed') then
        raise exception 'Décision inconnue';
    end if;
    update public.share_offerings
       set status = decision, admin_note = note, reviewed_at = now(), reviewed_by = auth.uid()
     where id = offering
       and ((decision in ('open', 'rejected') and status = 'pending') or (decision = 'closed' and status = 'open'));
    if not found then raise exception 'Demande introuvable ou déjà traitée'; end if;
    -- Clôture : les réservations non payées sont annulées
    if decision in ('closed', 'rejected') then
        update public.share_orders set status = 'cancelled' where offering_id = offering and status = 'requested';
    end if;
    return decision;
end;
$$;
revoke all on function public.review_listing(uuid, text, text) from public;
grant execute on function public.review_listing(uuid, text, text) to authenticated;

-- ---------- Parts encore disponibles (réservées + payées déduites) ----------
create or replace function public.offering_remaining(offering uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select o.total_shares - coalesce((select sum(quantity) from public.share_orders
                                        where offering_id = o.id and status in ('requested', 'paid')), 0)::integer
      from public.share_offerings o where o.id = offering;
$$;
grant execute on function public.offering_remaining(uuid) to anon, authenticated;

-- ---------- L'investisseur réserve des parts ----------
create or replace function public.reserve_shares(offering uuid, qty integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    o record;
    left_shares integer;
    new_id uuid;
begin
    if auth.uid() is null then raise exception 'Connecte-toi pour investir' using errcode = '42501'; end if;
    -- Verrou : deux réservations simultanées ne peuvent pas dépasser le nombre de parts
    select * into o from public.share_offerings where id = offering for update;
    if o.id is null or o.status <> 'open' then raise exception 'Cette offre n''est pas ouverte'; end if;
    if o.owner_id = auth.uid() then raise exception 'Tu ne peux pas acheter des parts de ta propre boutique'; end if;
    if qty is null or qty < 1 then raise exception 'Indique un nombre de parts'; end if;
    left_shares := public.offering_remaining(offering);
    if qty > left_shares then raise exception 'Il ne reste que % part(s) disponible(s)', left_shares; end if;
    if (select count(*) from public.share_orders
         where investor_id = auth.uid() and status = 'requested') >= 10 then
        raise exception 'Tu as déjà 10 réservations en attente de paiement';
    end if;
    insert into public.share_orders (offering_id, investor_id, quantity, price_per_share)
    values (offering, auth.uid(), qty, o.price_per_share)
    returning id into new_id;
    return new_id;
end;
$$;
revoke all on function public.reserve_shares(uuid, integer) from public;
grant execute on function public.reserve_shares(uuid, integer) to authenticated;

-- ---------- L'investisseur annule une réservation non payée ----------
create or replace function public.cancel_share_order(share_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.share_orders set status = 'cancelled'
     where id = share_order and investor_id = auth.uid() and status = 'requested';
    if not found then raise exception 'Réservation introuvable ou déjà payée'; end if;
end;
$$;
revoke all on function public.cancel_share_order(uuid) from public;
grant execute on function public.cancel_share_order(uuid) to authenticated;

-- ---------- L'admin confirme un paiement (en attendant pawaPay) ----------
create or replace function public.confirm_share_payment(share_order uuid, reference text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    if reference is null or btrim(reference) = '' then raise exception 'Référence de paiement obligatoire'; end if;
    update public.share_orders set status = 'paid', paid_at = now(), payment_ref = btrim(reference)
     where id = share_order and status = 'requested';
    if not found then raise exception 'Réservation introuvable ou déjà traitée'; end if;
end;
$$;
revoke all on function public.confirm_share_payment(uuid, text) from public;
grant execute on function public.confirm_share_payment(uuid, text) to authenticated;

-- ---------- Marché : offres ouvertes avec les informations publiques de la boutique ----------
create or replace function public.market_offerings()
returns table (
    offering_id uuid, shop_id uuid, shop_name text, shop_logo text, shop_city text,
    rating numeric, total_ratings integer, delivered_orders integer,
    percent_offered numeric, total_shares integer, remaining_shares integer,
    price_per_share numeric, valuation numeric, investors integer, pitch text, opened_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
    select o.id, s.id, s.name::text, s.logo_url::text, s.city::text,
           coalesce(s.rating, 0)::numeric, coalesce(s.total_ratings, 0)::integer,
           public.shop_delivered_orders(s.id),
           o.percent_offered, o.total_shares, public.offering_remaining(o.id),
           o.price_per_share, o.price_per_share * 10000,
           (select count(distinct investor_id) from public.share_orders
             where offering_id = o.id and status = 'paid')::integer,
           o.pitch, o.reviewed_at
      from public.share_offerings o
      join public.shops s on s.id = o.shop_id
     where o.status = 'open';
$$;
grant execute on function public.market_offerings() to anon, authenticated;

-- ---------- Portefeuille de l'investisseur connecté ----------
create or replace function public.my_share_orders()
returns table (
    order_id uuid, offering_id uuid, shop_id uuid, shop_name text, shop_logo text,
    quantity integer, price_per_share numeric, amount numeric, status text,
    created_at timestamptz, paid_at timestamptz,
    current_price numeric, offering_status text
)
language sql
stable
security definer
set search_path = public
as $$
    select so.id, o.id, s.id, s.name::text, s.logo_url::text,
           so.quantity, so.price_per_share, so.amount, so.status,
           so.created_at, so.paid_at,
           o.price_per_share, o.status
      from public.share_orders so
      join public.share_offerings o on o.id = so.offering_id
      join public.shops s on s.id = o.shop_id
     where so.investor_id = auth.uid()
     order by so.created_at;
$$;
grant execute on function public.my_share_orders() to authenticated;

-- ---------- Admin : demandes d'entrée en bourse, avec le contact du vendeur ----------
create or replace function public.admin_listings()
returns table (
    offering_id uuid, shop_id uuid, shop_name text, shop_city text, rating numeric, delivered_orders integer,
    owner_email text, percent_offered numeric, total_shares integer, remaining_shares integer,
    price_per_share numeric, valuation numeric, status text, pitch text, admin_note text,
    created_at timestamptz, reviewed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    return query
    select o.id, s.id, s.name::text, s.city::text, coalesce(s.rating, 0)::numeric, public.shop_delivered_orders(s.id),
           u.email::text, o.percent_offered, o.total_shares, public.offering_remaining(o.id),
           o.price_per_share, o.price_per_share * 10000, o.status, o.pitch, o.admin_note, o.created_at, o.reviewed_at
      from public.share_offerings o
      join public.shops s on s.id = o.shop_id
      left join auth.users u on u.id = o.owner_id
     order by (o.status = 'pending') desc, o.created_at desc;
end;
$$;
revoke all on function public.admin_listings() from public;
grant execute on function public.admin_listings() to authenticated;

-- ---------- Admin : réservations de parts, avec le contact de l'investisseur ----------
create or replace function public.admin_share_orders()
returns table (
    order_id uuid, shop_name text, investor_email text, quantity integer, price_per_share numeric,
    amount numeric, status text, payment_ref text, created_at timestamptz, paid_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    return query
    select so.id, s.name::text, u.email::text, so.quantity, so.price_per_share, so.amount, so.status,
           so.payment_ref, so.created_at, so.paid_at
      from public.share_orders so
      join public.share_offerings o on o.id = so.offering_id
      join public.shops s on s.id = o.shop_id
      left join auth.users u on u.id = so.investor_id
     order by (so.status = 'requested') desc, so.created_at desc;
end;
$$;
revoke all on function public.admin_share_orders() from public;
grant execute on function public.admin_share_orders() to authenticated;

notify pgrst, 'reload schema';
