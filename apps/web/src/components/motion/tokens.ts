/**
 * Shared motion tokens for the catalog site.
 *
 * Follows docs/web-ui-clay-contract.md "Motion": restrained, cubic-bezier
 * curves, reduced-motion fallback, transforms only (no layout-flow changes).
 * DESIGN.md asks primary buttons to "lift 1px on hover and settle on press";
 * `lift.hover` and `springs.press` encode that.
 *
 * Durations are in seconds (motion's unit), not milliseconds.
 */

export type CubicBezier = readonly [number, number, number, number];

export const easings = {
  /** Default enter / settle curve. Same curve the existing CSS uses (custom.css). */
  softOut: [0.22, 1, 0.36, 1],
  /** Neutral in-out for state swaps that move both ways. */
  standard: [0.2, 0, 0, 1],
  /** Exits: start slow, leave quickly. */
  exit: [0.4, 0, 1, 1],
  /** Reduced-motion fades (matches mobile-header-menu). */
  reduce: [0.3, 0, 1, 1],
} as const satisfies Record<string, CubicBezier>;

export const durations = {
  instant: 0.08,
  fast: 0.16,
  base: 0.22,
  layout: 0.26,
  slow: 0.32,
  /** Smooth anchor scroll: lower and upper bound, scaled by distance in between. */
  scrollMin: 0.28,
  scrollMax: 0.9,
} as const;

export const springs = {
  /** Buttons and chips: quick, barely any overshoot. */
  press: { type: "spring", stiffness: 520, damping: 32, mass: 0.6 },
  /** Section-sized reveals (same feel as SectionReveal). */
  gentle: { type: "spring", stiffness: 112, damping: 18 },
} as const;

export const stagger = {
  /** Delay between siblings in a card grid. */
  step: 0.04,
  /** Items past this index start with the last slot, so long lists never drag. */
  maxSteps: 8,
} as const;

export const offsets = {
  /** Rise distance for list items (px). */
  rise: 10,
  /** Hover lift for buttons and chips (px, negative = up). */
  hoverLift: -1.5,
  /** Tap scale for buttons and chips. */
  tapScale: 0.97,
  /** Scale cards shrink to while leaving a filtered list. */
  exitScale: 0.96,
} as const;
