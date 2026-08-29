export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#5b21b6" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="22" fill="url(#logo-g)" />
      <path d="M50 18 L78 28 V50 C78 68 66 80 50 86 C34 80 22 68 22 50 V28 Z" fill="none" stroke="#f5f3ff" strokeWidth="5" strokeLinejoin="round" />
      <path d="M38 51 L47 60 L64 41" fill="none" stroke="#f5f3ff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
