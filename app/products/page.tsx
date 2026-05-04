import { redirect } from 'next/navigation'

// Pre-multi-feed top-level page — redirects to the feed list. Per-feed
// products live at /feed/[feedId]/products.
export default function ProductsPage() {
  redirect('/')
}
