// Sliding row highlight (components/motion/row-highlight.tsx). Pure, so tests need no DOM.
// After coco-skills' lib/row-highlight.ts.

/** Gap between the highlight and its row's edges (px), so the beam runs round a pill inside the row. */
export const ROW_HIGHLIGHT_INSET_PX = 3;

/**
 * The glide between rows: critically damped (no overshoot, text never
 * wobbles), settling in about 0.22 s. Motion `animate()` transition.
 */
export const ROW_HIGHLIGHT_SPRING = {
  type: "spring",
  bounce: 0,
  visualDuration: 0.22,
} as const;

export interface RowBox {
  top: number;
  height: number;
}

/** The highlight's translateY and height for a row (offsets inside the list wrapper). */
export function highlightFrame(
  row: RowBox,
  inset = ROW_HIGHLIGHT_INSET_PX,
): RowBox {
  const height = Math.max(0, row.height - inset * 2);
  return { top: row.top + (row.height - height) / 2, height };
}

/**
 * How the highlight reaches a row: it `glide`s from row to row while shown,
 * `jump`s when it appears (from hidden it never slides in from a stale row)
 * or under reduced motion, and does nothing for the row it is already on.
 */
export function highlightMove(
  from: unknown,
  to: unknown,
  shown: boolean,
  reduce: boolean,
): "glide" | "jump" | "none" {
  if (shown && from === to) return "none";
  if (!shown || reduce) return "jump";
  return "glide";
}

/** `requestAnimationFrame` / `cancelAnimationFrame`, injectable so tests drive frames by hand. */
export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(id: number): void;
}

/**
 * Runs `handler` at most once per frame with the latest pushed value
 * (pointermove fires several times a frame; only the last one matters).
 * `cancel` drops a pending frame and its value.
 */
export function createFrameCoalescer<T>(
  handler: (latest: T) => void,
  scheduler: FrameScheduler,
) {
  let pending: { value: T } | null = null;
  let id = 0;
  return {
    push(value: T) {
      pending = { value };
      if (id) return;
      id = scheduler.request(() => {
        id = 0;
        const latest = pending;
        pending = null;
        if (latest) handler(latest.value);
      });
    },
    cancel() {
      if (id) scheduler.cancel(id);
      id = 0;
      pending = null;
    },
  };
}

/** Memoises `measure` per key until `invalidate` (resize, scroll, list change). */
export function createMeasureCache<K, V>(measure: (key: K) => V) {
  const cache = new Map<K, V>();
  return {
    get(key: K): V {
      if (cache.has(key)) return cache.get(key) as V;
      const value = measure(key);
      cache.set(key, value);
      return value;
    },
    invalidate() {
      cache.clear();
    },
  };
}

/** Moves the layer's translateY: `jump` sets it, `glide` starts an animation it can stop. */
export interface HighlightDriver {
  jump(top: number): void;
  glide(top: number): { stop(): void };
  isAnimating(): boolean;
}

/**
 * The layer's vertical motion. `go` takes a `highlightMove` result and the
 * row's top; under reduced motion every move jumps. `setReduce(true)` while a
 * glide runs stops it and jumps straight to its target, so turning reduced
 * motion on mid-glide never leaves the layer sliding or stuck halfway.
 */
export function createHighlightMotion(driver: HighlightDriver, reduce = false) {
  let running: { stop(): void } | null = null;
  let target: number | null = null;
  const stop = () => {
    running?.stop();
    running = null;
  };
  return {
    get reduce() {
      return reduce;
    },
    go(top: number, move: "glide" | "jump" | "none") {
      const changed = top !== target;
      target = top;
      if (move === "none") {
        // Same row, but it may have moved or resized (re-flow, breakpoint): re-aim a running glide, else snap.
        if (!changed) return;
        const gliding = driver.isAnimating();
        stop();
        if (gliding && !reduce) running = driver.glide(top);
        else driver.jump(top);
        return;
      }
      stop();
      if (move === "jump" || reduce) driver.jump(top);
      else running = driver.glide(top);
    },
    setReduce(next: boolean) {
      reduce = next;
      if (!next || !running) return;
      stop();
      if (target !== null) driver.jump(target);
    },
    stop,
  };
}
