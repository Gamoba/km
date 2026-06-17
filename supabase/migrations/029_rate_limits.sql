-- Per-user rate limiting + daily volume budgets (security hardening M1).
--
-- One fixed-window counter table keyed by (user_id, kind, window_start). The app
-- (lib/rateLimit.ts) computes window_start by flooring now() to the window size,
-- so every call in the same hour/day lands on one row. Two uses share the table:
--   - frequency caps  (kind='ai_suggest'|'workshop_generate'|'shopify_sync'|
--                       'feed_regenerate', hourly window, amount=1)
--   - volume budget   (kind='optimize_products_daily', daily window, amount=N)
--
-- increment_rate_limit does the check+increment ATOMICALLY: it only adds when the
-- new total stays within the limit, so concurrent serverless invocations can't
-- race past the cap. Returns whether the call is allowed + the resulting count.
--
-- Access is service-role only (lib/rateLimit calls it via adminDb), so RLS is
-- disabled to match the rest of the schema (isolation lives in app code).
--
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE so migrate.ts can replay.

BEGIN;

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  user_id      uuid        NOT NULL,
  kind         text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, kind, window_start)
);

ALTER TABLE rate_limit_counters DISABLE ROW LEVEL SECURITY;

-- Lets a periodic cleanup drop expired windows efficiently (optional/manual).
CREATE INDEX IF NOT EXISTS rate_limit_counters_window_idx
  ON rate_limit_counters (window_start);

-- Atomic check-and-increment. Adds p_amount only if it keeps count <= p_limit.
-- Returns allowed=false WITHOUT consuming budget when the limit would be exceeded
-- (important for the volume budget — a rejected run must not burn the day's quota).
CREATE OR REPLACE FUNCTION increment_rate_limit(
  p_user_id      uuid,
  p_kind         text,
  p_window_start timestamptz,
  p_amount       integer,
  p_limit        integer
)
RETURNS TABLE (allowed boolean, new_count integer)
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO rate_limit_counters (user_id, kind, window_start, count)
    VALUES (p_user_id, p_kind, p_window_start, 0)
    ON CONFLICT (user_id, kind, window_start) DO NOTHING;

  UPDATE rate_limit_counters
    SET count = count + p_amount
    WHERE user_id = p_user_id
      AND kind = p_kind
      AND window_start = p_window_start
      AND count + p_amount <= p_limit
    RETURNING count INTO v_count;

  IF v_count IS NULL THEN
    -- Limit would be exceeded — return the current count unchanged.
    SELECT count INTO v_count
      FROM rate_limit_counters
      WHERE user_id = p_user_id AND kind = p_kind AND window_start = p_window_start;
    RETURN QUERY SELECT false, v_count;
  ELSE
    RETURN QUERY SELECT true, v_count;
  END IF;
END;
$$;

COMMIT;
