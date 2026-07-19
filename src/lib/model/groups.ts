/**
 * Group membership and visibility — pure derivations, no store or React.
 *
 * Membership is never stored: a placement belongs to the group whose bounds
 * contain the placement's center, and when frames overlap the smallest one
 * wins. Collapsed groups hide their members (the placements stay put in the
 * data, so expanding restores the exact layout).
 */
import type { Group, Placement } from "./types.ts";

function containsCenter(g: Group, p: Placement): boolean {
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  return cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h;
}

/** The group a placement belongs to: smallest frame containing its center. */
export function groupOf(p: Placement, groups: Group[]): Group | null {
  let best: Group | null = null;
  for (const g of groups) {
    if (!containsCenter(g, p)) continue;
    if (!best || g.w * g.h < best.w * best.h) best = g;
  }
  return best;
}

/** Placements that belong to this group (membership rule above). */
export function membersOf(group: Group, placements: Placement[], all?: Group[]): Placement[] {
  const groups = all ?? [group];
  return placements.filter((p) => groupOf(p, groups)?.id === group.id);
}

/** Card ids hidden from the board because their group is collapsed. */
export function hiddenCardIds(groups: Group[], placements: Placement[]): Set<string> {
  const hidden = new Set<string>();
  for (const p of placements) {
    if (groupOf(p, groups)?.collapsed) hidden.add(p.cardId);
  }
  return hidden;
}

/** World-space size of a collapsed group's chip (must match .ws-group-chip). */
export const CHIP_W = 200;
export const CHIP_H = 26;

export interface EdgeRouting {
  /** Collapsed group whose chip stands in for this end; null = card visible. */
  fromChip: Group | null;
  toChip: Group | null;
  /** Both ends live inside the same collapsed group — don't draw at all. */
  hidden: boolean;
}

/**
 * Where an edge's endpoints land while groups are collapsed: a hidden card's
 * end redraws at its group's chip, so connections into a collapsed group
 * stay visible; only edges fully inside one collapsed group disappear.
 */
export function routeEdge(
  fromCardId: string,
  toCardId: string,
  groups: Group[],
  placements: Placement[],
): EdgeRouting {
  const chipFor = (cardId: string): Group | null => {
    const p = placements.find((pl) => pl.cardId === cardId);
    if (!p) return null;
    const g = groupOf(p, groups);
    return g?.collapsed ? g : null;
  };
  const fromChip = chipFor(fromCardId);
  const toChip = chipFor(toCardId);
  return {
    fromChip,
    toChip,
    hidden: !!fromChip && fromChip.id === toChip?.id,
  };
}
