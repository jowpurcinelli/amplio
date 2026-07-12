import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon.js";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: IconName | string;
  group?: string;
  run: () => void;
}

/**
 * A Cmd/Ctrl-K command palette: fuzzy-ish filter over navigation and actions,
 * full keyboard control (arrows, enter, escape). The kind of affordance a
 * premium app has and a dated one does not.
 */
export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => (c.label + " " + (c.hint ?? "") + " " + (c.group ?? "")).toLowerCase().includes(q));
  }, [query, commands]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // focus after the element is mounted
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  if (!open) return null;

  const choose = (i: number) => {
    const cmd = filtered[i];
    if (cmd) {
      onClose();
      cmd.run();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="cmdk-overlay" onMouseDown={onClose}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="cmdk-input-row">
          <Icon name="search" size={17} />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Search views and actions…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="cmdk-list" ref={listRef}>
          {filtered.length === 0 && <div className="cmdk-empty">No matches</div>}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              className={`cmdk-item${i === active ? " active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <span className="cmdk-icon">
                <Icon name={c.icon} size={16} />
              </span>
              <span className="cmdk-label">{c.label}</span>
              {c.hint && <span className="cmdk-hint">{c.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
