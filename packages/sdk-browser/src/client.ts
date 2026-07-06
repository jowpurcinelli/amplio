import type {
  AmplioConfig,
  FlagsFetcher,
  FlagValue,
  KeyValueStore,
  Properties,
  SdkEvent,
  Transport,
} from "./types.js";
import { resolveStore, uuid } from "./storage.js";

const KEY = {
  device: "amplio_device_id",
  user: "amplio_user_id",
  session: "amplio_session_id",
  last: "amplio_last_event_time",
  queue: "amplio_queue",
} as const;

const MAX_BATCH = 1000;
const DEFAULTS = {
  flushQueueSize: 30,
  flushIntervalMs: 5000,
  maxRetries: 5,
  sessionTimeoutMs: 30 * 60 * 1000,
  retryBaseMs: 500,
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Default transport using the global fetch. */
const fetchTransport: Transport = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  });
  return { status: res.status, ok: res.ok };
};

/** Default flags fetcher using the global fetch. */
const fetchFlags: FlagsFetcher = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!res.ok) return {};
  const json = (await res.json()) as { flags?: Record<string, FlagValue> };
  return json.flags ?? {};
};

/**
 * Amplio browser client. Batches events, persists an offline queue, manages
 * device id and sessions, and retries with backoff. Wire-compatible with the
 * Amplio ingest service (Amplitude HTTP V2 envelope).
 */
export class AmplioClient {
  private readonly store: KeyValueStore;
  private readonly transport: Transport;
  private readonly serverUrl: string;
  private readonly flushQueueSize: number;
  private readonly maxRetries: number;
  private readonly sessionTimeoutMs: number;
  private readonly retryBaseMs: number;

  private queue: SdkEvent[];
  private flushing = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private deviceId: string;
  private userId: string | null;
  private readonly platform: string;
  private readonly flagsFetcher: FlagsFetcher;
  private flagValues: Record<string, FlagValue> = {};

  constructor(private readonly config: AmplioConfig) {
    this.store = resolveStore(config.storage);
    this.transport = config.transport ?? fetchTransport;
    this.serverUrl = config.serverUrl.replace(/\/+$/, "");
    this.flushQueueSize = config.flushQueueSize ?? DEFAULTS.flushQueueSize;
    this.maxRetries = config.maxRetries ?? DEFAULTS.maxRetries;
    this.sessionTimeoutMs = config.sessionTimeoutMs ?? DEFAULTS.sessionTimeoutMs;
    this.retryBaseMs = DEFAULTS.retryBaseMs;
    this.platform = config.platform ?? "Web";
    this.flagsFetcher = config.flagsFetcher ?? fetchFlags;

    this.deviceId = this.store.get(KEY.device) ?? this.newDeviceId();
    this.userId = this.store.get(KEY.user);
    this.queue = this.loadQueue();

    const interval = config.flushIntervalMs ?? DEFAULTS.flushIntervalMs;
    if (interval > 0 && typeof setInterval === "function") {
      this.timer = setInterval(() => void this.flush(), interval);
      // Do not keep a Node process alive just for the flush timer.
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  getUserId(): string | null {
    return this.userId;
  }

  getSessionId(): number {
    const raw = this.store.get(KEY.session);
    return raw ? Number(raw) : -1;
  }

  setUserId(userId: string | null): void {
    this.userId = userId;
    if (userId) this.store.set(KEY.user, userId);
    else this.store.remove(KEY.user);
  }

  /** Reset device id and identity, e.g. on logout. */
  reset(): void {
    this.setUserId(null);
    this.deviceId = this.newDeviceId();
    this.store.remove(KEY.session);
  }

  /** Track an event. Returns once queued (network happens on flush). */
  track(
    eventType: string,
    eventProperties?: Properties,
    userProperties?: Properties,
  ): void {
    const now = Date.now();
    // Tag every event with the current flag assignments so experiments can
    // break any metric down by variant. $flag_<key> = variant (or on/off).
    const assignment = this.flagAssignments();
    const mergedProps =
      Object.keys(assignment).length > 0 || eventProperties
        ? { ...assignment, ...eventProperties }
        : undefined;
    const event: SdkEvent = {
      event_type: eventType,
      device_id: this.deviceId,
      time: now,
      session_id: this.refreshSession(now),
      insert_id: uuid(),
      platform: this.platform,
      ...(this.userId ? { user_id: this.userId } : {}),
      ...(mergedProps ? { event_properties: mergedProps } : {}),
      ...(userProperties ? { user_properties: userProperties } : {}),
      ...(typeof navigator !== "undefined" && navigator.language
        ? { language: navigator.language }
        : {}),
    };
    this.queue.push(event);
    this.persistQueue();
    if (this.queue.length >= this.flushQueueSize) void this.flush();
  }

  /** Attach user properties via an $identify event. */
  identify(userProperties: Properties): void {
    this.track("$identify", undefined, userProperties);
  }

  /**
   * Fetch and cache feature flags evaluated for the current user/device. Call
   * after init (and again after setUserId) so isEnabled/getVariant are ready.
   */
  async loadFlags(keys?: string[]): Promise<void> {
    const body = JSON.stringify({
      api_key: this.config.apiKey,
      ...(this.userId ? { user_id: this.userId } : { device_id: this.deviceId }),
      ...(keys && keys.length > 0 ? { keys } : {}),
    });
    try {
      this.flagValues = await this.flagsFetcher(`${this.serverUrl}/flags/evaluate`, body);
    } catch {
      // keep the last known values on a transient failure
    }
  }

  /** Whether a flag is on for the current unit (from the last loadFlags). */
  isEnabled(key: string): boolean {
    return this.flagValues[key]?.on ?? false;
  }

  /** The assigned variant of a flag, or null. */
  getVariant(key: string): string | null {
    return this.flagValues[key]?.variant ?? null;
  }

  /** All cached flag values. */
  getFlags(): Record<string, FlagValue> {
    return { ...this.flagValues };
  }

  /** Flag assignments as event properties: $flag_<key> = variant | on | off. */
  private flagAssignments(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, v] of Object.entries(this.flagValues)) {
      out[`$flag_${key}`] = v.variant ?? (v.on ? "on" : "off");
    }
    return out;
  }

