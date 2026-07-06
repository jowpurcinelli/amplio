import { describe, it, expect } from "vitest";
import { recordSession } from "./index.js";

describe("recordSession", () => {
  it("buffers emitted events and posts them with sequence numbers", async () => {
    let emit!: (e: unknown) => void;
    const posted: any[] = [];
    const s = recordSession({
      apiKey: "k",
      serverUrl: "http://localhost:8787/",
      userId: "u1",
      flushIntervalMs: 0,
      recorder: (e) => {
        emit = e;
        return () => {};
      },
      fetcher: async (url, body) => {
        posted.push({ url, body: JSON.parse(body) });
      },
    });

    emit({ type: 4, data: { href: "/" } });
    emit({ type: 2, data: {} });
    await s.flush();

    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe("http://localhost:8787/replay");
    const b = posted[0].body;
    expect(b.api_key).toBe("k");
    expect(b.replay_id).toBe(s.replayId);
    expect(b.user_id).toBe("u1");
    expect(b.events.map((e: any) => e.seq)).toEqual([0, 1]);
    expect(b.events[0].data).toEqual({ type: 4, data: { href: "/" } });
  });

  it("does not post when there is nothing buffered", async () => {
    let posts = 0;
    const s = recordSession({
      apiKey: "k",
      serverUrl: "http://x",
      flushIntervalMs: 0,
      recorder: () => () => {},
      fetcher: async () => {
        posts++;
      },
    });
    await s.flush();
    expect(posts).toBe(0);
  });

  it("requeues events if the post fails", async () => {
    let emit!: (e: unknown) => void;
    let calls = 0;
    const seen: number[] = [];
    const s = recordSession({
      apiKey: "k",
      serverUrl: "http://x",
      flushIntervalMs: 0,
      recorder: (e) => {
        emit = e;
        return () => {};
      },
      fetcher: async (_url, body) => {
        calls++;
        if (calls === 1) throw new Error("network down");
        JSON.parse(body).events.forEach((e: any) => seen.push(e.seq));
      },
    });
    emit({ type: 2 });
    await s.flush(); // fails, requeues
    await s.flush(); // succeeds, sends the requeued event
    expect(seen).toEqual([0]);
  });
});
