import { describe, expect, it, vi } from "vitest";
import {
  createFrameCoalescer,
  createHighlightMotion,
  createMeasureCache,
  type FrameScheduler,
  highlightFrame,
  highlightMove,
} from "./row-highlight";

/** A hand-driven requestAnimationFrame: `flush` runs the frame. */
function fakeFrames() {
  const queue = new Map<number, () => void>();
  let next = 1;
  const scheduler: FrameScheduler = {
    request: (callback) => {
      queue.set(next, callback);
      return next++;
    },
    cancel: (id) => queue.delete(id),
  };
  const flush = () => {
    const callbacks = [...queue.values()];
    queue.clear();
    for (const callback of callbacks) callback();
  };
  return { scheduler, flush, pending: () => queue.size };
}

function fakeDriver() {
  const stop = vi.fn();
  const driver = {
    jump: vi.fn(),
    glide: vi.fn(() => ({ stop })),
    isAnimating: vi.fn(() => false),
  };
  return { driver, stop };
}

describe("highlightFrame", () => {
  it("sits inside its row, centred, inset on both edges", () => {
    expect(highlightFrame({ top: 96, height: 48 }, 3)).toEqual({
      top: 99,
      height: 42,
    });
  });

  it("never goes negative for a row thinner than the insets", () => {
    expect(highlightFrame({ top: 0, height: 4 }, 3)).toEqual({
      top: 2,
      height: 0,
    });
  });
});

describe("highlightMove", () => {
  it("glides between rows only while shown", () => {
    expect(highlightMove("a", "b", true, false)).toBe("glide");
  });

  it("appears in place instead of sliding in from a stale row", () => {
    expect(highlightMove("a", "b", false, false)).toBe("jump");
    expect(highlightMove(null, "b", false, false)).toBe("jump");
  });

  it("jumps under reduced motion", () => {
    expect(highlightMove("a", "b", true, true)).toBe("jump");
  });

  it("does nothing for the row it is already on", () => {
    expect(highlightMove("a", "a", true, false)).toBe("none");
  });
});

describe("createFrameCoalescer", () => {
  it("measures once per frame however many pointermoves arrive, using the last", () => {
    const frames = fakeFrames();
    const measure = vi.fn((row: string) => ({ top: row.length, height: 10 }));
    const rows = createMeasureCache(measure);
    const handled: string[] = [];
    const moves = createFrameCoalescer((event: { row: string }) => {
      rows.get(event.row);
      handled.push(event.row);
    }, frames.scheduler);

    moves.push({ row: "a" });
    moves.push({ row: "bb" });
    moves.push({ row: "ccc" });
    expect(frames.pending()).toBe(1);
    expect(measure).not.toHaveBeenCalled();

    frames.flush();
    expect(handled).toEqual(["ccc"]);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(measure).toHaveBeenCalledWith("ccc");
  });

  it("drops a pending frame on cancel (pointer left the list)", () => {
    const frames = fakeFrames();
    const handler = vi.fn();
    const moves = createFrameCoalescer(handler, frames.scheduler);
    moves.push(1);
    moves.cancel();
    frames.flush();
    expect(handler).not.toHaveBeenCalled();
    moves.push(2);
    frames.flush();
    expect(handler).toHaveBeenCalledExactlyOnceWith(2);
  });
});

describe("createMeasureCache", () => {
  it("reuses a row's frame until invalidated", () => {
    const measure = vi.fn(() => ({ top: 0, height: 10 }));
    const rows = createMeasureCache(measure);
    rows.get("a");
    rows.get("a");
    expect(measure).toHaveBeenCalledTimes(1);
    rows.invalidate();
    rows.get("a");
    expect(measure).toHaveBeenCalledTimes(2);
  });
});

describe("createHighlightMotion", () => {
  it("stops a running glide and jumps to its row when reduced motion turns on", () => {
    const { driver, stop } = fakeDriver();
    const motion = createHighlightMotion(driver);
    motion.go(120, "glide");
    expect(driver.glide).toHaveBeenCalledWith(120);

    motion.setReduce(true);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(driver.jump).toHaveBeenLastCalledWith(120);

    motion.go(240, "glide");
    expect(driver.glide).toHaveBeenCalledTimes(1);
    expect(driver.jump).toHaveBeenLastCalledWith(240);
  });

  it("does nothing on the switch when no glide runs", () => {
    const { driver } = fakeDriver();
    const motion = createHighlightMotion(driver);
    motion.go(60, "jump");
    driver.jump.mockClear();
    motion.setReduce(true);
    expect(driver.jump).not.toHaveBeenCalled();
  });

  it("glides again once reduced motion turns off", () => {
    const { driver } = fakeDriver();
    const motion = createHighlightMotion(driver, true);
    motion.go(60, "glide");
    expect(driver.jump).toHaveBeenCalledWith(60);
    motion.setReduce(false);
    motion.go(90, "glide");
    expect(driver.glide).toHaveBeenCalledWith(90);
  });
});
