import { animate } from "motion";
import { durations, easings } from "@/components/motion/tokens";

/**
 * Smooth window scrolling for same-page anchors.
 *
 * - Animates window scroll with motion's `animate` on a soft ease-out curve;
 *   duration grows with the square root of the distance and is capped at
 *   `durations.scrollMax` (0.9s).
 * - Each frame calls `window.scrollTo({ behavior: "instant" })`, so a global
 *   CSS `scroll-behavior: smooth` can never double-animate.
 * - Sticky header offset, in priority order:
 *   1. `options.offset` (px)
 *   2. CSS var `--header-height` on <html> (px or rem), plus `HEADER_GAP`
 *   3. Measured height of `[data-site-header]`, else `header.sticky`, plus `HEADER_GAP`
 *   4. Computed `scroll-padding-top` of <html> (custom.css sets 5.5rem today)
 *   Without `options.offset`, a larger `scroll-margin-top` on the target
 *   (e.g. Tailwind `scroll-mt-24`) wins, so authored anchor spacing is kept.
 * - Wheel, touch, pointer-down or key-down by the user cancels the animation.
 * - `prefers-reduced-motion: reduce` jumps instantly.
 * - Focuses the target as the scroll starts (preventScroll, like a native
 *   anchor moving the focus start point) and writes the hash with
 *   history.pushState / replaceState, so the page never jumps.
 */

export const HEADER_GAP = 12;
export const HEADER_SELECTORS = [
  "[data-site-header]",
  "header.sticky",
] as const;
const CANCEL_EVENTS = [
  "wheel",
  "touchstart",
  "pointerdown",
  "keydown",
] as const;

export interface ScrollAnimationControls {
  stop: () => void;
}

export type ScrollAnimateFn = (
  from: number,
  to: number,
  options: {
    duration: number;
    ease: readonly [number, number, number, number];
    onUpdate: (latest: number) => void;
    onComplete: () => void;
  },
) => ScrollAnimationControls;

/** Everything the scroller touches outside itself; tests pass a fake. */
export interface ScrollEnv {
  getScrollY: () => number;
  getMaxScrollY: () => number;
  scrollTo: (y: number) => void;
  prefersReducedMotion: () => boolean;
  /** Registers cancel listeners and returns their cleanup. */
  onUserInterrupt: (cancel: () => void) => () => void;
  animate: ScrollAnimateFn;
}

export interface ScrollToYOptions {
  /** Force the instant path (also used for reduced motion). */
  instant?: boolean;
}

export type HistoryMode = "push" | "replace" | false;

export interface ScrollToElementOptions extends ScrollToYOptions {
  /** Pixels to keep above the target. Defaults to the sticky header offset. */
  offset?: number;
  /** Move focus to the target after scrolling. Default true. */
  focus?: boolean;
  /** How to record the hash. Default "push" (same as a native anchor click). */
  history?: HistoryMode;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Window Y that puts `elementTop` (viewport-relative) `offset` px below the top. */
export function computeTargetY({
  elementTop,
  scrollY,
  offset,
  maxScrollY,
}: {
  elementTop: number;
  scrollY: number;
  offset: number;
  maxScrollY: number;
}) {
  return Math.round(
    clamp(scrollY + elementTop - offset, 0, Math.max(0, maxScrollY)),
  );
}

/**
 * Seconds for a scroll of `distance` px: 0 for no movement, otherwise
 * `min + 0.011 * sqrt(distance)` clamped to [min, max].
 * ~100px -> 0.39s, ~1000px -> 0.63s, >= ~3200px -> 0.9s.
 */
export function computeScrollDuration(
  distance: number,
  min: number = durations.scrollMin,
  max: number = durations.scrollMax,
) {
  const abs = Math.abs(distance);
  if (abs < 1) return 0;
  return clamp(min + 0.011 * Math.sqrt(abs), min, max);
}

/** Parses "64px", "4rem", "64" into px. Returns null for empty / unknown values. */
export function parseCssLength(
  value: string | null | undefined,
  rootFontSize = 16,
) {
  const raw = value?.trim();
  if (!raw) return null;
  const match = /^(-?\d*\.?\d+)(px|rem)?$/.exec(raw);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]);
  return match[2] === "rem" ? amount * rootFontSize : amount;
}

