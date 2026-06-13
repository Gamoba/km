-- Projects layer: per-project Shopify connection (multi-tenant pr. bruger).
--
-- A project owns one Shopify connection (shop_url + encrypted access token).
-- Feeds now hang on a project and inherit its credentials. Deleting a project
-- cascades to its feeds, and from there down via the existing feed_id cascades
-- (migration 009).
--
-- This migration is SCHEMA ONLY. The data backfill (creating a default project
-- from the env credentials and stamping feeds.project_id) lives in
-- scripts/backfill-default-project.ts, because the access token must be
-- encrypted in Node (AES-256-GCM, lib/crypto.ts) — SQL can't do that. That
-- script also locks feeds.project_id NOT NULL once every feed is stamped.
--
-- Idempotent: guarded with IF [NOT] EXISTS / pg_policies lookups so the
-- migrate.ts runner can replay it safely.

BEGIN;

-- ── 1. projects table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS projects (
  id                       uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                     text        NOT NULL,
  description              text,
  shop_url                 text,
  -- Encrypted Shopify access token (AES-256-GCM). All three parts are needed
  -- to decrypt; never stored in plaintext. Nullable so a project can exist
  -- before its connection is configured.
  access_token_ciphertext  text,
  access_token_iv          text,
  access_token_tag         text,
  connection_status        text        NOT NULL DEFAULT 'unverified'
    CHECK (connection_status IN ('unverified', 'connected', 'error')),
  last_verified_at         timestamptz,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

-- ── 2. Row-Level Security ──────────────────────────────────────────────────
-- Mirrors the only existing real policy in the schema (shop_settings, 007):
-- a user may only see/modify rows where user_id = auth.uid().
--
-- NOTE: the application reads/writes via the service-role key (adminDb()),
-- which BYPASSES RLS — so this policy is defense-in-depth, not the primary
-- isolation mechanism. Primary isolation stays in app code via
-- getOwnedProject()/getOwnedFeed(). The policy still protects against any
-- future anon/authed-key access path.

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'projects'
      AND policyname = 'Users can manage own projects'
  ) THEN
    CREATE POLICY "Users can manage own projects"
      ON projects FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ── 3. feeds.project_id ────────────────────────────────────────────────────
-- Nullable here; the backfill script stamps it and then locks NOT NULL once
-- every feed is assigned (same deferred-lock pattern as feed_id in 009).
-- ON DELETE CASCADE: deleting a project removes its feeds.

ALTER TABLE feeds
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_feeds_project_id ON feeds(project_id);

COMMIT;
