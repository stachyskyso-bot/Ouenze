-- ============================================================
-- Produits : versions (taille, couleur, capacité…) et infos alimentaires
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- ============================================================

-- Versions d'un produit :
-- { "options": [{"name":"Couleur","values":["Noir","Blanc"]}, ...],
--   "items":   [{"key":"Noir / 128 Go","values":{"Couleur":"Noir","Capacité":"128 Go"},"price":450000,"stock":3}, ...] }
-- products.price reste le prix le plus bas (affichage « dès … FCFA »),
-- products.stock reste la somme des stocks des versions.
alter table public.products
    add column if not exists variants jsonb not null default '{}'::jsonb;

-- Infos alimentaires (null si le produit n'est pas un aliment) :
-- fait maison  → { "homemade": true,  "shelf_life_days": 3, "made_to_order": true, ... }
-- industriel   → { "homemade": false, "expiry_date": "2026-12-31", "expiry_type": "dlc"|"ddm", ... }
-- + storage ("ambiant"|"frais"|"congele"), weight, origin, ingredients, allergens
alter table public.products
    add column if not exists food_info jsonb;

-- Recharge le cache de schéma de l'API pour que les nouvelles colonnes soient visibles tout de suite
notify pgrst, 'reload schema';
