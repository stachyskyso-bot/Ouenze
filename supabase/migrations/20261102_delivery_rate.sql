-- ============================================================
-- Frais de livraison réglables (Espace équipe → onglet Équipe → Réglages)
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261026_simple_checkout.sql (place_order), 20261030_team_space.sql.
--
-- Avant : 10 % du montant des articles, écrit en dur. Maintenant : réglage « delivery_rate »
-- (10 % par défaut), lu par le site ET par la base au moment de la commande.
-- ============================================================

insert into public.app_settings (key, value) values ('delivery_rate', '0.10') on conflict (key) do nothing;

create or replace function public.delivery_rate()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
    select least(0.5, greatest(0, coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'delivery_rate'), 0.10)));
$$;
grant execute on function public.delivery_rate() to anon, authenticated;

-- La commande utilise le réglage (prix toujours recalculés côté serveur)
do $$
declare def text;
begin
    select pg_get_functiondef('public.place_order(jsonb, jsonb, jsonb)'::regprocedure) into def;
    if position('fees := round(sub * 0.10);' in def) > 0 then
        execute replace(def, 'fees := round(sub * 0.10);', 'fees := round(sub * public.delivery_rate());');
    end if;
end $$;

-- Admin : changer le pourcentage (0 à 50 %)
create or replace function public.set_delivery_rate(percent numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    if percent is null or percent < 0 or percent > 50 then raise exception 'Choisis un pourcentage entre 0 et 50'; end if;
    insert into public.app_settings (key, value, updated_at) values ('delivery_rate', to_jsonb(round(percent / 100, 4)), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
    return public.delivery_rate();
end;
$$;
revoke all on function public.set_delivery_rate(numeric) from public, anon;
grant execute on function public.set_delivery_rate(numeric) to authenticated;

notify pgrst, 'reload schema';
