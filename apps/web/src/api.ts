import type { Settings } from "./config.js";

export interface TimeRange {
  from: number;
  to: number;
}

export type Granularity = "hour" | "day" | "week" | "month";
export type Measure = "total" | "unique";
export type PropertyScope = "event" | "user";

export interface PropertyFilter {
  scope: PropertyScope;
  key: string;
  op: "is" | "is_not" | "contains" | "gt" | "lt" | "set" | "not_set";
  values?: string[];
}

async function post<T>(s: Settings, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${s.apiUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${s.readKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function get<T>(s: Settings, path: string): Promise<T> {
  const res = await fetch(`${s.apiUrl}${path}`, {
    headers: { authorization: `Bearer ${s.readKey}` },
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function del(s: Settings, path: string): Promise<void> {
  const res = await fetch(`${s.apiUrl}${path}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${s.readKey}` },
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
}

export interface EventName {
  name: string;
  volume: string;
}
export const fetchEventNames = (s: Settings) =>
  get<{ data: EventName[] }>(s, "/meta/events").then((r) => r.data);

export const fetchPropertyKeys = (s: Settings, event: string, scope: PropertyScope) =>
  get<{ data: { key: string }[] }>(
    s,
    `/meta/properties?event=${encodeURIComponent(event)}&scope=${scope}`,
  ).then((r) => r.data.map((d) => d.key));

export interface SegmentationRow {
  bucket: string;
  group_key?: string;
  value: string;
}
export const querySegmentation = (
  s: Settings,
  body: {
    eventType: string;
    range: TimeRange;
    granularity: Granularity;
    measure: Measure;
    filters?: PropertyFilter[];
    groupBy?: { scope: PropertyScope; key: string };
    limit?: number;
  },
) => post<{ data: SegmentationRow[] }>(s, "/query/segmentation", body).then((r) => r.data);

export const queryFunnel = (
  s: Settings,
  body: { steps: string[]; range: TimeRange; windowSeconds: number; filters?: PropertyFilter[] },
) =>
  post<{ data: Record<string, string>[] }>(s, "/query/funnel", body).then((r) => r.data[0] ?? {});

export interface RetentionRow {
  offset: string;
  retained: string;
}
export const queryRetention = (
  s: Settings,
  body: {
    startEvent: string;
    returnEvent?: string;
    range: TimeRange;
    days: number;
    filters?: PropertyFilter[];
  },
) => post<{ data: RetentionRow[] }>(s, "/query/retention", body).then((r) => r.data);

// --- saved charts ---
export type ChartKind = "segmentation" | "funnel" | "retention";
export interface SavedChart {
  id: string;
  name: string;
  kind: ChartKind;
  definition: Record<string, unknown>;
}
export const listCharts = (s: Settings) =>
  get<{ data: SavedChart[] }>(s, "/charts").then((r) => r.data);
export const createChart = (s: Settings, body: { name: string; kind: ChartKind; definition: Record<string, unknown> }) =>
  post<{ data: SavedChart }>(s, "/charts", body).then((r) => r.data);
export const deleteChart = (s: Settings, id: string) => del(s, `/charts/${id}`);

// --- API keys ---
export interface ApiKeyRow {
  id: string;
  kind: "write" | "read";
  key: string;
  label: string | null;
  createdAt: string;
  revokedAt: string | null;
}
export const listKeys = (s: Settings) => get<{ data: ApiKeyRow[] }>(s, "/keys").then((r) => r.data);
export const createKey = (s: Settings, body: { kind: "write" | "read"; label?: string }) =>
  post<{ data: ApiKeyRow }>(s, "/keys", body).then((r) => r.data);
export const revokeKey = (s: Settings, id: string) => del(s, `/keys/${id}`);
