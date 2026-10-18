"use client";

import { MotionConfig, motion } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { durations, easings, offsets, stagger } from "./tokens";

/**
 * Card-grid reveal: each item fades in and rises ~10px once it scrolls into
 * view. Items present when the list first mounts start 40ms apart (capped at
 * `stagger.maxSteps`); items added later (e.g. by a filter) appear at once.
 *
 * Each item controls its own animation instead of inheriting variants from
 * the list. Inherited variants fought with AnimatePresence exits during
 * filtering (exiting cards stuck visible, kept cards replaying the stagger).
 *
 * Reduced motion: `MotionConfig reducedMotion="user"` drops the transform,
 * keeping a short opacity fade. Server HTML is identical either way, so
 * there is no hydration mismatch.
 */

type EntranceDelay = (index: number | undefined) => number;

const EntranceDelayContext = createContext<EntranceDelay>(() => 0);

/** Seconds an item at `index` waits on the list's first reveal. */
export function staggerDelay(index: number | undefined, baseDelay = 0) {
  if (typeof index !== "number" || index < 0) return baseDelay;
  return baseDelay + Math.min(index, stagger.maxSteps) * stagger.step;
}

/** Provides first-mount stagger delays; after the list mounts, new items get 0. */
export function StaggerScope({
  children,
  delay = 0,
}: {
  children: ReactNode;
  /** Seconds before the first item starts. */
  delay?: number;
}) {
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
  }, []);
  const getDelay = useCallback<EntranceDelay>(
    (index) => (mountedRef.current ? 0 : staggerDelay(index, delay)),
    [delay],
  );
  return (
    <MotionConfig reducedMotion="user">
      <EntranceDelayContext.Provider value={getDelay}>
        {children}
      </EntranceDelayContext.Provider>
    </MotionConfig>
  );
}

/** Delay for this item, fixed at its first render. */
export function useEntranceDelay(index: number | undefined) {
  const getDelay = useContext(EntranceDelayContext);
  const [delay] = useState(() => getDelay(index));
  return delay;
}

export const entranceHidden = { opacity: 0, y: offsets.rise };
export const entranceVisible = { opacity: 1, y: 0 };

export function entranceTransition(delay: number) {
  return { duration: durations.slow, ease: easings.softOut, delay };
}

type ContainerTag = "div" | "ul" | "ol" | "section";

export interface StaggerListProps {
  children: ReactNode;
  className?: string;
  as?: ContainerTag;
  /** Seconds before the first child starts. */
  delay?: number;
  ref?: Ref<HTMLElement>;
}

export function StaggerList({
  children,
  className,
  as: Tag = "div",
  delay = 0,
  ref,
}: StaggerListProps) {
  return (
    <StaggerScope delay={delay}>
      <Tag
        // One ref type cannot match every tag in the union; callers get the DOM node.
        ref={ref as never}
        className={className}
      >
        {children}
      </Tag>
    </StaggerScope>
  );
}

const items = {
  div: motion.div,
  li: motion.li,
  article: motion.article,
} as const;

export interface StaggerItemProps {
  children: ReactNode;
  className?: string;
  as?: keyof typeof items;
  /** Position in the list; drives the first-reveal stagger. */
  index?: number;
  ref?: Ref<HTMLElement>;
}

export function StaggerItem({
  children,
  className,
  as = "div",
  index,
  ref,
}: StaggerItemProps) {
  const Component = items[as] as typeof motion.div;
  const delay = useEntranceDelay(index);
  return (
    <Component
      ref={ref as Ref<HTMLDivElement>}
      className={className}
      initial={entranceHidden}
      whileInView={entranceVisible}
      viewport={{ once: true, amount: 0.15 }}
      transition={entranceTransition(delay)}
    >
      {children}
    </Component>
  );
}
