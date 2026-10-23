-- ============================================================
-- Espace équipe (equipe.html) : les employés gèrent les commandes sans toucher à la base
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261018 (notifications), 20261019 (livreurs), 20261029 (commande au numéro).
--
-- Rôles :
--   • admin (table admin_users, déjà en place) : tout, y compris ajouter / retirer des membres
--   • agent (table team_members) : seulement les commandes (appeler, confirmer, annuler, payée)
-- Chaque action est enregistrée dans order_events (qui, quoi, quand).
-- Toute l'équipe reçoit une notification à chaque nouvelle commande.
-- ============================================================

create table if not exists public.team_members (
    user_id uuid primary key references auth.users (id) on delete cascade,
    role text not null default 'agent' check (role in ('agent')),
    added_by uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now()
);
alter table public.team_members enable row level security;   -- aucune lecture directe : tout passe par les fonctions

create table if not exists public.order_events (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders (id) on delete cascade,
    actor_id uuid references auth.users (id) on delete set null,
    action text not null,
    details text,
    created_at timestamptz not null default now()
);
alter table public.order_events enable row level security;
create index if not exists order_events_order on public.order_events (order_id, created_at desc);

-- ---------- Rôle de l'utilisateur connecté ----------
create or replace function public.my_team_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select case
        when exists (select 1 from public.admin_users where user_id = auth.uid()) then 'admin'
        when exists (select 1 from public.team_members where user_id = auth.uid()) then 'agent'
    end;
$$;
revoke all on function public.my_team_role() from public, anon;
grant execute on function public.my_team_role() to authenticated;

create or replace function public.is_team()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.my_team_role() is not null;
$$;
revoke all on function public.is_team() from public, anon;
grant execute on function public.is_team() to authenticated;

-- Nom lisible d'un compte (nom, sinon téléphone, sinon email)
create or replace function public.account_label(target uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), u.raw_user_meta_data->>'phone',
                    case when u.phone is not null and u.phone <> '' then '+' || u.phone end, u.email, 'Compte')::text
      from auth.users u where u.id = target;
$$;
revoke all on function public.account_label(uuid) from public, anon, authenticated;

create or replace function public.log_order_event(target_order uuid, act text, info text default null)
returns void
language sql
security definer
set search_path = public
as $$
    insert into public.order_events (order_id, actor_id, action, details)
    values (target_order, auth.uid(), act, nullif(left(btrim(coalesce(info, '')), 500), ''));
$$;
revoke all on function public.log_order_event(uuid, text, text) from public, anon, authenticated;

