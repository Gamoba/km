-- Per-bucket few-shot config + the example workshop.
--
-- Moves few-shot from per-FEED (title_optimization_settings.few_shot_examples,
-- a freeform text blob) to per-BUCKET, and adds a resumable "example workshop":
-- the user writes instructions, picks input fields, generates a wide batch of
-- candidate titles, and curates the good ones into a small approved set. The run
-- and the workshop share this same config — you tune in the workshop, then run
-- on all members.
--
--   bucket_title_config  one row per bucket: instructions + chosen input fields.
--   bucket_examples      every example/candidate ever generated for a bucket;
--                        status = approved | rejected | candidate. The approved
--                        rows (up to 5, fewer is fine) are the few-shot; the rest
--                        are dialog history that conditions the next generation
--                        round ("these were good, these weren't — make more like
--                        the good ones").
--
-- NO backfill from title_optimization_settings.few_shot_examples: the old value
-- is one freeform text string per feed, not (product_ref, generated_title)
-- example rows, so it can't decompose into bucket_examples; and it's per feed,
-- not per bucket, so it can't seed a specific bucket's config unambiguously.
-- (Expected empty anyway — only the no-persist Preview path has run.) The old
-- column is left in place, unused by the bucket run, and retired in a later step.
--
-- "Up to 5 approved (fewer OK)" and "position is dense among approved" are
-- enforced in the service layer, not the schema. The partial unique index below
-- only guarantees approved positions don't collide.
--
-- Idempotent: IF NOT EXISTS throughout.

BEGIN;

-- ── 1. bucket_title_config (one row per bucket) ────────────────────────────
-- feed_id denormalized for isolation queries (consistent with bucket_products).
-- input_fields is the ordered list of field tokens (standard fields +
-- `metafield:namespace.key`) fed into generation.

CREATE TABLE IF NOT EXISTS bucket_title_config (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  bucket_id    uuid        NOT NULL UNIQUE REFERENCES optimization_buckets(id) ON DELETE CASCADE,
  feed_id      uuid        NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  instructions text        NOT NULL DEFAULT '',
  input_fields jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

ALTER TABLE bucket_title_config DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bucket_title_config_feed_id
  ON bucket_title_config(feed_id);

-- ── 2. bucket_examples (approved few-shot + candidate/dialog history) ───────
-- One row per generated candidate. `position` orders the approved set (0-based,
-- NULL for non-approved). `note` is the user's optional reasoning, replayed into
-- the generation dialog. product_ref is the member the candidate was generated
-- for; generated_title is the model's proposal.

CREATE TABLE IF NOT EXISTS bucket_examples (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  bucket_id       uuid        NOT NULL REFERENCES optimization_buckets(id) ON DELETE CASCADE,
  feed_id         uuid        NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  product_ref     text        NOT NULL,
  generated_title text        NOT NULL,
  status          text        NOT NULL DEFAULT 'candidate'
                                CHECK (status IN ('approved', 'rejected', 'candidate')),
  note            text        NOT NULL DEFAULT '',
  position        integer,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE bucket_examples DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bucket_examples_bucket_id
  ON bucket_examples(bucket_id);

CREATE INDEX IF NOT EXISTS idx_bucket_examples_bucket_status
  ON bucket_examples(bucket_id, status);

-- Approved examples occupy distinct slots within a bucket. Non-approved rows
-- (position NULL) are exempt — many candidates/rejects per bucket are expected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bucket_examples_approved_position
  ON bucket_examples(bucket_id, position)
  WHERE status = 'approved';

COMMIT;
