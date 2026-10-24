-- ============================================================
-- Admin : gestion des boutiques (admin-shops.html)
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261012 (archivage), 20261013 (comptabilité vendeur), 20261020 (vendeurs),
--             20261028 (signalements), 20261030 (équipe).
--
-- • Suspendre : la boutique disparaît du site, le vendeur ne peut pas la réactiver lui-même.
-- • Supprimer : la boutique est retirée du site mais son historique est conservé
--   (commandes, comptes, avis) ; un admin peut la restaurer.
-- • Activité : entrées et sorties d'argent, commandes, dernière connexion du vendeur.
-- Chaque action est enregistrée (qui, quoi, quand, motif) et le vendeur est prévenu.
-- ============================================================

alter table public.shops add column if not exists suspended_at timestamptz;
alter table public.shops add column if not exists suspended_reason text;
alter table public.shops add column if not exists archived_reason text;

create table if not exists public.shop_admin_events (
    id uuid primary key default gen_random_uuid(),
    shop_id uuid not null references public.shops (id) on delete cascade,
    actor_id uuid references auth.users (id) on delete set null,
    action text not null,
    note text,
    created_at timestamptz not null default now()
);
alter table public.shop_admin_events enable row level security;   -- lecture par les fonctions admin seulement
create index if not exists shop_admin_events_shop on public.shop_admin_events (shop_id, created_at desc);

-- ---------- Le vendeur ne peut pas annuler une décision d'Ouenze ----------
create or replace function public.shops_guard_admin_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if public.is_admin() then return new; end if;
    new.suspended_at := old.suspended_at;
    new.suspended_reason := old.suspended_reason;
    if old.suspended_at is not null then new.is_active := false; end if;
    if old.archived_at is not null then
        new.archived_at := old.archived_at;
        new.archived_reason := old.archived_reason;
        new.is_active := false;
    end if;
    return new;
end;
$$;
drop trigger if exists shops_guard_admin_fields on public.shops;
create trigger shops_guard_admin_fields before update on public.shops
    for each row execute function public.shops_guard_admin_fields();

-- Revalider un vendeur ne réactive pas une boutique suspendue par Ouenze
do $$
declare def text;
begin
    select pg_get_functiondef(p.oid) into def from pg_proc p
     where p.proname = 'review_vendor_application' and p.pronamespace = 'public'::regnamespace limit 1;
    if def is not null and position('and is_active = false;' in def) > 0 and position('suspended_at is null' in def) = 0 then
        execute replace(def, 'and is_active = false;', 'and is_active = false and suspended_at is null;');
    end if;
end $$;

