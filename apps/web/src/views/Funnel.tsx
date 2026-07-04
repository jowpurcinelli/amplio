import { useEffect, useState } from "react";
import type { Settings } from "../config.js";
import { fetchEventNames, queryFunnel } from "../api.js";
import { Field, EventSelect } from "../components/Field.js";
import { FunnelChart, type FunnelStep } from "../components/FunnelChart.js";
import { PRESETS, presetRange } from "../lib/time.js";

const WINDOWS = [
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86_400 },
  { label: "7 days", seconds: 604_800 },
  { label: "30 days", seconds: 2_592_000 },
];

export function Funnel({ settings }: { settings: Settings }) {
  const [names, setNames] = useState<string[]>([]);
  const [steps, setSteps] = useState<string[]>(["", ""]);
  const [windowSeconds, setWindowSeconds] = useState(86_400);
  const [days, setDays] = useState(30);
  const [result, setResult] = useState<FunnelStep[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEventNames(settings)
      .then((e) => setNames(e.map((x) => x.name)))
      .catch(() => setNames([]));
  }, [settings]);

  const setStep = (i: number, v: string) => setSteps((s) => s.map((x, j) => (j === i ? v : x)));
  const addStep = () => setSteps((s) => [...s, ""]);
  const removeStep = (i: number) => setSteps((s) => (s.length > 2 ? s.filter((_, j) => j !== i) : s));

  const run = async () => {
    const clean = steps.filter(Boolean);
    if (clean.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const res = await queryFunnel(settings, { steps: clean, range: presetRange(days), windowSeconds });
      setResult(clean.map((name, i) => ({ name, count: Number(res[`step_${i + 1}`] ?? 0) })));
    } catch (e) {
      setError(String(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const overall =
    result && result.length > 0 && result[0]!.count > 0
      ? ((result[result.length - 1]!.count / result[0]!.count) * 100).toFixed(1)
      : null;

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          {steps.map((step, i) => (
            <div className="row" key={i}>
              <span style={{ width: 22, color: "var(--muted)", fontWeight: 600 }}>{i + 1}</span>
              <div style={{ minWidth: 220 }}>
                <EventSelect value={step} onChange={(v) => setStep(i, v)} names={names} placeholder="Select step event" />
              </div>
              {steps.length > 2 && (
                <button className="chip" onClick={() => removeStep(i)}>
                  Remove <span>×</span>
                </button>
              )}
            </div>
          ))}
          <div>
            <button className="btn secondary" onClick={addStep}>
              + Add step
            </button>
          </div>
        </div>
        <div className="controls">
          <Field label="Conversion window">
            <select value={windowSeconds} onChange={(e) => setWindowSeconds(Number(e.target.value))}>
              {WINDOWS.map((w) => (
                <option key={w.seconds} value={w.seconds}>
                  {w.label}
                </option>
              ))}
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
          <button className="btn" onClick={run} disabled={steps.filter(Boolean).length < 2 || loading}>
            {loading ? "Running…" : "Run funnel"}
          </button>
        </div>
      </div>

      <div className="card">
        {error && <div className="error">{error}</div>}
        {!result && !error && <div className="empty">Add at least two steps and run the funnel.</div>}
        {result && (
          <>
            {overall !== null && (
              <div className="stat-row">
                <div className="stat">
                  <div className="stat-val">{overall}%</div>
                  <div className="stat-label">overall conversion, step 1 to {result.length}</div>
                </div>
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              <FunnelChart steps={result} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
