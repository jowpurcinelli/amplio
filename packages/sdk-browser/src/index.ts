import { AmplioClient } from "./client.js";
import type { AmplioConfig, Properties } from "./types.js";

export { AmplioClient } from "./client.js";
export { memoryStore, resolveStore, uuid } from "./storage.js";
export type {
  AmplioConfig,
  Properties,
  SdkEvent,
  KeyValueStore,
  Transport,
  TransportResponse,
  FlagValue,
  FlagsFetcher,
} from "./types.js";

/**
 * Module-level singleton for the common case, mirroring amplitude's ergonomics:
 *
 *   import amplio from "@amplio/sdk-browser";
 *   amplio.init("write-key", "https://track.example.com");
 *   amplio.track("signup", { plan: "pro" });
 */
let singleton: AmplioClient | null = null;

export function init(
  apiKey: string,
  serverUrl: string,
  options?: Partial<Omit<AmplioConfig, "apiKey" | "serverUrl">>,
): AmplioClient {
  singleton = new AmplioClient({ apiKey, serverUrl, ...options });
  return singleton;
}

function required(): AmplioClient {
  if (!singleton) throw new Error("amplio: call init(apiKey, serverUrl) first");
  return singleton;
}

export const track = (e: string, ep?: Properties, up?: Properties): void =>
  required().track(e, ep, up);
export const identify = (up: Properties): void => required().identify(up);
export const setUserId = (id: string | null): void => required().setUserId(id);
export const flush = (): Promise<void> => required().flush();
export const reset = (): void => required().reset();
export const loadFlags = (keys?: string[]): Promise<void> => required().loadFlags(keys);
export const isEnabled = (key: string): boolean => required().isEnabled(key);
export const getVariant = (key: string): string | null => required().getVariant(key);

export default { init, track, identify, setUserId, flush, reset, loadFlags, isEnabled, getVariant };
