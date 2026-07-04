import { useEffect, useRef, useState } from "react";
import type { Settings } from "../config.js";
import { queryLive, queryStats, type LiveEvent } from "../api.js";

const MAX_ROWS = 200;
const POLL_MS = 2000;

function fmtClock(recvMs: string): string {
  const d = new Date(Number(recvMs));
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString();
}

function keyOf(e: LiveEvent): string {
  return `${e.recv}:${e.event_type}:${e.user_id || e.device_id}`;
}

export function Live({ settings }: { settings: Settings }) {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [stats, setStats] = useState<{ total: number; lastHour: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef(0);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    // Seed with the most recent events, then tail from that cursor.
    queryLive(settings, 0, 60)
      .then((r) => {
        if (!alive) return;
        cursor.current = r.cursor;
        const initial = r.events.slice().reverse();
        initial.forEach((e) => seen.current.add(keyOf(e)));
        setEvents(initial.reverse());
        setError(null);
      })
      .catch((e) => setError(String(e)));

    const tick = async () => {
      if (paused) return;
      try {
        const [live, s] = await Promise.all([
          queryLive(settings, cursor.current, 100),
          queryStats(settings),
        ]);
        if (!alive) return;
        setStats(s);
        setError(null);
        if (live.events.length > 0) {
          cursor.current = live.cursor;
          const fresh = live.events.filter((e) => !seen.current.has(keyOf(e)));
          fresh.forEach((e) => seen.current.add(keyOf(e)));
          if (fresh.length > 0) {
            setEvents((prev) => [...fresh, ...prev].slice(0, MAX_ROWS));
          }
        }
      } catch (e) {
        if (alive) setError(String(e));
      }
    };
    const id = setInterval(tick, POLL_MS);
    void tick();
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [settings, paused]);

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="stat-row" style={{ marginBottom: 0 }}>
            <div className="stat">
              <div className="stat-val">{stats ? stats.total.toLocaleString() : "…"}</div>
              <div className="stat-label">events tracked</div>
            </div>
            <div className="stat">
              <div className="stat-val">{stats ? stats.lastHour.toLocaleString() : "…"}</div>
              <div className="stat-label">in the last hour</div>
            </div>
          </div>
          <div className="row">
            <span className="legend-item">
              <span
                className="legend-swatch"
                style={{
                  background: paused ? "var(--muted)" : "var(--good)",
                  borderRadius: 999,
                  animation: paused ? "none" : "amplio-pulse 1.4s ease-in-out infinite",
                }}
              />
              {paused ? "Paused" : "Live"}
            </span>
            <button className="btn secondary" onClick={() => setPaused((p) => !p)}>
              {paused ? "Resume" : "Pause"}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        {error && <div className="error">{error}</div>}
        {!error && events.length === 0 && (
          <div className="empty">Waiting for events. Anything you send lands here within a couple of seconds.</div>
        )}
        {events.length > 0 && (
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Time</th>
                <th style={{ width: 200 }}>Event</th>
                <th style={{ width: 160 }}>Who</th>
                <th>Properties</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={keyOf(e)}>
                  <td style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{fmtClock(e.recv)}</td>
                  <td style={{ fontWeight: 600 }}>{e.event_type}</td>
                  <td style={{ color: "var(--text-secondary)" }}>{e.user_id || e.device_id || "—"}</td>
                  <td style={{ color: "var(--text-secondary)" }}>
                    {Object.keys(e.event_properties).length > 0 ? JSON.stringify(e.event_properties) : "—"}
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
