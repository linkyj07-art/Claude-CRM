interface Slice { label: string; value: number; color: string; }

const R = 60;
const CX = 70;
const CY = 70;
const CIRC = 2 * Math.PI * R;

// Pure server-rendered SVG donut — stroke-dasharray trick, no library.
export default function DonutChart({ slices, centerLabel, centerValue }: { slices: Slice[]; centerLabel: string; centerValue: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  let offset = 0;

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 140 140" width={140} height={140}>
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="#1a2338" strokeWidth="18" />
        {slices.map((s, i) => {
          const frac = s.value / total;
          const dash = frac * CIRC;
          const dashArray = `${dash} ${CIRC - dash}`;
          const dashOffset = -offset;
          offset += dash;
          return (
            <circle
              key={i}
              cx={CX}
              cy={CY}
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth="18"
              strokeDasharray={dashArray}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${CX} ${CY})`}
            >
              <title>{s.label}: {s.value}</title>
            </circle>
          );
        })}
        <text x={CX} y={CY - 4} textAnchor="middle" fontSize="20" fontWeight="700" fill="#e7eaf4">{centerValue}</text>
        <text x={CX} y={CY + 14} textAnchor="middle" fontSize="9" fill="#8b95b3">{centerLabel}</text>
      </svg>
      <div className="flex flex-1 flex-col gap-1.5">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="font-semibold text-ink">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
