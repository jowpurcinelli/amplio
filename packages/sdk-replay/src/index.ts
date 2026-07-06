/**
 * Amplio session replay. Records the page with rrweb and streams batches to the
 * ingest /replay endpoint. The recorder and network fetcher are injectable so
 * the logic is testable without a DOM.
 */

export type ReplayEmit = (event: unknown) => void;
/** Starts recording, calling emit for each event; returns a stop function. */
export type Recorder = (emit: ReplayEmit) => () => void;
export type ReplayFetcher = (url: string, body: string) => Promise<void>;

export interface ReplayConfig {
  apiKey: string;
  serverUrl: string;
  userId?: string;
  deviceId?: string;
  /** Flush the buffer on this interval, ms. Default 5000. */
  flushIntervalMs?: number;
  recorder?: Recorder;
  fetcher?: ReplayFetcher;
}

export interface ReplaySession {
  replayId: string;
  flush: () => Promise<void>;
  stop: () => void;
}

function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "rep_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Default recorder: rrweb, loaded lazily so this module imports cleanly in Node. */
const rrwebRecorder: Recorder = (emit) => {
  let stop: () => void = () => {};
  void import("rrweb")
    .then((rr) => {
      const s = rr.record({ emit: (e: unknown) => emit(e) });
      if (typeof s === "function") stop = s;
    })
    .catch(() => {});
  return () => stop();
};

const fetchFetcher: ReplayFetcher = async (url, body) => {
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  });
};

/** Begin recording a replay for the current page. */
export function recordSession(config: ReplayConfig): ReplaySession {
  const replayId = uuid();
  const fetcher = config.fetcher ?? fetchFetcher;
  const recorder = config.recorder ?? rrwebRecorder;
  const url = config.serverUrl.replace(/\/+$/, "") + "/replay";

  let buffer: Array<{ seq: number; ts: number; data: unknown }> = [];
  let seq = 0;
  let flushing = false;

  const flush = async (): Promise<void> => {
    if (flushing || buffer.length === 0) return;
    flushing = true;
    const batch = buffer;
    buffer = [];
    try {
      await fetcher(
        url,
        JSON.stringify({
          api_key: config.apiKey,
          replay_id: replayId,
          ...(config.userId ? { user_id: config.userId } : {}),
          ...(config.deviceId ? { device_id: config.deviceId } : {}),
          events: batch,
        }),
      );
    } catch {
      buffer = batch.concat(buffer); // requeue on failure
    } finally {
      flushing = false;
    }
  };

  const stopRecord = recorder((event) => {
    buffer.push({ seq: seq++, ts: Date.now(), data: event });
  });

  const timer = setInterval(() => void flush(), config.flushIntervalMs ?? 5000);
  (timer as { unref?: () => void }).unref?.();

  return {
    replayId,
    flush,
    stop: () => {
      clearInterval(timer);
      try {
        stopRecord();
      } catch {
        /* ignore */
      }
      void flush();
    },
  };
}
