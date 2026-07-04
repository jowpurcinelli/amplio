import { z } from "zod";

/**
 * Amplio event schema.
 *
 * The public envelope mirrors Amplitude's HTTP V2 event so existing
 * instrumentation and SDKs port over with minimal changes. Fields not listed
 * here are still accepted and preserved in `event_properties` passthrough at
 * the ingest layer, but the typed fields below are the ones Amplio indexes.
 *
 * @see https://amplitude.com/docs/apis/analytics/http-v2
 */

const propertyValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);

export const propertyBag = z.record(propertyValue);
export type PropertyBag = z.infer<typeof propertyBag>;

/** A single event as sent by a client. */
export const eventInput = z
  .object({
    /** Name of the event, e.g. "signup", "song_played". Required. */
    event_type: z.string().min(1).max(1024),

    /** Identified user id. One of user_id or device_id is required. */
    user_id: z.string().min(1).max(512).optional(),
    /** Anonymous device id. One of user_id or device_id is required. */
    device_id: z.string().min(1).max(512).optional(),

    /** Client event time in epoch milliseconds. Server time is used if absent. */
    time: z.number().int().nonnegative().optional(),

    /** Arbitrary event-level properties. */
    event_properties: propertyBag.optional(),
    /** Arbitrary user-level properties set with this event. */
    user_properties: propertyBag.optional(),
    /** Account-level group membership (e.g. { company: "acme" }). */
    groups: z.record(z.union([z.string(), z.array(z.string())])).optional(),

    /** Client-provided unique id for idempotent ingestion / dedupe. */
    insert_id: z.string().max(512).optional(),
    /** Client-provided event id (monotonic per device). */
    event_id: z.number().int().optional(),
    /** Session id (epoch ms of session start), -1 if none. */
    session_id: z.number().int().optional(),

    /** Context. */
    app_version: z.string().max(512).optional(),
    platform: z.string().max(512).optional(),
    os_name: z.string().max(512).optional(),
    os_version: z.string().max(512).optional(),
    device_brand: z.string().max(512).optional(),
    device_manufacturer: z.string().max(512).optional(),
    device_model: z.string().max(512).optional(),
    carrier: z.string().max(512).optional(),
    country: z.string().max(512).optional(),
    region: z.string().max(512).optional(),
    city: z.string().max(512).optional(),
    dma: z.string().max(512).optional(),
    language: z.string().max(512).optional(),

    /** Revenue. */
    price: z.number().optional(),
    quantity: z.number().int().optional(),
    revenue: z.number().optional(),
    productId: z.string().max(512).optional(),
    revenueType: z.string().max(512).optional(),

    /** Geo hints. */
    location_lat: z.number().optional(),
    location_lng: z.number().optional(),
    ip: z.string().max(64).optional(),
  })
  .refine((e) => e.user_id != null || e.device_id != null, {
    message: "one of user_id or device_id is required",
  });

export type EventInput = z.infer<typeof eventInput>;

/** Ingestion request body, Amplitude HTTP V2 compatible. */
export const ingestRequest = z.object({
  api_key: z.string().min(1),
  events: z.array(eventInput).min(1).max(2000),
  /** Optional client-supplied upload time (epoch ms). */
  client_upload_time: z.number().int().optional(),
  /** Optional per-request options (kept for compatibility). */
  options: z
    .object({
      min_id_length: z.number().int().positive().optional(),
    })
    .optional(),
});

export type IngestRequest = z.infer<typeof ingestRequest>;

/**
 * Normalized event as stored in ClickHouse. The ingest layer produces these
 * from validated EventInput, filling server-side fields.
 */
export interface StoredEvent {
  project_id: string;
  event_id: string;
  event_type: string;
  user_id: string;
  device_id: string;
  /** Event time (client time if provided, else server receive time), epoch ms. */
  time: number;
  /** Server receive time, epoch ms. */
  server_received_time: number;
  session_id: number;
  insert_id: string;
  event_properties: Record<string, string>;
  user_properties: Record<string, string>;
  groups: Record<string, string>;
  app_version: string;
  platform: string;
  os_name: string;
  os_version: string;
  device_model: string;
  country: string;
  region: string;
  city: string;
  language: string;
  ip: string;
  revenue: number;
}

/** Standard ingestion response, Amplitude compatible. */
export interface IngestResponse {
  code: number;
  events_ingested: number;
  payload_size_bytes: number;
  server_upload_time: number;
}

export const SCHEMA_VERSION = 1 as const;
