import { useEffect, useState } from "react";
import type { Settings } from "../config.js";
import {
  listFlags,
  fetchEventNames,
  queryExperiment,
  type FlagRow,
  type ExperimentRow,
} from "../api.js";
import { Field, EventSelect } from "../components/Field.js";
import { PRESETS, presetRange } from "../lib/time.js";

export function Experiments({ settings }: { settings: Settings }) {
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [flagKey, setFlagKey] = useState("");
  const [exposureEvent, setExposureEvent] = useState("");
  const [goalEvent, setGoalEvent] = useState("");
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<ExperimentRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listFlags(settings).then(setFlags).catch(() => setFlags([]));
    fetchEventNames(settings).then((e) => setNames(e.map((x) => x.name))).catch(() => setNames([]));
  }, [settings]);

  const run = async () => {
    if (!flagKey || !exposureEvent || !goalEvent) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await queryExperiment(settings, { flagKey, exposureEvent, goalEvent, range: presetRange(days) }));
    } catch (e) {
      setError(String(e));
      setRows(null);
    } finally {
      setLoading(false);
    }
  };

  const data = (rows ?? []).map((r) => {
    const exposed = Number(r.exposed);
    const converted = Number(r.converted);
    return { variant: r.variant || "(none)", exposed, converted, rate: exposed > 0 ? converted / exposed : 0 };
  });
  const best = data.length > 0 ? Math.max(...data.map((d) => d.rate)) : 0;

  return (
    <>
      <div className="card">
        <div className="controls">
          <Field label="Flag">
            <select value={flagKey} onChange={(e) => setFlagKey(e.target.value)}>
              <option value="">Select a flag</option>
              {flags.map((f) => (
                <option key={f.id} value={f.key}>{f.key}</option>
              ))}
            </select>
          </Field>
          <Field label="Exposure event">
            <EventSelect value={exposureEvent} onChange={setExposureEvent} names={names} placeholder="Entered experiment" />
          </Field>
          <Field label="Goal event">
            <EventSelect value={goalEvent} onChange={setGoalEvent} names={names} placeholder="Conversion" />
          </Field>
          <Field label="Date range">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {PRESETS.map((p) => (
                <option key={p.key} value={p.days}>{p.label}</option>
              ))}
            </select>
          </Field>
          <button className="btn" onClick={run} disabled={!flagKey || !exposureEvent || !goalEvent || loading}>
            {loading ? "Running…" : "Run"}
          </button>
        </div>
      </div>

      <div className="card">
        {error && <div className="error">{error}</div>}
        {!rows && !error && <div className="empty">Pick a flag, an exposure event, and a goal event.</div>}
        {rows && data.length === 0 && <div className="empty">No exposures found for this flag and range.</div>}
        {data.length > 0 && (
          <table className="data">
            <thead>
              <tr>
                <th>Variant</th>
                <th>Exposed</th>
                <th>Converted</th>
                <th>Conversion rate</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.variant}>
                  <td style={{ fontWeight: 600 }}>
                    {d.variant}
                    {d.rate === best && data.length > 1 && (
                      <span style={{ color: "var(--good)", fontSize: 12, marginLeft: 8 }}>best</span>
                    )}
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{d.exposed.toLocaleString()}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{d.converted.toLocaleString()}</td>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <div
                        style={{
                          height: 10,
                          width: `${Math.max(d.rate * 220, 2)}px`,
                          background: d.rate === best && data.length > 1 ? "var(--good)" : "var(--seq-450)",
                          borderRadius: 4,
                        }}
                      />
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{(d.rate * 100).toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
