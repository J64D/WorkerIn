CREATE KEYSPACE IF NOT EXISTS workerin WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
CREATE TABLE IF NOT EXISTS workerin.messages_by_conversation (
  conversation_id text,
  created_at timeuuid,
  message_id text,
  sender_id text,
  content text,
  sent_at timestamp,
  PRIMARY KEY (conversation_id, created_at)
) WITH CLUSTERING ORDER BY (created_at DESC);
