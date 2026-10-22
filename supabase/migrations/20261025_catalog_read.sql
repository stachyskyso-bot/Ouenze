-- ============================================================
-- Lecture des catégories et produits (manquait : « new row violates row-level security
-- policy for table categories » à l'enregistrement, catégories invisibles après création).
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261023 (fonction owns_shop).
-- ============================================================

-- Les catégories d'une boutique sont publiques (menu de la boutique) ;
-- le vendeur relit toujours les siennes.
drop policy if exists "public_read_categories" on public.categories;
create policy "public_read_categories" on public.categories for select using (true);

-- Le vendeur relit toujours ses produits (même masqués) ; la lecture publique existante reste inchangée.
drop policy if exists "owner_read_products" on public.products;
create policy "owner_read_products" on public.products for select to authenticated
    using (public.owns_shop(shop_id));

notify pgrst, 'reload schema';
