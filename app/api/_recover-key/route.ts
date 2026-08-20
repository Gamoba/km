// ⚠️ TEMPORARY — DELETE THIS FILE IMMEDIATELY AFTER USE ⚠️
//
// One-off recovery of TOKEN_ENCRYPTION_KEY from the Vercel runtime, for the
// handover where the original developer is unreachable and the variable is
// flagged Sensitive (write-only in the dashboard).
//
// Deliberately does NOT log the value: Vercel retains function logs and may
// forward them to a log drain, which would turn a one-time read into a
// permanent third-party copy. The value is returned in the response body only.
//
// Guarded by RECOVERY_SECRET, which is NOT in this repo — set it in Vercel
// alongside the deploy. If it is unset the route 404s, so an accidentally
// forgotten copy of this file is inert rather than an open secret endpoint.

import { timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'

// Length-independent constant-time compare — timingSafeEqual throws on
// mismatched buffer lengths, so guard that before calling it.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export async function GET(request: NextRequest) {
  const expected = process.env.RECOVERY_SECRET
  // Not armed → behave as if the route doesn't exist.
  if (!expected) return new Response('Not found', { status: 404 })

  const supplied = request.nextUrl.searchParams.get('token') ?? ''
  if (!safeEqual(supplied, expected)) {
    return new Response('Not found', { status: 404 })
  }

  const key = process.env.TOKEN_ENCRYPTION_KEY ?? null

  return Response.json(
    {
      TOKEN_ENCRYPTION_KEY: key,
      // Sanity check: lib/crypto.ts requires this to decode to exactly 32.
      decodedBytes: key ? Buffer.from(key, 'base64').length : 0,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Robots-Tag': 'noindex',
      },
    }
  )
}
