-- ============================================================
-- Commande avec le numéro de téléphone seulement
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261026_simple_checkout.sql.
--
-- Le quartier n'est plus demandé : Ouenze appelle le client pour savoir où livrer
-- (le numéro et le nom arrivent par email à chaque commande).
-- ============================================================

do $$
declare def text;
begin
    select pg_get_functiondef('public.place_order(jsonb, jsonb, jsonb)'::regprocedure) into def;
    if position('Indique ton quartier' in def) > 0 then
        def := replace(def,
            $q$if char_length(btrim(coalesce(delivery->>'district', ''))) < 2 then raise exception 'Indique ton quartier'; end if;$q$,
            '');
        execute def;
    end if;
end $$;

notify pgrst, 'reload schema';
