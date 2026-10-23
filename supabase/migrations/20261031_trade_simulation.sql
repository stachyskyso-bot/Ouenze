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
create or replace function public.trade_list(scope text default 'open')
returns table (id uuid, title text, shop_name text, status text, goal_amount numeric, vendor_contribution numeric,
               expected_revenue numeric, duration_days integer, collect_ends_at timestamptz, started_at timestamptz,
               ends_at timestamptz, created_at timestamptz, figures jsonb, my_pledge numeric, is_owner boolean)
language sql
stable
security definer
set search_path = public
as $$
    select o.id, o.title, s.name::text, o.status, o.goal_amount, o.vendor_contribution, o.expected_revenue,
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
