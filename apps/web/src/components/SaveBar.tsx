import { useState } from "react";
import type { Settings } from "../config.js";
import { createChart, type ChartKind } from "../api.js";

/** A compact "name + save" bar to persist the current analysis as a chart. */
export function SaveBar({
  settings,
  kind,
  definition,
}: {
  settings: Settings;
  kind: ChartKind;
  definition: Record<string, unknown>;
}) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) return;
    setStatus("Saving…");
    try {
      await createChart(settings, { name: name.trim(), kind, definition });
      setStatus(`Saved "${name.trim()}"`);
      setName("");
    } catch (e) {
      setStatus(String(e).includes("503") ? "Saving needs a metadata store (DATABASE_URL)." : String(e));
    }
  };

  return (
    <div className="row" style={{ marginTop: 14 }}>
      <input
        type="text"
        placeholder="Name this chart to save it"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ minWidth: 240 }}
      />
      <button className="btn secondary" onClick={save} disabled={!name.trim()}>
        Save chart
      </button>
      {status && <span style={{ color: "var(--muted)", fontSize: 12 }}>{status}</span>}
    </div>
  );
}
