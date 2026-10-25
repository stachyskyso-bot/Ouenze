-- ============================================================
-- 20261107 — Suppression par Ouenze : 72 heures pour se justifier, puis effacement automatique
--
-- Boutique supprimée par un admin, ou compte supprimé par un admin :
--   • la personne est prévenue (notification) et voit le motif et l'heure limite ;
--   • elle a 72 heures pour envoyer sa justification (une fois, modifiable jusqu'à l'heure limite) ;
--   • un admin peut tout rétablir pendant ce délai, ou effacer tout de suite après lecture ;
--   • passé le délai, l'effacement se fait tout seul (toutes les heures, et à chaque ouverture
--     du tableau de bord admin).
--
-- Effacement = tout ce qui appartient à la personne disparaît (produits, photos, design, compta,
-- favoris, préférences, notifications, coordonnées). L'historique des commandes déjà passées reste,
-- rendu anonyme : il appartient aussi aux clients et sert de preuve de paiement (obligation légale,
-- voir la politique de confidentialité). Le compte ne peut plus se connecter.
--
-- Pendant les 72 heures, un compte supprimé ne peut ni commander ni ouvrir de boutique.
-- Relançable sans danger.
-- ============================================================

-- ---------- Colonnes ----------
alter table public.shops add column if not exists deletion_due_at timestamptz;
alter table public.shops add column if not exists deletion_appeal text;
alter table public.shops add column if not exists deletion_appeal_at timestamptz;
alter table public.shops add column if not exists purged_at timestamptz;

alter table public.profiles add column if not exists deletion_requested_at timestamptz;
alter table public.profiles add column if not exists deletion_due_at timestamptz;
alter table public.profiles add column if not exists deletion_reason text;
alter table public.profiles add column if not exists deletion_appeal text;
alter table public.profiles add column if not exists deletion_appeal_at timestamptz;
alter table public.profiles add column if not exists purged_at timestamptz;

-- Effacement automatique : drapeau de session posé par les fonctions système ci-dessous
create or replace function public.ouenze_system() returns boolean
language sql stable as $$ select coalesce(current_setting('ouenze.system', true), '') = '1' $$;

-- ---------- Boutiques : le délai démarre quand un admin supprime ----------
create or replace function public.shops_deletion_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if public.is_admin() or public.ouenze_system() then
        if old.archived_at is null and new.archived_at is not null and new.deletion_due_at is null then
            new.deletion_due_at := new.archived_at + interval '72 hours';
        elsif new.archived_at is null then
            new.deletion_due_at := null;
            new.deletion_appeal := null;
            new.deletion_appeal_at := null;
        end if;
        return new;
    end if;
    -- Vendeur : il ne touche ni au délai ni à l'effacement ; sa justification passe par shop_appeal
    new.deletion_due_at := old.deletion_due_at;
    new.purged_at := old.purged_at;
    new.deletion_appeal := old.deletion_appeal;
    new.deletion_appeal_at := old.deletion_appeal_at;
    return new;
end;
$$;
drop trigger if exists shops_deletion_window on public.shops;
create trigger shops_deletion_window before update on public.shops
    for each row execute function public.shops_deletion_window();

-- ---------- Profils : un client ne peut pas annuler sa propre suppression ----------
create or replace function public.profiles_deletion_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if public.is_admin() or public.ouenze_system() then return new; end if;
    new.deletion_requested_at := old.deletion_requested_at;
    new.deletion_due_at := old.deletion_due_at;
    new.deletion_reason := old.deletion_reason;
    new.deletion_appeal := old.deletion_appeal;
    new.deletion_appeal_at := old.deletion_appeal_at;
    new.purged_at := old.purged_at;
    if old.deletion_requested_at is not null then new.user_type := old.user_type; end if;
    return new;
end;
$$;
drop trigger if exists profiles_deletion_guard on public.profiles;
create trigger profiles_deletion_guard before update on public.profiles
    for each row execute function public.profiles_deletion_guard();

-- ---------- Compte en cours de suppression : pas de commande, pas de nouvelle boutique ----------
create or replace function public.block_deleted_accounts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare who uuid;
begin
    who := nullif(to_jsonb(new) ->> (case tg_table_name when 'orders' then 'client_id' else 'owner_id' end), '')::uuid;
    if exists (select 1 from public.profiles p where p.id = who and p.deletion_requested_at is not null) then
        raise exception 'Ce compte a été supprimé par Ouenze' using errcode = '42501';
    end if;
    return new;
