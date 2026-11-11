-- WorkerIN core schema for Supabase Auth, PostgreSQL, Storage, chat and Pro subscriptions.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  profile_type text not null check (profile_type in ('freelancer', 'company')),
  name text not null check (length(name) between 1 and 100),
  gender text check (gender in ('Mulheres', 'Homens', 'Outro', 'Prefiro não informar')),
  age smallint check (age between 18 and 100),
  role text not null check (length(role) <= 120),
  area text not null check (length(area) <= 80),
  city text not null check (length(city) <= 120),
  lat double precision,
  lon double precision,
  rate numeric(10,2) not null default 0 check (rate >= 0),
  work_modes text[] not null default '{}',
  skills text[] not null default '{}',
  bio text not null default '' check (length(bio) <= 1200),
  photos text[] not null default '{}',
  intro_media jsonb,
  available boolean not null default true,
  verified boolean not null default false,
  portfolio text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (profile_type = 'company' or age is not null)
);
create index if not exists profiles_discovery_idx on public.profiles (profile_type, area, rate, available);

create table if not exists public.interests (
  id uuid primary key default gen_random_uuid(),
  from_profile_id uuid not null references public.profiles(id) on delete cascade,
  to_profile_id uuid not null references public.profiles(id) on delete cascade,
  decision text not null check (decision in ('like', 'pass')),
  created_at timestamptz not null default now(),
  unique (from_profile_id, to_profile_id),
  check (from_profile_id <> to_profile_id)
);
create index if not exists interests_incoming_idx on public.interests (to_profile_id, decision, created_at desc);
create index if not exists interests_sender_idx on public.interests (from_profile_id, created_at desc);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  pair_key text not null unique,
  participant_a uuid not null references public.profiles(id) on delete cascade,
  participant_b uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'match' check (type in ('match', 'direct')),
  created_by uuid references public.profiles(id) on delete set null,
  last_message text not null default '',
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  check (participant_a <> participant_b)
);
create index if not exists conversations_participant_a_idx on public.conversations (participant_a, last_message_at desc);
create index if not exists conversations_participant_b_idx on public.conversations (participant_b, last_message_at desc);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  pair_key text not null unique,
  profile_a uuid not null references public.profiles(id) on delete cascade,
  profile_b uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (profile_a <> profile_b)
);
create index if not exists matches_profile_a_idx on public.matches (profile_a, created_at desc);
create index if not exists matches_profile_b_idx on public.matches (profile_b, created_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_profile_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (length(content) between 1 and 4000),
  sent_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, sent_at desc);
create index if not exists messages_sender_idx on public.messages (sender_profile_id, sent_at desc);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  description text not null check (length(description) <= 3000),
  area text not null,
  skills text[] not null default '{}',
  rate numeric(10,2) not null default 0 check (rate >= 0),
  work_modes text[] not null default '{}',
  city text not null default '',
  status text not null default 'open' check (status in ('open', 'paused', 'closed')),
  created_at timestamptz not null default now()
);
create index if not exists projects_open_idx on public.projects (status, area, created_at desc);
create index if not exists projects_company_idx on public.projects (company_id, created_at desc);

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  viewer_profile_id uuid not null references public.profiles(id) on delete cascade,
  target_profile_id uuid not null references public.profiles(id) on delete cascade,
  visited_at timestamptz not null default now(),
  check (viewer_profile_id <> target_profile_id)
);
create index if not exists visits_target_idx on public.visits (target_profile_id, visited_at desc);
create index if not exists visits_viewer_idx on public.visits (viewer_profile_id, visited_at desc);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider = 'mercadopago'),
  external_id text not null unique,
  status text not null default 'pending',
  price_brl numeric(10,2) not null default 7 check (price_brl = 7),
  checkout_url text,
  current_period_end timestamptz,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_profile_idx on public.subscriptions (profile_id, updated_at desc);

