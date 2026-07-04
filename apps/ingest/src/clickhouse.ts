import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { StoredEvent } from "@amplio/schema";
import type { Config } from "./config.js";

export const EVENTS_DDL = (database: string) => `
CREATE TABLE IF NOT EXISTS ${database}.events
(
  project_id LowCardinality(String),
  event_id String,
  event_type LowCardinality(String),
  user_id String,
  device_id String,
  time_ms UInt64,
  time DateTime64(3, 'UTC') MATERIALIZED fromUnixTimestamp64Milli(time_ms),
  server_received_time_ms UInt64,
  session_id Int64,
  insert_id String,
  event_properties Map(String, String),
  user_properties Map(String, String),
  groups Map(String, String),
  app_version String,
  platform LowCardinality(String),
  os_name LowCardinality(String),
  os_version String,
  device_model String,
  country LowCardinality(String),
  region String,
  city String,
  language LowCardinality(String),
  ip String,
  revenue Float64
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(time)
ORDER BY (project_id, event_type, time)
SETTINGS index_granularity = 8192
`;
// Note: no default TTL. Amplio keeps all events so historical backfills and
// imports are never silently dropped. Operators who want a retention window
// add it explicitly, keyed on ingestion time so imports are unaffected, e.g.:
//   ALTER TABLE amplio.events
//     MODIFY TTL toDateTime(fromUnixTimestamp64Milli(server_received_time_ms))
//              + INTERVAL 24 MONTH;

/** Row shape inserted into ClickHouse via JSONEachRow. */
interface EventRow {
  project_id: string;
  event_id: string;
  event_type: string;
  user_id: string;
  device_id: string;
  time_ms: number;
  server_received_time_ms: number;
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

export function toRow(e: StoredEvent): EventRow {
  return {
    project_id: e.project_id,
    event_id: e.event_id,
    event_type: e.event_type,
    user_id: e.user_id,
    device_id: e.device_id,
    time_ms: e.time,
    server_received_time_ms: e.server_received_time,
    session_id: e.session_id,
    insert_id: e.insert_id,
    event_properties: e.event_properties,
    user_properties: e.user_properties,
    groups: e.groups,
    app_version: e.app_version,
    platform: e.platform,
    os_name: e.os_name,
    os_version: e.os_version,
    device_model: e.device_model,
    country: e.country,
    region: e.region,
    city: e.city,
    language: e.language,
    ip: e.ip,
    revenue: e.revenue,
  };
}

export function makeClient(cfg: Config): ClickHouseClient {
  return createClient({
    url: cfg.clickhouse.url,
    username: cfg.clickhouse.username,
    password: cfg.clickhouse.password,
    database: cfg.clickhouse.database,
    clickhouse_settings: {
      // Server-side batching for throughput. wait=1 keeps inserts durable and
      // immediately queryable, which the read-back path and tests rely on. A
      // high-throughput deployment can flip wait to 0 and accept slight delay.
      async_insert: 1,
      wait_for_async_insert: 1,
    },
  });
}

export async function ensureSchema(client: ClickHouseClient, cfg: Config): Promise<void> {
  await client.command({
    query: `CREATE DATABASE IF NOT EXISTS ${cfg.clickhouse.database}`,
  });
  await client.command({ query: EVENTS_DDL(cfg.clickhouse.database) });
}

export async function insertEvents(
  client: ClickHouseClient,
  cfg: Config,
  events: StoredEvent[],
): Promise<void> {
  if (events.length === 0) return;
  await client.insert({
    table: `${cfg.clickhouse.database}.events`,
    values: events.map(toRow),
    format: "JSONEachRow",
  });
}
