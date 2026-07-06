"use strict";
// Auto-configure the dashboard to talk to the locally-managed API before the
// app's own scripts read settings. contextIsolation is off for this trusted,
// local-only renderer, so we share the page's localStorage directly.
try {
  const settings = { apiUrl: "http://127.0.0.1:8788", readKey: "dev-read-key" };
  window.localStorage.setItem("amplio_dashboard_settings", JSON.stringify(settings));
  // The desktop app is single-user and local; it uses the API-key path directly,
  // so skip the multi-tenant login gate.
  window.localStorage.setItem("amplio_auth_skipped", "1");
} catch (e) {
  // localStorage may be unavailable very early; ignored.
}
