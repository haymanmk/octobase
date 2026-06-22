import type {
  Card,
  HighlightColor,
  NoteCard,
  Placement,
  Whiteboard,
  WorkspaceData,
} from "../model/types.ts";
import { ID } from "../model/ids.ts";
import { normalizeTitle, parseWikilinks } from "../model/wikilinks.ts";
import type { PersistenceBackend } from "./persistence.ts";

type Listener = () => void;

function now(): number {
  return Date.now();
}

function emptyData(): WorkspaceData {
  return { version: 1, cards: [], whiteboards: [], placements: [] };
}

export interface SearchHit {
  card: Card;
  score: number;
}

/**
 * The single source of truth for the knowledge base. Holds the workspace in
 * memory, persists through a pluggable backend, derives the link graph and a
 * lightweight search index, and notifies React subscribers on every mutation.
 *
 * Framework-agnostic on purpose so it can be unit-tested under node:test.
 */
export class WorkspaceStore {
  private data: WorkspaceData = emptyData();
  private listeners = new Set<Listener>();
  private loaded = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly backend: PersistenceBackend;

  constructor(backend: PersistenceBackend) {
    this.backend = backend;
  }

  // ---- lifecycle -----------------------------------------------------------

  async init(): Promise<void> {
    const loaded = await this.backend.load();
    this.data = loaded ?? emptyData();
    if (!this.data.whiteboards.some((w) => !w.deletedAt)) {
      // Guarantee at least one board to land on.
      this.createWhiteboard("My first whiteboard", { silent: true });
    }
    this.loaded = true;
    this.emit();
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private touch(): void {
    this.emit();
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.backend.save(this.snapshot());
    }, 150);
  }

  /** Deep-ish copy for persistence / external reads. */
  snapshot(): WorkspaceData {
    return JSON.parse(JSON.stringify(this.data)) as WorkspaceData;
  }

  // ---- reads ---------------------------------------------------------------

  getCards(): Card[] {
    return this.data.cards.filter((c) => !c.deletedAt);
  }

  getCard(id: string): Card | undefined {
    const c = this.data.cards.find((x) => x.id === id);
    return c && !c.deletedAt ? c : undefined;
  }

  getWhiteboards(): Whiteboard[] {
    return this.data.whiteboards.filter((w) => !w.deletedAt);
  }

  getWhiteboard(id: string): Whiteboard | undefined {
    const w = this.data.whiteboards.find((x) => x.id === id);
    return w && !w.deletedAt ? w : undefined;
  }

  getPlacements(whiteboardId: string): Placement[] {
    const liveCards = new Set(this.getCards().map((c) => c.id));
    return this.data.placements.filter(
      (p) => p.whiteboardId === whiteboardId && liveCards.has(p.cardId),
    );
  }

  /** Cards that are not placed on any whiteboard — the "inbox". */
  getInboxCards(): Card[] {
    const placed = new Set(this.data.placements.map((p) => p.cardId));
    return this.getCards().filter((c) => !placed.has(c.id));
  }

  getAllTags(): string[] {
    const set = new Set<string>();
    for (const c of this.getCards()) for (const t of c.tags) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  getCardsByTag(tag: string): Card[] {
    const t = tag.toLowerCase();
    return this.getCards().filter((c) =>
      c.tags.some((x) => x.toLowerCase() === t),
    );
  }

  // ---- card mutations ------------------------------------------------------

  createNoteCard(
    init: Partial<Pick<NoteCard, "title" | "body" | "tags" | "color">> = {},
  ): NoteCard {
    const ts = now();
    const card: NoteCard = {
      id: ID.card(),
      kind: "note",
      title: init.title ?? "Untitled",
      body: init.body ?? "",
      tags: init.tags ?? [],
      color: init.color ?? "yellow",
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    this.data.cards.push(card);
    this.touch();
    return card;
  }

  addCard(card: Card): Card {
    this.data.cards.push(card);
    this.touch();
    return card;
  }

  updateCard(
    id: string,
    patch: Partial<Pick<Card, "title" | "body" | "tags" | "color">>,
  ): Card | undefined {
    const idx = this.data.cards.findIndex((c) => c.id === id);
    if (idx < 0) return undefined;
    const merged = { ...this.data.cards[idx], ...patch, updatedAt: now() } as Card;
    this.data.cards[idx] = merged;
    this.touch();
    return merged;
  }

  deleteCard(id: string): void {
    const idx = this.data.cards.findIndex((c) => c.id === id);
    if (idx < 0) return;
    this.data.cards[idx] = { ...this.data.cards[idx], deletedAt: now() } as Card;
    // Drop placements of the deleted card.
    this.data.placements = this.data.placements.filter((p) => p.cardId !== id);
    this.touch();
  }

  restoreCard(id: string): void {
    const idx = this.data.cards.findIndex((c) => c.id === id);
    if (idx < 0) return;
    this.data.cards[idx] = { ...this.data.cards[idx], deletedAt: null } as Card;
    this.touch();
  }

  // ---- whiteboard mutations ------------------------------------------------

  createWhiteboard(name: string, opts: { silent?: boolean } = {}): Whiteboard {
    const ts = now();
    const wb: Whiteboard = {
      id: ID.whiteboard(),
      name: name.trim() || "Untitled whiteboard",
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    this.data.whiteboards.push(wb);
    if (!opts.silent) this.touch();
    return wb;
  }

  renameWhiteboard(id: string, name: string): void {
    const idx = this.data.whiteboards.findIndex((w) => w.id === id);
    if (idx < 0) return;
    this.data.whiteboards[idx] = {
      ...this.data.whiteboards[idx],
      name: name.trim() || this.data.whiteboards[idx].name,
      updatedAt: now(),
    };
    this.touch();
  }

  deleteWhiteboard(id: string): void {
    const idx = this.data.whiteboards.findIndex((w) => w.id === id);
    if (idx < 0) return;
    this.data.whiteboards[idx] = {
      ...this.data.whiteboards[idx],
      deletedAt: now(),
    };
    // Placements on this board are removed; the cards survive (move to inbox).
    this.data.placements = this.data.placements.filter(
      (p) => p.whiteboardId !== id,
    );
    this.touch();
  }

  // ---- placement mutations -------------------------------------------------

  placeCard(
    whiteboardId: string,
    cardId: string,
    x: number,
    y: number,
    w = 260,
    h = 180,
  ): Placement {
    const existing = this.data.placements.find(
      (p) => p.whiteboardId === whiteboardId && p.cardId === cardId,
    );
    if (existing) {
      existing.x = x;
      existing.y = y;
      this.touch();
      return existing;
    }
    const topZ = this.data.placements.reduce((m, p) => Math.max(m, p.z), 0);
    const placement: Placement = {
      id: ID.placement(),
      whiteboardId,
      cardId,
      x,
      y,
      w,
      h,
      z: topZ + 1,
    };
    this.data.placements.push(placement);
    this.touch();
    return placement;
  }

  updatePlacement(
    id: string,
    patch: Partial<Pick<Placement, "x" | "y" | "w" | "h" | "z">>,
  ): void {
    const idx = this.data.placements.findIndex((p) => p.id === id);
    if (idx < 0) return;
    this.data.placements[idx] = { ...this.data.placements[idx], ...patch };
    this.touch();
  }

  bringToFront(id: string): void {
    const topZ = this.data.placements.reduce((m, p) => Math.max(m, p.z), 0);
    this.updatePlacement(id, { z: topZ + 1 });
  }

  removePlacement(id: string): void {
    const before = this.data.placements.length;
    this.data.placements = this.data.placements.filter((p) => p.id !== id);
    if (this.data.placements.length !== before) this.touch();
  }

  /** Create a note card and immediately place it on a board. */
  createNoteOnBoard(
    whiteboardId: string,
    x: number,
    y: number,
    init?: Partial<Pick<NoteCard, "title" | "body" | "color">>,
  ): { card: NoteCard; placement: Placement } {
    const card = this.createNoteCard(init);
    const placement = this.placeCard(whiteboardId, card.id, x, y);
    return { card, placement };
  }

  // ---- link graph ----------------------------------------------------------

  private cardByTitle(title: string): Card | undefined {
    const key = normalizeTitle(title);
    return this.getCards().find((c) => normalizeTitle(c.title) === key);
  }

  /** Outgoing resolved links from a card (deduped, existing targets only). */
  getOutgoingLinks(cardId: string): Card[] {
    const card = this.getCard(cardId);
    if (!card) return [];
    const seen = new Set<string>();
    const out: Card[] = [];
    for (const wl of parseWikilinks(card.body)) {
      const target = this.cardByTitle(wl.target);
      if (target && target.id !== cardId && !seen.has(target.id)) {
        seen.add(target.id);
        out.push(target);
      }
    }
    return out;
  }

  /** Cards whose body links to the given card. */
  getBacklinks(cardId: string): Card[] {
    const card = this.getCard(cardId);
    if (!card) return [];
    const key = normalizeTitle(card.title);
    const out: Card[] = [];
    for (const other of this.getCards()) {
      if (other.id === cardId) continue;
      const links = parseWikilinks(other.body);
      if (links.some((l) => normalizeTitle(l.target) === key)) out.push(other);
    }
    return out;
  }

  /** Unresolved wikilink targets in a card (no matching card exists yet). */
  getUnresolvedLinks(cardId: string): string[] {
    const card = this.getCard(cardId);
    if (!card) return [];
    const out = new Set<string>();
    for (const wl of parseWikilinks(card.body)) {
      if (!this.cardByTitle(wl.target)) out.add(wl.target);
    }
    return [...out];
  }

  // ---- search --------------------------------------------------------------

  search(query: string): SearchHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/\s+/);
    const hits: SearchHit[] = [];
    for (const card of this.getCards()) {
      const title = card.title.toLowerCase();
      const body = card.body.toLowerCase();
      const tags = card.tags.join(" ").toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (title.includes(term)) score += 5;
        if (tags.includes(term)) score += 3;
        if (body.includes(term)) score += 1;
      }
      if (score > 0) hits.push({ card, score });
    }
    return hits.sort((a, b) => b.score - a.score || b.card.updatedAt - a.card.updatedAt);
  }

  // ---- helpers for color reuse --------------------------------------------

  static defaultColor(): HighlightColor {
    return "yellow";
  }
}
