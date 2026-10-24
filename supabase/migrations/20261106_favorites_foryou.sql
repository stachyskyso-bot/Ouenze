-- ============================================================
-- 20261106 — Favoris et sélection « Pour toi »
--
-- • favorites : boutiques et produits mis en favori par chaque client (chacun ne voit que les siens).
-- • user_taste : les goûts du client (catégories, boutiques, prix vus) pour retrouver
--   sa sélection « Pour toi » sur un autre téléphone. Mis à jour au plus toutes les quelques minutes.
-- • trending_products(city) : les produits les plus commandés sur 30 jours (aucune donnée personnelle).
-- Relançable sans danger.
-- ============================================================

create table if not exists public.favorites (
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    kind text not null check (kind in ('shop', 'product')),
    target_id uuid not null,
    created_at timestamptz not null default now(),
    primary key (user_id, kind, target_id)
);
create index if not exists favorites_target_idx on public.favorites (kind, target_id);

alter table public.favorites enable row level security;
drop policy if exists favorites_select_own on public.favorites;
create policy favorites_select_own on public.favorites for select to authenticated using (user_id = auth.uid());
drop policy if exists favorites_insert_own on public.favorites;
create policy favorites_insert_own on public.favorites for insert to authenticated with check (user_id = auth.uid());
drop policy if exists favorites_delete_own on public.favorites;
create policy favorites_delete_own on public.favorites for delete to authenticated using (user_id = auth.uid());
revoke all on public.favorites from anon;
grant select, insert, delete on public.favorites to authenticated;

create table if not exists public.user_taste (
    user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
    taste jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    constraint user_taste_size check (pg_column_size(taste) < 16000)
);
alter table public.user_taste enable row level security;
drop policy if exists user_taste_own on public.user_taste;
create policy user_taste_own on public.user_taste for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.user_taste from anon;
grant select, insert, update on public.user_taste to authenticated;

-- Nombre de favoris d'une boutique ou d'un produit (pour « 12 personnes aiment »), sans dire qui
create or replace function public.favorite_counts(ids uuid[])
returns table (target_id uuid, likes bigint)
language sql stable security definer set search_path = public
as $$
    select f.target_id, count(*)::bigint
    from public.favorites f
    where f.target_id = any(ids[1:200])
    group by f.target_id;
$$;
revoke all on function public.favorite_counts(uuid[]) from public;
grant execute on function public.favorite_counts(uuid[]) to anon, authenticated;

-- Produits les plus commandés sur 30 jours (commandes non annulées, hors tests)
create or replace function public.trending_products(city text default null)
returns table (product_id uuid, orders bigint, units bigint)
language sql stable security definer set search_path = public
as $$
    select oi.product_id, count(distinct oi.order_id)::bigint, coalesce(sum(oi.quantity), 0)::bigint
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.products p on p.id = oi.product_id
    join public.shops s on s.id = p.shop_id
    where o.created_at > now() - interval '30 days'
      and coalesce(o.status, '') not in ('cancelled', 'annulee', 'canceled')
      and coalesce(o.payment_status, '') <> 'test'
      and coalesce(p.is_active, true)
      and (city is null or city = '' or lower(coalesce(s.city, '')) = lower(city))
    group by oi.product_id
    order by 2 desc, 3 desc
    limit 60;
$$;
revoke all on function public.trending_products(text) from public;
grant execute on function public.trending_products(text) to anon, authenticated;

-- Catalogue léger pour l'accueil « Pour toi » : pas de photos (elles pèsent lourd),
-- seulement de quoi classer et afficher les cartes. Respecte la RLS (security invoker).
-- city : une ville (insensible à la casse) ou null pour toutes.
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
        (case when v.vcount > 0 then v.vstock else coalesce(b.stock, 0) end) <= 0 and coalesce(b.stock, 0) <> 0,
        coalesce(array_length(b.photos, 1), 0) > 0 or v.vphoto,
        b.created_at
    from base b join v on v.id = b.id;
$$;
grant execute on function public.product_feed(text, int) to anon, authenticated;

-- Première photo des produits affichés (30 au plus par appel)
create or replace function public.product_covers(ids uuid[])
returns table (id uuid, cover text)
language sql stable set search_path = public
as $$
    select p.id,
        coalesce(p.photos[1], (
            select x -> 'photos' ->> 0 from jsonb_array_elements(
                case when jsonb_typeof(p.variants -> 'items') = 'array' then p.variants -> 'items' else '[]'::jsonb end) x
            where jsonb_typeof(x -> 'photos') = 'array' and jsonb_array_length(x -> 'photos') > 0 limit 1))
    from public.products p
    where p.id = any(ids[1:30]);
$$;
grant execute on function public.product_covers(uuid[]) to anon, authenticated;
