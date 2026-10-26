-- ============================================================
-- 20261110 — Réserve de garantie des livreurs (MODE SIMULATION)
--
-- Décision de GOAT (via GRIOT) :
--   • à chaque livraison terminée, 10 % des frais de livraison vont dans une réserve individuelle,
--     90 % sont versés tout de suite ;
--   • chaque somme reste bloquée 30 à 60 jours (réglage, 45 par défaut), puis elle est rendue
--     en entier si aucune réclamation n'est ouverte ;
--   • réserve plafonnée à 30 000 FCFA : au plafond, le livreur reçoit 100 % de ses courses ;
--   • une déduction exige des preuves, une notification et 72 heures pour contester ;
--   • un livreur qui quitte Ouenze reçoit tout son solde non contesté ;
--   • la réserve n'est ni une commission ni un revenu pour Ouenze ;
--     aucun livreur ne paie pour la faute d'un autre (chaque compte est séparé).
--
-- SIMULATION : rien n'est réellement retenu. Le registre calcule et enregistre ce qui se passerait,
-- en attendant la validation du prestataire de paiement et du cadre juridique. Le passage à de
-- l'argent réel se fera par une migration séparée (réglage reserve_mode), jamais par erreur.
--
-- Registre : chaque mouvement est inscrit une fois, ne peut être ni modifié ni effacé, et porte
-- l'empreinte du mouvement précédent du même livreur (toute retouche du passé se voit).
-- Relançable sans danger.
-- ============================================================

-- ---------- Réglages ----------
insert into public.app_settings (key, value) values ('reserve_rate', '0.10') on conflict (key) do nothing;
insert into public.app_settings (key, value) values ('reserve_cap', '30000') on conflict (key) do nothing;
insert into public.app_settings (key, value) values ('reserve_hold_days', '45') on conflict (key) do nothing;
insert into public.app_settings (key, value) values ('reserve_mode', '"simulation"') on conflict (key) do nothing;

create or replace function public.reserve_setting(k text, fallback numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
    select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = k), fallback);
$$;
revoke all on function public.reserve_setting(text, numeric) from public;

-- ---------- Registre des mouvements ----------
create table if not exists public.courier_reserve_ledger (
    id bigserial primary key,
    courier_id uuid not null references auth.users(id) on delete restrict,
    kind text not null check (kind in ('contribution', 'release', 'debit', 'debit_reversal', 'closure')),
    amount numeric not null check (amount <> 0 or kind = 'closure'),   -- + entre dans la réserve, − en sort
    order_id uuid,
    incident_id uuid,
    available_at timestamptz,                              -- contribution : date à partir de laquelle elle peut être rendue
    note text,
    simulation boolean not null default true,
    created_by uuid,
    created_at timestamptz not null default now(),
    prev_hash text,
    hash text not null
);
create index if not exists courier_reserve_ledger_courier on public.courier_reserve_ledger (courier_id, id);
create unique index if not exists courier_reserve_one_contribution
    on public.courier_reserve_ledger (order_id) where kind = 'contribution';

alter table public.courier_reserve_ledger enable row level security;
drop policy if exists reserve_ledger_read on public.courier_reserve_ledger;
create policy reserve_ledger_read on public.courier_reserve_ledger for select to authenticated
    using (courier_id = auth.uid() or public.is_admin());
revoke all on public.courier_reserve_ledger from anon, authenticated;
grant select on public.courier_reserve_ledger to authenticated;

-- Aucun mouvement ne peut être modifié ni effacé (même par un admin) : on corrige par un mouvement inverse
create or replace function public.reserve_ledger_immutable()
returns trigger
language plpgsql
as $$
begin
    raise exception 'Le registre de la réserve ne peut pas être modifié : ajoute un mouvement de correction';
end;
$$;
drop trigger if exists reserve_ledger_no_update on public.courier_reserve_ledger;
create trigger reserve_ledger_no_update before update or delete on public.courier_reserve_ledger
    for each row execute function public.reserve_ledger_immutable();

