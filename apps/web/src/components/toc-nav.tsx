"use client";

import { useEffect, useState } from "react";
import { cx } from "@/components/ui/utils";

export interface TocEntry {
  id: string;
  label: string;
  /** 2 = top level, 3 = nested. */
  level: number;
}

interface TocNavProps {
  title: React.ReactNode;
  entries: TocEntry[];
}

/** Headings count as passed once their top crosses this line: the sticky header plus scroll-mt-28 (112px) and a little slack. */
export const TOC_ACTIVE_OFFSET_PX = 120;

export interface TocHeadingPosition {
  id: string;
  /** Distance from the viewport top, as getBoundingClientRect().top. */
  top: number;
}

/**
 * Picks the current section: the last heading whose top has crossed `threshold`.
 * Before any heading crosses it the first one is current; at the page bottom the last one is,
 * since short trailing sections can never reach the line.
 */
export function resolveActiveTocId(
  headings: TocHeadingPosition[],
  threshold: number,
  atBottom: boolean,
): string | null {
  if (headings.length === 0) return null;
  if (atBottom) return headings[headings.length - 1].id;

  let activeId = headings[0].id;
  for (const heading of headings) {
    if (heading.top > threshold) break;
    activeId = heading.id;
  }
  return activeId;
}

/** Sticky table of contents that marks the section currently in view (aria-current). */
export function TocNav({ title, entries }: TocNavProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const targets = entries
      .map((entry) => document.getElementById(entry.id))
      .filter((node): node is HTMLElement => node !== null);
    if (targets.length === 0) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const root = document.documentElement;
      const atBottom =
        window.scrollY > 0 &&
        window.innerHeight + window.scrollY >= root.scrollHeight - 2;
      const headings = targets.map((target) => ({
        id: target.id,
        top: target.getBoundingClientRect().top,
      }));
      setActiveId(resolveActiveTocId(headings, TOC_ACTIVE_OFFSET_PX, atBottom));
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [entries]);

  return (
    <nav
      aria-labelledby="toc-title"
      className="hidden lg:sticky lg:top-24 lg:block"
    >
      <h2 id="toc-title" className="kicker mb-3 text-muted-foreground">
        {title}
      </h2>
      <ol className="max-h-[70vh] space-y-0.5 overflow-y-auto border-l border-border pr-2 text-sm [scrollbar-width:thin]">
        {entries.map((entry) => {
          const active = entry.id === activeId;
          return (
            <li key={entry.id}>
              <a
                href={`#${entry.id}`}
                aria-current={active ? "location" : undefined}
                className={cx(
                  "clay-focus-ring -ml-px block rounded-r-md border-l-2 py-1 leading-snug transition-colors",
                  entry.level >= 3 ? "pl-6" : "pl-3",
                  active
                    ? "border-primary font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {entry.label}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
