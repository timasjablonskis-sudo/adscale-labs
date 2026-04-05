'use client'

import { useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4

interface FormData {
  // Step 1 — Business Info
  business_name: string
  owner_name: string
  owner_email: string
  owner_phone: string
  business_address: string
  business_hours: string
  team_structure: string
  monthly_lead_volume: string
  monthly_revenue_range: string
  biggest_pain: string
  why_signed_up: string
  // Step 2 — Services & Pricing
  treatment_menu: string
  top_treatments: string
  active_promotions: string
  consultation_required_treatments: string
  screening_questions_text: string
  // Step 3 — Tech & Channels
  booking_system_platform: string
  booking_system_other: string
  active_channels: string[]
  business_phone_numbers: string
  instagram_handle: string
  facebook_page: string
  website_url: string
  google_business_url: string
  competitor_names: string
  ai_tone: string
  ai_restrictions: string
  // Step 4 — System Scoping
  engines_selected: string[]
  addons_selected: string[]
  reputation_engine_selected: string
  priority_launch_channel: string
}

const EMPTY: FormData = {
  business_name: '', owner_name: '', owner_email: '', owner_phone: '',
  business_address: '', business_hours: '', team_structure: '',
  monthly_lead_volume: '', monthly_revenue_range: '', biggest_pain: '', why_signed_up: '',
  treatment_menu: '', top_treatments: '', active_promotions: '',
  consultation_required_treatments: '', screening_questions_text: '',
  booking_system_platform: '', booking_system_other: '',
  active_channels: [], business_phone_numbers: '',
  instagram_handle: '', facebook_page: '', website_url: '',
  google_business_url: '', competitor_names: '', ai_tone: '', ai_restrictions: '',
  engines_selected: [], addons_selected: [],
  reputation_engine_selected: '', priority_launch_channel: '',
}

const CHANNELS   = ['Instagram DMs', 'Facebook Messenger', 'Website Chat', 'SMS', 'Email', 'Phone']
const ADDONS     = ['Lead Re-engagement', 'No-Show Recovery', 'Smart Reminder Suite', 'Database Reactivation', 'Treatment Cycle Automation (Botox Clock)', 'Review Generation']
const TONES      = ['Warm & friendly', 'Professional & clinical', 'Luxury & exclusive', 'Match my social media style']
const BOOKING    = ['Mindbody', 'Vagaro', 'Zenoti', 'GlossGenius', 'Mangomint', 'Phone only', 'Other']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toggle(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]
}

// ─── UI primitives ────────────────────────────────────────────────────────────

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-sm font-medium text-slate-300 mb-1.5">
      {children}{required && <span className="text-indigo-400 ml-0.5">*</span>}
    </label>
  )
}

function Input({ value, onChange, placeholder, type = 'text' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
    />
  )
}

function Textarea({ value, onChange, placeholder, rows = 3 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
    />
  )
}

function CheckboxGroup({ options, selected, onChange }: {
  options: string[]; selected: string[]; onChange: (v: string[]) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => {
        const active = selected.includes(opt)
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(toggle(selected, opt))}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              active
                ? 'border-indigo-500 bg-indigo-500/15 text-indigo-300'
                : 'border-[#2a2d3e] bg-[#0f1117] text-slate-400 hover:border-slate-500'
            }`}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}

function RadioGroup({ options, value, onChange }: {
  options: string[]; value: string; onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => {
        const active = value === opt
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              active
                ? 'border-indigo-500 bg-indigo-500/15 text-indigo-300'
                : 'border-[#2a2d3e] bg-[#0f1117] text-slate-400 hover:border-slate-500'
            }`}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <Label required={required}>{label}</Label>
      {children}
    </div>
  )
}

// ─── Step components ──────────────────────────────────────────────────────────

