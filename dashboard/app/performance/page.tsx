import PerformanceChart from '@/components/PerformanceChart'

export const dynamic = 'force-dynamic'

export default function PerformancePage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Content Performance</h1>
        <p className="text-slate-400 text-sm mt-1">Reel metrics updated nightly by Analyst</p>
      </div>
      <PerformanceChart />
    </div>
  )
}
