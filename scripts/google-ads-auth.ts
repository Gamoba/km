// One-off: mint a Google Ads API refresh token via the OAuth loopback flow.
//
// THROWAWAY / DIAGNOSTIC ONLY. It mints a token from the CLI via the loopback
// flow so we can interrogate a real account before designing anything. The real
// product flow will use an /api/google-ads/callback route and store the refresh
// token AES-256-GCM-encrypted (same pattern as the Shopify token — see
// lib/crypto.ts / lib/projectShopify.ts). Nothing here survives into production.
//
// PREREQUISITE with a *Web* OAuth client: http://127.0.0.1:8765 must be listed
// under "Authorised redirect URIs" on the client, or Google returns
// redirect_uri_mismatch. (Desktop clients accept loopback with no registration.)
//
// Run:  npx tsx scripts/google-ads-auth.ts
//
// Prints a refresh token. Paste it into .env.local as GOOGLE_ADS_REFRESH_TOKEN,
// then run scripts/google-ads-diagnose.ts.

import { createServer } from 'http'
import { randomBytes, createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'

const envFile = join(process.cwd(), '.env.local')
try {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const [k, ...rest] = line.split('=')
    if (k?.trim() && !k.startsWith('#')) process.env[k.trim()] ??= rest.join('=').trim()
  }
} catch {
  // fall through to existing env
}

// Prefers the new Web client when present, else whatever legacy names are set.
// NB: a refresh token is bound to the client that minted it — google-ads-diagnose.ts
// resolves credentials the same way, so both scripts must agree.
const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.CLIENT_SECRET

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Mangler GOOGLE_OAUTH_CLIENT_ID / _SECRET (eller CLIENT_ID / CLIENT_SECRET) i .env.local')
  process.exit(1)
}

const PORT = Number(process.env.GOOGLE_ADS_AUTH_PORT ?? 8765)
// Loopback redirect. A *desktop* client accepts this with no registration; a
// *web* client requires this EXACT string under "Authorised redirect URIs".
const REDIRECT_URI = `http://127.0.0.1:${PORT}`
const SCOPE = 'https://www.googleapis.com/auth/adwords'

// Which Google account to pre-select on the consent screen. Your browser's
// default account is usually NOT the one with Ads access.
//   npx tsx scripts/google-ads-auth.ts din@gamoba.dk
const LOGIN_HINT = process.argv[2] ?? process.env.GOOGLE_ADS_LOGIN_HINT ?? ''

// PKCE. Not strictly required when a client secret is sent, but desktop clients
// are public clients and Google recommends it — a few lines of insurance.
const b64url = (b: Buffer) => b.toString('base64url')
const verifier = b64url(randomBytes(32))
const challenge = b64url(createHash('sha256').update(verifier).digest())
const state = b64url(randomBytes(16))

const params: Record<string, string> = {
  response_type: 'code',
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  scope: SCOPE,
  // offline + consent together are what guarantee a refresh_token comes back.
  // Without prompt=consent Google omits it on re-authorisation.
  // select_account forces the account chooser — the browser's default Google
  // account is rarely the one with Google Ads access.
  access_type: 'offline',
  prompt: 'select_account consent',
  code_challenge: challenge,
  code_challenge_method: 'S256',
  state,
}
if (LOGIN_HINT) params.login_hint = LOGIN_HINT

// URLSearchParams encodes spaces as "+", which some OAuth endpoints don't fold
// back to a space — that would make prompt="select_account+consent" an invalid
// value and silently drop the account chooser. Force %20. Safe for the other
// params here: none of them can legitimately contain a "+".
const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams(params).toString().replace(/\+/g, '%20')

// NB: do NOT launch via `cmd /c start` on Windows — cmd.exe treats the `&`
// between query parameters as a command separator, so the URL arrives at Google
// truncated after client_id (symptom: "Required parameter is missing:
// response_type"). rundll32 hands the string to the shell URL handler verbatim.
function openBrowser(url: string) {
  try {
    if (process.platform === 'win32') {
      spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref()
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
    }
  } catch {
    // Browser launch is best-effort; the URL is printed regardless.
  }
}

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:15px/1.6 system-ui;padding:60px;max-width:640px;margin:auto">` +
  `<h2>${title}</h2><p>${body}</p></body>`

async function exchange(code: string): Promise<Record<string, unknown>> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }).toString(),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) throw new Error(`Token exchange ${res.status}: ${JSON.stringify(json)}`)
  return json
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', REDIRECT_URI)
  const code = url.searchParams.get('code')
  const err = url.searchParams.get('error')
  const gotState = url.searchParams.get('state')

  if (!code && !err) {
    res.writeHead(404).end()
    return
  }

  if (err) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(page('Afvist', `Google returnerede: <code>${err}</code>`))
    console.error(`\n✗ Consent afvist: ${err}`)
    server.close()
    process.exit(1)
  }

  if (gotState !== state) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(page('State mismatch', 'Afbrudt af sikkerhedshensyn.'))
    console.error('\n✗ State mismatch — afbrudt')
    server.close()
    process.exit(1)
  }

  try {
    const tok = await exchange(code!)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(page('Færdig ✓', 'Du kan lukke dette vindue og gå tilbage til terminalen.'))

    const refresh = tok.refresh_token as string | undefined
    console.log('\n─────────────────────────────────────────────')
    if (refresh) {
      console.log('✓ Refresh token modtaget. Læg denne linje i .env.local:\n')
      console.log(`GOOGLE_ADS_REFRESH_TOKEN=${refresh}`)
    } else {
      console.log('✗ Ingen refresh_token i svaret. Det sker typisk hvis kontoen')
      console.log('  allerede har godkendt appen. Tilbagekald adgangen på')
      console.log('  https://myaccount.google.com/permissions og kør igen.')
      console.log(`\n  Svar-nøgler: ${Object.keys(tok).join(', ')}`)
    }
    console.log('─────────────────────────────────────────────\n')
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(page('Fejl', 'Token exchange fejlede — se terminalen.'))
    console.error('\n✗', e instanceof Error ? e.message : e)
  }

  server.close()
  setTimeout(() => process.exit(0), 100)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nLytter på ${REDIRECT_URI}`)
  console.log(`OAuth-klient:    ${CLIENT_ID.split('-')[0]}-…`)
  console.log(`redirect_uri:    ${REDIRECT_URI}`)
  console.log('                 ^ denne EKSAKTE streng skal stå under')
  console.log('                   "Authorised redirect URIs" på klienten')
  if (LOGIN_HINT) console.log(`Foreslået konto: ${LOGIN_HINT}`)
  console.log('\nÅbn dette link (kopiér hele linjen — den er lang):\n')
  console.log(authUrl)
  console.log('\nForsøger også at åbne browseren automatisk...\n')
  openBrowser(authUrl)
})

// Don't leave a listener hanging forever if consent is abandoned.
setTimeout(() => {
  console.error('\n✗ Timeout efter 5 min uden svar.')
  server.close()
  process.exit(1)
}, 5 * 60 * 1000)
