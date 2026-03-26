import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // AdScale Labs dark theme palette
        surface: {
          DEFAULT: '#0f1117',  // page background
          card: '#1a1d27',     // card/panel background
          border: '#2a2d3e',   // borders
          hover: '#22253a',    // hover states
        },
        accent: {
          DEFAULT: '#6366f1',  // indigo primary accent
          light: '#818cf8',
          dark: '#4f46e5',
        },
        success: '#22c55e',
        warning: '#f59e0b',
        danger: '#ef4444',
        muted: '#6b7280',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
