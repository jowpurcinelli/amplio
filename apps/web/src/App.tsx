import { useEffect, useState } from "react";
import { loadSettings, saveSettings, type Settings as SettingsT } from "./config.js";
import { Segmentation } from "./views/Segmentation.js";
import { Funnel } from "./views/Funnel.js";
import { Retention } from "./views/Retention.js";
import { Users } from "./views/Users.js";
import { Events } from "./views/Events.js";
import { Live } from "./views/Live.js";
import { Replays } from "./views/Replays.js";
import { Dashboards } from "./views/Dashboards.js";
import { Cohorts } from "./views/Cohorts.js";
import { Flags } from "./views/Flags.js";
import { Experiments } from "./views/Experiments.js";
import { Library } from "./views/Library.js";
import { Keys } from "./views/Keys.js";
import { Settings } from "./views/Settings.js";
import type { ChartKind, SavedChart } from "./api.js";

type View =
  | "events"
  | "live"
  | "segmentation"
  | "funnel"
  | "retention"
  | "users"
  | "replays"
  | "cohorts"
  | "flags"
  | "experiments"
  | "dashboards"
  | "library"
  | "keys"
  | "settings";

const NAV: { key: View; label: string; glyph: string }[] = [
  { key: "events", label: "Events", glyph: "📋" },
  { key: "live", label: "Live", glyph: "🟢" },
  { key: "dashboards", label: "Dashboards", glyph: "📊" },
  { key: "segmentation", label: "Segmentation", glyph: "📈" },
  { key: "funnel", label: "Funnels", glyph: "🔻" },
  { key: "retention", label: "Retention", glyph: "🔁" },
  { key: "users", label: "Users", glyph: "👤" },
  { key: "replays", label: "Replays", glyph: "🎬" },
  { key: "cohorts", label: "Cohorts", glyph: "🎯" },
  { key: "flags", label: "Flags", glyph: "🚩" },
  { key: "experiments", label: "Experiments", glyph: "🧪" },
  { key: "library", label: "Library", glyph: "📁" },
  { key: "keys", label: "API keys", glyph: "🔑" },
  { key: "settings", label: "Settings", glyph: "⚙️" },
];

const TITLES: Record<View, { title: string; sub: string }> = {
  events: { title: "Events", sub: "Every event type Amplio is receiving, by volume." },
  live: { title: "Live", sub: "Events as they arrive, in real time." },
  segmentation: { title: "Segmentation", sub: "Event volume and unique users over time, broken down by any property." },
  funnel: { title: "Funnels", sub: "Ordered-step conversion within a window." },
  retention: { title: "Retention", sub: "How many users come back, by day offset from their first event." },
  users: { title: "Users", sub: "Look up a single user or device and see their full event stream." },
  replays: { title: "Replays", sub: "Watch recorded sessions. Every replay stays on your own infrastructure." },
  cohorts: { title: "Cohorts", sub: "Define a group of users by an action, then apply it as a filter in Segmentation." },
  flags: { title: "Flags", sub: "Feature flags and A/B tests. Roll out gradually and evaluate from any SDK." },
  experiments: { title: "Experiments", sub: "Conversion by variant. Compare how each variant of a flag performs on a goal." },
  dashboards: { title: "Dashboards", sub: "Compose your saved charts into a live grid." },
  library: { title: "Library", sub: "Your saved charts. Open one to load it back into its builder." },
  keys: { title: "API keys", sub: "Write keys ingest events, read keys drive the dashboard." },
  settings: { title: "Settings", sub: "Point the dashboard at your Amplio query API." },
};

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState<string>(() => localStorage.getItem("amplio_theme") ?? "system");
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    localStorage.setItem("amplio_theme", theme);
  }, [theme]);
  const cycle = () => setTheme((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system"));
  return [theme, cycle];
}

export default function App() {
  const [view, setView] = useState<View>("events");
  const [settings, setSettings] = useState<SettingsT>(loadSettings);
  const [loaded, setLoaded] = useState<{ kind: ChartKind; definition: Record<string, unknown> } | null>(null);
  const [theme, cycleTheme] = useTheme();

  const save = (s: SettingsT) => {
    saveSettings(s);
    setSettings(s);
  };

  const navigate = (key: View) => {
    setLoaded(null); // manual navigation drops any pending loaded chart
    setView(key);
  };

  const openChart = (chart: SavedChart) => {
    setLoaded({ kind: chart.kind, definition: chart.definition });
    setView(chart.kind);
  };

  const exploreEvent = (eventType: string) => {
    setLoaded({
      kind: "segmentation",
      definition: { eventType, measure: "total", granularity: "day", days: 30 },
    });
    setView("segmentation");
  };

  const initialFor = (kind: ChartKind) =>
    loaded && loaded.kind === kind ? loaded.definition : undefined;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-dot" />
          Amplio
        </div>
        {NAV.map((n) => (
          <button
            key={n.key}
            className={`nav-item${view === n.key ? " active" : ""}`}
            onClick={() => navigate(n.key)}
          >
            <span aria-hidden>{n.glyph}</span>
            {n.label}
          </button>
        ))}
        <div className="nav-spacer" />
        <button className="nav-item" onClick={cycleTheme}>
          <span aria-hidden>🎨</span>
          Theme: {theme}
        </button>
      </aside>

      <main className="main">
        <div className="page-head">
          <h1 className="page-title">{TITLES[view].title}</h1>
        </div>
        <p className="page-sub">{TITLES[view].sub}</p>

        {view === "events" && <Events settings={settings} onExplore={exploreEvent} />}
        {view === "live" && <Live settings={settings} />}
        {view === "segmentation" && <Segmentation settings={settings} initial={initialFor("segmentation")} />}
        {view === "funnel" && <Funnel settings={settings} initial={initialFor("funnel")} />}
        {view === "retention" && <Retention settings={settings} initial={initialFor("retention")} />}
        {view === "users" && <Users settings={settings} />}
        {view === "replays" && <Replays settings={settings} />}
        {view === "cohorts" && <Cohorts settings={settings} />}
        {view === "flags" && <Flags settings={settings} />}
        {view === "experiments" && <Experiments settings={settings} />}
        {view === "dashboards" && <Dashboards settings={settings} />}
        {view === "library" && <Library settings={settings} onOpen={openChart} />}
        {view === "keys" && <Keys settings={settings} />}
        {view === "settings" && <Settings settings={settings} onSave={save} />}
      </main>
    </div>
  );
}
