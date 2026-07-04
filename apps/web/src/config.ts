export interface Settings {
  apiUrl: string;
  readKey: string;
}

const KEY = "amplio_dashboard_settings";

/**
 * Resolve the default API URL:
 *  1. A build-time VITE_API_URL (set this on Vercel/CI to bake in a backend).
 *  2. Local dev: the query API on :8788.
 *  3. Otherwise same-origin /api (self-host behind the Caddy proxy).
 * A visitor can always override both in Settings.
 */
function defaultApiUrl(): string {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (typeof location !== "undefined") {
    const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (!local) return `${location.origin}/api`;
  }
  return "http://localhost:8788";
}

function defaults(): Settings {
  return { apiUrl: defaultApiUrl(), readKey: import.meta.env.VITE_READ_KEY ?? "dev-read-key" };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    return { ...defaults(), ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return defaults();
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
