import { randomBytes, randomUUID } from "node:crypto";
import type { KeyKind } from "./types.js";

/** A fresh, url-safe API key, prefixed by kind (amp_wr_ / amp_rd_). */
export function generateKey(kind: KeyKind): string {
  return `amp_${kind === "write" ? "wr" : "rd"}_${randomBytes(18).toString("base64url")}`;
}

export { randomUUID };
