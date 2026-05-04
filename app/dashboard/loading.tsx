export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-500">Loading products from Shopify…</p>
        <p className="text-xs text-gray-400 mt-1">This may take a moment</p>
      </div>
    </div>
  )
}
