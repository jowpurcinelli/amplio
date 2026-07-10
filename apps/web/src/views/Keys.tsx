import { useEffect, useState } from "react";
import type { Settings } from "../config.js";
import { listKeys, createKey, revokeKey, type ApiKeyRow } from "../api.js";
import { Field } from "../components/Field.js";
import { EmptyState } from "../components/EmptyState.js";

export function Keys({ settings }: { settings: Settings }) {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"write" | "read">("write");
  const [label, setLabel] = useState("");

  const load = () => {
    listKeys(settings)
      .then((k) => {
        setKeys(k);
        setError(null);
      })
      .catch((e) =>
        setError(
          String(e).includes("503")
            ? "Key management needs a metadata store (set DATABASE_URL on the API)."
            : String(e),
        ),
      );
  };

  useEffect(load, [settings]);

  const create = async () => {
    await createKey(settings, { kind, label: label || undefined });
    setLabel("");
    load();
  };
  const revoke = async (id: string) => {
    await revokeKey(settings, id);
    load();
  };

  return (
    <>
      <div className="card">
        <div className="controls">
          <Field label="Key type">
            <select value={kind} onChange={(e) => setKind(e.target.value as "write" | "read")}>
              <option value="write">Write (ingest events)</option>
              <option value="read">Read (dashboard queries)</option>
            </select>
          </Field>
          <Field label="Label">
            <input type="text" placeholder="e.g. Production web" value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <button className="btn" onClick={create}>
            Create key
          </button>
        </div>
      </div>

      <div className="card">
        {error && <div className="error">{error}</div>}
        {keys && keys.length === 0 && !error && (
          <EmptyState
            icon="keys"
            title="No API keys yet"
            hint="Create a write key to ingest events, or a read key to drive the dashboard."
          />
        )}
        {keys && keys.length > 0 && (
          <table className="data">
            <thead>
              <tr>
                <th>Key</th>
                <th style={{ width: 90 }}>Type</th>
                <th>Label</th>
                <th style={{ width: 110 }}>Status</th>
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 13 }}>{k.key}</td>
                  <td>
                    <span className="badge">{k.kind}</span>
                  </td>
                  <td style={{ color: "var(--text-secondary)" }}>{k.label ?? "—"}</td>
                  <td>
                    {k.revokedAt ? (
                      <span className="badge">Revoked</span>
                    ) : (
                      <span className="badge good">
                        <span
                          style={{ width: 6, height: 6, borderRadius: 999, background: "var(--good)", display: "inline-block" }}
                        />
                        Active
                      </span>
                    )}
                  </td>
                  <td>
                    {!k.revokedAt && (
                      <button className="btn danger small" onClick={() => revoke(k.id)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
