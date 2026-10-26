-- ============================================================
-- 20261114 — Plats préparés à la commande + personnalisation (façon Glovo)
--
-- • Un produit fait maison / préparé à la commande n'est jamais « en rupture de stock » :
--   variants.made_to_order = true, ou produit alimentaire marqué « fait maison ».
-- • Le vendeur propose, dans la fiche produit :
--     variants.custom.remove = ["Oignons", "Piment", …]                 ingrédients que le client peut retirer
--     variants.custom.extras = [{"name":"Fromage","price":500,"max":3}, …]  suppléments payants
--   Le client choisit ; place_order vérifie tout et recalcule le prix des suppléments à partir
--   de la fiche (jamais à partir du téléphone). Le détail est enregistré dans order_items
--   (options + libellé « sans oignons · + fromage ×2 » lu par le vendeur et le livreur).
-- Prérequis : 20261109_order_fees.sql. Relançable sans danger.
-- ============================================================

create or replace function public.product_made_to_order(variants jsonb, food jsonb)
returns boolean
language sql
immutable
as $$
    select coalesce((variants ->> 'made_to_order')::boolean, false)
        or coalesce((food ->> 'homemade')::boolean, false);
$$;
grant execute on function public.product_made_to_order(jsonb, jsonb) to anon, authenticated;

-- Catalogue de l'accueil : un plat préparé à la commande n'est jamais affiché « épuisé »
create or replace function public.product_feed(city text default null, lim int default 240)
returns table (
    id uuid, shop_id uuid, shop_name text, shop_city text, name text, description text,
    price numeric, max_price numeric, versions int, stock int, out_of_stock boolean,
    has_photo boolean, created_at timestamptz
)
language sql stable set search_path = public
as $$
    with base as (
        select p.*, to_jsonb(p) as j, s.name as s_name, s.city as s_city,
            case when jsonb_typeof(p.variants -> 'items') = 'array' then p.variants -> 'items' else '[]'::jsonb end as items
        from public.products p
        join public.shops s on s.id = p.shop_id
        where coalesce(p.is_active, true)
          and coalesce(to_jsonb(s) ->> 'is_active', 'true') <> 'false'
          and to_jsonb(s) ->> 'archived_at' is null
          and to_jsonb(s) ->> 'suspended_at' is null
          and (city is null or city = '' or lower(coalesce(s.city, '')) = lower(city))
        order by p.created_at desc nulls last
        limit greatest(1, least(coalesce(lim, 240), 400))
    ), v as (
        select b.id,
            (select min((x ->> 'price')::numeric) from jsonb_array_elements(b.items) x
              where x ? 'key' and (x ->> 'price') ~ '^[0-9.]+$' and (x ->> 'price')::numeric > 0) as vmin,
            (select max((x ->> 'price')::numeric) from jsonb_array_elements(b.items) x
              where x ? 'key' and (x ->> 'price') ~ '^[0-9.]+$' and (x ->> 'price')::numeric > 0) as vmax,
            (select count(*) from jsonb_array_elements(b.items) x where x ? 'key')::int as vcount,
            (select coalesce(sum(case when (x ->> 'stock') ~ '^-?[0-9]+$' then (x ->> 'stock')::int else 0 end), 0)
               from jsonb_array_elements(b.items) x where x ? 'key')::int as vstock,
            exists (select 1 from jsonb_array_elements(b.items) x
                    where jsonb_typeof(x -> 'photos') = 'array' and jsonb_array_length(x -> 'photos') > 0) as vphoto
        from base b
    )
    select b.id, b.shop_id, b.s_name, b.s_city, b.name, left(b.j ->> 'description', 300),
        coalesce(v.vmin, b.price), coalesce(v.vmax, b.price), v.vcount,
        case when v.vcount > 0 then v.vstock else coalesce(b.stock, 0) end,
        (case when v.vcount > 0 then v.vstock else coalesce(b.stock, 0) end) <= 0 and coalesce(b.stock, 0) <> 0
            and not public.product_made_to_order(b.variants, b.j -> 'food_info'),
        coalesce(array_length(b.photos, 1), 0) > 0 or v.vphoto,
        b.created_at
    from base b join v on v.id = b.id;
