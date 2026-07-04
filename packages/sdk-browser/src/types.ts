/** A property bag matching the ingest schema's accepted value types. */
export type Properties = Record<
  string,
  string | number | boolean | null | Array<string | number | boolean>
>;

/** Minimal key-value store so the SDK works with or without localStorage. */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** Result of a transport send. */
export interface TransportResponse {
  status: number;
  ok: boolean;
}

/** Pluggable network transport (defaults to fetch). Injected in tests. */
export type Transport = (url: string, body: string) => Promise<TransportResponse>;

export interface AmplioConfig {
  /** Write API key for the project. */
  apiKey: string;
  /** Base URL of the Amplio ingest service, e.g. https://track.example.com */
  serverUrl: string;
  /** Flush when the queue reaches this size. Default 30. */
  flushQueueSize?: number;
  /** Flush on this interval in ms. Default 5000. Set 0 to disable the timer. */
  flushIntervalMs?: number;
  /** Max send retries before giving up on a batch. Default 5. */
  maxRetries?: number;
  /** New session after this much inactivity, in ms. Default 30 minutes. */
  sessionTimeoutMs?: number;
  /** Platform tag attached to every event. Default "Web". */
  platform?: string;
  /** Override storage (defaults to localStorage, else in-memory). */
  storage?: KeyValueStore;
  /** Override transport (defaults to fetch). */
  transport?: Transport;
}

/** The event envelope the SDK sends, matching Amplio ingest. */
export interface SdkEvent {
  event_type: string;
  user_id?: string;
  device_id: string;
  time: number;
  session_id: number;
  insert_id: string;
  event_properties?: Properties;
  user_properties?: Properties;
  platform: string;
  language?: string;
}
