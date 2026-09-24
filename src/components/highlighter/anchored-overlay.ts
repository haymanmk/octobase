/**
 * Painting and interaction layer for text-anchored highlights on a live page.
 *
 * Highlights that arrive as text anchors (from the extension, a reader pane,
 * another device) have no element of their own on the page. This module
 * resolves them, draws each as marker bands — the same half-height stroke the
 * reader panes use, which can't be had from the CSS Custom Highlight API —
 * hit-tests a point or a selection back to a highlight, and docks a note
 * badge on the ones carrying one. Bands and badges live in one fixed layer
 * that follows scroll and resize.
 *
 * The pure parts (`hitPlacement`, `badgeAnchorPoint`, `bandRectsFor`) are
 * separated from the DOM work so they can be reasoned about — and tested —
 * on their own.
 */
import {
  locateAnchors,
  offsetFromPoint,
  rangesIntersect,
  type Placement,
} from "../../lib/anchor/highlight-dom.ts";
import type { HighlightColor, TextAnchor } from "../../lib/model/types.ts";
import { isLightTextColor, PALETTE } from "./colors.ts";
import { createNoteBadge, NOTE_BADGE_SIZE } from "./note-badge.ts";

export interface OverlayHighlight {
  id: string;
  color: HighlightColor;
  anchor: TextAnchor;
  /** The highlight's note, if it has one — an empty string means none. */
  note: string;
  /** The highlighted text, for drag payloads. */
  text: string;
}

export interface BandRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The highlight covering `offset`, or null. Where highlights overlap the
 * narrowest wins: a short highlight inside a long one is the more specific
 * thing to have pointed at.
 */
export function hitPlacement(placements: Placement[], offset: number): Placement | null {
  let best: Placement | null = null;
  for (const p of placements) {
    if (offset < p.start || offset >= p.end) continue;
    if (!best || p.end - p.start < best.end - best.start) best = p;
  }
  return best;
}

/** Dock the badge at the upper-left of the first non-empty text rect. */
export function badgeAnchorPoint(rects: DOMRect[] | ArrayLike<DOMRect>): { x: number; y: number } | null {
  const sized = Array.from(rects).filter((r) => r.width > 0 && r.height > 0);
  const first = sized[0];
  return first ? { x: first.left, y: first.top } : null;
}

/**
 * Marker bands for a highlight's line boxes: the middle half of each line,
 * matching the reader panes, so glyphs and inline-code chips stay legible
 * through the stroke.
 */
export function bandRectsFor(rects: DOMRect[] | ArrayLike<DOMRect>): BandRect[] {
  const bands: BandRect[] = [];
  for (const r of Array.from(rects)) {
    if (r.width < 1 || r.height < 1) continue;
    bands.push({ x: r.left, y: r.top + r.height * 0.25, w: r.width, h: r.height * 0.5 });
  }
  return bands;
}

const LAYER_ID = "octobase-highlight-overlay";

/** Light text means a dark page: use the deep fill and lighten instead. */
function onDarkPage(range: Range): boolean {
  const node = range.startContainer;
  const el = node instanceof Element ? node : node.parentElement;
  if (!el) return false;
  return isLightTextColor(getComputedStyle(el).color);
}

/**
 * Paints a set of anchored highlights as bands and keeps their note badges
 * in place. `extraBadgeRects` lets a host badge highlights it paints some
 * other way — the browser pane still paints its own with Rangy elements.
 */
