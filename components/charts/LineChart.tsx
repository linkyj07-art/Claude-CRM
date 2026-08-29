interface Point { label: string; value: number; }

// Pure server-rendered SVG — no client JS, no charting library. Renders a
// smoothed area/line with a gradient fill under it. Hover tooltips come from
// native SVG <title> elements rather than JS-driven interactivity.
export default function LineChart({
  points, color = '#8b5cf6', height = 120, formatValue = (v: number) => String(v), gradientId
}: {
  points: Point[]; color?: string; height?: number; formatValue?: (v: number) => string; gradientId: string;
}) {
  const width = 600;
  const padTop = 12;
  const padBottom = 20;
  const chartH = height - padTop - padBottom;
  const max = Math.max(1, ...points.map((p) => p.value));
  const stepX = points.length > 1 ? width / (points.length - 1) : width;

  const coords = points.map((p, i) => ({
    x: i * stepX,
    y: padTop + chartH - (p.value / max) * chartH,
    ...p
  }));

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1]?.x.toFixed(1) || 0} ${padTop + chartH} L 0 ${padTop + chartH} Z`;

  const labelStep = Math.max(1, Math.ceil(points.length / 6));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {coords.map((c, i) => (
        <g key={i}>
          <circle cx={c.x} cy={c.y} r={2.5} fill={color} />
          <title>{`${c.label}: ${formatValue(c.value)}`}</title>
          {i % labelStep === 0 && (
            <text x={c.x} y={height - 4} fontSize="9" textAnchor="middle" fill="#8b95b3">{c.label}</text>
          )}
        </g>
      ))}
    </svg>
  );
}
