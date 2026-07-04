# @amplio/sdk-node

Amplitude-compatible server-side SDK for Amplio. A thin Node wrapper over the
shared client: in-memory queue (no localStorage), events tagged with the "Node"
platform, and flush on process exit.

## Install

```bash
pnpm add @amplio/sdk-node
```

## Use

```ts
import { createClient } from "@amplio/sdk-node";

const amplio = createClient({
  apiKey: process.env.AMPLIO_WRITE_KEY!,
  serverUrl: "https://track.your-domain.com",
});

amplio.setUserId("user_123");
amplio.track("order_placed", { total: 42, currency: "USD" });
```

### Short scripts

Events flush automatically on `beforeExit`, so one-off scripts just work:

```ts
const amplio = createClient({ apiKey, serverUrl });
for (const row of rows) amplio.track("row_processed", { id: row.id });
// process exits -> queue flushes
```

### Long-running servers

`beforeExit` does not fire on `SIGTERM`/`SIGINT`, so flush explicitly on
shutdown:

```ts
process.on("SIGTERM", async () => {
  await amplio.shutdown(); // flush + stop
  process.exit(0);
});
```

## Behavior

- Batches and retries with backoff, same engine as the browser SDK.
- `flushOnExit` (default true) hooks `beforeExit`.
- `shutdown()` flushes remaining events and stops the flush timer.
- All options from the shared client apply (`flushQueueSize`, `flushIntervalMs`,
  `maxRetries`, `sessionTimeoutMs`, custom `transport`).
