import type { HighlightColor } from "../../types/highlight.ts";

export type { HighlightColor };

export type CardKind = "note" | "highlight" | "article";

/**
 * Durable text anchor: a W3C-style text-quote + position hint that re-locates a
 * highlight inside a plain-text rendering of a document even after the DOM
 * changes. Shared by the in-app highlighter and the future capture extension.
 */
export interface TextAnchor {
  exact: string;
  prefix: string;
  suffix: string;
  startHint: number;
}

interface BaseCard {
  id: string;
  kind: CardKind;
  title: string;
  /** Markdown body. */
  body: string;
  tags: string[];
  color: HighlightColor;
  createdAt: number;
  updatedAt: number;
  /** Soft-delete marker for sync-friendliness. null = live. */
  deletedAt: number | null;
}

export interface NoteCard extends BaseCard {
  kind: "note";
}

export interface HighlightCard extends BaseCard {
  kind: "highlight";
  sourceUrl: string;
  anchor: TextAnchor;
}

export interface ArticleCard extends BaseCard {
  kind: "article";
  sourceUrl: string;
  siteName?: string;
  byline?: string;
}

export type Card = NoteCard | HighlightCard | ArticleCard;

export interface Whiteboard {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** A card placed on a whiteboard at a position/size. */
export interface Placement {
  id: string;
  whiteboardId: string;
  cardId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

/** A directed link between two cards, derived from [[wikilinks]] in card bodies. */
export interface Link {
  fromCardId: string;
  toCardId: string;
}

/** The full serialized workspace persisted as one document. */
export interface WorkspaceData {
  version: 1;
  cards: Card[];
  whiteboards: Whiteboard[];
  placements: Placement[];
}

export function isCard(value: unknown): value is Card {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Card).id === "string" &&
    typeof (value as Card).kind === "string"
  );
}
