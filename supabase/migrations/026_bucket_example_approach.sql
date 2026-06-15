-- AI approach label + rationale per workshop candidate.
--
-- The example workshop moves from "N variations" to "5 deliberately different
-- titling APPROACHES per round", each carrying a short AI explanation of how the
-- title was built. Two additive text columns on bucket_examples hold that
-- explanation:
--   approach   short strategy label the model used (e.g. "spec_heavy", "concise")
--   rationale  one-sentence explanation of the approach, shown to the curator
--
-- Purely additive — existing rows default to '' (they predate approaches). No
-- data migration. The `note` column stays (notes become optional/hidden in the
-- UI, not removed). Idempotent.

BEGIN;

ALTER TABLE bucket_examples ADD COLUMN IF NOT EXISTS approach  text NOT NULL DEFAULT '';
ALTER TABLE bucket_examples ADD COLUMN IF NOT EXISTS rationale text NOT NULL DEFAULT '';

COMMIT;
