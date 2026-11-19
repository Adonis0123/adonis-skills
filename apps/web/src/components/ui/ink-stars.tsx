import { cx } from "./utils";

/**
 * Two hand-inked stars and a pair of tick strokes (DESIGN.md "small marks"):
 * the mustard sparkle beside the hero headline. Decorative only; colours are
 * the --mustard and --ink roles (see .ink-stars in custom.css).
 */
export function InkStars({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden
      focusable="false"
      className={cx("ink-stars", className)}
    >
      <path
        className="ink-stars__star"
        d="M28.0 2.8 L33.4 11.6 L43.1 10.0 L37.5 17.7 L41.1 26.1 L32.4 23.4 L25.6 29.0 L25.5 20.2 L16.7 15.5 L26.5 12.9 Z"
      />
      <path
        className="ink-stars__star"
        d="M12.4 31.2 L13.4 36.6 L18.0 38.0 L14.1 40.7 L14.4 45.9 L10.4 42.2 L5.3 44.5 L7.6 39.5 L4.6 35.6 L9.5 35.9 Z"
      />
      <path className="ink-stars__tick" d="M4 14 C 5.2 10.8, 7 8.4, 9.6 6.2" />
      <path
        className="ink-stars__tick"
        d="M11.6 19.4 C 12.6 17, 14 15.2, 16 13.6"
      />
    </svg>
  );
}
