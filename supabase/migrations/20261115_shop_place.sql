-- ============================================================
-- 20261115 — Point de retrait des boutiques (réinstallation sûre)
--
-- « Où se trouve ta boutique ? » enregistre la position avec set_shop_place
-- (créée à l'origine par 20261022_delivery_map.sql, absente du fichier unique).
-- Ce fichier la réinstalle seule, sans toucher au reste de 20261022.
-- Relançable sans danger.
-- ============================================================

alter table public.shops add column if not exists lat numeric;
alter table public.shops add column if not exists lng numeric;
alter table public.shops add column if not exists district text;
alter table public.shops add column if not exists address text;

-- Le vendeur place sa boutique sur la carte
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

-- Positions de mes boutiques (tableau de bord vendeur)
drop function if exists public.my_shop_locations();
create function public.my_shop_locations()
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

-- Carte « Autour de moi » (si la distance est disponible : migration 20261019)
do $do$
begin
    if to_regprocedure('public.distance_km(numeric, numeric, numeric, numeric)') is null then
        raise notice 'distance_km absente : carte « Autour de moi » non réinstallée';
        return;
    end if;
    execute $fn$
    create or replace function public.nearby_shops(at_lat numeric, at_lng numeric, max_rows integer default 30)
    returns table (shop_id uuid, name text, logo_url text, city text, district text, lat numeric, lng numeric,
                   rating numeric, total_ratings integer, distance_km numeric)
    language sql
    stable
    security definer
    set search_path = public
    as $body$
        select s.id, s.name::text, s.logo_url::text, s.city::text, s.district::text, s.lat, s.lng,
               coalesce(s.rating, 0)::numeric, coalesce(s.total_ratings, 0)::integer,
               public.distance_km(at_lat, at_lng, s.lat, s.lng)
          from public.shops s
         where s.lat is not null and s.lng is not null
           and coalesce(s.is_active, true) and s.archived_at is null
           and (to_jsonb(s) ->> 'suspended_at') is null
         order by case when at_lat is null or at_lng is null then 0 else public.distance_km(at_lat, at_lng, s.lat, s.lng) end,
                  s.rating desc nulls last
         limit least(greatest(coalesce(max_rows, 30), 1), 100);
    $body$;
    $fn$;
    execute 'grant execute on function public.nearby_shops(numeric, numeric, integer) to anon, authenticated';
end $do$;

notify pgrst, 'reload schema';
