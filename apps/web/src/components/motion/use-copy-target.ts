"use client";

import {
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  COPY_BOX_IGNORE,
  PRESS_SLOP_PX,
  shouldCopyOnClick,
} from "@/lib/copy-target";

/**
 * Makes a whole box the copy target: spread the returned props on the box
 * (which also carries `fx-copy`, styles/effects-hover.css). A click anywhere
 * copies, except on controls inside it (`COPY_BOX_IGNORE`), when text inside
 * the box is selected, or on the 2nd / 3rd click of a word / line selection.
 * A primary press dips the box (`data-pressed`); dragging more than
 * `PRESS_SLOP_PX` (a text selection) cancels the dip. Keyboard users copy
 * through the box's own button, which `COPY_BOX_IGNORE` leaves alone.
 */
export function useCopyTarget(onCopy: () => void) {
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  const release = useCallback((event: PointerEvent<HTMLElement>) => {
    pressStart.current = null;
    event.currentTarget.removeAttribute("data-pressed");
  }, []);

  return useMemo(
    () => ({
      onClick: (event: MouseEvent<HTMLElement>) => {
        const target = event.target as Element;
        if (event.defaultPrevented || target.closest(COPY_BOX_IGNORE)) return;
        if (
          !shouldCopyOnClick(
            window.getSelection(),
            event.currentTarget,
            event.detail,
          )
        )
          return;
        onCopy();
      },
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (
          event.button !== 0 ||
          (event.target as Element).closest(COPY_BOX_IGNORE)
        )
          return;
        pressStart.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setAttribute("data-pressed", "");
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        const start = pressStart.current;
        if (
          start &&
          Math.hypot(event.clientX - start.x, event.clientY - start.y) >
            PRESS_SLOP_PX
        )
          release(event);
      },
      onPointerUp: release,
      onPointerCancel: release,
      onPointerLeave: release,
    }),
    [onCopy, release],
  );
}
