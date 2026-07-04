import { useEffect, useState } from "react";
import type { Settings } from "../config.js";
import { fetchEventNames, type EventName } from "../api.js";

export function Events({
  settings,
  onExplore,
}: {
  settings: Settings;
  onExplore: (eventType: string) => void;
}) {
  const [events, setEvents] = useState<EventName[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEventNames(settings)
      .then((e) => {
        setEvents(e);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [settings]);

  const max = events && events.length > 0 ? Math.max(...events.map((e) => Number(e.volume))) : 1;
  const total = events ? events.reduce((n, e) => n + Number(e.volume), 0) : 0;

  return (
    <div className="card">
      {error && (
        <div>
          <div className="error">Could not reach the Amplio API.</div>
          <div className="empty" style={{ padding: "12px 0", textAlign: "left" }}>
            Point this dashboard at a running Amplio API in <strong>Settings</strong> (URL and read key).
            Locally that is <code>http://localhost:8788</code> with <code>dev-read-key</code>.
            <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 12 }}>{error}</div>
          </div>
        </div>
      )}
      {events && events.length === 0 && (
        <div className="empty">
          No events yet. Send some with an SDK, or run <code>node scripts/seed-demo.mjs</code>.
        </div>
      )}
      {events && events.length > 0 && (
        <>
          <div className="stat-row">
            <div className="stat">
              <div className="stat-val">{total.toLocaleString()}</div>
              <div className="stat-label">events tracked</div>
            </div>
            <div className="stat">
              <div className="stat-val">{events.length}</div>
              <div className="stat-label">distinct event types</div>
            </div>
          </div>
          <table className="data" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th style={{ width: 240 }}>Event</th>
                <th>Volume</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.name}>
                  <td style={{ fontWeight: 600 }}>{e.name}</td>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <div
                        style={{
                          height: 10,
                          width: `${(Number(e.volume) / max) * 260}px`,
                          minWidth: 2,
                          background: "var(--seq-450)",
                          borderRadius: 4,
                        }}
                      />
                      <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-secondary)" }}>
                        {Number(e.volume).toLocaleString()}
                      </span>
                    </div>
                  </td>
                  <td>
                    <button className="btn secondary" onClick={() => onExplore(e.name)}>
                      Explore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
