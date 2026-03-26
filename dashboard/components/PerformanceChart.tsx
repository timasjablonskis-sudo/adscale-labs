'use client'

import { useEffect, useState } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import { TrendingUp } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001'

interface DayData {
  date: string
  views: number
  likes: number
  saves: number
  shares: number
  script_count: number
  top_hook: string | null
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#1a1d27] border border-[#2a2d3e] rounded-lg p-3 text-xs shadow-xl">
      <p className="text-slate-300 font-medium mb-2">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {p.value?.toLocaleString()}
        </p>
      ))}
    </div>
  )
}

export default function PerformanceChart() {
  const [data, setData] = useState<DayData[]>([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(14)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/performance?days=${days}`, { cache: 'no-store' })
        if (res.ok) setData(await res.json())
      } catch (err) {
        console.error('Failed to fetch performance data:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [days])

  const totalSaves = data.reduce((s, d) => s + (d.saves || 0), 0)
  const totalViews = data.reduce((s, d) => s + (d.views || 0), 0)
  const avgSaveRate = totalViews > 0 ? ((totalSaves / totalViews) * 100).toFixed(2) : '0'

  const shortDate = (d: string) => {
    const [, m, day] = d.split('-')
    return `${m}/${day}`
  }

  if (loading) {
    return <div className="bg-[#1a1d27] border border-[#2a2d3e] rounded-xl h-80 animate-pulse" />
  }

  if (data.length === 0) {
    return (
      <div className="bg-[#1a1d27] border border-[#2a2d3e] rounded-xl p-8 text-center">
        <TrendingUp size={32} className="mx-auto text-slate-600 mb-2" />
        <p className="text-slate-400">No performance data yet.</p>
        <p className="text-slate-500 text-sm mt-1">Analyst runs nightly after content is posted.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Views', value: totalViews.toLocaleString() },
          { label: 'Total Saves', value: totalSaves.toLocaleString() },
          { label: 'Save Rate', value: `${avgSaveRate}%` },
        ].map(stat => (
          <div key={stat.label} className="bg-[#1a1d27] border border-[#2a2d3e] rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider">{stat.label}</p>
            <p className="text-2xl font-bold text-white mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Period selector */}
      <div className="flex gap-2">
        {[7, 14, 30].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`text-xs px-3 py-1 rounded ${days === d ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-[#1a1d27] text-slate-400 border border-[#2a2d3e] hover:border-slate-500'}`}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* Saves + Views line chart */}
      <div className="bg-[#1a1d27] border border-[#2a2d3e] rounded-xl p-5">
        <h3 className="text-sm font-medium text-slate-300 mb-4">Saves & Views Over Time</h3>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data.map(d => ({ ...d, date: shortDate(d.date) }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" />
            <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: '12px', color: '#9ca3af' }} />
            <Line type="monotone" dataKey="saves" stroke="#6366f1" strokeWidth={2} dot={false} name="Saves" />
            <Line type="monotone" dataKey="views" stroke="#22c55e" strokeWidth={2} dot={false} name="Views" strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Daily save breakdown bar chart */}
      <div className="bg-[#1a1d27] border border-[#2a2d3e] rounded-xl p-5">
        <h3 className="text-sm font-medium text-slate-300 mb-4">Engagement Breakdown</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data.map(d => ({ ...d, date: shortDate(d.date) }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" />
            <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: '12px', color: '#9ca3af' }} />
            <Bar dataKey="saves" fill="#6366f1" name="Saves" radius={[2, 2, 0, 0]} />
            <Bar dataKey="shares" fill="#8b5cf6" name="Shares" radius={[2, 2, 0, 0]} />
            <Bar dataKey="likes" fill="#22c55e" name="Likes" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
