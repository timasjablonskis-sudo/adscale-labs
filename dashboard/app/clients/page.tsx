export const dynamic = 'force-dynamic'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientRow {
  id: number
  name: string
  email: string
  payment_tier: string | null
  monthly_rate: number | null
  onboarding_status: string | null
  brand_doc: string | null
  brand_doc_pdf_url: string | null
  onboarded_at: string
  engines_activated: string | null
  addons_activated: string | null
  reputation_engine: number | null
  priority_launch_channel: string | null
  phone: string | null
}

interface BrandDoc {
  client_profile?: {
    business_name?: string
    primary_pain_point?: string
    monthly_lead_volume?: string
    monthly_revenue_range?: string
    why_they_signed_up?: string
    owner_contact?: { name?: string; phone?: string }
    team_size?: { description?: string }
    locations?: Array<{ address?: string; hours?: string } | string>
  }
  system_blueprint?: {
    engines_activated?: string[]
    addons_activated?: string[]
    reputation_engine?: boolean
    priority_launch_channel?: string
    channel_rollout_plan?: Record<string, string[]>
    booking_system?: { platform?: string }
  }
  ai_personality?: {
    tone?: string
    voice_style?: string
    brand_vocabulary?: string[]
    never_say?: string[]
    greeting_template?: string
    closing_template?: string
  }
  treatment_knowledge_base?: {
    top_treatments?: string[]
    active_promotions?: string[]
    consultation_required?: string[]
  }
  competitive_positioning?: {
    competitors?: string[]
    client_unique_advantages?: string[]
    differentiators_for_ai_responses?: string
  }
  roi_projections?: {
    current_estimated_monthly_missed_leads?: number
    projected_monthly_revenue_recovery?: string
    months_to_roi?: string
  }
}

// ─── Data ─────────────────────────────────────────────────────────────────────

async function getClients(): Promise<ClientRow[]> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/api/clients`, { cache: 'no-store' })
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

// ─── Status Config ────────────────────────────────────────────────────────────

const STATUS_STEPS = [
  { key: 'form_sent',           label: 'Form Sent' },
  { key: 'form_submitted',      label: 'Form Submitted' },
  { key: 'brand_doc_generated', label: 'Blueprint Ready' },
  { key: 'building',            label: 'Building' },
  { key: 'channel_1_live',      label: 'Channel 1 Live' },
  { key: 'fully_live',          label: 'Fully Live' },
]

function StatusTracker({ status }: { status: string | null }) {
  const currentIdx = STATUS_STEPS.findIndex(s => s.key === status)

  return (
    <div className="flex items-center gap-0 mt-4 mb-1 overflow-x-auto pb-1">
      {STATUS_STEPS.map((step, i) => {
        const done    = i < currentIdx
        const active  = i === currentIdx
        const pending = i > currentIdx

        return (
          <div key={step.key} className="flex items-center">
            {/* Node */}
            <div className="flex flex-col items-center min-w-[70px]">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                done    ? 'bg-indigo-500 text-white' :
                active  ? 'bg-indigo-400 text-white ring-2 ring-indigo-400/40 ring-offset-2 ring-offset-[#1a1d27]' :
                          'bg-[#2a2d3e] text-slate-500'
              }`}>
                {done ? '✓' : i + 1}
              </div>
              <span className={`text-[9px] mt-1 text-center leading-tight ${
                active ? 'text-indigo-400 font-semibold' :
                done   ? 'text-slate-400' :
                         'text-slate-600'
              }`}>{step.label}</span>
            </div>
            {/* Connector */}
            {i < STATUS_STEPS.length - 1 && (
              <div className={`h-px w-6 flex-shrink-0 mb-4 ${i < currentIdx ? 'bg-indigo-500' : 'bg-[#2a2d3e]'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-[#2a2d3e] pt-4">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 font-semibold">{label}</p>
      {children}
    </div>
  )
}

function Tags({ items, color = 'default' }: { items: string[]; color?: 'default' | 'purple' | 'green' | 'red' }) {
  const cls = {
    default: 'bg-[#2a2d3e] text-slate-300',
    purple:  'bg-indigo-500/15 text-indigo-300',
    green:   'bg-emerald-500/15 text-emerald-300',
    red:     'bg-red-500/15 text-red-300',
  }[color]

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span key={i} className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{item}</span>
      ))}
    </div>
  )
}

function EngineChip({ label, active }: { label: string; active: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${
      active
        ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300'
        : 'border-[#2a2d3e] bg-[#2a2d3e]/40 text-slate-600'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? 'bg-emerald-400' : 'bg-slate-600'}`} />
      {label}
    </div>
  )
}

function RoiStat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3 text-center">
      <div className="text-lg font-bold text-indigo-400 leading-tight">{value}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
    </div>
  )
}

// ─── Client Card ──────────────────────────────────────────────────────────────

