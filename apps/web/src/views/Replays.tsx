import { useEffect, useRef, useState } from "react";
import rrwebPlayer from "rrweb-player";
import "rrweb-player/dist/style.css";
import type { Settings } from "../config.js";
import { listReplays, getReplayEvents, type ReplaySummary } from "../api.js";
import { formatNumber } from "../lib/format.js";

function fmtTime(raw: string): string {
  const d = new Date(raw.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleString();
}
function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function Player({ settings, replayId }: { settings: Settings; replayId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getReplayEvents(settings, replayId)
      .then((rows) => {
        if (cancelled || !ref.current) return;
        const events = rows
          .map((r) => {
            try {
              return JSON.parse(r.data);
            } catch {
              return null;
            }
          })
          .filter(Boolean);
        if (events.length < 2) {
          setError("This session is too short to replay.");
          return;
        }
        ref.current.innerHTML = "";
        const width = Math.min(ref.current.clientWidth || 900, 1200);
        new rrwebPlayer({
          target: ref.current,
          props: { events, width, height: Math.round((width * 9) / 16), autoPlay: true, showController: true },
        });
      })
      .catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [settings, replayId]);

  return (
    <div>
      {error && <div className="error">{error}</div>}
      <div ref={ref} />
    </div>
  );
}

export function Replays({ settings }: { settings: Settings }) {
  const [replays, setReplays] = useState<ReplaySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    listReplays(settings)
      .then((r) => {
        setReplays(r);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [settings]);

  return (
    <>
      {selected && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontWeight: 600 }}>Playing session {selected.slice(0, 12)}…</span>
            <button className="btn secondary" onClick={() => setSelected(null)}>
              Back to list
            </button>
          </div>
          <Player settings={settings} replayId={selected} />
        </div>
      )}

      {!selected && (
        <div className="card">
          {error && <div className="error">{error}</div>}
          {replays && replays.length === 0 && !error && (
            <div className="empty">
              No recordings yet. Record with <code>@amplio/sdk-replay</code>.
            </div>
          )}
          {replays && replays.length > 0 && (
            <table className="data">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>User</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Events</th>
                  <th style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {replays.map((r) => (
                  <tr key={r.replay_id}>
                    <td style={{ fontFamily: "ui-monospace, monospace" }}>{r.replay_id.slice(0, 14)}…</td>
                    <td style={{ color: "var(--text-secondary)" }}>{r.user_id || r.device_id || "—"}</td>
                    <td style={{ color: "var(--text-secondary)" }}>{fmtTime(r.started)}</td>
                    <td>{fmtDuration(Number(r.duration_s))}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{formatNumber(Number(r.events))}</td>
                    <td>
                      <button className="btn secondary" onClick={() => setSelected(r.replay_id)}>
                        Watch
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
