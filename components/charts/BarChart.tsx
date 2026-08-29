interface Bar { label: string; value: number; sublabel?: string; }

// Horizontal gradient bars, pure SVG-free (divs) since these need to sit
// inline with text labels — kept separate from LineChart/DonutChart which
// benefit from real SVG paths.
export default function BarChart({ bars, color = '#8b5cf6', formatValue = (v: number) => String(v) }: { bars: Bar[]; color?: string; formatValue?: (v: number) => string }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="space-y-2">
      {bars.map((b, i) => {
        const pct = Math.max(2, (b.value / max) * 100);
        return (
          <div key={i} className="flex items-center gap-3">
            <div className="w-28 shrink-0 truncate text-sm text-slate-600" title={b.label}>{b.label}</div>
            <div className="h-6 flex-1 overflow-hidden rounded bg-slate-100">
              <div
                className="h-6 rounded transition-all"
                style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}99, ${color})` }}
              />
            </div>
            <div className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums">{formatValue(b.value)}</div>
          </div>
        );
      })}
    </div>
  );
}