/** Sticky header offset, following the priority documented at the top of this file. */
export function resolveHeaderOffset(doc: Document = document) {
  const root = doc.documentElement;
  const view = doc.defaultView;
  if (!view) return 0;
  const rootStyle = view.getComputedStyle(root);
  const rootFontSize = Number.parseFloat(rootStyle.fontSize) || 16;

  const fromVar = parseCssLength(
    rootStyle.getPropertyValue("--header-height"),
    rootFontSize,
  );
  if (fromVar !== null) return fromVar + HEADER_GAP;

  for (const selector of HEADER_SELECTORS) {
    const header = doc.querySelector(selector);
    if (header) return header.getBoundingClientRect().height + HEADER_GAP;
  }

  return parseCssLength(rootStyle.scrollPaddingTop, rootFontSize) ?? 0;
}

/** Offset for one target: the header offset, or the target's own scroll-margin-top if larger. */
export function resolveTargetOffset(
  headerOffset: number,
  scrollMarginTop: number,
) {
  return Math.max(
    headerOffset,
    Number.isFinite(scrollMarginTop) ? scrollMarginTop : 0,
  );
}

export function createBrowserScrollEnv(win: Window = window): ScrollEnv {
  return {
    getScrollY: () => win.scrollY,
    getMaxScrollY: () =>
      win.document.documentElement.scrollHeight - win.innerHeight,
    scrollTo: (y) =>
      win.scrollTo({ top: y, left: win.scrollX, behavior: "instant" }),
    prefersReducedMotion: () =>
      win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    onUserInterrupt: (cancel) => {
      const opts: AddEventListenerOptions = { passive: true, capture: true };
      for (const type of CANCEL_EVENTS)
        win.addEventListener(type, cancel, opts);
      return () => {
        for (const type of CANCEL_EVENTS)
          win.removeEventListener(type, cancel, opts);
      };
    },
    animate: (from, to, options) => animate(from, to, options),
  };
}

/**
 * Builds a scroller bound to one environment. Only one scroll runs at a time:
 * a new call stops the previous one (its promise resolves `false`).
 */
export function createSmoothScroller(getEnv: () => ScrollEnv) {
  let active: { stop: () => void } | null = null;

  function cancelActive() {
    active?.stop();
    active = null;
  }

  /** Resolves true when the scroll reached its target, false if interrupted. */
  function scrollToY(
    targetY: number,
    options: ScrollToYOptions = {},
  ): Promise<boolean> {
    cancelActive();
    const env = getEnv();
    const to = clamp(Math.round(targetY), 0, Math.max(0, env.getMaxScrollY()));
    const from = env.getScrollY();
    const duration = computeScrollDuration(to - from);

    if (options.instant || env.prefersReducedMotion() || duration === 0) {
      env.scrollTo(to);
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let removeListeners = () => {};
      const finish = (completed: boolean) => {
        if (settled) return;
        settled = true;
        removeListeners();
        if (active === handle) active = null;
        resolve(completed);
      };

      const controls = env.animate(from, to, {
        duration,
        ease: easings.softOut,
        onUpdate: (latest) => env.scrollTo(latest),
        onComplete: () => finish(true),
      });

      const handle = {
        stop: () => {
          controls.stop();
          finish(false);
        },
      };
      active = handle;
      removeListeners = env.onUserInterrupt(() => handle.stop());
    });
  }

  return { scrollToY, cancel: cancelActive };
}

const defaultScroller = createSmoothScroller(() => createBrowserScrollEnv());

export const scrollToY = defaultScroller.scrollToY;
export const cancelSmoothScroll = defaultScroller.cancel;

