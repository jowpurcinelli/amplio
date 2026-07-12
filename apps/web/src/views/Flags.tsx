import { useEffect, useState } from "react";
import type { Settings } from "../config.js";
import {
  listFlags,
  createFlag,
  updateFlag,
  deleteFlag,
  type FlagRow,
  type FlagVariant,
} from "../api.js";
import { Field } from "../components/Field.js";
import { EmptyState } from "../components/EmptyState.js";

export function Flags({ settings }: { settings: Settings }) {
  const [flags, setFlags] = useState<FlagRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [rollout, setRollout] = useState(100);
  const [variants, setVariants] = useState<FlagVariant[]>([]);

  const load = () => {
    listFlags(settings)
      .then((f) => {
        setFlags(f);
        setError(null);
      })
      .catch((e) =>
        setError(String(e).includes("503") ? "Flags need a metadata store (DATABASE_URL / AMPLIO_DB)." : String(e)),
      );
  };

  useEffect(load, [settings]);

  const create = async () => {
    if (!key.trim()) return;
    try {
      await createFlag(settings, {
        key: key.trim(),
        description: description.trim() || null,
        enabled: true,
        rollout,
        variants,
      });
      setKey("");
      setDescription("");
      setRollout(100);
      setVariants([]);
      load();
    } catch (e) {
      setError(String(e));
    }
  };

  // Inline edits update the flag with its full current state.
  const patch = async (f: FlagRow, changes: Partial<FlagRow>) => {
    await updateFlag(settings, f.id, {
      key: f.key,
      description: f.description,
      enabled: f.enabled,
      rollout: f.rollout,
      variants: f.variants,
      ...changes,
    });
    load();
  };

  const remove = async (id: string) => {
    await deleteFlag(settings, id);
    load();
  };

  return (
    <>
      <div className="card">
        <div className="controls">
          <Field label="Flag key">
            <input type="text" placeholder="new-checkout" value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
          <Field label="Description">
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Rollout %">
            <input
              type="number"
              min={0}
              max={100}
              value={rollout}
              onChange={(e) => setRollout(Math.max(0, Math.min(100, Number(e.target.value))))}
              style={{ width: 90 }}
            />
          </Field>
          <button className="btn" onClick={create} disabled={!key.trim()}>
            Create flag
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="stat-label" style={{ marginBottom: 6 }}>Variants (optional, for A/B tests)</div>
          <div className="row">
            {variants.map((v, i) => (
              <span className="chip" key={i}>
                {v.key} · {v.weight}
                <button onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
            <VariantAdder onAdd={(v) => setVariants((vs) => [...vs, v])} />
          </div>
        </div>
      </div>

      <div className="card">
        {error && <div className="error">{error}</div>}
        {flags && flags.length === 0 && !error && (
          <EmptyState
            icon="flags"
            title="No flags yet"
            hint="Create one above, then evaluate it from an SDK."
          />
        )}
        {flags && flags.length > 0 && (
          <table className="data">
            <thead>
              <tr>
                <th>Flag</th>
                <th style={{ width: 90 }}>Enabled</th>
                <th style={{ width: 140 }}>Rollout</th>
                <th>Variants</th>
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.id}>
                  <td>
                    <div style={{ fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>{f.key}</div>
                    {f.description && <div style={{ color: "var(--muted)", fontSize: 12 }}>{f.description}</div>}
                  </td>
                  <td>
                    <input type="checkbox" checked={f.enabled} onChange={() => patch(f, { enabled: !f.enabled })} />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={f.rollout}
                      onBlur={(e) => {
                        const v = Math.max(0, Math.min(100, Number(e.target.value)));
                        if (v !== f.rollout) patch(f, { rollout: v });
                      }}
                      style={{ width: 70 }}
                    />{" "}
                    %
                  </td>
                  <td style={{ color: "var(--text-secondary)" }}>
                    {f.variants.length > 0 ? f.variants.map((v) => `${v.key}:${v.weight}`).join(", ") : "—"}
                  </td>
                  <td>
                    <button className="btn danger small" onClick={() => remove(f.id)}>
                      Delete
                    </button>
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

function VariantAdder({ onAdd }: { onAdd: (v: FlagVariant) => void }) {
  const [k, setK] = useState("");
  const [w, setW] = useState(1);
  return (
    <span className="row" style={{ gap: 6 }}>
      <input type="text" placeholder="variant" value={k} onChange={(e) => setK(e.target.value)} style={{ width: 110 }} />
      <input type="number" min={0} value={w} onChange={(e) => setW(Number(e.target.value))} style={{ width: 60 }} />
      <button
        className="btn secondary"
        onClick={() => {
          if (k.trim()) {
            onAdd({ key: k.trim(), weight: w });
            setK("");
            setW(1);
          }
        }}
      >
        + Variant
      </button>
    </span>
  );
}
