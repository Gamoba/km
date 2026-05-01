import { redirect } from 'next/navigation'

// Settings are now per-feed at /feed/[feedId]/settings.
export default function SettingsPage() {
  redirect('/dashboard')
}
