'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, Clock, RefreshCw } from 'lucide-react'

const AGENT_META: Record<string, { label: string; schedule: string; emoji: string }> = {
  'scout': { label: 'Scout', schedule: '6:00 AM daily', emoji: '🔍' },
  'scripter': { label: 'Scripter', schedule: '7:00 AM daily', emoji: '✍️' },
  'larry-sdr': { label: 'Larry SDR', schedule: 'On lead + 9/5 PM', emoji: '📞' },
  'analyst': { label: 'Analyst', schedule: '8:00 PM daily', emoji: '📊' },
  'cleo-onboarding': { label: 'Cleo', schedule: 'On payment', emoji: '🤝' },
  'optimizer': { label: 'Optimizer', schedule: 'Sunday midnight', emoji: '⚡' },
}

interface AgentLog {
  agent_name: string
  run_at: string
  status: 'success' | 'error' | 'dry_run'
  output_summary: string
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'success') return (
    <span className="flex items-center gap-1 text-green-400 text-xs">
      <CheckCircle2 size={12} /> OK
    </span>
  )
  if (status === 'error') return (
    <span className="flex items-center gap-1 text-red-400 text-xs">
      <XCircle size={12} /> Error
    </span>
  )
  return (
    <span className="flex items-center gap-1 text-slate-400 text-xs">
      <Clock size={12} /> Dry run
    </span>
  )
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function AgentStatus() {
  const [agents, setAgents] = useState<AgentLog[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  const fetchAgents = async () => {
    try {
      const base = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001'
      const res = await fetch(`${base}/api/agents`, { cache: 'no-store' })
      if (res.ok) {
        setAgents(await res.json())
        setLastRefresh(new Date())
      }
    } catch (err) {
      console.error('Failed to fetch agent status:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAgents()
    const interval = setInterval(fetchAgents, 30000) // Refresh every 30 seconds
    return () => clearInterval(interval)
  }, [])

  // Build a complete list including agents that may not have run yet
  const agentMap = new Map(agents.map(a => [a.agent_name, a]))
  const allAgents = Object.keys(AGENT_META).map(key => ({
    key,
    log: agentMap.get(key) || null,
    ...AGENT_META[key],
  }))

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {Object.keys(AGENT_META).map(key => (
          <div key={key} className="bg-[#1a1d27] border border-[#2a2d3e] rounded-xl p-4 animate-pulse h-24" />
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {allAgents.map(({ key, label, schedule, emoji, log }) => (
          <div key={key} className={`bg-[#1a1d27] border rounded-xl p-4 ${
            log?.status === 'error' ? 'border-red-500/30' : 'border-[#2a2d3e]'
          }`}>
            <div className="flex items-start justify-between">
              <div>
                <span className="text-lg">{emoji}</span>
                <p className="font-medium text-white text-sm mt-1">{label}</p>
              </div>
              {log ? <StatusBadge status={log.status} /> : (
                <span className="text-xs text-slate-600">Never run</span>
              )}
            </div>
            {log && (
              <p className="text-xs text-slate-500 mt-2">{timeAgo(log.run_at)}</p>
            )}
            <p className="text-xs text-slate-600 mt-1">{schedule}</p>
            {log?.output_summary && (
              <p className="text-xs text-slate-400 mt-2 line-clamp-2">{log.output_summary}</p>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-600 mt-3 text-right flex items-center justify-end gap-1">
        <RefreshCw size={10} />
        Refreshes every 30s · Last: {lastRefresh.toLocaleTimeString()}
      </p>
    </div>
  )
}
