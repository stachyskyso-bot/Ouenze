-- ============================================================
-- 20261111 — Stories (façon WhatsApp)
--
-- Les vendeurs publient des statuts pour leur boutique, l'équipe Ouenze publie les statuts
-- « Ouenze ». Un statut est une photo, une courte vidéo ou un texte sur fond de couleur,
-- éventuellement lié à un produit. Il disparaît au bout de 24 heures.
-- Public : « tout le monde » ou « mes fidèles » (clients qui ont mis la boutique en favori
-- ou y ont déjà commandé).
--
-- Fichiers : bucket public « stories », chaque compte écrit dans son dossier <user_id>/.
-- Limites : 10 statuts actifs et 20 par jour par boutique.
-- Relançable sans danger.
-- ============================================================

create table if not exists public.stories (
    id uuid primary key default gen_random_uuid(),
    author_kind text not null check (author_kind in ('shop', 'ouenze')),
    shop_id uuid references public.shops(id) on delete cascade,
    created_by uuid references auth.users(id) on delete set null,
    media_type text not null check (media_type in ('image', 'video', 'text')),
    media_url text,
    media_path text,                      -- chemin dans le bucket (pour effacer le fichier)
    caption text check (caption is null or char_length(caption) <= 250),
    bg_color text check (bg_color is null or bg_color ~ '^#[0-9a-fA-F]{6}$'),
    product_id uuid references public.products(id) on delete set null,
    audience text not null default 'all' check (audience in ('all', 'fans')),
    duration_ms integer check (duration_ms is null or duration_ms between 1000 and 31000),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default now() + interval '24 hours',
    removed_at timestamptz,
    removed_by uuid,
    removed_reason text,
    file_cleaned boolean not null default false,
    check ((author_kind = 'shop') = (shop_id is not null))
);
create index if not exists stories_active_idx on public.stories (expires_at desc) where removed_at is null;
create index if not exists stories_shop_idx on public.stories (shop_id, created_at desc);
alter table public.stories enable row level security;   -- tout passe par les fonctions ci-dessous

create table if not exists public.story_views (
    story_id uuid not null references public.stories(id) on delete cascade,
    viewer_id uuid not null references auth.users(id) on delete cascade,
    viewed_at timestamptz not null default now(),
    primary key (story_id, viewer_id)
);
alter table public.story_views enable row level security;

-- ---------- Bucket de fichiers (si Supabase Storage est présent) ----------
do $$
begin
    if to_regclass('storage.buckets') is null then
        raise notice 'Storage absent : bucket stories non créé';
        return;
    end if;
    insert into storage.buckets (id, name, public) values ('stories', 'stories', true)
        on conflict (id) do update set public = true;
    begin
        update storage.buckets set file_size_limit = 15728640,
            allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
         where id = 'stories';
    exception when others then null;   -- anciennes versions sans ces colonnes
    end;
    drop policy if exists "stories_insert_own" on storage.objects;
    create policy "stories_insert_own" on storage.objects for insert to authenticated
        with check (bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text);
    drop policy if exists "stories_delete_own" on storage.objects;
    create policy "stories_delete_own" on storage.objects for delete to authenticated
        using (bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text);
    drop policy if exists "stories_read" on storage.objects;
    create policy "stories_read" on storage.objects for select
        using (bucket_id = 'stories');
exception when others then
    raise notice 'Bucket stories : % (à créer à la main dans Storage si besoin)', sqlerrm;
end $$;

-- ---------- Outils ----------
-- Boutique visible du public
create or replace function public.story_shop_open(s public.shops)
returns boolean
language sql
stable
as $$
    select coalesce(s.is_active, true) and s.archived_at is null
       and (to_jsonb(s) ->> 'suspended_at') is null
       and (to_jsonb(s) ->> 'deletion_due_at') is null
       and (to_jsonb(s) ->> 'purged_at') is null;
$$;

create or replace function public.story_is_team()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if public.is_admin() then return true; end if;
    begin
        return coalesce(public.my_team_role() in ('admin', 'agent'), false);
    exception when undefined_function then
        return false;
    end;
end;
$$;