function Step1({ data, set }: { data: FormData; set: (k: keyof FormData, v: any) => void }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Business name" required>
          <Input value={data.business_name} onChange={v => set('business_name', v)} placeholder="Glow & Grace Med Spa" />
        </Field>
        <Field label="Your name" required>
          <Input value={data.owner_name} onChange={v => set('owner_name', v)} placeholder="Sarah Chen" />
        </Field>
        <Field label="Email address" required>
          <Input value={data.owner_email} onChange={v => set('owner_email', v)} placeholder="sarah@yourspa.com" type="email" />
        </Field>
        <Field label="Phone number" required>
          <Input value={data.owner_phone} onChange={v => set('owner_phone', v)} placeholder="+1 (312) 555-0100" />
        </Field>
      </div>
      <Field label="Business address">
        <Input value={data.business_address} onChange={v => set('business_address', v)} placeholder="500 N Michigan Ave, Chicago IL 60611" />
      </Field>
      <Field label="Hours of operation">
        <Input value={data.business_hours} onChange={v => set('business_hours', v)} placeholder="Mon–Fri 9am–7pm, Sat 10am–5pm" />
      </Field>
      <Field label="Team structure">
        <Input value={data.team_structure} onChange={v => set('team_structure', v)} placeholder="2 injectors, 1 esthetician, 1 front desk" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Monthly lead volume">
          <Input value={data.monthly_lead_volume} onChange={v => set('monthly_lead_volume', v)} placeholder="~120 inquiries/month" />
        </Field>
        <Field label="Monthly revenue range" required>
          <Input value={data.monthly_revenue_range} onChange={v => set('monthly_revenue_range', v)} placeholder="$80K–$120K/month" />
        </Field>
      </div>
      <Field label="Biggest operational pain point" required>
        <Textarea value={data.biggest_pain} onChange={v => set('biggest_pain', v)} placeholder="What's costing you the most right now? Missed calls, no-shows, slow follow-up..." rows={3} />
      </Field>
      <Field label="Why did you sign up with AdScale?" required>
        <Textarea value={data.why_signed_up} onChange={v => set('why_signed_up', v)} placeholder="What specifically convinced you to move forward?" rows={3} />
      </Field>
    </div>
  )
}

function Step2({ data, set }: { data: FormData; set: (k: keyof FormData, v: any) => void }) {
  return (
    <div className="space-y-5">
      <Field label="Full treatment / service menu" required>
        <Textarea
          value={data.treatment_menu}
          onChange={v => set('treatment_menu', v)}
          placeholder={"Botox $12/unit\nJuvederm lips $650\nHydraFacial $199\nLaser hair removal from $199/session\nCoolSculpting consult + treatment from $750"}
          rows={7}
        />
        <p className="text-xs text-slate-600 mt-1">List every service you offer with pricing. One per line is easiest.</p>
      </Field>
      <Field label="Top 3 revenue-driving treatments" required>
        <Input value={data.top_treatments} onChange={v => set('top_treatments', v)} placeholder="Botox, Juvederm lips, HydraFacial" />
      </Field>
      <Field label="Current promotions or packages">
        <Textarea value={data.active_promotions} onChange={v => set('active_promotions', v)} placeholder="New client 15% off first Botox. Summer skin package: HydraFacial + LED $249." rows={3} />
      </Field>
      <Field label="Which treatments require a consultation before booking?">
        <Input value={data.consultation_required_treatments} onChange={v => set('consultation_required_treatments', v)} placeholder="CoolSculpting, laser hair removal" />
      </Field>
      <Field label="Screening notes">
        <Textarea value={data.screening_questions_text} onChange={v => set('screening_questions_text', v)} placeholder={"Botox: ask about pregnancy, prior reactions.\nLaser: Fitzpatrick skin type, current medications."} rows={3} />
        <p className="text-xs text-slate-600 mt-1">Anything the AI must ask or check before booking certain treatments.</p>
      </Field>
    </div>
  )
}

