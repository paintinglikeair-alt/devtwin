-- ═══════════════════════════════════════════════
--   DevTwin — Supabase Database Schema
--   Run this in: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users table ──────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name           TEXT        NOT NULL DEFAULT '',
  email          TEXT        UNIQUE NOT NULL,
  password_hash  TEXT        NOT NULL DEFAULT '',
  bob_mcp_token  TEXT        UNIQUE NOT NULL DEFAULT concat('dt-', replace(gen_random_uuid()::text, '-', '')),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Snapshots table ──────────────────────────────
CREATE TABLE IF NOT EXISTS snapshots (
  id          TEXT        PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file        TEXT        NOT NULL DEFAULT '',
  type        TEXT        NOT NULL DEFAULT 'red' CHECK (type IN ('red', 'green')),
  description TEXT        DEFAULT '',
  code        TEXT        DEFAULT '',
  prompt      TEXT        DEFAULT '',
  ts          TEXT        DEFAULT '',
  ts_ms       BIGINT      DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_snapshots_user_id ON snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_ts_ms   ON snapshots(ts_ms DESC);

-- ── Disable RLS (backend uses service-role key) ──
ALTER TABLE users     DISABLE ROW LEVEL SECURITY;
ALTER TABLE snapshots DISABLE ROW LEVEL SECURITY;