-- Médias acceptés : fichier https (bucket) ou petite image intégrée
create or replace function public.story_media_ok(kind text, url text)
returns boolean
language sql
immutable
as $$
    select case kind
        when 'text' then url is null
        when 'video' then url ~ '^https://' and char_length(url) <= 1000
        when 'image' then (url ~ '^https://' and char_length(url) <= 1000)
                       or (url ~ '^data:image/(jpeg|png|webp);base64,' and char_length(url) <= 700000)
        else false end;
$$;

-- ---------- Fil des statuts (accueil) ----------
drop function if exists public.story_feed(text);
create or replace function public.story_feed(city text default null)
returns table (
    id uuid, author_kind text, shop_id uuid, shop_name text, shop_logo text, shop_city text, shop_verified boolean,
    media_type text, media_url text, caption text, bg_color text, duration_ms integer,
    product_id uuid, product_name text, product_price numeric,
    audience text, created_at timestamptz, expires_at timestamptz, viewed boolean
)
language sql
stable
security definer
set search_path = public
as $$
    select st.id, st.author_kind, st.shop_id,
           case when st.author_kind = 'ouenze' then 'Ouenze' else s.name end,
           case when st.author_kind = 'shop' and s.logo_url !~ '^data:' then s.logo_url end,
           s.city, coalesce(s.is_verified, false) or st.author_kind = 'ouenze',
           st.media_type, st.media_url, st.caption, st.bg_color, st.duration_ms,
           case when p.id is not null and coalesce(p.is_active, true) then p.id end,
           case when p.id is not null and coalesce(p.is_active, true) then p.name end,
           case when p.id is not null and coalesce(p.is_active, true) then p.price end,
           st.audience, st.created_at, st.expires_at,
           (auth.uid() is not null and exists (select 1 from public.story_views v
                                                where v.story_id = st.id and v.viewer_id = auth.uid()))
      from public.stories st
      left join public.shops s on s.id = st.shop_id
      left join public.products p on p.id = st.product_id
     where st.removed_at is null
       and st.expires_at > now()
       and (st.author_kind = 'ouenze' or public.story_shop_open(s))
       and (st.audience = 'all'
            or (auth.uid() is not null and (
                s.owner_id = auth.uid()
                or exists (select 1 from public.favorites f
                            where f.user_id = auth.uid() and f.kind = 'shop' and f.target_id = st.shop_id)
                or exists (select 1 from public.orders o join public.order_items oi on oi.order_id = o.id
                            where o.client_id = auth.uid() and oi.shop_id = st.shop_id))))
     order by st.created_at
     limit 400;
$$;
grant execute on function public.story_feed(text) to anon, authenticated;

