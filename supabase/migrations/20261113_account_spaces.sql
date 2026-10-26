-- ============================================================
-- 20261113 — Mon compte : profil et espaces (client, vendeur, livreur)
--
-- • Chacun modifie son profil : nom, téléphone de contact, ville, photo.
-- • « Mes espaces » : un compte peut être client, vendeur validé et livreur validé à la fois.
--   profiles.home_space = l'espace ouvert au lancement de l'application (client, ou un espace
--   validé par l'équipe). profiles.user_type n'est pas modifié ici : il reste géré par les
--   validations de l'équipe. Devenir vendeur ou livreur passe toujours par une demande validée.
-- Relançable sans danger.
-- ============================================================

alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists country text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists home_space text;
do $$ begin
    alter table public.profiles add constraint profiles_home_space_check check (home_space is null or home_space in ('client', 'vendeur', 'livreur'));
exception when duplicate_object then null;
end $$;

-- Mon compte et l'état de mes espaces
create or replace function public.my_spaces()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    uid uuid := auth.uid();
    p public.profiles;
    v text;
    c text;
begin
    if uid is null then raise exception 'Connecte-toi' using errcode = '42501'; end if;
    select * into p from public.profiles where id = uid;
    select status into v from public.vendor_applications where user_id = uid;
    select status into c from public.delivery_applications where user_id = uid;
    return jsonb_build_object(
        'type', coalesce(p.user_type, 'client'),
        'home', coalesce(p.home_space, case when p.user_type in ('vendeur', 'livreur') then p.user_type else 'client' end),
        'full_name', p.full_name,
        'phone', to_jsonb(p) ->> 'phone',
        'city', to_jsonb(p) ->> 'city',
        'avatar_url', to_jsonb(p) ->> 'avatar_url',
        'vendor', coalesce(v, 'none'),
        'courier', coalesce(c, 'none'),
        'shops', (select count(*) from public.shops s where s.owner_id = uid and s.archived_at is null),
        'admin', public.is_admin()
    );
end;
$$;
revoke all on function public.my_spaces() from public, anon;
grant execute on function public.my_spaces() to authenticated;

-- Espace ouvert au lancement : client, ou un espace validé (vendeur / livreur)
create or replace function public.set_my_home_space(target text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
    uid uuid := auth.uid();
    now_type text;
begin
    if uid is null then raise exception 'Connecte-toi' using errcode = '42501'; end if;
    target := lower(coalesce(target, ''));
    if target not in ('client', 'vendeur', 'livreur') then raise exception 'Espace inconnu'; end if;
    select user_type into now_type from public.profiles where id = uid;
    if now_type = 'admin' or public.is_admin() then raise exception 'Un compte administrateur garde son espace admin'; end if;
    if target = 'vendeur' and not public.is_approved_vendor(uid) then
        raise exception 'Ton espace vendeur n''est pas encore validé : fais une demande « Devenir vendeur »';
    end if;
    if target = 'livreur' and not exists (select 1 from public.delivery_applications where user_id = uid and status = 'approved') then
        raise exception 'Ton espace livreur n''est pas encore validé : fais une demande « Devenir livreur »';
    end if;
    update public.profiles set home_space = target where id = uid;
    if not found then raise exception 'Profil introuvable'; end if;
    return target;
end;
$$;
revoke all on function public.set_my_home_space(text) from public, anon;
grant execute on function public.set_my_home_space(text) to authenticated;

-- Modifier mon profil
create or replace function public.update_my_profile(name text, phone text default null, city text default null, avatar text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
    uid uuid := auth.uid();
begin
    if uid is null then raise exception 'Connecte-toi' using errcode = '42501'; end if;
    name := regexp_replace(btrim(coalesce(name, '')), '\s+', ' ', 'g');
    if char_length(name) < 2 or char_length(name) > 80 or name !~ '[[:alpha:]]' then
        raise exception 'Indique ton nom (2 à 80 caractères)';
    end if;
    phone := nullif(btrim(coalesce(phone, '')), '');
    if phone is not null and (phone !~ '^\+?[0-9 .-]+$' or char_length(regexp_replace(phone, '[^0-9]', '', 'g')) < 6
                              or char_length(phone) > 20) then
        raise exception 'Numéro de téléphone invalide';
    end if;
    city := nullif(btrim(coalesce(city, '')), '');
    if city is not null and char_length(city) > 60 then raise exception 'Ville trop longue'; end if;
    avatar := nullif(btrim(coalesce(avatar, '')), '');
    if avatar is not null and not (
        (avatar ~ '^data:image/(jpeg|png|webp);base64,' and char_length(avatar) <= 150000)
        or (avatar ~ '^https://' and char_length(avatar) <= 1000)) then
        raise exception 'Photo invalide ou trop lourde';
    end if;
    update public.profiles
       set full_name = name, phone = update_my_profile.phone, city = update_my_profile.city, avatar_url = avatar
     where id = uid;
    if not found then raise exception 'Profil introuvable'; end if;
    return public.my_spaces();
end;
$$;
revoke all on function public.update_my_profile(text, text, text, text) from public, anon;
grant execute on function public.update_my_profile(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
