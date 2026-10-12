-- ============================================================
-- Produits : fiche « Beauté et soins » + modification des catégories et produits
-- après la création de la boutique.
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- ============================================================

-- Infos beauté / soins (null si le produit n'en est pas un) :
-- { "kind": "visage"|"corps"|"cheveux"|"maquillage"|"parfum"|"hygiene"|"ongles"|"autre",
--   "targets": ["Tous types", "Peau sèche", …], "volume": "50 ml", "brand": "…",
--   "ingredients": "…", "usage": "…", "precautions": "…",
--   "expiry_date": "2027-06-30", "pao_months": 12, "origin": "…", "authentic": true }
alter table public.products add column if not exists beauty_info jsonb;

-- Le vendeur gère les catégories et produits de SES boutiques (ajout, modification, suppression).
-- Ces règles s'ajoutent aux règles existantes : elles n'en retirent aucune.
create or replace function public.owns_shop(target_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (select 1 from public.shops where id = target_shop and owner_id = auth.uid());
$$;
revoke all on function public.owns_shop(uuid) from public, anon;
grant execute on function public.owns_shop(uuid) to authenticated;

drop policy if exists "owner_insert_categories" on public.categories;
drop policy if exists "owner_update_categories" on public.categories;
drop policy if exists "owner_delete_categories" on public.categories;
create policy "owner_insert_categories" on public.categories for insert to authenticated
    with check (public.owns_shop(shop_id));
create policy "owner_update_categories" on public.categories for update to authenticated
    using (public.owns_shop(shop_id)) with check (public.owns_shop(shop_id));
create policy "owner_delete_categories" on public.categories for delete to authenticated
    using (public.owns_shop(shop_id));

drop policy if exists "owner_insert_products" on public.products;
drop policy if exists "owner_update_products" on public.products;
drop policy if exists "owner_delete_products" on public.products;
create policy "owner_insert_products" on public.products for insert to authenticated
    with check (public.owns_shop(shop_id));
create policy "owner_update_products" on public.products for update to authenticated
    using (public.owns_shop(shop_id)) with check (public.owns_shop(shop_id));
create policy "owner_delete_products" on public.products for delete to authenticated
    using (public.owns_shop(shop_id));

notify pgrst, 'reload schema';
