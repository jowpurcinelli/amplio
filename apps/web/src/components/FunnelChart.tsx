import { formatNumber, formatPercent } from "../lib/format.js";

export interface FunnelStep {
  name: string;
  count: number;
}

interface Props {
  steps: FunnelStep[];
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return formatPercent(part / whole);
}

export function FunnelChart({ steps }: Props) {
  const top = steps[0]?.count ?? 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {steps.map((step, i) => {
        const prev = i > 0 ? steps[i - 1]!.count : step.count;
        const widthPct = top > 0 ? (step.count / top) * 100 : 0;
        return (
          <div key={i}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontWeight: 600 }}>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>{i + 1}</span>
                {step.name}
              </span>
              <span style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                {formatNumber(step.count)} · {pct(step.count, top)} of top
                {i > 0 && (
                  <span style={{ color: "var(--muted)" }}> · {pct(step.count, prev)} from prev</span>
                )}
              </span>
            </div>
            <div
              style={{
                background: "color-mix(in srgb, var(--baseline) 30%, transparent)",
                borderRadius: 6,
                height: 26,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.max(widthPct, 0.5)}%`,
                  height: "100%",
                  background: "var(--seq-450)",
                  borderRadius: 6,
                  transition: "width 240ms ease",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
