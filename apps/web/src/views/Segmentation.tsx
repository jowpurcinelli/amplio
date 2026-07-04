import { useEffect, useState } from "react";
import type { Settings } from "../config.js";
import { fetchEventNames, fetchPropertyKeys, querySegmentation } from "../api.js";
import type { Granularity, Measure, SegmentationRow } from "../api.js";
import { Field, EventSelect } from "../components/Field.js";
import { LineChart, type Series } from "../components/LineChart.js";
import { SaveBar } from "../components/SaveBar.js";
import { PRESETS, presetRange, bucketLabel, SERIES_VARS } from "../lib/time.js";

function toSeries(
  rows: SegmentationRow[],
  granularity: string,
  grouped: boolean,
): { labels: string[]; series: Series[] } {
  const buckets = Array.from(new Set(rows.map((r) => r.bucket))).sort();
  const labels = buckets.map((b) => bucketLabel(b, granularity));
  if (!grouped) {
    const byBucket = new Map(rows.map((r) => [r.bucket, Number(r.value)]));
    return {
      labels,
      series: [{ name: "value", color: SERIES_VARS[0]!, values: buckets.map((b) => byBucket.get(b) ?? 0) }],
    };
  }
  const groups = Array.from(new Set(rows.map((r) => r.group_key ?? "(none)")));
  const series = groups.slice(0, 8).map((g, i) => {
    const byBucket = new Map(
      rows.filter((r) => (r.group_key ?? "(none)") === g).map((r) => [r.bucket, Number(r.value)]),
    );
    return {
      name: g || "(empty)",
      color: SERIES_VARS[i % SERIES_VARS.length]!,
      values: buckets.map((b) => byBucket.get(b) ?? 0),
    };
  });
  return { labels, series };
}

export function Segmentation({
  settings,
  initial,
}: {
  settings: Settings;
  initial?: Record<string, unknown>;
}) {
  const [names, setNames] = useState<string[]>([]);
  const [event, setEvent] = useState("");
  const [measure, setMeasure] = useState<Measure>("total");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [days, setDays] = useState(30);
  const [propKeys, setPropKeys] = useState<string[]>([]);
  const [breakdown, setBreakdown] = useState("");

  useEffect(() => {
    if (!initial) return;
    if (typeof initial.eventType === "string") setEvent(initial.eventType);
    if (initial.measure === "total" || initial.measure === "unique") setMeasure(initial.measure);
    if (typeof initial.granularity === "string") setGranularity(initial.granularity as Granularity);
    if (typeof initial.days === "number") setDays(initial.days);
    if (typeof initial.breakdown === "string") setBreakdown(initial.breakdown);
  }, [initial]);
  const [rows, setRows] = useState<SegmentationRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    fetchEventNames(settings)
      .then((e) => setNames(e.map((x) => x.name)))
      .catch(() => setNames([]));
  }, [settings]);

  useEffect(() => {
    if (!event) return setPropKeys([]);
    fetchPropertyKeys(settings, event, "event").then(setPropKeys).catch(() => setPropKeys([]));
  }, [settings, event]);

  const run = async () => {
    if (!event) return;
    setLoading(true);
    setError(null);
    try {
      setRows(
        await querySegmentation(settings, {
          eventType: event,
          range: presetRange(days),
          granularity,
          measure,
          groupBy: breakdown ? { scope: "event", key: breakdown } : undefined,
          limit: 8,
        }),
      );
    } catch (e) {
      setError(String(e));
      setRows(null);
    } finally {
      setLoading(false);
    }
  };

  const { labels, series } = rows ? toSeries(rows, granularity, Boolean(breakdown)) : { labels: [], series: [] };
  const total = series.reduce((sum, s) => sum + s.values.reduce((a, b) => a + b, 0), 0);

  return (
    <>
      <div className="card">
        <div className="controls">
          <Field label="Event">
            <EventSelect value={event} onChange={setEvent} names={names} />
          </Field>
          <Field label="Measure">
            <select value={measure} onChange={(e) => setMeasure(e.target.value as Measure)}>
              <option value="total">Event total</option>
              <option value="unique">Unique users</option>
            </select>
          </Field>
          <Field label="Granularity">
            <select value={granularity} onChange={(e) => setGranularity(e.target.value as Granularity)}>
              <option value="hour">Hourly</option>
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
            </select>
          </Field>
          <Field label="Date range">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {PRESETS.map((p) => (
                <option key={p.key} value={p.days}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Break down by">
            <select value={breakdown} onChange={(e) => setBreakdown(e.target.value)}>
              <option value="">None</option>
              {propKeys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <button className="btn" onClick={run} disabled={!event || loading}>
            {loading ? "Running…" : "Run"}
          </button>
        </div>
        {event && (
          <SaveBar
            settings={settings}
            kind="segmentation"
            definition={{ eventType: event, measure, granularity, days, breakdown }}
          />
        )}
      </div>

      <div className="card">
        {error && <div className="error">{error}</div>}
        {!rows && !error && <div className="empty">Choose an event and run a query.</div>}
        {rows && rows.length === 0 && <div className="empty">No events matched this query.</div>}
        {rows && rows.length > 0 && (
          <>
            <div className="stat-row">
              <div className="stat">
                <div className="stat-val">{total.toLocaleString()}</div>
                <div className="stat-label">{measure === "unique" ? "unique users" : "events"} in range</div>
              </div>
            </div>
            <LineChart
              labels={labels}
              series={series}
              format={(n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)))}
            />
            {series.length > 1 && (
              <div className="legend">
                {series.map((s) => (
                  <div className="legend-item" key={s.name}>
                    <span className="legend-swatch" style={{ background: s.color }} />
                    {s.name}
                  </div>
                ))}
              </div>
            )}
            <button className="btn secondary" style={{ marginTop: 14 }} onClick={() => setShowTable((v) => !v)}>
              {showTable ? "Hide" : "Show"} data table
            </button>
            {showTable && (
              <table className="data" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Bucket</th>
                    {series.map((s) => (
                      <th key={s.name}>{s.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {labels.map((lab, i) => (
                    <tr key={i}>
                      <td>{lab}</td>
                      {series.map((s) => (
                        <td key={s.name}>{(s.values[i] ?? 0).toLocaleString()}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </>
  );
}
