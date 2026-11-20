"use client";

import { animate, motion, useMotionValue } from "motion/react";
import { type RefObject, useEffect, useRef } from "react";
import { HoverFx } from "@/components/motion/hover-fx";
import { usePrefersReducedMotion } from "@/components/motion/use-prefers-reduced-motion";
import { cx } from "@/components/ui/utils";
import {
  createFrameCoalescer,
  createHighlightMotion,
  createMeasureCache,
  highlightFrame,
  highlightMove,
  ROW_HIGHLIGHT_SPRING,
} from "@/lib/row-highlight";

export interface RowHighlightProps {
  /** The list whose direct children are the rows (a `ul`, or any element). */
  listRef: RefObject<HTMLElement | null>;
  className?: string;
}

/** Top of `el` inside `container`, from layout offsets (transforms, e.g. a re-flow animation, don't count). */
function offsetTopIn(el: HTMLElement, container: Element | null) {
  let top = 0;
  let node: HTMLElement | null = el;
  while (node && node !== container) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return top;
}

/**
 * One highlight behind a list's rows (after coco-skills' RowHighlight, itself
 * after Motion Primitives Animated Background, MIT,
 * https://motion-primitives.com/docs/animated-background; one layer moved by
 * a motion value, so React never re-renders on pointer moves).
 *
 * Put it in a positioned wrapper right before the list, both as siblings:
 *   <div className="relative"><RowHighlight listRef={ref} /><ul ref={ref}>…</ul></div>
 * The rows must be transparent; the list (positioned or not) paints after the
 * layer, so the row content sits over it.
 *
 * It glides (translateY, critically damped spring) to the row under the
 * pointer or the row whose link has keyboard focus, whichever input came
 * last; the rows never move and the layer has no hit area, so a pointer
 * resting on a row edge cannot flicker. While it shows, the shared hover
 * beam (`.fx-beam`, effects-hover.css) runs round it and its dot field opens
 * around the pointer (`.row-highlight`, effects-rows.css). Leaving the list
 * fades it out; it reappears in place. Scrolling under a still pointer
 * follows the row now under it. Pointer moves are handled once a frame (the
 * latest wins); row frames are measured once and re-measured after a resize,
 * scroll or list change (filtering). Fine pointers and keyboard focus only
 * (off on touch). Reduced motion (followed live): it jumps, no beam or dots;
 * switching it on mid-glide snaps the layer to its row.
 */
