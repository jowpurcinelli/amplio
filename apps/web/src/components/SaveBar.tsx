import { useState } from "react";
import type { Settings } from "../config.js";
import { createChart, type ChartKind } from "../api.js";
import { useToast } from "./Toast.js";

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
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const label = name.trim();
      await createChart(settings, { name: label, kind, definition });
      toast.ok(`Saved "${label}"`);
      setName("");
    } catch (e) {
      toast.err(String(e).includes("503") ? "Saving needs a metadata store (DATABASE_URL)." : String(e));
    } finally {
      setSaving(false);
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
      <button className="btn secondary" onClick={save} disabled={!name.trim() || saving}>
        {saving ? "Saving…" : "Save chart"}
      </button>
    </div>
  );
}
