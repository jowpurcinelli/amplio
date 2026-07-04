import { useEffect, useState } from "react";
import type { Settings } from "../config.js";
import {
  fetchEventNames,
  fetchPropertyKeys,
  listCohorts,
  createCohort,
  deleteCohort,
  type Cohort,
  type PropertyFilter,
} from "../api.js";
import { Field, EventSelect } from "../components/Field.js";

export function Cohorts({ settings }: { settings: Settings }) {
  const [names, setNames] = useState<string[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [name, setName] = useState("");
  const [event, setEvent] = useState("");
  const [propKeys, setPropKeys] = useState<string[]>([]);
  const [filterKey, setFilterKey] = useState("");
  const [filterOp, setFilterOp] = useState<PropertyFilter["op"]>("is");
  const [filterValue, setFilterValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadCohorts = () => listCohorts(settings).then(setCohorts).catch((e) => setError(String(e)));

  useEffect(() => {
    fetchEventNames(settings).then((e) => setNames(e.map((x) => x.name))).catch(() => setNames([]));
    loadCohorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  useEffect(() => {
    if (!event) return setPropKeys([]);
    fetchPropertyKeys(settings, event, "event").then(setPropKeys).catch(() => setPropKeys([]));
  }, [settings, event]);

  const save = async () => {
    if (!name.trim() || !event) return;
    const filters: PropertyFilter[] = filterKey
      ? [{ scope: "event", key: filterKey, op: filterOp, values: filterValue ? [filterValue] : [] }]
      : [];
    try {
      await createCohort(settings, { name: name.trim(), definition: { eventType: event, filters } });
      setName("");
      setFilterKey("");
      setFilterValue("");
      loadCohorts();
    } catch (e) {
      setError(String(e).includes("503") ? "Cohorts need a metadata store (DATABASE_URL)." : String(e));
    }
  };

  const remove = async (id: string) => {
    await deleteCohort(settings, id);
    loadCohorts();
  };

  const describe = (c: Cohort) => {
    const f = c.definition.filters?.[0];
    return f ? `did ${c.definition.eventType} where ${f.key} ${f.op} ${(f.values ?? []).join(", ")}` : `did ${c.definition.eventType}`;
  };

  return (
    <>
      <div className="card">
        <div className="controls">
          <Field label="Cohort name">
            <input type="text" placeholder="e.g. Purchasers" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Performed event">
            <EventSelect value={event} onChange={setEvent} names={names} />
          </Field>
          <Field label="Where property (optional)">
            <select value={filterKey} onChange={(e) => setFilterKey(e.target.value)}>
              <option value="">Any</option>
              {propKeys.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </Field>
          {filterKey && (
            <>
              <Field label="Op">
                <select value={filterOp} onChange={(e) => setFilterOp(e.target.value as PropertyFilter["op"])}>
                  <option value="is">is</option>
                  <option value="is_not">is not</option>
                  <option value="contains">contains</option>
                </select>
              </Field>
              <Field label="Value">
                <input type="text" value={filterValue} onChange={(e) => setFilterValue(e.target.value)} />
              </Field>
            </>
          )}
          <button className="btn" onClick={save} disabled={!name.trim() || !event}>
            Create cohort
          </button>
        </div>
      </div>

      <div className="card">
        {error && <div className="error">{error}</div>}
        {cohorts.length === 0 && !error && (
          <div className="empty">No cohorts yet. Define one above, then apply it in Segmentation.</div>
        )}
        {cohorts.length > 0 && (
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Definition</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td style={{ color: "var(--text-secondary)" }}>{describe(c)}</td>
                  <td>
                    <button className="chip" onClick={() => remove(c.id)}>
                      Delete <span>×</span>
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