export function createAnchoredOverlay(opts: {
  root: HTMLElement;
  /** Rects for noted highlights this overlay doesn't paint itself. */
  extraBadgeRects?: () => Array<{ id: string; rects: DOMRect[] | ArrayLike<DOMRect> }>;
}) {
  const { root, extraBadgeRects } = opts;
  const doc = root.ownerDocument;
  let items: OverlayHighlight[] = [];
  let placements: Placement[] = [];
  let layer: HTMLElement | null = null;
  let placementPending = false;

  function ensureLayer(): HTMLElement {
    if (layer && layer.isConnected) return layer;
    layer = doc.getElementById(LAYER_ID);
    if (!layer) {
      layer = doc.createElement("div");
      layer.id = LAYER_ID;
      layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
      (doc.body ?? root).appendChild(layer);
    }
    return layer;
  }

  /** Redraw every band from the current geometry. */
  function paintBands(host: HTMLElement) {
    for (const old of Array.from(host.querySelectorAll("[data-band]"))) old.remove();
    for (const placement of placements) {
      const item = items[placement.index];
      if (!item) continue;
      const dark = onDarkPage(placement.range);
      const fill = dark ? PALETTE[item.color].darkFill : PALETTE[item.color].fill;
      for (const b of bandRectsFor(placement.range.getClientRects())) {
        const band = doc.createElement("div");
        band.dataset.band = item.id;
        band.style.cssText =
          `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;` +
          `background:${fill};mix-blend-mode:${dark ? "screen" : "multiply"};` +
          "border-radius:1px;pointer-events:none;";
        host.appendChild(band);
      }
    }
  }

  function badgeFor(host: HTMLElement, key: string): HTMLElement {
    let badge = host.querySelector<HTMLElement>(`[data-badge="${CSS.escape(key)}"]`);
    if (!badge) {
      badge = createNoteBadge(doc);
      badge.dataset.badge = key;
      host.appendChild(badge);
    }
    return badge;
  }

  /** Dock the badge on the upper-left corner where the highlight starts. */
  function placeBadge(host: HTMLElement, key: string, at: { x: number; y: number }) {
    const badge = badgeFor(host, key);
    badge.style.left = `${at.x - NOTE_BADGE_SIZE / 2}px`;
    badge.style.top = `${at.y - NOTE_BADGE_SIZE / 2}px`;
  }

  function placeBadges(host: HTMLElement) {
    const wanted = new Set<string>();
    // Measure the ranges that were actually located, so a badge can never
    // drift onto a different match of the same phrase.
    for (const placement of placements) {
      const item = items[placement.index];
      if (!item || !item.note.trim()) continue;
      const at = badgeAnchorPoint(placement.range.getClientRects());
      if (!at) continue;
      wanted.add(item.id);
      placeBadge(host, item.id, at);
    }
    for (const extra of extraBadgeRects?.() ?? []) {
      const at = badgeAnchorPoint(extra.rects);
      if (!at) continue;
      wanted.add(extra.id);
      placeBadge(host, extra.id, at);
    }
    for (const badge of Array.from(host.querySelectorAll<HTMLElement>("[data-badge]"))) {
      if (!wanted.has(badge.dataset.badge ?? "")) badge.remove();
    }
  }

  /** Lay everything out against the current geometry. */
  function placeAll() {
    const host = ensureLayer();
    paintBands(host);
    placeBadges(host);
  }

  /**
   * Coalesce scroll/resize churn into one layout pass. Normally that pass
   * rides the next animation frame, but an occluded or background view
   * never gets one — Electron pauses rAF there — so a short timer stands in
   * and the first of the two to fire does the work.
   */
  function schedulePlacement() {
    if (placementPending) return;
    placementPending = true;
    const run = () => {
      if (!placementPending) return;
      placementPending = false;
      placeAll();
    };
    requestAnimationFrame(run);
    setTimeout(run, 50);
  }

  function repaint() {
    placements = locateAnchors(root, items);
    placeAll();
  }

  const onViewportChange = () => schedulePlacement();
  addEventListener("scroll", onViewportChange, true);
  addEventListener("resize", onViewportChange);

  return {
    /** Replace the painted set. */
    set(next: OverlayHighlight[]) {
      items = next;
      repaint();
    },
    /** Add or replace one highlight without disturbing the rest. */
    upsert(item: OverlayHighlight) {
      items = items.filter((i) => i.id !== item.id).concat(item);
      repaint();
    },
    remove(id: string) {
      items = items.filter((i) => i.id !== id);
      repaint();
    },
    repaint,
    /** Bands and badges follow the text; call after anything that moves it. */
    reposition: schedulePlacement,
    /** Which highlight is under this viewport point, if any. */
    at(clientX: number, clientY: number): OverlayHighlight | null {
      const offset = offsetFromPoint(root, clientX, clientY);
      if (offset == null) return null;
      const hit = hitPlacement(placements, offset);
      return hit ? items[hit.index] ?? null : null;
    },
    /** The first highlight a selection overlaps, if any. */
    intersecting(range: Range): OverlayHighlight | null {
      const hit = placements.find((p) => rangesIntersect(range, p.range));
      return hit ? items[hit.index] ?? null : null;
    },
    /** Where a highlight sits right now, for positioning menus and panels. */
    rectFor(id: string): DOMRect | null {
      const index = items.findIndex((i) => i.id === id);
      const placement = placements.find((p) => p.index === index);
      if (!placement) return null;
      const rects = Array.from(placement.range.getClientRects()).filter((r) => r.width > 0);
      return rects[rects.length - 1] ?? null;
    },
    has(id: string): boolean {
      return items.some((i) => i.id === id);
    },
    dispose() {
      removeEventListener("scroll", onViewportChange, true);
      removeEventListener("resize", onViewportChange);
      layer?.remove();
      layer = null;
    },
  };
}
