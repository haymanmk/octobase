/**
 * Flatten a pdf.js outline (a nested bookmark tree) into an indented list the
 * outline panel renders. Kept pure and pdf.js-free for unit testing; the
 * caller resolves each item's destination to a page separately.
 */

export interface RawOutlineItem {
  title: string;
  items?: RawOutlineItem[];
  /** pdf.js destination — an explicit array or a named-destination string. */
  dest?: unknown;
}

export interface FlatOutlineItem {
  title: string;
  depth: number;
  dest: unknown;
}

export function flattenOutline(
  items: RawOutlineItem[] | null | undefined,
  depth = 0,
): FlatOutlineItem[] {
  if (!items) return [];
  const out: FlatOutlineItem[] = [];
  for (const it of items) {
    out.push({ title: it.title, depth, dest: it.dest ?? null });
    if (it.items?.length) out.push(...flattenOutline(it.items, depth + 1));
  }
  return out;
}
