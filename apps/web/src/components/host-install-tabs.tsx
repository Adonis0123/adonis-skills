"use client";

import {
  type KeyboardEvent,
  type ReactNode,
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
import { DEFAULT_HOST_ID, HOST_INSTALLS, type HostId } from "@/config/hosts";

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

export interface InstallTab<Id extends string> {
  id: Id;
  /** Product names shown on the tab; not translated. */
  label: string;
  /** Second line on the tab, hidden on phones. */
  subtitle?: string;
}

interface InstallTabsProps<Id extends string> {
  tabs: readonly InstallTab<Id>[];
  defaultId: Id;
  /** localStorage key that remembers the visitor's last tab. */
  storageKey: string;
  ariaLabel: string;
  children: (activeId: Id) => ReactNode;
  className?: string;
}

/** ARIA tabs with a sliding pill; remembers the last tab per `storageKey`. Shared by skill and plugin installs. */
export function InstallTabs<Id extends string>({
  tabs,
  defaultId,
  storageKey,
  ariaLabel,
  children,
  className,
}: InstallTabsProps<Id>) {
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [storedId, setStoredId] = useLocalStorageState<Id>(storageKey, {
    defaultValue: defaultId,
  });
  // False during SSR and hydration, true afterwards: the stored tab is applied only after hydration,
  // so server HTML and the first client render agree.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const activeId =
    hydrated && tabs.some((tab) => tab.id === storedId)
      ? (storedId as Id)
      : defaultId;
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeId),
  );
  const active = tabs[activeIndex];
  const tablistRef = useRef<HTMLDivElement>(null);
  // Measured position of the selected tab; null until the first client measure.
  const [indicator, setIndicator] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  // Enable the slide transition only after the first paint, so the pill never animates in.
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const list = tablistRef.current;
    if (!list) return;
    const measure = () => {
      const tab = tabRefs.current[activeIndex];
      if (!tab) return;
      const next = {
        left: tab.offsetLeft,
        top: tab.offsetTop,
        width: tab.offsetWidth,
        height: tab.offsetHeight,
      };
      setIndicator((prev) =>
        prev &&
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : next,
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
    const last = tabs.length - 1;
    const next = {
      ArrowRight: activeIndex === last ? 0 : activeIndex + 1,
      ArrowLeft: activeIndex === 0 ? last : activeIndex - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setStoredId(tabs[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className={cx("@container", className)}>
      <div
        ref={tablistRef}
        role="tablist"
        aria-label={ariaLabel}
        // Four or more tabs wrap to two rows when the container (not the viewport) is narrow,
        // so a sidebar install card never truncates product names.
        className={cx(
          "ink-box ink-box--md relative grid gap-1 bg-muted p-1",
          tabs.length > 3 ? "grid-cols-2 @lg:grid-cols-4" : "grid-cols-3",
        )}
        onKeyDown={onKeyDown}
      >
        {indicator && (
          <span
            aria-hidden
            className={cx(
              // Neutral pill: the page keeps its one accent for the primary button and tags.
              "ink-box ink-box--sm absolute top-0 left-0 bg-card shadow-clay-raised motion-reduce:transition-none",
              animate &&
                "transition-[transform,width,height] duration-200 ease-out",
            )}
            style={{
              transform: `translate(${indicator.left}px, ${indicator.top}px)`,
              width: indicator.width,
              height: indicator.height,
            }}
          />
        )}
        {tabs.map((tab, index) => {
          const selected = tab.id === activeId;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={`${baseId}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setStoredId(tab.id)}
              className={cx(
                "clay-focus-ring relative flex min-h-11 min-w-0 flex-col items-center justify-center rounded-[10px] px-1 py-1 text-center transition-colors duration-200 sm:px-3",
                selected
                  ? cx(
                      "text-foreground",
                      !indicator && "ink-box ink-box--sm bg-card",
                    )
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="hand-label max-w-full truncate text-[15px] font-bold sm:text-base">
                {tab.label}
              </span>
              {tab.subtitle && (
                <span className="hidden max-w-full truncate text-[11px] leading-4 text-muted-foreground sm:block">
                  {tab.subtitle}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        id={`${baseId}-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${active.id}`}
        className="mt-3"
      >
        {children(active.id)}
      </div>
    </div>
  );
}

/** Install commands per Host, as an ARIA tabs widget; remembers the visitor's last Host. */
export function HostInstallTabs({ slug, className }: HostInstallTabsProps) {
  const { t } = useLingui();

  return (
    <InstallTabs<HostId>
      tabs={HOST_INSTALLS}
      defaultId={DEFAULT_HOST_ID}
      storageKey="nika-skills:host"
      ariaLabel={t({
        id: "install.tabs.aria",
        message: "Choose target agent",
      })}
      className={className}
    >
      {(activeId) => {
        const active =
          HOST_INSTALLS.find((host) => host.id === activeId) ??
          HOST_INSTALLS[0];
        const hostLabel = active.label;
        return (
          <>
            <p className="mb-2 text-[13px] leading-5 text-pretty text-muted-foreground">
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
          </>
        );
      }}
    </InstallTabs>
  );
}
