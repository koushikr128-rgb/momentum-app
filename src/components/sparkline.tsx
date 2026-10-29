// Sparkline — mini SVG price chart showing 1-month trend
// Green if price is up over the period, red if down

export function Sparkline({ prices, width = 60, height = 20 }: {
  prices: number[];
  width?: number;
  height?: number;
}) {
  if (!prices || prices.length < 2) {
    return <div className="text-[9px] text-muted-foreground">—</div>;
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  // Build SVG path
  const points = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * width;
    const y = height - ((p - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pathD = `M ${points.join(" L ")}`;
  const isUp = prices[prices.length - 1] >= prices[0];
  const color = isUp ? "#10b981" : "#ef4444";
  const fillColor = isUp ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)";

  // Area path (filled below the line)
  const areaD = `${pathD} L ${width},${height} L 0,${height} Z`;

  return (
    <svg width={width} height={height} className="inline-block">
      <path d={areaD} fill={fillColor} />
      <path d={pathD} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