-- ---------- Liste des commandes ----------
-- scope : 'to_call' (à appeler) · 'active' (en cours) · 'done' (terminées, 30 jours) · 'all'
create or replace function public.team_orders(scope text default 'to_call', search text default null)
returns table (order_id uuid, order_number text, created_at timestamptz, status text, payment_status text,
               payment_method text, payment_operator text, total numeric, shop_name text,
               client_name text, phone text, city text, district text, landmark text, call_note text,
               confirmed boolean, deliverer_name text, last_action text, last_actor text, last_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
    select o.id, o.order_number::text, o.created_at, o.status::text, o.payment_status::text,
           o.payment_method::text, o.delivery_info->>'payment_operator', o.total,
           (select s.name::text from public.order_items oi join public.shops s on s.id = oi.shop_id where oi.order_id = o.id limit 1),
           public.account_label(o.client_id), o.delivery_info->>'phone', o.delivery_info->>'city',
           o.delivery_info->>'district', o.delivery_info->>'landmark', o.delivery_info->>'call_note',
           coalesce((o.delivery_info->>'call_confirmed')::boolean, false),
           case when o.deliverer_id is not null then public.account_label(o.deliverer_id) end,
           e.action, public.account_label(e.actor_id), e.created_at
      from public.orders o
      left join lateral (select ev.action, ev.actor_id, ev.created_at from public.order_events ev
                          where ev.order_id = o.id order by ev.created_at desc limit 1) e on true
     where public.is_team()
       and case coalesce(scope, 'to_call')
             when 'to_call' then o.status not in ('delivered', 'cancelled', 'refused', 'refunded')
                                 and not coalesce((o.delivery_info->>'call_confirmed')::boolean, false)
             when 'active' then o.status not in ('delivered', 'cancelled', 'refused', 'refunded')
                                 and coalesce((o.delivery_info->>'call_confirmed')::boolean, false)
             when 'done' then o.status in ('delivered', 'cancelled', 'refused', 'refunded') and o.created_at > now() - interval '30 days'
             else true
           end
       and (nullif(btrim(coalesce(search, '')), '') is null
            or o.order_number ilike '%' || btrim(search) || '%'
            or regexp_replace(coalesce(o.delivery_info->>'phone', ''), '\D', '', 'g')
               like '%' || nullif(regexp_replace(search, '\D', '', 'g'), '') || '%')
     order by case when coalesce(scope, 'to_call') = 'done' then 0 else 1 end, o.created_at desc
     limit 200;
$$;
revoke all on function public.team_orders(text, text) from public, anon;
grant execute on function public.team_orders(text, text) to authenticated;

-- ---------- Après l'appel : adresse confirmée ----------
create or replace function public.team_confirm_order(target_order uuid, new_district text default null,
    new_landmark text default null, note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare st text;
begin
    if not public.is_team() then raise exception 'Réservé à l''équipe Ouenze' using errcode = '42501'; end if;
    select status into st from public.orders where id = target_order for update;
    if st is null then raise exception 'Commande introuvable'; end if;
    if st in ('delivered', 'cancelled', 'refused', 'refunded') then raise exception 'Cette commande est terminée'; end if;
    if char_length(btrim(coalesce(new_district, ''))) < 2 then raise exception 'Indique le quartier'; end if;
    update public.orders
       set delivery_info = delivery_info
           || jsonb_build_object('district', left(btrim(new_district), 60), 'call_confirmed', true, 'call_confirmed_at', now())
           || jsonb_strip_nulls(jsonb_build_object(
                'landmark', nullif(left(btrim(coalesce(new_landmark, '')), 300), ''),
                'call_note', nullif(left(btrim(coalesce(note, '')), 300), ''))),
           updated_at = now()
     where id = target_order;
    perform public.log_order_event(target_order, 'confirmed',
        btrim(new_district) || coalesce(' · ' || nullif(btrim(new_landmark), ''), '') || coalesce(' — ' || nullif(btrim(note), ''), ''));
end;
$$;
revoke all on function public.team_confirm_order(uuid, text, text, text) from public, anon;
grant execute on function public.team_confirm_order(uuid, text, text, text) to authenticated;

-- ---------- Note d'appel (client injoignable, rappeler plus tard…) ----------
create or replace function public.team_note_order(target_order uuid, note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_team() then raise exception 'Réservé à l''équipe Ouenze' using errcode = '42501'; end if;
    if char_length(btrim(coalesce(note, ''))) < 2 then raise exception 'Écris une note'; end if;
    update public.orders
       set delivery_info = delivery_info || jsonb_build_object('call_note', left(btrim(note), 300)), updated_at = now()
     where id = target_order;
    if not found then raise exception 'Commande introuvable'; end if;
    perform public.log_order_event(target_order, 'note', note);
end;
$$;
revoke all on function public.team_note_order(uuid, text) from public, anon;
grant execute on function public.team_note_order(uuid, text) to authenticated;

-- ---------- Annuler (le client a changé d'avis, injoignable…) ----------
create or replace function public.team_cancel_order(target_order uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    o record;
    s record;
begin
    if not public.is_team() then raise exception 'Réservé à l''équipe Ouenze' using errcode = '42501'; end if;
    if char_length(btrim(coalesce(reason, ''))) < 3 then raise exception 'Indique le motif de l''annulation'; end if;
    select id, order_number, status, client_id, deliverer_id, payment_status into o from public.orders where id = target_order for update;
    if o.id is null then raise exception 'Commande introuvable'; end if;
    if o.status in ('delivered', 'cancelled', 'refused', 'refunded') then raise exception 'Cette commande est déjà terminée'; end if;
    select * into s from public.order_shop(target_order);
    -- Messages justes pour chacun (le message automatique « annulée par le client » est ainsi évité)
    perform public.notify_user(s.owner_id, 'order_cancelled', 'Commande ' || o.order_number || ' annulée',
        'Ouenze a annulé cette commande : ' || btrim(reason) || '. Rien à préparer ni à remettre.', o.id, s.shop_id);
    perform public.notify_user(o.deliverer_id, 'order_cancelled', 'Course ' || o.order_number || ' annulée',
        'Ouenze a annulé cette commande. N''y va pas, ou rapporte le colis à la boutique.', o.id, s.shop_id);
    perform public.notify_user(o.client_id, 'order_cancelled', 'Commande ' || o.order_number || ' annulée',
        'Ta commande a été annulée par Ouenze. '
        || case when o.payment_status = 'paid' then 'Tu seras remboursé.' else 'Rien ne t''est débité.' end, o.id, s.shop_id);
    update public.orders set status = 'cancelled', notes = left('Annulée par Ouenze : ' || btrim(reason), 500), updated_at = now()
     where id = target_order;
    delete from public.delivery_codes where order_id = target_order;
    perform public.log_order_event(target_order, 'cancelled', reason);
end;
$$;
revoke all on function public.team_cancel_order(uuid, text) from public, anon;
grant execute on function public.team_cancel_order(uuid, text) to authenticated;

-- ---------- Paiement reçu (carte, PayPal, Mobile Money manuel) ----------
create or replace function public.team_mark_paid(target_order uuid, reference text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare ps text;
begin
    if not public.is_team() then raise exception 'Réservé à l''équipe Ouenze' using errcode = '42501'; end if;
    select payment_status into ps from public.orders where id = target_order for update;
    if ps is null then raise exception 'Commande introuvable'; end if;
    if ps = 'paid' then raise exception 'Déjà marquée payée'; end if;
    update public.orders
       set payment_status = 'paid',
           delivery_info = delivery_info || jsonb_strip_nulls(jsonb_build_object('payment_ref', nullif(left(btrim(coalesce(reference, '')), 100), ''), 'paid_at', now())),
           updated_at = now()
     where id = target_order;
    perform public.log_order_event(target_order, 'paid', reference);
end;
$$;
revoke all on function public.team_mark_paid(uuid, text) from public, anon;
grant execute on function public.team_mark_paid(uuid, text) to authenticated;

-- ---------- Historique d'une commande ----------
create or replace function public.team_order_history(target_order uuid)
returns table (created_at timestamptz, action text, details text, actor text)
language sql
stable
security definer
set search_path = public
as $$
    select e.created_at, e.action, e.details, public.account_label(e.actor_id)
      from public.order_events e
     where public.is_team() and e.order_id = target_order
     order by e.created_at desc
     limit 50;
$$;
revoke all on function public.team_order_history(uuid) from public, anon;
grant execute on function public.team_order_history(uuid) to authenticated;

-- ---------- Membres de l'équipe (admins seulement) ----------
create or replace function public.team_list()
returns table (user_id uuid, role text, label text, phone text, email text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
    select m.user_id, m.role, public.account_label(m.user_id),
           coalesce(u.raw_user_meta_data->>'phone', case when u.phone <> '' then '+' || u.phone end)::text, u.email::text, m.created_at
      from (select a.user_id, 'admin'::text as role, null::timestamptz as created_at from public.admin_users a
            union all
            select t.user_id, t.role, t.created_at from public.team_members t
             where not exists (select 1 from public.admin_users a where a.user_id = t.user_id)) m
      join auth.users u on u.id = m.user_id
     where public.is_admin()
     order by (m.role = 'admin') desc, 3;
$$;
revoke all on function public.team_list() from public, anon;
grant execute on function public.team_list() to authenticated;

-- Ajouter : par email ou par numéro (la personne doit déjà avoir un compte Ouenze)
create or replace function public.team_add(who text, new_role text default 'agent')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    target uuid;
    digits text := regexp_replace(coalesce(who, ''), '\D', '', 'g');
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    if new_role not in ('agent', 'admin') then raise exception 'Rôle inconnu'; end if;
    if position('@' in coalesce(who, '')) > 0 then
        select id into target from auth.users where lower(email) = lower(btrim(who)) limit 1;
    elsif length(digits) >= 8 then
        -- 06 123 45 67 → 242061234567 (Congo par défaut), sinon numéro avec indicatif
        if length(digits) = 9 and digits like '0%' then digits := '242' || digits; end if;
        select id into target from auth.users
         where phone = digits
            or regexp_replace(coalesce(raw_user_meta_data->>'phone', ''), '\D', '', 'g') = digits
         limit 1;
    end if;
    if target is null then raise exception 'Aucun compte Ouenze avec cet email ou ce numéro : la personne doit d''abord se connecter une fois sur le site.'; end if;
    if new_role = 'admin' then
        insert into public.admin_users (user_id) values (target) on conflict do nothing;
        delete from public.team_members where user_id = target;
    else
        if exists (select 1 from public.admin_users where user_id = target) then
            raise exception 'Cette personne est déjà administrateur';
        end if;
        insert into public.team_members (user_id, role, added_by) values (target, 'agent', auth.uid())
        on conflict (user_id) do nothing;
    end if;
    perform public.notify_user(target, 'team_added', 'Bienvenue dans l''équipe Ouenze',
        'Tu as maintenant accès à l''Espace équipe : commandes à appeler, confirmations et annulations.');
    return public.account_label(target);
end;
$$;
revoke all on function public.team_add(text, text) from public, anon;
grant execute on function public.team_add(text, text) to authenticated;

create or replace function public.team_remove(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    if target = auth.uid() then raise exception 'Tu ne peux pas te retirer toi-même'; end if;
    if exists (select 1 from public.admin_users where user_id = target)
       and (select count(*) from public.admin_users) <= 1 then
        raise exception 'Il faut garder au moins un administrateur';
    end if;
    delete from public.team_members where user_id = target;
    delete from public.admin_users where user_id = target;
end;
$$;
revoke all on function public.team_remove(uuid) from public, anon;
grant execute on function public.team_remove(uuid) to authenticated;

-- ---------- Nouvelle commande : notification à toute l'équipe ----------
create or replace function public.notify_team_new_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare m record;
begin
    for m in select user_id from public.admin_users union select user_id from public.team_members loop
        perform public.notify_user(m.user_id, 'team_new_order', 'Nouvelle commande ' || new.order_number || ' à appeler',
            public.account_label(new.client_id) || coalesce(' · ' || (new.delivery_info->>'phone'), '')
            || ' · ' || public.fcfa(new.total), new.id, null);
    end loop;
    return new;
end;
$$;
drop trigger if exists orders_team_notify on public.orders;
create trigger orders_team_notify after insert on public.orders
    for each row execute function public.notify_team_new_order();

notify pgrst, 'reload schema';
