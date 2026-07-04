export interface Settings {
  apiUrl: string;
  readKey: string;
}

const KEY = "amplio_dashboard_settings";

const DEFAULTS: Settings = {
  apiUrl: "http://localhost:8788",
  readKey: "dev-read-key",
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
