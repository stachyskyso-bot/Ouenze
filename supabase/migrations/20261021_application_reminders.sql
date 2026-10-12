-- ============================================================
-- Relance d'une demande vendeur ou d'une candidature livreur
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261011 (livreurs), 20261018 (notifications), 20261020 (vendeurs).
--
-- • Le demandeur dont la demande est toujours « en attente » peut relancer Ouenze,
--   au plus une fois toutes les 24 h : les admins reçoivent une notification sur le site
--   (et l'écran renvoie l'email via l'Edge Function).
-- • Les candidatures livreurs préviennent aussi les admins sur le site (comme les vendeurs).
-- ============================================================

alter table public.vendor_applications add column if not exists reminded_at timestamptz;
alter table public.delivery_applications add column if not exists reminded_at timestamptz;

-- kind : 'vendor' ou 'courier'. Renvoie la date de la relance.
create or replace function public.remind_my_application(kind text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
    a record;
    last_sent timestamptz;
    adm record;
begin
    if auth.uid() is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
    if kind = 'vendor' then
        select id, status, created_at, updated_at, reminded_at, full_name, phone, city, business_name as label
          into a from public.vendor_applications where user_id = auth.uid();
    elsif kind = 'courier' then
        select id, status, created_at, updated_at, reminded_at, full_name, phone, city,
               case when vehicle_type = 'voiture' then 'Voiture' else 'Moto' end || ' ' || plate_number as label
          into a from public.delivery_applications where user_id = auth.uid();
    else
        raise exception 'Type de demande invalide';
    end if;
    if a.id is null then raise exception 'Aucune demande à relancer'; end if;
    if a.status <> 'pending' then raise exception 'Ta demande a déjà reçu une réponse'; end if;

    last_sent := greatest(coalesce(a.reminded_at, a.created_at), coalesce(a.updated_at, a.created_at));
    if now() - last_sent < interval '24 hours' then
        raise exception 'Tu pourras relancer Ouenze à partir du %',
            to_char((last_sent + interval '24 hours') at time zone 'Africa/Brazzaville', 'DD/MM à HH24"h"MI');
    end if;

    if kind = 'vendor' then
        update public.vendor_applications set reminded_at = now() where id = a.id;
    else
        update public.delivery_applications set reminded_at = now() where id = a.id;
    end if;

    for adm in select user_id from public.admin_users loop
        perform public.notify_user(adm.user_id, kind || '_application',
            '🔔 Relance : ' || case when kind = 'vendor' then 'demande vendeur ' else 'candidature livreur ' end || a.label,
            a.full_name || ' · ' || a.phone || ' · ' || a.city || ' attend toujours une réponse (demande du '
                || to_char(a.created_at at time zone 'Africa/Brazzaville', 'DD/MM') || ').',
            null, null);
    end loop;
    return now();
end;
$$;
revoke all on function public.remind_my_application(text) from public, anon;
grant execute on function public.remind_my_application(text) to authenticated;

-- ---------- Candidature livreur → notification aux admins (comme pour les vendeurs) ----------
create or replace function public.notify_courier_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    adm record;
begin
    if new.status <> 'pending' or (tg_op = 'UPDATE' and old.status = 'pending') then
        return new;
    end if;
    for adm in select user_id from public.admin_users loop
        perform public.notify_user(adm.user_id, 'courier_application',
            'Candidature livreur : ' || new.full_name,
            new.phone || ' · ' || new.city || ' · ' || case when new.vehicle_type = 'voiture' then 'voiture' else 'moto' end
                || ' ' || new.plate_number || '. Vérifie le dossier puis valide ou refuse.',
            null, null);
    end loop;
    return new;
end;
$$;
drop trigger if exists delivery_applications_notify on public.delivery_applications;
create trigger delivery_applications_notify after insert or update of status on public.delivery_applications
    for each row execute function public.notify_courier_application();

notify pgrst, 'reload schema';
