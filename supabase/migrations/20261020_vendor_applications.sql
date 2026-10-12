-- ============================================================
-- Vendeurs validés par Ouenze (comme les livreurs)
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261011 (is_admin), 20261018 (notifications).
--
-- • Choisir « Vendre » ne rend plus vendeur : on envoie une DEMANDE (coordonnées + activité).
-- • L'admin reçoit la demande (email + notification sur le site), contacte la personne,
--   puis valide, refuse ou suspend depuis admin-vendors.html.
-- • La BASE refuse la création d'une boutique à un compte non validé (pas seulement l'écran),
--   et personne ne peut se donner lui-même le rôle vendeur ou livreur.
-- • Les vendeurs déjà présents (rôle vendeur ou propriétaires de boutique) sont validés d'office.
-- ============================================================

create table if not exists public.vendor_applications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null unique references auth.users (id) on delete cascade,
    full_name text not null check (char_length(full_name) between 2 and 80),
    email text not null,
    phone text not null check (char_length(phone) between 6 and 30),
    whatsapp text check (whatsapp is null or char_length(whatsapp) <= 30),
    city text not null check (char_length(city) between 2 and 60),
    district text check (district is null or char_length(district) <= 60),
    business_name text not null check (char_length(business_name) between 2 and 80),
    category text not null check (char_length(category) between 2 and 60),
    description text check (description is null or char_length(description) <= 1000),
    social_link text check (social_link is null or char_length(social_link) <= 300),
    has_physical_store boolean not null default false,
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
    review_note text,
    reviewed_by uuid references auth.users (id),
    reviewed_at timestamptz,
    notified_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
alter table public.vendor_applications enable row level security;

drop policy if exists "vendeur: créer sa demande" on public.vendor_applications;
create policy "vendeur: créer sa demande" on public.vendor_applications
    for insert to authenticated
    with check (user_id = auth.uid() and status = 'pending' and reviewed_by is null);

drop policy if exists "vendeur: lire sa demande" on public.vendor_applications;
create policy "vendeur: lire sa demande" on public.vendor_applications
    for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Le demandeur corrige sa demande tant qu'elle n'est pas validée (refusée → renvoyée en attente)
drop policy if exists "vendeur: corriger sa demande" on public.vendor_applications;
create policy "vendeur: corriger sa demande" on public.vendor_applications
    for update to authenticated
    using (user_id = auth.uid() and status in ('pending', 'rejected'))
    with check (user_id = auth.uid() and status = 'pending' and reviewed_by is null);

drop trigger if exists vendor_applications_touch on public.vendor_applications;
create trigger vendor_applications_touch before update on public.vendor_applications
    for each row execute function public.touch_updated_at();

