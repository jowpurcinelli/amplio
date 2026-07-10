import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.js";

/**
 * The one empty-state pattern used everywhere: a monochrome line icon in a
 * raised tile, a bold heading, a supporting line, and an optional action. Keeps
 * every "no data yet" screen consistent and intentional instead of bare text.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: IconName | string;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-glyph">
        <Icon name={icon} size={24} />
      </div>
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}
