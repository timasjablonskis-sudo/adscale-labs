'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, BarChart2, Brain, UserCheck, Zap } from 'lucide-react'

const NAV = [
  { href: '/', label: 'Scripts + Agents', icon: LayoutDashboard },
  { href: '/leads', label: 'Lead Pipeline', icon: Users },
  { href: '/performance', label: 'Performance', icon: BarChart2 },
  { href: '/knowledge-base', label: 'Knowledge Base', icon: Brain },
  { href: '/clients', label: 'Client Roster', icon: UserCheck },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <nav className="w-56 flex-shrink-0 bg-[#1a1d27] border-r border-[#2a2d3e] flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-[#2a2d3e]">
        <div className="flex items-center gap-2">
          <Zap className="text-indigo-400" size={20} />
          <span className="font-bold text-white text-sm tracking-wide">AdScale Labs</span>
        </div>
        <p className="text-xs text-slate-500 mt-1">Operations Dashboard</p>
      </div>

      {/* Navigation */}
      <div className="flex-1 px-3 py-4 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-indigo-500/20 text-indigo-300 font-medium'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#22253a]'
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-[#2a2d3e]">
        <p className="text-xs text-slate-600">v1.0.0 · claude-sonnet-4-6</p>
      </div>
    </nav>
  )
}
