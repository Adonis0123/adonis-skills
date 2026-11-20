/**
 * Hover layers for an ink-outlined element (styles/effects-hover.css). Put
 * `<HoverFx />` first inside an element that has `fx-surface` and draws its
 * outline with the wavering-ink `::before` (`.skill-card`, `.ink-box`, …):
 *  - `.fx-dots`: a 14px dot grid behind the content, opened around the
 *    pointer (`--mx` / `--my`, written by PointerEffects);
 *  - `.fx-beam`: a comet that runs round the drawn ink line while the
 *    surface is hovered or keyboard-focused, and one `--mustard` lap on copy
 *    success (`playBeamLap`).
 * Both are `aria-hidden` and never take pointer events.
 */
export function HoverFx({ dots = true }: { dots?: boolean }) {
  return (
    <>
      {dots && <span aria-hidden className="fx-dots" />}
      <span aria-hidden className="fx-beam" />
    </>
  );
}