-- ---------- Chiffres d'une boutique ----------
create or replace function public.admin_shop_stats(target uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with lines as (
        select o.id, o.status, o.created_at, o.updated_at, o.payment_status,
               sum(oi.total_price) as amount
          from public.order_items oi join public.orders o on o.id = oi.order_id
         where oi.shop_id = target and coalesce(o.payment_status, '') <> 'test'
         group by o.id
    ), entries as (
        select kind, amount, entry_date from public.vendor_entries where shop_id = target
    )
    select jsonb_build_object(
        'orders_total', (select count(*) from lines),
        'orders_30d', (select count(*) from lines where created_at > now() - interval '30 days'),
        'orders_pending', (select count(*) from lines where status = 'pending'),
        'orders_delivered', (select count(*) from lines where status = 'delivered'),
        'orders_cancelled', (select count(*) from lines where status in ('cancelled', 'refused', 'refunded')),
        'last_order_at', (select max(created_at) from lines),
        'sales_total', (select coalesce(sum(amount), 0) from lines where status = 'delivered'),
        'sales_30d', (select coalesce(sum(amount), 0) from lines where status = 'delivered' and updated_at > now() - interval '30 days'),
        -- Comptabilité déclarée par le vendeur (page Comptabilité) : non vérifiée par Ouenze
        'in_store', (select coalesce(sum(amount), 0) from entries where kind = 'sale_store'),
        'in_payout', (select coalesce(sum(amount), 0) from entries where kind = 'payout'),
        'in_contribution', (select coalesce(sum(amount), 0) from entries where kind = 'contribution'),
        'out_expenses', (select coalesce(sum(amount), 0) from entries where kind not in ('sale_store', 'payout', 'contribution', 'withdrawal')),
        'out_withdrawal', (select coalesce(sum(amount), 0) from entries where kind = 'withdrawal'),
        'last_entry_at', (select max(entry_date) from entries),
        'products', (select count(*) from public.products p where p.shop_id = target and coalesce(p.is_active, true)),
        'reports_open', (select count(*) from public.reports r where r.shop_id = target and r.status = 'open'),
        'reports_total', (select count(*) from public.reports r where r.shop_id = target)
    );
$$;
revoke all on function public.admin_shop_stats(uuid) from public, anon, authenticated;

-- ---------- Liste ----------
-- scope : 'active' · 'suspended' · 'archived' · 'all'
create or replace function public.admin_shop_list(scope text default 'active', search text default null)
returns table (shop_id uuid, name text, city text, district text, created_at timestamptz, is_active boolean,
               suspended_at timestamptz, archived_at timestamptz, owner_name text, owner_phone text, owner_email text,
               owner_last_login timestamptz, rating numeric, stats jsonb)
language sql
stable
security definer
set search_path = public
as $$
    select s.id, s.name::text, s.city::text, s.district::text, s.created_at, coalesce(s.is_active, true),
           s.suspended_at, s.archived_at, public.account_label(s.owner_id),
           coalesce(u.raw_user_meta_data->>'phone', case when u.phone <> '' then '+' || u.phone end)::text,
           u.email::text, u.last_sign_in_at, s.rating, public.admin_shop_stats(s.id)
      from public.shops s
      left join auth.users u on u.id = s.owner_id
     where public.is_admin()
       and case coalesce(scope, 'active')
             when 'active' then s.archived_at is null and s.suspended_at is null
             when 'suspended' then s.archived_at is null and s.suspended_at is not null
             when 'archived' then s.archived_at is not null
             else true
           end
       and (nullif(btrim(coalesce(search, '')), '') is null
            or s.name ilike '%' || btrim(search) || '%'
            or coalesce(s.city, '') ilike '%' || btrim(search) || '%'
            or coalesce(u.email, '') ilike '%' || btrim(search) || '%'
            or regexp_replace(coalesce(u.raw_user_meta_data->>'phone', u.phone, ''), '\D', '', 'g')
               like '%' || nullif(regexp_replace(search, '\D', '', 'g'), '') || '%')
     order by s.created_at desc
     limit 300;
$$;
revoke all on function public.admin_shop_list(text, text) from public, anon;
grant execute on function public.admin_shop_list(text, text) to authenticated;

-- ---------- Fiche ----------
create or replace function public.admin_shop_detail(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    s public.shops;
    u record;
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    select * into s from public.shops where id = target;
    if s.id is null then raise exception 'Boutique introuvable'; end if;
    select email, phone, last_sign_in_at, created_at, raw_user_meta_data into u from auth.users where id = s.owner_id;
    return jsonb_build_object(
        -- Toutes les colonnes de la boutique, sans les images (lourdes)
        'shop', (to_jsonb(s) - 'design' - 'logo_url' - 'banner_url') || jsonb_build_object('is_active', coalesce(s.is_active, true)),
        'owner', jsonb_build_object('name', public.account_label(s.owner_id), 'email', u.email,
            'phone', coalesce(u.raw_user_meta_data->>'phone', case when u.phone <> '' then '+' || u.phone end),
            'last_login', u.last_sign_in_at, 'joined', u.created_at),
        'stats', public.admin_shop_stats(s.id),
        'orders', coalesce((select jsonb_agg(x order by x.created_at desc) from (
                select o.id, o.order_number, o.created_at, o.status, o.payment_status, sum(oi.total_price) as amount,
                       public.account_label(o.client_id) as client
                  from public.order_items oi join public.orders o on o.id = oi.order_id
                 where oi.shop_id = s.id
                 group by o.id order by o.created_at desc limit 20) x), '[]'::jsonb),
        'entries', coalesce((select jsonb_agg(e order by e.entry_date desc, e.created_at desc) from (
                select entry_date, kind, amount, label, created_at from public.vendor_entries
                 where shop_id = s.id order by entry_date desc, created_at desc limit 20) e), '[]'::jsonb),
        'events', coalesce((select jsonb_agg(jsonb_build_object('action', ev.action, 'note', ev.note, 'created_at', ev.created_at,
                'actor', public.account_label(ev.actor_id)) order by ev.created_at desc)
              from public.shop_admin_events ev where ev.shop_id = s.id), '[]'::jsonb)
    );
end;
$$;
revoke all on function public.admin_shop_detail(uuid) from public, anon;
grant execute on function public.admin_shop_detail(uuid) to authenticated;

-- ---------- Actions ----------
-- action : 'suspend' · 'unsuspend' · 'archive' (supprimer du site) · 'restore'
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
        perform public.notify_user(s.owner_id, 'shop_suspended', 'Ta boutique ' || s.name || ' est fermée par Ouenze',
            'Motif : ' || why || '. Contacte Ouenze pour en parler.', null, s.id);
    elsif action = 'restore' then
        if s.archived_at is null then raise exception 'Cette boutique n''est pas supprimée'; end if;
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
revoke all on function public.admin_shop_action(uuid, text, text) from public, anon;
grant execute on function public.admin_shop_action(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