end;
$$;
drop trigger if exists orders_block_deleted on public.orders;
create trigger orders_block_deleted before insert on public.orders
    for each row execute function public.block_deleted_accounts();
drop trigger if exists shops_block_deleted on public.shops;
create trigger shops_block_deleted before insert on public.shops
    for each row execute function public.block_deleted_accounts();

-- ---------- Ce que voit la personne : son compte et ses boutiques en attente ----------
create or replace function public.my_deletion_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'account', (select jsonb_build_object(
                        'reason', p.deletion_reason, 'requested_at', p.deletion_requested_at,
                        'due_at', p.deletion_due_at, 'appeal', p.deletion_appeal,
                        'appeal_at', p.deletion_appeal_at, 'purged', p.purged_at is not null)
                      from public.profiles p
                     where p.id = auth.uid() and p.deletion_requested_at is not null),
        'shops', coalesce((select jsonb_agg(jsonb_build_object(
                        'id', s.id, 'name', s.name, 'reason', s.archived_reason, 'archived_at', s.archived_at,
                        'due_at', s.deletion_due_at, 'appeal', s.deletion_appeal, 'appeal_at', s.deletion_appeal_at)
                        order by s.deletion_due_at)
                      from public.shops s
                     where s.owner_id = auth.uid() and s.archived_at is not null
                       and s.deletion_due_at is not null and s.purged_at is null), '[]'::jsonb)
    );
$$;
revoke all on function public.my_deletion_status() from public;
grant execute on function public.my_deletion_status() to authenticated;

