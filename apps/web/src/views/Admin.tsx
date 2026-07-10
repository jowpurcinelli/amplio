import { useEffect, useState } from "react";
import { useToast } from "../components/Toast.js";
import { formatNumber } from "../lib/format.js";

type PlanId = "free" | "pro" | "scale";

interface AdminOrg {
  id: string;
  name: string;
  plan: PlanId;
  members: number;
  projects: number;
  createdAt: string;
}

interface Overview {
  totals: { orgs: number; users: number };
  orgs: AdminOrg[];
}

const PLANS: PlanId[] = ["free", "pro", "scale"];

export function Admin({ apiUrl, token }: { apiUrl: string; token: string }) {
  const toast = useToast();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function getJson<T>(path: string): Promise<T> {
    const res = await fetch(apiUrl + path, {
      headers: { authorization: "Bearer " + token },
    });
    if (!res.ok) throw new Error((await res.json()).error || res.status);
    return res.json() as Promise<T>;
  }

  async function postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(apiUrl + path, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.status);
    return res.json() as Promise<T>;
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const data = await getJson<Overview>("/admin/overview");
        if (!alive) return;
        setOverview(data);
        setDenied(false);
      } catch (e) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "403" || /forbidden|admin/i.test(msg)) {
          setDenied(true);
        } else {
          toast.err(msg);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, token]);

  const changePlan = async (org: AdminOrg, plan: PlanId) => {
    setSavingId(org.id);
    try {
      await postJson<{ ok: true; plan: PlanId }>(`/admin/orgs/${org.id}/plan`, { plan });
      setOverview((prev) =>
        prev
          ? { ...prev, orgs: prev.orgs.map((o) => (o.id === org.id ? { ...o, plan } : o)) }
          : prev,
      );
      toast.ok(`${org.name} is now on the ${plan} plan`);
    } catch (e) {
      toast.err(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Instance admin</h3>
        <p className="empty">Loading instance data...</p>
      </div>
    );
  }

  if (denied) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Instance admin</h3>
        <p className="empty">You do not have admin access.</p>
      </div>
    );
  }

  const totals = overview?.totals ?? { orgs: 0, users: 0 };
  const orgs = overview?.orgs ?? [];

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Instance admin</h3>

      <div className="stat-row">
        <div className="stat">
          <div className="stat-val">{formatNumber(totals.orgs)}</div>
          <div className="stat-label">Organizations</div>
        </div>
        <div className="stat">
          <div className="stat-val">{formatNumber(totals.users)}</div>
          <div className="stat-label">Users</div>
        </div>
      </div>

      {orgs.length === 0 ? (
        <p className="empty">No organizations yet.</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Org</th>
              <th>Plan</th>
              <th>Members</th>
              <th>Projects</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((org) => (
              <tr key={org.id}>
                <td>{org.name}</td>
                <td>
                  <select
                    value={org.plan}
                    disabled={savingId === org.id}
                    onChange={(e) => void changePlan(org, e.target.value as PlanId)}
                  >
                    {PLANS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{formatNumber(org.members)}</td>
                <td>{formatNumber(org.projects)}</td>
                <td>{new Date(org.createdAt).toLocaleDateString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