/** Focuses `el` without scrolling; non-focusable targets get a temporary tabindex="-1". */
export function focusWithoutScroll(el: HTMLElement) {
  if (!el.hasAttribute("tabindex") && el.tabIndex < 0) {
    el.setAttribute("tabindex", "-1");
    // custom.css hides the outline on these non-interactive scroll targets.
    el.setAttribute("data-scroll-target", "");
    el.addEventListener(
      "blur",
      () => {
        el.removeAttribute("tabindex");
        el.removeAttribute("data-scroll-target");
      },
      { once: true },
    );
  }
  el.focus({ preventScroll: true });
}

export function writeHash(hash: string, mode: HistoryMode) {
  if (!mode) return;
  const url = new URL(window.location.href);
  url.hash = hash;
  if (url.href === window.location.href) return;
  if (mode === "push") {
    window.history.pushState(null, "", url.href);
  } else {
    // Keep Next.js router state on the current entry.
    window.history.replaceState(window.history.state, "", url.href);
  }
}

/** Finds the element a hash points at ("#skills", "skills", "#%E4%B8%AD"). "#" / "#top" -> null. */
export function findHashTarget(hash: string, doc: Document = document) {
  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!id || id === "top") return null;
  let decoded = id;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    // Malformed escape: fall back to the raw id.
  }
  return doc.getElementById(decoded) ?? doc.getElementById(id);
}

export async function scrollToElement(
  el: HTMLElement,
  {
    offset,
    focus = true,
    history = "push",
    instant,
  }: ScrollToElementOptions = {},
) {
  const resolvedOffset =
    offset ??
    resolveTargetOffset(
      resolveHeaderOffset(),
      Number.parseFloat(window.getComputedStyle(el).scrollMarginTop),
    );
  const targetY = computeTargetY({
    elementTop: el.getBoundingClientRect().top,
    scrollY: window.scrollY,
    offset: resolvedOffset,
    maxScrollY: document.documentElement.scrollHeight - window.innerHeight,
  });

  if (history && el.id) writeHash(`#${el.id}`, history);
  // Focus first: an interrupted scroll still leaves Tab continuing from the target.
  if (focus) focusWithoutScroll(el);
  return scrollToY(targetY, { instant });
}

/**
 * Scrolls to the element a hash points at. "#" and "#top" scroll to the top.
 * Returns false when nothing matched (caller should let the browser handle it).
 */
export async function scrollToHash(
  hash: string,
  options: ScrollToElementOptions = {},
) {
  const id = hash.replace(/^#/, "");
  if (id === "" || id === "top") {
    if (options.history) writeHash(id ? "#top" : "", options.history);
    return scrollToY(0, options);
  }
  const target = findHashTarget(hash);
  if (!target) return false;
  return scrollToElement(target, options);
}

/**
 * Returns the hash to smooth-scroll to when a click on `anchor` is a plain,
 * same-document hash navigation; otherwise null (let the browser / Next.js handle it).
 */
export function getSamePageHash(
  anchor: HTMLAnchorElement,
  event: Pick<
    MouseEvent,
    | "button"
    | "metaKey"
    | "ctrlKey"
    | "shiftKey"
    | "altKey"
    | "defaultPrevented"
  >,
  location: Pick<Location, "href">,
) {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return null;
  if (anchor.hasAttribute("download")) return null;
  if (anchor.hasAttribute("data-no-smooth-scroll")) return null;
  const target = anchor.getAttribute("target");
  if (target && target !== "_self") return null;

  const rawHref = anchor.getAttribute("href");
  if (!rawHref || !rawHref.includes("#")) return null;

  let url: URL;
  let current: URL;
  try {
    current = new URL(location.href);
    url = new URL(rawHref, current);
  } catch {
    return null;
  }
  if (url.origin !== current.origin) return null;
  if (url.pathname !== current.pathname || url.search !== current.search)
    return null;
  return url.hash || "#";
}
