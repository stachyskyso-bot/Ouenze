-- ============================================================
-- Connexion des clients par numéro de téléphone + code SMS
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
--
-- Un client connecté par SMS n'a pas d'email : la colonne profiles.email doit
-- accepter une valeur vide, sinon la création du compte échoue
-- (« Database error saving new user »).
-- ============================================================

do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles' and column_name = 'email' and is_nullable = 'NO'
    ) then
        alter table public.profiles alter column email drop not null;
    end if;
end $$;

notify pgrst, 'reload schema';
