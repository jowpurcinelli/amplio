# @amplio/sdk-browser

Amplitude-compatible browser SDK for Amplio. Batches events, persists an
offline queue, manages device id and sessions, and retries with backoff.

## Install

```bash
pnpm add @amplio/sdk-browser
```

## Use

```ts
import amplio from "@amplio/sdk-browser";

amplio.init("YOUR_WRITE_KEY", "https://track.your-domain.com");

amplio.setUserId("user_123");
amplio.track("signup", { plan: "pro" });
amplio.identify({ company: "acme" });
```

Or manage an instance directly:

```ts
import { AmplioClient } from "@amplio/sdk-browser";

const client = new AmplioClient({
  apiKey: "YOUR_WRITE_KEY",
  serverUrl: "https://track.your-domain.com",
  flushQueueSize: 30,
  flushIntervalMs: 5000,
});

client.track("page_view", { path: location.pathname });
await client.flush();
```

## Behavior

- **Batching**: events queue and flush on size (`flushQueueSize`) or interval
  (`flushIntervalMs`).
- **Offline queue**: unsent events persist to `localStorage` and survive
  reloads. Without `localStorage` (or on the server) it falls back to memory.
- **Sessions**: a new session starts after 30 minutes of inactivity
  (`sessionTimeoutMs`).
- **Retry**: network errors, 429, and 5xx retry with exponential backoff. A
  400/401/413 drops the batch so one bad payload cannot block the queue.
- **Identity**: `setUserId`, `identify(userProperties)`, and `reset()` on logout.

Runs in browsers and in Node (used for server-side tracking), sharing one
isomorphic implementation.
