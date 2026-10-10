-- ============================================================
-- Notes après livraison : boutique et livreur
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261011_delivery_applications.sql, 20261015_medals.sql.
--
-- • Seul le client d'une commande LIVRÉE peut noter, une fois par boutique et une fois le livreur.
-- • La note de la boutique (shops.rating / total_ratings) se met à jour à chaque avis
--   → elle fait évoluer la médaille.
-- • Les livreurs les mieux notés reçoivent en priorité les commandes chères :
--     moins de 50 000 FCFA        : tous les livreurs validés
--     50 000 à 199 999 FCFA       : note ≥ 4   avec au moins 5 avis
--     200 000 FCFA et plus        : note ≥ 4,5 avec au moins 20 avis (téléphones, TV…)
-- ============================================================

create table if not exists public.shop_reviews (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null,
    shop_id uuid not null references public.shops (id) on delete cascade,
    client_id uuid not null references auth.users (id) on delete cascade,
    stars smallint not null check (stars between 1 and 5),
    comment text check (char_length(comment) <= 500),
    created_at timestamptz not null default now(),
    unique (order_id, shop_id)
);
alter table public.shop_reviews enable row level security;
create index if not exists shop_reviews_shop on public.shop_reviews (shop_id, created_at desc);

create table if not exists public.courier_reviews (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null unique,
    courier_id uuid not null references auth.users (id) on delete cascade,
    client_id uuid not null references auth.users (id) on delete cascade,
    stars smallint not null check (stars between 1 and 5),
    comment text check (char_length(comment) <= 500),
    created_at timestamptz not null default now()
);
alter table public.courier_reviews enable row level security;
create index if not exists courier_reviews_courier on public.courier_reviews (courier_id);

-- Lecture : le client voit ses avis ; le livreur voit les siens ; les admins voient tout.
-- Les avis publics des boutiques passent par shop_reviews_public() (sans identité complète).
drop policy if exists "avis boutique: auteur et admins" on public.shop_reviews;
create policy "avis boutique: auteur et admins" on public.shop_reviews
    for select to authenticated using (client_id = auth.uid() or public.is_admin());
drop policy if exists "avis livreur: auteur, livreur et admins" on public.courier_reviews;
create policy "avis livreur: auteur, livreur et admins" on public.courier_reviews
    for select to authenticated using (client_id = auth.uid() or courier_id = auth.uid() or public.is_admin());

-- ---------- Mise à jour de la note de la boutique à chaque avis ----------
create or replace function public.apply_shop_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.shops
       set rating = round((coalesce(rating, 0) * coalesce(total_ratings, 0) + new.stars)::numeric
                          / (coalesce(total_ratings, 0) + 1), 2),
           total_ratings = coalesce(total_ratings, 0) + 1
     where id = new.shop_id;
    return new;
end;
$$;
drop trigger if exists shop_reviews_apply on public.shop_reviews;
create trigger shop_reviews_apply after insert on public.shop_reviews
    for each row execute function public.apply_shop_review();

-- ---------- Infos d'une commande du client connecté (requête dynamique : schéma des commandes tolérant) ----------
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
        execute 'select courier_id::uuid from public.orders where id = $1' into courier using target_order;
    exception when undefined_column then
        courier := null;   -- pas encore de livreur enregistré sur les commandes
    end;
end;
$$;
revoke all on function public.order_for_review(uuid) from public;

-- ---------- Ce qu'il reste à noter pour une commande ----------
create or replace function public.order_review_status(target_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    o record;
    shops_json jsonb;
begin
    select * into o from public.order_for_review(target_order);
    if o.client is null or o.client <> auth.uid() then
        raise exception 'Commande introuvable' using errcode = '42501';
    end if;
    execute 'select coalesce(jsonb_agg(jsonb_build_object(''shop_id'', s.id, ''name'', s.name,
                    ''rated'', exists (select 1 from public.shop_reviews r where r.order_id = $1 and r.shop_id = s.id),
                    ''stars'', (select r.stars from public.shop_reviews r where r.order_id = $1 and r.shop_id = s.id))), ''[]''::jsonb)
               from public.shops s
              where s.id in (select distinct shop_id from public.order_items where order_id = $1)'
       into shops_json using target_order;
    return jsonb_build_object(
        'delivered', o.status = 'delivered',
        'shops', shops_json,
        'courier', o.courier is not null,
        'courier_rated', exists (select 1 from public.courier_reviews where order_id = target_order),
        'courier_stars', (select stars from public.courier_reviews where order_id = target_order)
    );
end;
$$;
revoke all on function public.order_review_status(uuid) from public;
grant execute on function public.order_review_status(uuid) to authenticated;

