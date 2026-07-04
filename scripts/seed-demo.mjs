#!/usr/bin/env node
//
// Seed a realistic demo dataset into a running Amplio ingest service.
//
//   node scripts/seed-demo.mjs
//
// Environment (all optional):
//   AMPLIO_URL         ingest base url        default http://localhost:8787
//   AMPLIO_WRITE_KEY   write api key          default dev-key
//   AMPLIO_USERS       number of users        default 300
//   AMPLIO_DAYS        days of history        default 14
//
// Generates a signup -> onboarding -> purchase funnel with realistic drop-off,
// plus recurring app_open activity so retention and segmentation have shape.

const URL = process.env.AMPLIO_URL ?? "http://localhost:8787";
const API_KEY = process.env.AMPLIO_WRITE_KEY ?? "dev-key";
const N_USERS = Number(process.env.AMPLIO_USERS ?? 300);
const DAYS = Number(process.env.AMPLIO_DAYS ?? 14);

const DAY = 86_400_000;
const now = Date.now();
const plans = ["free", "pro", "enterprise"];
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];

const events = [];
for (let u = 0; u < N_USERS; u++) {
  const uid = `u_${u}`;
  const plan = pick(plans);
  const props = { plan };
  const signupDay = rnd(DAYS);
  const t0 = now - signupDay * DAY - rnd(DAY);
  events.push({ event_type: "signup", user_id: uid, time: t0, event_properties: props });

  if (Math.random() < 0.8) {
    events.push({ event_type: "onboarding_start", user_id: uid, time: t0 + 60_000, event_properties: props });
    if (Math.random() < 0.7) {
      events.push({ event_type: "onboarding_complete", user_id: uid, time: t0 + 300_000, event_properties: props });
      if (Math.random() < 0.45) {
        events.push({
          event_type: "purchase",
          user_id: uid,
          time: t0 + 600_000,
          event_properties: props,
          price: pick([9, 19, 49]),
          quantity: 1,
        });
      }
    }
  }

  for (let d = 1; d <= signupDay; d++) {
    if (Math.random() < 0.55 * Math.exp(-d / 8)) {
      events.push({ event_type: "app_open", user_id: uid, time: t0 + d * DAY + rnd(DAY / 2), event_properties: props });
    }
  }
}

events.sort(() => Math.random() - 0.5);

let sent = 0;
for (let i = 0; i < events.length; i += 500) {
  const batch = events.slice(i, i + 500);
  const res = await fetch(`${URL}/2/httpapi`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: API_KEY, events: batch }),
  });
  if (!res.ok) {
    console.error(`ingest failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const body = await res.json();
  sent += body.events_ingested ?? 0;
}

console.log(`Seeded ${sent} events across ${N_USERS} users over ${DAYS} days into ${URL}.`);
