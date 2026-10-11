-- ============================================================
-- Notifications dans le site (cloche + page notifications.html)
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261016_ratings.sql, 20261017_orders.sql.
--
-- Les notifications sont créées par la base elle-même (triggers), jamais par le navigateur :
--   • nouvelle commande          → le vendeur (il peut accepter / refuser depuis la page)
--   • commande annulée           → le vendeur
--   • acceptée / refusée / livreur / livrée → le client
--   • nouvel avis sur la boutique → le vendeur
--   • nouvel avis sur le livreur  → le livreur
-- Elles complètent les emails : si un email n'arrive pas (boîte pleine, spam), l'info reste ici.
-- ============================================================

create table if not exists public.notifications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    kind text not null,
    title text not null,
    body text,
    order_id uuid,
    shop_id uuid,
    created_at timestamptz not null default now(),
    read_at timestamptz
);
alter table public.notifications enable row level security;
create index if not exists notifications_user on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread on public.notifications (user_id) where read_at is null;

-- Lecture de ses propres notifications ; aucune écriture directe (tout passe par les fonctions)
drop policy if exists "notifications: lecture des siennes" on public.notifications;
create policy "notifications: lecture des siennes" on public.notifications
    for select to authenticated using (user_id = auth.uid());

-- ---------- Outils internes ----------
create or replace function public.fcfa(amount numeric)
returns text
language sql
immutable
as $$
    select replace(to_char(round(coalesce(amount, 0)), 'FM999,999,999,990'), ',', ' ') || ' FCFA';
$$;

