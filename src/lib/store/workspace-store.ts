import type {
  ArticleCard,
  Card,
  Edge,
  EdgeSide,
  HighlightCard,
  HighlightColor,
  ImageCard,
  NoteCard,
  PdfCard,
  Placement,
  TextAnchor,
  Whiteboard,
  WorkspaceData,
} from "../model/types.ts";
import { ID } from "../model/ids.ts";
import { describeAnchor } from "../anchor/text-anchor.ts";
import { normalizeTitle, parseEmbeds, parseWikilinks, unescapeWikilinks } from "../model/wikilinks.ts";
import type { PersistenceBackend } from "./persistence.ts";

type Listener = () => void;

function now(): number {
  return Date.now();
}

function emptyData(): WorkspaceData {
  return { version: 1, cards: [], whiteboards: [], placements: [], edges: [] };
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
  private version = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly backend: PersistenceBackend;

  constructor(backend: PersistenceBackend) {
    this.backend = backend;
  }

  // ---- lifecycle -----------------------------------------------------------

  async init(opts: { seed?: boolean } = {}): Promise<void> {
    const seed = opts.seed ?? true;
    const loaded = await this.backend.load();
    this.data = loaded ?? emptyData();
    this.data.edges ??= []; // pre-edges documents
    const fresh = !loaded;
    this.migrateHighlightBodies();
    this.migrateEscapedWikilinks();
    if (!this.data.whiteboards.some((w) => !w.deletedAt)) {
      // Guarantee at least one board to land on.
      const wb = this.createWhiteboard(seed ? "Welcome" : "My first whiteboard", { silent: true });
      if (fresh && seed) this.seedWelcome(wb.id);
    }
    this.loaded = true;
    if (fresh) void this.backend.save(this.snapshot());
    this.emit();
  }

  /**
   * Highlight card bodies used to duplicate the quoted text ("> exact\n\nnote");
   * the title already carries the text, so bodies now hold only the note.
   * Strip the legacy quote from persisted cards once on load.
   */
  /**
   * The editor's markdown serializer used to escape "[[" pairs on commit,
   * breaking every saved wikilink; repair persisted bodies once on load.
   */
  private migrateEscapedWikilinks(): void {
    for (const c of this.data.cards) {
      const fixed = unescapeWikilinks(c.body);
      if (fixed !== c.body) c.body = fixed;
    }
  }

  private migrateHighlightBodies(): void {
    for (const c of this.data.cards) {
      if (c.kind !== "highlight") continue;
      const exact = c.anchor?.exact;
      if (!exact || !c.body.startsWith("> ")) continue;
      // Exact prefix first; fall back to comparing the first paragraph with
      // whitespace normalized (old bodies quoted a trimmed copy of the text).
      const quote = `> ${exact}`;
      if (c.body.startsWith(quote)) {
        c.body = c.body.slice(quote.length).trimStart();
        continue;
      }
      const nl = c.body.indexOf("\n\n");
      const first = nl === -1 ? c.body : c.body.slice(0, nl);
      if (first.slice(2).trim() === exact.trim()) {
        c.body = nl === -1 ? "" : c.body.slice(nl + 2).trimStart();
      }
    }
  }

  /** A small first-run board that demonstrates notes, links, and tags. */
  private seedWelcome(boardId: string): void {
    const mk = (
      x: number,
      y: number,
      w: number,
      h: number,
      title: string,
      body: string,
      color: HighlightColor,
      tags: string[] = [],
    ) => {
      const card = this.createNoteCard({ title, body, color, tags });
      this.placeCard(boardId, card.id, x, y, w, h);
      return card;
    };
    mk(
      40,
      40,
      300,
      210,
      "Welcome to octobase",
      "Your **local-first** knowledge base.\n\n- Double-click the canvas to write a card\n- Link cards with [[Text anchoring]]\n- Press ⌘K to search\n\nEverything lives on your machine.",
      "yellow",
      ["start"],
    );
    mk(
      380,
      40,
      300,
      200,
      "Text anchoring",
      "Highlights re-locate even after a page changes, using a text-quote + position strategy. Shared with the [[Web highlighter]] and the capture flow.",
      "blue",
      ["foundation"],
    );
    mk(
      380,
      280,
      300,
      180,
      "Web highlighter",
      "Highlight any article and drop it here as a card. See [[Welcome to octobase]] to get started.",
      "green",
      ["foundation", "roadmap"],
    );
    mk(
      40,
      290,
      300,
      170,
      "Rich markdown",
      "Write with headings, lists, **bold**, `code`, and tasks:\n\n- [x] Build the editor\n- [ ] Capture articles\n\nOpen this card to try the editor.",
      "purple",
      ["start"],
    );

    // A captured article + two highlights, to demonstrate the reader (P3).
    const url = "https://example.com/the-extended-mind";
    const articleBody =
      "Where does the mind stop and the rest of the world begin?\n\n" +
      "We propose a view in which the boundary between mind and environment is " +
      "not fixed. When parts of the world function as a process which, were it " +
      "done in the head, we would count as cognitive, then that part of the " +
      "world is part of the cognitive process.\n\n" +
      "## Active externalism\n\n" +
      "The notebook plays the role usually played by biological memory. The " +
      "information in the notebook functions just like the information " +
      "constituting an ordinary non-occurrent belief; it just happens that this " +
      "information lies beyond the skin.";
    const article = this.createArticleCard({
      title: "The Extended Mind",
      body: articleBody,
      sourceUrl: url,
      siteName: "example.com",
      byline: "Andy Clark & David Chalmers",
      color: "blue",
    });
    this.placeCard(boardId, article.id, 720, 40, 320, 230);

    const hl = (phrase: string, color: HighlightColor, x: number, y: number) => {
      const i = articleBody.indexOf(phrase);
      if (i < 0) return;
      const anchor = describeAnchor(articleBody, i, i + phrase.length);
      const card = this.createHighlightCard({ text: phrase, sourceUrl: url, anchor, color });
      this.placeCard(boardId, card.id, x, y, 320, 150);
    };
    hl("the boundary between mind and environment is not fixed", "pink", 720, 300);
    hl("information lies beyond the skin", "orange", 720, 470);
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Monotonic counter; React reads this as a cheap, stable snapshot. */
  getVersion(): number {
    return this.version;
  }

  private emit(): void {
    this.version++;
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

  createHighlightCard(init: {
    text: string;
    sourceUrl: string;
    anchor: TextAnchor;
    color?: HighlightColor;
    tags?: string[];
    notes?: string;
    page?: number;
  }): HighlightCard {
    const ts = now();
    const text = init.text.trim();
    const card: HighlightCard = {
      id: ID.card(),
      kind: "highlight",
      title: text.length > 64 ? text.slice(0, 64) + "…" : text || "Highlight",
      // The title carries the highlighted text; the body is just the note.
      body: init.notes ?? "",
      tags: init.tags ?? [],
      color: init.color ?? "yellow",
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
      sourceUrl: init.sourceUrl,
      anchor: init.anchor,
      ...(init.page ? { page: init.page } : {}),
    };
    this.data.cards.push(card);
    this.touch();
    return card;
  }

  /**
   * Create-or-update a highlight card keyed by a stable id. The capture
   * extension owns the id, so edits made on the web page (recolor, note,
   * re-anchor) update the same card instead of duplicating it.
   */
  upsertHighlight(init: {
    id?: string;
    text: string;
    sourceUrl: string;
    anchor: TextAnchor;
    color?: HighlightColor;
    note?: string;
    page?: number;
  }): HighlightCard {
    const text = init.text.trim();
    const title = text.length > 64 ? text.slice(0, 64) + "…" : text || "Highlight";
    // The title carries the highlighted text; the body is just the note.
    const body = init.note?.trim() ?? "";

    if (init.id) {
      const idx = this.data.cards.findIndex((c) => c.id === init.id);
      if (idx >= 0 && this.data.cards[idx].kind === "highlight") {
        const prev = this.data.cards[idx] as HighlightCard;
        const updated: HighlightCard = {
          ...prev,
          title,
          body,
          color: init.color ?? prev.color,
          anchor: init.anchor ?? prev.anchor,
          sourceUrl: init.sourceUrl || prev.sourceUrl,
          deletedAt: null,
          updatedAt: now(),
        };
        this.data.cards[idx] = updated;
        this.touch();
        return updated;
      }
    }

    const ts = now();
    const card: HighlightCard = {
      id: init.id ?? ID.card(),
      kind: "highlight",
      title,
      body,
      tags: [],
      color: init.color ?? "yellow",
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
      sourceUrl: init.sourceUrl,
      anchor: init.anchor,
      ...(init.page ? { page: init.page } : {}),
    };
    this.data.cards.push(card);
    this.touch();
    return card;
  }

  createPdfCard(init: {
    title: string;
    file: string;
    pages: number;
    tags?: string[];
    color?: HighlightColor;
  }): PdfCard {
    const ts = now();
    const card: PdfCard = {
      id: ID.card(),
      kind: "pdf",
      title: init.title.trim() || "PDF",
      body: "",
      tags: init.tags ?? [],
      color: init.color ?? "blue",
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
      file: init.file,
      pages: init.pages,
    };
    this.data.cards.push(card);
    this.touch();
    return card;
  }

  createArticleCard(init: {
    title: string;
    body: string;
    sourceUrl: string;
    siteName?: string;
    byline?: string;
    tags?: string[];
    color?: HighlightColor;
  }): ArticleCard {
    const ts = now();
    const card: ArticleCard = {
      id: ID.card(),
      kind: "article",
      title: init.title.trim() || "Untitled article",
      body: init.body,
      tags: init.tags ?? [],
      color: init.color ?? "blue",
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
      sourceUrl: init.sourceUrl,
      siteName: init.siteName,
      byline: init.byline,
    };
    this.data.cards.push(card);
    this.touch();
    return card;
  }

  createImageCard(init: {
    title: string;
    sourceUrl: string;
    image: ImageCard["image"];
    clip?: ImageCard["clip"];
    body?: string;
    tags?: string[];
    color?: HighlightColor;
  }): ImageCard {
    const ts = now();
    const card: ImageCard = {
      id: ID.card(),
      kind: "image",
      title: init.title.trim() || "Clip",
      body: init.body ?? "",
      tags: init.tags ?? [],
      color: init.color ?? "blue",
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
      sourceUrl: init.sourceUrl,
      image: init.image,
      ...(init.clip ? { clip: init.clip } : {}),
    };
    this.data.cards.push(card);
    this.touch();
    return card;
  }

  /** Live highlight cards whose source matches the given URL. */
  getHighlightsForUrl(sourceUrl: string): HighlightCard[] {
    return this.getCards().filter(
      (c): c is HighlightCard => c.kind === "highlight" && c.sourceUrl === sourceUrl,
    );
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
    // Drop placements and edges of the deleted card.
    this.data.placements = this.data.placements.filter((p) => p.cardId !== id);
    this.data.edges = this.data.edges.filter(
      (e) => e.fromCardId !== id && e.toCardId !== id,
    );
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
    this.data.edges = this.data.edges.filter((e) => e.whiteboardId !== id);
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
    const removed = this.data.placements.find((p) => p.id === id);
    if (!removed) return;
    this.data.placements = this.data.placements.filter((p) => p.id !== id);
    // The card left this board — its edges here go with it.
    this.data.edges = this.data.edges.filter(
      (e) =>
        e.whiteboardId !== removed.whiteboardId ||
        (e.fromCardId !== removed.cardId && e.toCardId !== removed.cardId),
    );
    this.touch();
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

  // ---- edges ---------------------------------------------------------------

  /** Edges of one board. Cleanup on delete keeps these consistent already. */
  getEdges(whiteboardId: string): Edge[] {
    return this.data.edges.filter((e) => e.whiteboardId === whiteboardId);
  }

  /**
   * Connect two cards on a board. Same-direction duplicates return the
   * existing edge; the reverse direction is a distinct edge. `sides` pins
   * the anchors to the dots the user drew from/to; omitted = auto-route.
   */
  createEdge(
    whiteboardId: string,
    fromCardId: string,
    toCardId: string,
    sides: { fromSide?: EdgeSide | null; toSide?: EdgeSide | null } = {},
  ): Edge {
    if (fromCardId === toCardId) {
      throw new Error("cannot connect a card to itself");
    }
    const existing = this.data.edges.find(
      (e) =>
        e.whiteboardId === whiteboardId &&
        e.fromCardId === fromCardId &&
        e.toCardId === toCardId,
    );
    if (existing) return existing;
    const edge: Edge = {
      id: ID.edge(),
      whiteboardId,
      fromCardId,
      toCardId,
      label: "",
      directed: true,
      fromSide: sides.fromSide ?? null,
      toSide: sides.toSide ?? null,
    };
    this.data.edges.push(edge);
    this.touch();
    return edge;
  }

  updateEdge(
    id: string,
    patch: Partial<Pick<Edge, "label" | "directed" | "fromSide" | "toSide">>,
  ): void {
    const idx = this.data.edges.findIndex((e) => e.id === id);
    if (idx < 0) return;
    this.data.edges[idx] = { ...this.data.edges[idx], ...patch };
    this.touch();
  }

  flipEdge(id: string): void {
    const idx = this.data.edges.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const e = this.data.edges[idx];
    this.data.edges[idx] = {
      ...e,
      fromCardId: e.toCardId,
      toCardId: e.fromCardId,
      // Pinned anchors belong to their card, so they swap with it.
      fromSide: e.toSide ?? null,
      toSide: e.fromSide ?? null,
    };
    this.touch();
  }

  /**
   * Re-attach one end of an edge — to another card, or to a different dot
   * (side) of the same card. Returns false when the move would create a
   * self-loop, duplicate an existing same-direction edge, reference a
   * missing edge/card, or change nothing.
   */
  reconnectEdge(
    id: string,
    end: "from" | "to",
    cardId: string,
    side: EdgeSide | null = null,
  ): boolean {
    const idx = this.data.edges.findIndex((e) => e.id === id);
    if (idx < 0 || !this.getCard(cardId)) return false;
    const e = this.data.edges[idx];
    const fromCardId = end === "from" ? cardId : e.fromCardId;
    const toCardId = end === "to" ? cardId : e.toCardId;
    if (fromCardId === toCardId) return false;
    const sideKey = end === "from" ? "fromSide" : "toSide";
    const cardChanged = fromCardId !== e.fromCardId || toCardId !== e.toCardId;
    const sideChanged = (e[sideKey] ?? null) !== side;
    if (!cardChanged && !sideChanged) return false;
    if (cardChanged) {
      const duplicate = this.data.edges.some(
        (other) =>
          other.id !== id &&
          other.whiteboardId === e.whiteboardId &&
          other.fromCardId === fromCardId &&
          other.toCardId === toCardId,
      );
      if (duplicate) return false;
    }
    this.data.edges[idx] = { ...e, fromCardId, toCardId, [sideKey]: side };
    this.touch();
    return true;
  }

  deleteEdge(id: string): void {
    const before = this.data.edges.length;
    this.data.edges = this.data.edges.filter((e) => e.id !== id);
    if (this.data.edges.length !== before) this.touch();
  }

  // ---- link graph ----------------------------------------------------------

  private cardByTitle(title: string): Card | undefined {
    const key = normalizeTitle(title);
    return this.getCards().find((c) => normalizeTitle(c.title) === key);
  }

  /** [[links]] and ![[embeds]] both create graph relations. */
  private references(body: string) {
    return [...parseWikilinks(body), ...parseEmbeds(body)];
  }

  /** Outgoing resolved links from a card (deduped, existing targets only). */
  getOutgoingLinks(cardId: string): Card[] {
    const card = this.getCard(cardId);
    if (!card) return [];
    const seen = new Set<string>();
    const out: Card[] = [];
    for (const wl of this.references(card.body)) {
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
      const links = this.references(other.body);
      if (links.some((l) => normalizeTitle(l.target) === key)) out.push(other);
    }
    return out;
  }

  // ---- nesting (embeds) ------------------------------------------------------

  /** Cards embedded in this card's body, in body order, deduped. */
  getChildCards(cardId: string): Card[] {
    const card = this.getCard(cardId);
    if (!card) return [];
    const seen = new Set<string>();
    const out: Card[] = [];
    for (const em of parseEmbeds(card.body)) {
      const target = this.cardByTitle(em.target);
      if (target && target.id !== cardId && !seen.has(target.id)) {
        seen.add(target.id);
        out.push(target);
      }
    }
    return out;
  }

  /**
   * Nest a card: append an ![[embed]] block to the host's body. Returns false
   * on self-embeds, missing cards, or when the child is already embedded.
   */
  embedCard(hostCardId: string, childCardId: string): boolean {
    if (hostCardId === childCardId) return false;
    const host = this.getCard(hostCardId);
    const child = this.getCard(childCardId);
    if (!host || !child) return false;
    const key = normalizeTitle(child.title);
    if (parseEmbeds(host.body).some((e) => normalizeTitle(e.target) === key)) {
      return false;
    }
    const block = `![[${child.title.trim()}]]`;
    const body = host.body.trim() ? `${host.body.replace(/\s+$/, "")}\n\n${block}` : block;
    this.updateCard(hostCardId, { body });
    return true;
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