-- ---------- Statut ----------
create or replace function public.is_approved_vendor(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (select 1 from public.vendor_applications where user_id = target and status = 'approved');
$$;
revoke all on function public.is_approved_vendor(uuid) from public, anon;
grant execute on function public.is_approved_vendor(uuid) to authenticated;

-- ---------- Décision de l'admin ----------
create or replace function public.review_vendor_application(application_id uuid, decision text, note text default null)
returns public.vendor_applications
language plpgsql
security definer
set search_path = public
as $$
declare
    app public.vendor_applications;
begin
    if not public.is_admin() then
        raise exception 'Réservé aux administrateurs' using errcode = '42501';
    end if;
    if decision not in ('approved', 'rejected', 'suspended') then
        raise exception 'Décision invalide';
    end if;
    update public.vendor_applications
       set status = decision, review_note = nullif(btrim(coalesce(note, '')), ''), reviewed_by = auth.uid(), reviewed_at = now()
     where id = application_id
     returning * into app;
    if app.id is null then raise exception 'Demande introuvable'; end if;

    if decision = 'approved' then
        update public.profiles set user_type = 'vendeur' where id = app.user_id and user_type is distinct from 'admin';
        update public.shops set is_active = true where owner_id = app.user_id and archived_at is null and is_active = false;
        perform public.notify_user(app.user_id, 'vendor_approved', 'Ta demande vendeur est validée 🎉',
            'Bienvenue chez les vendeurs Ouenze ! Tu peux maintenant créer ta boutique.', null, null);
    else
        update public.profiles set user_type = 'client' where id = app.user_id and user_type = 'vendeur';
        -- Suspendu : ses boutiques disparaissent du marché (réactivées s'il est de nouveau validé)
        if decision = 'suspended' then
            update public.shops set is_active = false where owner_id = app.user_id and archived_at is null;
        end if;
        perform public.notify_user(app.user_id, 'vendor_' || decision,
            case when decision = 'rejected' then 'Ta demande vendeur n''est pas retenue' else 'Ton compte vendeur est suspendu' end,
            coalesce('Motif : ' || app.review_note, 'Contacte Ouenze pour en savoir plus.'), null, null);
    end if;
    return app;
end;
$$;
revoke all on function public.review_vendor_application(uuid, text, text) from public;
grant execute on function public.review_vendor_application(uuid, text, text) to authenticated;

-- ---------- Notification aux admins à chaque demande (sans dépendre des emails) ----------
create or replace function public.notify_vendor_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    a record;
begin
    -- Seulement une vraie demande en attente (pas les vendeurs repris d'office, pas les décisions)
    if new.status <> 'pending' or (tg_op = 'UPDATE' and old.status = 'pending') then
        return new;
    end if;
    for a in select user_id from public.admin_users loop
        perform public.notify_user(a.user_id, 'vendor_application', 'Demande vendeur : ' || new.business_name,
            new.full_name || ' · ' || new.phone || ' · ' || new.city || ' — ' || new.category || '. Contacte-le puis valide ou refuse.',
            null, null);
    end loop;
    return new;
end;
$$;
drop trigger if exists vendor_applications_notify on public.vendor_applications;
create trigger vendor_applications_notify after insert or update of status on public.vendor_applications
    for each row execute function public.notify_vendor_application();

-- ---------- Garde-fous ----------
-- 1. Boutique : seulement pour un vendeur validé (ou un admin)
create or replace function public.guard_shop_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is not null and not public.is_admin() and not public.is_approved_vendor(new.owner_id) then
        raise exception 'Ta demande vendeur doit être validée par Ouenze avant de créer une boutique' using errcode = '42501';
    end if;
    return new;
end;
$$;
drop trigger if exists shops_guard_owner on public.shops;
create trigger shops_guard_owner before insert on public.shops
    for each row execute function public.guard_shop_owner();

-- 2. Rôle : personne ne se donne lui-même « vendeur », « livreur » ou « admin »
--    (inscription comprise ; l'admin et le SQL Editor gardent la main)
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'UPDATE' and new.user_type is not distinct from old.user_type then return new; end if;
    if tg_op = 'UPDATE' and (auth.uid() is null or public.is_admin()) then return new; end if;
    if new.user_type = 'vendeur' and not public.is_approved_vendor(new.id) then
        new.user_type := 'client';
    elsif new.user_type = 'livreur' and not exists (
        select 1 from public.delivery_applications where user_id = new.id and status = 'approved') then
        new.user_type := 'client';
    elsif new.user_type = 'admin' then
        new.user_type := 'client';
    end if;
    return new;
end;
$$;
drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role before insert or update of user_type on public.profiles
    for each row execute function public.guard_profile_role();

-- ---------- Vendeurs déjà présents : validés d'office ----------
-- (valeurs trop courtes remplacées : les contraintes de longueur doivent passer pour tout le monde)
create or replace function pg_temp.first_ok(vals text[], min_len integer, fallback text, max_len integer)
returns text language sql immutable as $f$
    select left(coalesce((select btrim(v) from unnest(vals) v where char_length(btrim(coalesce(v, ''))) >= min_len limit 1), fallback), max_len);
$f$;
insert into public.vendor_applications (user_id, full_name, email, phone, city, business_name, category, status, review_note, reviewed_at)
select u.id,
       pg_temp.first_ok(array[p.full_name, u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)], 2, 'Vendeur', 80),
       coalesce(u.email, ''),
       pg_temp.first_ok(array[u.raw_user_meta_data->>'phone'], 6, 'non renseigné', 30),
       pg_temp.first_ok(array[(select s.city from public.shops s where s.owner_id = u.id and s.city is not null limit 1),
                              u.raw_user_meta_data->>'city'], 2, 'Brazzaville', 60),
       pg_temp.first_ok(array[(select s.name from public.shops s where s.owner_id = u.id order by s.created_at limit 1)], 2, 'Boutique', 80),
       'Autre', 'approved', 'Vendeur existant avant la validation obligatoire', now()
  from auth.users u
  left join public.profiles p on p.id = u.id
 where p.user_type = 'vendeur' or exists (select 1 from public.shops s where s.owner_id = u.id)
on conflict (user_id) do nothing;

notify pgrst, 'reload schema';
