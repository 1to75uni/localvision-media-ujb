-- D1 migration: init
CREATE TABLE IF NOT EXISTS stores (
  store_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL,
  side TEXT NOT NULL, -- left/right
  slot INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(store_id, side, slot)
);

CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  role TEXT NOT NULL,
  ua TEXT,
  ip TEXT,
  last_seen INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_store ON media(store_id);
CREATE INDEX IF NOT EXISTS idx_devices_store ON devices(store_id);
