// A small, dependency-free icon set (Lucide-style geometry): 24x24 viewBox,
// stroke = currentColor, so an icon takes the color and size of its context.
// One component, one <path> table, keeps the bundle tiny and the look coherent.

const PATHS: Record<string, string> = {
  events: "M4 5h16M4 12h16M4 19h10",
  live: "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M5.6 5.6a9 9 0 0 0 0 12.8 M18.4 5.6a9 9 0 0 1 0 12.8",
  segmentation: "M4 19V5 M4 19h16 M8 16l3-4 3 2 4-6",
  funnel: "M3 5h18l-7 8v6l-4-2v-4z",
  retention: "M4 11a8 8 0 0 1 14-5l2 2 M20 4v4h-4 M20 13a8 8 0 0 1-14 5l-2-2 M4 20v-4h4",
  users: "M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1 M9.5 7.5m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0 M21 20v-1a4 4 0 0 0-3-3.87 M16 4.13A4 4 0 0 1 16 11.6",
  cohorts: "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
  replays: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z M10 9l5 3-5 3z",
  flags: "M5 21V4 M5 4h11l-2 4 2 4H5",
  experiments: "M9 3h6 M10 3v6l-5 8a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 17l-5-8V3 M7.5 14h9",
  dashboards: "M4 4h7v9H4z M13 4h7v5h-7z M13 13h7v7h-7z M4 17h7v3H4z",
  library: "M4 6h16v13H4z M4 6l2-2h5l2 2 M8 11h8 M8 15h5",
  team: "M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1 M9.5 7.5m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0 M21 20v-1a4 4 0 0 0-3-3.87 M16 4.13A4 4 0 0 1 16 11.6",
  keys: "M15 9m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M11.5 12.5L4 20l2 2 M7 17l2 2 M10 14l2 2",
  account: "M6 4h9l3 3v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1 M12 11m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M8.5 17a3.5 3.5 0 0 1 7 0",
  admin: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z M9 12l2 2 4-4",
  settings: "M4 7h16 M4 12h16 M4 17h16 M9 7m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M15 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M7 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
  sun: "M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  monitor: "M3 5h18v11H3z M8 20h8 M12 16v4",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3 M10 17l5-5-5-5 M15 12H3",
  login: "M14 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3 M9 17l5-5-5-5 M14 12H2",
  chevron: "M6 9l6 6 6-6",
  plus: "M12 5v14 M5 12h14",
  search: "M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0 M21 21l-4-4",
  external: "M14 4h6v6 M20 4l-8 8 M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4",
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  className,
  strokeWidth = 1.75,
}: {
  name: IconName | string;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  const d = PATHS[name] ?? "";
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d.split(" M").map((seg, i) => (
        <path key={i} d={(i === 0 ? seg : "M" + seg).trim()} />
      ))}
    </svg>
  );
}
