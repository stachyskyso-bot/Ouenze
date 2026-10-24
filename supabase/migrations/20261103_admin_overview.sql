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
