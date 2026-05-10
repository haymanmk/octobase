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
