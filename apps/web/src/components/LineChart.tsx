import { useState } from "react";
import { useWidth } from "./useWidth.js";
import { formatCompact } from "../lib/format.js";

export interface Series {
  name: string;
  color: string;
  values: number[];
}

interface Props {
  labels: string[];
  series: Series[];
  height?: number;
  /** Format a y value for axis ticks and tooltip. */
  format?: (n: number) => string;
  /** Format an x label for the tooltip header. */
  xLabel?: (label: string, index: number) => string;
}

const PAD = { top: 16, right: 18, bottom: 34, left: 52 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

export function LineChart({ labels, series, height = 300, format = formatCompact, xLabel }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const n = labels.length;
  const plotW = Math.max(width - PAD.left - PAD.right, 10);
  const plotH = height - PAD.top - PAD.bottom;
  const yMax = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));

  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => (yMax / ticks) * i);
  const xEvery = Math.ceil(n / Math.max(1, Math.floor(plotW / 70)));

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1)))));
  };

  const baseY = PAD.top + plotH;
  // A soft gradient area under the line reads as modern and gives the value a
  // sense of volume. Only for a single series, where overlapping fills would
  // otherwise muddy a multi-line chart.
  const areaFill = series.length === 1;

  return (
    <div ref={ref} className="chart-anim" style={{ position: "relative", width: "100%" }}>
      <svg width={width} height={height} role="img">
        <defs>
          {series.map((s, i) => (
            <linearGradient key={i} id={`area-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {/* gridlines + y ticks */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 10} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
              {format(t)}
            </text>
          </g>
        ))}
        {/* x labels */}
        {labels.map((lab, i) =>
          i % xEvery === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={height - PAD.bottom + 18} textAnchor="middle" fontSize={11} fill="var(--muted)">
              {lab}
            </text>
          ) : null,
        )}
        {/* series areas + lines */}
        {series.map((s, si) => (
          <g key={s.name}>
            {areaFill && n > 1 && (
              <path
                fill={`url(#area-${si})`}
                d={`M ${x(0)},${baseY} ${s.values.map((v, i) => `L ${x(i)},${y(v)}`).join(" ")} L ${x(n - 1)},${baseY} Z`}
              />
            )}
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth={2.25}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
            />
            {n === 1 && <circle cx={x(0)} cy={y(s.values[0] ?? 0)} r={4} fill={s.color} />}
          </g>
        ))}
        {/* hover crosshair + markers */}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--baseline)" strokeWidth={1} />
            {series.map((s) => (
              <circle
                key={s.name}
                cx={x(hover)}
                cy={y(s.values[hover] ?? 0)}
                r={4}
                fill={s.color}
                stroke="var(--surface-1)"
                strokeWidth={2}
              />
            ))}
          </g>
        )}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hover !== null && (
        <div
          className="tooltip"
          style={{
            left: Math.min(Math.max(x(hover) + 12, 0), width - 160),
            top: PAD.top,
          }}
        >
          <div style={{ color: "var(--muted)", marginBottom: 4 }}>
            {xLabel ? xLabel(labels[hover] ?? "", hover) : labels[hover]}
          </div>
          {series.map((s) => (
            <div className="tt-row" key={s.name}>
              <span className="legend-swatch" style={{ background: s.color }} />
              <span style={{ color: "var(--text-secondary)" }}>{s.name}</span>
              <span className="tt-val" style={{ marginLeft: "auto" }}>
                {format(s.values[hover] ?? 0)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
