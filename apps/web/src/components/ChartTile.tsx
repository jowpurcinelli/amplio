import { useEffect, useState } from "react";
import type { Settings } from "../config.js";
import {
  querySegmentation,
  queryFunnel,
  queryRetention,
  type SavedChart,
  type Granularity,
  type Measure,
  type CohortDef,
} from "../api.js";
import { LineChart } from "./LineChart.js";
import { FunnelChart, type FunnelStep } from "./FunnelChart.js";
import { presetRange } from "../lib/time.js";
import { segmentationSeries, retentionCurve } from "../lib/charts.js";

type Def = Record<string, unknown>;
const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);

/** Runs a saved chart's query and renders it compactly for a dashboard grid. */
export function ChartTile({ chart, settings }: { chart: SavedChart; settings: Settings }) {
  const [node, setNode] = useState<React.ReactNode>(<div className="empty">Loading…</div>);

  useEffect(() => {
    let alive = true;
    const def = chart.definition as Def;
    const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

    const render = async () => {
      try {
        if (chart.kind === "segmentation") {
          const rows = await querySegmentation(settings, {
            eventType: str(def.eventType),
            range: presetRange(num(def.days, 30)),
            granularity: str(def.granularity, "day") as Granularity,
            measure: str(def.measure, "total") as Measure,
            groupBy: def.breakdown ? { scope: "event", key: str(def.breakdown) } : undefined,
            cohort: (def.cohort as CohortDef | undefined) ?? undefined,
            limit: 8,
          });
          const { labels, series } = segmentationSeries(rows, str(def.granularity, "day"), Boolean(def.breakdown));
          if (alive) setNode(<LineChart labels={labels} series={series} height={200} format={fmt} />);
        } else if (chart.kind === "funnel") {
          const steps = (def.steps as string[]) ?? [];
          const res = await queryFunnel(settings, {
            steps,
            range: presetRange(num(def.days, 30)),
            windowSeconds: num(def.windowSeconds, 86400),
          });
          const result: FunnelStep[] = steps.map((name, i) => ({ name, count: Number(res[`step_${i + 1}`] ?? 0) }));
          if (alive) setNode(<FunnelChart steps={result} />);
        } else {
          const offsets = num(def.offsets, 14);
          const rows = await queryRetention(settings, {
            startEvent: str(def.startEvent),
            returnEvent: str(def.returnEvent) || undefined,
            range: presetRange(num(def.days, 30)),
            days: offsets,
          });
          const { labels, values } = retentionCurve(rows, offsets);
          if (alive)
            setNode(
              <LineChart
                labels={labels}
                series={[{ name: "retention", color: "var(--series-1)", values }]}
                height={200}
                format={(n) => `${Math.round(n)}%`}
                xLabel={(l) => l}
              />,
            );
        }
      } catch (e) {
        if (alive) setNode(<div className="error">{String(e)}</div>);
      }
    };
    void render();
    return () => {
      alive = false;
    };
  }, [chart, settings]);

  return (
    <div className="card" style={{ margin: 0 }}>
      <div style={{ fontWeight: 600, marginBottom: 10 }}>{chart.name}</div>
      {node}
    </div>
  );
}
