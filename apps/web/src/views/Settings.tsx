import { useState } from "react";
import type { Settings as SettingsT } from "../config.js";
import { fetchEventNames } from "../api.js";
import { Field } from "../components/Field.js";

export function Settings({ settings, onSave }: { settings: SettingsT; onSave: (s: SettingsT) => void }) {
  const [apiUrl, setApiUrl] = useState(settings.apiUrl);
  const [readKey, setReadKey] = useState(settings.readKey);
  const [status, setStatus] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const test = async () => {
    setStatus("Testing…");
    try {
      const names = await fetchEventNames({ apiUrl, readKey });
      setOk(true);
      setStatus(`Connected. ${names.length} event type(s) visible.`);
    } catch (e) {
      setOk(false);
      setStatus(`Could not connect: ${e}`);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <div className="controls" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <Field label="Query API URL">
          <input type="text" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
        </Field>
        <Field label="Read key">
          <input type="text" value={readKey} onChange={(e) => setReadKey(e.target.value)} />
        </Field>
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn" onClick={() => onSave({ apiUrl, readKey })}>
            Save
          </button>
          <button className="btn secondary" onClick={test}>
            Test connection
          </button>
        </div>
        {status && (
          <div style={{ marginTop: 6, color: ok ? "var(--good)" : "var(--series-6)", fontSize: 13 }}>{status}</div>
        )}
      </div>
    </div>
  );
}
