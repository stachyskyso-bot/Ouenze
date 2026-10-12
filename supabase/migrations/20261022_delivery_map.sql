-- ============================================================
-- Livraison : carte obligatoire, contacts pour le livreur, boutiques proches
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261019 (livreurs), 20261020 (vendeurs).
--
-- • Une commande n'est « livrée » QUE par un livreur, avec le code du client :
--   le vendeur ne peut plus la marquer livrée lui-même (même en test).
-- • Le vendeur place sa boutique sur la carte (point + quartier) : sans ce point,
--   il ne peut pas accepter de commande (les livreurs ne sauraient pas où aller).
-- • Le livreur qui prend une course reçoit le numéro de commande, le nom, le téléphone
--   et l'email du client ET du vendeur (notification + espace livreur).
-- • nearby_shops : boutiques les plus proches d'une position (carte « Autour de moi »).
-- ============================================================

-- ---------- Le vendeur place sa boutique sur la carte ----------
create or replace function public.set_shop_place(target_shop uuid, new_lat numeric, new_lng numeric,
    new_district text, new_address text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if new_lat is null or new_lng is null or abs(new_lat) > 90 or abs(new_lng) > 180 then
        raise exception 'Place ta boutique sur la carte';
    end if;
    if char_length(btrim(coalesce(new_district, ''))) < 2 then
        raise exception 'Indique le quartier ou l''arrondissement de ta boutique';
    end if;
    update public.shops
       set lat = round(new_lat, 6), lng = round(new_lng, 6),
           district = left(btrim(new_district), 80),
           address = nullif(left(btrim(coalesce(new_address, '')), 200), '')
     where id = target_shop and owner_id = auth.uid();
    if not found then raise exception 'Boutique introuvable' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.set_shop_place(uuid, numeric, numeric, text, text) from public, anon;
grant execute on function public.set_shop_place(uuid, numeric, numeric, text, text) to authenticated;

drop function if exists public.my_shop_locations();
create or replace function public.my_shop_locations()
returns table (shop_id uuid, lat numeric, lng numeric, district text, address text)
language sql
stable
security definer
set search_path = public
as $$
    select id, lat, lng, district, address from public.shops where owner_id = auth.uid();
$$;
revoke all on function public.my_shop_locations() from public, anon;
grant execute on function public.my_shop_locations() to authenticated;

-- ---------- Décision du vendeur : accepter / refuser (plus de « livrée ») ----------
create or replace function public.vendor_order_decision(target_order uuid, decision text, reason text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    o record;
begin
    select ord.id, ord.status, sh.lat as shop_lat into o
      from public.orders ord
      join lateral (select s.lat from public.order_items oi join public.shops s on s.id = oi.shop_id
                     where oi.order_id = ord.id and s.owner_id = auth.uid() limit 1) sh on true
     where ord.id = target_order
     for update of ord;
    if o.id is null then raise exception 'Commande introuvable' using errcode = '42501'; end if;
    if decision = 'accept' and o.status = 'pending' then
        if o.shop_lat is null then
            raise exception 'Place d''abord ta boutique sur la carte (Tableau de bord → Point de retrait) : le livreur doit savoir où récupérer le colis.';
        end if;
        update public.orders set status = 'accepted', tracking_step = 2, updated_at = now() where id = o.id;
        return 'accepted';
    elsif decision = 'refuse' and o.status = 'pending' then
        update public.orders set status = 'refused', updated_at = now(),
               notes = nullif(left(btrim(coalesce(reason, '')), 300), '') where id = o.id;
        return 'refused';
    elsif decision = 'delivered' then
        raise exception 'Seul le livreur confirme la livraison, avec le code du client.';
    end if;
    raise exception 'Action impossible : la commande est « % »', o.status;
end;
$$;
revoke all on function public.vendor_order_decision(uuid, text, text) from public, anon;
grant execute on function public.vendor_order_decision(uuid, text, text) to authenticated;

-- ---------- Contacts d'une commande (client + vendeur) ----------
create or replace function public.order_contacts(target_order uuid,
    out order_number text, out shop_name text,
    out vendor_name text, out vendor_phone text, out vendor_email text,
    out client_name text, out client_phone text, out client_email text)
language sql
stable
security definer
set search_path = public
as $$
    select o.order_number, s.name::text,
           coalesce(va.full_name, vu.raw_user_meta_data->>'full_name', 'Vendeur'),
           coalesce(va.phone, vu.raw_user_meta_data->>'phone'),
           vu.email::text,
           coalesce(nullif(btrim(cu.raw_user_meta_data->>'full_name'), ''), 'Client'),
           coalesce(o.delivery_info->>'phone', cu.raw_user_meta_data->>'phone'),
           cu.email::text
      from public.orders o
      join lateral (select sh.* from public.order_items oi join public.shops sh on sh.id = oi.shop_id
                     where oi.order_id = o.id limit 1) s on true
      left join auth.users vu on vu.id = s.owner_id
      left join public.vendor_applications va on va.user_id = s.owner_id
      left join auth.users cu on cu.id = o.client_id
     where o.id = target_order;
$$;
revoke all on function public.order_contacts(uuid) from public, anon, authenticated;

-- ---------- Mes courses : contacts complets tant que la course est en cours ----------
drop function if exists public.my_deliveries();
create or replace function public.my_deliveries()
returns table (order_id uuid, order_number text, status text, is_test boolean, updated_at timestamptz,
               shop_name text, shop_address text, shop_lat numeric, shop_lng numeric,
               vendor_name text, vendor_phone text, vendor_email text,
               client_name text, client_phone text, client_email text,
               dropoff_area text, landmark text, client_lat numeric, client_lng numeric,
               amount numeric, fee numeric, items jsonb, stars integer, review text)
language sql
stable
security definer
set search_path = public
as $$
    select o.id, o.order_number, o.status, o.payment_status = 'test', o.updated_at,
           s.name::text, nullif(concat_ws(', ', nullif(s.address, ''), nullif(s.district, ''), s.city), ''), s.lat, s.lng,
           ct.vendor_name,
           case when live then ct.vendor_phone end,
           case when live then ct.vendor_email end,
           case when live then ct.client_name else split_part(ct.client_name, ' ', 1) end,
           case when live then ct.client_phone end,
           case when live then ct.client_email end,
           nullif(concat_ws(', ', nullif(o.delivery_info->>'street', ''), nullif(o.delivery_info->>'district', ''), o.delivery_info->>'city'), ''),
           case when live then o.delivery_info->>'landmark' end,
           (o.delivery_info->>'lat')::numeric, (o.delivery_info->>'lng')::numeric,
           coalesce(o.subtotal, o.total - coalesce(o.delivery_fees, 0)), coalesce(o.delivery_fees, 0),
           (select jsonb_agg(jsonb_build_object('name', oi.product_name, 'variant', oi.variant_name, 'quantity', oi.quantity))
              from public.order_items oi where oi.order_id = o.id),
           cr.stars::integer, cr.comment
      from public.orders o
      cross join lateral (select o.status in ('courier_assigned', 'in_transit', 'picked_up') as live) l
      join lateral (select sh.* from public.order_items oi join public.shops sh on sh.id = oi.shop_id
                     where oi.order_id = o.id limit 1) s on true
      cross join lateral public.order_contacts(o.id) ct
      left join public.courier_reviews cr on cr.order_id = o.id
     where o.deliverer_id = auth.uid()
     order by o.updated_at desc
     limit 100;
$$;
revoke all on function public.my_deliveries() from public, anon;
grant execute on function public.my_deliveries() to authenticated;

-- ---------- Boutiques les plus proches d'une position ----------
create or replace function public.nearby_shops(at_lat numeric, at_lng numeric, max_rows integer default 30)
returns table (shop_id uuid, name text, logo_url text, city text, district text, lat numeric, lng numeric,
               rating numeric, total_ratings integer, distance_km numeric)
language sql
stable
security definer
set search_path = public
as $$
    select s.id, s.name::text, s.logo_url::text, s.city::text, s.district::text, s.lat, s.lng,
           coalesce(s.rating, 0)::numeric, coalesce(s.total_ratings, 0)::integer,
           public.distance_km(at_lat, at_lng, s.lat, s.lng)
      from public.shops s
     where s.lat is not null and s.lng is not null
       and coalesce(s.is_active, true) and s.archived_at is null
     order by case when at_lat is null or at_lng is null then 0 else public.distance_km(at_lat, at_lng, s.lat, s.lng) end,
              s.rating desc nulls last
     limit least(greatest(coalesce(max_rows, 30), 1), 100);
$$;
grant execute on function public.nearby_shops(numeric, numeric, integer) to anon, authenticated;

-- ---------- Notifications : le livreur reçoit les contacts dès qu'il prend la course ----------
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
    ct record;
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
            perform public.notify_user(c.courier_id, 'delivery_offer', 'Nouvelle course ' || num,
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
        -- Le livreur : numéro de commande + contacts du vendeur et du client
        select * into ct from public.order_contacts(new.id);
        perform public.notify_user(new.deliverer_id, 'delivery_assigned', 'Course ' || num || ' : contacts',
            'Vendeur : ' || coalesce(ct.shop_name, '') || ' (' || coalesce(ct.vendor_name, '') || ') · '
                || coalesce(ct.vendor_phone, 'tél. inconnu') || ' · ' || coalesce(ct.vendor_email, '—')
            || E'\nClient : ' || coalesce(ct.client_name, '') || ' · ' || coalesce(ct.client_phone, 'tél. inconnu')
                || ' · ' || coalesce(ct.client_email, '—'),
            new.id, s.shop_id);
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
