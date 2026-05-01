import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseProduct } from '@/lib/sync'
import { adminDb, getOwnedFeed } from '@/lib/feeds'

function adminClient() {
  return adminDb()
}


// ── Types ──────────────────────────────────────────────────────────────────

type ExistingMapping = {
  google_field: string
  mapping_type: string
  config: Record<string, unknown>
}

// ── Shopify field list ─────────────────────────────────────────────────────

const SHOPIFY_STANDARD_FIELDS = [
  'item_group_id — Shopify produkt-ID, bruges som fælles gruppe-ID for varianter af samme produkt',
  'title — produktnavn',
  'body_html — produktbeskrivelse med HTML (brug STRIP_HTML mapping for at fjerne HTML)',
  'vendor — leverandør/brand navn',
  'handle — URL-slug',
  'url — komplet produkt-URL inkl. domæne (https://...)',
  'tags — kommaseparerede tags',
  'status — active/draft/archived',
  'product_type — produktkategori fra Shopify',
  'published_at / created_at / updated_at — datoer',
  'collections — array af kollektion-navne',
  'variants[0].id — variant-ID (brug i variant feed mode)',
  'variants[0].title — varianttitel',
  'variants[0].price — pris som decimal-streng uden valuta, f.eks. "199.00"',
  'variants[0].compare_at_price — vejledende pris uden valuta',
  'variants[0].sku — lagervarenummer',
  'variants[0].barcode — EAN/GTIN/UPC stregkode',
  'variants[0].weight — vaegt i gram',
  'variants[0].inventory_quantity — lagerbeholdning (heltal)',
  'variants[0].option1 / option2 / option3 — variationsmuligheder',
  'images[0].src — URL til første produktbillede',
  'images[1].src — URL til andet produktbillede',
]

// ── Helpers ────────────────────────────────────────────────────────────────

function formatExistingMappings(mappings: ExistingMapping[]): string {
  const active = mappings.filter((m) => m.mapping_type && m.mapping_type !== '')
  if (!active.length) return '  (ingen eksisterende mappings)'
  return active
    .map((m) => {
      if (m.mapping_type === 'FIELD') return `  ${m.google_field} → FIELD: ${m.config.field ?? '?'}`
      if (m.mapping_type === 'STATIC') return `  ${m.google_field} → STATIC: "${m.config.value ?? ''}"`
      return `  ${m.google_field} → ${m.mapping_type}`
    })
    .join('\n')
}

function buildProductText(products: SupabaseProduct[]): string {
  return products
    .map((p, i) => {
      const variants = (p.variants as Record<string, unknown>[]) ?? []
      const images = (p.images as Record<string, unknown>[]) ?? []
      const v0 = variants[0] ?? {}

      const lines: string[] = [
        `Produkt ${i + 1}:`,
        `  title: ${p.title ?? ''}`,
        `  vendor: ${p.vendor ?? ''}`,
        `  product_type: ${p.product_type ?? ''}`,
        `  tags: ${(p.tags ?? '').slice(0, 150)}`,
        `  shopify_id: ${p.shopify_id}`,
        `  handle: ${p.handle ?? ''}`,
        `  variants[0].id: ${v0.id ?? ''}`,
        `  variants[0].price: ${v0.price ?? ''}`,
        `  variants[0].compare_at_price: ${v0.compare_at_price ?? ''}`,
        `  variants[0].sku: ${v0.sku ?? ''}`,
        `  variants[0].barcode: ${v0.barcode ?? ''}`,
        `  variants[0].inventory_quantity: ${v0.inventory_quantity ?? ''}`,
        `  variants[0].option1: ${v0.option1 ?? ''}`,
        `  variants[0].option2: ${v0.option2 ?? ''}`,
        `  variants[0].weight: ${v0.weight ?? ''}`,
        `  images[0].src: ${images[0]?.src ? String(images[0].src).slice(0, 80) : '(intet)'}`,
        `  images[1].src: ${images[1]?.src ? '(URL til billede)' : '(intet)'}`,
      ]

      if (p.metafields.length > 0) {
        lines.push('  metafields:')
        for (const mf of p.metafields.slice(0, 20)) {
          const val = String(mf.value ?? '').slice(0, 150)
          lines.push(`    ${mf.namespace}.${mf.key} = "${val}"`)
        }
      }

      return lines.join('\n')
    })
    .join('\n\n')
}

// ── Prompt ─────────────────────────────────────────────────────────────────

