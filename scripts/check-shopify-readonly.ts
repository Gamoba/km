// Shopify read-only guard — see AGENTS.md "Shopify is strictly read-only".
//
// Scans the only files that should ever talk to Shopify:
//   - lib/shopify.ts
//   - lib/sync.ts
//   - app/api/shopify/**.ts
// and fails the build if any pattern indicates a write path.
//
// Run with: npx tsx scripts/check-shopify-readonly.ts
// Wired into `prebuild` in package.json so `npm run build` enforces it.

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative } from 'path'

// ── Files to scan ──────────────────────────────────────────────────────────

const FILES_TO_CHECK: string[] = ['lib/shopify.ts', 'lib/sync.ts']

function collectTsFiles(dir: string, out: string[]) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) collectTsFiles(p, out)
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p)
  }
}

const apiShopifyFiles: string[] = []
collectTsFiles(join('app', 'api', 'shopify'), apiShopifyFiles)

const allFiles = [...FILES_TO_CHECK, ...apiShopifyFiles]
  .map((p) => relative(process.cwd(), p))
  .filter((p) => existsSync(p))

// ── Detection rules ────────────────────────────────────────────────────────

// GraphQL keyword "mutation" as a whole word, anywhere on the line.
// Word boundary handles camelCase: e.g. "productMutation" doesn't match
// because there is no word boundary inside camelCase identifiers.
const MUTATION_KEYWORD = /\bmutation\b/i

// Known Shopify Admin GraphQL write fields. Substring match — these names
// appear nowhere in legitimate read code, so any hit is a violation.
const DANGEROUS_FIELDS: string[] = [
  'productCreate',
  'productUpdate',
  'productDelete',
  'productVariantCreate',
  'productVariantUpdate',
  'productVariantDelete',
  'productVariantsBulkCreate',
  'productVariantsBulkUpdate',
  'productVariantsBulkDelete',
  'metafieldsSet',
  'metafieldDelete',
  'metafieldsDelete',
  'inventoryAdjustQuantities',
  'inventorySetOnHandQuantities',
  'inventoryActivate',
  'inventoryDeactivate',
  'bulkOperationRunMutation',
  'collectionCreate',
  'collectionUpdate',
  'collectionDelete',
  'orderCreate',
  'orderUpdate',
  'fulfillmentCreate',
  'tagsAdd',
  'tagsRemove',
]

// HTTP method literal (matches `method: 'POST'`, `method: "PUT"`, etc.)
const METHOD_LITERAL = /method\s*:\s*['"]([A-Z]+)['"]/

// `fetch(<expr>` — captures the first-argument expression up to the comma.
const FETCH_CALL = /fetch\s*\(\s*([^,)\n]+?)\s*[,)]/

// `const|let|var X = ...` — captures identifier and the rest of the line.
const IDENT_DECL = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=([^;]*)/

// Returns true iff the POST at `methodIdx` is sent to a URL that includes
// `/graphql.json`. Walks up the file to find the enclosing `fetch(`, captures
// its URL expression, and resolves bare identifiers via their declaration
// earlier in the file.
function postTargetsGraphQL(lines: string[], methodIdx: number): boolean {
  // Walk up to find the matching fetch( call (within a generous 60-line window).
  let fetchIdx = -1
  for (let i = methodIdx; i >= 0 && i > methodIdx - 60; i--) {
    if (FETCH_CALL.test(lines[i])) {
      fetchIdx = i
      break
    }
  }
  if (fetchIdx === -1) return false

  const arg = (lines[fetchIdx].match(FETCH_CALL)?.[1] ?? '').trim()
  if (!arg) return false

  // Literal expression containing /graphql.json (e.g. `shopifyUrl('/graphql.json')`).
  if (arg.includes('/graphql.json')) return true

  // Otherwise it's an identifier — walk earlier lines to find its declaration
  // and check whether the right-hand side mentions /graphql.json.
  if (!/^[A-Za-z_$][\w$]*$/.test(arg)) return false
  for (let i = fetchIdx - 1; i >= 0; i--) {
    const m = lines[i].match(IDENT_DECL)
    if (m && m[1] === arg && m[2].includes('/graphql.json')) {
      return true
    }
  }
  return false
}

// ── Scan ───────────────────────────────────────────────────────────────────

type Violation = { file: string; line: number; reason: string; snippet: string }
const violations: Violation[] = []

for (const file of allFiles) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')

  lines.forEach((rawLine, idx) => {
    const lineNum = idx + 1
    const snippet = rawLine.trim()

    if (MUTATION_KEYWORD.test(rawLine)) {
      violations.push({
        file,
        line: lineNum,
        reason: 'GraphQL keyword "mutation" — Shopify writes are forbidden',
        snippet,
      })
    }

    for (const field of DANGEROUS_FIELDS) {
      if (rawLine.includes(field)) {
        violations.push({
          file,
          line: lineNum,
          reason: `Shopify write-field reference "${field}"`,
          snippet,
        })
      }
    }

    const m = METHOD_LITERAL.exec(rawLine)
    if (m) {
      const method = m[1].toUpperCase()
      if (method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
        violations.push({
          file,
          line: lineNum,
          reason: `HTTP ${method} forbidden against Shopify`,
          snippet,
        })
      } else if (method === 'POST' && !postTargetsGraphQL(lines, idx)) {
        violations.push({
          file,
          line: lineNum,
          reason: 'POST not targeting /graphql.json — only GraphQL POSTs are allowed',
          snippet,
        })
      }
    }
  })
}

// ── Report ─────────────────────────────────────────────────────────────────

if (violations.length === 0) {
  console.log(`✓ Shopify read-only check OK — ${allFiles.length} file(s) scanned`)
  for (const f of allFiles) console.log(`    · ${f}`)
  process.exit(0)
}

console.error(`\n✗ Shopify read-only check FAILED — ${violations.length} violation(s):\n`)
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.reason}`)
  console.error(`    > ${v.snippet}`)
  console.error('')
}
console.error('Shopify must remain read-only — see AGENTS.md "Shopify is strictly read-only".\n')
process.exit(1)
