"use client";

import {
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  motion,
  type Transition,
} from "motion/react";
import type { ReactNode, Ref } from "react";
import {
  entranceHidden,
  entranceTransition,
  StaggerScope,
  useEntranceDelay,
} from "./stagger";
import { durations, easings, offsets } from "./tokens";

/**
 * Smooth re-flow when search or scenario filters change.
 *
 * - `FilterTransitionGroup` (LayoutGroup) shares layout animations across
 *   several lists, e.g. every scenario group on the home page. Wrap the
 *   whole catalog once.
 * - `FilterTransitionList` is the grid. It wraps its children in
 *   `AnimatePresence mode="popLayout"`, so leaving cards pop out of flow
 *   while siblings slide into place, and gives first-mount items a stagger.
 * - `FilterTransitionItem` is one card: `layout="position"` (no text
 *   stretching), fade+rise in when scrolled into view, fade+shrink out.
 *
 * Children of the list MUST be FilterTransitionItem elements with a stable
 * `key` (e.g. the skill slug). Reduced motion: transforms and layout moves are
 * skipped by `reducedMotion="user"`, only opacity fades remain.
 */

const layoutTransition: Transition = {
  duration: durations.layout,
  ease: easings.softOut,
};

export const filterItemVisible = { opacity: 1, y: 0, scale: 1 };

export const filterItemExit = {
  opacity: 0,
  scale: offsets.exitScale,
  transition: { duration: durations.fast, ease: easings.exit, delay: 0 },
};

export function FilterTransitionGroup({
  children,
  id,
}: {
  children: ReactNode;
  id?: string;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup id={id}>{children}</LayoutGroup>
    </MotionConfig>
  );
}

/** Pass-through `data-*` attributes (e.g. `data-skill-results`, `data-slug`). */
type DataAttributes = {
  [key: `data-${string}`]: string | boolean | undefined;
};

export interface FilterTransitionListProps extends DataAttributes {
  children: ReactNode;
  className?: string;
  as?: "div" | "ul" | "ol";
  ref?: Ref<HTMLElement>;
}

export function FilterTransitionList({
  children,
  className,
  as: Tag = "div",
  ref,
  ...data
}: FilterTransitionListProps) {
  return (
    <StaggerScope>
      <Tag
        {...data}
        // One ref type cannot match every tag in the union; callers get the DOM node.
        ref={ref as never}
        className={className}
        // popLayout positions exiting children absolutely against this box.
        style={{ position: "relative" }}
      >
        <AnimatePresence mode="popLayout">{children}</AnimatePresence>
      </Tag>
    </StaggerScope>
  );
}

const items = {
  div: motion.div,
  li: motion.li,
  article: motion.article,
} as const;

export interface FilterTransitionItemProps extends DataAttributes {
  children: ReactNode;
  className?: string;
  as?: keyof typeof items;
  /** Position in the list; drives the first-reveal stagger. */
  index?: number;
  /** AnimatePresence popLayout needs the ref forwarded to the DOM node. */
  ref?: Ref<HTMLElement>;
}

export function FilterTransitionItem({
  children,
  className,
  as = "div",
  index,
  ref,
  ...data
}: FilterTransitionItemProps) {
  const Component = items[as] as typeof motion.div;
  const delay = useEntranceDelay(index);
  return (
    <Component
      {...data}
      ref={ref as Ref<HTMLDivElement>}
      className={className}
      layout="position"
      initial={entranceHidden}
      whileInView={filterItemVisible}
      viewport={{ once: true, amount: 0.15 }}
      exit={filterItemExit}
      transition={{ ...entranceTransition(delay), layout: layoutTransition }}
    >
      {children}
    </Component>
  );
}

export interface FilterTransitionBlockProps {
  children: ReactNode;
  className?: string;
  as?: "div" | "section";
  id?: string;
  "aria-labelledby"?: string;
}

/**
 * A non-card block (group section, heading row) that glides to its new
 * position when filtering adds or removes content above it, instead of
 * jumping. Must sit inside FilterTransitionGroup to be re-measured together
 * with the lists. Position only, so its text never stretches.
 */
export function FilterTransitionBlock({
  children,
  className,
  as = "div",
  ...rest
}: FilterTransitionBlockProps) {
  const Component = as === "section" ? motion.section : motion.div;
  return (
    <Component
      className={className}
      layout="position"
      transition={{ layout: layoutTransition }}
      {...rest}
    >
      {children}
    </Component>
  );
}
