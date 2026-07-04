import { useState } from "react";
import type { Settings } from "../config.js";
import { queryUser, type UserActivityRow, type UserSummary } from "../api.js";
import { Field } from "../components/Field.js";
import { downloadCsv } from "../lib/csv.js";

function fmtTime(raw: string): string {
  const d = new Date(raw.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleString();
}

function PropChips({ props }: { props: Record<string, string> }) {
  const entries = Object.entries(props);
  if (entries.length === 0) return <span style={{ color: "var(--muted)" }}>—</span>;
  return (
    <div className="row" style={{ gap: 6 }}>
      {entries.map(([k, v]) => (
        <span className="chip" key={k}>
          <span style={{ color: "var(--muted)" }}>{k}</span> {v}
        </span>
      ))}
    </div>
  );
}

export function Users({ settings }: { settings: Settings }) {
  const [userId, setUserId] = useState("");
  const [summary, setSummary] = useState<UserSummary | null>(null);
  const [activity, setActivity] = useState<UserActivityRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!userId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await queryUser(settings, userId.trim());
      setSummary(res.summary);
      setActivity(res.activity);
    } catch (e) {
      setError(String(e));
      setSummary(null);
      setActivity(null);
    } finally {
      setLoading(false);
    }
  };

  const found = summary && Number(summary.total_events) > 0;

  return (
    <>
      <div className="card">
        <div className="controls">
          <Field label="User or device id">
            <input
              type="text"
              placeholder="e.g. u_162"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()}
              style={{ minWidth: 260 }}
            />
          </Field>
          <button className="btn" onClick={run} disabled={!userId.trim() || loading}>
            {loading ? "Looking up…" : "Look up"}
          </button>
        </div>
      </div>

      <div className="card">
        {error && <div className="error">{error}</div>}
        {!activity && !error && <div className="empty">Enter a user id to see their event stream.</div>}
        {summary && !found && <div className="empty">No events found for this user.</div>}
        {found && activity && (
          <>
            <div className="stat-row">
              <div className="stat">
                <div className="stat-val">{Number(summary.total_events).toLocaleString()}</div>
                <div className="stat-label">total events</div>
              </div>
              <div className="stat">
                <div className="stat-val">{summary.distinct_events}</div>
                <div className="stat-label">distinct event types</div>
              </div>
              <div className="stat">
                <div className="stat-val" style={{ fontSize: 15 }}>{fmtTime(summary.first_seen)}</div>
                <div className="stat-label">first seen</div>
              </div>
              <div className="stat">
                <div className="stat-val" style={{ fontSize: 15 }}>{fmtTime(summary.last_seen)}</div>
                <div className="stat-label">last seen</div>
              </div>
            </div>
            {Object.keys(summary.latest_properties).length > 0 && (
              <div style={{ margin: "6px 0 16px" }}>
                <div className="stat-label" style={{ marginBottom: 6 }}>Latest user properties</div>
                <PropChips props={summary.latest_properties} />
              </div>
            )}
            <div className="row" style={{ margin: "4px 0 8px" }}>
              <button
                className="btn secondary"
                onClick={() =>
                  downloadCsv(
                    `${userId.trim()}-events.csv`,
                    ["time", "event", "properties"],
                    activity.map((r) => [r.time, r.event_type, JSON.stringify(r.event_properties)]),
                  )
                }
              >
                Export CSV
              </button>
            </div>
            <table className="data" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th style={{ width: 200 }}>Time</th>
                  <th style={{ width: 180 }}>Event</th>
                  <th>Properties</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((row, i) => (
                  <tr key={i}>
                    <td style={{ color: "var(--text-secondary)" }}>{fmtTime(row.time)}</td>
                    <td style={{ fontWeight: 600 }}>{row.event_type}</td>
                    <td><PropChips props={row.event_properties} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
}
