import { AmplioClient, memoryStore } from "@amplio/sdk-browser";
import type { AmplioConfig } from "@amplio/sdk-browser";

export * from "@amplio/sdk-browser";

export interface NodeClientConfig extends Omit<AmplioConfig, "storage"> {
  /** Flush pending events when the process is about to exit. Default true. */
  flushOnExit?: boolean;
}

/**
 * Server-side Amplio client. Uses an in-memory queue (no localStorage), tags
 * events with the "Node" platform, and flushes on process exit by default.
 *
 * For long-running servers, call `await client.shutdown()` from your own
 * SIGTERM/SIGINT handler to flush before the process is killed, since the
 * `beforeExit` hook does not fire on signals.
 */
export class AmplioNodeClient extends AmplioClient {
  constructor(config: NodeClientConfig) {
    super({ platform: "Node", ...config, storage: memoryStore() });
    if ((config.flushOnExit ?? true) && typeof process !== "undefined") {
      process.once("beforeExit", () => {
        void this.flush();
      });
    }
  }

  /** Flush remaining events and stop the flush timer. Await on shutdown. */
  async shutdown(): Promise<void> {
    await this.flush();
    this.stop();
  }
}

export function createClient(config: NodeClientConfig): AmplioNodeClient {
  return new AmplioNodeClient(config);
}
