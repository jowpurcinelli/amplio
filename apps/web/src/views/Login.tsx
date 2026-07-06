import { useState } from "react";
import { Field } from "../components/Field.js";
import { login, signup, setToken, skipAuth, type AuthUser } from "../auth.js";

/**
 * The login/signup gate. Shown when there is no valid session. Users can create
 * an account (which provisions a project) or sign in. An escape hatch keeps the
 * API-key path working for the desktop app and self-host advanced mode.
 */
export function Login({
  apiUrl,
  onAuthed,
  onSkip,
}: {
  apiUrl: string;
  onAuthed: (user: AuthUser) => void;
  onSkip: () => void;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const res =
        mode === "signup"
          ? await signup(apiUrl, { email, password, name: name || undefined })
          : await login(apiUrl, { email, password });
      setToken(res.token);
      onAuthed(res.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const useApiKey = () => {
    skipAuth();
    onSkip();
  };

  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <div className="brand" style={{ marginBottom: 4 }}>
          <span className="brand-dot" />
          Amplio
        </div>
        <p className="page-sub" style={{ margin: "0 0 8px" }}>
          {mode === "signup" ? "Create your account. It sets up a project for you." : "Sign in to your workspace."}
        </p>

        <form
          className="controls"
          style={{ flexDirection: "column", alignItems: "stretch" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) submit();
          }}
        >
          {mode === "signup" && (
            <Field label="Name (optional)">
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </Field>
          )}
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
            />
          </Field>

          {error && <div style={{ color: "var(--series-6)", fontSize: 13 }}>{error}</div>}

          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
          <button
            className="linklike"
            onClick={() => {
              setError(null);
              setMode((m) => (m === "login" ? "signup" : "login"));
            }}
          >
            {mode === "login" ? "Need an account? Sign up" : "Have an account? Sign in"}
          </button>
          <button className="linklike" onClick={useApiKey}>
            Use an API key instead
          </button>
        </div>
      </div>
    </div>
  );
}
