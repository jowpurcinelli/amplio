import { describe, it, expect, beforeEach } from "vitest";
import { AmplioClient } from "./client.js";
import { memoryStore } from "./storage.js";
import type { KeyValueStore, Transport, TransportResponse } from "./types.js";

interface MockTransport {
  transport: Transport;
  sent: Array<{ api_key: string; events: unknown[] }>;
  calls: number;
}

function mockTransport(responder: (call: number) => TransportResponse): MockTransport {
  const state: MockTransport = { transport: async () => ({ status: 0, ok: false }), sent: [], calls: 0 };
  state.transport = async (_url, body) => {
    const call = state.calls++;
    const res = responder(call);
    if (res.ok) state.sent.push(JSON.parse(body));
    return res;
  };
  return state;
}

const ok = (): TransportResponse => ({ status: 200, ok: true });
const fail = (status: number): TransportResponse => ({ status, ok: false });

function makeClient(store: KeyValueStore, mt: MockTransport, over = {}) {
  return new AmplioClient({
    apiKey: "k",
    serverUrl: "http://localhost:8787/",
    flushIntervalMs: 0,
    flushQueueSize: 1000,
    maxRetries: 0,
    storage: store,
    transport: mt.transport,
    ...over,
  });
}

describe("AmplioClient", () => {
  let store: KeyValueStore;
  beforeEach(() => {
    store = memoryStore();
  });

  it("persists a stable device id across instances sharing a store", () => {
    const a = makeClient(store, mockTransport(ok));
    const id = a.getDeviceId();
    const b = makeClient(store, mockTransport(ok));
    expect(b.getDeviceId()).toBe(id);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("queues events and flushes them with the api key", async () => {
    const mt = mockTransport(ok);
    const c = makeClient(store, mt);
    c.track("signup", { plan: "pro" });
    c.track("login");
    await c.flush();
    expect(mt.sent).toHaveLength(1);
    expect(mt.sent[0]!.api_key).toBe("k");
    expect(mt.sent[0]!.events).toHaveLength(2);
    const first = mt.sent[0]!.events[0] as Record<string, unknown>;
    expect(first.event_type).toBe("signup");
    expect(first.event_properties).toEqual({ plan: "pro" });
    expect(first.device_id).toBe(c.getDeviceId());
    expect(first.session_id).toBe(c.getSessionId());
  });

  it("attaches user_id after setUserId", async () => {
    const mt = mockTransport(ok);
    const c = makeClient(store, mt);
    c.setUserId("u_1");
    c.track("do_thing");
    await c.flush();
    const ev = mt.sent[0]!.events[0] as Record<string, unknown>;
    expect(ev.user_id).toBe("u_1");
  });

  it("keeps events queued when the server is retryable-down, sends later", async () => {
    // First flush: 503 (retryable, maxRetries 0 -> retry -> stays queued).
    const mt = mockTransport((call) => (call === 0 ? fail(503) : ok()));
    const c = makeClient(store, mt);
    c.track("evt");
    await c.flush();
    expect(mt.sent).toHaveLength(0); // nothing accepted yet
    // Second flush: server healthy, event delivered.
    await c.flush();
    expect(mt.sent).toHaveLength(1);
    expect((mt.sent[0]!.events[0] as Record<string, unknown>).event_type).toBe("evt");
  });

  it("drops events on a 400 so a poison batch cannot block the queue", async () => {
    const mt = mockTransport(() => fail(400));
    const c = makeClient(store, mt);
    c.track("bad");
    await c.flush();
    expect(mt.sent).toHaveLength(0);
    // queue drained (dropped), so a subsequent good event flushes cleanly
    const mt2 = mockTransport(ok);
    const c2 = new AmplioClient({
      apiKey: "k", serverUrl: "http://x", flushIntervalMs: 0, maxRetries: 0,
      storage: store, transport: mt2.transport,
    });
    c2.track("good");
    await c2.flush();
    const types = mt2.sent.flatMap((s) => s.events.map((e) => (e as Record<string, unknown>).event_type));
    expect(types).toContain("good");
    expect(types).not.toContain("bad");
  });

  it("auto-flushes when the queue reaches flushQueueSize", async () => {
    const mt = mockTransport(ok);
    const c = makeClient(store, mt, { flushQueueSize: 2 });
    c.track("a");
    c.track("b"); // hits threshold -> triggers flush
    await c.flush();
    const total = mt.sent.reduce((n, s) => n + s.events.length, 0);
    expect(total).toBe(2);
  });

  it("identify sends a $identify event with user_properties", async () => {
    const mt = mockTransport(ok);
    const c = makeClient(store, mt);
    c.identify({ plan: "enterprise" });
    await c.flush();
    const ev = mt.sent[0]!.events[0] as Record<string, unknown>;
    expect(ev.event_type).toBe("$identify");
    expect(ev.user_properties).toEqual({ plan: "enterprise" });
  });
});
