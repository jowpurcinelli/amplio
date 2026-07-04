export interface Settings {
  apiUrl: string;
  readKey: string;
}

const KEY = "amplio_dashboard_settings";

/**
 * In local dev the query API runs on :8788. When the dashboard is served from a
 * real host, the API is reverse-proxied under the same origin at /api, so we
 * default there and avoid a hard-coded hostname.
 */
function defaultApiUrl(): string {
  if (typeof location !== "undefined") {
    const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (!local) return `${location.origin}/api`;
  }
  return "http://localhost:8788";
}

function defaults(): Settings {
  return { apiUrl: defaultApiUrl(), readKey: "dev-read-key" };
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