-- Empreinte enchaînée (calculée par la base, pas par l'appelant)
create or replace function public.reserve_ledger_chain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform pg_advisory_xact_lock(hashtext('reserve:' || new.courier_id::text));
    select l.hash into new.prev_hash from public.courier_reserve_ledger l
     where l.courier_id = new.courier_id order by l.id desc limit 1;
    new.created_at := now();
    new.hash := md5(coalesce(new.prev_hash, '') || '|' || new.courier_id || '|' || new.kind || '|' || new.amount
                    || '|' || coalesce(new.order_id::text, '') || '|' || coalesce(new.incident_id::text, '')
                    || '|' || coalesce(new.available_at::text, '') || '|' || coalesce(new.note, '')
                    || '|' || new.simulation || '|' || new.created_at);
    return new;
end;
$$;
drop trigger if exists reserve_ledger_chain on public.courier_reserve_ledger;
create trigger reserve_ledger_chain before insert on public.courier_reserve_ledger
    for each row execute function public.reserve_ledger_chain();

-- ---------- Réclamations (incidents) ----------
create table if not exists public.courier_reserve_incidents (
    id uuid primary key default gen_random_uuid(),
    courier_id uuid not null references auth.users(id) on delete restrict,
    order_id uuid,
    kind text not null check (kind in ('loss', 'theft', 'fraud', 'damage')),
    amount numeric not null check (amount > 0),
    description text not null,
    evidence text not null,
    status text not null default 'open' check (status in ('open', 'contested', 'upheld', 'rejected', 'cancelled')),
    opened_by uuid,
    opened_at timestamptz not null default now(),
    contest_deadline timestamptz not null default now() + interval '72 hours',
    contest_text text,
    contest_at timestamptz,
    decided_by uuid,
    decided_at timestamptz,
    decision_note text,
    debited numeric not null default 0
);
create index if not exists courier_reserve_incidents_courier on public.courier_reserve_incidents (courier_id, status);
alter table public.courier_reserve_incidents enable row level security;
drop policy if exists reserve_incidents_read on public.courier_reserve_incidents;
create policy reserve_incidents_read on public.courier_reserve_incidents for select to authenticated
    using (courier_id = auth.uid() or public.is_admin());
revoke all on public.courier_reserve_incidents from anon, authenticated;
grant select on public.courier_reserve_incidents to authenticated;

-- ---------- Calculs ----------
-- Solde, part encore bloquée, montant réclamé en cours
create or replace function public.reserve_figures(target uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with l as (select * from public.courier_reserve_ledger where courier_id = target),
    f as (
        select coalesce(sum(amount), 0) as balance,
               -- contributions encore dans leur délai de blocage, moins ce qui en a déjà été déduit
               coalesce(sum(amount) filter (where kind = 'contribution' and available_at > now()), 0) as locked_raw,
               min(available_at) filter (where kind = 'contribution' and available_at > now()) as next_release,
               bool_or(kind = 'closure') as closed
          from l
    ),
    c as (select coalesce(sum(amount - debited), 0) as claimed
            from public.courier_reserve_incidents where courier_id = target and status in ('open', 'contested'))
    select jsonb_build_object(
        'balance', f.balance,
        'locked', least(f.locked_raw, f.balance),
        'claimed', least(c.claimed, f.balance),
        'releasable', greatest(0, f.balance - least(f.locked_raw, f.balance) - c.claimed),
        'next_release', f.next_release,
        'closed', coalesce(f.closed, false),
        'cap', public.reserve_setting('reserve_cap', 30000),
        'rate', public.reserve_setting('reserve_rate', 0.10),
        'hold_days', public.reserve_setting('reserve_hold_days', 45),
        'mode', coalesce((select value #>> '{}' from public.app_settings where key = 'reserve_mode'), 'simulation')
    )
    from f, c;
$$;
revoke all on function public.reserve_figures(uuid) from public;

-- Contribution automatique quand une course est livrée (10 %, jusqu'au plafond)
create or replace function public.reserve_on_delivered()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    fig jsonb;
    part numeric;
begin
    if new.status <> 'delivered' or old.status = 'delivered' or new.deliverer_id is null then return new; end if;
    if coalesce(new.delivery_fees, 0) <= 0 or coalesce(new.payment_status, '') = 'test' then return new; end if;
    if exists (select 1 from public.courier_reserve_ledger where order_id = new.id and kind = 'contribution') then return new; end if;
    fig := public.reserve_figures(new.deliverer_id);
    if (fig->>'closed')::boolean then return new; end if;
    part := least(round(new.delivery_fees * (fig->>'rate')::numeric),
                  greatest(0, (fig->>'cap')::numeric - (fig->>'balance')::numeric));
    if part > 0 then
        insert into public.courier_reserve_ledger (courier_id, kind, amount, order_id, available_at, note, simulation)
        values (new.deliverer_id, 'contribution', part, new.id,
                now() + make_interval(days => (fig->>'hold_days')::integer),
                'Course ' || coalesce(new.order_number, '') || ' : ' || round((fig->>'rate')::numeric * 100) || ' % de '
                    || new.delivery_fees || ' FCFA',
                (fig->>'mode') <> 'real');
    end if;
    return new;
end;
$$;
drop trigger if exists orders_reserve_on_delivered on public.orders;
create trigger orders_reserve_on_delivered after update of status on public.orders
    for each row execute function public.reserve_on_delivered();

-- Restitution des sommes dont le délai est passé (sans réclamation ouverte sur ce montant)
create or replace function public.reserve_release_due()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare r record; fig jsonb; n integer := 0;
begin
    if auth.uid() is not null and not public.is_admin() then
        raise exception 'Réservé aux administrateurs' using errcode = '42501';
    end if;
    for r in select distinct courier_id from public.courier_reserve_ledger loop
        fig := public.reserve_figures(r.courier_id);
        if (fig->>'closed')::boolean or (fig->>'releasable')::numeric <= 0 then continue; end if;
        insert into public.courier_reserve_ledger (courier_id, kind, amount, note, simulation)
        values (r.courier_id, 'release', -((fig->>'releasable')::numeric), 'Restitution : délai de blocage passé, aucune réclamation',
                (fig->>'mode') <> 'real');
        perform public.notify_user(r.courier_id, 'reserve_release', 'Réserve : ' || public.fcfa((fig->>'releasable')::numeric) || ' rendus',
            'Ces sommes ont passé leur délai de blocage sans réclamation.' ||
            case when (fig->>'mode') <> 'real' then ' (Simulation : rien n''a été retenu.)' else '' end);
        n := n + 1;
    end loop;
    return n;
end;
$$;
revoke all on function public.reserve_release_due() from public;
grant execute on function public.reserve_release_due() to authenticated;

-- ---------- Ce que voit le livreur ----------
create or replace function public.my_reserve()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select public.reserve_figures(auth.uid()) || jsonb_build_object(
        'entries', coalesce((select jsonb_agg(to_jsonb(x) - 'prev_hash' - 'hash' - 'created_by' order by x.id desc)
                               from (select * from public.courier_reserve_ledger where courier_id = auth.uid() order by id desc limit 100) x), '[]'::jsonb),
        'incidents', coalesce((select jsonb_agg(to_jsonb(i) - 'opened_by' - 'decided_by' order by i.opened_at desc)
                                 from public.courier_reserve_incidents i where i.courier_id = auth.uid()), '[]'::jsonb)
    );
$$;
revoke all on function public.my_reserve() from public;
grant execute on function public.my_reserve() to authenticated;

-- Le livreur conteste une réclamation (72 heures)
create or replace function public.reserve_contest(target uuid, message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare i public.courier_reserve_incidents; msg text := nullif(left(btrim(coalesce(message, '')), 2000), '');
begin
    select * into i from public.courier_reserve_incidents where id = target for update;
    if i.id is null or i.courier_id <> auth.uid() then raise exception 'Réclamation introuvable'; end if;
    if i.status not in ('open', 'contested') then raise exception 'Cette réclamation est déjà tranchée'; end if;
    if now() > i.contest_deadline and i.status = 'open' then raise exception 'Le délai de 72 heures pour contester est dépassé'; end if;
    if msg is null or length(msg) < 10 then raise exception 'Explique ta version (quelques phrases)'; end if;
    update public.courier_reserve_incidents set status = 'contested', contest_text = msg, contest_at = now() where id = i.id;
    perform public.notify_user(a.user_id, 'reserve_contest', 'Réserve : un livreur conteste une réclamation',
            'À examiner dans Réserves des livreurs.') from public.admin_users a;
end;
$$;
revoke all on function public.reserve_contest(uuid, text) from public;
grant execute on function public.reserve_contest(uuid, text) to authenticated;

-- ---------- Admin ----------
create or replace function public.admin_reserves(search text default null)
returns table (courier_id uuid, name text, phone text, balance numeric, locked numeric, claimed numeric,
               releasable numeric, open_incidents integer, closed boolean, last_move timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    return query
    with ids as (
        select distinct l.courier_id as cid from public.courier_reserve_ledger l
        union select distinct i.courier_id from public.courier_reserve_incidents i
        union select da.user_id from public.delivery_applications da where da.status = 'approved'
    )
    select ids.cid, coalesce(nullif(to_jsonb(p) ->> 'full_name', ''), 'Livreur'), to_jsonb(p) ->> 'phone',
           (f->>'balance')::numeric, (f->>'locked')::numeric, (f->>'claimed')::numeric, (f->>'releasable')::numeric,
           (select count(*)::integer from public.courier_reserve_incidents i where i.courier_id = ids.cid and i.status in ('open', 'contested')),
           (f->>'closed')::boolean,
           (select max(created_at) from public.courier_reserve_ledger l where l.courier_id = ids.cid)
      from ids
      left join public.profiles p on p.id = ids.cid
      cross join lateral (select public.reserve_figures(ids.cid) as f) x
     where search is null or search = '' or (to_jsonb(p) ->> 'full_name') ilike '%' || search || '%'
           or regexp_replace(coalesce(to_jsonb(p) ->> 'phone', ''), '\D', '', 'g') like '%' || regexp_replace(search, '\D', '', 'g') || '%'
     order by 8 desc, 4 desc
     limit 200;
end;
$$;
revoke all on function public.admin_reserves(text) from public;
grant execute on function public.admin_reserves(text) to authenticated;

create or replace function public.admin_reserve_detail(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare ok boolean := true; prev text := null; r record;
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    -- Vérification de l'enchaînement des empreintes
    for r in select * from public.courier_reserve_ledger where courier_id = target order by id loop
        if r.prev_hash is distinct from prev or r.hash <> md5(coalesce(r.prev_hash, '') || '|' || r.courier_id || '|' || r.kind || '|' || r.amount
                    || '|' || coalesce(r.order_id::text, '') || '|' || coalesce(r.incident_id::text, '')
                    || '|' || coalesce(r.available_at::text, '') || '|' || coalesce(r.note, '')
                    || '|' || r.simulation || '|' || r.created_at) then
            ok := false;
        end if;
        prev := r.hash;
    end loop;
    return public.reserve_figures(target) || jsonb_build_object(
        'courier', (select jsonb_build_object('id', p.id, 'name', to_jsonb(p) ->> 'full_name', 'phone', to_jsonb(p) ->> 'phone')
                      from public.profiles p where p.id = target),
        'chain_ok', ok,
        'entries', coalesce((select jsonb_agg(to_jsonb(x) - 'prev_hash' order by x.id desc)
                               from public.courier_reserve_ledger x where x.courier_id = target), '[]'::jsonb),
        'incidents', coalesce((select jsonb_agg(to_jsonb(i) order by i.opened_at desc)
                                 from public.courier_reserve_incidents i where i.courier_id = target), '[]'::jsonb),
        'recent_orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'order_number', o.order_number, 'status', o.status,
                                        'delivery_fees', o.delivery_fees, 'total', o.total, 'updated_at', o.updated_at) order by o.updated_at desc)
                                     from (select * from public.orders where deliverer_id = target order by updated_at desc limit 30) o), '[]'::jsonb)
    );
end;
$$;
revoke all on function public.admin_reserve_detail(uuid) from public;
grant execute on function public.admin_reserve_detail(uuid) to authenticated;

-- Ouvrir une réclamation : preuves obligatoires, le livreur est prévenu et a 72 heures pour contester
create or replace function public.admin_reserve_claim(target uuid, order_ref uuid, claim_kind text, claim_amount numeric,
                                                      claim_description text, claim_evidence text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_id uuid; descr text := nullif(btrim(coalesce(claim_description, '')), ''); ev text := nullif(btrim(coalesce(claim_evidence, '')), '');
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    if claim_kind not in ('loss', 'theft', 'fraud', 'damage') then raise exception 'Type de réclamation inconnu'; end if;
    if claim_amount is null or claim_amount <= 0 then raise exception 'Indique le montant réclamé'; end if;
    if descr is null or length(descr) < 20 then raise exception 'Décris ce qui s''est passé (au moins une phrase)'; end if;
    if ev is null or length(ev) < 10 then raise exception 'Les preuves sont obligatoires (code de remise, positions, photos, témoignages…)'; end if;
    if order_ref is not null and not exists (select 1 from public.orders where id = order_ref and deliverer_id = target) then
        raise exception 'Cette commande n''a pas été livrée par ce livreur';
    end if;
    insert into public.courier_reserve_incidents (courier_id, order_id, kind, amount, description, evidence, opened_by)
    values (target, order_ref, claim_kind, round(claim_amount), left(descr, 2000), left(ev, 4000), auth.uid())
    returning id into new_id;
    perform public.notify_user(target, 'reserve_claim', 'Réserve : une réclamation te concerne',
        'Montant : ' || public.fcfa(round(claim_amount)) || '. Tu as 72 heures pour la contester depuis ton espace livreur. '
        || 'Rien n''est déduit avant la décision.');
    return new_id;
end;
$$;
revoke all on function public.admin_reserve_claim(uuid, uuid, text, numeric, text, text) from public;
grant execute on function public.admin_reserve_claim(uuid, uuid, text, numeric, text, text) to authenticated;

-- Trancher : retenue (seulement après le délai de contestation, ou après lecture de la contestation)
create or replace function public.admin_reserve_decide(target uuid, decision text, note text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare i public.courier_reserve_incidents; fig jsonb; take numeric; why text := nullif(btrim(coalesce(note, '')), '');
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    select * into i from public.courier_reserve_incidents where id = target for update;
    if i.id is null then raise exception 'Réclamation introuvable'; end if;
    if i.status not in ('open', 'contested') then raise exception 'Cette réclamation est déjà tranchée'; end if;
    if why is null or length(why) < 10 then raise exception 'Explique ta décision (elle est envoyée au livreur)'; end if;
    if decision = 'upheld' then
        if i.status = 'open' and now() < i.contest_deadline then
            raise exception 'Le livreur a jusqu''au % pour contester : attends la fin du délai',
                to_char(i.contest_deadline at time zone 'Africa/Brazzaville', 'DD/MM à HH24"h"MI');
        end if;
        fig := public.reserve_figures(i.courier_id);
        -- Jamais plus que la réserve de CE livreur : le reste ne vient d'aucun autre livreur
        take := least(i.amount, (fig->>'balance')::numeric);
        if take > 0 then
            insert into public.courier_reserve_ledger (courier_id, kind, amount, incident_id, order_id, note, simulation, created_by)
            values (i.courier_id, 'debit', -take, i.id, i.order_id, 'Retenue après réclamation : ' || left(why, 200),
                    (fig->>'mode') <> 'real', auth.uid());
        end if;
        update public.courier_reserve_incidents set status = 'upheld', decided_by = auth.uid(), decided_at = now(),
               decision_note = left(why, 2000), debited = take where id = i.id;
        perform public.notify_user(i.courier_id, 'reserve_decision', 'Réserve : réclamation retenue',
            'Retenue de ' || public.fcfa(take) || ' sur ta réserve. Motif : ' || left(why, 200));
    elsif decision = 'rejected' then
        update public.courier_reserve_incidents set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
               decision_note = left(why, 2000) where id = i.id;
        perform public.notify_user(i.courier_id, 'reserve_decision', 'Réserve : réclamation écartée',
            'Rien n''est retenu sur ta réserve. ' || left(why, 200));
    else
        raise exception 'Décision inconnue';
    end if;
    return decision;
end;
$$;
revoke all on function public.admin_reserve_decide(uuid, text, text) from public;
grant execute on function public.admin_reserve_decide(uuid, text, text) to authenticated;

-- Annuler une retenue (erreur reconnue) : mouvement inverse
create or replace function public.admin_reserve_reverse(target uuid, note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare i public.courier_reserve_incidents; why text := nullif(btrim(coalesce(note, '')), '');
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    select * into i from public.courier_reserve_incidents where id = target for update;
    if i.id is null or i.status <> 'upheld' then raise exception 'Seule une réclamation retenue peut être annulée'; end if;
    if why is null or length(why) < 10 then raise exception 'Explique pourquoi la retenue est annulée'; end if;
    if i.debited > 0 then
        insert into public.courier_reserve_ledger (courier_id, kind, amount, incident_id, order_id, note, simulation, created_by)
        values (i.courier_id, 'debit_reversal', i.debited, i.id, i.order_id, 'Retenue annulée : ' || left(why, 200),
                coalesce((select value #>> '{}' from public.app_settings where key = 'reserve_mode'), 'simulation') <> 'real', auth.uid());
    end if;
    update public.courier_reserve_incidents set status = 'cancelled', decision_note = coalesce(decision_note, '') || ' | Annulée : ' || left(why, 500) where id = i.id;
    perform public.notify_user(i.courier_id, 'reserve_decision', 'Réserve : retenue annulée',
        public.fcfa(i.debited) || ' remis sur ta réserve. ' || left(why, 200));
end;
$$;
revoke all on function public.admin_reserve_reverse(uuid, text) from public;
grant execute on function public.admin_reserve_reverse(uuid, text) to authenticated;

-- Le livreur quitte Ouenze : tout le solde non contesté lui est versé
create or replace function public.admin_reserve_close(target uuid, note text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare fig jsonb; pay numeric;
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    fig := public.reserve_figures(target);
    if (fig->>'closed')::boolean then raise exception 'Cette réserve est déjà clôturée'; end if;
    if (fig->>'claimed')::numeric > 0 then
        raise exception 'Une réclamation est en cours (% FCFA) : tranche-la avant de clôturer', fig->>'claimed';
    end if;
    pay := (fig->>'balance')::numeric;
    insert into public.courier_reserve_ledger (courier_id, kind, amount, note, simulation, created_by)
    values (target, 'closure', -pay,
            'Clôture : solde versé au livreur. ' || coalesce(nullif(btrim(note), ''), ''), (fig->>'mode') <> 'real', auth.uid());
    perform public.notify_user(target, 'reserve_release', 'Réserve clôturée',
        'Tout ton solde (' || public.fcfa(pay) || ') t''est versé.' || case when (fig->>'mode') <> 'real' then ' (Simulation.)' else '' end);
    return pay;
end;
$$;
revoke all on function public.admin_reserve_close(uuid, text) from public;
grant execute on function public.admin_reserve_close(uuid, text) to authenticated;

-- Réglages (le mode réel ne s'active PAS ici)
create or replace function public.admin_reserve_settings(cap numeric, hold_days integer, rate_percent numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then raise exception 'Réservé aux administrateurs' using errcode = '42501'; end if;
    if cap is null or cap < 0 or cap > 1000000 then raise exception 'Plafond invalide'; end if;
    if hold_days is null or hold_days < 30 or hold_days > 60 then raise exception 'Le délai de blocage doit être entre 30 et 60 jours'; end if;
    if rate_percent is null or rate_percent < 0 or rate_percent > 10 then raise exception 'Le taux doit être entre 0 et 10 %%'; end if;
    insert into public.app_settings (key, value, updated_at) values ('reserve_cap', to_jsonb(round(cap)), now())
        on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into public.app_settings (key, value, updated_at) values ('reserve_hold_days', to_jsonb(hold_days), now())
        on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into public.app_settings (key, value, updated_at) values ('reserve_rate', to_jsonb(round(rate_percent / 100, 4)), now())
        on conflict (key) do update set value = excluded.value, updated_at = now();
    return jsonb_build_object('cap', public.reserve_setting('reserve_cap', 30000), 'hold_days', public.reserve_setting('reserve_hold_days', 45),
                              'rate', public.reserve_setting('reserve_rate', 0.10));
end;
$$;
revoke all on function public.admin_reserve_settings(numeric, integer, numeric) from public;
grant execute on function public.admin_reserve_settings(numeric, integer, numeric) to authenticated;

-- Réglages actuels (page admin)
create or replace function public.admin_reserve_settings_get()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select case when public.is_admin() then jsonb_build_object(
        'cap', public.reserve_setting('reserve_cap', 30000), 'hold_days', public.reserve_setting('reserve_hold_days', 45),
        'rate', public.reserve_setting('reserve_rate', 0.10),
        'mode', coalesce((select value #>> '{}' from public.app_settings where key = 'reserve_mode'), 'simulation'))
    end;
$$;
grant execute on function public.admin_reserve_settings_get() to authenticated;

-- Nombre de réclamations à trancher (tableau de bord admin)
create or replace function public.admin_reserve_todo()
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select case when public.is_admin() then
        (select count(*)::integer from public.courier_reserve_incidents
          where status = 'contested' or (status = 'open' and contest_deadline <= now()))
    else 0 end;
$$;
grant execute on function public.admin_reserve_todo() to authenticated;

-- ---------- Restitutions : tous les jours (pg_cron si disponible), et à l'ouverture du tableau de bord ----------
do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        begin
            perform cron.unschedule(jobid) from cron.job where jobname = 'ouenze-reserve-release';
            perform cron.schedule('ouenze-reserve-release', '23 3 * * *', 'select public.reserve_release_due()');
        exception when others then
            raise notice 'Planification impossible (%)', sqlerrm;
        end;
    end if;
end $$;

notify pgrst, 'reload schema';
