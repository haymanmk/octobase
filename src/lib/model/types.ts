import type { HighlightColor } from "../../types/highlight.ts";

export type { HighlightColor };

export type CardKind = "note" | "highlight" | "article" | "image" | "pdf";

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
  /** 1-based page number when the source is a PDF (sourceUrl = pdf:<id>). */
  page?: number;
}

export interface ArticleCard extends BaseCard {
  kind: "article";
  sourceUrl: string;
  siteName?: string;
  byline?: string;
}

/**
 * A clipped region of a web page. The PNG lives on disk under the app's
 * userData (served to the renderer via the octobase-clip:// protocol); the
 * card carries only the reference. `body` is an optional markdown note.
 */
export interface ImageCard extends BaseCard {
  kind: "image";
  sourceUrl: string;
  image: {
    /** File name inside the clips directory. */
    file: string;
    /** Natural size in physical pixels. */
    w: number;
    h: number;
  };
  /**
   * For PDF clips: the region the clip was taken from, so the reader can
   * frame it on the page and Read can scroll back to it. Coordinates are in
   * scale-1 page units.
   */
  clip?: { page: number; x: number; y: number; w: number; h: number };
}

/**
 * An imported PDF. The file lives under userData/pdfs/<file> (served to the
 * renderer via octobase-pdf://); the card carries only the reference and a
 * cheap page count for display. Its stable pseudo-URL is `pdf:<card id>`, so
 * highlights/clips taken from it share a source the way article highlights do.
 */
export interface PdfCard extends BaseCard {
  kind: "pdf";
  /** File name inside the pdfs directory. */
  file: string;
  pages: number;
  /** First-page thumbnail: file name inside the clips directory. */
  cover?: string;
}

export type Card = NoteCard | HighlightCard | ArticleCard | ImageCard | PdfCard;

/** The stable source key for annotations taken from a PDF card. */
export function pdfSourceUrl(cardId: string): string {
  return `pdf:${cardId}`;
}

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

/** A card side a connector can attach to. */
export type EdgeSide = "top" | "right" | "bottom" | "left";

/**
 * A hand-drawn connector between two cards on one whiteboard. Board-scoped:
 * it exists only while both cards are placed on that board.
 */
export interface Edge {
  id: string;
  whiteboardId: string;
  fromCardId: string;
  toCardId: string;
  /** Short text rendered in a pill at the curve midpoint; "" = none. */
  label: string;
  /** Arrowhead at the target end. */
  directed: boolean;
  /**
   * The dots the user drew from/to — pinned anchors that survive card moves.
   * null (or absent, on pre-pinning edges) = auto-route to the nearest side.
   */
  fromSide?: EdgeSide | null;
  toSide?: EdgeSide | null;
}

/**
 * A named, collapsible frame on a whiteboard. Membership is derived, never
 * stored: a placement belongs to the group whose bounds contain its center
 * (smallest area wins when frames overlap). Flat — groups don't nest.
 */
export interface Group {
  id: string;
  whiteboardId: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Collapsed groups render as a chip; member cards stay placed but hidden. */
  collapsed: boolean;
}

/** The full serialized workspace persisted as one document. */
export interface WorkspaceData {
  version: 1;
  cards: Card[];
  whiteboards: Whiteboard[];
  placements: Placement[];
  edges: Edge[];
  /** Absent on documents saved before groups existed; loads as []. */
  groups?: Group[];
}

export function isCard(value: unknown): value is Card {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Card).id === "string" &&
    typeof (value as Card).kind === "string"
  );
}
