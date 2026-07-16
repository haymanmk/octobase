/**
 * Whiteboard table of contents — pure derivation, no store or React.
 *
 * Hierarchy (design option A): cards whose rectangles sit near each other
 * form spatial clusters ("islands"), ordered in reading order and labeled by
 * their anchor card (largest note, falling back to the largest card). Inside
 * a cluster, a card ![[embedded]] in another member's body indents under its
 * host. Isolated cards render as bare label-less single-row groups, so a
 * board with no clusters degrades to the flat spatial list.
 */
import type { Card, Placement } from "../lib/model/types.ts";

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
  /** Anchor card's title for real clusters; null for isolated cards. */
  label: string | null;
  /** Jump target when the group header is clicked. */
  anchorCardId: string;
  rows: TocRow[];
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

/**
 * Build the TOC. `embeds` maps a host card id to the card ids its body
 * ![[embeds]], in body order (the caller resolves titles against the store).
 */
export function buildToc(entries: TocEntry[], embeds: Map<string, string[]>): TocGroup[] {
  const clusters = clusterEntries(entries);
  const bounds = clusters.map((c) => ({
    cluster: c,
    top: Math.min(...c.map((e) => e.placement.y)),
    left: Math.min(...c.map((e) => e.placement.x)),
  }));
  const ordered = readingOrder(bounds, (b) => b.top, (b) => b.left);

  return ordered.map(({ cluster }) => {
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
    const anchor = anchorOf(cluster);
    return {
      label: cluster.length > 1 ? anchor.card.title || "Untitled" : null,
      anchorCardId: anchor.card.id,
      rows,
    };
  });
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
