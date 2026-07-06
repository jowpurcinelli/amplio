// Session auth for the hosted/multi-user dashboard. This layer is additive: the
// dashboard still works with a raw read key (desktop app, self-host advanced
// mode), so everything here degrades gracefully when there is no account.

const TOKEN_KEY = "amplio_token";
const SKIP_KEY = "amplio_auth_skipped";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}
export interface UserProject {
  id: string;
  name: string;
  readKey: string | null;
  writeKey: string | null;
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** True when the user chose the API-key path instead of an account (or on desktop). */
export function authSkipped(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === "1";
  } catch {
    return false;
  }
}
export function skipAuth(): void {
  localStorage.setItem(SKIP_KEY, "1");
}
export function unskipAuth(): void {
  localStorage.removeItem(SKIP_KEY);
}

async function authFetch<T>(apiUrl: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiUrl}${path}`, init);
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

const jsonInit = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export function signup(apiUrl: string, input: { email: string; password: string; name?: string }) {
  return authFetch<{ token: string; user: AuthUser }>(apiUrl, "/auth/signup", jsonInit(input));
}
export function login(apiUrl: string, input: { email: string; password: string }) {
  return authFetch<{ token: string; user: AuthUser }>(apiUrl, "/auth/login", jsonInit(input));
}
export function me(apiUrl: string, token: string) {
  return authFetch<{ user: AuthUser }>(apiUrl, "/auth/me", {
    headers: { authorization: `Bearer ${token}` },
  });
}
export function myProjects(apiUrl: string, token: string) {
  return authFetch<{ projects: UserProject[] }>(apiUrl, "/me/projects", {
    headers: { authorization: `Bearer ${token}` },
  });
}
