import { describe, expect, it } from "vitest";
import {
  arcControl,
  arcPoint,
  bulkFlightDelays,
  easeInOutCubic,
  FLIGHT,
  flightFrames,
  landingScale,
} from "./flight-path";

const start = { x: 300, y: 500 };
const end = { x: 1000, y: 200 };

describe("flight path", () => {
  it("rises above the higher end and passes exactly through both ends", () => {
    const control = arcControl(start, end);
    expect(control.y).toBeLessThan(end.y);
    expect(arcPoint(start, control, end, 0)).toEqual(start);
    expect(arcPoint(start, control, end, 1)).toEqual(end);
  });

  it("starts on the check box and lands on the line (offsets from the start)", () => {
    const frames = flightFrames(start, end, { endScale: 0.8 });
    const first = frames[0];
    const last = frames.at(-1)!;
    expect([first.offset, first.x, first.y, first.scale]).toEqual([0, 0, 0, 1]);
    expect(last.offset).toBe(1);
    expect(last.x).toBeCloseTo(700, 9);
    expect(last.y).toBeCloseTo(-300, 9);
    expect(last.scale).toBeCloseTo(0.8, 9);
  });

  it("lifts to 1.05 first, never tilts past 6° and eases in-out", () => {
    const frames = flightFrames(start, end, { endScale: 0.8 });
    expect(Math.max(...frames.map((frame) => frame.scale))).toBe(1.05);
    expect(frames.every((frame) => Math.abs(frame.tilt) <= 6)).toBe(true);
    expect(frames.some((frame) => Math.abs(frame.tilt) > 1)).toBe(true);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(0.1)).toBeLessThan(0.1);
    expect(easeInOutCubic(0.9)).toBeGreaterThan(0.9);
  });

  it("turns smoothly on a leftward flight (no ±180° jump between frames)", () => {
    const frames = flightFrames({ x: 900, y: 300 }, { x: 200, y: 800 });
    for (let index = 1; index < frames.length; index++)
      expect(
        Math.abs(frames[index].angle - frames[index - 1].angle),
      ).toBeLessThan(60);
  });
});

describe("bulk flights and landing", () => {
  it("lets only the first few of a bulk add fly, a short gap apart", () => {
    expect(bulkFlightDelays(0)).toEqual([]);
    expect(bulkFlightDelays(2)).toEqual([0, FLIGHT.bulkGapMs]);
    expect(bulkFlightDelays(10)).toHaveLength(FLIGHT.maxBulk);
  });

  it("shrinks the pill to the line height, within its limits", () => {
    expect(landingScale(24, 24)).toBe(1);
    expect(landingScale(18, 24)).toBe(0.75);
    expect(landingScale(4, 24)).toBe(FLIGHT.endScale);
    expect(landingScale(100, 24)).toBe(1);
  });
});
