// Path of the pill that flies from a ticked plugin row to the install box
// (components/motion/fly-to.ts, flight-trail.ts). Pure, so tests need no DOM.
// After coco-skills' lib/flight-path.ts.

export interface Point {
  x: number;
  y: number;
}

/** Timing and shape of one flight (fly-to.ts, flight-trail.ts). */
export const FLIGHT = {
  /** Whole flight (ms), eased in-out along a quadratic Bézier arc. */
  durationMs: 500,
  /** The pill fades during its last 80 ms, as its line lights up. */
  fadeMs: 80,
  /** Lift off the check box: scale 1 → 1.05 over the first 12% of the flight. */
  liftScale: 1.05,
  liftAt: 0.12,
  /** The pill shrinks to its target line's height, never below this scale. */
  endScale: 0.6,
  /** Tilt following the path's tangent, at most this many degrees. */
  maxTiltDeg: 6,
  /** Flash on the line it lands on (ms). */
  arriveMs: 420,
  /** Ticking several at once ("select all"): only the first few fly, this far apart (ms). */
  maxBulk: 3,
  bulkGapMs: 60,
} as const;

/** The trail of short dashes behind the pill (flight-trail.ts). */
export const FLIGHT_TRAIL = {
  dashes: 10,
  lagMs: 9,
  /** Dash length (px); neighbours overlap into one thin line. */
  dashPx: 20,
  /** Each dash has faded by this share of the flight, so the trail ends before the pill lands. */
  fadeBy: 0.75,
} as const;

export interface ArcOptions {
  /** Height of the arc above the higher end, as a share of the distance (clamped to `minLift`…`maxLift` px). */
  liftRatio?: number;
  minLift?: number;
  maxLift?: number;
}

/** Control point of the quadratic Bézier: above the higher end, halfway across, so the pill rises and drops in. */
export function arcControl(
  start: Point,
  end: Point,
  { liftRatio = 0.3, minLift = 40, maxLift = 160 }: ArcOptions = {},
): Point {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const lift = Math.min(maxLift, Math.max(minLift, distance * liftRatio));
  return { x: (start.x + end.x) / 2, y: Math.min(start.y, end.y) - lift };
}

/** Point on the quadratic Bézier at `u` (0…1). */
export function arcPoint(
  start: Point,
  control: Point,
  end: Point,
  u: number,
): Point {
  const a = (1 - u) * (1 - u);
  const b = 2 * (1 - u) * u;
  const c = u * u;
  return {
    x: a * start.x + b * control.x + c * end.x,
    y: a * start.y + b * control.y + c * end.y,
  };
}

/** Direction of travel at `u`, in degrees (0 = right, positive = down, as CSS `rotate`). */
export function arcTangentDeg(
  start: Point,
  control: Point,
  end: Point,
  u: number,
): number {
  const dx = 2 * (1 - u) * (control.x - start.x) + 2 * u * (end.x - control.x);
  const dy = 2 * (1 - u) * (control.y - start.y) + 2 * u * (end.y - control.y);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** Cubic ease-in-out: progress along the path for a share of the time. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export interface FlightFrame {
  offset: number;
  /** Offset from the start point (px). */
  x: number;
  y: number;
  /** Pill tilt: the tangent's turn away from the straight line, scaled and clamped to ±`maxTilt`. */
  tilt: number;
  /** Full tangent angle, unwrapped between frames (the trail's dashes lie along it). */
  angle: number;
  scale: number;
}

export interface FlightFrameOptions extends ArcOptions {
  samples?: number;
  /** Lift: scale 1 → `liftScale` by `liftAt`, then to `endScale` on landing. */
  liftScale?: number;
  liftAt?: number;
  endScale?: number;
  maxTilt?: number;
}

/**
 * Keyframes for one flight along the arc, evenly spaced in time with the
 * position eased in-out (WAAPI then runs them `linear`). The first frame is
 * the start and the last exactly the end.
 */
export function flightFrames(
  start: Point,
  end: Point,
  {
    samples = 24,
    liftScale = FLIGHT.liftScale,
    liftAt = FLIGHT.liftAt,
    endScale = 1,
    maxTilt = FLIGHT.maxTiltDeg,
    ...arc
  }: FlightFrameOptions = {},
): FlightFrame[] {
  const control = arcControl(start, end, arc);
  const chord = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
  const frames: FlightFrame[] = [];
  let previousAngle: number | null = null;
  // Even steps plus the lift peak itself, so the pill reaches exactly `liftScale`.
  const offsets = [
    ...new Set([
      ...Array.from({ length: samples + 1 }, (_, index) => index / samples),
      liftAt,
    ]),
  ].sort((a, b) => a - b);
  for (const offset of offsets) {
    const u = easeInOutCubic(offset);
    const point = arcPoint(start, control, end, u);
    // Unwrapped against the previous frame, so a leftward flight never spins through ±180°.
    let angle = arcTangentDeg(start, control, end, u);
    if (previousAngle !== null)
      angle =
        previousAngle +
        ((((angle - previousAngle + 540) % 360) + 360) % 360) -
        180;
    previousAngle = angle;
    const turn = ((((angle - chord + 540) % 360) + 360) % 360) - 180;
    const tilt = Math.max(-maxTilt, Math.min(maxTilt, turn * 0.15));
    const scale =
      offset <= liftAt
        ? 1 + (liftScale - 1) * (offset / liftAt)
        : liftScale +
          (endScale - liftScale) * ((offset - liftAt) / (1 - liftAt));
    frames.push({
      offset,
      x: point.x - start.x,
      y: point.y - start.y,
      tilt,
      angle,
      scale,
    });
  }
  return frames;
}

/** Delays (ms) for ticking several at once: the first `FLIGHT.maxBulk` fly `bulkGapMs` apart; the rest don't fly. */
export function bulkFlightDelays(count: number): number[] {
  const flying = Math.max(0, Math.min(Math.floor(count), FLIGHT.maxBulk));
  return Array.from({ length: flying }, (_, index) => index * FLIGHT.bulkGapMs);
}

/** The pill's scale on landing: the target line's height (capped at 28px) over the pill's, within `FLIGHT.endScale`…1. */
export function landingScale(targetHeight: number, pillHeight: number): number {
  return Math.min(
    1,
    Math.max(
      FLIGHT.endScale,
      Math.min(targetHeight, 28) / Math.max(1, pillHeight),
    ),
  );
}
