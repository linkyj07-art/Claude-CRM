import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#e7eaf4',
        paper: '#0a0e18',
        panel: '#121826',
        panel2: '#0d1220',
        line: '#232b3e',
        brand: {
          50: '#1c1730',
          100: '#2a2147',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#9f75f8',
          700: '#c4b5fd'
        },
        good: '#22c55e',
        warn: '#f59e0b',
        bad: '#f87171',
        // Re-tuned so plain Tailwind utilities (bg-slate-50, text-amber-700,
        // etc.) read correctly against the dark theme without having to
        // hunt down every literal usage across the app — the numeric scale
        // is inverted in brightness terms (50 = near-background, higher =
        // more prominent/saturated) to match how those shades were actually
        // being used (subtle recessed backgrounds vs. emphasized text).
        slate: {
          50: '#141b2c', 100: '#1a2338', 200: '#26304a', 300: '#3a4666',
          400: '#8b95b3', 500: '#a7b0cb', 600: '#c7cee2', 700: '#dde2f0',
          800: '#eef1f8', 900: '#f7f9fc'
        },
        amber: {
          50: '#2a2110', 100: '#3d2f14', 700: '#fbbf24', 800: '#fcd34d'
        },
        red: {
          50: '#2a1414', 100: '#3d1a1a', 200: '#5c2626', 600: '#f87171', 700: '#fca5a5'
        },
        green: {
          50: '#0f2a1c', 800: '#86efac'
        },
        emerald: {
          100: '#123524', 500: '#22c55e', 600: '#4ade80', 700: '#6ee7a3'
        }
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.35), 0 8px 24px rgba(0,0,0,0.25)'
      }
    }
  },
  plugins: []
};

export default config;
