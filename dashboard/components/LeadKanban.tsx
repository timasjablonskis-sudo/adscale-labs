'use client'

import { useEffect, useState, useCallback } from 'react'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { Mail, Instagram, Calendar, ChevronRight } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001'

interface Lead {
  id: number
  name: string
  email: string
  ig_handle: string | null
  source: string | null
  qualified: number
  booked: number
  outcome: string | null
  call_date: string | null
  created_at: string
  follow_up_count: number
}

type Column = 'new' | 'qualified' | 'booked' | 'closed'

const COLUMNS: { id: Column; label: string; color: string }[] = [
  { id: 'new', label: 'New Leads', color: 'border-slate-500' },
  { id: 'qualified', label: 'Qualified', color: 'border-blue-500' },
  { id: 'booked', label: 'Booked', color: 'border-indigo-500' },
  { id: 'closed', label: 'Closed', color: 'border-green-500' },
]

function getColumn(lead: Lead): Column {
  if (lead.outcome === 'won' || lead.outcome === 'lost') return 'closed'
  if (lead.booked) return 'booked'
  if (lead.qualified) return 'qualified'
  return 'new'
}

function LeadCard({ lead, index }: { lead: Lead; index: number }) {
  const daysAgo = Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86400000)
  return (
    <Draggable draggableId={String(lead.id)} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`bg-[#22253a] border rounded-lg p-3 mb-2 transition-shadow ${
            snapshot.isDragging ? 'border-indigo-500/50 shadow-lg shadow-indigo-500/10' : 'border-[#2a2d3e]'
          }`}
        >
          <div className="flex items-start justify-between">
            <p className="font-medium text-white text-sm">{lead.name}</p>
            {lead.outcome === 'won' && <span className="text-xs text-green-400">Won</span>}
            {lead.outcome === 'lost' && <span className="text-xs text-red-400">Lost</span>}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="flex items-center gap-1 text-xs text-slate-400">
              <Mail size={10} /> {lead.email}
            </span>
          </div>
          {lead.ig_handle && (
            <span className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
              <Instagram size={10} /> {lead.ig_handle}
            </span>
          )}
          {lead.call_date && (
            <span className="flex items-center gap-1 text-xs text-indigo-400 mt-1">
              <Calendar size={10} /> {new Date(lead.call_date).toLocaleDateString()}
            </span>
          )}
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-slate-600">{lead.source}</span>
            <span className="text-xs text-slate-600">{daysAgo === 0 ? 'today' : `${daysAgo}d ago`}</span>
          </div>
          {lead.follow_up_count > 0 && (
            <div className="mt-1 flex gap-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full ${i < lead.follow_up_count ? 'bg-indigo-500' : 'bg-[#2a2d3e]'}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Draggable>
  )
}

export default function LeadKanban() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)

  const fetchLeads = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/leads?limit=200`, { cache: 'no-store' })
      if (res.ok) setLeads(await res.json())
    } catch (err) {
      console.error('Failed to fetch leads:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchLeads() }, [fetchLeads])

  const onDragEnd = async (result: DropResult) => {
    if (!result.destination) return
    const { draggableId, destination } = result
    const leadId = parseInt(draggableId)
    const targetColumn = destination.droppableId as Column

    // Optimistically update UI
    setLeads(prev => prev.map(l => {
      if (l.id !== leadId) return l
      const updated = { ...l }
      updated.qualified = targetColumn !== 'new' ? 1 : 0
      updated.booked = targetColumn === 'booked' || targetColumn === 'closed' ? 1 : 0
      if (targetColumn === 'closed' && !updated.outcome) updated.outcome = 'won'
      return updated
    }))

    // Persist to server
    const body: any = {}
    if (targetColumn === 'new') { body.qualified = 0; body.booked = 0 }
    if (targetColumn === 'qualified') { body.qualified = 1; body.booked = 0 }
    if (targetColumn === 'booked') { body.qualified = 1; body.booked = 1 }
    if (targetColumn === 'closed') { body.qualified = 1; body.booked = 1; body.outcome = 'won' }

    try {
      await fetch(`${API_BASE}/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (err) {
      console.error('Failed to update lead:', err)
      fetchLeads() // Re-fetch on error to restore correct state
    }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-4 gap-4">
        {COLUMNS.map(col => (
          <div key={col.id} className="bg-[#1a1d27] border border-[#2a2d3e] rounded-xl p-4 h-96 animate-pulse" />
        ))}
      </div>
    )
  }

  const grouped = COLUMNS.reduce((acc, col) => {
    acc[col.id] = leads.filter(l => getColumn(l) === col.id)
    return acc
  }, {} as Record<Column, Lead[]>)

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="grid grid-cols-4 gap-4">
        {COLUMNS.map(col => (
          <div key={col.id} className={`bg-[#1a1d27] border-t-2 ${col.color} rounded-xl`}>
            <div className="px-4 py-3 border-b border-[#2a2d3e] flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">{col.label}</span>
              <span className="text-xs bg-[#2a2d3e] text-slate-400 px-2 py-0.5 rounded-full">
                {grouped[col.id].length}
              </span>
            </div>
            <Droppable droppableId={col.id}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`p-3 min-h-[400px] transition-colors ${snapshot.isDraggingOver ? 'bg-indigo-500/5' : ''}`}
                >
                  {grouped[col.id].map((lead, index) => (
                    <LeadCard key={lead.id} lead={lead} index={index} />
                  ))}
                  {provided.placeholder}
                  {grouped[col.id].length === 0 && !snapshot.isDraggingOver && (
                    <div className="flex flex-col items-center justify-center h-32 text-slate-600">
                      <ChevronRight size={20} className="mb-1 opacity-30" />
                      <p className="text-xs">Drop leads here</p>
                    </div>
                  )}
                </div>
              )}
            </Droppable>
          </div>
        ))}
      </div>
    </DragDropContext>
  )
}
