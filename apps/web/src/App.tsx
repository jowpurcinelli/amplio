import { useEffect, useState } from "react";
import { loadSettings, saveSettings, type Settings as SettingsT } from "./config.js";
import {
  authSkipped,
  clearToken,
  getToken,
  me as fetchMe,
  myProjects,
  adminMe,
  unskipAuth,
  type AuthUser,
  type UserProject,
} from "./auth.js";
import { Login } from "./views/Login.js";
import { Admin } from "./views/Admin.js";
import { AccountSettings } from "./views/AccountSettings.js";
import { Icon } from "./components/Icon.js";
import { CommandPalette, type Command } from "./components/CommandPalette.js";
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
import { Team } from "./views/Team.js";
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
  | "team"
  | "account"
  | "admin"
  | "keys"
  | "settings";

const NAV_SECTIONS: { section: string; items: { key: View; label: string; icon: string }[] }[] = [
  {
    section: "Overview",
    items: [
      { key: "events", label: "Events", icon: "events" },
      { key: "live", label: "Live", icon: "live" },
    ],
  },
  {
    section: "Analyze",
    items: [
      { key: "segmentation", label: "Segmentation", icon: "segmentation" },
      { key: "funnel", label: "Funnels", icon: "funnel" },
      { key: "retention", label: "Retention", icon: "retention" },
      { key: "users", label: "Users", icon: "users" },
      { key: "cohorts", label: "Cohorts", icon: "cohorts" },
      { key: "replays", label: "Replays", icon: "replays" },
    ],
  },
  {
    section: "Experiment",
    items: [
      { key: "flags", label: "Flags", icon: "flags" },
      { key: "experiments", label: "Experiments", icon: "experiments" },
    ],
  },
  {
    section: "Saved",
    items: [
      { key: "dashboards", label: "Dashboards", icon: "dashboards" },
      { key: "library", label: "Library", icon: "library" },
    ],
  },
  {
    section: "Workspace",
    items: [
      { key: "team", label: "Team", icon: "team" },
      { key: "keys", label: "API keys", icon: "keys" },
      { key: "account", label: "Account", icon: "account" },
      { key: "admin", label: "Admin", icon: "admin" },
      { key: "settings", label: "Settings", icon: "settings" },
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
  team: { title: "Team", sub: "Members, roles, invites, and projects for the active org." },
  account: { title: "Account", sub: "Your password and account." },
  admin: { title: "Admin", sub: "Instance-wide organizations and users." },
  keys: { title: "API keys", sub: "Write keys ingest events, read keys drive the dashboard." },
  settings: { title: "Settings", sub: "Point the dashboard at your Amplio query API." },
};

const themeIconFor = (theme: string): string => (theme === "light" ? "sun" : theme === "dark" ? "moon" : "monitor");

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
  const [isAdmin, setIsAdmin] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
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
        // Loading projects and admin status is best-effort: a transient failure
        // here must not invalidate an otherwise-valid session.
        try {
          await loadProjects(token);
          const { isAdmin: admin } = await adminMe(settings.apiUrl, token);
          setIsAdmin(admin);
        } catch {
          /* keep the session; these can load later */
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
        const { isAdmin: admin } = await adminMe(settings.apiUrl, token);
        setIsAdmin(admin);
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
    setIsAdmin(false);
    setSkipped(false);
    setView("events");
  };

  const navigate = (key: View) => {
    setLoaded(null); // manual navigation drops any pending loaded chart
    setView(key);
  };

  // Cmd/Ctrl-K opens the command palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Everything the palette can jump to or do: navigation + quick actions.
  const commands: Command[] = [
    ...NAV_SECTIONS.flatMap((sec) =>
      sec.items
        .filter((n) => ((n.key !== "team" && n.key !== "account") || user) && (n.key !== "admin" || isAdmin))
        .map((n) => ({
          id: `nav-${n.key}`,
          label: `Go to ${n.label}`,
          hint: sec.section,
          icon: n.icon,
          run: () => navigate(n.key),
        })),
    ),
    { id: "act-theme", label: "Toggle theme", hint: theme, icon: themeIconFor(theme), run: cycleTheme },
    ...(user && projects.length > 1
      ? projects.map((p) => ({
          id: `proj-${p.id}`,
          label: `Switch to ${p.name}`,
          hint: "Project",
          icon: "dashboards",
          run: () => selectProject(p),
        }))
      : []),
    user
      ? { id: "act-logout", label: "Log out", icon: "logout", run: logout }
      : { id: "act-signin", label: "Sign in", icon: "login", run: logout },
  ];

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

  const themeIcon = themeIconFor(theme);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-dot">
            <Icon name="segmentation" size={15} strokeWidth={2.4} />
          </span>
          Amplio
        </div>
        {NAV_SECTIONS.map((sec) => (
          <div key={sec.section}>
            <div className="nav-section">{sec.section}</div>
            {sec.items
              .filter((n) => ((n.key !== "team" && n.key !== "account") || user) && (n.key !== "admin" || isAdmin))
              .map((n) => (
                <button
                  key={n.key}
                  className={`nav-item${view === n.key ? " active" : ""}`}
                  onClick={() => navigate(n.key)}
                >
                  <span className="nav-glyph">
                    <Icon name={n.icon} size={18} />
                  </span>
                  {n.label}
                </button>
              ))}
          </div>
        ))}
        <div className="nav-spacer" />
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-title">{TITLES[view].title}</div>
          <div className="topbar-actions">
            <button className="cmdk-trigger" onClick={() => setPaletteOpen(true)} aria-label="Open command palette">
              <Icon name="search" size={15} />
              <span className="cmdk-trigger-label">Search</span>
              <span className="kbd">⌘K</span>
            </button>
            {user && projects.length > 0 && (
              <div className="switcher">
                <select
                  value={activeProjectId ?? ""}
                  aria-label="Active project"
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
            <button className="icon-btn" onClick={cycleTheme} title={`Theme: ${theme}`} aria-label="Toggle theme">
              <Icon name={themeIcon} size={17} />
            </button>
            {user ? (
              <>
                <button className="avatar" onClick={() => navigate("account")} title={user.email}>
                  <span className="avatar-badge">{user.email.slice(0, 1).toUpperCase()}</span>
                  <span className="avatar-email">{user.email}</span>
                </button>
                <button className="icon-btn" onClick={logout} title="Log out" aria-label="Log out">
                  <Icon name="logout" size={17} />
                </button>
              </>
            ) : (
              <button className="btn secondary small" onClick={logout}>
                <Icon name="login" size={15} />
                Sign in
              </button>
            )}
          </div>
        </header>

        <main className="main">
          <p className="page-sub view-head">{TITLES[view].sub}</p>

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
        {view === "team" &&
          (() => {
            const token = getToken();
            const active = projects.find((p) => p.id === activeProjectId) ?? projects[0];
            if (!user || !token || !active) {
              return (
                <div className="card">
                  <div className="empty-state">
                    <div className="empty-glyph"><Icon name="team" size={26} /></div>
                    <div className="empty-title">Team management needs an account</div>
                    <div className="empty-hint">
                      Sign in with an email account (not an API key) to manage members, roles, and projects.
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <Team
                apiUrl={settings.apiUrl}
                token={token}
                org={{ id: active.orgId, name: active.orgName, role: active.role }}
                projects={projects}
                onProjectsChanged={() => {
                  const t = getToken();
                  if (t) void loadProjects(t);
                }}
              />
            );
          })()}
        {view === "account" &&
          (() => {
            const token = getToken();
            if (!user || !token) {
              return (
                <div className="card">
                  <div className="empty-state">
                    <div className="empty-glyph"><Icon name="account" size={26} /></div>
                    <div className="empty-title">Account settings need an account</div>
                    <div className="empty-hint">Sign in with an email account to manage your password.</div>
                  </div>
                </div>
              );
            }
            return <AccountSettings apiUrl={settings.apiUrl} token={token} onDeleted={logout} />;
          })()}
        {view === "admin" &&
          isAdmin &&
          (() => {
            const token = getToken();
            return token ? <Admin apiUrl={settings.apiUrl} token={token} /> : null;
          })()}
        {view === "keys" && <Keys settings={settings} />}
        {view === "settings" && <Settings settings={settings} onSave={save} />}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );
}
