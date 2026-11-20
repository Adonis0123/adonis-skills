"use client";

import { useEffect } from "react";

const SURFACE = ".fx-surface";
const HOST = ".fx-host";

/** The surface the pointer is over: the element itself, or the one inside a hovered `.fx-host` (a card lifted off its host). */
function surfaceAt(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return (
    target.closest<HTMLElement>(SURFACE) ??
    target
      .closest<HTMLElement>(HOST)
      ?.querySelector<HTMLElement>(`:scope > ${SURFACE}`) ??
    null
  );
}

/**
 * The surface to mark for a focus that came from the keyboard, or null. A
 * copy box (`.fx-copy`) shows it only for its copy button (`[data-copy-target]`),
 * not for a scroll region or tab inside it.
 */
function keyboardFocusSurface(target: Element): HTMLElement | null {
  const surface = target.closest<HTMLElement>(SURFACE);
  if (!surface || !target.matches(":focus-visible")) return null;
  if (surface.matches(".fx-copy") && !target.matches("[data-copy-target]"))
    return null;
  return surface;
}

/**
 * One delegated listener pair for the whole site (styles/effects-hover.css):
 * - pointer: the hovered `.fx-surface` gets the pointer position relative to
 *   itself (`--mx` / `--my`) for its dot field. Read the rect, then write,
 *   once per animation frame; CSS does the smoothing. Off for touch, coarse
 *   pointers and reduced motion (the dots then sit at the centre).
 * - keyboard: `data-kbd-focus` on a surface while a focus-visible element in
 *   it has focus, the beam's keyboard twin of `:hover` (`:focus-within`
 *   would keep a mouse-clicked box looping).
 */
export function PointerEffects() {
  useEffect(() => {
    let marked: HTMLElement | null = null;
    const unmark = () => {
      marked?.removeAttribute("data-kbd-focus");
      marked = null;
    };
    const onFocusIn = (event: FocusEvent) => {
      unmark();
      marked =
        event.target instanceof Element
          ? keyboardFocusSurface(event.target)
          : null;
      marked?.setAttribute("data-kbd-focus", "");
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", unmark);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", unmark);
      unmark();
    };
  }, []);

  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let pending: PointerEvent | null = null;
    let raf = 0;

    const apply = () => {
      raf = 0;
      const event = pending;
      pending = null;
      const surface = event && surfaceAt(event.target);
      if (!event || !surface) return;
      const rect = surface.getBoundingClientRect();
      surface.style.setProperty(
        "--mx",
        `${Math.round(event.clientX - rect.left)}px`,
      );
      surface.style.setProperty(
        "--my",
        `${Math.round(event.clientY - rect.top)}px`,
      );
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !fine.matches || reduce.matches)
        return;
      pending = event;
      if (!raf) raf = requestAnimationFrame(apply);
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("pointermove", onMove);
    };
  }, []);

  return null;
}
