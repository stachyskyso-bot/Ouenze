-- ============================================================
-- 20261108 — Le vendeur modifie sa boutique (design, logo, description…)
--
-- Constat : la modification directe de la table shops était refusée sans erreur
-- (règles d'accès de la base), alors que l'ajout de produits passait.
-- update_my_shop vérifie que la personne connectée est la propriétaire,
-- puis enregistre seulement les champs autorisés. Les protections existantes
-- (suspension, suppression par Ouenze) restent appliquées par les déclencheurs.
-- Relançable sans danger.
-- ============================================================

create or replace function public.update_my_shop(target uuid, fields jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    s public.shops;
    allowed text[] := array['name', 'description', 'logo_url', 'city', 'district', 'address', 'show_search_bar', 'design'];
    k text;
    sets text := '';
begin
    if auth.uid() is null then raise exception 'Connecte-toi' using errcode = '42501'; end if;
    if jsonb_typeof(fields) is distinct from 'object' then raise exception 'Données invalides'; end if;
    select * into s from public.shops where id = target for update;
    if s.id is null or s.owner_id is distinct from auth.uid() then
        raise exception 'Boutique introuvable ou pas à toi' using errcode = '42501';
    end if;
    if s.archived_at is not null then raise exception 'Cette boutique a été supprimée'; end if;
    if exists (select 1 from public.profiles p where p.id = auth.uid() and p.deletion_requested_at is not null) then
        raise exception 'Ce compte a été supprimé par Ouenze' using errcode = '42501';
    end if;
    if fields ? 'name' and nullif(btrim(fields ->> 'name'), '') is null then
        raise exception 'Le nom de la boutique est obligatoire';
    end if;

    foreach k in array allowed loop
        if fields ? k and exists (select 1 from information_schema.columns
                                   where table_schema = 'public' and table_name = 'shops' and column_name = k) then
            sets := sets || format('%I = (jsonb_populate_record(null::public.shops, $1)).%I, ', k, k);
        end if;
    end loop;
    if sets = '' then return s.id; end if;
    execute format('update public.shops set %s where id = $2', left(sets, length(sets) - 2)) using fields, target;
    return s.id;
end;
$$;
revoke all on function public.update_my_shop(uuid, jsonb) from public;
grant execute on function public.update_my_shop(uuid, jsonb) to authenticated;
