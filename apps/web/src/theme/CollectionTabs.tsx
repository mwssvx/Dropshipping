"use client";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * Collections as tabs over one product grid. The grids come drawn by the server; this only picks
 * which one shows. The arrow keys, Home and End move between tabs, as screen reader users expect.
 */
export function CollectionTabs({ tabs, label, children }: { tabs: string[]; label: string; children: ReactNode[] }) {
  const id = useId();
  const [on, setOn] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const go = (i: number) => {
    const next = (i + tabs.length) % tabs.length;
    setOn(next);
    refs.current[next]?.focus();
  };
  const keys = (e: KeyboardEvent) => {
    const to = { ArrowRight: on + 1, ArrowLeft: on - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    go(to);
  };
  return (
    <div className="sf-collection-tabs flex flex-col gap-6">
      <div role="tablist" aria-label={label} className="flex gap-2 overflow-x-auto pb-1" onKeyDown={keys}>
        {tabs.map((t, i) => (
          <button key={i} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`${id}-tab${i}`} aria-controls={`${id}-panel${i}`}
            aria-selected={i === on} tabIndex={i === on ? 0 : -1} onClick={() => setOn(i)}
            className={`btn shrink-0 ${i === on ? "btn-primary" : "btn-secondary"}`}>
            {t}
          </button>
        ))}
      </div>
      {children.map((panel, i) => (
        <div key={i} role="tabpanel" id={`${id}-panel${i}`} aria-labelledby={`${id}-tab${i}`} hidden={i !== on} className="flex flex-col gap-6">
          {panel}
        </div>
      ))}
    </div>
  );
}