-- ---------- Le client note la commande ----------
-- shop_ratings : [{"shop_id": "...", "stars": 5, "comment": "..."}]
create or replace function public.rate_order(target_order uuid, shop_ratings jsonb, courier_stars integer default null, courier_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    o record;
    item jsonb;
    in_order boolean;
    saved integer := 0;
begin
    select * into o from public.order_for_review(target_order);
    if o.client is null or o.client <> auth.uid() then
        raise exception 'Commande introuvable' using errcode = '42501';
    end if;
    if o.status <> 'delivered' then
        raise exception 'Tu pourras noter dès que la commande sera livrée';
    end if;
    for item in select * from jsonb_array_elements(coalesce(shop_ratings, '[]'::jsonb)) loop
        if (item->>'stars') is null then continue; end if;
        if (item->>'stars')::int not between 1 and 5 then raise exception 'La note va de 1 à 5 étoiles'; end if;
        execute 'select exists (select 1 from public.order_items where order_id = $1 and shop_id = $2)'
           into in_order using target_order, (item->>'shop_id')::uuid;
        if not in_order then raise exception 'Cette boutique ne fait pas partie de la commande'; end if;
        insert into public.shop_reviews (order_id, shop_id, client_id, stars, comment)
        values (target_order, (item->>'shop_id')::uuid, auth.uid(), (item->>'stars')::smallint,
                nullif(left(btrim(coalesce(item->>'comment', '')), 500), ''))
        on conflict (order_id, shop_id) do nothing;
        if found then saved := saved + 1; end if;
    end loop;
    if courier_stars is not null then
        if courier_stars not between 1 and 5 then raise exception 'La note va de 1 à 5 étoiles'; end if;
        if o.courier is null then raise exception 'Aucun livreur enregistré pour cette commande'; end if;
        insert into public.courier_reviews (order_id, courier_id, client_id, stars, comment)
        values (target_order, o.courier, auth.uid(), courier_stars::smallint, nullif(left(btrim(coalesce(courier_comment, '')), 500), ''))
        on conflict (order_id) do nothing;
        if found then saved := saved + 1; end if;
    end if;
    return jsonb_build_object('saved', saved);
end;
$$;
revoke all on function public.rate_order(uuid, jsonb, integer, text) from public;
grant execute on function public.rate_order(uuid, jsonb, integer, text) to authenticated;

-- ---------- Avis publics d'une boutique (prénom seulement) ----------
create or replace function public.shop_reviews_public(target_shop uuid, max_rows integer default 20)
returns table (stars smallint, comment text, created_at timestamptz, author text)
language sql
stable
security definer
set search_path = public
as $$
    select r.stars, r.comment, r.created_at,
           coalesce(nullif(split_part(btrim(u.raw_user_meta_data->>'full_name'), ' ', 1), ''), 'Client')
      from public.shop_reviews r
      left join auth.users u on u.id = r.client_id
     where r.shop_id = target_shop
     order by r.created_at desc
     limit least(greatest(coalesce(max_rows, 20), 1), 50);
$$;
grant execute on function public.shop_reviews_public(uuid, integer) to anon, authenticated;

-- ---------- Note d'un livreur ----------
create or replace function public.courier_stats(target_courier uuid)
returns table (rating numeric, reviews integer)
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(round(avg(stars)::numeric, 2), 0), count(*)::integer
      from public.courier_reviews where courier_id = target_courier;
$$;
revoke all on function public.courier_stats(uuid) from public;
grant execute on function public.courier_stats(uuid) to authenticated;

-- ---------- Règle de priorité : ce livreur peut-il recevoir cette commande ? ----------
create or replace function public.courier_level_for_amount(order_amount numeric)
returns text
language sql
immutable
as $$
    select case when order_amount >= 200000 then 'high' when order_amount >= 50000 then 'medium' else 'standard' end;
$$;

create or replace function public.courier_can_take(rating numeric, reviews integer, order_amount numeric)
returns boolean
language sql
immutable
as $$
    select case public.courier_level_for_amount(order_amount)
        when 'high' then coalesce(rating, 0) >= 4.5 and coalesce(reviews, 0) >= 20
        when 'medium' then coalesce(rating, 0) >= 4.0 and coalesce(reviews, 0) >= 5
        else true
    end;
$$;
grant execute on function public.courier_level_for_amount(numeric) to anon, authenticated;
grant execute on function public.courier_can_take(numeric, integer, numeric) to anon, authenticated;

-- Livreurs à prévenir pour une commande, les mieux notés d'abord.
-- Réservé au serveur (Edge Function de répartition, clé service_role) et aux admins.
create or replace function public.couriers_for_order(order_amount numeric)
returns table (courier_id uuid, full_name text, phone text, city text, vehicle_type text, rating numeric, reviews integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if auth.uid() is not null and not public.is_admin() then
        raise exception 'Réservé au serveur et aux administrateurs' using errcode = '42501';
    end if;
    return query
    select a.user_id, a.full_name, a.phone, a.city, a.vehicle_type, st.rating, st.reviews
      from public.delivery_applications a
      cross join lateral public.courier_stats(a.user_id) st
     where a.status = 'approved'
       and public.courier_can_take(st.rating, st.reviews, order_amount)
     order by st.rating desc, st.reviews desc;
end;
$$;
revoke all on function public.couriers_for_order(numeric) from public;
grant execute on function public.couriers_for_order(numeric) to authenticated;

notify pgrst, 'reload schema';
