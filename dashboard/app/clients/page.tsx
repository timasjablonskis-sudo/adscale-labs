export const dynamic = 'force-dynamic'

async function getClients() {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/api/clients`, { cache: 'no-store' })
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

const TIER_COLORS: Record<string, string> = {
  'Scale ($2,500/mo)': 'text-violet-400 bg-violet-400/10',
  'Growth ($1,500/mo)': 'text-indigo-400 bg-indigo-400/10',
  'Launch ($750/mo)': 'text-blue-400 bg-blue-400/10',
}

export default async function ClientsPage() {
  const clients = await getClients()

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Client Roster</h1>
        <p className="text-slate-400 text-sm mt-1">{clients.length} active clients</p>
      </div>

      {clients.length === 0 ? (
        <div className="bg-[#1a1d27] border border-[#2a2d3e] rounded-xl p-8 text-center">
          <p className="text-slate-400">No clients yet. Cleo will add them when payments come in.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {clients.map((client: any) => {
            const brandDoc = client.brand_doc ? JSON.parse(client.brand_doc) : null
            const tierColor = TIER_COLORS[client.payment_tier] || 'text-slate-400 bg-slate-400/10'
            return (
              <div key={client.id} className="bg-[#1a1d27] border border-[#2a2d3e] rounded-xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-white">{client.name}</h3>
                    <p className="text-slate-400 text-sm">{client.email}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded font-medium ${tierColor}`}>
                    {client.payment_tier || 'Unknown tier'}
                  </span>
                </div>

                {brandDoc && (
                  <div className="space-y-2 mt-3 border-t border-[#2a2d3e] pt-3">
                    <p className="text-xs text-slate-500 uppercase tracking-wider">Brand Voice</p>
                    <p className="text-sm text-slate-300">{brandDoc.voice}</p>

                    {brandDoc.contentPillars && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {brandDoc.contentPillars.map((pillar: string, i: number) => (
                          <span key={i} className="text-xs bg-[#2a2d3e] text-slate-300 px-2 py-0.5 rounded">
                            {pillar}
                          </span>
                        ))}
                      </div>
                    )}

                    {brandDoc.whyBought && (
                      <div className="mt-2">
                        <p className="text-xs text-slate-500 uppercase tracking-wider">Why They Bought</p>
                        <p className="text-sm text-slate-300 mt-1">{brandDoc.whyBought}</p>
                      </div>
                    )}
                  </div>
                )}

                <p className="text-xs text-slate-500 mt-3">
                  Onboarded {new Date(client.onboarded_at).toLocaleDateString()}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
