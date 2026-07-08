import { useEffect, useState } from "react";
import { Field } from "../components/Field.js";
import { useToast } from "../components/Toast.js";
import {
  listMembers,
  setMemberRole,
  removeMember,
  listInvites,
  createInvite,
  deleteInvite,
  acceptInvite,
  createProject,
  renameProject,
  deleteProject,
  type Member,
  type Invite,
  type Role,
  type UserProject,
} from "../auth.js";

const ROLES: Role[] = ["owner", "admin", "member"];
const RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1 };

export function Team({
  apiUrl,
  token,
  org,
  projects,
  onProjectsChanged,
}: {
  apiUrl: string;
  token: string;
  org: { id: string; name: string; role: Role };
  projects: UserProject[];
  onProjectsChanged: () => void;
}) {
  const toast = useToast();
  const canManage = RANK[org.role] >= RANK.admin;
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");
  const [newProject, setNewProject] = useState("");
  const [joinToken, setJoinToken] = useState("");

  const load = async () => {
    try {
      setMembers(await listMembers(apiUrl, token, org.id));
      if (canManage) setInvites(await listInvites(apiUrl, token, org.id));
    } catch (e) {
      toast.err(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id]);

  const orgProjects = projects.filter((p) => p.orgId === org.id);

  const changeRole = async (m: Member, role: Role) => {
    try {
      await setMemberRole(apiUrl, token, org.id, m.userId, role);
      toast.ok(`${m.email} is now ${role}`);
      void load();
    } catch (e) {
      toast.err(e instanceof Error ? e.message : String(e));
    }
  };
  const kick = async (m: Member) => {
    try {
      await removeMember(apiUrl, token, org.id, m.userId);
      toast.ok(`Removed ${m.email}`);
      void load();
    } catch (e) {
      toast.err(e instanceof Error ? e.message : String(e));
    }
  };
  const invite = async () => {
    try {
      const inv = await createInvite(apiUrl, token, org.id, inviteEmail.trim(), inviteRole);
      toast.ok(`Invited ${inv.email}`);
      setInviteEmail("");
      void load();
    } catch (e) {
      toast.err(e instanceof Error ? e.message : String(e));
    }
  };
  const revokeInvite = async (inv: Invite) => {
    try {
      await deleteInvite(apiUrl, token, org.id, inv.id);
      void load();
    } catch (e) {
      toast.err(e instanceof Error ? e.message : String(e));
    }
  };
  const addProject = async () => {
    try {
      await createProject(apiUrl, token, org.id, newProject.trim());
      toast.ok(`Created "${newProject.trim()}"`);
      setNewProject("");
      onProjectsChanged();
    } catch (e) {
      toast.err(e instanceof Error ? e.message : String(e));
    }
  };
  const rename = async (p: UserProject) => {
    const name = prompt("Rename project", p.name);
    if (!name || name === p.name) return;
    try {
      await renameProject(apiUrl, token, org.id, p.id, name);
      onProjectsChanged();
    } catch (e) {
      toast.err(e instanceof Error ? e.message : String(e));
    }
  };
  const removeProject = async (p: UserProject) => {
    if (!confirm(`Delete project "${p.name}"? Its saved charts and keys are removed. Events already in ClickHouse stay.`)) return;
    try {
      await deleteProject(apiUrl, token, org.id, p.id);
      toast.ok(`Deleted "${p.name}"`);
      onProjectsChanged();
    } catch (e) {
      toast.err(e instanceof Error ? e.message : String(e));
    }
  };
  const join = async () => {
    try {
      await acceptInvite(apiUrl, token, joinToken.trim());
      toast.ok("Joined the org");
      setJoinToken("");
      onProjectsChanged();
    } catch (e) {
      toast.err(e instanceof Error ? e.message : String(e));
    }
  };

  const copyLink = (inv: Invite) => {
    void navigator.clipboard?.writeText(inv.token);
    toast.ok("Invite token copied");
  };

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{org.name}</div>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              You are {org.role === "owner" ? "an owner" : `a ${org.role}`} of this org.
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Members</h3>
        {!members && <div className="empty">Loading members…</div>}
        {members && (
          <table className="data">
            <thead>
              <tr>
                <th>Member</th>
                <th style={{ width: 160 }}>Role</th>
                {canManage && <th style={{ width: 90 }}></th>}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{m.name || m.email}</div>
                    {m.name && <div style={{ color: "var(--muted)", fontSize: 12 }}>{m.email}</div>}
                  </td>
                  <td>
                    {canManage ? (
                      <select value={m.role} onChange={(e) => changeRole(m, e.target.value as Role)}>
                        {ROLES.map((r) => (
                          <option key={r} value={r} disabled={r === "owner" && org.role !== "owner"}>
                            {r}
                          </option>
                        ))}
                      </select>
                    ) : (
                      m.role
                    )}
                  </td>
                  {canManage && (
                    <td>
                      <button className="btn secondary" onClick={() => kick(m)}>
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canManage && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Invite a teammate</h3>
          <div className="controls">
            <Field label="Email">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
                style={{ minWidth: 240 }}
              />
            </Field>
            <Field label="Role">
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
                <option value="member">member</option>
                <option value="admin">admin</option>
                {org.role === "owner" && <option value="owner">owner</option>}
              </select>
            </Field>
            <button className="btn" onClick={invite} disabled={!inviteEmail.trim()}>
              Send invite
            </button>
          </div>
          {invites.length > 0 && (
            <table className="data" style={{ marginTop: 14 }}>
              <thead>
                <tr>
                  <th>Pending invite</th>
                  <th style={{ width: 100 }}>Role</th>
                  <th style={{ width: 200 }}>Token</th>
                  <th style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.email}</td>
                    <td>{inv.role}</td>
                    <td>
                      <button className="linklike" onClick={() => copyLink(inv)}>
                        Copy token
                      </button>
                    </td>
                    <td>
                      <button className="btn secondary" onClick={() => revokeInvite(inv)}>
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
            Share the invite token with your teammate. They sign in, open Team, and paste it under "Join an org".
          </div>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Projects</h3>
        <table className="data">
          <thead>
            <tr>
              <th>Project</th>
              {canManage && <th style={{ width: 160 }}></th>}
            </tr>
          </thead>
          <tbody>
            {orgProjects.map((p) => (
              <tr key={p.id}>
                <td style={{ fontWeight: 600 }}>{p.name}</td>
                {canManage && (
                  <td>
                    <div className="row">
                      <button className="btn secondary" onClick={() => rename(p)}>
                        Rename
                      </button>
                      <button
                        className="btn secondary"
                        onClick={() => removeProject(p)}
                        disabled={orgProjects.length <= 1}
                        title={orgProjects.length <= 1 ? "An org needs at least one project" : undefined}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {canManage && (
          <div className="row" style={{ marginTop: 12 }}>
            <input
              type="text"
              value={newProject}
              onChange={(e) => setNewProject(e.target.value)}
              placeholder="New project name"
              style={{ minWidth: 240 }}
            />
            <button className="btn" onClick={addProject} disabled={!newProject.trim()}>
              Create project
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Join an org</h3>
        <div className="row">
          <input
            type="text"
            value={joinToken}
            onChange={(e) => setJoinToken(e.target.value)}
            placeholder="Paste an invite token"
            style={{ minWidth: 280 }}
          />
          <button className="btn" onClick={join} disabled={!joinToken.trim()}>
            Join
          </button>
        </div>
      </div>
    </>
  );
}
