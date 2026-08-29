import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0b1220',
        paper: '#f6f7fb',
        panel: '#ffffff',
        line: '#e2e5ee',
        brand: {
          50: '#eef4ff',
          100: '#dbe6fe',
          400: '#5b8def',
          500: '#3468e0',
          600: '#2650b8',
          700: '#1f3f93'
        },
        good: '#16a34a',
        warn: '#d97706',
        bad: '#dc2626'
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,0.06), 0 1px 1px rgba(15,23,42,0.04)'
      }
    }
  },
  plugins: []
};

export default config;
