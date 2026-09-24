import type { HighlightColor, TextAnchor } from "../lib/model/types.ts";

export interface SavedHighlight {
  id: string;
  color: HighlightColor;
  anchor: TextAnchor;
  exact: string;
  note?: string;
}

/** Called only after pending writes have reached the app. Omitted notes mean cleared. */
export function reconcileHighlights(local: SavedHighlight[], remote: SavedHighlight[], synced: Set<string>): SavedHighlight[] {
  const remoteById = new Map(remote.map((item) => [item.id, item]));
  const out = local.filter((item) => !remoteById.has(item.id) && !synced.has(item.id));
  return out.concat(remote.map((item) => ({ ...item, exact: item.exact ?? item.anchor.exact, note: item.note ?? "" })));
}
