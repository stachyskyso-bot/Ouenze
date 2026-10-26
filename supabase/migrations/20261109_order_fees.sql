-- ============================================================
-- 20261109 — Nouveaux frais de commande
--
-- Le client paie, en plus du prix des articles :
--   • les frais de service Ouenze, selon la médaille de la boutique, calculés sur le total
--     des articles de cette boutique : Standard 9 %, Bronze 8 %, Argent 7 %, Or 8 % ;
--     boutique Or : Ouenze garde 6 % et reverse 2 % au vendeur ; si plusieurs boutiques Or
--     sont dans la même commande, ces 2 % sont partagés à parts égales entre elles ;
--   • la livraison : 300 FCFA pour une seule boutique, 500 FCFA au total s'il y a plusieurs
--     boutiques (une commande par boutique : les 500 FCFA sont répartis entre elles) ;
--     la livraison revient entièrement au livreur.
-- Le vendeur reçoit 100 % du prix de ses articles (+ sa part des 2 % s'il est Or).
-- Exemple : 50 000 FCFA d'articles dans une boutique Standard → 50 000 + 4 500 + 300 = 54 800.
--
-- Montants de livraison réglables par un admin (Espace équipe → Équipe et réglages).
-- Relançable sans danger.
-- ============================================================

-- ---------- Taux par médaille (désormais payés par le client) ----------
create or replace function public.medal_commission(medal text)
returns numeric
language sql
immutable
as $$
    select case medal when 'gold' then 0.08 when 'silver' then 0.07 when 'bronze' then 0.08 else 0.09 end;
$$;

-- Part des frais reversée au vendeur : 2 % pour une boutique Or
create or replace function public.medal_vendor_share(medal text)
returns numeric
language sql
immutable
as $$
    select case medal when 'gold' then 0.02 else 0 end;
$$;
grant execute on function public.medal_vendor_share(text) to anon, authenticated;

-- Médaille actuelle d'une boutique
create or replace function public.shop_medal(target uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select coalesce((
        select public.medal_for(coalesce(s.rating, 0), public.shop_delivered_orders(s.id), coalesce(s.is_verified, false))
          from public.shops s where s.id = target), 'standard');
$$;
grant execute on function public.shop_medal(uuid) to anon, authenticated;

-- Taux d'une boutique (selon sa médaille actuelle)
create or replace function public.shop_fee_rate(target uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
    select public.medal_commission(public.shop_medal(target));
$$;
grant execute on function public.shop_fee_rate(uuid) to anon, authenticated;

-- ---------- Livraison ----------
insert into public.app_settings (key, value) values ('delivery_fee_single', '300') on conflict (key) do nothing;
insert into public.app_settings (key, value) values ('delivery_fee_multi', '500') on conflict (key) do nothing;

create or replace function public.delivery_total(nshops integer)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
    select case
        when coalesce(nshops, 0) <= 0 then 0
        when nshops = 1 then coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'delivery_fee_single'), 300)
        else coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'delivery_fee_multi'), 500)
    end;
$$;
grant execute on function public.delivery_total(integer) to anon, authenticated;

-- Pour le panier et la page de commande : livraison et taux des boutiques du panier
create or replace function public.fee_quote(shop_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'delivery_single', public.delivery_total(1),
        'delivery_multi', public.delivery_total(2),
        'rates', coalesce((select jsonb_object_agg(x::text, public.shop_fee_rate(x))
                             from unnest((coalesce(shop_ids, '{}'::uuid[]))[1:50]) x), '{}'::jsonb)
    );
$$;
grant execute on function public.fee_quote(uuid[]) to anon, authenticated;

