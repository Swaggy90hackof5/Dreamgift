import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS registries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  token_hash    TEXT NOT NULL,
  partner1      TEXT NOT NULL,
  partner2      TEXT NOT NULL DEFAULT '',
  upi_id        TEXT NOT NULL,
  linked_account TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dreams (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  registry_id INTEGER NOT NULL REFERENCES registries(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL DEFAULT '✨',
  title       TEXT NOT NULL,
  target      INTEGER NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0
);

-- status: created (order made, unpaid) | paid | pending (UPI direct, awaiting couple's confirmation) | failed
-- method: razorpay | upi_direct
CREATE TABLE IF NOT EXISTS contributions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  registry_id INTEGER NOT NULL REFERENCES registries(id) ON DELETE CASCADE,
  dream_id    INTEGER NOT NULL REFERENCES dreams(id) ON DELETE CASCADE,
  guest       TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  message     TEXT NOT NULL DEFAULT '',
  method      TEXT NOT NULL,
  status      TEXT NOT NULL,
  order_id    TEXT,
  payment_id  TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contrib_registry ON contributions(registry_id, status);
CREATE INDEX IF NOT EXISTS idx_contrib_order ON contributions(order_id);
CREATE INDEX IF NOT EXISTS idx_dreams_registry ON dreams(registry_id);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}
