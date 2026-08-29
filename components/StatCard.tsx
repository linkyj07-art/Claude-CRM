export default function StatCard({
  label,
  value,
  sub,
  icon,
  tone = 'default'
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: string;
  tone?: 'default' | 'good' | 'bad';
}) {
  const valueColor = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-600' : 'text-ink';
  const iconTone = tone === 'good' ? 'bg-emerald-100 text-emerald-600' : tone === 'bad' ? 'bg-red-100 text-red-600' : 'bg-brand-50 text-brand-400';
  return (
    <div className="card group p-5 transition-transform hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-2">
        <div className="label">{label}</div>
        {icon && (
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm ${iconTone}`}>{icon}</span>
        )}
      </div>
      <div className={`mt-2 text-[26px] font-bold leading-none tabular-nums ${valueColor}`}>{value}</div>
      {sub && <div className="mt-1.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
