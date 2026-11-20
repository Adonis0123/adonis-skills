import {
  FLIGHT,
  FLIGHT_TRAIL,
  flightFrames,
  type Point,
} from "@/lib/flight-path";

/** Trail colours, cycled over the dashes: design-system roles only. */
const TRAIL_COLORS = [
  "--primary",
  "--mustard",
  "--tomato",
  "--dusty",
  "--link",
] as const;

export interface TrailEnds {
  start: Point;
  end: Point;
  endScale: number;
}

/**
 * Trail behind the flying pill (fly-to.ts launches it; after coco-skills'
 * flight-trail.ts): short 2px dashes in the role colours ride the pill's
 * exact arc, each along the path's tangent and a few ms behind the last, so
 * together they draw one thin line that fades before the pill lands.
 * Transform and opacity only; `aria-hidden`, ignores the pointer, removes
 * itself. Never runs under reduced motion (flyTo never launches).
 */
export function flightTrail(ends: TrailEnds) {
  const frames = flightFrames(ends.start, ends.end, {
    endScale: ends.endScale,
  });
  const duration = FLIGHT.durationMs;
  const nodes: HTMLElement[] = [];
  for (let index = 0; index < FLIGHT_TRAIL.dashes; index++) {
    const delay = (index + 1) * FLIGHT_TRAIL.lagMs;
    const dash = document.createElement("span");
    dash.className = "plugin-trail";
    dash.setAttribute("aria-hidden", "true");
    dash.style.left = `${ends.start.x}px`;
    dash.style.top = `${ends.start.y}px`;
    dash.style.setProperty(
      "--trail-color",
      `var(${TRAIL_COLORS[index % TRAIL_COLORS.length]})`,
    );
    dash.style.setProperty("--trail-dash", `${FLIGHT_TRAIL.dashPx}px`);
    document.body.append(dash);
    nodes.push(dash);
    // The dash's head sits on the path and its tail points back along the tangent.
    dash.animate(
      frames.map((frame) => ({
        offset: frame.offset,
        transform: `translate3d(${frame.x.toFixed(1)}px, ${frame.y.toFixed(1)}px, 0) rotate(${frame.angle.toFixed(1)}deg)`,
      })),
      { duration, delay, easing: "linear", fill: "both" },
    );
    const peak = 1 - index / (FLIGHT_TRAIL.dashes + 1);
    dash.animate(
      [
        { opacity: 0 },
        { opacity: peak, offset: 0.06 },
        { opacity: 0, offset: FLIGHT_TRAIL.fadeBy },
        { opacity: 0 },
      ],
      { duration, delay, fill: "both" },
    );
  }
  // Background tabs may never tick the animations: never leave a dash behind.
  window.setTimeout(
    () => nodes.forEach((node) => node.remove()),
    duration + FLIGHT_TRAIL.dashes * FLIGHT_TRAIL.lagMs + 50,
  );
}
