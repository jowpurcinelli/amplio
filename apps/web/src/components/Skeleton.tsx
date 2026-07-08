/** A shimmering placeholder shown while a query is in flight. */
export function ChartSkeleton({ height = 300 }: { height?: number }) {
  return <div className="skeleton skeleton-chart" style={{ height }} aria-hidden />;
}

export function RowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skeleton-rows" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - (i % 3) * 12}%` }} />
      ))}
    </div>
  );
}