-- Admin : montants de livraison
create or replace function public.set_delivery_fees(single numeric, multi numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    if single is null or multi is null or single < 0 or multi < 0 or single > 100000 or multi > 100000 then
        raise exception 'Indique des montants entre 0 et 100 000 FCFA';
    end if;
    insert into public.app_settings (key, value, updated_at) values ('delivery_fee_single', to_jsonb(round(single)), now())
        on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into public.app_settings (key, value, updated_at) values ('delivery_fee_multi', to_jsonb(round(multi)), now())
        on conflict (key) do update set value = excluded.value, updated_at = now();
    return jsonb_build_object('delivery_single', public.delivery_total(1), 'delivery_multi', public.delivery_total(2));
end;
$$;
revoke all on function public.set_delivery_fees(numeric, numeric) from public, anon;
grant execute on function public.set_delivery_fees(numeric, numeric) to authenticated;

-- ---------- Frais de service enregistrés sur la commande ----------
alter table public.orders add column if not exists service_fee numeric not null default 0;
-- Part des frais reversée au vendeur (boutique Or), comprise dans service_fee
alter table public.orders add column if not exists vendor_bonus numeric not null default 0;

-- ---------- place_order : frais de service + livraison 300 / 500 ----------
-- La fonction existante est complétée en place. Les recherches tolèrent les espaces et les fins de
-- ligne Windows (texte collé depuis un PC) ; si un passage manque, rien n'est modifié.
do $$
declare
    def text;
    -- motif (expression régulière) → remplacement ; chaque motif doit être trouvé
    pats text[][] := array[
        array['fees\s+numeric\s*;',
              'fees numeric;' || chr(10) || '    comm numeric;' || chr(10) || '    nshops integer;' || chr(10) || '    fee_total numeric;' || chr(10)
              || '    pool numeric;' || chr(10) || '    ngold integer;' || chr(10) || '    gi integer := 0;' || chr(10) || '    bonus numeric;'],
        array['for\s+shop\s+in\s',
              '-- Livraison : 300 FCFA pour une boutique, 500 au total pour plusieurs (répartis)' || chr(10)
              || '    select count(distinct shop_id) into nshops from _cart;' || chr(10)
              || '    fee_total := public.delivery_total(nshops);' || chr(10)
              || '    -- Boutiques Or : 2 % de leurs articles reversés, partagés à parts égales entre elles' || chr(10)
              || '    select coalesce(sum(t.s * public.medal_vendor_share(t.m)), 0), count(*) filter (where public.medal_vendor_share(t.m) > 0)' || chr(10)
              || '      into pool, ngold' || chr(10)
              || '      from (select shop_id, sum(quantity * unit_price) as s, public.shop_medal(shop_id) as m from _cart group by shop_id) t;' || chr(10)
              || '    pool := round(pool);' || chr(10) || '    for shop in '],
        array['fees\s*:=\s*round\(\s*sub\s*\*\s*(public\.delivery_rate\(\)|0\.10?)\s*\)\s*;',
              'fees := floor(fee_total / nshops) + case when n <= (fee_total - floor(fee_total / nshops) * nshops) then 1 else 0 end;'
              || chr(10) || '        comm := round(sub * public.shop_fee_rate(shop.shop_id));'
              || chr(10) || '        bonus := 0;'
              || chr(10) || '        if ngold > 0 and public.medal_vendor_share(public.shop_medal(shop.shop_id)) > 0 then'
              || chr(10) || '            gi := gi + 1;'
              || chr(10) || '            bonus := floor(pool / ngold) + case when gi <= (pool - floor(pool / ngold) * ngold) then 1 else 0 end;'
              || chr(10) || '        end if;'],
        array['insert\s+into\s+public\.orders\s*\(\s*client_id\s*,\s*order_number\s*,\s*subtotal\s*,\s*delivery_fees\s*,\s*total\s*,',
              'insert into public.orders (client_id, order_number, subtotal, delivery_fees, service_fee, vendor_bonus, total,'],
        array['values\s*\(\s*uid\s*,\s*num\s*,\s*sub\s*,\s*fees\s*,\s*sub\s*\+\s*fees\s*,',
              'values (uid, num, sub, fees, comm, bonus, sub + comm + fees,'],
        array['''delivery_fees''\s*,\s*fees\s*,\s*''total''\s*,\s*sub\s*\+\s*fees\s*\)',
              '''delivery_fees'', fees, ''service_fee'', comm, ''vendor_bonus'', bonus, ''total'', sub + comm + fees)'],
        array['grand\s*:=\s*grand\s*\+\s*sub\s*\+\s*fees\s*;', 'grand := grand + sub + comm + fees;']
    ];
    i integer;
begin
    select pg_get_functiondef('public.place_order(jsonb, jsonb, jsonb)'::regprocedure) into def;
    if position('public.delivery_total(' in def) > 0 then
        raise notice 'place_order a déjà les nouveaux frais';
        return;
    end if;
    def := replace(def, chr(13), '');   -- fins de ligne Windows
    for i in 1 .. array_length(pats, 1) loop
        if def !~ pats[i][1] then
            raise exception 'place_order : passage % introuvable (%), mise à jour annulée', i, pats[i][1];
        end if;
        def := regexp_replace(def, pats[i][1], pats[i][2]);
    end loop;
    execute def;
end $$;

-- ---------- Commandes vues par le vendeur : frais payés par le client et part reversée ----------
drop function if exists public.vendor_orders();
create function public.vendor_orders()
returns table (
    order_id uuid, order_number text, shop_id uuid, shop_name text, status text, payment_status text,
    created_at timestamptz, subtotal numeric, delivery_fees numeric, total numeric,
    items jsonb, city text, district text, landmark text, client_name text, client_phone text, notes text,
    commission_rate numeric, service_fee numeric, vendor_bonus numeric
)
language sql
stable
security definer
set search_path = public
as $$
    select o.id, o.order_number, s.id, s.name::text, o.status, o.payment_status, o.created_at,
           coalesce(o.subtotal, o.total - coalesce(o.delivery_fees, 0)), o.delivery_fees, o.total,
           (select jsonb_agg(jsonb_build_object('name', oi.product_name, 'variant', oi.variant_name,
                                                'quantity', oi.quantity, 'unit_price', oi.unit_price, 'total', oi.total_price)
                             order by oi.product_name)
              from public.order_items oi where oi.order_id = o.id and oi.shop_id = s.id),
           o.delivery_info->>'city', o.delivery_info->>'district', o.delivery_info->>'landmark',
           coalesce(nullif(split_part(btrim(u.raw_user_meta_data->>'full_name'), ' ', 1), ''), 'Client'),
           -- Le téléphone du client n'est visible qu'une fois la commande acceptée
           case when o.status in ('accepted', 'courier_assigned', 'picked_up', 'in_transit', 'delivered')
                then o.delivery_info->>'phone' end,
           o.notes,
           -- Taux de frais payé par le client sur cette commande (taux actuel pour les anciennes commandes)
           case when coalesce(o.service_fee, 0) > 0 and coalesce(o.subtotal, 0) > 0 then round(o.service_fee / o.subtotal, 4)
                else public.medal_commission(public.shop_medal(s.id)) end,
           coalesce(o.service_fee, 0), coalesce(o.vendor_bonus, 0)
      from public.orders o
      join public.shops s on s.id = (select oi.shop_id from public.order_items oi where oi.order_id = o.id limit 1)
      left join auth.users u on u.id = o.client_id
     where s.owner_id = auth.uid()
     order by o.created_at desc
     limit 200;
$$;
revoke all on function public.vendor_orders() from public;
grant execute on function public.vendor_orders() to authenticated;

notify pgrst, 'reload schema';
