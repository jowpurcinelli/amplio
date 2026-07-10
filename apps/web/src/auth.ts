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
  orgId: string;
  orgName: string;
  role: Role;
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

/** Whether the session user is an instance superadmin (AMPLIO_ADMIN_EMAILS). */
export function adminMe(apiUrl: string, token: string) {
  return authFetch<{ isAdmin: boolean }>(apiUrl, "/admin/me", {
    headers: { authorization: `Bearer ${token}` },
  });
}

// --- org / team management (session-token auth) ---
export type Role = "owner" | "admin" | "member";
export interface Member {
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: string;
}
export interface Invite {
  id: string;
  orgId: string;
  email: string;
  role: Role;
  token: string;
  createdAt: string;
}

const authHeader = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });
const jsonAuth = (token: string, method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});

export const listMembers = (apiUrl: string, token: string, orgId: string) =>
  authFetch<{ members: Member[] }>(apiUrl, `/orgs/${orgId}/members`, authHeader(token)).then((r) => r.members);
export const setMemberRole = (apiUrl: string, token: string, orgId: string, userId: string, role: Role) =>
  authFetch<{ ok: true }>(apiUrl, `/orgs/${orgId}/members/${userId}`, jsonAuth(token, "PATCH", { role }));
export const removeMember = (apiUrl: string, token: string, orgId: string, userId: string) =>
  authFetch<{ ok: true }>(apiUrl, `/orgs/${orgId}/members/${userId}`, { method: "DELETE", ...authHeader(token) });

export const listInvites = (apiUrl: string, token: string, orgId: string) =>
  authFetch<{ invites: Invite[] }>(apiUrl, `/orgs/${orgId}/invites`, authHeader(token)).then((r) => r.invites);
export const createInvite = (apiUrl: string, token: string, orgId: string, email: string, role: Role) =>
  authFetch<{ invite: Invite }>(apiUrl, `/orgs/${orgId}/invites`, jsonAuth(token, "POST", { email, role })).then(
    (r) => r.invite,
  );
export const deleteInvite = (apiUrl: string, token: string, orgId: string, id: string) =>
  authFetch<{ ok: true }>(apiUrl, `/orgs/${orgId}/invites/${id}`, { method: "DELETE", ...authHeader(token) });
export const acceptInvite = (apiUrl: string, token: string, inviteToken: string) =>
  authFetch<{ ok: true; orgId: string; role: Role }>(apiUrl, "/invites/accept", jsonAuth(token, "POST", { token: inviteToken }));

export type PlanId = "free" | "pro" | "scale";
export interface Plan {
  id: PlanId;
  name: string;
  monthlyEvents: number | null;
  priceUsd: number;
}
export interface Usage {
  plan: PlanId;
  limit: number | null;
  events: number;
  projects: { id: string; name: string; events: number }[];
  periodStart: number;
  plans: Record<PlanId, Plan>;
}
export const getUsage = (apiUrl: string, token: string, orgId: string) =>
  authFetch<Usage>(apiUrl, `/orgs/${orgId}/usage`, authHeader(token));
export const setPlan = (apiUrl: string, token: string, orgId: string, plan: PlanId) =>
  authFetch<{ ok: true; plan: PlanId }>(apiUrl, `/orgs/${orgId}/plan`, jsonAuth(token, "POST", { plan }));

export const renameOrg = (apiUrl: string, token: string, orgId: string, name: string) =>
  authFetch<{ ok: true }>(apiUrl, `/orgs/${orgId}/name`, jsonAuth(token, "PATCH", { name }));

export const createProject = (apiUrl: string, token: string, orgId: string, name: string) =>
  authFetch<{ project: { id: string; name: string } }>(apiUrl, `/orgs/${orgId}/projects`, jsonAuth(token, "POST", { name }));
export const renameProject = (apiUrl: string, token: string, orgId: string, projectId: string, name: string) =>
  authFetch<{ ok: true }>(apiUrl, `/orgs/${orgId}/projects/${projectId}`, jsonAuth(token, "PATCH", { name }));
export const deleteProject = (apiUrl: string, token: string, orgId: string, projectId: string) =>
  authFetch<{ ok: true }>(apiUrl, `/orgs/${orgId}/projects/${projectId}`, { method: "DELETE", ...authHeader(token) });
