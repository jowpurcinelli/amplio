import { useEffect, useState } from "react";
import { loadSettings, saveSettings, type Settings as SettingsT } from "./config.js";
import { Segmentation } from "./views/Segmentation.js";
import { Funnel } from "./views/Funnel.js";
import { Retention } from "./views/Retention.js";
import { Settings } from "./views/Settings.js";

type View = "segmentation" | "funnel" | "retention" | "settings";

const NAV: { key: View; label: string; glyph: string }[] = [
  { key: "segmentation", label: "Segmentation", glyph: "📈" },
  { key: "funnel", label: "Funnels", glyph: "🔻" },
  { key: "retention", label: "Retention", glyph: "🔁" },
  { key: "settings", label: "Settings", glyph: "⚙️" },
];

const TITLES: Record<View, { title: string; sub: string }> = {
  segmentation: { title: "Segmentation", sub: "Event volume and unique users over time, broken down by any property." },
  funnel: { title: "Funnels", sub: "Ordered-step conversion within a window." },
  retention: { title: "Retention", sub: "How many users come back, by day offset from their first event." },
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
  const [view, setView] = useState<View>("segmentation");
  const [settings, setSettings] = useState<SettingsT>(loadSettings);
  const [theme, cycleTheme] = useTheme();

  const save = (s: SettingsT) => {
    saveSettings(s);
    setSettings(s);
  };

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
            onClick={() => setView(n.key)}
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

        {view === "segmentation" && <Segmentation settings={settings} />}
        {view === "funnel" && <Funnel settings={settings} />}
        {view === "retention" && <Retention settings={settings} />}
        {view === "settings" && <Settings settings={settings} onSave={save} />}
      </main>
    </div>
  );
}
