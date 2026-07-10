import { useEffect, useMemo, useState } from "react";
import type { Settings } from "../config.js";
import {
  listDashboards,
  createDashboard,
  updateDashboard,
  deleteDashboard,
  listCharts,
  type Dashboard,
  type SavedChart,
} from "../api.js";
import { Field } from "../components/Field.js";
import { ChartTile } from "../components/ChartTile.js";
import { EmptyState } from "../components/EmptyState.js";

export function Dashboards({ settings }: { settings: Settings }) {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [charts, setCharts] = useState<SavedChart[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [newName, setNewName] = useState("");
  const [addChartId, setAddChartId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    Promise.all([listDashboards(settings), listCharts(settings)])
      .then(([d, c]) => {
        setDashboards(d);
        setCharts(c);
        setError(null);
        setSelectedId((prev) => prev || d[0]?.id || "");
      })
      .catch((e) =>
        setError(String(e).includes("503") ? "Dashboards need a metadata store (DATABASE_URL)." : String(e)),
      );
  };

  useEffect(load, [settings]);

  const selected = useMemo(() => dashboards.find((d) => d.id === selectedId) ?? null, [dashboards, selectedId]);
  const chartById = useMemo(() => new Map(charts.map((c) => [c.id, c])), [charts]);

  const create = async () => {
    if (!newName.trim()) return;
    const d = await createDashboard(settings, { name: newName.trim(), layout: [] });
    setNewName("");
    setSelectedId(d.id);
    load();
  };

  const addChart = async () => {
    if (!selected || !addChartId) return;
    await updateDashboard(settings, selected.id, {
      name: selected.name,
      layout: [...selected.layout, addChartId],
    });
    setAddChartId("");
    load();
  };

  const removeTile = async (index: number) => {
    if (!selected) return;
    await updateDashboard(settings, selected.id, {
      name: selected.name,
      layout: selected.layout.filter((_, i) => i !== index),
    });
    load();
  };

  const removeDashboard = async () => {
    if (!selected) return;
    await deleteDashboard(settings, selected.id);
    setSelectedId("");
    load();
  };

  return (
    <>
      <div className="card">
        <div className="controls">
          <Field label="Dashboard">
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              <option value="">Select a dashboard</option>
              {dashboards.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Field label="New dashboard">
            <input type="text" placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </Field>
          <button className="btn" onClick={create} disabled={!newName.trim()}>
            Create
          </button>
          {selected && (
            <>
              <Field label="Add saved chart">
                <select value={addChartId} onChange={(e) => setAddChartId(e.target.value)}>
                  <option value="">Pick a chart</option>
                  {charts.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>
              <button className="btn" onClick={addChart} disabled={!addChartId}>
                Add tile
              </button>
              <button className="btn secondary" onClick={removeDashboard}>
                Delete dashboard
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="card"><div className="error">{error}</div></div>}

      {selected && selected.layout.length === 0 && (
        <div className="card">
          <EmptyState
            icon="dashboards"
            title="No tiles yet"
            hint="Save charts in the analysis views, then add them here."
          />
        </div>
      )}

      {selected && selected.layout.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))",
            gap: 16,
          }}
        >
          {selected.layout.map((chartId, i) => {
            const chart = chartById.get(chartId);
            if (!chart) {
              return (
                <div className="card" key={i} style={{ margin: 0 }}>
                  <EmptyState
                    icon="dashboards"
                    title="Chart no longer exists"
                    hint="This saved chart was deleted. Remove the tile to tidy up."
                  />
                  <button className="chip" onClick={() => removeTile(i)}>Remove <span>×</span></button>
                </div>
              );
            }
            return (
              <div key={i} style={{ position: "relative" }}>
                <button
                  className="chip"
                  onClick={() => removeTile(i)}
                  style={{ position: "absolute", top: 12, right: 12, zIndex: 2 }}
                >
                  ×
                </button>
                <ChartTile chart={chart} settings={settings} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
