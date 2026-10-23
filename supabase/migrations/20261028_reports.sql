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
