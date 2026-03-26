import LeadKanban from '@/components/LeadKanban'

export const dynamic = 'force-dynamic'

export default function LeadsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Lead Pipeline</h1>
        <p className="text-slate-400 text-sm mt-1">Drag cards to update lead status</p>
      </div>
      <LeadKanban />
    </div>
  )
}
