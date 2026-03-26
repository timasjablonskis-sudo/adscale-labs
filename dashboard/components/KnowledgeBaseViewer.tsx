'use client'

import { useEffect, useState, useCallback } from 'react'
import { Save, ChevronDown, ChevronRight, Edit3, Check } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001'

interface KBEntry {
  id: number
  category: string
  key: string
  value: string
  updated_at: string
}

function KBEntryRow({ entry, onSave }: { entry: KBEntry; onSave: (id: number, value: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(entry.value)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Try to pretty-print JSON values
  const displayValue = (() => {
    try { return JSON.stringify(JSON.parse(value), null, 2) }
    catch { return value }
  })()

  const isJSON = (() => {
    try { JSON.parse(value); return true } catch { return false }
  })()

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(entry.id, value)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-b border-[#2a2d3e] last:border-0">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex-1 min-w-0">
          <span className="text-sm text-slate-300 font-mono">{entry.key}</span>
          <span className="text-xs text-slate-600 ml-3">{new Date(entry.updated_at).toLocaleDateString()}</span>
        </div>
        <button
          onClick={() => setEditing(!editing)}
          className="text-slate-500 hover:text-slate-300 ml-2 p-1 rounded hover:bg-[#2a2d3e]"
        >
          <Edit3 size={13} />
        </button>
      </div>

      {!editing ? (
        <div className="px-4 pb-3">
          <p className={`text-xs text-slate-500 font-mono whitespace-pre-wrap ${isJSON && value.length > 200 ? 'max-h-24 overflow-y-auto' : ''}`}>
            {displayValue.substring(0, 400)}{displayValue.length > 400 ? '...' : ''}
          </p>
        </div>
      ) : (
        <div className="px-4 pb-3">
          <textarea
            value={value}
            onChange={e => setValue(e.target.value)}
            rows={isJSON ? 8 : 4}
            className="w-full bg-[#0f1117] border border-[#3a3d5e] rounded-lg p-3 text-xs text-slate-300 font-mono resize-y focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className={`mt-2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded ${
              saved
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30'
            }`}
          >
            {saved ? <Check size={12} /> : <Save size={12} />}
            {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}

function CategorySection({ category, entries, onSave }: {
  category: string
  entries: KBEntry[]
  onSave: (id: number, value: string) => Promise<void>
}) {
  const [open, setOpen] = useState(category === 'prompts' || category === 'config')

  const CATEGORY_COLORS: Record<string, string> = {
    prompts: 'text-violet-400',
    config: 'text-blue-400',
    scout: 'text-green-400',
    performance: 'text-amber-400',
    reports: 'text-slate-400',
    marketing: 'text-pink-400',
    optimizer: 'text-indigo-400',
  }

  return (
    <div className="bg-[#1a1d27] border border-[#2a2d3e] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#22253a] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={`font-mono text-sm font-medium ${CATEGORY_COLORS[category] || 'text-slate-300'}`}>
            {category}
          </span>
          <span className="text-xs text-slate-600 bg-[#2a2d3e] px-1.5 py-0.5 rounded">
            {entries.length}
          </span>
        </div>
        {open ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
      </button>
      {open && entries.map(entry => (
        <KBEntryRow key={entry.id} entry={entry} onSave={onSave} />
      ))}
    </div>
  )
}

export default function KnowledgeBaseViewer() {
  const [entries, setEntries] = useState<KBEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/knowledge-base`, { cache: 'no-store' })
      if (res.ok) setEntries(await res.json())
    } catch (err) {
      console.error('Failed to fetch KB:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchEntries() }, [fetchEntries])

  const handleSave = async (id: number, value: string) => {
    await fetch(`${API_BASE}/api/knowledge-base/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    })
    setEntries(prev => prev.map(e => e.id === id ? { ...e, value, updated_at: new Date().toISOString() } : e))
  }

  const filtered = filter
    ? entries.filter(e => e.key.includes(filter) || e.category.includes(filter) || e.value.includes(filter))
    : entries

  // Group by category
  const grouped = filtered.reduce((acc, entry) => {
    if (!acc[entry.category]) acc[entry.category] = []
    acc[entry.category].push(entry)
    return acc
  }, {} as Record<string, KBEntry[]>)

  if (loading) {
    return <div className="bg-[#1a1d27] border border-[#2a2d3e] rounded-xl h-96 animate-pulse" />
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        placeholder="Search keys, values, categories..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        className="w-full bg-[#1a1d27] border border-[#2a2d3e] rounded-xl px-4 py-2.5 text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
      />
      <p className="text-xs text-slate-600">{filtered.length} entries · Inline editable · Optimizer rewrites prompts weekly</p>
      {Object.entries(grouped).map(([cat, catEntries]) => (
        <CategorySection key={cat} category={cat} entries={catEntries} onSave={handleSave} />
      ))}
    </div>
  )
}