-- ---------- Justifications ----------
create or replace function public.shop_appeal(target uuid, message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    s public.shops;
    msg text := nullif(left(btrim(coalesce(message, '')), 2000), '');
begin
    if auth.uid() is null then raise exception 'Connecte-toi' using errcode = '42501'; end if;
    select * into s from public.shops where id = target for update;
    if s.id is null or s.owner_id <> auth.uid() then raise exception 'Boutique introuvable'; end if;
    if s.deletion_due_at is null or s.purged_at is not null then raise exception 'Cette boutique n''est pas en attente de suppression'; end if;
    if now() > s.deletion_due_at then raise exception 'Le délai de 72 heures est dépassé'; end if;
    if msg is null or length(msg) < 10 then raise exception 'Écris ta justification (au moins quelques mots)'; end if;
    perform set_config('ouenze.system', '1', true);
    update public.shops set deletion_appeal = msg, deletion_appeal_at = now() where id = s.id;
    perform set_config('ouenze.system', '', true);
    insert into public.shop_admin_events (shop_id, actor_id, action, note) values (s.id, auth.uid(), 'appeal', left(msg, 300));
    perform public.notify_user(a.user_id, 'deletion_appeal', 'Justification reçue : ' || s.name,
            'Le vendeur a répondu à la suppression de sa boutique. À lire avant le ' ||
            to_char(s.deletion_due_at at time zone 'Africa/Brazzaville', 'DD/MM à HH24"h"MI') || '.', null, s.id)
       from public.admin_users a;
end;
$$;
revoke all on function public.shop_appeal(uuid, text) from public;
grant execute on function public.shop_appeal(uuid, text) to authenticated;

create or replace function public.account_appeal(message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    p public.profiles;
    msg text := nullif(left(btrim(coalesce(message, '')), 2000), '');
begin
    if auth.uid() is null then raise exception 'Connecte-toi' using errcode = '42501'; end if;
    select * into p from public.profiles where id = auth.uid() for update;
    if p.id is null or p.deletion_requested_at is null or p.purged_at is not null then
        raise exception 'Ce compte n''est pas en attente de suppression';
    end if;
    if now() > p.deletion_due_at then raise exception 'Le délai de 72 heures est dépassé'; end if;
    if msg is null or length(msg) < 10 then raise exception 'Écris ta justification (au moins quelques mots)'; end if;
    perform set_config('ouenze.system', '1', true);
    update public.profiles set deletion_appeal = msg, deletion_appeal_at = now() where id = p.id;
    perform set_config('ouenze.system', '', true);
    perform public.notify_user(a.user_id, 'deletion_appeal', 'Justification reçue : ' || coalesce(p.full_name, 'un compte'),
            'Une personne a répondu à la suppression de son compte. À lire avant le ' ||
            to_char(p.deletion_due_at at time zone 'Africa/Brazzaville', 'DD/MM à HH24"h"MI') || '.')
       from public.admin_users a;
end;
$$;
revoke all on function public.account_appeal(text) from public;
grant execute on function public.account_appeal(text) to authenticated;

-- ---------- Admin : supprimer ou rétablir un compte ----------
create or replace function public.admin_account_action(target uuid, action text, reason text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    p public.profiles;
    why text := nullif(left(btrim(coalesce(reason, '')), 300), '');
    active_status text[] := array['pending', 'accepted', 'courier_assigned', 'picked_up', 'in_transit'];
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    select * into p from public.profiles where id = target for update;
    if p.id is null then raise exception 'Compte introuvable'; end if;

    if action = 'delete' then
        if target = auth.uid() then raise exception 'Tu ne peux pas supprimer ton propre compte'; end if;
        if exists (select 1 from public.admin_users where user_id = target) then
            raise exception 'C''est un compte administrateur : retire-le d''abord des administrateurs';
        end if;
        if p.deletion_requested_at is not null then raise exception 'Compte déjà supprimé'; end if;
        if why is null then raise exception 'Indique le motif de la suppression'; end if;
        if exists (select 1 from public.orders o where o.status = any(active_status)
                    and (o.client_id = target or o.deliverer_id = target
                         or exists (select 1 from public.order_items oi join public.shops s on s.id = oi.shop_id
                                     where oi.order_id = o.id and s.owner_id = target))) then
            raise exception 'Ce compte a des commandes en cours : termine-les ou annule-les d''abord (Espace équipe).';
        end if;
        update public.profiles set deletion_requested_at = now(), deletion_due_at = now() + interval '72 hours',
               deletion_reason = why, deletion_appeal = null, deletion_appeal_at = null where id = target;
        -- Ses boutiques suivent le même délai
        update public.shops set archived_at = now(), archived_reason = 'Compte supprimé : ' || why, is_active = false,
               deletion_due_at = now() + interval '72 hours'
         where owner_id = target and archived_at is null;
        delete from public.team_members where user_id = target;
        perform public.notify_user(target, 'account_deleted', 'Ton compte Ouenze a été supprimé',
            'Motif : ' || why || '. Tu as 72 heures pour te justifier depuis Ouenze. Passé ce délai, tout sera effacé.');
    elsif action = 'restore' then
        if p.deletion_requested_at is null then raise exception 'Ce compte n''est pas supprimé'; end if;
        if p.purged_at is not null then raise exception 'Trop tard : ce compte a déjà été effacé'; end if;
        update public.profiles set deletion_requested_at = null, deletion_due_at = null, deletion_reason = null,
               deletion_appeal = null, deletion_appeal_at = null where id = target;
        update public.shops set archived_at = null, archived_reason = null, is_active = (suspended_at is null)
         where owner_id = target and archived_at is not null and purged_at is null
           and archived_reason like 'Compte supprimé : %';
        perform public.notify_user(target, 'account_restored', 'Ton compte Ouenze est rétabli',
            'Merci pour ta réponse. Ton compte et tes boutiques sont de nouveau actifs.');
    elsif action = 'purge_now' then
        if p.deletion_requested_at is null then raise exception 'Ce compte n''est pas supprimé'; end if;
        perform public.purge_account(target);
    else
        raise exception 'Action inconnue';
    end if;
    return action;
end;
$$;
revoke all on function public.admin_account_action(uuid, text, text) from public;
grant execute on function public.admin_account_action(uuid, text, text) to authenticated;

-- Effacer tout de suite une boutique déjà supprimée (après lecture de la justification)
create or replace function public.admin_shop_purge_now(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    if not exists (select 1 from public.shops where id = target and archived_at is not null and purged_at is null) then
        raise exception 'Cette boutique n''est pas en attente de suppression';
    end if;
    perform public.purge_shop(target);
    insert into public.shop_admin_events (shop_id, actor_id, action, note) values (target, auth.uid(), 'purge', 'Effacement définitif');
end;
$$;
revoke all on function public.admin_shop_purge_now(uuid) from public;
grant execute on function public.admin_shop_purge_now(uuid) to authenticated;

-- ---------- Effacement ----------
create or replace function public.purge_shop(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare s public.shops;
begin
    select * into s from public.shops where id = target for update;
    if s.id is null or s.purged_at is not null then return; end if;
    perform set_config('ouenze.system', '1', true);
    -- Produits et photos (les commandes passées gardent le nom et le prix des articles)
    delete from public.products where shop_id = target;
    delete from public.categories where shop_id = target;
    delete from public.favorites where kind = 'shop' and target_id = target;
    delete from public.vendor_entries where shop_id = target;
    -- La boutique reste comme une coquille anonyme pour l'historique des commandes
    update public.shops set
        name = 'Boutique supprimée ' || left(s.id::text, 8),
        is_active = false,
        archived_at = coalesce(archived_at, now()),
        deletion_appeal = null,
        purged_at = now()
     where id = target;
    -- Toutes les autres informations de la boutique (logo, design, description, contact…) : vidées
    perform public.null_columns('shops', target,
        array['id', 'name', 'owner_id', 'is_active', 'archived_at', 'archived_reason', 'created_at',
              'deletion_due_at', 'purged_at', 'suspended_at', 'suspended_reason', 'deletion_appeal_at']);
    perform set_config('ouenze.system', '', true);
end;
$$;
revoke all on function public.purge_shop(uuid) from public;

create or replace function public.purge_account(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare p public.profiles; sid uuid;
begin
    select * into p from public.profiles where id = target for update;
    if p.id is null or p.purged_at is not null then return; end if;
    perform set_config('ouenze.system', '1', true);
    for sid in select id from public.shops where owner_id = target and purged_at is null loop
        perform public.purge_shop(sid);
        perform set_config('ouenze.system', '1', true);
    end loop;
    delete from public.favorites where user_id = target;
    delete from public.user_taste where user_id = target;
    delete from public.app_notifications where user_id = target;
    delete from public.team_members where user_id = target;
    delete from public.courier_presence where courier_id = target;
    delete from public.vendor_applications where user_id = target;
    delete from public.delivery_applications where user_id = target;
    update public.profiles set full_name = 'Compte supprimé', deletion_appeal = null, purged_at = now() where id = target;
    perform public.null_columns('profiles', target,
        array['id', 'full_name', 'user_type', 'created_at', 'updated_at', 'deletion_requested_at', 'deletion_due_at',
              'deletion_reason', 'deletion_appeal_at', 'purged_at']);
    perform set_config('ouenze.system', '', true);
    -- Connexion impossible et identifiants effacés (tables de Supabase Auth, si accessibles)
    begin
        execute 'update auth.users set banned_until = ''infinity'', email = null, phone = null,
                 raw_user_meta_data = ''{}''::jsonb where id = $1' using target;
        if to_regclass('auth.identities') is not null then execute 'delete from auth.identities where user_id = $1' using target; end if;
        if to_regclass('auth.sessions') is not null then execute 'delete from auth.sessions where user_id = $1' using target; end if;
        if to_regclass('auth.refresh_tokens') is not null then execute 'delete from auth.refresh_tokens where user_id::text = $1::text' using target; end if;
    exception when others then
        raise notice 'Compte % : identifiants de connexion non effacés (%)', target, sqlerrm;
    end;
end;
$$;
revoke all on function public.purge_account(uuid) from public;

-- Met à NULL toutes les colonnes facultatives d'une ligne, sauf celles à garder
create or replace function public.null_columns(tbl text, target uuid, keep text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare cols text;
begin
    select string_agg(format('%I = null', column_name), ', ') into cols
      from information_schema.columns
     where table_schema = 'public' and table_name = tbl and is_nullable = 'YES'
       and column_name <> all(keep);
    if cols is not null then
        execute format('update public.%I set %s where id = $1', tbl, cols) using target;
    end if;
end;
$$;
revoke all on function public.null_columns(text, uuid, text[]) from public;

-- Toutes les suppressions dont le délai est passé
create or replace function public.purge_expired_deletions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer := 0; r record;
begin
    -- Appelable par le planificateur (sans utilisateur) ou par un admin
    if auth.uid() is not null and not public.is_admin() then
        raise exception 'Réservé aux administrateurs' using errcode = '42501';
    end if;
    for r in select id from public.profiles
              where deletion_requested_at is not null and purged_at is null and deletion_due_at <= now() loop
        perform public.purge_account(r.id); n := n + 1;
    end loop;
    for r in select id from public.shops
              where archived_at is not null and purged_at is null and deletion_due_at <= now() loop
        perform public.purge_shop(r.id); n := n + 1;
    end loop;
    return n;
end;
$$;
revoke all on function public.purge_expired_deletions() from public;
grant execute on function public.purge_expired_deletions() to authenticated;

-- ---------- Admin : suppressions en cours (pour le tableau de bord) ----------
create or replace function public.admin_deletions()
returns table (kind text, id uuid, name text, reason text, due_at timestamptz,
               appeal text, appeal_at timestamptz, owner_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    return query
        select 'account'::text, p.id, coalesce(p.full_name, 'Compte'), p.deletion_reason, p.deletion_due_at,
               p.deletion_appeal, p.deletion_appeal_at, p.id
          from public.profiles p
         where p.deletion_requested_at is not null and p.purged_at is null
        union all
        select 'shop'::text, s.id, s.name, s.archived_reason, s.deletion_due_at,
               s.deletion_appeal, s.deletion_appeal_at, s.owner_id
          from public.shops s
         where s.archived_at is not null and s.purged_at is null and s.deletion_due_at is not null
           and not exists (select 1 from public.profiles p where p.id = s.owner_id and p.deletion_requested_at is not null)
        order by 5;
end;
$$;
revoke all on function public.admin_deletions() from public;
grant execute on function public.admin_deletions() to authenticated;

-- ---------- Suppression d'une boutique par un admin : message avec le délai de 72 heures ----------
create or replace function public.admin_shop_action(target uuid, action text, reason text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    s public.shops;
    why text := nullif(left(btrim(coalesce(reason, '')), 300), '');
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    select * into s from public.shops where id = target for update;
    if s.id is null then raise exception 'Boutique introuvable'; end if;

    if action = 'suspend' then
        if s.archived_at is not null then raise exception 'Boutique supprimée : restaure-la d''abord'; end if;
        if s.suspended_at is not null then raise exception 'Boutique déjà suspendue'; end if;
        if why is null then raise exception 'Indique le motif de la suspension'; end if;
        update public.shops set suspended_at = now(), suspended_reason = why, is_active = false where id = s.id;
        perform public.notify_user(s.owner_id, 'shop_suspended', 'Ta boutique ' || s.name || ' est suspendue',
            'Motif : ' || why || '. Elle n''est plus visible sur Ouenze. Contacte Ouenze pour en parler.', null, s.id);
    elsif action = 'unsuspend' then
        if s.suspended_at is null then raise exception 'Cette boutique n''est pas suspendue'; end if;
        update public.shops set suspended_at = null, suspended_reason = null,
               is_active = (archived_at is null) where id = s.id;
        perform public.notify_user(s.owner_id, 'shop_restored', 'Ta boutique ' || s.name || ' est réactivée',
            'Elle est de nouveau visible sur Ouenze.', null, s.id);
    elsif action = 'archive' then
        if s.archived_at is not null then raise exception 'Boutique déjà supprimée'; end if;
        if why is null then raise exception 'Indique le motif de la suppression'; end if;
        if exists (select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
                    where oi.shop_id = s.id and o.status in ('pending', 'accepted', 'courier_assigned', 'picked_up', 'in_transit')) then
            raise exception 'Des commandes de cette boutique sont en cours : termine-les ou annule-les d''abord (Espace équipe).';
        end if;
        update public.shops set archived_at = now(), archived_reason = why, is_active = false where id = s.id;
        perform public.notify_user(s.owner_id, 'shop_suspended', 'Ta boutique ' || s.name || ' a été supprimée par Ouenze',
            'Motif : ' || why || '. Tu as 72 heures pour te justifier depuis ton espace vendeur. Passé ce délai, la boutique et ses produits seront effacés.', null, s.id);
    elsif action = 'restore' then
        if s.archived_at is null then raise exception 'Cette boutique n''est pas supprimée'; end if;
        if s.purged_at is not null then raise exception 'Trop tard : cette boutique a déjà été effacée'; end if;
        if exists (select 1 from public.shops x where x.archived_at is null and x.id <> s.id and lower(x.name) = lower(s.name)) then
            raise exception 'Une autre boutique active porte déjà ce nom';
        end if;
        update public.shops set archived_at = null, archived_reason = null, is_active = (suspended_at is null) where id = s.id;
        perform public.notify_user(s.owner_id, 'shop_restored', 'Ta boutique ' || s.name || ' est rétablie',
            'Elle est de nouveau sur Ouenze.', null, s.id);
    else
        raise exception 'Action inconnue';
    end if;

    insert into public.shop_admin_events (shop_id, actor_id, action, note) values (s.id, auth.uid(), action, why);
    return action;
end;
$$;

-- ---------- Planification : toutes les heures (pg_cron, si disponible) ----------
do $$
begin
    begin
        create extension if not exists pg_cron;
    exception when others then
        raise notice 'pg_cron indisponible : l''effacement se fera à l''ouverture du tableau de bord admin (%)', sqlerrm;
    end;
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        begin
            perform cron.unschedule(jobid) from cron.job where jobname = 'ouenze-purge-deletions';
            perform cron.schedule('ouenze-purge-deletions', '17 * * * *', 'select public.purge_expired_deletions()');
        exception when others then
            raise notice 'Planification impossible (%)', sqlerrm;
        end;
    end if;
end $$;