create or replace function public.notify_user(target uuid, kind text, title text, body text,
                                              target_order uuid default null, target_shop uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if target is null then return; end if;
    -- Pas de doublon pour un même événement de commande
    if target_order is not null and exists (
        select 1 from public.notifications n
         where n.user_id = target and n.kind = notify_user.kind and n.order_id = target_order) then
        return;
    end if;
    insert into public.notifications (user_id, kind, title, body, order_id, shop_id)
    values (target, kind, left(title, 140), left(body, 600), target_order, target_shop);
end;
$$;
revoke all on function public.notify_user(uuid, text, text, text, uuid, uuid) from public, anon, authenticated;

-- Boutique d'une commande (une commande = une boutique)
create or replace function public.order_shop(target_order uuid, out shop_id uuid, out shop_name text, out owner_id uuid)
language sql
stable
security definer
set search_path = public
as $$
    select s.id, s.name::text, s.owner_id
      from public.order_items oi join public.shops s on s.id = oi.shop_id
     where oi.order_id = target_order
     limit 1;
$$;
revoke all on function public.order_shop(uuid) from public, anon, authenticated;

-- ---------- Nouvelle commande → vendeur ----------
create or replace function public.notify_new_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    o record;
    s record;
    nb integer;
begin
    select id, order_number, subtotal, total, payment_status, status into o from public.orders where id = new.order_id;
    if o.id is null or o.status <> 'pending' then return new; end if;
    select * into s from public.order_shop(o.id);
    select coalesce(sum(quantity), 0) into nb from public.order_items where order_id = o.id;
    perform public.notify_user(s.owner_id, 'new_order',
        'Nouvelle commande ' || coalesce(o.order_number, '') || case when o.payment_status = 'test' then ' (TEST)' else '' end,
        s.shop_name || ' · ' || nb || ' article' || case when nb > 1 then 's' else '' end || ' · '
            || public.fcfa(coalesce(o.subtotal, o.total)) || '. Accepte-la ou refuse-la.',
        o.id, s.shop_id);
    return new;
end;
$$;
drop trigger if exists order_items_notify on public.order_items;
create trigger order_items_notify after insert on public.order_items
    for each row execute function public.notify_new_order();

-- ---------- Changement de statut → client (ou vendeur si le client annule) ----------
create or replace function public.notify_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    s record;
    num text := coalesce(new.order_number, '');
begin
    if new.status is not distinct from old.status then return new; end if;
    select * into s from public.order_shop(new.id);
    if new.status = 'accepted' then
        perform public.notify_user(new.client_id, 'order_accepted', 'Commande ' || num || ' acceptée',
            coalesce(s.shop_name, 'Le vendeur') || ' prépare ta commande. Un livreur va la récupérer.', new.id, s.shop_id);
    elsif new.status = 'refused' then
        perform public.notify_user(new.client_id, 'order_refused', 'Commande ' || num || ' refusée',
            coalesce(s.shop_name, 'Le vendeur') || ' ne peut pas la préparer'
            || coalesce(' : ' || nullif(btrim(new.notes), ''), '.')
            || case when new.payment_status = 'paid' then ' Tu seras remboursé.' else '' end, new.id, s.shop_id);
    elsif new.status = 'courier_assigned' then
        perform public.notify_user(new.client_id, 'order_courier', 'Un livreur arrive pour ' || num,
            'Il va récupérer ta commande chez ' || coalesce(s.shop_name, 'le vendeur') || '.', new.id, s.shop_id);
    elsif new.status in ('picked_up', 'in_transit') then
        perform public.notify_user(new.client_id, 'order_in_transit', 'Commande ' || num || ' en route',
            'Ton livreur a récupéré la commande. Suis son trajet dans Suivi livraison.', new.id, s.shop_id);
    elsif new.status = 'delivered' then
        perform public.notify_user(new.client_id, 'order_delivered', 'Commande ' || num || ' livrée',
            'Donne ta note à ' || coalesce(s.shop_name, 'la boutique') || ' et au livreur : ton avis aide les autres clients.',
            new.id, s.shop_id);
    elsif new.status = 'cancelled' then
        perform public.notify_user(s.owner_id, 'order_cancelled', 'Commande ' || num || ' annulée',
            'Le client a annulé sa commande avant ton acceptation. Rien à préparer.', new.id, s.shop_id);
    end if;
    return new;
end;
$$;
drop trigger if exists orders_status_notify on public.orders;
create trigger orders_status_notify after update of status on public.orders
    for each row execute function public.notify_order_status();

-- ---------- Avis → vendeur / livreur ----------
create or replace function public.notify_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    stars text := repeat('★', new.stars) || repeat('☆', 5 - new.stars);
    num text;
    owner uuid;
begin
    select order_number into num from public.orders where id = new.order_id;
    if tg_table_name = 'shop_reviews' then
        select owner_id into owner from public.shops where id = new.shop_id;
        perform public.notify_user(owner, 'shop_review', 'Nouvel avis ' || stars,
            coalesce('« ' || nullif(btrim(new.comment), '') || ' »', 'Sans commentaire.')
            || coalesce(' — commande ' || num, ''), new.order_id, new.shop_id);
    else
        perform public.notify_user(new.courier_id, 'courier_review', 'Nouvelle note de livraison ' || stars,
            coalesce('« ' || nullif(btrim(new.comment), '') || ' »', 'Sans commentaire.')
            || coalesce(' — commande ' || num, ''), new.order_id, null);
    end if;
    return new;
end;
$$;
drop trigger if exists shop_reviews_notify on public.shop_reviews;
create trigger shop_reviews_notify after insert on public.shop_reviews
    for each row execute function public.notify_review();
drop trigger if exists courier_reviews_notify on public.courier_reviews;
create trigger courier_reviews_notify after insert on public.courier_reviews
    for each row execute function public.notify_review();

-- ---------- Lecture ----------
-- Chaque notification arrive avec l'état ACTUEL de la commande : la page sait si
-- « Accepter / Refuser » ou « Noter » sont encore possibles.
create or replace function public.my_notifications(max_rows integer default 60)
returns table (
    id uuid, kind text, title text, body text, order_id uuid, shop_id uuid,
    created_at timestamptz, read_at timestamptz,
    order_number text, order_status text, payment_status text, is_shop_owner boolean
)
language sql
stable
security definer
set search_path = public
as $$
    select n.id, n.kind, n.title, n.body, n.order_id, n.shop_id, n.created_at, n.read_at,
           o.order_number, o.status, o.payment_status,
           exists (select 1 from public.shops s where s.id = n.shop_id and s.owner_id = auth.uid())
      from public.notifications n
      left join public.orders o on o.id = n.order_id
     where n.user_id = auth.uid()
     order by n.created_at desc
     limit least(greatest(coalesce(max_rows, 60), 1), 200);
$$;
revoke all on function public.my_notifications(integer) from public;
grant execute on function public.my_notifications(integer) to authenticated;

create or replace function public.notifications_unread()
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select count(*)::integer from public.notifications where user_id = auth.uid() and read_at is null;
$$;
revoke all on function public.notifications_unread() from public;
grant execute on function public.notifications_unread() to authenticated;

-- ids = null → tout marquer comme lu
create or replace function public.mark_notifications_read(ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    n integer;
begin
    update public.notifications set read_at = now()
     where user_id = auth.uid() and read_at is null and (ids is null or id = any (ids));
    get diagnostics n = row_count;
    return n;
end;
$$;
revoke all on function public.mark_notifications_read(uuid[]) from public;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- ---------- Rattrapage : commandes déjà en attente avant cette migration ----------
do $$
declare
    o record;
    s record;
    nb integer;
begin
    for o in select id, order_number, subtotal, total, payment_status from public.orders where status = 'pending' loop
        select * into s from public.order_shop(o.id);
        select coalesce(sum(quantity), 0) into nb from public.order_items where order_id = o.id;
        perform public.notify_user(s.owner_id, 'new_order',
            'Nouvelle commande ' || coalesce(o.order_number, '') || case when o.payment_status = 'test' then ' (TEST)' else '' end,
            s.shop_name || ' · ' || nb || ' article' || case when nb > 1 then 's' else '' end || ' · '
                || public.fcfa(coalesce(o.subtotal, o.total)) || '. Accepte-la ou refuse-la.',
            o.id, s.shop_id);
    end loop;
end;
$$;
