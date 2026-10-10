-- ============================================================
-- Candidatures livreurs : dossier, photos privées, validation par un admin
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- ============================================================

-- ---------- Admins ----------
-- Table séparée : on ne se fie PAS à profiles.user_type tant que la RLS de
-- profiles permet à chacun de modifier son propre type.
-- Seul le SQL Editor / la clé service_role peut y écrire (aucune policy d'écriture).
create table if not exists public.admin_users (
    user_id uuid primary key references auth.users (id) on delete cascade,
    created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;

drop policy if exists "admin_users: lecture de sa propre ligne" on public.admin_users;
create policy "admin_users: lecture de sa propre ligne" on public.admin_users
    for select to authenticated using (user_id = auth.uid());

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------- Candidatures ----------
create table if not exists public.delivery_applications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null unique references auth.users (id) on delete cascade,
    full_name text not null check (char_length(full_name) between 2 and 80),
    email text not null,
    phone text not null,
    country text not null,
    city text not null,
    district text not null,
    vehicle_type text not null check (vehicle_type in ('moto', 'voiture')),
    vehicle_brand text,
    plate_number text not null check (char_length(plate_number) between 3 and 15),
    license_number text not null check (char_length(license_number) between 4 and 30),
    license_expiry date not null,
    -- chemins dans le bucket privé delivery-docs : <user_id>/<fichier>
    profile_photo_path text not null,
    id_photo_path text not null,
    license_photo_path text not null,
    vehicle_photo_path text not null,
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    review_note text,
    reviewed_by uuid references auth.users (id),
    reviewed_at timestamptz,
    notified_at timestamptz,  -- dernier email envoyé à l'admin (anti-spam)
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
alter table public.delivery_applications add column if not exists notified_at timestamptz;
alter table public.delivery_applications enable row level security;

-- Le candidat : crée et lit SA candidature ; la corrige tant qu'elle n'est pas validée
drop policy if exists "livreur: créer sa candidature" on public.delivery_applications;
create policy "livreur: créer sa candidature" on public.delivery_applications
    for insert to authenticated
    with check (user_id = auth.uid() and status = 'pending' and reviewed_by is null);

drop policy if exists "livreur: lire sa candidature" on public.delivery_applications;
create policy "livreur: lire sa candidature" on public.delivery_applications
    for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "livreur: corriger sa candidature" on public.delivery_applications;
create policy "livreur: corriger sa candidature" on public.delivery_applications
    for update to authenticated
    using (user_id = auth.uid() and status in ('pending', 'rejected'))
    with check (user_id = auth.uid() and status = 'pending' and reviewed_by is null);

-- L'admin : lit et décide
drop policy if exists "admin: décider" on public.delivery_applications;
create policy "admin: décider" on public.delivery_applications
    for update to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
    new.updated_at := now();
    return new;
end;
$$;
drop trigger if exists delivery_applications_touch on public.delivery_applications;
create trigger delivery_applications_touch before update on public.delivery_applications
    for each row execute function public.touch_updated_at();

-- Validation : passe le compte en livreur. Fonction admin uniquement,
-- pour ne pas ouvrir la mise à jour de profiles à tout le monde.
create or replace function public.review_delivery_application(application_id uuid, decision text, note text default null)
returns public.delivery_applications
language plpgsql
security definer
set search_path = public
as $$
declare
    app public.delivery_applications;
begin
    if not public.is_admin() then
        raise exception 'Réservé aux administrateurs' using errcode = '42501';
    end if;
    if decision not in ('approved', 'rejected') then
        raise exception 'Décision invalide';
    end if;
    update public.delivery_applications
       set status = decision, review_note = note, reviewed_by = auth.uid(), reviewed_at = now()
     where id = application_id
     returning * into app;
    if app.id is null then
        raise exception 'Candidature introuvable';
    end if;
    if decision = 'approved' then
        update public.profiles set user_type = 'livreur' where id = app.user_id;
    end if;
    return app;
end;
$$;
revoke all on function public.review_delivery_application(uuid, text, text) from public;
grant execute on function public.review_delivery_application(uuid, text, text) to authenticated;

-- ---------- Photos : bucket PRIVÉ ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delivery-docs', 'delivery-docs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
    set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Chacun dépose et relit ses fichiers dans son dossier <user_id>/ ; les admins lisent tout
drop policy if exists "delivery-docs: déposer dans son dossier" on storage.objects;
create policy "delivery-docs: déposer dans son dossier" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'delivery-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "delivery-docs: remplacer ses fichiers" on storage.objects;
create policy "delivery-docs: remplacer ses fichiers" on storage.objects
    for update to authenticated
    using (bucket_id = 'delivery-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "delivery-docs: lire ses fichiers ou admin" on storage.objects;
create policy "delivery-docs: lire ses fichiers ou admin" on storage.objects
    for select to authenticated
    using (bucket_id = 'delivery-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

notify pgrst, 'reload schema';

-- ============================================================
-- APRÈS l'exécution : se déclarer admin (remplacer l'email) —
--   insert into public.admin_users (user_id)
--   select id from auth.users where email = 'stachyskyso@gmail.com'
--   on conflict do nothing;
-- ============================================================