function Step3({ data, set }: { data: FormData; set: (k: keyof FormData, v: any) => void }) {
  const needsVoice = data.engines_selected.includes('Engine B: Omni Voice Receptionist')
  const needsText  = data.engines_selected.includes('Engine A: Omni-Channel Concierge') || data.engines_selected.length === 0
  const needsRep   = data.reputation_engine_selected === 'Yes'

  return (
    <div className="space-y-5">
      <Field label="Booking system" required>
        <RadioGroup
          options={BOOKING}
          value={data.booking_system_platform}
          onChange={v => set('booking_system_platform', v)}
        />
        {data.booking_system_platform === 'Other' && (
          <div className="mt-2">
            <Input value={data.booking_system_other} onChange={v => set('booking_system_other', v)} placeholder="Which system?" />
          </div>
        )}
      </Field>
      <Field label="Which channels do you currently receive leads on?" required>
        <CheckboxGroup options={CHANNELS} selected={data.active_channels} onChange={v => set('active_channels', v)} />
      </Field>
      <Field label="Business phone number(s)">
        <Input value={data.business_phone_numbers} onChange={v => set('business_phone_numbers', v)} placeholder="+1 (312) 555-0100" />
      </Field>
      {needsText && (
        <>
          <Field label="Instagram handle">
            <Input value={data.instagram_handle} onChange={v => set('instagram_handle', v)} placeholder="@glowandgracespa" />
          </Field>
          <Field label="Facebook page name">
            <Input value={data.facebook_page} onChange={v => set('facebook_page', v)} placeholder="Glow & Grace Med Spa" />
          </Field>
          <Field label="Website URL">
            <Input value={data.website_url} onChange={v => set('website_url', v)} placeholder="https://glowandgrace.com" />
          </Field>
        </>
      )}
      {needsRep && (
        <Field label="Google Business Profile URL">
          <Input value={data.google_business_url} onChange={v => set('google_business_url', v)} placeholder="https://g.page/your-spa" />
        </Field>
      )}
      <Field label="2–3 local competitors">
        <Input value={data.competitor_names} onChange={v => set('competitor_names', v)} placeholder="Pure Skin Chicago, Chicago Botox Bar" />
      </Field>
      <Field label="How should the AI sound?" required>
        <RadioGroup options={TONES} value={data.ai_tone} onChange={v => set('ai_tone', v)} />
      </Field>
      <Field label="What should the AI never say or do?">
        <Textarea value={data.ai_restrictions} onChange={v => set('ai_restrictions', v)} placeholder={"Never quote exact prices without saying 'starting at'.\nNever promise treatment outcomes.\nNever mention competitors by name."} rows={3} />
      </Field>
    </div>
  )
}