function buildPrompt(
  feedMode: 'product' | 'variant',
  currency: string,
  locale: string,
  existingMappings: ExistingMapping[],
  metafields: { namespace: string; key: string }[],
  products: SupabaseProduct[]
): string {
  const metafieldsText =
    metafields.length > 0
      ? metafields.map((m) => `  metafield:${m.namespace}.${m.key}`).join('\n')
      : '  (ingen metafields fundet)'

  const standardFieldsText = SHOPIFY_STANDARD_FIELDS.map((f) => `  ${f}`).join('\n')
  const existingText = formatExistingMappings(existingMappings)
  const productsText = buildProductText(products)

  const idInstruction =
    feedMode === 'variant'
      ? 'id: Brug variants[0].id (ét feed-item per variant). item_group_id: Brug item_group_id feltet (fælles ID for alle varianter af samme produkt).'
      : 'id: Brug item_group_id feltet (ét feed-item per produkt).'

  return `Du er ekspert i Google Shopping Merchant Center og Shopify e-commerce.

=== KONTEKST ===
Feed mode: ${feedMode === 'variant' ? 'VARIANT (ét feed-item per variant)' : 'PRODUKT (ét feed-item per produkt)'}
Butikkens valuta: ${currency}
Produktdata sprog: ${locale}

Produkttitler, beskrivelser og tags i eksemplerne nedenfor er på sproget "${locale}".

=== EKSISTERENDE MAPPINGS ===
Disse felter er allerede mappet. Foreslå kun ændringer hvis den nuværende mapping er forkert:
${existingText}

=== GOOGLE SHOPPING FELTKRAV ===
${idInstruction}
title: Max 150 tegn. Ingen HTML. Ingen salgsfraser ("køb nu", "gratis fragt" osv.).
description: Max 5000 tegn. Ingen HTML-tags. Ingen salgsfraser. Ingen links. Brug body_html som kilde — men typen i mappingen skal sættes til STRIP_HTML for at fjerne HTML.
link: Komplet URL med https://. Brug "url" feltet.
image_link: Komplet https:// URL. Ingen vandmærker. Ingen tekst-overlay.
additional_image_link: Samme krav som image_link.
availability: PRÆCIS én af: in_stock, out_of_stock, preorder, backorder. Kræver beregning fra inventory — spring over.
price: Format "TAL VALUTA" med punktum som decimalseparator og mellemrum før valutakode. Eksempel: "199.00 ${currency}". variants[0].price indeholder kun tallet — tilføj " ${currency}" som suffix via PREFIX_SUFFIX mapping (men foreslå foreløbig som field).
sale_price: Samme format som price. Kun hvis compare_at_price eksisterer og er højere end price.
brand: Max 70 tegn. Ikke "N/A" eller "Generic". Brug vendor.
gtin: Kun tal. Max 14 cifre. Gyldige formater: UPC (12 cifre), EAN (13 cifre), ISBN (13 cifre). Brug variants[0].barcode.
mpn: Max 70 tegn. Producent-tildelt varenummer. Brug variants[0].sku.
condition: PRÆCIS én af: new, refurbished, used. Analyser produkterne — foreslå ALTID som static mapping.
google_product_category: Skal være et heltal ID fra Googles officielle taksonomi. IKKE en tekststreng. Kun hvis du er sikker på kategorien.
product_type: Max 750 tegn. Brug stinavns-format "Kategori > Underkategori". Brug product_type feltet.
item_group_id: Fælles ID for alle varianter. Max 50 tegn. Brug item_group_id feltet.
color: Max 100 tegn. Ingen tal eller hex-koder. Adskil farver med /. Brug option-felter eller metafields.
size: Max 100 tegn. Brug option-felter eller metafields.
gender: PRÆCIS én af: male, female, unisex. Kun hvis relevant for produkttypen.
age_group: PRÆCIS én af: newborn, infant, toddler, kids, adult. Kun hvis relevant.
material: Max 200 tegn. Adskil materialer med /. Brug metafields hvis tilgængeligt.
pattern: Max 100 tegn. Brug metafields hvis tilgængeligt.
size_type: PRÆCIS én af: regular, petite, maternity, big, tall, plus.
size_system: PRÆCIS én af: US, UK, EU, DE, FR, JP, CN, IT, BR, MEX, AU.
shipping_weight: Format "TAL enhed". Eksempel: "1.5 kg". Enheder: lb, oz, g, kg. Brug variants[0].weight (er i gram — brug suffix " g").

=== TILGÆNGELIGE SHOPIFY FELTER ===
Standard felter:
${standardFieldsText}

Metafelter i denne butik:
${metafieldsText}

=== EKSEMPEL PRODUKTER ===
${productsText}

=== INSTRUKTIONER ===
1. Analyser feltnavne og dataformater — ikke hvad butikken sælger
2. Foreslå KUN felter der ikke allerede er korrekt mappet
3. Spring "availability" over — kræver beregning
4. Brug "high" confidence kun ved direkte teknisk match mellem feltnavne eller dataformater
5. Returner KUN JSON array — ingen forklaring, ingen markdown, ingen kommentarer

VIGTIGE REGLER:
- Lav KUN forslag baseret på teknisk feltstruktur og dataformat — ikke baseret på hvad butikken sælger
- Nævn ALDRIG hvad butikken sælger i reason feltet — hold forklaringerne tekniske og generelle
- For condition feltet: foreslå KUN static mapping hvis du kan se direkte bevis i produktdataene (f.eks. et metafelt der hedder "condition" eller "tilstand") — ellers spring condition over
- For google_product_category: foreslå KUN et metafelt hvis du kan se at metafeltet indeholder et heltal ID — aldrig et hardkodet kategori ID
- custom_label forslag skal KUN baseres på at metafeltet eksisterer og har konsistente værdier på tværs af produkterne — ikke på hvad værdien betyder for den specifikke branche
- confidence "high" må kun bruges når der er et direkte teknisk match mellem feltnavne eller dataformater
- reason feltet skal forklare det tekniske match — ikke forretningslogikken bag

JSON format (begge typer):
[
  { "google_field": "title", "shopify_field": "title", "mapping_type": "field", "confidence": "high", "reason": "Direkte navnematch" },
  { "google_field": "condition", "shopify_field": null, "mapping_type": "static", "static_value": "new", "confidence": "high", "reason": "Begrundelse baseret på produktanalyse" }
]`
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY er ikke konfigureret' }, { status: 500 })
  }

  const url = new URL(req.url)
  const feedId = url.searchParams.get('feedId')
  if (!feedId) return NextResponse.json({ error: 'feedId mangler' }, { status: 400 })

  const owned = await getOwnedFeed(user.id, feedId)
  if (!owned) return NextResponse.json({ error: 'Feed ikke fundet' }, { status: 404 })

  const db = adminClient()

  const [
    { data: settingsData },
    { data: shopSettingsData },
    { data: mappingsData },
    { data: metafieldRows },
    { data: productRows },
  ] = await Promise.all([
    db.from('feed_settings').select('feed_mode').eq('feed_id', feedId).maybeSingle(),
    db.from('shop_settings').select('currency, selected_locale').eq('feed_id', feedId).maybeSingle(),
    db.from('feed_mappings').select('google_field, mapping_type, config').eq('feed_id', feedId),
    db.from('product_metafields').select('namespace, key').eq('feed_id', feedId).limit(200),
    db.from('products').select('*, metafields:product_metafields(*)').eq('feed_id', feedId).eq('status', 'active').limit(50),
  ])

  const feedMode = (settingsData?.feed_mode as 'product' | 'variant') ?? 'product'
  const currency = shopSettingsData?.currency ?? 'USD'
  const locale = shopSettingsData?.selected_locale ?? 'en'

  // Deduplicate metafields
  const seen = new Set<string>()
  const uniqueMetafields: { namespace: string; key: string }[] = []
  for (const mf of metafieldRows ?? []) {
    const k = `${mf.namespace}.${mf.key}`
    if (!seen.has(k)) { seen.add(k); uniqueMetafields.push(mf) }
  }

  // 5 random products
  const allProducts = (productRows ?? []) as SupabaseProduct[]
  const sampleProducts = [...allProducts].sort(() => Math.random() - 0.5).slice(0, 5)

  const existingMappings = (mappingsData ?? []) as ExistingMapping[]

  const prompt = buildPrompt(feedMode, currency, locale, existingMappings, uniqueMetafields, sampleProducts)

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '[]'

  let suggestions: unknown[] = []
  try {
    suggestions = JSON.parse(raw)
  } catch {
    const match = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/)
    if (match) {
      try { suggestions = JSON.parse(match[1]) } catch { suggestions = [] }
    }
  }

  if (!Array.isArray(suggestions)) suggestions = []

  return NextResponse.json({ suggestions })
}
