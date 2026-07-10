# Amplio Quickstart: one command to go live

Self-host the full Amplio stack (dashboard, query API, ingest, ClickHouse,
Postgres) behind a Caddy reverse proxy with automatic HTTPS.

## Prerequisites

- A Linux server with a public IP.
- Docker with the Compose plugin (`docker compose version` works).
- `openssl` and `curl` on the host.
- A domain you control.

## Go live

From the repo root:

```
make deploy DOMAIN=analytics.yourcompany.com
```

That single command will:

1. Create `deploy/.env` from the template (only on the first run, never overwriting an existing one).
2. Generate strong random secrets for ClickHouse, Postgres, and the session signer.
3. Generate a write key and a read key for a `default-project`.
4. Build the images and start the whole stack.
5. Wait for the API to report healthy, then print your dashboard URL.

If you omit `DOMAIN`, the stack still comes up, but you must set the domain
yourself (see below) before HTTPS will work.

## What you still have to do

1. **Point DNS.** Create an `A` (and `AAAA` if you use IPv6) record for your
   domain pointing at this server's public IP. Caddy requests a Let's Encrypt
   certificate automatically once the domain resolves to the server.
2. **Confirm the domain in `deploy/.env`.** Open `deploy/.env` and make sure
   `AMPLIO_DOMAIN` is your real hostname, not the `amplio.example.com`
   placeholder. If you change it, re-run `make deploy` to reload the proxy.
3. **Open the dashboard** at `https://your-domain` and create your first account.
4. **Keep your keys safe.** Your API keys live in `deploy/.env`
   (`AMPLIO_WRITE_KEYS` for SDK ingestion, `AMPLIO_READ_KEYS` for the dashboard).
   Treat that file as a secret; it is git-ignored by default.

## Day-to-day

```
make logs     tail service logs
make ps       show container status
make down     stop the stack
make deploy   rebuild and restart with your current deploy/.env
```

Re-running `make deploy` is safe: it never regenerates your secrets or
overwrites `deploy/.env`.