create table if not exists public.lives (
  id uuid primary key default gen_random_uuid(),
  host_profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(title) between 3 and 120),
  area text not null default 'Tecnologia',
  status text not null default 'live' check (status in ('live', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists lives_status_idx on public.lives (status, started_at desc);
create index if not exists lives_host_idx on public.lives (host_profile_id, status);

-- RLS stays enabled even though the Node API uses a server-only secret key.
-- Browser access follows each person's identity; the secret key never belongs in app.js.
alter table public.profiles enable row level security;
alter table public.interests enable row level security;
alter table public.conversations enable row level security;
alter table public.matches enable row level security;
alter table public.messages enable row level security;
alter table public.projects enable row level security;
alter table public.visits enable row level security;
alter table public.subscriptions enable row level security;
alter table public.lives enable row level security;

-- Public profile reads go through the API, which omits private coordinates and
-- applies distance filters. Do not expose exact coordinates through PostgREST.
drop policy if exists "Profiles are discoverable" on public.profiles;
drop policy if exists "Owners read their profile" on public.profiles;
create policy "Owners read their profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists "Owners update their profile" on public.profiles;
create policy "Owners update their profile" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
drop policy if exists "Owners insert their profile" on public.profiles;
create policy "Owners insert their profile" on public.profiles for insert to authenticated with check (id = (select auth.uid()));

drop policy if exists "Participants see interests" on public.interests;
create policy "Participants see interests" on public.interests for select to authenticated using (from_profile_id = (select auth.uid()) or to_profile_id = (select auth.uid()));
drop policy if exists "Profiles send their own interests" on public.interests;
create policy "Profiles send their own interests" on public.interests for insert to authenticated with check (from_profile_id = (select auth.uid()));
drop policy if exists "Profiles update their own interests" on public.interests;
create policy "Profiles update their own interests" on public.interests for update to authenticated using (from_profile_id = (select auth.uid())) with check (from_profile_id = (select auth.uid()));

drop policy if exists "Conversation participants read conversations" on public.conversations;
create policy "Conversation participants read conversations" on public.conversations for select to authenticated using ((select auth.uid()) in (participant_a, participant_b));
drop policy if exists "Match participants read matches" on public.matches;
create policy "Match participants read matches" on public.matches for select to authenticated using ((select auth.uid()) in (profile_a, profile_b));
drop policy if exists "Conversation participants read messages" on public.messages;
create policy "Conversation participants read messages" on public.messages for select to authenticated using (exists (select 1 from public.conversations c where c.id = conversation_id and (select auth.uid()) in (c.participant_a, c.participant_b)));
drop policy if exists "Conversation participants send messages" on public.messages;
create policy "Conversation participants send messages" on public.messages for insert to authenticated with check (sender_profile_id = (select auth.uid()) and exists (select 1 from public.conversations c where c.id = conversation_id and (select auth.uid()) in (c.participant_a, c.participant_b)));

drop policy if exists "Open projects are visible" on public.projects;
create policy "Open projects are visible" on public.projects for select to anon, authenticated using (status = 'open' or company_id = (select auth.uid()));
drop policy if exists "Companies publish their own projects" on public.projects;
create policy "Companies publish their own projects" on public.projects for insert to authenticated with check (company_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.profile_type = 'company'));
drop policy if exists "Companies update their own projects" on public.projects;
create policy "Companies update their own projects" on public.projects for update to authenticated using (company_id = (select auth.uid())) with check (company_id = (select auth.uid()));

drop policy if exists "People see visits to their profile" on public.visits;
create policy "People see visits to their profile" on public.visits for select to authenticated using (target_profile_id = (select auth.uid()) or viewer_profile_id = (select auth.uid()));
drop policy if exists "People record their own visits" on public.visits;
create policy "People record their own visits" on public.visits for insert to authenticated with check (viewer_profile_id = (select auth.uid()));

drop policy if exists "People see their own subscription" on public.subscriptions;
create policy "People see their own subscription" on public.subscriptions for select to authenticated using (profile_id = (select auth.uid()));

drop policy if exists "Live sessions are visible" on public.lives;
create policy "Live sessions are visible" on public.lives for select to anon, authenticated using (status = 'live' or host_profile_id = (select auth.uid()));
drop policy if exists "Hosts create their own lives" on public.lives;
create policy "Hosts create their own lives" on public.lives for insert to authenticated with check (host_profile_id = (select auth.uid()));
drop policy if exists "Hosts update their own lives" on public.lives;
create policy "Hosts update their own lives" on public.lives for update to authenticated using (host_profile_id = (select auth.uid())) with check (host_profile_id = (select auth.uid()));

-- Profile media is public; uploads are created by the authenticated server API and scoped to profile ID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workerin-media', 'workerin-media', true, 26214400, array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "WorkerIN media is public" on storage.objects;
create policy "WorkerIN media is public" on storage.objects for select to anon, authenticated using (bucket_id = 'workerin-media');
drop policy if exists "Profiles upload their own media" on storage.objects;
create policy "Profiles upload their own media" on storage.objects for insert to authenticated with check (bucket_id = 'workerin-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- This app reads and writes data through its Node server with a server-only key.
grant usage on schema public to service_role;
grant all privileges on table public.profiles, public.interests, public.conversations, public.matches,
  public.messages, public.projects, public.visits, public.subscriptions, public.lives to service_role;
