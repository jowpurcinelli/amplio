import { useState } from "react";
import { Field } from "../components/Field.js";
import { useToast } from "../components/Toast.js";

export function AccountSettings({
  apiUrl,
  token,
  onDeleted,
}: {
  apiUrl: string;
  token: string;
  onDeleted: () => void;
}) {
  const toast = useToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const postJson = async (path: string, body: unknown) => {
    const res = await fetch(apiUrl + path, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.status);
    return res.json();
  };

  const deleteJson = async (path: string) => {
    const res = await fetch(apiUrl + path, {
      method: "DELETE",
      headers: { authorization: "Bearer " + token },
    });
    if (!res.ok) throw new Error((await res.json()).error || res.status);
    return res.json();
  };

  const changePassword = async () => {
    setSavingPassword(true);
    try {
      await postJson("/auth/password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      toast.ok("Password updated");
    } catch (e) {
      toast.err(String(e instanceof Error ? e.message : e));
    } finally {
      setSavingPassword(false);
    }
  };

  const deleteAccount = async () => {
    if (!window.confirm("Delete your account permanently? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await deleteJson("/auth/account");
      toast.ok("Account deleted");
      onDeleted();
    } catch (e) {
      toast.err(String(e instanceof Error ? e.message : e));
    } finally {
      setDeleting(false);
    }
  };

  const canSave = currentPassword.length > 0 && newPassword.length >= 8;

  return (
    <div style={{ maxWidth: 620 }}>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Change password</h3>
        <Field label="Current password">
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Enter your current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </Field>
        <Field label="New password">
          <input
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </Field>
        <button className="btn" onClick={changePassword} disabled={savingPassword || !canSave}>
          {savingPassword ? "Saving..." : "Save"}
        </button>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Delete account</h3>
        <p style={{ marginTop: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.6, maxWidth: "62ch" }}>
          This permanently removes your account and signs you out. This cannot be undone. If you
          are the sole owner of an organization with other members, transfer ownership first.
        </p>
        <button className="btn danger" onClick={deleteAccount} disabled={deleting}>
          {deleting ? "Deleting…" : "Delete account"}
        </button>
      </div>
    </div>
  );
}