  /** Send all queued events. Safe to call repeatedly; it self-serializes. */
  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.slice(0, MAX_BATCH);
        const outcome = await this.send(batch);
        if (outcome === "retry") break; // leave the queue for a later attempt
        this.queue = this.queue.slice(batch.length);
        this.persistQueue();
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Stop the flush timer. Call on teardown. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async send(batch: SdkEvent[]): Promise<"ok" | "drop" | "retry"> {
    const body = JSON.stringify({ api_key: this.config.apiKey, events: batch });
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.transport(`${this.serverUrl}/2/httpapi`, body);
        if (res.ok) return "ok";
        // Client errors will never succeed on retry: drop to avoid poisoning.
        if (res.status === 400 || res.status === 401 || res.status === 413) {
          this.warn(`dropping ${batch.length} events, server responded ${res.status}`);
          return "drop";
        }
        // 429 and 5xx are retryable.
      } catch {
        // Network error is retryable.
      }
      if (attempt >= this.maxRetries) return "retry";
      await sleep(this.retryBaseMs * 2 ** attempt);
    }
  }

  private refreshSession(now: number): number {
    const last = Number(this.store.get(KEY.last) ?? 0);
    let session = Number(this.store.get(KEY.session) ?? 0);
    if (!session || now - last > this.sessionTimeoutMs) {
      session = now;
      this.store.set(KEY.session, String(session));
    }
    this.store.set(KEY.last, String(now));
    return session;
  }

  private newDeviceId(): string {
    const id = uuid();
    this.store.set(KEY.device, id);
    return id;
  }

  private loadQueue(): SdkEvent[] {
    const raw = this.store.get(KEY.queue);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as SdkEvent[]) : [];
    } catch {
      return [];
    }
  }

  private persistQueue(): void {
    // Cap what we persist so a stuck queue cannot grow without bound.
    const toPersist = this.queue.slice(-5000);
    this.store.set(KEY.queue, JSON.stringify(toPersist));
  }

  private warn(msg: string): void {
    if (typeof console !== "undefined") console.warn(`[amplio] ${msg}`);
  }
}
