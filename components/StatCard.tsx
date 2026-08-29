export default function StatCard({
  label,
  value,
  sub,
  tone = 'default'
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'good' | 'bad';
}) {
  const valueColor = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-600' : 'text-ink';
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${valueColor}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
