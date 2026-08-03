-- Store each project's customer-facing storefront domain.
--
-- Product URLs in a feed are built from the selected market's rootUrl. A market
-- only has a rootUrl when the merchant configured a Shopify Markets web
-- presence for it; single-market stores return none. Until now the fallback was
-- the SHOP_DOMAIN env var — a single global value, so EVERY project without a
-- market URL silently emitted product links pointing at whichever store that env
-- var happened to name. Cross-tenant wrong data, not just a cosmetic bug.
--
-- projects.shop_url can't stand in for it: that's the *.myshopify.com admin
-- domain, whereas Google Merchant Center requires links on the claimed
-- storefront domain. So we store shop.primaryDomain.url (e.g.
-- "https://www.vinnu.dk"), read from Shopify when the connection is configured.
--
-- Nullable: projects connected before this migration have no value until the
-- next Connect probe, or until scripts/backfill-primary-domain.ts fills them in.
--
-- Idempotent: IF NOT EXISTS so the migrate.ts runner can replay it safely.

BEGIN;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS primary_domain text;

COMMENT ON COLUMN projects.primary_domain IS
  'Customer-facing storefront root URL (shop.primaryDomain.url), e.g. https://www.vinnu.dk. Fallback for product links when the selected market has no web presence.';

COMMIT;
