import { useEffect, useState } from "react";
import type { Settings } from "../config.js";
import { fetchEventNames, queryRetention } from "../api.js";
import type { RetentionRow } from "../api.js";
import { Field, EventSelect } from "../components/Field.js";
import { LineChart } from "../components/LineChart.js";
import { SaveBar } from "../components/SaveBar.js";
import { PRESETS, presetRange, SERIES_VARS } from "../lib/time.js";
import { formatNumber } from "../lib/format.js";
import { downloadCsv } from "../lib/csv.js";

export function Retention({
  settings,
  initial,
}: {
  settings: Settings;
  initial?: Record<string, unknown>;
}) {
  const [names, setNames] = useState<string[]>([]);
  const [startEvent, setStartEvent] = useState("");
  const [returnEvent, setReturnEvent] = useState("");
  const [days, setDays] = useState(30);
  const [offsets, setOffsets] = useState(14);

  useEffect(() => {
    if (!initial) return;
    if (typeof initial.startEvent === "string") setStartEvent(initial.startEvent);
    if (typeof initial.returnEvent === "string") setReturnEvent(initial.returnEvent);
    if (typeof initial.days === "number") setDays(initial.days);
    if (typeof initial.offsets === "number") setOffsets(initial.offsets);
  }, [initial]);
  const [rows, setRows] = useState<RetentionRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    fetchEventNames(settings)
      .then((e) => setNames(e.map((x) => x.name)))
      .catch(() => setNames([]));
  }, [settings]);

  const run = async () => {
    if (!startEvent) return;
    setLoading(true);
    setError(null);
    try {
      setRows(
        await queryRetention(settings, {
          startEvent,
          returnEvent: returnEvent || undefined,
          range: presetRange(days),
          days: offsets,
        }),
      );
    } catch (e) {
      setError(String(e));
      setRows(null);
    } finally {
      setLoading(false);
    }
  };

  const byOffset = new Map((rows ?? []).map((r) => [Number(r.offset), Number(r.retained)]));
  const cohort = byOffset.get(0) ?? 0;
  const labels = Array.from({ length: offsets + 1 }, (_, i) => `Day ${i}`);
  const pctValues = labels.map((_, i) => (cohort > 0 ? ((byOffset.get(i) ?? 0) / cohort) * 100 : 0));

  return (
    <>
      <div className="card">
        <div className="controls">
          <Field label="Start event (cohort)">
            <EventSelect value={startEvent} onChange={setStartEvent} names={names} />
          </Field>
          <Field label="Return event">
            <EventSelect value={returnEvent} onChange={setReturnEvent} names={names} placeholder="Same as start" />
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
          <Field label="Day offsets">
            <select value={offsets} onChange={(e) => setOffsets(Number(e.target.value))}>
              {[7, 14, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </Field>
          <button className="btn" onClick={run} disabled={!startEvent || loading}>
            {loading ? "Running…" : "Run retention"}
          </button>
        </div>
        {startEvent && (
          <SaveBar
            settings={settings}
            kind="retention"
            definition={{ startEvent, returnEvent, days, offsets }}
          />
        )}
      </div>

      <div className="card">
        {error && <div className="error">{error}</div>}
        {!rows && !error && <div className="empty">Choose a start event and run.</div>}
        {rows && cohort === 0 && <div className="empty">No cohort found for this event and range.</div>}
        {rows && cohort > 0 && (
          <>
            <div className="stat-row">
              <div className="stat">
                <div className="stat-val">{formatNumber(cohort)}</div>
                <div className="stat-label">users in cohort (day 0)</div>
              </div>
              <div className="stat">
                <div className="stat-val">{pctValues[1] !== undefined ? pctValues[1].toFixed(1) : "0"}%</div>
                <div className="stat-label">day 1 retention</div>
              </div>
            </div>
            <LineChart
              labels={labels}
              series={[{ name: "retention", color: SERIES_VARS[0]!, values: pctValues }]}
              format={(n) => `${Math.round(n)}%`}
              xLabel={(l) => l}
            />
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn secondary" onClick={() => setShowTable((v) => !v)}>
                {showTable ? "Hide" : "Show"} data table
              </button>
              <button
                className="btn secondary"
                onClick={() =>
                  downloadCsv(
                    `${startEvent}-retention.csv`,
                    ["offset", "retained", "percent"],
                    labels.map((lab, i) => [lab, byOffset.get(i) ?? 0, (pctValues[i] ?? 0).toFixed(1)]),
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
                    <th>Offset</th>
                    <th>Retained</th>
                    <th>Percent</th>
                  </tr>
                </thead>
                <tbody>
                  {labels.map((lab, i) => (
                    <tr key={i}>
                      <td>{lab}</td>
                      <td>{formatNumber(byOffset.get(i) ?? 0)}</td>
                      <td>{(pctValues[i] ?? 0).toFixed(1)}%</td>
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
