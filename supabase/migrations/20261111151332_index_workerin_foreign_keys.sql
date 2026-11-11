-- Index foreign keys used to scope direct-message conversations and matches.
create index if not exists conversations_created_by_idx
  on public.conversations (created_by);

create index if not exists matches_conversation_idx
  on public.matches (conversation_id);
