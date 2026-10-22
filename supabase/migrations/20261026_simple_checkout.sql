-- ============================================================
-- Commande simplifiée : plus de carte, paiement Mobile Money À LA LIVRAISON
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261017 (commandes), 20261019 (livreurs), 20261022 (carte vendeur).
--
-- • Adresse = ville + quartier (+ repère facultatif). Ouenze reçoit par email le nom, le
--   numéro et l'adresse du client à chaque commande (Edge Function order-notify, ADMIN_EMAIL).
-- • Paiement : « mobile_money_cod ». Le client ne paie rien à la commande ; quand le livreur
--   a saisi le code de remise, le client reçoit la demande Mobile Money (CinetPay) et tape
--   son code secret. payment_status : 'test' (mode test) · 'cod' (à payer) · 'paid'.
-- • Mode « live » : tout le monde peut commander (plus de paiement en ligne préalable).
--   Ouverture au public le jour J :  update public.app_settings set value = '"live"' where key = 'orders_mode';
-- ============================================================

create or replace function public.place_order(items jsonb, delivery jsonb, payment jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    uid uuid := auth.uid();
    mode text := public.orders_mode();
    it jsonb;
    p record;
    v jsonb;
    qty integer;
    unit numeric;
    stock_left integer;
    grp text := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    shop record;
    new_order uuid;
    num text;
    sub numeric;
    fees numeric;
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
    if char_length(btrim(coalesce(delivery->>'district', ''))) < 2 then raise exception 'Indique ton quartier'; end if;
    if (delivery->>'lat') is not null and abs((delivery->>'lat')::numeric) > 90 then raise exception 'Position invalide'; end if;
    if char_length(btrim(coalesce(delivery->>'phone', ''))) < 8 then raise exception 'Numéro de téléphone de livraison manquant'; end if;
    if coalesce(payment->>'method', '') not in ('mobile_money_cod', 'mobile_money') then raise exception 'Moyen de paiement non accepté'; end if;

    -- Lignes validées et prix recalculés, dans une table temporaire
    create temporary table if not exists _cart (
        shop_id uuid, product_id uuid, product_name text, variant_name text, variant_key text,
        quantity integer, unit_price numeric
    ) on commit drop;
    delete from _cart where true;  -- pg_safeupdate (Supabase) refuse un DELETE sans WHERE

    for it in select * from jsonb_array_elements(items) loop
        qty := coalesce((it->>'quantity')::integer, 0);
        if qty < 1 or qty > 99 then raise exception 'Quantité invalide (1 à 99)'; end if;
        select pr.id, pr.name, pr.price, pr.stock, pr.variants, pr.shop_id, pr.is_active,
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
        -- Stock : 0 = non suivi (même règle que le site)
        stock_left := coalesce((v->>'stock')::integer, p.stock, 0);
        if stock_left > 0 and qty > stock_left then
            raise exception 'Stock insuffisant pour « % » : % disponible(s)', p.name, stock_left;
        end if;
        insert into _cart values (p.shop_id, p.id, p.name, v->>'key', v->>'key', qty, round(unit));
    end loop;

    -- Une commande par boutique
    for shop in select c.shop_id, s.name from _cart c join public.shops s on s.id = c.shop_id group by c.shop_id, s.name order by s.name loop
        n := n + 1;
        select sum(quantity * unit_price) into sub from _cart where shop_id = shop.shop_id;
        fees := round(sub * 0.10);
        num := 'OZ-' || to_char(now(), 'YYMMDD') || '-' || grp || '-' || n;
        insert into public.orders (client_id, order_number, subtotal, delivery_fees, total, status, payment_method,
                                   payment_status, delivery_info, tracking_step)
        values (uid, num, sub, fees, sub + fees, 'pending', payment->>'method',
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
               case when variant_key is null then null else jsonb_build_object('variant_key', variant_key) end,
               quantity, unit_price, quantity * unit_price
          from _cart where shop_id = shop.shop_id;
        result := result || jsonb_build_object('order_id', new_order, 'order_number', num, 'shop_id', shop.shop_id,
                                               'shop_name', shop.name, 'subtotal', sub, 'delivery_fees', fees, 'total', sub + fees);
        grand := grand + sub + fees;
    end loop;

    return jsonb_build_object('orders', result, 'total', grand, 'mode', mode, 'group', grp);
end;
$$;
revoke all on function public.place_order(jsonb, jsonb, jsonb) from public;
grant execute on function public.place_order(jsonb, jsonb, jsonb) to authenticated;

-- ---------- Livreurs : les commandes « à payer à la livraison » sont proposées aussi ----------
do $$
declare def text;
begin
    select pg_get_functiondef('public.available_deliveries()'::regprocedure) into def;
    if position($q$('test', 'paid')$q$ in def) > 0 then
        execute replace(def, $q$('test', 'paid')$q$, $q$('test', 'paid', 'cod')$q$);
    end if;
end $$;

notify pgrst, 'reload schema';
