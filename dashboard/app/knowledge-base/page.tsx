import KnowledgeBaseViewer from '@/components/KnowledgeBaseViewer'

export const dynamic = 'force-dynamic'

export default function KnowledgeBasePage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Knowledge Base</h1>
        <p className="text-slate-400 text-sm mt-1">
          All agent prompts, configs, and learnings. Click any value to edit inline.
        </p>
      </div>
      <KnowledgeBaseViewer />
    </div>
  )
}
