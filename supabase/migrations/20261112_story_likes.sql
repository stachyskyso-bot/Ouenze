-- ============================================================
-- 20261112 — J'aime sur les stories
--
-- Un client connecté peut aimer une story (cœur, ou double-toucher sur la story).
-- Le vendeur voit le nombre de « J'aime » de ses stories, jamais qui a aimé.
-- Prérequis : 20261111_stories.sql. Relançable sans danger.
-- ============================================================

create table if not exists public.story_likes (
    story_id uuid not null references public.stories(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (story_id, user_id)
);
alter table public.story_likes enable row level security;   -- accès par les fonctions ci-dessous

-- Aimer / ne plus aimer ; renvoie l'état après le changement
create or replace function public.toggle_story_like(target uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
    uid uuid := auth.uid();
begin
    if uid is null then raise exception 'Connecte-toi pour aimer une story' using errcode = '42501'; end if;
    if not exists (select 1 from public.stories st
                    where st.id = target and st.removed_at is null and st.expires_at > now()) then
        raise exception 'Cette story n''est plus en ligne';
    end if;
    delete from public.story_likes where story_id = target and user_id = uid;
    if found then return false; end if;
    insert into public.story_likes (story_id, user_id) values (target, uid);
    return true;
end;
$$;
revoke all on function public.toggle_story_like(uuid) from public, anon;
grant execute on function public.toggle_story_like(uuid) to authenticated;

-- Stories que j'ai aimées parmi celles affichées
create or replace function public.my_story_likes(ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
    select l.story_id from public.story_likes l
     where l.user_id = auth.uid() and l.story_id = any((coalesce(ids, '{}'::uuid[]))[1:400]);
$$;
revoke all on function public.my_story_likes(uuid[]) from public, anon;
grant execute on function public.my_story_likes(uuid[]) to authenticated;

-- Nombre de J'aime : seulement pour mes stories (vendeur) ou pour l'équipe Ouenze
create or replace function public.story_like_counts(ids uuid[])
returns table (story_id uuid, likes bigint)
language sql
stable
security definer
set search_path = public
as $$
    select st.id, (select count(*) from public.story_likes l where l.story_id = st.id)
      from public.stories st
      left join public.shops s on s.id = st.shop_id
     where st.id = any((coalesce(ids, '{}'::uuid[]))[1:400])
       and (s.owner_id = auth.uid() or st.created_by = auth.uid() or public.story_is_team());
$$;
revoke all on function public.story_like_counts(uuid[]) from public, anon;
grant execute on function public.story_like_counts(uuid[]) to authenticated;

notify pgrst, 'reload schema';
