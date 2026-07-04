import { describe, it, expect } from "vitest";
import { AmplioNodeClient, createClient } from "./index.js";
import type { Transport, TransportResponse } from "@amplio/sdk-browser";

function mock(): { transport: Transport; sent: { api_key: string; events: unknown[] }[] } {
  const sent: { api_key: string; events: unknown[] }[] = [];
  const transport: Transport = async (_url, body): Promise<TransportResponse> => {
    sent.push(JSON.parse(body));
    return { status: 200, ok: true };
  };
  return { transport, sent };
}

describe("AmplioNodeClient", () => {
  it("tags events with the Node platform and flushes", async () => {
    const m = mock();
    const client = createClient({
      apiKey: "k",
      serverUrl: "http://localhost:8787",
      flushIntervalMs: 0,
      flushOnExit: false,
      transport: m.transport,
    });
    client.track("job_ran", { queue: "emails" });
    await client.flush();
    const ev = m.sent[0]!.events[0] as Record<string, unknown>;
    expect(ev.platform).toBe("Node");
    expect(ev.event_type).toBe("job_ran");
    expect(ev.event_properties).toEqual({ queue: "emails" });
  });

  it("shutdown flushes then stops", async () => {
    const m = mock();
    const client = new AmplioNodeClient({
      apiKey: "k",
      serverUrl: "http://x",
      flushIntervalMs: 0,
      flushOnExit: false,
      transport: m.transport,
    });
    client.track("evt");
    await client.shutdown();
    expect(m.sent).toHaveLength(1);
  });
});
