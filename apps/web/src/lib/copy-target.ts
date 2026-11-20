// Whole-box copy targets (components/motion/use-copy-target.ts). Pure, so tests need no DOM.

/** The parts of `Selection` the guard reads (a plain object in tests). */
export interface SelectionLike {
  isCollapsed: boolean;
  anchorNode: unknown;
  focusNode: unknown;
  toString: () => string;
}

export interface ContainerLike {
  contains: (node: never) => boolean;
}

/**
 * A click on a copy box copies unless the viewer has selected text in that
 * box: a drag-select ends with a click, and it must keep the selection
 * instead of overwriting the clipboard with the whole command. A selection
 * elsewhere on the page does not block the copy. The 2nd / 3rd click of a
 * double / triple click (`detail` > 1) selects a word / line and never
 * copies again; keyboard and programmatic clicks have `detail` 0. (The first
 * click of a double click has already copied: telling it apart would mean
 * holding every copy for the OS double-click interval.)
 */
export function shouldCopyOnClick(
  selection: SelectionLike | null | undefined,
  box: ContainerLike,
  detail = 1,
): boolean {
  if (detail > 1) return false;
  if (!selection || selection.isCollapsed || selection.toString().trim() === "")
    return true;
  const inside = (node: unknown) => node != null && box.contains(node as never);
  return !(inside(selection.anchorNode) || inside(selection.focusNode));
}

/**
 * What a click or press on a copy box ignores: tabs, links, form fields and
 * buttons inside it keep their own behaviour (the box's own copy button
 * copies through its own click), and `[data-copy-ignore]` marks anything else.
 */
export const COPY_BOX_IGNORE =
  '[role="tablist"], [data-copy-ignore], a, input, select, textarea, summary, button';

/** A press that moves farther than this (a text drag) drops the box's press dip. */
export const PRESS_SLOP_PX = 4;
