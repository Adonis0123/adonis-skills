/**
 * One fast lap of an `.fx-surface`'s border beam in solid `--mustard`
 * (`data-lap`, styles/effects-hover.css): copy success. A new call restarts
 * it. The attribute is cleared when the lap animation ends, so its length
 * lives only in CSS (`--fx-lap`). Reduced motion turns the lap into one fade.
 */
export function playBeamLap(surface: Element | null | undefined) {
  if (!(surface instanceof HTMLElement) || !surface.isConnected) return;
  surface.removeAttribute("data-lap");
  // Re-trigger the animation when a lap is already running.
  void surface.offsetWidth;
  surface.setAttribute("data-lap", "");
  const onEnd = (event: AnimationEvent) => {
    if (!event.animationName.startsWith("fx-lap")) return;
    surface.removeAttribute("data-lap");
    surface.removeEventListener("animationend", onEnd);
  };
  surface.addEventListener("animationend", onEnd);
}

/** Plays the lap on the `.fx-surface` around `node` (e.g. a card's copy button), if any. */
export function playBeamLapAround(node: Element | null | undefined) {
  playBeamLap(node?.closest(".fx-surface"));
}
