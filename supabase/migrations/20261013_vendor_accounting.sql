-- ============================================================
-- Comptabilité vendeur (plan SYSCOHADA simplifié)
-- À exécuter une fois dans Supabase → SQL Editor. Sans danger si relancé.
--
-- • Les ventes Ouenze (commandes livrées) sont lues par vendor_sales() : rien à saisir.
-- • Tout le reste (achats, loyer, transport, ventes en boutique, versements reçus…)
--   est saisi par le vendeur dans vendor_entries. La page comptabilité génère la
--   double écriture (débit / crédit) à partir du type d'opération.
-- ============================================================

create table if not exists public.vendor_entries (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    shop_id uuid references public.shops (id) on delete set null,
    entry_date date not null default current_date,
    kind text not null check (kind in (
        'sale_store',      -- vente hors Ouenze (boutique physique, téléphone…)
        'purchase',        -- achat de marchandises à revendre
        'supplies',        -- fournitures, emballages
        'transport',       -- transport, carburant
        'rent',            -- loyer
        'ads',             -- publicité
        'telecom',         -- téléphone, internet
        'fees',            -- frais bancaires / Mobile Money
        'taxes',           -- impôts et taxes
        'salaries',        -- salaires
        'other_expense',   -- autres charges
        'payout',          -- versement reçu d'Ouenze pour les ventes
        'contribution',    -- apport personnel
        'withdrawal'       -- retrait personnel
    )),
    amount numeric(14, 0) not null check (amount > 0 and amount <= 1000000000000),
    pay_account text not null default '521' check (pay_account in ('521', '571')),  -- 521 Banque / Mobile Money, 571 Caisse
    label text check (char_length(label) <= 200),
    created_at timestamptz not null default now()
);

create index if not exists vendor_entries_owner_date on public.vendor_entries (owner_id, entry_date);

alter table public.vendor_entries enable row level security;

drop policy if exists "écritures: le vendeur lit les siennes" on public.vendor_entries;
create policy "écritures: le vendeur lit les siennes" on public.vendor_entries
    for select to authenticated using (owner_id = auth.uid());

drop policy if exists "écritures: le vendeur ajoute les siennes" on public.vendor_entries;
create policy "écritures: le vendeur ajoute les siennes" on public.vendor_entries
    for insert to authenticated
    with check (
        owner_id = auth.uid()
        and (shop_id is null or exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid()))
    );

drop policy if exists "écritures: le vendeur supprime les siennes" on public.vendor_entries;
create policy "écritures: le vendeur supprime les siennes" on public.vendor_entries
    for delete to authenticated using (owner_id = auth.uid());

-- ---------- Ventes Ouenze livrées des boutiques du vendeur connecté ----------
-- security definer : le vendeur ne lit que les lignes de SES boutiques, sans
-- avoir accès aux autres informations des commandes (adresse, téléphone du client).
create or replace function public.vendor_sales(from_date date default null, to_date date default null)
returns table (
    order_id uuid,
    sold_at timestamptz,
    shop_id uuid,
    product_name text,
    quantity integer,
    unit_price numeric,
    payment_method text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        return;
    end if;
    -- Requête dynamique : si la table des commandes change, la page affiche « 0 vente »
    -- au lieu de casser (même principe que close_shop).
    begin
        return query execute $q$
            select oi.order_id::uuid, o.created_at::timestamptz, oi.shop_id::uuid, oi.product_name::text,
                   oi.quantity::integer, oi.unit_price::numeric, o.payment_method::text
              from public.order_items oi
              join public.orders o on o.id = oi.order_id
              join public.shops s on s.id = oi.shop_id
             where s.owner_id = $1
               and o.status = 'delivered'
               and ($2 is null or o.created_at::date >= $2)
               and ($3 is null or o.created_at::date <= $3)
             order by o.created_at
        $q$ using auth.uid(), from_date, to_date;
    exception when undefined_table or undefined_column or invalid_text_representation or datatype_mismatch then
        return;
    end;
end;
$$;
revoke all on function public.vendor_sales(date, date) from public;
grant execute on function public.vendor_sales(date, date) to authenticated;

notify pgrst, 'reload schema';
