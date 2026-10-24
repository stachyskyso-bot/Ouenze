-- ============================================================
-- MISE À JOUR OUENZE — à coller en entier dans Supabase > SQL Editor, puis « Run ».
-- Regroupe les migrations 20261024 à 20261106, dans l'ordre.
-- Sans danger si une partie a déjà été exécutée : chaque bloc peut être relancé.
-- ============================================================


-- >>>>>>>>>> 20261024_delivery_code_sms.sql
-- ============================================================
-- Code de remise envoyé au client par SMS et WhatsApp
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261019 (livreurs, table delivery_codes).
--
-- L'Edge Function « delivery-code » lit le code (clé service_role) et l'envoie au téléphone
-- de livraison du client. Le livreur déclenche l'envoi mais ne voit jamais le code.
-- Au plus 3 envois par commande (coût des SMS / WhatsApp).
-- ============================================================

alter table public.delivery_codes add column if not exists sends integer not null default 0;
alter table public.delivery_codes add column if not exists sent_at timestamptz;
alter table public.delivery_codes add column if not exists sent_channels text;

notify pgrst, 'reload schema';


-- >>>>>>>>>> 20261025_catalog_read.sql
-- ============================================================
-- Lecture des catégories et produits (manquait : « new row violates row-level security
-- policy for table categories » à l'enregistrement, catégories invisibles après création).
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261023 (fonction owns_shop).
-- ============================================================

-- Les catégories d'une boutique sont publiques (menu de la boutique) ;
-- le vendeur relit toujours les siennes.
drop policy if exists "public_read_categories" on public.categories;
create policy "public_read_categories" on public.categories for select using (true);

-- Le vendeur relit toujours ses produits (même masqués) ; la lecture publique existante reste inchangée.
drop policy if exists "owner_read_products" on public.products;
create policy "owner_read_products" on public.products for select to authenticated
    using (public.owns_shop(shop_id));

notify pgrst, 'reload schema';


-- >>>>>>>>>> 20261026_simple_checkout.sql
-- ============================================================
-- Commande simplifiée : plus de carte, paiement Mobile Money À LA LIVRAISON
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261017 (commandes), 20261019 (livreurs), 20261022 (carte vendeur).
--
-- • Adresse = ville + quartier (+ repère facultatif). Ouenze reçoit par email le nom, le
--   numéro et l'adresse du client à chaque commande (Edge Function order-notify, ADMIN_EMAIL).
-- • Paiement : « mobile_money_cod ». Le client ne paie rien à la commande ; quand le livreur
--   a saisi le code de remise, le client reçoit la demande Mobile Money (CinetPay) et tape
--   son code secret. payment_status : 'test' (mode test) · 'cod' (à payer) · 'paid'.
-- • Mode « live » : tout le monde peut commander (plus de paiement en ligne préalable).
--   Ouverture au public le jour J :  update public.app_settings set value = '"live"' where key = 'orders_mode';
-- ============================================================

create or replace function public.place_order(items jsonb, delivery jsonb, payment jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    uid uuid := auth.uid();
    mode text := public.orders_mode();
    it jsonb;
    p record;
    v jsonb;
    qty integer;
    unit numeric;
    stock_left integer;
    grp text := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    shop record;
    new_order uuid;
    num text;
    sub numeric;
    fees numeric;
    result jsonb := '[]'::jsonb;
    grand numeric := 0;
    n integer := 0;
begin
    if uid is null then raise exception 'Connecte-toi pour commander' using errcode = '42501'; end if;
    if mode = 'test' and not public.is_admin() then
        raise exception 'Les commandes en ligne ouvrent très bientôt. Ton panier est conservé.';
    end if;
    -- Paiement Mobile Money à la livraison : la commande se passe sans paiement préalable
    if mode not in ('test', 'test_open', 'live') then
        raise exception 'Les commandes sont momentanément fermées. Ton panier est conservé.';
    end if;
    if not exists (select 1 from public.profiles where id = uid) then
        raise exception 'Ton profil est incomplet : déconnecte-toi puis reconnecte-toi, ou contacte Ouenze';
    end if;
    if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then raise exception 'Ton panier est vide'; end if;
    if jsonb_array_length(items) > 50 then raise exception 'Trop d''articles dans une seule commande (50 maximum)'; end if;
    -- Plus de carte : ville + quartier, Ouenze appelle le client pour confirmer l'adresse
    if char_length(btrim(coalesce(delivery->>'district', ''))) < 2 then raise exception 'Indique ton quartier'; end if;
    if (delivery->>'lat') is not null and abs((delivery->>'lat')::numeric) > 90 then raise exception 'Position invalide'; end if;
    if char_length(btrim(coalesce(delivery->>'phone', ''))) < 8 then raise exception 'Numéro de téléphone de livraison manquant'; end if;
    if coalesce(payment->>'method', '') not in ('mobile_money_cod', 'mobile_money') then raise exception 'Moyen de paiement non accepté'; end if;

    -- Lignes validées et prix recalculés, dans une table temporaire
    create temporary table if not exists _cart (
        shop_id uuid, product_id uuid, product_name text, variant_name text, variant_key text,
        quantity integer, unit_price numeric
    ) on commit drop;
    delete from _cart where true;  -- pg_safeupdate (Supabase) refuse un DELETE sans WHERE

    for it in select * from jsonb_array_elements(items) loop
        qty := coalesce((it->>'quantity')::integer, 0);
        if qty < 1 or qty > 99 then raise exception 'Quantité invalide (1 à 99)'; end if;
        select pr.id, pr.name, pr.price, pr.stock, pr.variants, pr.shop_id, pr.is_active,
               s.is_active as shop_active, s.archived_at
          into p
          from public.products pr join public.shops s on s.id = pr.shop_id
         where pr.id = (it->>'product_id')::uuid;
        if p.id is null or coalesce(p.is_active, true) = false or coalesce(p.shop_active, true) = false or p.archived_at is not null then
            raise exception 'Un article n''est plus disponible : retire-le de ton panier';
        end if;
        v := null;
        if nullif(it->>'variant_key', '') is not null then
            select e.value into v from jsonb_array_elements(coalesce(p.variants->'items', '[]'::jsonb)) as e(value)
             where e.value->>'key' = it->>'variant_key' limit 1;
            if v is null then raise exception 'La version « % » de « % » n''existe plus', it->>'variant_key', p.name; end if;
        elsif jsonb_array_length(coalesce(p.variants->'items', '[]'::jsonb)) > 0 then
            raise exception 'Choisis une version pour « % »', p.name;
        end if;
        unit := coalesce(nullif((v->>'price')::numeric, 0), p.price);
        if unit is null or unit <= 0 then raise exception 'Prix manquant pour « % »', p.name; end if;
        -- Stock : 0 = non suivi (même règle que le site)
        stock_left := coalesce((v->>'stock')::integer, p.stock, 0);
        if stock_left > 0 and qty > stock_left then
            raise exception 'Stock insuffisant pour « % » : % disponible(s)', p.name, stock_left;
        end if;
        insert into _cart values (p.shop_id, p.id, p.name, v->>'key', v->>'key', qty, round(unit));
    end loop;

    -- Une commande par boutique
    for shop in select c.shop_id, s.name from _cart c join public.shops s on s.id = c.shop_id group by c.shop_id, s.name order by s.name loop
        n := n + 1;
        select sum(quantity * unit_price) into sub from _cart where shop_id = shop.shop_id;
        fees := round(sub * 0.10);
        num := 'OZ-' || to_char(now(), 'YYMMDD') || '-' || grp || '-' || n;
        insert into public.orders (client_id, order_number, subtotal, delivery_fees, total, status, payment_method,
                                   payment_status, delivery_info, tracking_step)
        values (uid, num, sub, fees, sub + fees, 'pending', payment->>'method',
                case when mode like 'test%' then 'test' else 'cod' end,
                jsonb_build_object(
                    'lat', (delivery->>'lat')::numeric, 'lng', (delivery->>'lng')::numeric,
                    'country_code', left(delivery->>'country_code', 2), 'country', left(delivery->>'country', 60),
                    'city', left(delivery->>'city', 60), 'district', left(delivery->>'district', 60),
                    'street', left(delivery->>'street', 100), 'landmark', left(delivery->>'landmark', 300),
                    'phone', left(delivery->>'phone', 30),
                    'payment_operator', left(payment->>'operator', 40), 'payment_phone', left(payment->>'phone', 30),
                    'group', grp),
                1)
        returning id into new_order;
        insert into public.order_items (order_id, product_id, shop_id, product_name, variant_name, options, quantity, unit_price, total_price)
        select new_order, product_id, shop_id, product_name, variant_name,
               case when variant_key is null then null else jsonb_build_object('variant_key', variant_key) end,
               quantity, unit_price, quantity * unit_price
          from _cart where shop_id = shop.shop_id;
        result := result || jsonb_build_object('order_id', new_order, 'order_number', num, 'shop_id', shop.shop_id,
                                               'shop_name', shop.name, 'subtotal', sub, 'delivery_fees', fees, 'total', sub + fees);
        grand := grand + sub + fees;
    end loop;

    return jsonb_build_object('orders', result, 'total', grand, 'mode', mode, 'group', grp);
end;
$$;
revoke all on function public.place_order(jsonb, jsonb, jsonb) from public;
grant execute on function public.place_order(jsonb, jsonb, jsonb) to authenticated;

-- ---------- Livreurs : les commandes « à payer à la livraison » sont proposées aussi ----------
do $$
declare def text;
begin
    select pg_get_functiondef('public.available_deliveries()'::regprocedure) into def;
    if position($q$('test', 'paid')$q$ in def) > 0 then
        execute replace(def, $q$('test', 'paid')$q$, $q$('test', 'paid', 'cod')$q$);
    end if;
end $$;

notify pgrst, 'reload schema';


-- >>>>>>>>>> 20261027_phone_login.sql
-- ============================================================
-- Connexion des clients par numéro de téléphone + code SMS
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
--
-- Un client connecté par SMS n'a pas d'email : la colonne profiles.email doit
-- accepter une valeur vide, sinon la création du compte échoue
-- (« Database error saving new user »).
-- ============================================================

do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles' and column_name = 'email' and is_nullable = 'NO'
    ) then
        alter table public.profiles alter column email drop not null;
    end if;
end $$;

notify pgrst, 'reload schema';


-- >>>>>>>>>> 20261028_reports.sql
-- ============================================================
-- Signalements de vendeurs (boutiques) et de livreurs
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261018 (notifications), 20261019 (livreurs).
--
-- Qui peut signaler qui :
--   • un client      → le vendeur ou le livreur d'une de SES commandes, ou une boutique depuis sa page
--   • un vendeur     → le livreur d'une commande de SA boutique
--   • un livreur     → le vendeur d'une commande qu'il livre
-- Au plus 5 signalements par personne et par 24 h, un seul ouvert par commande et par cible.
-- Les admins reçoivent une notification et traitent les signalements sur admin-reports.html.
-- ============================================================

create table if not exists public.reports (
    id uuid primary key default gen_random_uuid(),
    reporter_id uuid not null references auth.users (id) on delete cascade,
    target_kind text not null check (target_kind in ('vendor', 'courier')),
    shop_id uuid,
    courier_id uuid,
    order_id uuid,
    reason text not null,
    details text,
    status text not null default 'open' check (status in ('open', 'handled', 'dismissed')),
    admin_note text,
    created_at timestamptz not null default now(),
    handled_at timestamptz
);
alter table public.reports enable row level security;
create index if not exists reports_status on public.reports (status, created_at desc);
create index if not exists reports_reporter on public.reports (reporter_id, created_at desc);

-- Chacun voit ses propres signalements ; aucune écriture directe (tout passe par les fonctions)
drop policy if exists "reports: lecture des siens" on public.reports;
create policy "reports: lecture des siens" on public.reports
    for select to authenticated using (reporter_id = auth.uid());

-- ---------- Signaler ----------
create or replace function public.report_problem(target_kind text, target_order uuid default null,
    target_shop uuid default null, reason text default null, details text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    uid uuid := auth.uid();
    o record;
    shop record;
    target_courier uuid;
    new_id uuid;
    label text;
    who text;
    a record;
begin
    if uid is null then raise exception 'Connecte-toi pour signaler un problème' using errcode = '42501'; end if;
    select null::uuid as id, null::text as order_number, null::uuid as client_id, null::uuid as deliverer_id into o;
    select null::uuid as shop_id, null::text as shop_name, null::uuid as owner_id into shop;
    if target_kind not in ('vendor', 'courier') then raise exception 'Cible inconnue'; end if;
    if reason is null or reason not in ('retard', 'colis_abime', 'non_conforme', 'comportement', 'arnaque', 'injoignable', 'autre') then
        raise exception 'Choisis un motif';
    end if;
    if reason = 'autre' and length(btrim(coalesce(details, ''))) < 5 then raise exception 'Explique le problème en quelques mots'; end if;
    if (select count(*) from public.reports r where r.reporter_id = uid and r.created_at > now() - interval '24 hours') >= 5 then
        raise exception 'Trop de signalements aujourd''hui. Réessaie demain ou contacte Ouenze.';
    end if;

    if target_order is not null then
        select id, order_number, client_id, deliverer_id into o from public.orders where id = target_order;
        if o.id is null then raise exception 'Commande introuvable'; end if;
        select * into shop from public.order_shop(target_order);
    end if;

    if target_kind = 'courier' then
        if o.id is null then raise exception 'Un livreur se signale depuis une commande'; end if;
        if o.deliverer_id is null then raise exception 'Aucun livreur sur cette commande'; end if;
        if uid is distinct from o.client_id and uid is distinct from shop.owner_id then raise exception 'Accès refusé' using errcode = '42501'; end if;
        target_courier := o.deliverer_id;
    else
        if o.id is not null then
            if uid is distinct from o.client_id and uid is distinct from o.deliverer_id then raise exception 'Accès refusé' using errcode = '42501'; end if;
        else
            if target_shop is null then raise exception 'Boutique manquante'; end if;
            select s.id as shop_id, s.name::text as shop_name, s.owner_id into shop from public.shops s where s.id = target_shop;
            if shop.shop_id is null then raise exception 'Boutique introuvable'; end if;
        end if;
        if shop.owner_id = uid then raise exception 'Tu ne peux pas signaler ta propre boutique'; end if;
    end if;

    if exists (select 1 from public.reports r
                where r.reporter_id = uid and r.status = 'open' and r.target_kind = report_problem.target_kind
                  and r.order_id is not distinct from o.id
                  and r.shop_id is not distinct from (case when report_problem.target_kind = 'vendor' then shop.shop_id end)) then
        raise exception 'Tu as déjà signalé ce problème : Ouenze s''en occupe.';
    end if;

    insert into public.reports (reporter_id, target_kind, shop_id, courier_id, order_id, reason, details)
    values (uid, target_kind, case when target_kind = 'vendor' then shop.shop_id end, target_courier, o.id,
            reason, nullif(left(btrim(coalesce(details, '')), 1000), ''))
    returning id into new_id;

    label := case reason when 'retard' then 'Retard' when 'colis_abime' then 'Colis abîmé' when 'non_conforme' then 'Produit non conforme'
             when 'comportement' then 'Comportement' when 'arnaque' then 'Arnaque' when 'injoignable' then 'Injoignable' else 'Autre' end;
    who := case when target_kind = 'courier' then 'un livreur' else 'la boutique ' || coalesce(shop.shop_name, '') end;
    for a in select user_id from public.admin_users loop
        perform public.notify_user(a.user_id, 'report', 'Signalement : ' || who,
            label || coalesce(' · commande ' || o.order_number, '') || coalesce(' — ' || left(btrim(details), 200), ''));
    end loop;
    return new_id;
end;
$$;
revoke all on function public.report_problem(text, uuid, uuid, text, text) from public, anon;
grant execute on function public.report_problem(text, uuid, uuid, text, text) to authenticated;

-- ---------- Admin : liste ----------
create or replace function public.admin_reports()
returns table (id uuid, created_at timestamptz, status text, target_kind text, reason text, details text, admin_note text,
               order_number text, shop_id uuid, shop_name text, courier_id uuid, courier_name text, courier_phone text,
               reporter_name text, reporter_phone text, target_total bigint)
language sql
stable
security definer
set search_path = public
as $$
    select r.id, r.created_at, r.status, r.target_kind, r.reason, r.details, r.admin_note,
           o.order_number::text, r.shop_id, s.name::text,
           r.courier_id, coalesce(cu.raw_user_meta_data->>'full_name', cu.email)::text,
           coalesce(cu.raw_user_meta_data->>'phone', cu.phone)::text,
           coalesce(ru.raw_user_meta_data->>'full_name', ru.email, ru.phone)::text,
           coalesce(ru.raw_user_meta_data->>'phone', ru.phone)::text,
           (select count(*) from public.reports x
             where (r.target_kind = 'vendor' and x.shop_id = r.shop_id) or (r.target_kind = 'courier' and x.courier_id = r.courier_id))
      from public.reports r
      left join public.orders o on o.id = r.order_id
      left join public.shops s on s.id = r.shop_id
      left join auth.users cu on cu.id = r.courier_id
      left join auth.users ru on ru.id = r.reporter_id
     where public.is_admin()
     order by (r.status = 'open') desc, r.created_at desc
     limit 300;
$$;
revoke all on function public.admin_reports() from public, anon;
grant execute on function public.admin_reports() to authenticated;

-- ---------- Admin : traiter ----------
create or replace function public.handle_report(target_report uuid, new_status text, note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then raise exception 'Réservé à l''équipe Ouenze' using errcode = '42501'; end if;
    if new_status not in ('open', 'handled', 'dismissed') then raise exception 'Statut inconnu'; end if;
    update public.reports
       set status = new_status, admin_note = nullif(left(btrim(coalesce(note, '')), 1000), ''),
           handled_at = case when new_status = 'open' then null else now() end
     where id = target_report;
    if not found then raise exception 'Signalement introuvable'; end if;
end;
$$;
revoke all on function public.handle_report(uuid, text, text) from public, anon;
grant execute on function public.handle_report(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';


-- >>>>>>>>>> 20261029_phone_only_checkout.sql
-- ============================================================
-- Commande avec le numéro de téléphone seulement
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261026_simple_checkout.sql.
--
-- Le quartier n'est plus demandé : Ouenze appelle le client pour savoir où livrer
-- (le numéro et le nom arrivent par email à chaque commande).
-- Moyens de paiement : Mobile Money à la livraison (MTN, Airtel…), carte bancaire, PayPal.
-- ============================================================

do $$
declare def text;
begin
    select pg_get_functiondef('public.place_order(jsonb, jsonb, jsonb)'::regprocedure) into def;
    if position('Indique ton quartier' in def) > 0 then
        def := replace(def,
            $q$if char_length(btrim(coalesce(delivery->>'district', ''))) < 2 then raise exception 'Indique ton quartier'; end if;$q$,
            '');
    end if;
    if position($q$('mobile_money_cod', 'mobile_money')$q$ in def) > 0 then
        def := replace(def, $q$('mobile_money_cod', 'mobile_money')$q$, $q$('mobile_money_cod', 'mobile_money', 'card', 'paypal')$q$);
    end if;
    execute def;
end $$;

notify pgrst, 'reload schema';


-- >>>>>>>>>> 20261030_team_space.sql
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


-- >>>>>>>>>> 20261031_trade_simulation.sql
-- ============================================================
-- Trade — opérations commerciales de 45 jours, en SIMULATION (aucun argent réel)
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261030_team_space.sql (is_team, account_label).
--
-- Parcours :
--   1. Le vendeur propose une opération : achats prévus chez des fournisseurs, son apport,
--      le financement demandé, les ventes prévues.                       → submitted
--   2. L'équipe Ouenze vérifie et ouvre la collecte (ou refuse).        → collecting / rejected
--   3. Des utilisateurs s'engagent (montants simulés).
--   4. L'équipe lance l'opération (45 jours).                           → running
--      • fournisseurs payés DIRECTEMENT par Ouenze (simulé), sur justificatif ;
--      • le vendeur déclare ses autres dépenses et ses ventes, avec justificatif ;
--      • l'équipe valide ou refuse chaque ligne.
--   5. L'équipe clôture : résultat = ventes validées − achats fournisseurs − dépenses validées.
--                                                                       → closed / failed / cancelled
--
-- NON CODÉ VOLONTAIREMENT (en attente de validation juridique et du prestataire de paiement) :
--   partage des gains, ordre d'absorption des pertes, fonds de garantie, garde des fonds,
--   retrait du solde. La clôture n'affiche que le résultat brut et la part de capital de chacun.
-- Toutes les lignes portent is_simulation = true : impossible d'en créer une « réelle » ici.
-- ============================================================

create table if not exists public.trade_operations (
    id uuid primary key default gen_random_uuid(),
    shop_id uuid not null references public.shops (id) on delete cascade,
    owner_id uuid not null references auth.users (id) on delete cascade,
    title text not null,
    description text,
    goal_amount numeric not null check (goal_amount > 0),             -- financement demandé aux participants
    vendor_contribution numeric not null check (vendor_contribution > 0),
    expected_revenue numeric,                                          -- ventes prévues (estimation du vendeur)
    duration_days integer not null default 45 check (duration_days between 7 and 120),
    status text not null default 'submitted'
        check (status in ('submitted', 'rejected', 'collecting', 'running', 'closed', 'failed', 'cancelled')),
    review_note text,
    collect_ends_at timestamptz,
    started_at timestamptz,
    ends_at timestamptz,
    closed_at timestamptz,
    result_snapshot jsonb,
    is_simulation boolean not null default true check (is_simulation),
    created_at timestamptz not null default now()
);
alter table public.trade_operations enable row level security;
create index if not exists trade_operations_status on public.trade_operations (status, created_at desc);

-- Achats prévus : chaque fournisseur est payé directement par Ouenze, jamais par le vendeur
create table if not exists public.trade_supplier_lines (
    id uuid primary key default gen_random_uuid(),
    operation_id uuid not null references public.trade_operations (id) on delete cascade,
    supplier_name text not null,
    supplier_phone text,
    item text not null,
    amount numeric not null check (amount > 0),
    quote_ref text,                                -- n° de devis / facture pro forma
    status text not null default 'planned' check (status in ('planned', 'paid', 'cancelled')),
    paid_ref text,
    paid_at timestamptz,
    paid_by uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now()
);
alter table public.trade_supplier_lines enable row level security;

-- Engagements des participants (simulés : aucun paiement)
create table if not exists public.trade_pledges (
    id uuid primary key default gen_random_uuid(),
    operation_id uuid not null references public.trade_operations (id) on delete cascade,
    investor_id uuid not null references auth.users (id) on delete cascade,
    amount numeric not null check (amount > 0),
    status text not null default 'active' check (status in ('active', 'withdrawn', 'released')),
    risk_ack_at timestamptz not null,
    created_at timestamptz not null default now()
);
alter table public.trade_pledges enable row level security;
create index if not exists trade_pledges_op on public.trade_pledges (operation_id);
create index if not exists trade_pledges_investor on public.trade_pledges (investor_id);

-- Journal des mouvements : on n'efface et ne modifie jamais une ligne validée
create table if not exists public.trade_entries (
    id uuid primary key default gen_random_uuid(),
    operation_id uuid not null references public.trade_operations (id) on delete cascade,
    kind text not null check (kind in ('vendor_contribution', 'supplier_payment', 'expense', 'sale', 'note')),
    label text not null,
    amount numeric not null default 0 check (amount >= 0),
    proof text,                                   -- photo (image compressée) ou référence du justificatif
    status text not null default 'pending' check (status in ('pending', 'validated', 'rejected')),
    review_note text,
    created_by uuid references auth.users (id) on delete set null,
    reviewed_by uuid references auth.users (id) on delete set null,
    reviewed_at timestamptz,
    created_at timestamptz not null default now()
);
alter table public.trade_entries enable row level security;
create index if not exists trade_entries_op on public.trade_entries (operation_id, created_at desc);
-- Aucune politique : lecture et écriture uniquement par les fonctions ci-dessous.

-- ---------- Outils ----------
create or replace function public.trade_can_see(op public.trade_operations)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select op.owner_id = auth.uid() or public.is_team()
        or op.status in ('collecting', 'running', 'closed', 'failed')
        or exists (select 1 from public.trade_pledges p where p.operation_id = op.id and p.investor_id = auth.uid());
$$;
revoke all on function public.trade_can_see(public.trade_operations) from public, anon, authenticated;

-- Chiffres d'une opération (calculés, jamais saisis)
create or replace function public.trade_figures(target uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'pledged', coalesce((select sum(amount) from public.trade_pledges where operation_id = target and status in ('active', 'released')), 0),
        'investors', (select count(distinct investor_id) from public.trade_pledges where operation_id = target and status in ('active', 'released')),
        'vendor_in', coalesce((select sum(amount) from public.trade_entries where operation_id = target and kind = 'vendor_contribution' and status = 'validated'), 0),
        'suppliers_paid', coalesce((select sum(amount) from public.trade_entries where operation_id = target and kind = 'supplier_payment' and status = 'validated'), 0),
        'expenses', coalesce((select sum(amount) from public.trade_entries where operation_id = target and kind = 'expense' and status = 'validated'), 0),
        'sales', coalesce((select sum(amount) from public.trade_entries where operation_id = target and kind = 'sale' and status = 'validated'), 0),
        'pending', (select count(*) from public.trade_entries where operation_id = target and status = 'pending'),
        'planned_purchases', coalesce((select sum(amount) from public.trade_supplier_lines where operation_id = target and status <> 'cancelled'), 0)
    );
$$;
revoke all on function public.trade_figures(uuid) from public, anon, authenticated;

create or replace function public.trade_log(target uuid, k text, lbl text, amt numeric, prf text, st text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_id uuid;
begin
    insert into public.trade_entries (operation_id, kind, label, amount, proof, status, created_by, reviewed_by, reviewed_at)
    values (target, k, left(lbl, 200), coalesce(amt, 0), prf, st, auth.uid(),
            case when st <> 'pending' then auth.uid() end, case when st <> 'pending' then now() end)
    returning id into new_id;
    return new_id;
end;
$$;
revoke all on function public.trade_log(uuid, text, text, numeric, text, text) from public, anon, authenticated;

-- ---------- Liste ----------
-- scope : 'open' (collecte + en cours + terminées) · 'mine' (mes opérations de vendeur) ·
--         'invested' (où je participe) · 'review' (équipe : tout)
drop function if exists public.trade_list(text);
create or replace function public.trade_list(scope text default 'open')
returns table (id uuid, title text, shop_id uuid, shop_name text, shop_logo text, shop_city text, description text, status text, goal_amount numeric, vendor_contribution numeric,
               expected_revenue numeric, duration_days integer, collect_ends_at timestamptz, started_at timestamptz,
               ends_at timestamptz, created_at timestamptz, figures jsonb, my_pledge numeric, is_owner boolean)
language sql
stable
security definer
set search_path = public
as $$
    select o.id, o.title, s.id, s.name::text, s.logo_url::text, s.city::text, o.description, o.status, o.goal_amount, o.vendor_contribution, o.expected_revenue,
           o.duration_days, o.collect_ends_at, o.started_at, o.ends_at, o.created_at, public.trade_figures(o.id),
           (select sum(p.amount) from public.trade_pledges p
             where p.operation_id = o.id and p.investor_id = auth.uid() and p.status in ('active', 'released')),
           o.owner_id = auth.uid()
      from public.trade_operations o
      join public.shops s on s.id = o.shop_id
     where auth.uid() is not null
       and case coalesce(scope, 'open')
             when 'mine' then o.owner_id = auth.uid()
             when 'invested' then exists (select 1 from public.trade_pledges p where p.operation_id = o.id and p.investor_id = auth.uid())
             when 'review' then public.is_team()
             else o.status in ('collecting', 'running', 'closed', 'failed')
           end
     order by case o.status when 'submitted' then 0 when 'collecting' then 1 when 'running' then 2 else 3 end, o.created_at desc
     limit 100;
$$;
revoke all on function public.trade_list(text) from public, anon;
grant execute on function public.trade_list(text) to authenticated;

-- ---------- Détail ----------
create or replace function public.trade_detail(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    o public.trade_operations;
    inside boolean;
begin
    select * into o from public.trade_operations where id = target;
    if o.id is null or not public.trade_can_see(o) then raise exception 'Opération introuvable'; end if;
    inside := o.owner_id = auth.uid() or public.is_team();
    return jsonb_build_object(
        'operation', to_jsonb(o) - 'owner_id' || jsonb_build_object(
            'shop_name', (select name from public.shops where id = o.shop_id),
            'is_owner', o.owner_id = auth.uid(), 'is_team', public.is_team(), 'role', public.my_team_role()),
        'figures', public.trade_figures(o.id),
        'suppliers', coalesce((select jsonb_agg(jsonb_build_object(
                'id', l.id, 'supplier_name', l.supplier_name, 'item', l.item, 'amount', l.amount, 'status', l.status,
                'quote_ref', l.quote_ref, 'paid_ref', l.paid_ref, 'paid_at', l.paid_at,
                'supplier_phone', case when inside then l.supplier_phone end) order by l.created_at)
            from public.trade_supplier_lines l where l.operation_id = o.id), '[]'::jsonb),
        -- Les participants voient les lignes validées ; vendeur et équipe voient tout
        'entries', coalesce((select jsonb_agg(jsonb_build_object(
                'id', e.id, 'kind', e.kind, 'label', e.label, 'amount', e.amount, 'status', e.status,
                'review_note', e.review_note, 'created_at', e.created_at, 'proof', e.proof,
                'author', case when inside then public.account_label(e.created_by) end) order by e.created_at desc)
            from public.trade_entries e where e.operation_id = o.id and (inside or e.status = 'validated')), '[]'::jsonb),
        'my_pledge', (select sum(p.amount) from public.trade_pledges p
                       where p.operation_id = o.id and p.investor_id = auth.uid() and p.status in ('active', 'released')),
        'pledges', case when inside then coalesce((select jsonb_agg(jsonb_build_object(
                'investor', public.account_label(p.investor_id), 'amount', p.amount, 'status', p.status, 'created_at', p.created_at)
                order by p.created_at) from public.trade_pledges p where p.operation_id = o.id), '[]'::jsonb) end
    );
end;
$$;
revoke all on function public.trade_detail(uuid) from public, anon;
grant execute on function public.trade_detail(uuid) to authenticated;

-- ---------- Vendeur : proposer une opération ----------
-- payload : { shop_id, title, description, goal_amount, vendor_contribution, expected_revenue,
--             suppliers: [{ supplier_name, supplier_phone, item, amount, quote_ref }] }
create or replace function public.trade_submit(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    uid uuid := auth.uid();
    target_shop uuid := (payload->>'shop_id')::uuid;
    new_id uuid;
    line jsonb;
    purchases numeric := 0;
    goal numeric := round(coalesce((payload->>'goal_amount')::numeric, 0));
    contrib numeric := round(coalesce((payload->>'vendor_contribution')::numeric, 0));
    a record;
begin
    if uid is null then raise exception 'Connecte-toi' using errcode = '42501'; end if;
    if not exists (select 1 from public.shops where id = target_shop and owner_id = uid) then
        raise exception 'Choisis une de tes boutiques' using errcode = '42501';
    end if;
    if char_length(btrim(coalesce(payload->>'title', ''))) < 5 then raise exception 'Donne un titre clair à l''opération'; end if;
    if goal <= 0 then raise exception 'Indique le financement demandé'; end if;
    if contrib <= 0 then raise exception 'Ton apport personnel est obligatoire'; end if;
    if jsonb_typeof(payload->'suppliers') <> 'array' or jsonb_array_length(payload->'suppliers') = 0 then
        raise exception 'Ajoute au moins un achat fournisseur';
    end if;
    if jsonb_array_length(payload->'suppliers') > 20 then raise exception 'Vingt achats fournisseurs au maximum'; end if;
    if (select count(*) from public.trade_operations where owner_id = uid and status in ('submitted', 'collecting', 'running')) >= 2 then
        raise exception 'Tu as déjà deux opérations en cours';
    end if;

    insert into public.trade_operations (shop_id, owner_id, title, description, goal_amount, vendor_contribution, expected_revenue)
    values (target_shop, uid, left(btrim(payload->>'title'), 120), left(btrim(coalesce(payload->>'description', '')), 2000),
            goal, contrib, nullif(round(coalesce((payload->>'expected_revenue')::numeric, 0)), 0))
    returning id into new_id;

    for line in select * from jsonb_array_elements(payload->'suppliers') loop
        if char_length(btrim(coalesce(line->>'supplier_name', ''))) < 2 or char_length(btrim(coalesce(line->>'item', ''))) < 2
           or coalesce((line->>'amount')::numeric, 0) <= 0 then
            raise exception 'Chaque achat doit avoir un fournisseur, un article et un montant';
        end if;
        insert into public.trade_supplier_lines (operation_id, supplier_name, supplier_phone, item, amount, quote_ref)
        values (new_id, left(btrim(line->>'supplier_name'), 100), left(btrim(coalesce(line->>'supplier_phone', '')), 30),
                left(btrim(line->>'item'), 200), round((line->>'amount')::numeric), nullif(left(btrim(coalesce(line->>'quote_ref', '')), 100), ''));
        purchases := purchases + round((line->>'amount')::numeric);
    end loop;
    if purchases > goal + contrib then
        raise exception 'Les achats prévus (%) dépassent le budget : financement + apport (%)', public.fcfa(purchases), public.fcfa(goal + contrib);
    end if;

    perform public.trade_log(new_id, 'note', 'Opération proposée par le vendeur', 0, null, 'validated');
    for a in select user_id from public.admin_users loop
        perform public.notify_user(a.user_id, 'trade', 'Trade : nouvelle opération à vérifier',
            left(btrim(payload->>'title'), 120) || ' · ' || public.fcfa(goal), null, target_shop);
    end loop;
    return new_id;
end;
$$;
revoke all on function public.trade_submit(jsonb) from public, anon;
grant execute on function public.trade_submit(jsonb) to authenticated;

-- ---------- Participant : s'engager (simulé) ----------
create or replace function public.trade_pledge(target uuid, amount numeric, risk_ack boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    o public.trade_operations;
    left_to_fund numeric;
    amt numeric := round(coalesce(amount, 0));
begin
    if auth.uid() is null then raise exception 'Connecte-toi' using errcode = '42501'; end if;
    select * into o from public.trade_operations where id = target for update;
    if o.id is null then raise exception 'Opération introuvable'; end if;
    if o.status <> 'collecting' or (o.collect_ends_at is not null and o.collect_ends_at < now()) then
        raise exception 'La collecte de cette opération est fermée';
    end if;
    if o.owner_id = auth.uid() then raise exception 'Le vendeur participe déjà avec son apport'; end if;
    if not coalesce(risk_ack, false) then raise exception 'Coche la case : tu peux perdre tout ou partie de ta participation'; end if;
    if amt <= 0 then raise exception 'Montant invalide'; end if;
    left_to_fund := o.goal_amount - (public.trade_figures(o.id)->>'pledged')::numeric;
    if amt > left_to_fund then raise exception 'Il reste % à financer', public.fcfa(greatest(left_to_fund, 0)); end if;
    insert into public.trade_pledges (operation_id, investor_id, amount, risk_ack_at) values (o.id, auth.uid(), amt, now());
end;
$$;
revoke all on function public.trade_pledge(uuid, numeric, boolean) from public, anon;
grant execute on function public.trade_pledge(uuid, numeric, boolean) to authenticated;

create or replace function public.trade_withdraw_pledge(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not exists (select 1 from public.trade_operations where id = target and status = 'collecting') then
        raise exception 'Retrait possible seulement pendant la collecte';
    end if;
    update public.trade_pledges set status = 'withdrawn'
     where operation_id = target and investor_id = auth.uid() and status = 'active';
    if not found then raise exception 'Aucune participation à retirer'; end if;
end;
$$;
revoke all on function public.trade_withdraw_pledge(uuid) from public, anon;
grant execute on function public.trade_withdraw_pledge(uuid) to authenticated;

-- ---------- Vendeur : déclarer une dépense ou une vente (avec justificatif) ----------
create or replace function public.trade_declare(target uuid, k text, lbl text, amt numeric, prf text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare o public.trade_operations;
begin
    select * into o from public.trade_operations where id = target;
    if o.id is null or (o.owner_id <> auth.uid() and not public.is_team()) then raise exception 'Accès refusé' using errcode = '42501'; end if;
    if o.status <> 'running' then raise exception 'L''opération n''est pas en cours'; end if;
    if k not in ('expense', 'sale', 'note') then raise exception 'Type inconnu'; end if;
    if char_length(btrim(coalesce(lbl, ''))) < 3 then raise exception 'Décris la ligne en quelques mots'; end if;
    if k <> 'note' and coalesce(amt, 0) <= 0 then raise exception 'Indique le montant'; end if;
    if k = 'expense' and char_length(btrim(coalesce(prf, ''))) < 3 then raise exception 'Un justificatif est obligatoire pour une dépense'; end if;
    if prf is not null and length(prf) > 900000 then raise exception 'Justificatif trop lourd'; end if;
    return public.trade_log(target, k, btrim(lbl), round(coalesce(amt, 0)), nullif(btrim(coalesce(prf, '')), ''),
                            case when k = 'note' then 'validated' else 'pending' end);
end;
$$;
revoke all on function public.trade_declare(uuid, text, text, numeric, text) from public, anon;
grant execute on function public.trade_declare(uuid, text, text, numeric, text) to authenticated;

-- ---------- Équipe ----------
create or replace function public.trade_review(target uuid, decision text, note text default null, collect_days integer default 7)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare o public.trade_operations;
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    select * into o from public.trade_operations where id = target for update;
    if o.status <> 'submitted' then raise exception 'Cette opération a déjà été examinée'; end if;
    if decision = 'approve' then
        update public.trade_operations
           set status = 'collecting', review_note = nullif(btrim(coalesce(note, '')), ''),
               collect_ends_at = now() + make_interval(days => greatest(1, least(coalesce(collect_days, 7), 30)))
         where id = target;
        perform public.trade_log(target, 'note', 'Opération vérifiée : collecte ouverte', 0, note, 'validated');
        perform public.notify_user(o.owner_id, 'trade', 'Trade : ton opération est publiée', o.title || ' · collecte ouverte.', null, o.shop_id);
    elsif decision = 'reject' then
        if char_length(btrim(coalesce(note, ''))) < 3 then raise exception 'Indique le motif du refus'; end if;
        update public.trade_operations set status = 'rejected', review_note = btrim(note) where id = target;
        perform public.trade_log(target, 'note', 'Opération refusée', 0, note, 'validated');
        perform public.notify_user(o.owner_id, 'trade', 'Trade : opération refusée', o.title || ' : ' || btrim(note), null, o.shop_id);
    else
        raise exception 'Décision inconnue';
    end if;
end;
$$;
revoke all on function public.trade_review(uuid, text, text, integer) from public, anon;
grant execute on function public.trade_review(uuid, text, text, integer) to authenticated;

-- Lancer : financement atteint + apport du vendeur reçu (simulé) → 45 jours
create or replace function public.trade_start(target uuid, contribution_ref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    o public.trade_operations;
    pledged numeric;
    p record;
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    select * into o from public.trade_operations where id = target for update;
    if o.status <> 'collecting' then raise exception 'L''opération n''est pas en collecte'; end if;
    pledged := (public.trade_figures(o.id)->>'pledged')::numeric;
    if pledged < o.goal_amount then raise exception 'Financement incomplet : % sur %', public.fcfa(pledged), public.fcfa(o.goal_amount); end if;
    if char_length(btrim(coalesce(contribution_ref, ''))) < 2 then raise exception 'Indique la référence de l''apport du vendeur'; end if;
    perform public.trade_log(target, 'vendor_contribution', 'Apport du vendeur reçu (simulation)', o.vendor_contribution, contribution_ref, 'validated');
    update public.trade_operations
       set status = 'running', started_at = now(), ends_at = now() + make_interval(days => o.duration_days)
     where id = target;
    perform public.trade_log(target, 'note', 'Opération lancée pour ' || o.duration_days || ' jours', 0, null, 'validated');
    for p in select distinct investor_id from public.trade_pledges where operation_id = target and status = 'active' loop
        perform public.notify_user(p.investor_id, 'trade', 'Trade : l''opération démarre', o.title || ' · fin prévue dans ' || o.duration_days || ' jours.', null, o.shop_id);
    end loop;
end;
$$;
revoke all on function public.trade_start(uuid, text) from public, anon;
grant execute on function public.trade_start(uuid, text) to authenticated;

-- Payer un fournisseur directement (simulé) : jamais d'argent au vendeur pour les achats
create or replace function public.trade_pay_supplier(target_line uuid, reference text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    l public.trade_supplier_lines;
    o public.trade_operations;
    f jsonb;
    available numeric;
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    select * into l from public.trade_supplier_lines where id = target_line for update;
    if l.id is null then raise exception 'Achat introuvable'; end if;
    select * into o from public.trade_operations where id = l.operation_id;
    if o.status <> 'running' then raise exception 'L''opération n''est pas en cours'; end if;
    if l.status <> 'planned' then raise exception 'Cet achat est déjà réglé ou annulé'; end if;
    if char_length(btrim(coalesce(reference, ''))) < 2 then raise exception 'Indique la référence du paiement fournisseur'; end if;
    f := public.trade_figures(o.id);
    available := (f->>'pledged')::numeric + (f->>'vendor_in')::numeric - (f->>'suppliers_paid')::numeric - (f->>'expenses')::numeric;
    if l.amount > available then raise exception 'Fonds simulés insuffisants : % disponibles', public.fcfa(available); end if;
    update public.trade_supplier_lines set status = 'paid', paid_ref = left(btrim(reference), 100), paid_at = now(), paid_by = auth.uid()
     where id = target_line;
    perform public.trade_log(o.id, 'supplier_payment', 'Fournisseur payé par Ouenze : ' || l.supplier_name || ' — ' || l.item,
                             l.amount, reference, 'validated');
end;
$$;
revoke all on function public.trade_pay_supplier(uuid, text) from public, anon;
grant execute on function public.trade_pay_supplier(uuid, text) to authenticated;

-- Valider ou refuser une dépense / une vente déclarée
create or replace function public.trade_review_entry(target_entry uuid, ok boolean, note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare e public.trade_entries;
begin
    if not public.is_team() then raise exception 'Réservé à l''équipe Ouenze' using errcode = '42501'; end if;
    select * into e from public.trade_entries where id = target_entry for update;
    if e.id is null then raise exception 'Ligne introuvable'; end if;
    if e.status <> 'pending' then raise exception 'Ligne déjà examinée'; end if;
    if not ok and char_length(btrim(coalesce(note, ''))) < 3 then raise exception 'Indique le motif du refus'; end if;
    update public.trade_entries
       set status = case when ok then 'validated' else 'rejected' end, review_note = nullif(btrim(coalesce(note, '')), ''),
           reviewed_by = auth.uid(), reviewed_at = now()
     where id = target_entry;
end;
$$;
revoke all on function public.trade_review_entry(uuid, boolean, text) from public, anon;
grant execute on function public.trade_review_entry(uuid, boolean, text) to authenticated;

-- Clôturer : on fige les chiffres. La répartition n'est PAS calculée (règles à valider).
create or replace function public.trade_close(target uuid, outcome text, note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    o public.trade_operations;
    f jsonb;
    snap jsonb;
    p record;
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    select * into o from public.trade_operations where id = target for update;
    if outcome = 'cancelled' then
        if o.status not in ('submitted', 'collecting') then raise exception 'Annulation possible seulement avant le lancement'; end if;
        update public.trade_pledges set status = 'withdrawn' where operation_id = target and status = 'active';
        update public.trade_operations set status = 'cancelled', closed_at = now(), review_note = nullif(btrim(coalesce(note, '')), '') where id = target;
        perform public.trade_log(target, 'note', 'Opération annulée avant lancement : participations libérées', 0, note, 'validated');
        return null;
    end if;
    if outcome not in ('closed', 'failed') then raise exception 'Issue inconnue'; end if;
    if o.status <> 'running' then raise exception 'L''opération n''est pas en cours'; end if;
    f := public.trade_figures(target);
    if (f->>'pending')::integer > 0 then raise exception 'Valide ou refuse d''abord les % ligne(s) en attente', f->>'pending'; end if;
    snap := f || jsonb_build_object(
        'capital', (f->>'pledged')::numeric + (f->>'vendor_in')::numeric,
        'result', (f->>'sales')::numeric - (f->>'suppliers_paid')::numeric - (f->>'expenses')::numeric,
        'closed_on_time', now() <= o.ends_at,
        'rules', 'non validées : aucune répartition calculée');
    update public.trade_operations
       set status = outcome, closed_at = now(), result_snapshot = snap, review_note = nullif(btrim(coalesce(note, '')), '')
     where id = target;
    update public.trade_pledges set status = 'released' where operation_id = target and status = 'active';
    perform public.trade_log(target, 'note', case when outcome = 'closed' then 'Opération clôturée' else 'Opération en échec' end
                             || ' · résultat ' || public.fcfa((snap->>'result')::numeric), 0, note, 'validated');
    for p in select distinct investor_id from public.trade_pledges where operation_id = target loop
        perform public.notify_user(p.investor_id, 'trade', 'Trade : opération terminée', o.title || ' · résultat de l''opération : '
            || public.fcfa((snap->>'result')::numeric) || ' (simulation).', null, o.shop_id);
    end loop;
    return snap;
end;
$$;
revoke all on function public.trade_close(uuid, text, text) from public, anon;
grant execute on function public.trade_close(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';


-- >>>>>>>>>> 20261101_payments.sql
-- ============================================================
-- Paiements CinetPay (Mobile Money et carte) — commandes payées à la livraison
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261030_team_space.sql (is_team, log_order_event).
--
-- Parcours :
--   • Mobile Money : le livreur valide le code de remise → une demande de paiement part
--     au client (lien par SMS + bouton dans « Mes commandes ») → il choisit son réseau,
--     reçoit la demande sur son téléphone et tape son code secret.
--   • Carte bancaire : l'équipe envoie le lien de paiement pendant l'appel.
-- Une commande n'est marquée « payée » qu'après VÉRIFICATION auprès de CinetPay
-- (Edge Functions « payment » et « payment-notify »), jamais sur la seule parole du navigateur.
-- Sans clés CinetPay, tout fonctionne en simulation (provider = 'simulation').
-- ============================================================

create table if not exists public.payment_transactions (
    id uuid primary key default gen_random_uuid(),
    transaction_id text not null unique,            -- identifiant envoyé à CinetPay (imprévisible)
    order_id uuid not null references public.orders (id) on delete cascade,
    amount numeric not null check (amount > 0),
    currency text not null default 'XAF',
    channel text not null check (channel in ('MOBILE_MONEY', 'CREDIT_CARD')),
    phone text,
    provider text not null default 'cinetpay' check (provider in ('cinetpay', 'simulation')),
    status text not null default 'created' check (status in ('created', 'pending', 'accepted', 'refused', 'cancelled')),
    payment_url text,
    provider_ref text,
    provider_data jsonb,
    created_by uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    paid_at timestamptz
);
alter table public.payment_transactions enable row level security;   -- aucune lecture directe
create index if not exists payment_transactions_order on public.payment_transactions (order_id, created_at desc);

-- ---------- Préparer une demande de paiement (appelée avec le compte de l'utilisateur) ----------
-- Qui : le client de la commande, son livreur, ou l'équipe.
-- Mobile Money : après la livraison (code validé). Carte : à tout moment avant la fin.
-- Réutilise une demande encore valable (moins de 30 minutes) au lieu d'en créer une autre.
create or replace function public.payment_prepare(target_order uuid, wanted_channel text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    o record;
    ch text;
    t public.payment_transactions;
    amt numeric;
begin
    if auth.uid() is null then raise exception 'Connecte-toi' using errcode = '42501'; end if;
    select id, order_number, client_id, deliverer_id, status, payment_status, payment_method, total, delivery_info
      into o from public.orders where id = target_order for update;
    if o.id is null then raise exception 'Commande introuvable'; end if;
    if auth.uid() is distinct from o.client_id and auth.uid() is distinct from o.deliverer_id and not public.is_team() then
        raise exception 'Accès refusé' using errcode = '42501';
    end if;
    if o.payment_status = 'paid' then raise exception 'Cette commande est déjà payée'; end if;
    if o.payment_status = 'test' then raise exception 'Commande de test : rien à payer'; end if;
    if o.status in ('cancelled', 'refused', 'refunded') then raise exception 'Commande annulée : rien à payer'; end if;
    if coalesce(o.delivery_info->>'country_code', 'CG') <> 'CG' then
        raise exception 'Le paiement en ligne n''est pas encore disponible en RDC : le livreur encaisse directement.';
    end if;
    if o.payment_method = 'paypal' then raise exception 'PayPal : Ouenze t''envoie le lien de paiement séparément.'; end if;

    ch := coalesce(wanted_channel, case when o.payment_method = 'card' then 'CREDIT_CARD' else 'MOBILE_MONEY' end);
    if ch not in ('MOBILE_MONEY', 'CREDIT_CARD') then raise exception 'Moyen de paiement inconnu'; end if;
    if ch = 'MOBILE_MONEY' and o.status <> 'delivered' and not public.is_team() then
        raise exception 'Le paiement Mobile Money se fait à la livraison, après le code de remise.';
    end if;

    select * into t from public.payment_transactions
     where order_id = o.id and channel = ch and status in ('created', 'pending')
       and payment_url is not null and created_at > now() - interval '30 minutes'
     order by created_at desc limit 1;
    if t.id is not null then
        return jsonb_build_object('reuse', true, 'transaction_id', t.transaction_id, 'payment_url', t.payment_url,
            'amount', t.amount, 'currency', t.currency, 'channel', t.channel, 'phone', t.phone,
            'order_number', o.order_number, 'provider', t.provider);
    end if;

    -- CinetPay demande un montant multiple de 5 : on arrondit au multiple de 5 inférieur (au profit du client)
    amt := floor(o.total / 5) * 5;
    if amt < 100 then raise exception 'Montant trop faible pour un paiement en ligne'; end if;
    insert into public.payment_transactions (transaction_id, order_id, amount, currency, channel, phone, created_by)
    values ('OZ' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 18)), o.id, amt, 'XAF', ch,
            coalesce(o.delivery_info->>'payment_phone', o.delivery_info->>'phone'), auth.uid())
    returning * into t;
    return jsonb_build_object('reuse', false, 'transaction_id', t.transaction_id, 'amount', t.amount, 'currency', t.currency,
        'channel', t.channel, 'phone', t.phone, 'order_number', o.order_number,
        'client_name', public.account_label(o.client_id));
end;
$$;
revoke all on function public.payment_prepare(uuid, text) from public, anon;
grant execute on function public.payment_prepare(uuid, text) to authenticated;

-- ---------- Réservé au serveur (clé service_role) ----------
create or replace function public.payment_attach(tx text, new_provider text, url text, info jsonb default null)
returns void
language sql
security definer
set search_path = public
as $$
    update public.payment_transactions
       set provider = new_provider, payment_url = url, status = 'pending', provider_data = coalesce(info, provider_data), updated_at = now()
     where transaction_id = tx and status = 'created';
$$;
revoke all on function public.payment_attach(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.payment_attach(text, text, text, jsonb) to service_role;

-- Paiement vérifié auprès de CinetPay (ou simulation par l'équipe) → commande payée
create or replace function public.payment_settle(tx text, accepted boolean, ref text default null, info jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    t public.payment_transactions;
    o record;
    a record;
begin
    select * into t from public.payment_transactions where transaction_id = tx for update;
    if t.id is null then raise exception 'Transaction inconnue'; end if;
    if t.status = 'accepted' then return jsonb_build_object('status', 'accepted', 'already', true); end if;
    if not accepted then
        update public.payment_transactions set status = 'refused', provider_data = coalesce(info, provider_data), updated_at = now()
         where id = t.id and status in ('created', 'pending');
        return jsonb_build_object('status', 'refused');
    end if;
    update public.payment_transactions
       set status = 'accepted', provider_ref = left(ref, 100), provider_data = coalesce(info, provider_data), paid_at = now(), updated_at = now()
     where id = t.id;
    select id, order_number, client_id, payment_status into o from public.orders where id = t.order_id for update;
    if o.payment_status <> 'paid' then
        update public.orders
           set payment_status = 'paid',
               delivery_info = delivery_info || jsonb_build_object('payment_ref', coalesce(left(ref, 100), t.transaction_id),
                   'paid_at', now(), 'payment_provider', t.provider, 'payment_channel', t.channel),
               updated_at = now()
         where id = o.id;
        insert into public.order_events (order_id, actor_id, action, details)
        values (o.id, null, 'paid', (case when t.provider = 'simulation' then 'SIMULATION · ' else 'CinetPay · ' end)
                || case t.channel when 'CREDIT_CARD' then 'carte' else 'Mobile Money' end || ' · ' || public.fcfa(t.amount)
                || coalesce(' · réf. ' || ref, ''));
        perform public.notify_user(o.client_id, 'order_paid', 'Paiement reçu pour ' || o.order_number,
            'Merci ! Ton paiement de ' || public.fcfa(t.amount) || ' est confirmé.', o.id, null);
        for a in select user_id from public.admin_users union select user_id from public.team_members loop
            perform public.notify_user(a.user_id, 'order_paid', 'Commande ' || o.order_number || ' payée',
                public.fcfa(t.amount) || ' · ' || case t.channel when 'CREDIT_CARD' then 'carte bancaire' else 'Mobile Money' end
                || case when t.provider = 'simulation' then ' (simulation)' else '' end, o.id, null);
        end loop;
    end if;
    return jsonb_build_object('status', 'accepted', 'order_number', o.order_number);
end;
$$;
revoke all on function public.payment_settle(text, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.payment_settle(text, boolean, text, jsonb) to service_role;

-- ---------- Page de paiement (lien envoyé par SMS) : lecture par l'identifiant imprévisible ----------
create or replace function public.payment_public(tx text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object('transaction_id', t.transaction_id, 'amount', t.amount, 'currency', t.currency,
               'channel', t.channel, 'status', t.status, 'provider', t.provider, 'payment_url', t.payment_url,
               'order_number', o.order_number, 'order_paid', o.payment_status = 'paid', 'created_at', t.created_at,
               'shop_name', (select s.name from public.order_items oi join public.shops s on s.id = oi.shop_id where oi.order_id = o.id limit 1))
      from public.payment_transactions t
      join public.orders o on o.id = t.order_id
     where t.transaction_id = tx and length(tx) >= 12;
$$;
revoke all on function public.payment_public(text) from public;
grant execute on function public.payment_public(text) to anon, authenticated;

notify pgrst, 'reload schema';


-- >>>>>>>>>> 20261102_delivery_rate.sql
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


-- >>>>>>>>>> 20261103_admin_overview.sql
-- ============================================================
-- Tableau de bord admin (admin.html) : compteurs et chiffres du jour
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261028 (reports), 20261030 (équipe), 20261031 (trade).
-- Lecture seule : cette fonction ne modifie rien.
-- ============================================================

create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    today timestamptz := date_trunc('day', now() at time zone 'Africa/Brazzaville') at time zone 'Africa/Brazzaville';
    week timestamptz := today - interval '6 days';
    live text[] := array['delivered', 'cancelled', 'refused', 'refunded'];
    r jsonb;
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    select jsonb_build_object(
        'to_call', (select count(*) from public.orders o
                     where o.status <> all(live) and coalesce(o.payment_status, '') <> 'test'
                       and not coalesce((o.delivery_info->>'call_confirmed')::boolean, false)),
        'waiting_vendor', (select count(*) from public.orders where status = 'pending' and coalesce(payment_status, '') <> 'test'),
        'waiting_courier', (select count(*) from public.orders where status = 'accepted' and coalesce(payment_status, '') <> 'test'),
        'in_delivery', (select count(*) from public.orders where status in ('courier_assigned', 'picked_up', 'in_transit') and coalesce(payment_status, '') <> 'test'),
        'to_pay', (select count(*) from public.orders where status = 'delivered' and payment_status = 'cod'),
        'vendor_apps', (select count(*) from public.vendor_applications where status = 'pending'),
        'courier_apps', (select count(*) from public.delivery_applications where status = 'pending'),
        'reports', (select count(*) from public.reports where status = 'open'),
        'trade_review', (select count(*) from public.trade_operations where status = 'submitted'),
        'trade_pending_lines', (select count(*) from public.trade_entries e join public.trade_operations t on t.id = e.operation_id
                                 where e.status = 'pending' and t.status = 'running'),
        'orders_today', (select count(*) from public.orders where created_at >= today and coalesce(payment_status, '') <> 'test'),
        'orders_week', (select count(*) from public.orders where created_at >= week and coalesce(payment_status, '') <> 'test'),
        'sales_today', (select coalesce(sum(total), 0) from public.orders where created_at >= today and status <> all(array['cancelled', 'refused', 'refunded']) and coalesce(payment_status, '') <> 'test'),
        'sales_week', (select coalesce(sum(total), 0) from public.orders where created_at >= week and status <> all(array['cancelled', 'refused', 'refunded']) and coalesce(payment_status, '') <> 'test'),
        'delivered_week', (select count(*) from public.orders where status = 'delivered' and updated_at >= week and coalesce(payment_status, '') <> 'test'),
        'paid_week', (select coalesce(sum(total), 0) from public.orders where payment_status = 'paid' and updated_at >= week),
        'shops_active', (select count(*) from public.shops where coalesce(is_active, true) and archived_at is null),
        'couriers_online', (select count(*) from public.courier_presence where online and updated_at > now() - interval '15 minutes'),
        'orders_mode', public.orders_mode(),
        'delivery_rate', public.delivery_rate()
    ) into r;
    return r;
end;
$$;
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

notify pgrst, 'reload schema';


-- >>>>>>>>>> 20261104_admin_shops.sql
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


-- >>>>>>>>>> 20261105_admin_search.sql
-- ============================================================
-- Recherche admin et fiches complètes (admin-search.html)
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
-- Prérequis : 20261016 (avis), 20261019 (livreurs), 20261028 (signalements),
--             20261030 (équipe), 20261031 (trade), 20261101 (paiements), 20261104 (boutiques).
--
-- admin_search(q)      : une seule barre pour trouver une personne (client, vendeur, livreur),
--                        une boutique ou une commande (numéro, code de remise, référence de paiement).
-- admin_person(id)     : tout sur une personne (profil, chiffre d'affaires, croissance, commandes…).
-- admin_order(id)      : tout sur une commande (articles, acteurs, paiement, historique).
-- Lecture seule, réservé aux administrateurs. Le code de remise lui-même n'est jamais affiché.
-- ============================================================

-- ---------- Recherche ----------
create or replace function public.admin_search(q text)
returns table (kind text, id uuid, title text, subtitle text, badge text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    term text := btrim(coalesce(q, ''));
    digits text := regexp_replace(coalesce(q, ''), '\D', '', 'g');
    like_term text;
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    if char_length(term) < 2 then return; end if;
    like_term := '%' || replace(replace(term, '%', ''), '_', '') || '%';

    return query
    -- Commandes : numéro, code de remise (exact), référence de paiement ou transaction
    (select 'order'::text, o.id, o.order_number::text,
            coalesce((select s.name::text from public.order_items oi join public.shops s on s.id = oi.shop_id where oi.order_id = o.id limit 1), '')
              || ' · ' || public.account_label(o.client_id) || ' · ' || public.fcfa(o.total),
            o.status::text, o.created_at
       from public.orders o
      where o.order_number ilike like_term
         or o.id::text = term
         or coalesce(o.delivery_info->>'payment_ref', '') ilike like_term
         or exists (select 1 from public.delivery_codes dc where dc.order_id = o.id and dc.code = term)
         or exists (select 1 from public.payment_transactions t where t.order_id = o.id
                     and (t.transaction_id ilike like_term or coalesce(t.provider_ref, '') ilike like_term))
      order by o.created_at desc limit 15)
    union all
    -- Personnes : nom, email, téléphone, plaque du véhicule (livreurs)
    (select 'person'::text, u.id, public.account_label(u.id),
            concat_ws(' · ', nullif(u.email, ''), coalesce(u.raw_user_meta_data->>'phone', case when u.phone <> '' then '+' || u.phone end), da.plate_number),
            concat_ws(', ',
                case when exists (select 1 from public.admin_users a where a.user_id = u.id) then 'admin' end,
                case when exists (select 1 from public.shops s where s.owner_id = u.id) or p.user_type = 'vendeur' then 'vendeur' end,
                case when da.status = 'approved' then 'livreur' when da.status = 'pending' then 'livreur (en attente)' end,
                case when exists (select 1 from public.orders o where o.client_id = u.id) then 'client' end),
            u.created_at
       from auth.users u
       left join public.profiles p on p.id = u.id
       left join public.delivery_applications da on da.user_id = u.id
      where coalesce(u.raw_user_meta_data->>'full_name', '') ilike like_term
         or coalesce(p.full_name, '') ilike like_term
         or coalesce(u.email, '') ilike like_term
         or coalesce(da.full_name, '') ilike like_term
         or coalesce(da.plate_number, '') ilike like_term
         or (char_length(digits) >= 4 and (
               regexp_replace(coalesce(u.raw_user_meta_data->>'phone', ''), '\D', '', 'g') like '%' || digits || '%'
            or coalesce(u.phone, '') like '%' || digits || '%'
            or regexp_replace(coalesce(da.phone, ''), '\D', '', 'g') like '%' || digits || '%'))
      order by u.created_at desc limit 15)
    union all
    -- Boutiques
    (select 'shop'::text, s.id, s.name::text,
            concat_ws(' · ', nullif(concat_ws(', ', s.district, s.city), ''), public.account_label(s.owner_id)),
            case when s.archived_at is not null then 'supprimée' when s.suspended_at is not null then 'suspendue' else 'active' end,
            s.created_at
       from public.shops s
      where s.name ilike like_term or coalesce(s.city, '') ilike like_term
      order by s.created_at desc limit 10);
end;
$$;
revoke all on function public.admin_search(text) from public, anon;
grant execute on function public.admin_search(text) to authenticated;

-- ---------- Série mensuelle (6 derniers mois) ----------
create or replace function public.admin_months()
returns table (m date)
language sql
stable
as $$
    select generate_series(date_trunc('month', now())::date - interval '5 months', date_trunc('month', now())::date, interval '1 month')::date;
$$;

-- ---------- Fiche d'une personne ----------
create or replace function public.admin_person(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    u record;
    p record;
    da record;
    r jsonb;
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    select * into u from auth.users where id = target;
    if u.id is null then raise exception 'Compte introuvable'; end if;
    select * into p from public.profiles where id = target;
    select * into da from public.delivery_applications where user_id = target;

    r := jsonb_build_object(
        'account', jsonb_build_object(
            'id', u.id, 'name', public.account_label(u.id), 'email', u.email,
            'phone', coalesce(u.raw_user_meta_data->>'phone', case when u.phone <> '' then '+' || u.phone end),
            'city', coalesce(u.raw_user_meta_data->>'city', to_jsonb(p)->>'city'), 'country', u.raw_user_meta_data->>'country',
            'provider', coalesce(u.raw_app_meta_data->>'provider', 'email'),
            'created_at', u.created_at, 'last_login', u.last_sign_in_at, 'user_type', to_jsonb(p)->>'user_type',
            'is_admin', exists (select 1 from public.admin_users a where a.user_id = u.id),
            'is_agent', exists (select 1 from public.team_members t where t.user_id = u.id),
            'vendor_status', (select status from public.vendor_applications v where v.user_id = u.id),
            'courier_status', da.status),

        -- Client : ce qu'il a commandé
        'client', (select jsonb_build_object(
            'orders', count(*),
            'delivered', count(*) filter (where o.status = 'delivered'),
            'cancelled', count(*) filter (where o.status in ('cancelled', 'refused', 'refunded')),
            'spent', coalesce(sum(o.total) filter (where o.status = 'delivered'), 0),
            'unpaid', count(*) filter (where o.status = 'delivered' and o.payment_status = 'cod'),
            'avg_basket', coalesce(round(avg(o.total) filter (where o.status = 'delivered')), 0),
            'last_order_at', max(o.created_at),
            'monthly', (select jsonb_agg(jsonb_build_object('month', mm.m, 'value',
                    coalesce((select sum(x.total) from public.orders x where x.client_id = target and x.status = 'delivered'
                               and coalesce(x.payment_status, '') <> 'test' and date_trunc('month', x.created_at)::date = mm.m), 0)) order by mm.m)
                from public.admin_months() mm))
            from public.orders o where o.client_id = target and coalesce(o.payment_status, '') <> 'test'),
        'client_orders', coalesce((select jsonb_agg(x order by x.created_at desc) from (
            select o.id, o.order_number, o.created_at, o.status, o.payment_status, o.total,
                   (select s.name from public.order_items oi join public.shops s on s.id = oi.shop_id where oi.order_id = o.id limit 1) as shop
              from public.orders o where o.client_id = target order by o.created_at desc limit 20) x), '[]'::jsonb),

        -- Vendeur : ses boutiques et leur chiffre d'affaires
        'shops', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'city', s.city,
                'status', case when s.archived_at is not null then 'supprimée' when s.suspended_at is not null then 'suspendue' else 'active' end,
                'rating', s.rating, 'stats', public.admin_shop_stats(s.id)) order by s.created_at)
            from public.shops s where s.owner_id = target), '[]'::jsonb),
        'vendor_monthly', (select jsonb_agg(jsonb_build_object('month', mm.m, 'value',
                coalesce((select sum(oi.total_price) from public.order_items oi join public.orders o on o.id = oi.order_id
                           join public.shops s on s.id = oi.shop_id
                          where s.owner_id = target and o.status = 'delivered' and coalesce(o.payment_status, '') <> 'test'
                            and date_trunc('month', o.created_at)::date = mm.m), 0)) order by mm.m)
            from public.admin_months() mm),

        -- Livreur : ses courses et ses gains
        'courier', case when da.id is null then null else jsonb_build_object(
            'full_name', da.full_name, 'phone', da.phone, 'city', da.city, 'district', da.district,
            'vehicle', da.vehicle_type, 'brand', da.vehicle_brand, 'plate', da.plate_number,
            'license_expiry', da.license_expiry, 'status', da.status, 'since', da.reviewed_at,
            'deliveries', (select count(*) from public.orders o where o.deliverer_id = target and o.status = 'delivered' and coalesce(o.payment_status, '') <> 'test'),
            'in_progress', (select count(*) from public.orders o where o.deliverer_id = target and o.status in ('courier_assigned', 'picked_up', 'in_transit')),
            'earnings', (select coalesce(sum(o.delivery_fees), 0) from public.orders o where o.deliverer_id = target and o.status = 'delivered' and coalesce(o.payment_status, '') <> 'test'),
            'last_delivery_at', (select max(o.updated_at) from public.orders o where o.deliverer_id = target and o.status = 'delivered'),
            'rating', (select round(avg(stars), 1) from public.courier_reviews cr where cr.courier_id = target),
            'reviews', (select count(*) from public.courier_reviews cr where cr.courier_id = target),
            'online', (select online and updated_at > now() - interval '15 minutes' from public.courier_presence cp where cp.courier_id = target),
            'monthly', (select jsonb_agg(jsonb_build_object('month', mm.m, 'value',
                    (select count(*) from public.orders x where x.deliverer_id = target and x.status = 'delivered'
                      and coalesce(x.payment_status, '') <> 'test' and date_trunc('month', x.updated_at)::date = mm.m)) order by mm.m)
                from public.admin_months() mm),
            'recent', coalesce((select jsonb_agg(x order by x.updated_at desc) from (
                select o.id, o.order_number, o.updated_at, o.status, o.delivery_fees from public.orders o
                 where o.deliverer_id = target order by o.updated_at desc limit 10) x), '[]'::jsonb)) end,

        -- Signalements, avis, Trade
        'reports_made', (select count(*) from public.reports r where r.reporter_id = target),
        'reports_against', (select count(*) from public.reports r
                             where r.courier_id = target or r.shop_id in (select s.id from public.shops s where s.owner_id = target)),
        'reviews_written', (select count(*) from public.shop_reviews sr where sr.client_id = target),
        'trade', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0))
                    from public.trade_pledges tp where tp.investor_id = target and tp.status in ('active', 'released'))
    );
    return r;
end;
$$;
revoke all on function public.admin_person(uuid) from public, anon;
grant execute on function public.admin_person(uuid) to authenticated;

-- ---------- Fiche d'une commande ----------
create or replace function public.admin_order(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    o public.orders;
    s record;
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    select * into o from public.orders where id = target;
    if o.id is null then raise exception 'Commande introuvable'; end if;
    select * into s from public.order_shop(o.id);
    return jsonb_build_object(
        'order', jsonb_build_object('id', o.id, 'order_number', o.order_number, 'created_at', o.created_at, 'updated_at', o.updated_at,
            'status', o.status, 'payment_status', o.payment_status, 'payment_method', o.payment_method,
            'subtotal', o.subtotal, 'delivery_fees', o.delivery_fees, 'total', o.total, 'notes', o.notes,
            'delivery', o.delivery_info - 'notified'),
        'items', coalesce((select jsonb_agg(jsonb_build_object('name', oi.product_name, 'variant', oi.variant_name,
                'quantity', oi.quantity, 'unit_price', oi.unit_price, 'total', oi.total_price))
            from public.order_items oi where oi.order_id = o.id), '[]'::jsonb),
        'shop', jsonb_build_object('id', s.shop_id, 'name', s.shop_name, 'owner_id', s.owner_id, 'owner', public.account_label(s.owner_id),
            'owner_phone', (select coalesce(raw_user_meta_data->>'phone', case when phone <> '' then '+' || phone end) from auth.users where id = s.owner_id)),
        'client', jsonb_build_object('id', o.client_id, 'name', public.account_label(o.client_id)),
        'courier', case when o.deliverer_id is null then null else jsonb_build_object('id', o.deliverer_id, 'name', public.account_label(o.deliverer_id),
            'phone', (select phone from public.delivery_applications where user_id = o.deliverer_id)) end,
        -- Jamais le code lui-même : seulement combien de fois il a été envoyé et essayé
        'code', (select jsonb_build_object('sends', to_jsonb(dc)->'sends', 'sent_at', to_jsonb(dc)->'sent_at', 'attempts', dc.attempts)
                   from public.delivery_codes dc where dc.order_id = o.id),
        'payments', coalesce((select jsonb_agg(jsonb_build_object('transaction_id', t.transaction_id, 'channel', t.channel, 'provider', t.provider,
                'status', t.status, 'amount', t.amount, 'provider_ref', t.provider_ref, 'created_at', t.created_at, 'paid_at', t.paid_at) order by t.created_at desc)
            from public.payment_transactions t where t.order_id = o.id), '[]'::jsonb),
        'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'details', e.details, 'created_at', e.created_at,
                'actor', coalesce(public.account_label(e.actor_id), 'Système')) order by e.created_at desc)
            from public.order_events e where e.order_id = o.id), '[]'::jsonb),
        'reviews', jsonb_build_object(
            'shop', (select jsonb_build_object('stars', sr.stars, 'comment', sr.comment) from public.shop_reviews sr where sr.order_id = o.id limit 1),
            'courier', (select jsonb_build_object('stars', cr.stars, 'comment', cr.comment) from public.courier_reviews cr where cr.order_id = o.id limit 1)),
        'reports', (select count(*) from public.reports r where r.order_id = o.id)
    );
end;
$$;
revoke all on function public.admin_order(uuid) from public, anon;
grant execute on function public.admin_order(uuid) to authenticated;

notify pgrst, 'reload schema';


-- >>>>>>>>>> 20261106_favorites_foryou.sql
-- ============================================================
-- 20261106 — Favoris et sélection « Pour toi »
--
-- • favorites : boutiques et produits mis en favori par chaque client (chacun ne voit que les siens).
-- • user_taste : les goûts du client (catégories, boutiques, prix vus) pour retrouver
--   sa sélection « Pour toi » sur un autre téléphone. Mis à jour au plus toutes les quelques minutes.
-- • trending_products(city) : les produits les plus commandés sur 30 jours (aucune donnée personnelle).
-- Relançable sans danger.
-- ============================================================

create table if not exists public.favorites (
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    kind text not null check (kind in ('shop', 'product')),
    target_id uuid not null,
    created_at timestamptz not null default now(),
    primary key (user_id, kind, target_id)
);
create index if not exists favorites_target_idx on public.favorites (kind, target_id);

alter table public.favorites enable row level security;
drop policy if exists favorites_select_own on public.favorites;
create policy favorites_select_own on public.favorites for select to authenticated using (user_id = auth.uid());
drop policy if exists favorites_insert_own on public.favorites;
create policy favorites_insert_own on public.favorites for insert to authenticated with check (user_id = auth.uid());
drop policy if exists favorites_delete_own on public.favorites;
create policy favorites_delete_own on public.favorites for delete to authenticated using (user_id = auth.uid());
revoke all on public.favorites from anon;
grant select, insert, delete on public.favorites to authenticated;

create table if not exists public.user_taste (
    user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
    taste jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    constraint user_taste_size check (pg_column_size(taste) < 16000)
);
alter table public.user_taste enable row level security;
drop policy if exists user_taste_own on public.user_taste;
create policy user_taste_own on public.user_taste for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.user_taste from anon;
grant select, insert, update on public.user_taste to authenticated;

-- Nombre de favoris d'une boutique ou d'un produit (pour « 12 personnes aiment »), sans dire qui
create or replace function public.favorite_counts(ids uuid[])
returns table (target_id uuid, likes bigint)
language sql stable security definer set search_path = public
as $$
    select f.target_id, count(*)::bigint
    from public.favorites f
    where f.target_id = any(ids[1:200])
    group by f.target_id;
$$;
revoke all on function public.favorite_counts(uuid[]) from public;
grant execute on function public.favorite_counts(uuid[]) to anon, authenticated;

-- Produits les plus commandés sur 30 jours (commandes non annulées, hors tests)
create or replace function public.trending_products(city text default null)
returns table (product_id uuid, orders bigint, units bigint)
language sql stable security definer set search_path = public
as $$
    select oi.product_id, count(distinct oi.order_id)::bigint, coalesce(sum(oi.quantity), 0)::bigint
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.products p on p.id = oi.product_id
    join public.shops s on s.id = p.shop_id
    where o.created_at > now() - interval '30 days'
      and coalesce(o.status, '') not in ('cancelled', 'annulee', 'canceled')
      and coalesce(o.payment_status, '') <> 'test'
      and coalesce(p.is_active, true)
      and (city is null or city = '' or lower(coalesce(s.city, '')) = lower(city))
    group by oi.product_id
    order by 2 desc, 3 desc
    limit 60;
$$;
revoke all on function public.trending_products(text) from public;
grant execute on function public.trending_products(text) to anon, authenticated;

-- Catalogue léger pour l'accueil « Pour toi » : pas de photos (elles pèsent lourd),
-- seulement de quoi classer et afficher les cartes. Respecte la RLS (security invoker).
-- city : une ville (insensible à la casse) ou null pour toutes.
create or replace function public.product_feed(city text default null, lim int default 240)
returns table (
    id uuid, shop_id uuid, shop_name text, shop_city text, name text, description text,
    price numeric, max_price numeric, versions int, stock int, out_of_stock boolean,
    has_photo boolean, created_at timestamptz
)
language sql stable set search_path = public
as $$
    with base as (
        select p.*, to_jsonb(p) as j, s.name as s_name, s.city as s_city,
            case when jsonb_typeof(p.variants -> 'items') = 'array' then p.variants -> 'items' else '[]'::jsonb end as items
        from public.products p
        join public.shops s on s.id = p.shop_id
        where coalesce(p.is_active, true)
          and coalesce(to_jsonb(s) ->> 'is_active', 'true') <> 'false'
          and to_jsonb(s) ->> 'archived_at' is null
          and to_jsonb(s) ->> 'suspended_at' is null
          and (city is null or city = '' or lower(coalesce(s.city, '')) = lower(city))
        order by p.created_at desc nulls last
        limit greatest(1, least(coalesce(lim, 240), 400))
    ), v as (
        select b.id,
            (select min((x ->> 'price')::numeric) from jsonb_array_elements(b.items) x
              where x ? 'key' and (x ->> 'price') ~ '^[0-9.]+$' and (x ->> 'price')::numeric > 0) as vmin,
            (select max((x ->> 'price')::numeric) from jsonb_array_elements(b.items) x
              where x ? 'key' and (x ->> 'price') ~ '^[0-9.]+$' and (x ->> 'price')::numeric > 0) as vmax,
            (select count(*) from jsonb_array_elements(b.items) x where x ? 'key')::int as vcount,
            (select coalesce(sum(case when (x ->> 'stock') ~ '^-?[0-9]+$' then (x ->> 'stock')::int else 0 end), 0)
               from jsonb_array_elements(b.items) x where x ? 'key')::int as vstock,
            exists (select 1 from jsonb_array_elements(b.items) x
                    where jsonb_typeof(x -> 'photos') = 'array' and jsonb_array_length(x -> 'photos') > 0) as vphoto
        from base b
    )
    select b.id, b.shop_id, b.s_name, b.s_city, b.name, left(b.j ->> 'description', 300),
        coalesce(v.vmin, b.price), coalesce(v.vmax, b.price), v.vcount,
        case when v.vcount > 0 then v.vstock else coalesce(b.stock, 0) end,
        (case when v.vcount > 0 then v.vstock else coalesce(b.stock, 0) end) <= 0 and coalesce(b.stock, 0) <> 0,
        coalesce(array_length(b.photos, 1), 0) > 0 or v.vphoto,
        b.created_at
    from base b join v on v.id = b.id;
$$;
grant execute on function public.product_feed(text, int) to anon, authenticated;

-- Première photo des produits affichés (30 au plus par appel)
create or replace function public.product_covers(ids uuid[])
returns table (id uuid, cover text)
language sql stable set search_path = public
as $$
    select p.id,
        coalesce(p.photos[1], (
            select x -> 'photos' ->> 0 from jsonb_array_elements(
                case when jsonb_typeof(p.variants -> 'items') = 'array' then p.variants -> 'items' else '[]'::jsonb end) x
            where jsonb_typeof(x -> 'photos') = 'array' and jsonb_array_length(x -> 'photos') > 0 limit 1))
    from public.products p
    where p.id = any(ids[1:30]);
$$;
grant execute on function public.product_covers(uuid[]) to anon, authenticated;