$$;
grant execute on function public.product_feed(text, int) to anon, authenticated;

-- Commande : personnalisation vérifiée et facturée par la base
do $do$
begin
    if to_regprocedure('public.delivery_total(integer)') is null or to_regprocedure('public.shop_fee_rate(uuid)') is null then
        raise exception 'Lance d''abord la migration 20261109_order_fees.sql (frais de commande), puis relance celle-ci';
    end if;
    execute $fn$
create or replace function public.place_order(items jsonb, delivery jsonb, payment jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
as $body$
declare
    uid uuid := auth.uid();
    mode text := public.orders_mode();
    it jsonb;
    p record;
    v jsonb;
    qty integer;
    unit numeric;
    stock_left integer;
    made boolean;
    cust jsonb;
    offer jsonb;
    rem jsonb;
    exl jsonb;
    ex jsonb;
    e jsonb;
    nm text;
    eq integer;
    extra_sum numeric;
    label text;
    opts jsonb;
    grp text := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    shop record;
    new_order uuid;
    num text;
    sub numeric;
    fees numeric;
    comm numeric;
    nshops integer;
    fee_total numeric;
    pool numeric;
    ngold integer;
    gi integer := 0;
    bonus numeric;
    result jsonb := '[]'::jsonb;
    grand numeric := 0;
    n integer := 0;
begin
    if uid is null then raise exception 'Connecte-toi pour commander' using errcode = '42501'; end if;
    if mode = 'test' and not public.is_admin() then
        raise exception 'Les commandes en ligne ouvrent très bientôt. Ton panier est conservé.';
    end if;
    -- Paiement Mobile Money à la livraison : la commande se passe sans paiement préalable
    if mode not in ('test', 'test_open', 'live') then
        raise exception 'Les commandes sont momentanément fermées. Ton panier est conservé.';
    end if;
    if not exists (select 1 from public.profiles where id = uid) then
        raise exception 'Ton profil est incomplet : déconnecte-toi puis reconnecte-toi, ou contacte Ouenze';
    end if;
    if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then raise exception 'Ton panier est vide'; end if;
    if jsonb_array_length(items) > 50 then raise exception 'Trop d''articles dans une seule commande (50 maximum)'; end if;
    -- Plus de carte : ville + quartier, Ouenze appelle le client pour confirmer l'adresse
    
    if (delivery->>'lat') is not null and abs((delivery->>'lat')::numeric) > 90 then raise exception 'Position invalide'; end if;
    if char_length(btrim(coalesce(delivery->>'phone', ''))) < 8 then raise exception 'Numéro de téléphone de livraison manquant'; end if;
    if coalesce(payment->>'method', '') not in ('mobile_money_cod', 'mobile_money', 'card', 'paypal') then raise exception 'Moyen de paiement non accepté'; end if;

    -- Lignes validées et prix recalculés, dans une table temporaire
    create temporary table if not exists _cart (
        shop_id uuid, product_id uuid, product_name text, variant_name text, variant_key text,
        quantity integer, unit_price numeric, options jsonb
    ) on commit drop;
    delete from _cart where true;  -- pg_safeupdate (Supabase) refuse un DELETE sans WHERE

    for it in select * from jsonb_array_elements(items) loop
        qty := coalesce((it->>'quantity')::integer, 0);
        if qty < 1 or qty > 99 then raise exception 'Quantité invalide (1 à 99)'; end if;
        select pr.id, pr.name, pr.price, pr.stock, pr.variants, pr.shop_id, pr.is_active,
               to_jsonb(pr) -> 'food_info' as food_info,
               s.is_active as shop_active, s.archived_at
          into p
          from public.products pr join public.shops s on s.id = pr.shop_id
         where pr.id = (it->>'product_id')::uuid;
        if p.id is null or coalesce(p.is_active, true) = false or coalesce(p.shop_active, true) = false or p.archived_at is not null then
            raise exception 'Un article n''est plus disponible : retire-le de ton panier';
        end if;
        v := null;
        if nullif(it->>'variant_key', '') is not null then
            select e.value into v from jsonb_array_elements(coalesce(p.variants->'items', '[]'::jsonb)) as e(value)
             where e.value->>'key' = it->>'variant_key' limit 1;
            if v is null then raise exception 'La version « % » de « % » n''existe plus', it->>'variant_key', p.name; end if;
        elsif jsonb_array_length(coalesce(p.variants->'items', '[]'::jsonb)) > 0 then
            raise exception 'Choisis une version pour « % »', p.name;
        end if;
        unit := coalesce(nullif((v->>'price')::numeric, 0), p.price);
        if unit is null or unit <= 0 then raise exception 'Prix manquant pour « % »', p.name; end if;
        -- Stock : 0 = non suivi (même règle que le site) ; produit préparé à la commande : jamais limité
        made := public.product_made_to_order(p.variants, p.food_info);
        stock_left := coalesce((v->>'stock')::integer, p.stock, 0);
        if not made and stock_left > 0 and qty > stock_left then
            raise exception 'Stock insuffisant pour « % » : % disponible(s)', p.name, stock_left;
        end if;

        -- Personnalisation (façon Glovo) : ingrédients retirés et suppléments, pris dans ce que le vendeur propose ;
        -- le prix des suppléments vient de la fiche produit, jamais du téléphone
        cust := it->'custom';
        offer := case when jsonb_typeof(p.variants->'custom') = 'object' then p.variants->'custom' else '{}'::jsonb end;
        rem := '[]'::jsonb;
        exl := '[]'::jsonb;
        extra_sum := 0;
        if jsonb_typeof(cust) = 'object' then
            if jsonb_typeof(cust->'remove') = 'array' then
                if jsonb_array_length(cust->'remove') > 30 then raise exception 'Trop d''ingrédients retirés pour « % »', p.name; end if;
                for nm in select x from jsonb_array_elements_text(cust->'remove') x loop
                    if not exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(offer->'remove') = 'array' then offer->'remove' else '[]'::jsonb end) y
                                    where y = nm) then
                        raise exception 'L''ingrédient « % » ne peut pas être retiré de « % »', nm, p.name;
                    end if;
                    if not rem @> to_jsonb(nm) then rem := rem || to_jsonb(nm); end if;
                end loop;
            end if;
            if jsonb_typeof(cust->'extras') = 'array' then
                if jsonb_array_length(cust->'extras') > 30 then raise exception 'Trop de suppléments pour « % »', p.name; end if;
                for e in select x from jsonb_array_elements(cust->'extras') x loop
                    ex := null;
                    select y into ex from jsonb_array_elements(case when jsonb_typeof(offer->'extras') = 'array' then offer->'extras' else '[]'::jsonb end) y
                     where y->>'name' = e->>'name' limit 1;
                    if ex is null then raise exception 'Le supplément « % » n''est plus proposé pour « % »', e->>'name', p.name; end if;
                    eq := coalesce((e->>'qty')::integer, 1);
                    if eq < 1 or eq > greatest(1, least(coalesce((ex->>'max')::integer, 1), 10)) then
                        raise exception 'Quantité invalide pour le supplément « % »', ex->>'name';
                    end if;
                    if exists (select 1 from jsonb_array_elements(exl) z where z->>'name' = ex->>'name') then continue; end if;
                    extra_sum := extra_sum + greatest(0, coalesce((ex->>'price')::numeric, 0)) * eq;
                    exl := exl || jsonb_build_object('name', ex->>'name', 'qty', eq, 'price', greatest(0, coalesce((ex->>'price')::numeric, 0)));
                end loop;
            end if;
        end if;
        unit := unit + extra_sum;
        -- Libellé lu par le vendeur et le livreur : « Grand · sans oignons · + fromage ×2 »
        label := nullif(concat_ws(' · ',
            v->>'key',
            (select string_agg('sans ' || lower(x), ', ') from jsonb_array_elements_text(rem) x),
            (select string_agg('+ ' || (x->>'name') || case when (x->>'qty')::int > 1 then ' ×' || (x->>'qty') else '' end, ', ')
               from jsonb_array_elements(exl) x)), '');
        opts := jsonb_strip_nulls(jsonb_build_object('variant_key', v->>'key',
            'remove', case when jsonb_array_length(rem) > 0 then rem end,
            'extras', case when jsonb_array_length(exl) > 0 then exl end));
        if opts = '{}'::jsonb then opts := null; end if;
        insert into _cart values (p.shop_id, p.id, p.name, label, v->>'key', qty, round(unit), opts);
    end loop;

    -- Une commande par boutique
    -- Livraison : 300 FCFA pour une boutique, 500 au total pour plusieurs (répartis)
    select count(distinct shop_id) into nshops from _cart;
    fee_total := public.delivery_total(nshops);
    -- Boutiques Or : 2 % de leurs articles reversés, partagés à parts égales entre elles
    select coalesce(sum(t.s * public.medal_vendor_share(t.m)), 0), count(*) filter (where public.medal_vendor_share(t.m) > 0)
      into pool, ngold
      from (select shop_id, sum(quantity * unit_price) as s, public.shop_medal(shop_id) as m from _cart group by shop_id) t;
    pool := round(pool);
    for shop in select c.shop_id, s.name from _cart c join public.shops s on s.id = c.shop_id group by c.shop_id, s.name order by s.name loop
        n := n + 1;
        select sum(quantity * unit_price) into sub from _cart where shop_id = shop.shop_id;
        fees := floor(fee_total / nshops) + case when n <= (fee_total - floor(fee_total / nshops) * nshops) then 1 else 0 end;
        comm := round(sub * public.shop_fee_rate(shop.shop_id));
        bonus := 0;
        if ngold > 0 and public.medal_vendor_share(public.shop_medal(shop.shop_id)) > 0 then
            gi := gi + 1;
            bonus := floor(pool / ngold) + case when gi <= (pool - floor(pool / ngold) * ngold) then 1 else 0 end;
        end if;
        num := 'OZ-' || to_char(now(), 'YYMMDD') || '-' || grp || '-' || n;
        insert into public.orders (client_id, order_number, subtotal, delivery_fees, service_fee, vendor_bonus, total, status, payment_method,
                                   payment_status, delivery_info, tracking_step)
        values (uid, num, sub, fees, comm, bonus, sub + comm + fees, 'pending', payment->>'method',
                case when mode like 'test%' then 'test' else 'cod' end,
                jsonb_build_object(
                    'lat', (delivery->>'lat')::numeric, 'lng', (delivery->>'lng')::numeric,
                    'country_code', left(delivery->>'country_code', 2), 'country', left(delivery->>'country', 60),
                    'city', left(delivery->>'city', 60), 'district', left(delivery->>'district', 60),
                    'street', left(delivery->>'street', 100), 'landmark', left(delivery->>'landmark', 300),
                    'phone', left(delivery->>'phone', 30),
                    'payment_operator', left(payment->>'operator', 40), 'payment_phone', left(payment->>'phone', 30),
                    'group', grp),
                1)
        returning id into new_order;
        insert into public.order_items (order_id, product_id, shop_id, product_name, variant_name, options, quantity, unit_price, total_price)
        select new_order, product_id, shop_id, product_name, variant_name,
               options,
               quantity, unit_price, quantity * unit_price
          from _cart where shop_id = shop.shop_id;
        result := result || jsonb_build_object('order_id', new_order, 'order_number', num, 'shop_id', shop.shop_id,
                                               'shop_name', shop.name, 'subtotal', sub, 'delivery_fees', fees, 'service_fee', comm, 'vendor_bonus', bonus, 'total', sub + comm + fees);
        grand := grand + sub + comm + fees;
    end loop;

    return jsonb_build_object('orders', result, 'total', grand, 'mode', mode, 'group', grp);
end;
$body$;

$fn$;
end $do$;

notify pgrst, 'reload schema';
