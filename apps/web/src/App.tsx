import { useEffect, useState } from "react";
import { loadSettings, saveSettings, type Settings as SettingsT } from "./config.js";
import {
  authSkipped,
  clearToken,
  getToken,
  me as fetchMe,
  myProjects,
  unskipAuth,
  type AuthUser,
  type UserProject,
} from "./auth.js";
import { Login } from "./views/Login.js";
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

const NAV_SECTIONS: { section: string; items: { key: View; label: string; glyph: string }[] }[] = [
  {
    section: "Overview",
    items: [
      { key: "events", label: "Events", glyph: "📋" },
      { key: "live", label: "Live", glyph: "🟢" },
    ],
  },
  {
    section: "Analyze",
    items: [
      { key: "segmentation", label: "Segmentation", glyph: "📈" },
      { key: "funnel", label: "Funnels", glyph: "🔻" },
      { key: "retention", label: "Retention", glyph: "🔁" },
      { key: "users", label: "Users", glyph: "👤" },
      { key: "cohorts", label: "Cohorts", glyph: "🎯" },
      { key: "replays", label: "Replays", glyph: "🎬" },
    ],
  },
  {
    section: "Experiment",
    items: [
      { key: "flags", label: "Flags", glyph: "🚩" },
      { key: "experiments", label: "Experiments", glyph: "🧪" },
    ],
  },
  {
    section: "Saved",
    items: [
      { key: "dashboards", label: "Dashboards", glyph: "📊" },
      { key: "library", label: "Library", glyph: "📁" },
    ],
  },
  {
    section: "Workspace",
    items: [
      { key: "keys", label: "API keys", glyph: "🔑" },
      { key: "settings", label: "Settings", glyph: "⚙️" },
    ],
  },
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

const ACTIVE_PROJECT_KEY = "amplio_active_project";

export default function App() {
  const [view, setView] = useState<View>("events");
  const [settings, setSettings] = useState<SettingsT>(loadSettings);
  const [loaded, setLoaded] = useState<{ kind: ChartKind; definition: Record<string, unknown> } | null>(null);
  const [theme, cycleTheme] = useTheme();

  // Auth state. `authReady` gates the first paint until we know whether a stored
  // token is still valid, so the app never flashes the dashboard before the gate.
  const [authReady, setAuthReady] = useState(false);
  const [skipped, setSkipped] = useState<boolean>(authSkipped);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [projects, setProjects] = useState<UserProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_PROJECT_KEY),
  );

  const save = (s: SettingsT) => {
    saveSettings(s);
    setSettings(s);
  };

  // Point analytics at a project's read key automatically, keeping the API URL.
  // Persist it so the choice survives a reload even if /me/projects is slow.
  // Always adopt the target project's key (even when empty) so we never keep
  // querying the previously selected project's data after switching.
  const selectProject = (p: UserProject) => {
    setActiveProjectId(p.id);
    localStorage.setItem(ACTIVE_PROJECT_KEY, p.id);
    setSettings((s) => {
      const next = { ...s, readKey: p.readKey ?? "" };
      saveSettings(next);
      return next;
    });
  };

  const loadProjects = async (token: string) => {
    const { projects: list } = await myProjects(settings.apiUrl, token);
    setProjects(list);
    const stored = localStorage.getItem(ACTIVE_PROJECT_KEY);
    const active = list.find((p) => p.id === stored) ?? list[0];
    if (active) selectProject(active);
    return list;
  };

  // On load, revalidate a stored session token. On any failure we fall back to
  // the gate (or the API-key path if the user previously chose it).
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setAuthReady(true);
      return;
    }
    (async () => {
      try {
        const { user: u } = await fetchMe(settings.apiUrl, token);
        setUser(u);
        // Loading projects is best-effort: a transient failure here must not
        // invalidate an otherwise-valid session (Settings still works).
        try {
          await loadProjects(token);
        } catch {
          /* keep the session; projects can load later */
        }
      } catch {
        // Only a failed /auth/me means the token is actually invalid.
        clearToken();
      } finally {
        setAuthReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAuthed = async (u: AuthUser) => {
    setUser(u);
    const token = getToken();
    if (token) {
      try {
        await loadProjects(token);
      } catch {
        /* projects load is best-effort; Settings still works as a fallback */
      }
    }
  };

  const logout = () => {
    clearToken();
    unskipAuth();
    localStorage.removeItem(ACTIVE_PROJECT_KEY);
    setUser(null);
    setProjects([]);
    setActiveProjectId(null);
    setSkipped(false);
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

  // Hold the first paint until the stored token has been checked.
  if (!authReady) return <div className="auth-screen" />;

  // Gate: no session and the API-key path was not chosen -> show login.
  if (!user && !skipped) {
    return <Login apiUrl={settings.apiUrl} onAuthed={onAuthed} onSkip={() => setSkipped(true)} />;
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-dot" />
          Amplio
        </div>
        {user && projects.length > 0 && (
          <div className="proj-switch">
            <label>Project</label>
            <select
              value={activeProjectId ?? ""}
              onChange={(e) => {
                const p = projects.find((x) => x.id === e.target.value);
                if (p) selectProject(p);
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {NAV_SECTIONS.map((sec) => (
          <div key={sec.section}>
            <div className="nav-section">{sec.section}</div>
            {sec.items.map((n) => (
              <button
                key={n.key}
                className={`nav-item${view === n.key ? " active" : ""}`}
                onClick={() => navigate(n.key)}
              >
                <span className="nav-glyph" aria-hidden>{n.glyph}</span>
                {n.label}
              </button>
            ))}
          </div>
        ))}
        <div className="nav-spacer" />
        <button className="nav-item" onClick={cycleTheme}>
          <span className="nav-glyph" aria-hidden>🎨</span>
          Theme: {theme}
        </button>
        {user ? (
          <button className="nav-item" onClick={logout} title={user.email}>
            <span className="nav-glyph" aria-hidden>🚪</span>
            Log out
          </button>
        ) : (
          <button className="nav-item" onClick={logout}>
            <span className="nav-glyph" aria-hidden>🔐</span>
            Sign in
          </button>
        )}
        {user && <div className="sidebar-footer">Signed in as {user.email}</div>}
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
