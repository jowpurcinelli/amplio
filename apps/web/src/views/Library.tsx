import { useEffect, useState } from "react";
import type { Settings } from "../config.js";
import { listCharts, deleteChart, type SavedChart } from "../api.js";
import { EmptyState } from "../components/EmptyState.js";

const KIND_LABEL: Record<string, string> = {
  segmentation: "Segmentation",
  funnel: "Funnel",
  retention: "Retention",
};

export function Library({
  settings,
  onOpen,
}: {
  settings: Settings;
  onOpen: (chart: SavedChart) => void;
}) {
  const [charts, setCharts] = useState<SavedChart[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    listCharts(settings)
      .then((c) => {
        setCharts(c);
        setError(null);
      })
      .catch((e) =>
        setError(
          String(e).includes("503")
            ? "Saved charts need a metadata store (set DATABASE_URL on the API)."
            : String(e),
        ),
      );
  };

  useEffect(load, [settings]);

  const remove = async (id: string) => {
    await deleteChart(settings, id);
    load();
  };

  return (
    <div className="card">
      {error && <div className="error">{error}</div>}
      {!error && charts && charts.length === 0 && (
        <EmptyState
          icon="library"
          title="No saved charts yet"
          hint="Build one and click Save chart."
        />
      )}
      {charts && charts.length > 0 && (
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th style={{ width: 160 }}></th>
            </tr>
          </thead>
          <tbody>
            {charts.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td>{KIND_LABEL[c.kind] ?? c.kind}</td>
                <td>
                  <div className="row">
                    <button className="btn secondary" onClick={() => onOpen(c)}>
                      Open
                    </button>
                    <button className="chip" onClick={() => remove(c.id)}>
                      Delete <span>×</span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
