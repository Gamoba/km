<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:shopify-readonly-rule -->
# Shopify is strictly read-only — never write

This application must **NEVER** write to, update, or delete data in Shopify via the API. The rule applies for the entire lifetime of the project, regardless of how a feature request is framed.

**Forbidden:**
- GraphQL `mutation` operations (`productCreate`, `productUpdate`, `productDelete`, `productVariantUpdate`, `metafieldsSet`, `metafieldDelete`, `inventoryAdjustQuantities`, `bulkOperationRunMutation`, etc.)
- REST `POST` / `PUT` / `PATCH` / `DELETE` that mutate Shopify data
- "Temporary" or "debug-only" writes — also forbidden
- Webhooks that write back

**Allowed:**
- REST `GET`
- GraphQL `POST` to `/graphql.json` **only** when the body is a `query` (POST is just the protocol; what matters is the body)

If a feature request appears to require writing to Shopify, refuse it, point to this rule, and suggest a read-only alternative — or recommend a manual change via Shopify Admin.

This is enforced mechanically by `scripts/check-shopify-readonly.ts`, wired into `prebuild` so `npm run build` (and CI) fails on regressions.
<!-- END:shopify-readonly-rule -->
