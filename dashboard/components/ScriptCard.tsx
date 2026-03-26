'use client'

import { useState } from 'react'
import { Copy, Check, Mic, Layers, Type } from 'lucide-react'

const FORMAT_ICONS: Record<string, any> = {
  talking_head: Mic,
  split_screen: Layers,
  text_overlay: Type,
  b_roll: Layers,
}

const TYPE_COLORS: Record<string, string> = {
  top_of_funnel: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  middle_of_funnel: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/20',
}

interface Script {
  id: number
  type: string
  hook: string
  body: string[]
  cta: string
  format: string
  angle: string
  predicted_audience: string
  views: number
  saves: number
  is_top_performer: number
}

export default function ScriptCard({ script }: { script: Script }) {
  const [copied, setCopied] = useState(false)
  const body = Array.isArray(script.body) ? script.body : JSON.parse(script.body || '[]')

  const fullScript = [
    `HOOK: ${script.hook}`,
    '',
    'BODY:',
    ...body.map((line: string, i: number) => `${i + 1}. ${line}`),
    '',
    `CTA: ${script.cta}`,
    `Format: ${script.format}`,
    `Angle: ${script.angle}`,
  ].join('\n')

  const handleCopy = async () => {
    await navigator.clipboard.writeText(fullScript)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const FormatIcon = FORMAT_ICONS[script.format] || Mic
  const typeColor = TYPE_COLORS[script.type] || TYPE_COLORS.middle_of_funnel

  return (
    <div className={`bg-[#1a1d27] border rounded-xl p-5 flex flex-col gap-3 relative ${
      script.is_top_performer ? 'border-amber-500/50' : 'border-[#2a2d3e]'
    }`}>
      {script.is_top_performer === 1 && (
        <div className="absolute top-3 right-3 text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">
          Top Performer
        </div>
      )}

      {/* Type badge */}
      <div className="flex items-center gap-2">
        <span className={`text-xs px-2 py-0.5 rounded border font-medium ${typeColor}`}>
          {script.type === 'top_of_funnel' ? 'TOF' : 'MOF'}
        </span>
        <span className="flex items-center gap-1 text-xs text-slate-500">
          <FormatIcon size={12} />
          {script.format?.replace('_', ' ')}
        </span>
      </div>

      {/* Hook — the most important line */}
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Hook</p>
        <p className="text-white font-medium leading-snug">{script.hook}</p>
      </div>

      {/* Body points */}
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Body</p>
        <ol className="space-y-1">
          {body.map((line: string, i: number) => (
            <li key={i} className="flex gap-2 text-sm text-slate-300">
              <span className="text-slate-600 select-none">{i + 1}.</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* CTA */}
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">CTA</p>
        <p className="text-sm text-indigo-300">{script.cta}</p>
      </div>

      {/* Angle */}
      {script.angle && (
        <p className="text-xs text-slate-500 italic border-t border-[#2a2d3e] pt-2">{script.angle}</p>
      )}

      {/* Copy button */}
      <button
        onClick={handleCopy}
        className={`mt-auto flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
          copied
            ? 'bg-green-500/20 text-green-400 border border-green-500/30'
            : 'bg-[#2a2d3e] text-slate-300 hover:bg-[#32354a] hover:text-white border border-transparent'
        }`}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? 'Copied!' : 'Copy Script'}
      </button>
    </div>
  )
}
