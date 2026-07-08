import { useEffect, useState } from "react";
import type { Settings } from "../config.js";
import { fetchEventNames, fetchPropertyKeys, querySegmentation, listCohorts } from "../api.js";
import type { Granularity, Measure, SegmentationRow, Cohort } from "../api.js";
import { Field, EventSelect } from "../components/Field.js";
import { LineChart } from "../components/LineChart.js";
import { SaveBar } from "../components/SaveBar.js";
import { PRESETS, presetRange } from "../lib/time.js";
import { segmentationSeries } from "../lib/charts.js";
import { downloadCsv } from "../lib/csv.js";
import { formatNumber, formatCompact } from "../lib/format.js";
import { ChartSkeleton } from "../components/Skeleton.js";

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
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [cohortId, setCohortId] = useState("");

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
    listCohorts(settings)
      .then(setCohorts)
      .catch(() => setCohorts([]));
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
      const cohort = cohorts.find((c) => c.id === cohortId)?.definition;
      setRows(
        await querySegmentation(settings, {
          eventType: event,
          range: presetRange(days),
          granularity,
          measure,
          groupBy: breakdown ? { scope: "event", key: breakdown } : undefined,
          cohort,
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

  const { labels, series } = rows
    ? segmentationSeries(rows, granularity, Boolean(breakdown))
    : { labels: [] as string[], series: [] };
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
          <Field label="Cohort">
            <select value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
              <option value="">All users</option>
              {cohorts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
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
        {loading && <ChartSkeleton />}
        {!loading && !rows && !error && (
          <div className="empty-state">
            <div className="empty-glyph">📈</div>
            <div className="empty-title">Choose an event and run a query</div>
            <div className="empty-hint">Pick an event above, then hit Run to chart its volume or unique users over time.</div>
          </div>
        )}
        {!loading && rows && rows.length === 0 && <div className="empty">No events matched this query.</div>}
        {!loading && rows && rows.length > 0 && (
          <>
            <div className="stat-row">
              <div className="stat">
                <div className="stat-val">{formatNumber(total)}</div>
                <div className="stat-label">{measure === "unique" ? "unique users" : "events"} in range</div>
              </div>
            </div>
            <LineChart labels={labels} series={series} format={formatCompact} />
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
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn secondary" onClick={() => setShowTable((v) => !v)}>
                {showTable ? "Hide" : "Show"} data table
              </button>
              <button
                className="btn secondary"
                onClick={() =>
                  downloadCsv(
                    `${event}-segmentation.csv`,
                    ["bucket", ...series.map((s) => s.name)],
                    labels.map((lab, i) => [lab, ...series.map((s) => s.values[i] ?? 0)]),
                  )
                }
              >
                Export CSV
              </button>
            </div>
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
                        <td key={s.name}>{formatNumber(s.values[i] ?? 0)}</td>
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
