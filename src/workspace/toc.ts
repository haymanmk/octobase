/**
 * Whiteboard table of contents — pure derivation, no store or React.
 *
 * Named groups (frames) are the only headings: they claim their member
 * cards and use the group name as a stable, foldable headline. Remaining
 * cards fall back to spatial clusters ("islands") used purely for reading
 * order — their rows render flat, never under a headline (a neighbor card's
 * title is not a hierarchy). Inside either unit, a card ![[embedded]] in
 * another member's body indents under its host.
 */
import type { Card, Group, Placement } from "../lib/model/types.ts";
import { groupOf } from "../lib/model/groups.ts";

export interface TocEntry {
  card: Card;
  placement: Placement;
}

export interface TocRow {
  cardId: string;
  title: string;
  kind: Card["kind"];
  /** 0 = cluster member, 1 = embedded in the row above's host. */
  depth: 0 | 1;
}

export interface TocGroup {
  /** Group name for named frames; null for spatial islands and isolated cards. */
  label: string | null;
  /** Jump target when the group header is clicked. */
  anchorCardId: string;
  rows: TocRow[];
  /** Set when this heading is a named frame on the board. */
  groupId?: string;
  /** Mirrors the frame's collapsed state (frames only). */
  collapsed?: boolean;
}

/** Rects whose gap is under this (world px) belong to the same cluster. */
const CLUSTER_GAP = 120;
/** Rows whose tops differ less than this read as the same visual line. */
const ROW_BAND = 120;

/** Gap between two rects: 0 when they overlap, else the larger axis gap. */
function rectGap(a: Placement, b: Placement): number {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
  return Math.max(dx, dy);
}

/** Top-left → bottom-right, banding near-equal tops into one visual row. */
function readingOrder<T>(items: T[], top: (t: T) => number, left: (t: T) => number): T[] {
  const byTop = [...items].sort((a, b) => top(a) - top(b) || left(a) - left(b));
  const out: T[] = [];
  let row: T[] = [];
  let rowTop = Number.NEGATIVE_INFINITY;
  for (const it of byTop) {
    if (row.length > 0 && top(it) - rowTop > ROW_BAND) {
      out.push(...row.sort((a, b) => left(a) - left(b)));
      row = [];
    }
    if (row.length === 0) rowTop = top(it);
    row.push(it);
  }
  out.push(...row.sort((a, b) => left(a) - left(b)));
  return out;
}

/** Union-find clustering of entries by rect proximity. */
function clusterEntries(entries: TocEntry[]): TocEntry[][] {
  const parent = entries.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (rectGap(entries[i].placement, entries[j].placement) < CLUSTER_GAP) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, TocEntry[]>();
  entries.forEach((e, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), e]);
  });
  return [...groups.values()];
}

/** Largest note anchors the cluster; largest card of any kind as fallback. */
function anchorOf(cluster: TocEntry[]): TocEntry {
  const area = (e: TocEntry) => e.placement.w * e.placement.h;
  const notes = cluster.filter((e) => e.card.kind === "note");
  const pool = notes.length > 0 ? notes : cluster;
  return pool.reduce((best, e) => (area(e) > area(best) ? e : best));
}

/** Reading-ordered rows for one unit (frame or island): embeds indent. */
function rowsOf(cluster: TocEntry[], embeds: Map<string, string[]>): TocRow[] {
  const members = new Map(cluster.map((e) => [e.card.id, e]));
  const childIds = new Set<string>();
  for (const e of cluster) {
    for (const id of embeds.get(e.card.id) ?? []) {
      if (id !== e.card.id && members.has(id)) childIds.add(id);
    }
  }
  const tops = readingOrder(
    cluster.filter((e) => !childIds.has(e.card.id)),
    (e) => e.placement.y,
    (e) => e.placement.x,
  );
  const rows: TocRow[] = [];
  const emitted = new Set<string>();
  for (const e of tops) {
    rows.push({ cardId: e.card.id, title: e.card.title, kind: e.card.kind, depth: 0 });
    emitted.add(e.card.id);
    for (const id of embeds.get(e.card.id) ?? []) {
      const child = members.get(id);
      if (!child || emitted.has(id) || id === e.card.id) continue;
      rows.push({ cardId: id, title: child.card.title, kind: child.card.kind, depth: 1 });
      emitted.add(id);
    }
  }
  // Children whose host got consumed as someone else's child: keep them
  // reachable as plain rows rather than dropping them.
  for (const e of cluster) {
    if (!emitted.has(e.card.id)) {
      rows.push({ cardId: e.card.id, title: e.card.title, kind: e.card.kind, depth: 0 });
    }
  }
  return rows;
}

/**
 * Build the TOC. `embeds` maps a host card id to the card ids its body
 * ![[embeds]], in body order (the caller resolves titles against the store).
 * `groups` are the board's named frames; their members leave the spatial
 * clustering and sit under the frame's name instead.
 */
export function buildToc(
  entries: TocEntry[],
  embeds: Map<string, string[]>,
  groups: Group[] = [],
): TocGroup[] {
  const byGroup = new Map<string, TocEntry[]>();
  const ungrouped: TocEntry[] = [];
  for (const e of entries) {
    const g = groupOf(e.placement, groups);
    if (g) byGroup.set(g.id, [...(byGroup.get(g.id) ?? []), e]);
    else ungrouped.push(e);
  }

  type Unit = { top: number; left: number; toGroup: () => TocGroup };
  const units: Unit[] = [];

  for (const g of groups) {
    const members = byGroup.get(g.id);
    if (!members) continue; // empty frames stay out of the TOC
    units.push({
      top: g.y,
      left: g.x,
      toGroup: () => ({
        label: g.name || "Untitled",
        anchorCardId: anchorOf(members).card.id,
        rows: rowsOf(members, embeds),
        groupId: g.id,
        collapsed: g.collapsed,
      }),
    });
  }

  for (const cluster of clusterEntries(ungrouped)) {
    const anchor = anchorOf(cluster);
    units.push({
      top: Math.min(...cluster.map((e) => e.placement.y)),
      left: Math.min(...cluster.map((e) => e.placement.x)),
      toGroup: () => ({
        label: null, // islands order rows; only named frames make headlines
        anchorCardId: anchor.card.id,
        rows: rowsOf(cluster, embeds),
      }),
    });
  }

  return readingOrder(units, (u) => u.top, (u) => u.left).map((u) => u.toGroup());
}

/**
 * Filter by title (case-insensitive substring), preserving structure: a group
 * survives if any row matches; a matching child keeps its host row for
 * context.
 */
export function filterToc(groups: TocGroup[], query: string): TocGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  const matches = (r: TocRow) => r.title.toLowerCase().includes(q);
  return groups
    .map((g) => {
      if ((g.label ?? "").toLowerCase().includes(q)) return g; // whole island
      const keep: TocRow[] = [];
      for (let i = 0; i < g.rows.length; i++) {
        const row = g.rows[i];
        if (!matches(row)) continue;
        // A matching child keeps its host row above it for context.
        if (row.depth === 1) {
          for (let j = i - 1; j >= 0; j--) {
            if (g.rows[j].depth === 0) {
              if (!keep.includes(g.rows[j])) keep.push(g.rows[j]);
              break;
            }
          }
        }
        keep.push(row);
      }
      return { ...g, rows: keep };
    })
    .filter((g) => g.rows.length > 0);
}
