-- ============================================================
-- Boutiques : nom unique, archivage / suppression, transfert à un autre compte
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261011_delivery_applications.sql (fonction is_admin()).
-- ============================================================

alter table public.shops add column if not exists archived_at timestamptz;

-- ---------- Nom unique (sans tenir compte des majuscules ni des espaces) ----------
-- Si des doublons existent déjà, la migration s'arrête et les liste : renomme-les puis relance.
do $$
declare
    dups text;
begin
    select string_agg(format('« %s » (%s boutiques)', n, c), ', ')
      into dups
      from (select lower(btrim(name)) as n, count(*) as c
              from public.shops where archived_at is null
             group by 1 having count(*) > 1) d;
    if dups is not null then
        raise exception 'Noms de boutiques en double à renommer avant de relancer : %', dups;
    end if;
end $$;

create unique index if not exists shops_name_unique_active
    on public.shops (lower(btrim(name)))
    where archived_at is null;

-- Vérification avant publication (appelable par tout le monde, même non connecté)
create or replace function public.shop_name_available(shop_name text, exclude_shop uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select not exists (
        select 1 from public.shops
         where archived_at is null
           and lower(btrim(name)) = lower(btrim(shop_name))
           and (exclude_shop is null or id <> exclude_shop)
    );
$$;
grant execute on function public.shop_name_available(text, uuid) to anon, authenticated;

-- ---------- Archiver ou supprimer ----------
-- Boutique avec des ventes : archivée (masquée, historique conservé).
-- Boutique sans aucune vente : supprimée avec ses produits et catégories.
create or replace function public.close_shop(target_shop uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    owner uuid;
    has_sales boolean := false;
begin
    select owner_id into owner from public.shops where id = target_shop;
    if owner is null then
        raise exception 'Boutique introuvable';
    end if;
    if owner <> auth.uid() then
        raise exception 'Seul le propriétaire peut fermer cette boutique' using errcode = '42501';
    end if;

    begin
        execute 'select exists (select 1 from public.order_items where shop_id = $1)' into has_sales using target_shop;
    exception when undefined_table or undefined_column then
        has_sales := false;
    end;

    if has_sales then
        update public.shops set archived_at = now(), is_active = false where id = target_shop;
        update public.shop_transfers set status = 'cancelled' where shop_id = target_shop and status = 'pending';
        return 'archived';
    end if;

    delete from public.shop_transfers where shop_id = target_shop;
    delete from public.products where shop_id = target_shop;
    delete from public.categories where shop_id = target_shop;
    delete from public.shops where id = target_shop;
    return 'deleted';
end;
$$;
revoke all on function public.close_shop(uuid) from public;
grant execute on function public.close_shop(uuid) to authenticated;

-- ---------- Transfert (vente) d'une boutique ----------
-- Le jeton n'est jamais stocké en clair : seulement son empreinte SHA-256.
-- Création, envoi (email / SMS / WhatsApp) et acceptation passent par l'Edge Function
-- « shop-transfer » (clé service_role) ; le navigateur ne fait que lire.
create table if not exists public.shop_transfers (
    id uuid primary key default gen_random_uuid(),
    shop_id uuid not null references public.shops (id) on delete cascade,
    from_user uuid not null references auth.users (id),
    to_email text not null,
    to_phone text,
    price numeric(14, 0) check (price is null or price >= 0),
    token_hash text not null unique,
    status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled', 'expired')),
    expires_at timestamptz not null default now() + interval '72 hours',
    accepted_by uuid references auth.users (id),
    accepted_at timestamptz,
    channels jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);
alter table public.shop_transfers enable row level security;

-- Un seul transfert en cours par boutique
create unique index if not exists shop_transfers_one_pending
    on public.shop_transfers (shop_id) where status = 'pending';

drop policy if exists "transferts: le vendeur et les admins lisent" on public.shop_transfers;
create policy "transferts: le vendeur et les admins lisent" on public.shop_transfers
    for select to authenticated using (from_user = auth.uid() or public.is_admin());

notify pgrst, 'reload schema';
