import {
  FLIGHT,
  flightFrames,
  landingScale,
  type Point,
} from "@/lib/flight-path";
import { flightTrail } from "./flight-trail";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function inViewport(rect: DOMRect) {
  return (
    rect.width > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  );
}

/**
 * A pill with `label` lifts off `from` (the row's check box, scale 1 → 1.05),
 * travels a quadratic Bézier arc (lib/flight-path.ts; eased in-out, tilting
 * ≤ 6° with the tangent) trailed by short role-coloured dashes, shrinks to
 * the target's height and lands on `to`'s left edge (`onLine`, a command
 * word) or its centre (the count), fading over its last 80 ms. One WAAPI
 * animation of sampled keyframes; transform and opacity only. After
 * coco-skills' fly-to.ts.
 *
 * The pill is `aria-hidden`, ignores the pointer and lives on
 * `document.body`. Resolves `true` when it lands, and `false` at once when
 * nothing should fly: reduced motion (the new line just appears), no WAAPI,
 * or either end off screen.
 */
export function flyTo(
  from: Element,
  to: Element,
  label: string,
  { delayMs = 0, onLine = false }: { delayMs?: number; onLine?: boolean } = {},
): Promise<boolean> {
  if (typeof document === "undefined" || prefersReducedMotion())
    return Promise.resolve(false);

  return new Promise((resolve) => {
    const launch = () => {
      const startRect = from.getBoundingClientRect();
      const endRect = to.getBoundingClientRect();
      if (
        !from.isConnected ||
        !to.isConnected ||
        !inViewport(startRect) ||
        !inViewport(endRect) ||
        typeof document.body.animate !== "function"
      ) {
        resolve(false);
        return;
      }
      const outer = document.createElement("div");
      outer.className = "plugin-flight";
      outer.setAttribute("aria-hidden", "true");
      const pill = document.createElement("span");
      pill.className = "plugin-flight-pill";
      pill.textContent = label;
      outer.append(pill);
      document.body.append(outer);

      const endScale = landingScale(endRect.height, pill.offsetHeight);
      const start: Point = {
        x: startRect.left + startRect.width / 2,
        y: startRect.top + startRect.height / 2,
      };
      const end: Point = onLine
        ? {
            x:
              endRect.left +
              Math.min(endRect.width, pill.offsetWidth * endScale) / 2,
            y: endRect.top + endRect.height / 2,
          }
        : {
            x: endRect.left + endRect.width / 2,
            y: endRect.top + endRect.height / 2,
          };
      outer.style.left = `${start.x}px`;
      outer.style.top = `${start.y}px`;
      const frames = flightFrames(start, end, { endScale });
      flightTrail({ start, end, endScale });
      const duration = FLIGHT.durationMs;
      const fadeAt = 1 - FLIGHT.fadeMs / duration;
      const flight = pill.animate(
        frames.map((frame) => ({
          offset: frame.offset,
          transform: `translate3d(${frame.x.toFixed(1)}px, ${frame.y.toFixed(1)}px, 0) rotate(${frame.tilt.toFixed(2)}deg) scale(${frame.scale.toFixed(3)})`,
          opacity:
            frame.offset <= fadeAt
              ? 1
              : 1 - (frame.offset - fadeAt) / (1 - fadeAt),
        })),
        { duration, easing: "linear", fill: "forwards" },
      );

      let done = false;
      const land = () => {
        if (done) return;
        done = true;
        outer.remove();
        resolve(true);
      };
      flight.finished.then(land, land);
      // Background tabs may never tick the animation: never leave a ghost behind.
      window.setTimeout(land, duration + 200);
    };

    if (delayMs > 0) window.setTimeout(launch, delayMs);
    else launch();
  });
}

/**
 * Arrival on the line the pill landed on: a soft `--selected` band over the
 * line and a `--primary` underline sweeping left → right, both fixed on
 * `document.body` over `line`'s row of `box` (so no React-owned node is
 * touched) and removed when done. Never under reduced motion.
 */
export function flashLine(line: Element, box: Element | null) {
  if (prefersReducedMotion() || typeof document.body.animate !== "function")
    return;
  const lineRect = line.getBoundingClientRect();
  const boxRect = (box ?? line).getBoundingClientRect();
  const flash = document.createElement("span");
  flash.className = "plugin-line-flash";
  flash.setAttribute("aria-hidden", "true");
  flash.style.left = `${boxRect.left}px`;
  flash.style.width = `${boxRect.width}px`;
  flash.style.top = `${lineRect.top - 2}px`;
  flash.style.height = `${lineRect.height + 4}px`;
  const underline = document.createElement("span");
  underline.className = "plugin-line-underline";
  flash.append(underline);
  document.body.append(flash);
  const easing = "cubic-bezier(0.22, 1, 0.36, 1)";
  flash.animate(
    [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }],
    { duration: FLIGHT.arriveMs, easing },
  );
  const sweep = underline.animate(
    [
      { transform: "scaleX(0)" },
      { transform: "scaleX(1)", offset: 0.55 },
      { transform: "scaleX(1)" },
    ],
    { duration: FLIGHT.arriveMs, easing },
  );
  const done = () => flash.remove();
  sweep.finished.then(done, done);
  window.setTimeout(done, FLIGHT.arriveMs + 200);
}
