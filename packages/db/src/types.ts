export type KeyKind = "write" | "read";

export interface ResolvedKey {
  projectId: string;
  kind: KeyKind;
}
export interface ApiKey {
  id: string;
  projectId: string;
  kind: KeyKind;
  key: string;
  label: string | null;
  createdAt: string;
  revokedAt: string | null;
}
export interface Chart {
  id: string;
  projectId: string;
  name: string;
  kind: string;
  definition: unknown;
  createdAt: string;
  updatedAt: string;
}
export interface Dashboard {
  id: string;
  projectId: string;
  name: string;
  layout: unknown;
  createdAt: string;
  updatedAt: string;
}
export interface Cohort {
  id: string;
  projectId: string;
  name: string;
  definition: unknown;
  createdAt: string;
}

export interface User {
  id: string;
  orgId: string | null;
  email: string;
  name: string | null;
  createdAt: string;
}
export interface NewUser {
  orgId: string | null;
  email: string;
  name: string | null;
  passwordHash: string;
}
export interface UserProject {
  id: string;
  name: string;
  readKey: string | null;
  writeKey: string | null;
  /** The org this project belongs to, and the user's role in it. */
  orgId: string;
  orgName: string;
  role: Role;
}

/** Access levels within an org, from most to least privileged. */
export type Role = "owner" | "admin" | "member";

export interface OrgMembership {
  orgId: string;
  orgName: string;
  role: Role;
}
/** A member of an org, as shown in the members list. */
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
  acceptedAt: string | null;
}

export interface FlagVariant {
  key: string;
  weight: number;
}
export interface Flag {
  id: string;
  projectId: string;
  key: string;
  description: string | null;
  enabled: boolean;
  /** Percent of users the flag is on for when it has no variants (0-100). */
  rollout: number;
  /** Weighted variants for multivariate flags; empty means a boolean flag. */
  variants: FlagVariant[];
  createdAt: string;
  updatedAt: string;
}
export interface FlagInput {
  key: string;
  description?: string | null;
  enabled: boolean;
  rollout: number;
  variants: FlagVariant[];
}

export interface ChartInput {
  name: string;
  kind: string;
  definition: unknown;
}
export interface DashboardInput {
  name: string;
  layout: unknown;
}
export interface CohortInput {
  name: string;
  definition: unknown;
}

/**
 * The metadata store. One interface, two backends: Postgres (self-host, multi
 * user) and SQLite (embedded, for the desktop app and single-node setups).
 * Consumers depend only on this, never on a specific driver.
 */
export interface Store {
  resolveKey(key: string): Promise<ResolvedKey | null>;
  listApiKeys(projectId: string): Promise<ApiKey[]>;
  createApiKey(projectId: string, kind: KeyKind, label: string | null): Promise<ApiKey>;
  revokeApiKey(projectId: string, id: string): Promise<boolean>;

  listCharts(projectId: string): Promise<Chart[]>;
  getChart(projectId: string, id: string): Promise<Chart | null>;
  createChart(projectId: string, input: ChartInput): Promise<Chart>;
  updateChart(projectId: string, id: string, input: ChartInput): Promise<Chart | null>;
  deleteChart(projectId: string, id: string): Promise<boolean>;

  listDashboards(projectId: string): Promise<Dashboard[]>;
  getDashboard(projectId: string, id: string): Promise<Dashboard | null>;
  createDashboard(projectId: string, input: DashboardInput): Promise<Dashboard>;
  updateDashboard(projectId: string, id: string, input: DashboardInput): Promise<Dashboard | null>;
  deleteDashboard(projectId: string, id: string): Promise<boolean>;

  listCohorts(projectId: string): Promise<Cohort[]>;
  createCohort(projectId: string, input: CohortInput): Promise<Cohort>;
  deleteCohort(projectId: string, id: string): Promise<boolean>;

  createUser(input: NewUser): Promise<User>;
  getUser(id: string): Promise<User | null>;
  getCredentials(email: string): Promise<{ user: User; passwordHash: string } | null>;
  createOrg(name: string): Promise<{ id: string }>;
  /** Delete an org and everything under it (projects, keys, memberships). Used to roll back a failed signup. */
  deleteOrg(id: string): Promise<void>;
  createProject(orgId: string, name: string): Promise<{ id: string }>;
  renameProject(orgId: string, projectId: string, name: string): Promise<boolean>;
  deleteProject(orgId: string, projectId: string): Promise<boolean>;
  /** Projects the user can access (across all their orgs) with each project's keys. */
  getUserProjects(userId: string): Promise<UserProject[]>;

  // --- org membership + roles ---
  addMember(orgId: string, userId: string, role: Role): Promise<void>;
  removeMember(orgId: string, userId: string): Promise<boolean>;
  setMemberRole(orgId: string, userId: string, role: Role): Promise<boolean>;
  listMembers(orgId: string): Promise<Member[]>;
  /** The user's role in the org, or null if they are not a member. */
  getMemberRole(orgId: string, userId: string): Promise<Role | null>;
  /** Orgs the user belongs to, with their role in each. */
  listUserOrgs(userId: string): Promise<OrgMembership[]>;
  /** Count members with a given role (used to protect the last owner). */
  countMembersWithRole(orgId: string, role: Role): Promise<number>;

  // --- invites ---
  createInvite(orgId: string, email: string, role: Role, token: string): Promise<Invite>;
  listInvites(orgId: string): Promise<Invite[]>;
  getInviteByToken(token: string): Promise<Invite | null>;
  markInviteAccepted(id: string): Promise<void>;
  deleteInvite(orgId: string, id: string): Promise<boolean>;

  listFlags(projectId: string): Promise<Flag[]>;
  getFlag(projectId: string, key: string): Promise<Flag | null>;
  createFlag(projectId: string, input: FlagInput): Promise<Flag>;
  updateFlag(projectId: string, id: string, input: FlagInput): Promise<Flag | null>;
  deleteFlag(projectId: string, id: string): Promise<boolean>;

  close(): Promise<void>;
}
