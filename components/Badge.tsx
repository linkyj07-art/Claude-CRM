const COLOR_CLASS: Record<string, string> = {
  good: 'badge-good',
  warn: 'badge-warn',
  bad: 'badge-bad',
  brand: 'badge-brand'
};

export default function Badge({ label, color = 'brand' }: { label: string; color?: string }) {
  return <span className={COLOR_CLASS[color] || 'badge-brand'}>{label}</span>;
}