-- Boutiques qui ont des statuts en ce moment (anneau sur le logo de la boutique)
create or replace function public.shops_with_stories(ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
    select distinct st.shop_id from public.stories st
     where st.shop_id = any((coalesce(ids, '{}'::uuid[]))[1:100])
       and st.removed_at is null and st.expires_at > now() and st.audience = 'all';
$$;
grant execute on function public.shops_with_stories(uuid[]) to anon, authenticated;

-- Statut vu (clients connectés ; les visiteurs gardent la trace dans leur navigateur)
create or replace function public.mark_stories_viewed(ids uuid[])
returns void
language sql
volatile
security definer
set search_path = public
as $$
    insert into public.story_views (story_id, viewer_id)
    select st.id, auth.uid() from public.stories st
     where auth.uid() is not null and st.id = any((coalesce(ids, '{}'::uuid[]))[1:50])
       and st.removed_at is null and st.expires_at > now()
    on conflict do nothing;
$$;
revoke all on function public.mark_stories_viewed(uuid[]) from public, anon;
grant execute on function public.mark_stories_viewed(uuid[]) to authenticated;

-- ---------- Publication ----------
create or replace function public.post_story(
    target_shop uuid, kind text, url text default null, path text default null,
    caption text default null, bg text default null, product uuid default null,
    aud text default 'all', duration integer default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
    s public.shops;
    uid uuid := auth.uid();
    new_id uuid;
    author text := 'shop';
begin
    if uid is null then raise exception 'Connecte-toi pour publier une story' using errcode = '42501'; end if;
    if target_shop is null then
        if not public.is_admin() then raise exception 'Seule l''équipe Ouenze publie les stories Ouenze' using errcode = '42501'; end if;
        author := 'ouenze';
    else
        select * into s from public.shops where id = target_shop;
        if not found or s.owner_id is distinct from uid then
            raise exception 'Cette boutique ne t''appartient pas' using errcode = '42501';
        end if;
        if not public.story_shop_open(s) then
            raise exception 'Ta boutique n''est pas active : story impossible pour le moment';
        end if;
        if (select count(*) from public.stories where shop_id = target_shop and removed_at is null and expires_at > now()) >= 10 then
            raise exception 'Tu as déjà 10 stories en ligne : attends qu''une story expire ou supprimes-en une';
        end if;
        if (select count(*) from public.stories where shop_id = target_shop and created_at > now() - interval '24 hours') >= 20 then
            raise exception 'Limite de 20 stories par jour atteinte pour cette boutique';
        end if;
    end if;

    kind := lower(coalesce(kind, ''));
    caption := nullif(btrim(coalesce(caption, '')), '');
    if not public.story_media_ok(kind, url) then raise exception 'Fichier de la story invalide'; end if;
    if kind = 'text' and caption is null then raise exception 'Écris le texte de la story'; end if;
    if char_length(coalesce(caption, '')) > 250 then raise exception 'Texte trop long (250 caractères au plus)'; end if;
    if bg is not null and bg !~ '^#[0-9a-fA-F]{6}$' then bg := null; end if;
    if path is not null and (split_part(path, '/', 1) <> uid::text or char_length(path) > 300) then
        raise exception 'Chemin de fichier invalide';
    end if;
    if coalesce(aud, 'all') not in ('all', 'fans') then aud := 'all'; end if;
    if author = 'ouenze' then aud := 'all'; end if;
    if product is not null and not exists (
        select 1 from public.products p
         where p.id = product and coalesce(p.is_active, true)
           and (author = 'ouenze' or p.shop_id = target_shop)) then
        raise exception 'Produit introuvable dans cette boutique';
    end if;

    insert into public.stories (author_kind, shop_id, created_by, media_type, media_url, media_path,
                                caption, bg_color, product_id, audience, duration_ms)
    values (author, target_shop, uid, kind, url, path, caption,
            case when kind = 'text' then coalesce(bg, '#1e40af') else bg end,
            product, coalesce(aud, 'all'),
            case when kind = 'video' and duration between 1000 and 31000 then duration end)
    returning id into new_id;
    return new_id;
end;
$$;
revoke all on function public.post_story(uuid, text, text, text, text, text, uuid, text, integer) from public, anon;
grant execute on function public.post_story(uuid, text, text, text, text, text, uuid, text, integer) to authenticated;

-- Supprimer un de mes statuts (renvoie le chemin du fichier à effacer)
create or replace function public.delete_my_story(target uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
    st public.stories;
begin
    select * into st from public.stories where id = target;
    if not found then raise exception 'Story introuvable'; end if;
    if not (st.created_by = auth.uid()
            or (st.shop_id is not null and exists (select 1 from public.shops where id = st.shop_id and owner_id = auth.uid()))
            or (st.author_kind = 'ouenze' and public.is_admin())) then
        raise exception 'Cette story ne t''appartient pas' using errcode = '42501';
    end if;
    update public.stories set removed_at = coalesce(removed_at, now()), removed_by = auth.uid(),
                              removed_reason = coalesce(removed_reason, 'supprimé par l''auteur')
     where id = target;
    return case when st.created_by = auth.uid() then st.media_path end;
end;
$$;
revoke all on function public.delete_my_story(uuid) from public, anon;
grant execute on function public.delete_my_story(uuid) to authenticated;

-- Mes statuts (vendeur) : en ligne et des 7 derniers jours, avec le nombre de vues
create or replace function public.my_stories()
returns table (
    id uuid, shop_id uuid, shop_name text, media_type text, media_url text, caption text, bg_color text,
    product_id uuid, product_name text, audience text, created_at timestamptz, expires_at timestamptz,
    removed_at timestamptz, removed_reason text, views bigint, active boolean
)
language sql
stable
security definer
set search_path = public
as $$
    select st.id, st.shop_id, s.name, st.media_type, st.media_url, st.caption, st.bg_color,
           st.product_id, p.name, st.audience, st.created_at, st.expires_at, st.removed_at,
           case when st.removed_by is distinct from st.created_by then st.removed_reason end,
           (select count(*) from public.story_views v where v.story_id = st.id),
           st.removed_at is null and st.expires_at > now()
      from public.stories st
      join public.shops s on s.id = st.shop_id
      left join public.products p on p.id = st.product_id
     where s.owner_id = auth.uid() and st.created_at > now() - interval '7 days'
     order by st.created_at desc
     limit 100;
$$;
revoke all on function public.my_stories() from public, anon;
grant execute on function public.my_stories() to authenticated;

-- Fichiers de mes anciens statuts à effacer (expirés ou supprimés) ; l'appli les efface puis confirme
create or replace function public.my_story_files_to_clean()
returns table (id uuid, media_path text)
language sql
stable
security definer
set search_path = public
as $$
    select st.id, st.media_path from public.stories st
     where st.created_by = auth.uid() and st.media_path is not null and not st.file_cleaned
       and (st.removed_at is not null or st.expires_at < now())
     limit 50;
$$;
revoke all on function public.my_story_files_to_clean() from public, anon;
grant execute on function public.my_story_files_to_clean() to authenticated;

create or replace function public.story_files_cleaned(ids uuid[])
returns void
language sql
volatile
security definer
set search_path = public
as $$
    update public.stories set file_cleaned = true
     where created_by = auth.uid() and id = any((coalesce(ids, '{}'::uuid[]))[1:50])
       and (removed_at is not null or expires_at < now());
$$;
revoke all on function public.story_files_cleaned(uuid[]) from public, anon;
grant execute on function public.story_files_cleaned(uuid[]) to authenticated;

-- ---------- Équipe : statuts Ouenze et modération ----------
create or replace function public.admin_stories(only_active boolean default true)
returns table (
    id uuid, author_kind text, shop_id uuid, shop_name text, media_type text, media_url text,
    caption text, bg_color text, product_name text, audience text, created_at timestamptz,
    expires_at timestamptz, removed_at timestamptz, removed_reason text, views bigint, active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not public.story_is_team() then raise exception 'Réservé à l''équipe Ouenze' using errcode = '42501'; end if;
    return query
    select st.id, st.author_kind, st.shop_id,
           case when st.author_kind = 'ouenze' then 'Ouenze'::text else s.name end,
           st.media_type, st.media_url, st.caption, st.bg_color, p.name, st.audience, st.created_at,
           st.expires_at, st.removed_at, st.removed_reason,
           (select count(*) from public.story_views v where v.story_id = st.id),
           st.removed_at is null and st.expires_at > now()
      from public.stories st
      left join public.shops s on s.id = st.shop_id
      left join public.products p on p.id = st.product_id
     where (not only_active and st.created_at > now() - interval '7 days')
        or (st.removed_at is null and st.expires_at > now())
     order by st.created_at desc
     limit 300;
end;
$$;
revoke all on function public.admin_stories(boolean) from public, anon;
grant execute on function public.admin_stories(boolean) to authenticated;

create or replace function public.admin_remove_story(target uuid, reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
    if not public.story_is_team() then raise exception 'Réservé à l''équipe Ouenze' using errcode = '42501'; end if;
    reason := nullif(btrim(coalesce(reason, '')), '');
    if reason is null then raise exception 'Indique la raison du retrait'; end if;
    update public.stories set removed_at = now(), removed_by = auth.uid(), removed_reason = left(reason, 300)
     where id = target and removed_at is null;
    if not found then raise exception 'Story introuvable ou déjà retirée'; end if;
end;
$$;
revoke all on function public.admin_remove_story(uuid, text) from public, anon;
grant execute on function public.admin_remove_story(uuid, text) to authenticated;

notify pgrst, 'reload schema';