function ClientCard({ client }: { client: ClientRow }) {
  const doc: BrandDoc = client.brand_doc ? JSON.parse(client.brand_doc) : {}
  const bp   = doc.system_blueprint   || {}
  const ai   = doc.ai_personality     || {}
  const roi  = doc.roi_projections    || {}
  const tkb  = doc.treatment_knowledge_base || {}
  const comp = doc.competitive_positioning  || {}
  const prof = doc.client_profile     || {}

  const engines  = bp.engines_activated  || []
  const addons   = bp.addons_activated   || []
  const rollout  = bp.channel_rollout_plan || {}

  const isLive    = client.onboarding_status === 'fully_live' || client.onboarding_status === 'channel_1_live'
  const hasBrandDoc = !!client.brand_doc

  const monthlyRateDisplay = client.monthly_rate
    ? `$${(client.monthly_rate / 100).toLocaleString()}/mo`
    : null

  return (
    <div className="bg-[#1a1d27] border border-[#2a2d3e] rounded-xl p-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-white text-lg leading-tight truncate">
              {prof.business_name || client.name}
            </h3>
            {isLive && (
              <span className="flex items-center gap-1 text-[10px] bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full font-semibold flex-shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE
              </span>
            )}
          </div>
          <p className="text-slate-400 text-sm mt-0.5">{client.email}</p>
          {client.phone && <p className="text-slate-500 text-xs mt-0.5">{client.phone}</p>}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {client.payment_tier && (
            <span className="text-xs px-2 py-1 rounded bg-[#2a2d3e] text-slate-300 font-medium">
              {client.payment_tier}
            </span>
          )}
          {monthlyRateDisplay && (
            <span className="text-xs text-indigo-400 font-semibold">{monthlyRateDisplay}</span>
          )}
        </div>
      </div>

      {/* ── Onboarding Status Tracker ── */}
      <StatusTracker status={client.onboarding_status} />
      <p className="text-[10px] text-slate-600 mt-0.5">
        Onboarded {new Date(client.onboarded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </p>

      {/* ── No brand doc yet ── */}
      {!hasBrandDoc && (
        <div className="mt-4 bg-[#0f1117] border border-dashed border-[#2a2d3e] rounded-lg p-4 text-center">
          <p className="text-slate-500 text-sm">
            {client.onboarding_status === 'form_sent'
              ? 'Waiting for client to submit intake form.'
              : 'Blueprint pending generation.'}
          </p>
        </div>
      )}

      {/* ── Brand Doc sections ── */}
      {hasBrandDoc && (
        <>
          {/* System Blueprint */}
          <Section label="System Configuration">
            <div className="grid grid-cols-2 gap-2 mb-3">
              <EngineChip label="Engine A: Omni-Channel" active={engines.includes('Engine A')} />
              <EngineChip label="Engine B: Voice AI"     active={engines.includes('Engine B')} />
            </div>
            {addons.length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] text-slate-600 mb-1.5">Add-ons</p>
                <Tags items={addons} color="purple" />
              </div>
            )}
            {bp.reputation_engine && (
              <div className="mt-2">
                <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full">
                  + Reputation Response Engine
                </span>
              </div>
            )}
            {bp.priority_launch_channel && (
              <p className="text-xs text-slate-400 mt-2">
                Priority launch: <span className="text-white font-medium">{bp.priority_launch_channel}</span>
              </p>
            )}
            {bp.booking_system?.platform && (
              <p className="text-xs text-slate-500 mt-1">
                Booking system: <span className="text-slate-300">{bp.booking_system.platform}</span>
              </p>
            )}
          </Section>

          {/* Channel Rollout */}
          {Object.keys(rollout).some(k => (rollout[k] || []).length > 0) && (
            <Section label="Channel Rollout">
              <div className="space-y-1">
                {Object.entries(rollout).map(([week, channels]) =>
                  channels.length > 0 ? (
                    <div key={week} className="flex items-baseline gap-2 text-xs">
                      <span className="text-slate-600 uppercase tracking-wide font-medium w-14 flex-shrink-0">
                        {week.replace('_', ' ')}
                      </span>
                      <span className="text-slate-300">{channels.join(', ')}</span>
                    </div>
                  ) : null
                )}
              </div>
            </Section>
          )}

          {/* AI Personality */}
          {(ai.tone || ai.greeting_template) && (
            <Section label="AI Personality">
              {ai.tone && (
                <p className="text-xs text-slate-400 mb-2">
                  Tone: <span className="text-indigo-400 font-medium">{ai.tone}</span>
                  {ai.voice_style && <span className="text-slate-500"> — {ai.voice_style}</span>}
                </p>
              )}
              {ai.greeting_template && (
                <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 mb-2">
                  <p className="text-[10px] text-slate-600 mb-1">Sample greeting</p>
                  <p className="text-xs text-slate-300 italic">"{ai.greeting_template}"</p>
                </div>
              )}
              {ai.brand_vocabulary && ai.brand_vocabulary.length > 0 && (
                <div className="mb-2">
                  <p className="text-[10px] text-slate-600 mb-1">Brand vocabulary</p>
                  <Tags items={ai.brand_vocabulary} color="default" />
                </div>
              )}
              {ai.never_say && ai.never_say.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-600 mb-1">Never say</p>
                  <Tags items={ai.never_say} color="red" />
                </div>
              )}
            </Section>
          )}

          {/* Treatments */}
          {(tkb.top_treatments?.length || tkb.active_promotions?.length) ? (
            <Section label="Treatment Highlights">
              {tkb.top_treatments && tkb.top_treatments.length > 0 && (
                <div className="mb-2">
                  <p className="text-[10px] text-slate-600 mb-1">Top revenue treatments</p>
                  <Tags items={tkb.top_treatments} color="default" />
                </div>
              )}
              {tkb.active_promotions && tkb.active_promotions.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-600 mb-1">Active promotions</p>
                  <ul className="space-y-0.5">
                    {tkb.active_promotions.map((p, i) => (
                      <li key={i} className="text-xs text-slate-300 flex gap-1.5">
                        <span className="text-emerald-500 mt-0.5 flex-shrink-0">→</span>{p}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          ) : null}

          {/* Competitive Positioning */}
          {comp.client_unique_advantages?.length ? (
            <Section label="Competitive Positioning">
              {comp.competitors && comp.competitors.length > 0 && (
                <p className="text-xs text-slate-500 mb-2">
                  Monitoring: {comp.competitors.join(', ')}
                </p>
              )}
              <ul className="space-y-1">
                {comp.client_unique_advantages.map((a, i) => (
                  <li key={i} className="text-xs text-slate-300 flex gap-1.5">
                    <span className="text-indigo-400 mt-0.5 flex-shrink-0">▸</span>{a}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {/* ROI Projections */}
          {(roi.projected_monthly_revenue_recovery || roi.months_to_roi) && (
            <Section label="ROI Projections">
              <div className="grid grid-cols-3 gap-2">
                <RoiStat
                  value={roi.current_estimated_monthly_missed_leads ?? '—'}
                  label="Missed leads/mo"
                />
                <RoiStat
                  value={roi.projected_monthly_revenue_recovery || '—'}
                  label="Projected recovery"
                />
                <RoiStat
                  value={roi.months_to_roi || '—'}
                  label="Time to ROI"
                />
              </div>
            </Section>
          )}

          {/* Brand Doc PDF link */}
          {client.brand_doc_pdf_url && (
            <Section label="Blueprint Document">
              <a
                href={`${process.env.NEXT_PUBLIC_API_BASE}${client.brand_doc_pdf_url}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 px-3 py-1.5 rounded-lg border border-indigo-500/20 transition-colors"
              >
                <span>↗</span>
                View Brand Document PDF
              </a>
            </Section>
          )}
        </>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ClientsPage() {
  const clients = await getClients()

  const byStatus = {
    live:        clients.filter(c => c.onboarding_status === 'fully_live' || c.onboarding_status === 'channel_1_live'),
    inProgress:  clients.filter(c => ['building', 'brand_doc_generated', 'form_submitted'].includes(c.onboarding_status || '')),
    pending:     clients.filter(c => c.onboarding_status === 'form_sent' || !c.onboarding_status),
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Client Roster</h1>
          <p className="text-slate-400 text-sm mt-1">
            {clients.length} {clients.length === 1 ? 'client' : 'clients'}
            {byStatus.live.length > 0 && (
              <span className="ml-2 text-emerald-400">· {byStatus.live.length} live</span>
            )}
          </p>
        </div>
      </div>

      {clients.length === 0 ? (
        <div className="bg-[#1a1d27] border border-[#2a2d3e] rounded-xl p-10 text-center">
          <p className="text-slate-400 text-sm">No clients yet.</p>
          <p className="text-slate-600 text-xs mt-1">Cleo creates a record when a Stripe payment comes in.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Live */}
          {byStatus.live.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-emerald-400 uppercase tracking-widest mb-3">
                Live Systems ({byStatus.live.length})
              </h2>
              <div className="space-y-4">
                {byStatus.live.map(c => <ClientCard key={c.id} client={c} />)}
              </div>
            </div>
          )}

          {/* In progress */}
          {byStatus.inProgress.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mb-3">
                In Progress ({byStatus.inProgress.length})
              </h2>
              <div className="space-y-4">
                {byStatus.inProgress.map(c => <ClientCard key={c.id} client={c} />)}
              </div>
            </div>
          )}

          {/* Pending intake */}
          {byStatus.pending.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
                Awaiting Intake ({byStatus.pending.length})
              </h2>
              <div className="space-y-4">
                {byStatus.pending.map(c => <ClientCard key={c.id} client={c} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