function Step4({ data, set }: { data: FormData; set: (k: keyof FormData, v: any) => void }) {
  return (
    <div className="space-y-6">
      <Field label="Which engines do you need?" required>
        <div className="space-y-3">
          {[
            { id: 'Engine A: Omni-Channel Concierge', desc: 'Handles Instagram DMs, Facebook Messenger, Website Chat, SMS, and Email. 748 automated triggers.' },
            { id: 'Engine B: Omni Voice Receptionist', desc: 'Answers inbound calls 24/7, qualifies callers, and books appointments live during the call.' },
          ].map(({ id, desc }) => {
            const active = data.engines_selected.includes(id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => set('engines_selected', toggle(data.engines_selected, id))}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                  active ? 'border-indigo-500 bg-indigo-500/10' : 'border-[#2a2d3e] bg-[#0f1117] hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? 'bg-indigo-400' : 'bg-slate-600'}`} />
                  <span className={`text-sm font-medium ${active ? 'text-indigo-300' : 'text-slate-300'}`}>{id}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1 ml-4">{desc}</p>
              </button>
            )
          })}
        </div>
      </Field>

      <Field label="Add-ons (optional)">
        <div className="space-y-2">
          {ADDONS.map(addon => {
            const active = data.addons_selected.includes(addon)
            return (
              <button
                key={addon}
                type="button"
                onClick={() => set('addons_selected', toggle(data.addons_selected, addon))}
                className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                  active ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300' : 'border-[#2a2d3e] bg-[#0f1117] text-slate-400 hover:border-slate-500'
                }`}
              >
                <span className={`mr-2 ${active ? 'text-indigo-400' : 'text-slate-600'}`}>{active ? '✓' : '+'}</span>
                {addon}
              </button>
            )
          })}
        </div>
      </Field>

      <Field label="Reputation Response Engine">
        <p className="text-xs text-slate-500 mb-2">24/7 monitoring and auto-response to all Google reviews. Positive reviews get an SEO-optimized thank-you. Negative reviews get a professional holding response and an instant alert to you.</p>
        <RadioGroup options={['Yes', 'No']} value={data.reputation_engine_selected} onChange={v => set('reputation_engine_selected', v)} />
      </Field>

      <Field label="Priority launch channel" required>
        <Input value={data.priority_launch_channel} onChange={v => set('priority_launch_channel', v)} placeholder="Instagram DMs" />
        <p className="text-xs text-slate-600 mt-1">Which single channel matters most to you? We build this first so you're live in 48 hours.</p>
      </Field>
    </div>
  )
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: Step }) {
  const steps = ['Business Info', 'Services & Pricing', 'Tech & Channels', 'System Scoping']
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        {steps.map((label, i) => {
          const n = (i + 1) as Step
          const done = step > n
          const active = step === n
          return (
            <div key={label} className="flex items-center gap-1.5 flex-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                done ? 'bg-indigo-500 text-white' :
                active ? 'bg-indigo-400 text-white ring-2 ring-indigo-400/30 ring-offset-2 ring-offset-[#0f1117]' :
                'bg-[#1a1d27] border border-[#2a2d3e] text-slate-600'
              }`}>
                {done ? '✓' : n}
              </div>
              <span className={`text-xs hidden sm:block ${active ? 'text-indigo-400 font-medium' : done ? 'text-slate-400' : 'text-slate-600'}`}>
                {label}
              </span>
              {i < steps.length - 1 && (
                <div className={`flex-1 h-px mx-2 ${done ? 'bg-indigo-500' : 'bg-[#2a2d3e]'}`} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OnboardPage() {
  const [step, setStep]     = useState<Step>(1)
  const [data, setData]     = useState<FormData>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError]   = useState('')

  // Get client_id from URL if present
  const clientId = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('client_id') || ''
    : ''

  function set(key: keyof FormData, value: any) {
    setData(prev => ({ ...prev, [key]: value }))
  }

  function validate(): string {
    if (step === 1) {
      if (!data.business_name.trim()) return 'Business name is required.'
      if (!data.owner_name.trim())    return 'Your name is required.'
      if (!data.owner_email.trim())   return 'Email address is required.'
      if (!data.owner_phone.trim())   return 'Phone number is required.'
      if (!data.biggest_pain.trim())  return 'Please describe your biggest pain point.'
      if (!data.why_signed_up.trim()) return 'Please tell us why you signed up.'
      if (!data.monthly_revenue_range.trim()) return 'Monthly revenue range is required.'
    }
    if (step === 2) {
      if (!data.treatment_menu.trim())   return 'Please enter your treatment menu.'
      if (!data.top_treatments.trim())   return 'Please list your top 3 treatments.'
    }
    if (step === 3) {
      if (!data.booking_system_platform) return 'Please select your booking system.'
      if (data.active_channels.length === 0) return 'Please select at least one active channel.'
      if (!data.ai_tone) return 'Please select a tone for your AI.'
    }
    if (step === 4) {
      if (data.engines_selected.length === 0)    return 'Please select at least one engine.'
      if (!data.reputation_engine_selected)      return 'Please answer the Reputation Engine question.'
      if (!data.priority_launch_channel.trim())  return 'Please enter your priority launch channel.'
    }
    return ''
  }

  function next() {
    const err = validate()
    if (err) { setError(err); return }
    setError('')
    setStep(s => Math.min(s + 1, 4) as Step)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function back() {
    setError('')
    setStep(s => Math.max(s - 1, 1) as Step)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function submit() {
    const err = validate()
    if (err) { setError(err); return }
    setError('')
    setLoading(true)

    try {
      const payload = {
        ...data,
        client_id: clientId,
        booking_system_platform: data.booking_system_platform === 'Other'
          ? data.booking_system_other
          : data.booking_system_platform,
        engines_selected: data.engines_selected.join(', '),
        addons_selected:  data.addons_selected.join(', '),
        active_channels:  data.active_channels.join(', '),
      }

      const apiBase = process.env.NEXT_PUBLIC_API_BASE || 'https://api.srv1388391.hstgr.cloud'
      const res = await fetch(`${apiBase}/webhooks/onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { fields: Object.entries(payload).map(([key, value]) => ({ key, label: key, value })) } }),
      })

      if (!res.ok) throw new Error('Submission failed')
      setSubmitted(true)
    } catch (e) {
      setError('Something went wrong. Please try again or email us directly.')
    } finally {
      setLoading(false)
    }
  }

  // ── Submitted state ────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center mx-auto mb-6">
            <span className="text-3xl">✓</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">You're all set.</h1>
          <p className="text-slate-400 text-sm leading-relaxed">
            We're generating your AI Front Desk Blueprint now. You'll receive it by email within a few minutes — it shows exactly what we're building for you.
          </p>
          <p className="text-slate-500 text-sm mt-4">
            We'll be in touch shortly to schedule your 15-minute kickoff call.
          </p>
        </div>
      </div>
    )
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  const stepTitles = {
    1: 'Tell us about your business',
    2: 'Your services & pricing',
    3: 'Tech setup & channels',
    4: 'Your system configuration',
  }

  const stepSubtitles = {
    1: 'This helps us understand your business and what you need.',
    2: 'The AI needs to know your full menu to book correctly.',
    3: 'We\'ll connect these channels when we build your system.',
    4: 'Choose which parts of the system you want activated.',
  }

  return (
    <div className="min-h-screen bg-[#0f1117] py-10 px-4">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="text-center mb-8">
          <p className="text-xs font-bold tracking-widest text-indigo-400 uppercase mb-3">AdScale Labs</p>
          <h1 className="text-2xl font-bold text-white">Client Intake Form</h1>
          <p className="text-slate-500 text-sm mt-1">Takes about 15 minutes. This builds your AI Front Desk Blueprint.</p>
        </div>

        {/* Progress */}
        <ProgressBar step={step} />

        {/* Card */}
        <div className="bg-[#1a1d27] border border-[#2a2d3e] rounded-xl p-6 sm:p-8">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-white">{stepTitles[step]}</h2>
            <p className="text-slate-500 text-sm mt-0.5">{stepSubtitles[step]}</p>
          </div>

          {step === 1 && <Step1 data={data} set={set} />}
          {step === 2 && <Step2 data={data} set={set} />}
          {step === 3 && <Step3 data={data} set={set} />}
          {step === 4 && <Step4 data={data} set={set} />}

          {error && (
            <div className="mt-4 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-[#2a2d3e]">
            <button
              type="button"
              onClick={back}
              disabled={step === 1}
              className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 disabled:opacity-0 transition-colors"
            >
              ← Back
            </button>

            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-600">Step {step} of 4</span>
              {step < 4 ? (
                <button
                  type="button"
                  onClick={next}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Continue →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={loading}
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {loading ? 'Submitting...' : 'Submit →'}
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-slate-700 mt-6">
          Questions? Email us at adscalelabs2026@gmail.com
        </p>
      </div>
    </div>
  )
}
