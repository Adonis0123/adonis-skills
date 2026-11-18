import { cx } from "./utils";

/**
 * A few hand-inked tick strokes (DESIGN.md "small marks"): beside the primary
 * button and after section titles. Decorative only; the stroke is the --ink
 * role (see .ink-ticks in custom.css). `flip` mirrors it to sit on the left.
 */
export function InkTicks({
  className,
  flip = false,
}: {
  className?: string;
  flip?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      className={cx("ink-ticks", flip && "-scale-x-100", className)}
    >
      <path d="M4 15 C 4.8 11.5, 5.8 8.4, 7.2 5" />
      <path d="M9.5 17 C 12 13.6, 14.2 11.2, 17.4 8.6" />
      <path d="M11.5 21.6 C 14.6 20.6, 17.6 19.9, 21 19.6" />
    </svg>
  );
}
