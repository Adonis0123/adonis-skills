// Which plugins are ticked in the /plugins catalog (components/plugins-catalog.tsx).
// Pure, so tests need no DOM. After coco-skills' lib/plugin-install.ts selection helpers.

/** State of the tri-state "select all" box for the rows the filter shows. */
export type SelectAllState = "none" | "some" | "all";

/** Keeps `names` in catalog order and drops names the catalog does not have. */
function inCatalogOrder(
  names: Iterable<string>,
  catalog: readonly string[],
): string[] {
  const picked = new Set(names);
  return catalog.filter((name) => picked.has(name));
}

/** Ticks or unticks one plugin; the result stays in catalog order. */
export function togglePluginSelection(
  selected: readonly string[],
  name: string,
  catalog: readonly string[],
): string[] {
  const next = new Set(selected);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  return inCatalogOrder(next, catalog);
}

/** "all" when every visible row is ticked, "some" when part of them, "none" otherwise (also for an empty view). */
export function getSelectAllState(
  selected: readonly string[],
  visible: readonly string[],
): SelectAllState {
  if (visible.length === 0) return "none";
  const picked = new Set(selected);
  const count = visible.filter((name) => picked.has(name)).length;
  if (count === 0) return "none";
  return count === visible.length ? "all" : "some";
}

/**
 * Clicking "select all": when every visible row is ticked it unticks them,
 * otherwise it ticks the rest. Rows hidden by the filter keep their state.
 */
export function applySelectAll(
  selected: readonly string[],
  visible: readonly string[],
  catalog: readonly string[],
): string[] {
  if (getSelectAllState(selected, visible) === "all") {
    const hidden = new Set(visible);
    return inCatalogOrder(
      selected.filter((name) => !hidden.has(name)),
      catalog,
    );
  }
  return inCatalogOrder([...selected, ...visible], catalog);
}

/** Names in `next` that were not in `previous` (what a click just added, in catalog order). */
export function addedNames(
  previous: readonly string[],
  next: readonly string[],
): string[] {
  const before = new Set(previous);
  return next.filter((name) => !before.has(name));
}
