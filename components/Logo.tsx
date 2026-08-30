export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3730a3" />
          <stop offset="45%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#f472b6" />
        </linearGradient>
        <linearGradient id="logo-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fef9ff" />
          <stop offset="55%" stopColor="#e9d5ff" />
          <stop offset="100%" stopColor="#fcd34d" />
        </linearGradient>
        <radialGradient id="logo-glow" cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id="logo-blur" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <rect width="100" height="100" rx="26" fill="url(#logo-bg)" />
      <rect width="100" height="100" rx="26" fill="url(#logo-glow)" />
      <path
        d="M66 27 C42 27 40 46 52 50 C64 54 62 73 38 73"
        fill="none" stroke="#1e1b4b" strokeOpacity="0.35" strokeWidth="15"
        strokeLinecap="round" strokeLinejoin="round" filter="url(#logo-blur)"
      />
      <path
        d="M66 27 C42 27 40 46 52 50 C64 54 62 73 38 73"
        fill="none" stroke="url(#logo-mark)" strokeWidth="13"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}