export function RowHighlight({ listRef, className }: RowHighlightProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0);
  const height = useMotionValue(0);
  // Follows the OS setting live (motion's useReducedMotion keeps its first value).
  const reduce = usePrefersReducedMotion();
  const motionRef = useRef<ReturnType<typeof createHighlightMotion> | null>(
    null,
  );

  // Reduced motion switched on mid-glide: stop it and jump to the row now.
  useEffect(() => {
    motionRef.current?.setReduce(reduce);
  }, [reduce]);

  useEffect(() => {
    const list = listRef.current;
    const layer = layerRef.current;
    if (!list || !layer) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const motionCtl = createHighlightMotion(
      {
        jump: (top) => y.jump(top),
        glide: (top) => animate(y, top, ROW_HIGHLIGHT_SPRING),
        isAnimating: () => y.isAnimating(),
      },
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    motionRef.current = motionCtl;
    let row: HTMLElement | null = null;
    /** Where the layer settles for `row`, so the dot field centres on the target, not the gliding layer. */
    let frame = { top: 0, height: 0 };
    let hovered = false;
    let focusRow: HTMLElement | null = null;
    let pointer: { x: number; y: number } | null = null;

    const rowOf = (target: EventTarget | null) => {
      let node = target instanceof Element ? target : null;
      while (node && node.parentElement !== list) node = node.parentElement;
      return node instanceof HTMLElement ? node : null;
    };
    // Row frames are read once, then reused until a resize, scroll or list change.
    // Skip the row's divider (a top or bottom border), so the pill sits evenly inside the row.
    const rows = createMeasureCache((next: HTMLElement) =>
      highlightFrame({
        top: offsetTopIn(next, layer.offsetParent) + next.clientTop,
        height: next.clientHeight,
      }),
    );
    const moveTo = (next: HTMLElement) => {
      const shown = layer.hasAttribute("data-on");
      const move = highlightMove(row, next, shown, motionCtl.reduce);
      row = next;
      layer.setAttribute("data-on", "");
      frame = rows.get(next);
      height.jump(frame.height);
      motionCtl.go(frame.top, move);
    };
    const hide = () => {
      layer.removeAttribute("data-on");
      layer.removeAttribute("data-pointer");
      row = null;
    };
    /** Dot-field centre from the pointer and where the layer settles (its untranslated origin, from its wrapper, so a running glide doesn't skew it). */
    const placeDots = (clientX: number, clientY: number) => {
      // Read once a frame (moves are coalesced); not cached, since a list above re-flowing moves this one.
      const parent = layer.offsetParent;
      const rect = parent?.getBoundingClientRect();
      const at = {
        left: (rect?.left ?? 0) + (parent?.clientLeft ?? 0) + layer.offsetLeft,
        top: (rect?.top ?? 0) + (parent?.clientTop ?? 0) + layer.offsetTop,
      };
      layer.style.setProperty("--mx", `${Math.round(clientX - at.left)}px`);
      layer.style.setProperty(
        "--my",
        `${Math.round(clientY - at.top - frame.top)}px`,
      );
    };
    const point = (
      clientX: number,
      clientY: number,
      target: EventTarget | null,
    ) => {
      const next = rowOf(target);
      if (!next) return;
      hovered = true;
      moveTo(next);
      layer.setAttribute("data-pointer", "");
      placeDots(clientX, clientY);
    };
    const onLeave = () => {
      pointerFrame.cancel();
      hovered = false;
      pointer = null;
      layer.removeAttribute("data-pointer");
      if (focusRow) moveTo(focusRow);
      else hide();
    };
    /** The row under a still pointer, after the rows moved under it (scroll, filter). */
    const pointAgain = () => {
      if (!hovered || !pointer) return;
      const under = document.elementFromPoint(pointer.x, pointer.y);
      if (!under || !list.contains(under)) onLeave();
      else if (rowOf(under)) point(pointer.x, pointer.y, under);
      // Over a gap between rows and the old row is gone: don't leave the layer on a stale spot.
      else if (!(row?.isConnected && row.parentElement === list)) hide();
    };
    // Pointer moves and scrolls are handled once a frame, from the latest one.
    // `target: undefined` (a scroll) looks up the row under the parked pointer.
    const pointerFrame = createFrameCoalescer(
      (event: { x: number; y: number; target?: EventTarget | null }) => {
        if (event.target === undefined) pointAgain();
        else point(event.x, event.y, event.target);
      },
      {
        request: (callback) => requestAnimationFrame(callback),
        cancel: (id) => cancelAnimationFrame(id),
      },
    );

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !fine.matches) return;
      pointer = { x: event.clientX, y: event.clientY };
      pointerFrame.push({ ...pointer, target: event.target });
    };
    // Wheel / trackpad scrolling moves rows under a still pointer without a pointermove.
    const onScroll = () => {
      rows.invalidate();
      if (!hovered || !pointer) return;
      pointerFrame.push({ ...pointer });
    };
    const onFocusIn = (event: FocusEvent) => {
      const next = rowOf(event.target);
      if (!next) return;
      if (!(event.target as Element).matches(":focus-visible")) {
        // A mouse click inside the list (a copy button) is not keyboard focus: forget the old focus row.
        focusRow = null;
        return;
      }
      // The latest input wins: Tab moves the highlight even with the mouse parked on the list.
      pointerFrame.cancel();
      focusRow = next;
      moveTo(next);
    };
    const onFocusOut = (event: FocusEvent) => {
      // Focus moving to another row: its focusin follows, so the highlight glides instead of blinking.
      if (rowOf(event.relatedTarget)) return;
      focusRow = null;
      if (!hovered) hide();
    };
    // A breakpoint change, re-flow or filter resizes or replaces the rows: re-measure and keep the highlight on its row.
    const remeasure = () => {
      rows.invalidate();
      if (!layer.hasAttribute("data-on")) return;
      if (row?.isConnected && row.parentElement === list) moveTo(row);
      else if (hovered && pointer) pointerFrame.push({ ...pointer });
      else hide();
    };
    const resize = new ResizeObserver(remeasure);
    resize.observe(list);
    // Filtering can swap rows without changing the list's size, which ResizeObserver would miss.
    const mutations = new MutationObserver(remeasure);
    mutations.observe(list, { childList: true });

    list.addEventListener("pointermove", onMove, { passive: true });
    list.addEventListener("pointerover", onMove, { passive: true });
    list.addEventListener("pointerleave", onLeave);
    list.addEventListener("focusin", onFocusIn);
    list.addEventListener("focusout", onFocusOut);
    window.addEventListener("scroll", onScroll, {
      passive: true,
      capture: true,
    });
    return () => {
      motionCtl.stop();
      if (motionRef.current === motionCtl) motionRef.current = null;
      pointerFrame.cancel();
      resize.disconnect();
      mutations.disconnect();
      list.removeEventListener("pointermove", onMove);
      list.removeEventListener("pointerover", onMove);
      list.removeEventListener("pointerleave", onLeave);
      list.removeEventListener("focusin", onFocusIn);
      list.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [listRef, y, height]);

  return (
    <motion.div
      ref={layerRef}
      aria-hidden
      className={cx("row-highlight", className)}
      style={{ y, height }}
    >
      <HoverFx />
    </motion.div>
  );
}
