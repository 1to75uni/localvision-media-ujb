-- LocalVision D1 init (idempotent)
CREATE TABLE IF NOT EXISTS stores (
  store_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS heartbeats (
  store_id TEXT PRIMARY KEY,
  last_seen INTEGER NOT NULL
);
