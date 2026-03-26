/**
 * Dashboard home page — shows Today's Scripts + Agent Status at a glance.
 */
import ScriptCard from '@/components/ScriptCard'
import AgentStatus from '@/components/AgentStatus'

export const dynamic = 'force-dynamic'

async function getTodaysScripts() {
  const today = new Date().toISOString().split('T')[0]
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/api/scripts?date=${today}&limit=5`, { cache: 'no-store' })
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

export default async function HomePage() {
  const scripts = await getTodaysScripts()

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">AdScale Labs</h1>
          <p className="text-slate-400 text-sm mt-1">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500 uppercase tracking-widest">System Status</div>
          <div className="text-green-400 font-medium text-sm flex items-center gap-1 justify-end mt-1">
            <span className="w-2 h-2 bg-green-400 rounded-full inline-block animate-pulse" />
            All Systems Running
          </div>
        </div>
      </div>

      {/* Today's Scripts */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Today&apos;s Scripts</h2>
          <span className="text-xs text-slate-500 bg-[#1a1d27] px-2 py-1 rounded">
            {scripts.length} / 5 generated
          </span>
        </div>

        {scripts.length === 0 ? (
          <div className="bg-[#1a1d27] border border-[#2a2d3e] rounded-xl p-8 text-center">
            <p className="text-slate-400">No scripts generated yet today.</p>
            <p className="text-slate-500 text-sm mt-1">Scripter runs at 7:00 AM daily.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {scripts.map((script: any) => (
              <ScriptCard key={script.id} script={script} />
            ))}
          </div>
        )}
      </section>

      {/* Agent Status */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Agent Status</h2>
        <AgentStatus />
      </section>
    </div>
  )
}
