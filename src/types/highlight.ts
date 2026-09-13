import type { TextAnchor } from "../lib/model/types.ts";

export const HIGHLIGHT_COLORS = [
  "yellow",
  "green",
  "pink",
  "blue",
  "purple",
  "orange",
] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export type HighlightId = string;

export interface RangyAnchor {
  serialized: string;
}

export interface Highlight {
  id: HighlightId;
  text: string;
  sourceUrl: string;
  color: HighlightColor;
  tags: string[];
  notes: string;
  anchor: RangyAnchor;
  /**
   * The portable anchor, shared with the capture extension and the workspace
   * store. Highlights made outside the browser pane have only this one, and
   * arrive with an empty `anchor.serialized`.
   */
  textAnchor?: TextAnchor;
  createdAt: number;
  updatedAt: number;
}

export interface Card {
  id: HighlightId;
  text: string;
  sourceUrl: string;
  color: HighlightColor;
  tags: string[];
  notes: string;
  x: number;
  y: number;
  updatedAt: number;
}

export function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === "string" && (HIGHLIGHT_COLORS as readonly string[]).includes(value);
}
