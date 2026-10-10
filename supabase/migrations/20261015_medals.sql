-- ============================================================
-- Programme Médailles : niveau de la boutique et commission Ouenze
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261014_stock_market.sql (shop_delivered_orders, market_offerings).
--
--   Médaille   Conditions                                                  Commission
--   Standard   —                                                           22 %
--   Bronze     note ≥ 3,5 et ≥ 10 commandes livrées                        21,75 %
--   Argent     note ≥ 4   et ≥ 50 commandes livrées                        21,5 %
--   Or         note ≥ 4,5, ≥ 150 commandes livrées et boutique vérifiée    21 %
--
-- Les mêmes règles sont recopiées dans js/database.js (OuenzeMedals) pour l'affichage :
-- toute modification doit être faite aux deux endroits.
-- ============================================================

create or replace function public.medal_for(rating numeric, delivered integer, verified boolean)
returns text
language sql
immutable
as $$
    select case
        when coalesce(rating, 0) >= 4.5 and coalesce(delivered, 0) >= 150 and coalesce(verified, false) then 'gold'
        when coalesce(rating, 0) >= 4.0 and coalesce(delivered, 0) >= 50 then 'silver'
        when coalesce(rating, 0) >= 3.5 and coalesce(delivered, 0) >= 10 then 'bronze'
        else 'standard'
    end;
$$;

create or replace function public.medal_commission(medal text)
returns numeric
language sql
immutable
as $$
    select case medal when 'gold' then 0.21 when 'silver' then 0.215 when 'bronze' then 0.2175 else 0.22 end;
$$;

grant execute on function public.medal_for(numeric, integer, boolean) to anon, authenticated;
grant execute on function public.medal_commission(text) to anon, authenticated;

-- ---------- Médaille de toutes les boutiques actives (accueil, classement) ----------
create or replace function public.shop_medals()
returns table (shop_id uuid, medal text, commission_rate numeric, rating numeric, delivered_orders integer, is_verified boolean)
language sql
stable
security definer
set search_path = public
as $$
    select s.id, m.medal, public.medal_commission(m.medal), m.rating, m.delivered, m.verified
      from public.shops s
      cross join lateral (
          select coalesce(s.rating, 0)::numeric as rating,
                 public.shop_delivered_orders(s.id) as delivered,
                 coalesce(s.is_verified, false) as verified
      ) d
      cross join lateral (select public.medal_for(d.rating, d.delivered, d.verified) as medal, d.rating, d.delivered, d.verified) m
     where coalesce(s.is_active, true);
$$;
grant execute on function public.shop_medals() to anon, authenticated;

-- ---------- Ouvrir une offre en bourse = boutique vérifiée sur place ----------
create or replace function public.review_listing(offering uuid, decision text, note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    target_shop uuid;
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
       and ((decision in ('open', 'rejected') and status = 'pending') or (decision = 'closed' and status = 'open'))
    returning shop_id into target_shop;
    if not found then raise exception 'Demande introuvable ou déjà traitée'; end if;
    if decision = 'open' then
        update public.shops set is_verified = true where id = target_shop;
    end if;
    if decision in ('closed', 'rejected') then
        update public.share_orders set status = 'cancelled' where offering_id = offering and status = 'requested';
    end if;
    return decision;
end;
$$;

-- ---------- Le marché affiche la médaille de chaque boutique ----------
drop function if exists public.market_offerings();
create function public.market_offerings()
returns table (
    offering_id uuid, shop_id uuid, shop_name text, shop_logo text, shop_city text,
    rating numeric, total_ratings integer, delivered_orders integer,
    percent_offered numeric, total_shares integer, remaining_shares integer,
    price_per_share numeric, valuation numeric, investors integer, pitch text, opened_at timestamptz,
    medal text
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
           o.pitch, o.reviewed_at,
           public.medal_for(coalesce(s.rating, 0), public.shop_delivered_orders(s.id), coalesce(s.is_verified, false))
      from public.share_offerings o
      join public.shops s on s.id = o.shop_id
     where o.status = 'open';
$$;
grant execute on function public.market_offerings() to anon, authenticated;

notify pgrst, 'reload schema';
