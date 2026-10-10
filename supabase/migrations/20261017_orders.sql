-- ============================================================
-- Commandes : création côté serveur, décision du vendeur, mode test
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261011 (is_admin), 20261016_ratings.sql.
--
-- • Un panier multi-boutiques devient UNE commande PAR boutique : chaque vendeur
--   accepte ou refuse la sienne, chaque commande a un seul livreur.
-- • Les prix sont recalculés ici à partir de products (prix de la version si elle en a un) :
--   le navigateur n'envoie que des identifiants et des quantités.
-- • Mode « test » (par défaut) : seuls les admins peuvent commander, sans paiement,
--   commandes marquées payment_status = 'test'. Passer en 'live' quand pawaPay sera branché :
--     update public.app_settings set value = '"live"' where key = 'orders_mode';
-- ============================================================

-- ---------- Réglages de l'application ----------
create table if not exists public.app_settings (
    key text primary key,
    value jsonb not null,
    updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "réglages: lecture publique" on public.app_settings;
create policy "réglages: lecture publique" on public.app_settings for select using (true);
insert into public.app_settings (key, value) values ('orders_mode', '"test"') on conflict (key) do nothing;

create or replace function public.orders_mode()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select coalesce((select value #>> '{}' from public.app_settings where key = 'orders_mode'), 'test');
$$;
grant execute on function public.orders_mode() to anon, authenticated;

-- ---------- Création de la commande ----------
-- items    : [{"product_id": "...", "variant_key": "Bleu / M" | null, "quantity": 2}]
-- delivery : {lat, lng, country_code, country, city, district, street, landmark, phone}
-- payment  : {method: "mobile_money" | "paypal", operator, phone}
-- Retour   : {"orders": [{order_id, order_number, shop_id, shop_name, subtotal, delivery_fees, total}], "total": …, "mode": "test"}
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
    if mode not in ('test', 'test_open') then
        raise exception 'Le paiement en ligne doit être confirmé avant la commande';
    end if;
    if not exists (select 1 from public.profiles where id = uid) then
        raise exception 'Ton profil est incomplet : déconnecte-toi puis reconnecte-toi, ou contacte Ouenze';
    end if;
    if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then raise exception 'Ton panier est vide'; end if;
    if jsonb_array_length(items) > 50 then raise exception 'Trop d''articles dans une seule commande (50 maximum)'; end if;
    if (delivery->>'lat') is null or (delivery->>'lng') is null
       or abs((delivery->>'lat')::numeric) > 90 or abs((delivery->>'lng')::numeric) > 180 then
        raise exception 'Choisis ton adresse de livraison sur la carte';
    end if;
    if char_length(btrim(coalesce(delivery->>'phone', ''))) < 8 then raise exception 'Numéro de téléphone de livraison manquant'; end if;
    if char_length(btrim(coalesce(delivery->>'landmark', ''))) < 5 then raise exception 'Ajoute un repère pour le livreur'; end if;
    if coalesce(payment->>'method', '') not in ('mobile_money', 'paypal') then raise exception 'Moyen de paiement non accepté'; end if;

    -- Lignes validées et prix recalculés, dans une table temporaire
    create temporary table if not exists _cart (
        shop_id uuid, product_id uuid, product_name text, variant_name text, variant_key text,
        quantity integer, unit_price numeric
    ) on commit drop;
    delete from _cart;

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
                case when mode like 'test%' then 'test' else 'pending' end,
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

-- ---------- Commandes reçues par le vendeur connecté ----------
create or replace function public.vendor_orders()
returns table (
    order_id uuid, order_number text, shop_id uuid, shop_name text, status text, payment_status text,
    created_at timestamptz, subtotal numeric, delivery_fees numeric, total numeric,
    items jsonb, city text, district text, landmark text, client_name text, client_phone text, notes text,
    commission_rate numeric
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
           public.medal_commission(public.medal_for(coalesce(s.rating, 0), public.shop_delivered_orders(s.id), coalesce(s.is_verified, false)))
      from public.orders o
      join public.shops s on s.id = (select oi.shop_id from public.order_items oi where oi.order_id = o.id limit 1)
      left join auth.users u on u.id = o.client_id
     where s.owner_id = auth.uid()
     order by o.created_at desc
     limit 200;
$$;
revoke all on function public.vendor_orders() from public;
grant execute on function public.vendor_orders() to authenticated;

-- ---------- Le vendeur accepte, refuse, ou (en test) marque comme livrée ----------
create or replace function public.vendor_order_decision(target_order uuid, decision text, reason text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    o record;
begin
    select ord.id, ord.status, ord.payment_status into o
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
    elsif decision = 'delivered' and o.status = 'accepted' and o.payment_status = 'test' then
        -- Uniquement pour tester (comptabilité, notes) : en vrai, c'est le livreur qui confirme
        update public.orders set status = 'delivered', tracking_step = 6, updated_at = now() where id = o.id;
        return 'delivered';
    end if;
    raise exception 'Action impossible : la commande est « % »', o.status;
end;
$$;
revoke all on function public.vendor_order_decision(uuid, text, text) from public;
grant execute on function public.vendor_order_decision(uuid, text, text) to authenticated;

-- ---------- Le client annule tant que le vendeur n'a pas accepté ----------
create or replace function public.cancel_my_order(target_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.orders set status = 'cancelled', updated_at = now()
     where id = target_order and client_id = auth.uid() and status = 'pending';
    if not found then raise exception 'Commande introuvable ou déjà acceptée par le vendeur'; end if;
end;
$$;
revoke all on function public.cancel_my_order(uuid) from public;
grant execute on function public.cancel_my_order(uuid) to authenticated;

-- ---------- Notes : le livreur d'une commande est orders.deliverer_id ----------
create or replace function public.order_for_review(target_order uuid, out client uuid, out status text, out courier uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    begin
        execute 'select client_id::uuid, status::text from public.orders where id = $1' into client, status using target_order;
    exception when undefined_table or undefined_column then
        client := null;
    end;
    begin
        execute 'select deliverer_id::uuid from public.orders where id = $1' into courier using target_order;
    exception when undefined_column then
        courier := null;
    end;
end;
$$;
revoke all on function public.order_for_review(uuid) from public;

notify pgrst, 'reload schema';
