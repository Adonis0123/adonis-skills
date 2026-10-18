"use client";

import {
  AnimatePresence,
  MotionConfig,
  motion,
  type HTMLMotionProps,
} from "motion/react";
import type { ReactNode, Ref } from "react";
import { durations, easings, offsets, springs } from "./tokens";

/**
 * Micro-interactions for buttons and chips. Transforms only, so layout flow
 * never changes and focus-visible outlines (drawn outside the box) are not
 * clipped. Hover only fires for mouse pointers (motion filters touch).
 * Reduced motion: `reducedMotion="user"` turns the transforms off.
 */

/** Spread onto any existing `motion.*` element. */
export const pressMotionProps = {
  whileHover: { y: offsets.hoverLift },
  whileTap: { scale: offsets.tapScale, y: 0 },
  transition: springs.press,
} as const satisfies Pick<
  HTMLMotionProps<"button">,
  "whileHover" | "whileTap" | "transition"
>;

export interface PressScaleProps {
  children: ReactNode;
  className?: string;
  /** "inline" (default) wraps a single button/chip; "block" for full-width buttons. */
  display?: "inline" | "block";
  /** Disable hover lift (e.g. chips inside a dense row). Tap scale stays. */
  noLift?: boolean;
  ref?: Ref<HTMLSpanElement>;
}

/**
 * Wraps an existing interactive element (ClayButton, chip, link) so it lifts
 * on hover and compresses on tap. The wrapper is a span, so the child keeps
 * its own semantics, focus ring and click handling.
 *
 * Note: if the child already has a CSS hover `transform` (custom.css
 * `.clay-button`), remove that rule when wiring this in, or the lifts stack.
 */
export function PressScale({
  children,
  className,
  display = "inline",
  noLift = false,
  ref,
}: PressScaleProps) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.span
        ref={ref}
        // `.press-scale` lets custom.css switch off the child's own CSS hover/press transforms.
        className={className ? `press-scale ${className}` : "press-scale"}
        style={{ display: display === "block" ? "flex" : "inline-flex" }}
        // motion adds tabIndex=0 to elements with whileTap; the child is the real
        // focus target, so keep the wrapper out of the tab order.
        tabIndex={-1}
        whileHover={noLift ? undefined : pressMotionProps.whileHover}
        whileTap={pressMotionProps.whileTap}
        transition={pressMotionProps.transition}
      >
        {children}
      </motion.span>
    </MotionConfig>
  );
}

export interface IconSwapProps {
  /** Changing this key swaps the icon (e.g. "idle" -> "done" after copying). */
  swapKey: string;
  children: ReactNode;
  className?: string;
}

/**
 * Cross-fades between icons with a small scale pop, e.g. copy -> check.
 * The box keeps the child's size via inline-grid stacking, so the button
 * width never jumps.
 *
 * <IconSwap swapKey={copied ? "done" : "idle"}>
 *   {copied ? <CheckIcon /> : <CopyIcon />}
 * </IconSwap>
 */
export function IconSwap({ swapKey, children, className }: IconSwapProps) {
  return (
    <MotionConfig reducedMotion="user">
      <span
        className={className}
        style={{ display: "inline-grid", placeItems: "center" }}
        aria-hidden="true"
      >
        <AnimatePresence initial={false}>
          <motion.span
            key={swapKey}
            style={{ gridArea: "1 / 1", display: "inline-flex" }}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1, transition: springs.press }}
            exit={{
              opacity: 0,
              scale: 0.6,
              transition: { duration: durations.instant, ease: easings.exit },
            }}
          >
            {children}
          </motion.span>
        </AnimatePresence>
      </span>
    </MotionConfig>
  );
}
