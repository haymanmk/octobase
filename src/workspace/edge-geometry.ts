/**
 * Pure geometry for whiteboard edges: which card sides an edge should attach
 * to and the cubic bezier that joins them. Framework-free so it can be
 * unit-tested under node:test.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = "top" | "right" | "bottom" | "left";

export interface Anchor {
  x: number;
  y: number;
  side: Side;
}

export interface Point {
  x: number;
  y: number;
}

const SIDES: Side[] = ["top", "right", "bottom", "left"];

export function sideMidpoint(r: Rect, side: Side): Point {
  switch (side) {
    case "top":
      return { x: r.x + r.w / 2, y: r.y };
    case "right":
      return { x: r.x + r.w, y: r.y + r.h / 2 };
    case "bottom":
      return { x: r.x + r.w / 2, y: r.y + r.h };
    case "left":
      return { x: r.x, y: r.y + r.h / 2 };
  }
}

/** Outward unit direction of a side, for bezier control points. */
function outward(side: Side): Point {
  switch (side) {
    case "top":
      return { x: 0, y: -1 };
    case "right":
      return { x: 1, y: 0 };
    case "bottom":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
  }
}

/**
 * The pair of side midpoints (one per rect) with the shortest distance —
 * edges re-route to whichever sides face each other as cards move.
 */
export function nearestAnchors(a: Rect, b: Rect): { from: Anchor; to: Anchor } {
  let best: { from: Anchor; to: Anchor; d2: number } | null = null;
  for (const sa of SIDES) {
    const pa = sideMidpoint(a, sa);
    for (const sb of SIDES) {
      const pb = sideMidpoint(b, sb);
      const d2 = (pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2;
      if (!best || d2 < best.d2) {
        best = { from: { ...pa, side: sa }, to: { ...pb, side: sb }, d2 };
      }
    }
  }
  return { from: best!.from, to: best!.to };
}

function controls(from: Anchor, to: Point, toSide?: Side) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const k = Math.min(160, Math.max(30, dist * 0.4));
  const of = outward(from.side);
  const c1 = { x: from.x + of.x * k, y: from.y + of.y * k };
  const ot = toSide ? outward(toSide) : { x: 0, y: 0 };
  const c2 = { x: to.x + ot.x * k, y: to.y + ot.y * k };
  return { c1, c2 };
}

function cubic(from: Point, c1: Point, c2: Point, to: Point): string {
  return `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;
}

/** Point on the cubic at t=0.5 — where the label pill sits. */
function bezierMid(from: Point, c1: Point, c2: Point, to: Point): Point {
  return {
    x: (from.x + 3 * c1.x + 3 * c2.x + to.x) / 8,
    y: (from.y + 3 * c1.y + 3 * c2.y + to.y) / 8,
  };
}

export interface EdgeGeometry {
  d: string;
  mid: Point;
  from: Anchor;
  to: Anchor;
}

/** Full edge geometry between two placed cards. */
export function edgePath(a: Rect, b: Rect): EdgeGeometry {
  const { from, to } = nearestAnchors(a, b);
  const { c1, c2 } = controls(from, to, to.side);
  return { d: cubic(from, c1, c2, to), mid: bezierMid(from, c1, c2, to), from, to };
}

/** Dashed preview while dragging from a handle to the cursor. */
export function previewPath(from: Anchor, to: Point): string {
  const { c1, c2 } = controls(from, to);
  return cubic(from, c1, c2, to);
}
