"use client";

import {
  type KeyboardEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useLocalStorageState } from "ahooks";
import { Trans, useLingui } from "@lingui/react/macro";
import { CommandBlock } from "@/components/command-block";
import { cx } from "@/components/ui/utils";
import {
  DEFAULT_HOST_ID,
  HOST_INSTALLS,
  type HostId,
  isHostId,
} from "@/config/hosts";

interface HostInstallTabsProps {
  slug: string;
  className?: string;
}

function HostHint({ id }: { id: HostId }) {
  switch (id) {
    case "claude-code":
      return (
        <Trans id="install.hint.claudeCode">
          Run this in Claude Code. The plugin installs the whole collection at
          once.
        </Trans>
      );
    case "hermes":
      return (
        <Trans id="install.hint.hermes">
          Run this in Hermes Agent to install this skill.
        </Trans>
      );
    default:
      return (
        <Trans id="install.hint.skillsCli">
          Use this for Codex, Cursor, or any agent the skills CLI supports. Add
          -g to install globally.
        </Trans>
      );
  }
}

const noopSubscribe = () => () => {};

/** Install commands per Host, as an ARIA tabs widget; remembers the visitor's last Host. */
export function HostInstallTabs({ slug, className }: HostInstallTabsProps) {
  const { t } = useLingui();
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [storedHost, setStoredHost] = useLocalStorageState<HostId>(
    "nika-skills:host",
    {
      defaultValue: DEFAULT_HOST_ID,
    },
  );
  // False during SSR and hydration, true afterwards: the stored Host is applied only after hydration,
  // so server HTML and the first client render agree.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const activeId =
    hydrated && isHostId(storedHost) ? storedHost : DEFAULT_HOST_ID;
  const activeIndex = HOST_INSTALLS.findIndex((host) => host.id === activeId);
  const active = HOST_INSTALLS[activeIndex];
  const hostLabel = active.label;
  const tablistRef = useRef<HTMLDivElement>(null);
  // Measured position of the selected tab; null until the first client measure.
  const [indicator, setIndicator] = useState<{
    left: number;
    width: number;
  } | null>(null);
  // Enable the slide transition only after the first paint, so the pill never animates in.
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const list = tablistRef.current;
    if (!list) return;
    const measure = () => {
      const tab = tabRefs.current[activeIndex];
      if (!tab) return;
      setIndicator((prev) =>
        prev?.left === tab.offsetLeft && prev.width === tab.offsetWidth
          ? prev
          : { left: tab.offsetLeft, width: tab.offsetWidth },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeIndex]);

  useLayoutEffect(() => {
    if (!hydrated || !indicator || animate) return;
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [hydrated, indicator, animate]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = HOST_INSTALLS.length - 1;
    const next = {
      ArrowRight: activeIndex === last ? 0 : activeIndex + 1,
      ArrowLeft: activeIndex === 0 ? last : activeIndex - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setStoredHost(HOST_INSTALLS[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className={className}>
      <div
        ref={tablistRef}
        role="tablist"
        aria-label={t({
          id: "install.tabs.aria",
          message: "Choose target agent",
        })}
        className="relative grid grid-cols-3 gap-1 rounded-[12px] border border-border bg-muted p-1"
        onKeyDown={onKeyDown}
      >
        {indicator && (
          <span
            aria-hidden
            className={cx(
              // Neutral pill: the page keeps its one accent for the primary button and tags.
              "absolute inset-y-1 left-0 rounded-[10px] border border-input bg-card shadow-clay-raised motion-reduce:transition-none",
              animate && "transition-[transform,width] duration-200 ease-out",
            )}
            style={{
              transform: `translateX(${indicator.left}px)`,
              width: indicator.width,
            }}
          />
        )}
        {HOST_INSTALLS.map((host, index) => {
          const selected = host.id === activeId;
          return (
            <button
              key={host.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={`${baseId}-tab-${host.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setStoredHost(host.id)}
              className={cx(
                "clay-focus-ring relative flex min-h-11 min-w-0 flex-col items-center justify-center rounded-[10px] px-1 py-1.5 text-center transition-colors duration-200 sm:px-3",
                selected
                  ? cx(
                      "text-foreground",
                      !indicator && "border border-input bg-card",
                    )
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="max-w-full truncate text-[13px] font-bold sm:text-sm">
                {host.label}
              </span>
              <span className="hidden max-w-full truncate text-xs text-muted-foreground sm:block">
                {host.subtitle}
              </span>
            </button>
          );
        })}
      </div>

      <div
        id={`${baseId}-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${active.id}`}
        className="mt-4"
      >
        <p className="mb-3 text-sm text-pretty text-muted-foreground">
          <HostHint id={active.id} />
        </p>
        <CommandBlock
          key={active.id}
          commands={active.commands(slug)}
          label={t({
            id: "install.copy.aria",
            message: `Copy the ${hostLabel} install command`,
          })}
        />
      </div>
    </div>
  );
}
