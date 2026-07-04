import { randomUUID } from "node:crypto";
import type { EventInput, PropertyBag, StoredEvent } from "@amplio/schema";

/** Flatten a property bag to string values for ClickHouse Map(String, String). */
export function flattenProps(bag: PropertyBag | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!bag) return out;
  for (const [k, v] of Object.entries(bag)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

function flattenGroups(
  groups: Record<string, string | string[]> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!groups) return out;
  for (const [k, v] of Object.entries(groups)) {
    out[k] = Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return out;
}

/**
 * Turn a validated client event into a stored event, filling server-side
 * fields. `now` is the server receive time in epoch ms (injected for testing).
 */
export function normalize(
  input: EventInput,
  projectId: string,
  now: number,
): StoredEvent {
  const time = input.time ?? now;
  return {
    project_id: projectId,
    event_id: input.insert_id ?? randomUUID(),
    event_type: input.event_type,
    user_id: input.user_id ?? "",
    device_id: input.device_id ?? "",
    time,
    server_received_time: now,
    session_id: input.session_id ?? -1,
    insert_id: input.insert_id ?? randomUUID(),
    event_properties: flattenProps(input.event_properties),
    user_properties: flattenProps(input.user_properties),
    groups: flattenGroups(input.groups),
    app_version: input.app_version ?? "",
    platform: input.platform ?? "",
    os_name: input.os_name ?? "",
    os_version: input.os_version ?? "",
    device_model: input.device_model ?? "",
    country: input.country ?? "",
    region: input.region ?? "",
    city: input.city ?? "",
    language: input.language ?? "",
    ip: input.ip ?? "",
    revenue: input.revenue ?? (input.price ?? 0) * (input.quantity ?? 0),
  };
}
