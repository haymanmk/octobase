import * as React from "react";
import { BookOpen, CornerUpLeft, FileText, Focus, ListTree, MoreHorizontal, PanelLeft, PanelRight, Plug, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import "./workspace.css";
import { WorkspaceProvider } from "./WorkspaceProvider.tsx";
import { useWorkspace } from "./store-context.ts";
import { Sidebar } from "./Sidebar.tsx";
import { LibraryPanel } from "./LibraryPanel.tsx";
import { TocPanel } from "./TocPanel.tsx";
import { Canvas, type CanvasHandle } from "./Canvas.tsx";
import { groupOf } from "../lib/model/groups.ts";
import { CommandPalette } from "./CommandPalette.tsx";
import { getAiBridge, getCaptureBridge, getClipBridge, getDropBridge, getPdfBridge, getViewerBridge, pdfUrl, type ExtensionInfo, type PdfImportResult } from "./electron-bridge.ts";
import { AiSettings } from "./AiSettings.tsx";
import { applyHighlightDrop } from "./drop-highlight.ts";
import { imageFileOf, savePastedImage } from "./image-paste.ts";
import { ViewerHost, type ViewerTabInfo } from "./ViewerHost.tsx";
import {
  SIDEBAR_W,
  LIBRARY_W,
  DIVIDER_W,
  BROWSER_TAB,
  clampViewerWidth,
  halfViewerWidth,
  loadViewerLayout,
  saveViewerLayout,
  type ViewerLayout,
} from "./viewer-layout.ts";
import { HIGHLIGHT_COLORS } from "../types/highlight.ts";
import { PALETTE } from "../components/highlighter/colors.ts";
import type { HighlightColor } from "../lib/model/types.ts";

interface ContextMenuState {
  cardId: string;
  x: number;
  y: number;
}
/** Right-click on empty canvas. `wx/wy` are canvas coords; `x/y` screen coords. */
interface CanvasMenuState {
  wx: number;
  wy: number;
  x: number;
  y: number;
}
interface ToastState {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

function WorkspaceInner(): React.ReactElement {
  const store = useWorkspace();
  const boards = store.getWhiteboards();
  const [activeBoardId, setActiveBoardId] = React.useState<string>(() => boards[0]?.id ?? "");
  const [selectedCardIds, setSelectedCardIds] = React.useState<string[]>([]);
  /** Single-select (or clear); the marquee uses setSelectedCardIds directly. */
  const selectOne = React.useCallback((id: string | null) => {
    setSelectedCardIds(id ? [id] : []);
  }, []);
  const [editingCardId, setEditingCardId] = React.useState<string | null>(null);
  const [cmdk, setCmdk] = React.useState<{ open: boolean; seed?: string }>({ open: false });
  const [ctx, setCtx] = React.useState<ContextMenuState | null>(null);
  const [canvasMenu, setCanvasMenu] = React.useState<CanvasMenuState | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [toast, setToast] = React.useState<ToastState | null>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connectInfo, setConnectInfo] = React.useState<ExtensionInfo | null>(null);
  const [aiSettingsOpen, setAiSettingsOpen] = React.useState(false);
  /** Nonce asking the viewer to open the chat drawer for its active tab. */
  const [chatNonce, setChatNonce] = React.useState<{ at: number } | null>(null);
  const captureBridge = getCaptureBridge();
  const canvasRef = React.useRef<CanvasHandle>(null);

  // Shell layout: collapsible sidebar + the tabbed viewer pane (resizable,
  // persisted). The live-browser tab only exists in Electron, but reader tabs
  // work everywhere.
  const viewerAvailable = Boolean(getViewerBridge());
  const [viewer, setViewer] = React.useState<ViewerLayout>(() => {
    // The saved width may come from a larger window — clamp to this one.
    const saved = loadViewerLayout((id) => Boolean(store.getCard(id)));
    return { ...saved, width: clampViewerWidth(saved.width, window.innerWidth) };
  });
  const [dividerDrag, setDividerDrag] = React.useState(false);
  // Card library panel between sidebar and board; open state persists.
  const [libraryOpen, setLibraryOpen] = React.useState(
    () => localStorage.getItem("octobase.library.open") === "1",
  );
  React.useEffect(() => {
    localStorage.setItem("octobase.library.open", libraryOpen ? "1" : "0");
  }, [libraryOpen]);
  // Board table of contents (floating over the canvas); open state persists.
  const [tocOpen, setTocOpen] = React.useState(
    () => localStorage.getItem("octobase.toc.open") === "1",
  );
  React.useEffect(() => {
    localStorage.setItem("octobase.toc.open", tocOpen ? "1" : "0");
  }, [tocOpen]);
  const viewerOpen = viewer.open && (viewerAvailable || viewer.readerTabs.length > 0);
  // The native browser view always paints above our DOM, so it must yield
  // whenever a full-window overlay is up (⌘K palette, extension dialog) or
  // the divider is mid-drag. Reading and editing are panes now — not overlays.
  const overlayUp = Boolean(cmdk.open || connectInfo || aiSettingsOpen);
  React.useEffect(() => saveViewerLayout(viewer), [viewer]);
  // Re-clamp when the window shrinks or the library opens so the panes can't
  // squeeze out the board.
  React.useEffect(() => {
    const extraLeft = libraryOpen ? LIBRARY_W : 0;
    const onResize = () =>
      setViewer((v) => ({ ...v, width: clampViewerWidth(v.width, window.innerWidth, extraLeft) }));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [libraryOpen]);

  // Keep the active board valid if it gets deleted.
  const version = store.getVersion();
  React.useEffect(() => {
    if (!store.getWhiteboard(activeBoardId)) {
      const first = store.getWhiteboards()[0];
      if (first) setActiveBoardId(first.id);
    }
  }, [store, activeBoardId, version]);

  // Drop reader tabs whose article was deleted.
  React.useEffect(() => {
    setViewer((v) => {
      const readerTabs = v.readerTabs.filter((id) => store.getCard(id));
      if (readerTabs.length === v.readerTabs.length) return v;
      const activeTab = readerTabs.includes(v.activeTab) || v.activeTab === BROWSER_TAB
        ? v.activeTab
        : BROWSER_TAB;
      return { ...v, readerTabs, activeTab };
    });
  }, [store, version]);

  // Global shortcuts: Cmd/Ctrl-K for search.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdk({ open: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Dismiss menus on any outside press. Capture phase: cards stop pointer
  // propagation for their own reasons, which must not keep menus alive.
  React.useEffect(() => {
    if (!ctx && !canvasMenu && !menuOpen) return;
    const close = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest?.(".ws-ctx, .ws-menu-anchor")) return;
      setCtx(null); setCanvasMenu(null); setMenuOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [ctx, canvasMenu, menuOpen]);

  const showToast = React.useCallback((t: ToastState) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  // Highlights dragged out of the Electron browser pane land here. On the
  // canvas → place at the drop point; anywhere else (sidebar etc.) → inbox.
  React.useEffect(() => {
    const bridge = getDropBridge();
    if (!bridge) return;
    bridge.onHighlightDropped((d) => {
      // Dropping back onto the viewer pane or the divider cancels the drag.
      const under = document.elementFromPoint(d.x, d.y);
      if (under?.closest(".ws-viewer, .ws-divider")) return;
      const canvas = canvasRef.current;
      if (activeBoardId && canvas?.containsPoint(d.x, d.y)) {
        const { x, y } = canvas.screenToWorld(d.x, d.y);
        const card = applyHighlightDrop(store, d, {
          boardId: activeBoardId,
          wx: x - 130,
          wy: y - 20,
        });
        selectOne(card.id);
        showToast({ message: `Added “${card.title}”` });
      } else {
        applyHighlightDrop(store, d, null);
        showToast({ message: "Highlight saved to the Library" });
      }
    });
    return () => bridge.removeHighlightDroppedListener();
  }, [store, activeBoardId, showToast]);

  // Clipped regions arrive from main as saved PNG references; they become
  // image cards in the library (unplaced), and the library opens to show them.
  React.useEffect(() => {
    const bridge = getClipBridge();
    if (!bridge) return;
    bridge.onClipCaptured((d) => {
      let host = "";
      try { host = new URL(d.sourceUrl).hostname.replace(/^www\./, ""); } catch { /* keep empty */ }
      const card = store.createImageCard({
        title: d.title?.trim() || (host ? `Clip · ${host}` : "Clip"),
        sourceUrl: d.sourceUrl,
        image: { file: d.file, w: d.w, h: d.h },
      });
      setLibraryOpen(true);
      showToast({ message: `Clipped “${card.title}” to the library` });
    });
    bridge.onClipCancelled(() => { /* nothing to clean up — button is stateless */ });
    // Edits made in the page's post-clip form (color · tags · note) land on
    // the clip's image card, keyed by its file.
    bridge.onClipAnnotated((d) => {
      const target = store
        .getCards()
        .find((c) => c.kind === "image" && c.image.file === d.file);
      if (!target) return;
      store.updateCard(target.id, {
        ...(d.color ? { color: d.color } : {}),
        ...(d.tags ? { tags: d.tags } : {}),
        ...(d.note !== undefined ? { body: d.note } : {}),
      });
    });
  }, [store, showToast]);

  // ⌘V with an image on the clipboard drops it on the board as an image card
  // (the note editor consumes its own paste and preventDefaults first).
  React.useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || !activeBoardId) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, [contenteditable=true]")) return;
      const file = imageFileOf(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      void (async () => {
        const saved = await savePastedImage(file);
        if (!saved) { showToast({ message: "Couldn’t save the pasted image" }); return; }
        const card = store.createImageCard({
          title: "Pasted image",
          sourceUrl: "",
          image: saved,
        });
        const el = document.querySelector(".ws-canvas");
        const canvas = canvasRef.current;
        if (el && canvas) {
          const r = el.getBoundingClientRect();
          const { x, y } = canvas.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
          store.placeCard(activeBoardId, card.id, x - 130, y - 90);
          selectOne(card.id);
        }
        showToast({ message: "Image pasted" });
      })();
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBoardId]);

  const board = store.getWhiteboard(activeBoardId);

  // ---- viewer tabs ----------------------------------------------------------

  const [focusHl, setFocusHl] = React.useState<{ id: string; at: number } | null>(null);
  const [focusClip, setFocusClip] = React.useState<{ id: string; at: number } | null>(null);

  const openReaderTab = (cardId: string) => {
    // No duplicate tabs: if any open tab shows the same source (captured
    // twice, or the exact card), focus that one instead of adding another.
    const target = store.getCard(cardId);
    const sourceUrl = target && "sourceUrl" in target ? target.sourceUrl : null;
    setViewer((v) => {
      const existing = v.readerTabs.find((id) => {
        if (id === cardId) return true;
        const c = store.getCard(id);
        return Boolean(sourceUrl && c && "sourceUrl" in c && c.sourceUrl === sourceUrl);
      });
      return {
        ...v,
        open: true,
        readerTabs: existing ? v.readerTabs : [...v.readerTabs, cardId],
        activeTab: existing ?? cardId,
      };
    });
  };

  const closeReaderTab = (cardId: string) => {
    setViewer((v) => {
      const readerTabs = v.readerTabs.filter((id) => id !== cardId);
      return {
        ...v,
        readerTabs,
        activeTab: v.activeTab === cardId
          ? (readerTabs[readerTabs.length - 1] ?? BROWSER_TAB)
          : v.activeTab,
      };
    });
  };

  const readerTabInfos: ViewerTabInfo[] = viewer.readerTabs.map((id) => ({
    cardId: id,
    title: store.getCard(id)?.title || "Untitled",
    kind: store.getCard(id)?.kind,
  }));

  /** Import a copied PDF as a card (reads the page count via pdf.js). */
  const importedPdfCard = async (imp: PdfImportResult) => {
    let pages = 0;
    try {
      const { loadPdf } = await import("./reader/pdf-doc.ts");
      pages = (await loadPdf(pdfUrl(imp.file))).numPages;
    } catch { /* unreadable — keep 0; the reader will surface the error */ }
    const card = store.createPdfCard({ title: imp.name, file: imp.file, pages });
    // Parse the full text in the background so the AI has it ready.
    void import("./pdf-text-cache.ts").then(({ ensurePdfText }) => ensurePdfText(card));
    return card;
  };

  const openPdfFromDialog = async () => {
    const bridge = getPdfBridge();
    if (!bridge) return;
    const imp = await bridge.pdfOpen();
    if (!imp) return;
    const card = await importedPdfCard(imp);
    openReaderTab(card.id);
    showToast({ message: `Imported “${card.title}”` });
  };

  /** .pdf files dropped on the canvas: import, place at the drop point. */
  const dropFilesOnCanvas = async (files: File[], wx: number, wy: number) => {
    const bridge = getPdfBridge();
    if (!bridge || !activeBoardId) return;
    let offset = 0;
    for (const f of files) {
      if (!f.name.toLowerCase().endsWith(".pdf")) continue;
      const imp = await bridge.pdfImport(bridge.pathForFile(f));
      if (!imp) continue;
      const card = await importedPdfCard(imp);
      store.placeCard(activeBoardId, card.id, wx - 130 + offset, wy - 20 + offset);
      selectOne(card.id);
      offset += 28;
    }
  };

  // ---- card opening ---------------------------------------------------------

  /**
   * A jump is about to land on this card — if it sits inside a collapsed
   * group on the active board, expand the group so the landing is visible.
   */
  const expandGroupOf = (cardId: string) => {
    if (!activeBoardId) return;
    const p = store.getPlacements(activeBoardId).find((pl) => pl.cardId === cardId);
    if (!p) return;
    const g = groupOf(p, store.getGroups(activeBoardId));
    if (g?.collapsed) store.updateGroup(g.id, { collapsed: false });
  };

  /**
   * Open a card: articles get a reader tab; notes/highlights are brought onto
   * the active board (if not already there) and edited in place.
   */
  const openCard = (cardId: string, opts: { edit?: boolean } = {}) => {
    const card = store.getCard(cardId);
    if (!card) return;
    expandGroupOf(cardId);
    selectOne(cardId);
    if (card.kind === "article" || card.kind === "pdf") {
      openReaderTab(cardId);
      return;
    }
    if (activeBoardId && !store.getPlacements(activeBoardId).some((p) => p.cardId === cardId)) {
      store.placeCard(activeBoardId, cardId, 120, 120);
    }
    if (opts.edit !== false) setEditingCardId(cardId);
  };

  /**
   * A reference (embed mini-card or wikilink) was clicked — open the most
   * useful view for the card's kind: readable things go to the reader at the
   * right spot; notes and sourceless images jump to the card on the board
   * (placing it near `near` if it isn't placed yet), panning the canvas so
   * the click is never invisible.
   */
  const openReference = (cardId: string, near?: { x: number; y: number }) => {
    const card = store.getCard(cardId);
    if (!card) return;
    if (card.kind === "article" || card.kind === "pdf" || card.kind === "highlight") {
      readCard(cardId);
      return;
    }
    if (card.kind === "image" && card.sourceUrl.startsWith("pdf:") && card.clip) {
      readCard(cardId);
      return;
    }
    if (!activeBoardId) return;
    expandGroupOf(cardId);
    const placed =
      store.getPlacements(activeBoardId).find((p) => p.cardId === cardId) ??
      store.placeCard(activeBoardId, cardId, near?.x ?? 120, near?.y ?? 120);
    selectOne(cardId);
    canvasRef.current?.centerOn({ x: placed.x, y: placed.y, w: placed.w, h: placed.h });
  };

  const readCard = (cardId: string) => {
    const card = store.getCard(cardId);
    if (!card) return;
    // For a highlight, read its source article if we captured one — and
    // scroll straight to where the highlight lives.
    if (card.kind === "highlight") {
      if (card.sourceUrl.startsWith("pdf:")) {
        const pdfId = card.sourceUrl.slice(4);
        if (store.getCard(pdfId)) {
          openReaderTab(pdfId);
          setFocusHl({ id: cardId, at: Date.now() });
          return;
        }
      }
      const article = store
        .getCards()
        .find((c) => c.kind === "article" && c.sourceUrl === card.sourceUrl);
      if (article) {
        openReaderTab(article.id);
        setFocusHl({ id: cardId, at: Date.now() });
        return;
      }
    }
    // For a PDF clip, open the PDF and scroll to the clip's frame.
    if (card.kind === "image" && card.sourceUrl.startsWith("pdf:") && card.clip) {
      const pdfId = card.sourceUrl.slice(4);
      if (store.getCard(pdfId)) {
        openReaderTab(pdfId);
        setFocusClip({ id: cardId, at: Date.now() });
        return;
      }
    }
    openReaderTab(cardId);
  };

  /** Cards whose Read menu action leads somewhere useful. */
  const canRead = (cardId: string): boolean => {
    const c = store.getCard(cardId);
    if (!c) return false;
    if (c.kind === "highlight" || c.kind === "article") return true;
    return c.kind === "image" && c.sourceUrl.startsWith("pdf:") && !!c.clip;
  };

  /** A highlight hold-dragged out of the reader was released at (x, y). */
  const dropHighlightFromReader = (hlCardId: string, x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!activeBoardId || !canvas?.containsPoint(x, y)) return; // not a board drop
    const { x: wx, y: wy } = canvas.screenToWorld(x, y);
    store.placeCard(activeBoardId, hlCardId, wx - 130, wy - 20);
    selectOne(hlCardId);
    const title = store.getCard(hlCardId)?.title ?? "highlight";
    showToast({ message: `Added “${title}”` });
  };

  /** A card dragged from the sidebar inbox was dropped on the canvas. */
  const dropCardOnCanvas = (cardId: string, wx: number, wy: number) => {
    if (!activeBoardId || !store.getCard(cardId)) return;
    store.placeCard(activeBoardId, cardId, wx - 130, wy - 20);
    selectOne(cardId);
  };

  /** Nest a card into a note: append an ![[embed]] block to the host body. */
  const embedIntoCard = (
    hostCardId: string,
    childCardId: string,
    opts: { removePlacement: boolean },
  ) => {
    const host = store.getCard(hostCardId);
    const child = store.getCard(childCardId);
    if (!host || !child || host.kind !== "note") return;
    const ok = store.embedCard(hostCardId, childCardId);
    if (!ok) {
      showToast({ message: `Already embedded in “${host.title}”` });
      return;
    }
    if (opts.removePlacement) {
      const p = store.getPlacements(activeBoardId).find((pl) => pl.cardId === childCardId);
      if (p) store.removePlacement(p.id);
      setSelectedCardIds((ids) => ids.filter((id) => id !== childCardId));
    }
    showToast({
      message: `Embedded “${child.title}” in “${host.title}”`,
      actionLabel: "Undo",
      onAction: () => {
        store.updateCard(hostCardId, { body: host.body });
        if (opts.removePlacement) {
          const prev = store
            .snapshot()
            .placements.find((pl) => pl.cardId === childCardId && pl.whiteboardId === activeBoardId);
          if (!prev) store.placeCard(activeBoardId, childCardId, 120, 120);
        }
        setToast(null);
      },
    });
  };

  // Create a note at a canvas position (from double-click or the canvas menu).
  const newNoteAt = (wx: number, wy: number, color?: HighlightColor) => {
    if (!activeBoardId) return;
    const { card } = store.createNoteOnBoard(activeBoardId, wx - 130, wy - 20, {
      title: "Untitled",
      ...(color ? { color } : {}),
    });
    openCard(card.id);
  };

  const deleteCard = (cardId: string) => {
    const card = store.getCard(cardId);
    if (card?.kind === "pdf") void getPdfBridge()?.pdfDelete(card.file);
    const snapshotPlacements = store
      .snapshot()
      .placements.filter((p) => p.cardId === cardId);
    store.deleteCard(cardId);
    setSelectedCardIds((ids) => ids.filter((id) => id !== cardId));
    if (editingCardId === cardId) setEditingCardId(null);
    showToast({
      message: `Deleted “${card?.title || "card"}”`,
      actionLabel: "Undo",
      onAction: () => {
        store.restoreCard(cardId);
        for (const p of snapshotPlacements) {
          store.placeCard(p.whiteboardId, p.cardId, p.x, p.y, p.w, p.h);
        }
        setToast(null);
      },
    });
  };

  const removeFromBoard = (cardId: string) => {
    const p = store.getPlacements(activeBoardId).find((pl) => pl.cardId === cardId);
    if (!p) return;
    store.removePlacement(p.id);
    setSelectedCardIds((ids) => ids.filter((id) => id !== cardId));
    showToast({
      message: "Removed from board — still in the Library",
      actionLabel: "Undo",
      onAction: () => { store.placeCard(p.whiteboardId, cardId, p.x, p.y, p.w, p.h); setToast(null); },
    });
  };

  return (
    <div
      className="ws-root"
      style={{
        gridTemplateColumns: [
          viewer.sidebarOpen ? `${SIDEBAR_W}px` : "",
          libraryOpen ? `${LIBRARY_W}px` : "",
          "minmax(0, 1fr)",
          viewerOpen ? `${DIVIDER_W}px ${viewer.width}px` : "",
        ].filter(Boolean).join(" "),
      }}
    >
      {viewer.sidebarOpen && (
        <Sidebar
          activeBoardId={activeBoardId}
          onSelectBoard={(id) => { setActiveBoardId(id); selectOne(null); }}
          onOpenCard={openCard}
          onOpenSearch={(seed) => setCmdk({ open: true, seed })}
          libraryOpen={libraryOpen}
          onToggleLibrary={() => setLibraryOpen((o) => !o)}
        />
      )}

      {libraryOpen && (
        <LibraryPanel onOpenCard={openCard} onClose={() => setLibraryOpen(false)} />
      )}

      <main className="ws-main">
        <header className="ws-topbar">
          <button
            className="ws-icon-btn"
            title={viewer.sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            aria-pressed={viewer.sidebarOpen}
            onClick={() => setViewer((v) => ({ ...v, sidebarOpen: !v.sidebarOpen }))}
          ><PanelLeft size={17} strokeWidth={2} aria-hidden /></button>
          <div className="ws-topbar-heading">
            <h2 className="ws-board-title">{board?.name ?? "octobase"}</h2>
            {board && (
              <span className="ws-board-sub">
                {store.getPlacements(board.id).length} cards
              </span>
            )}
          </div>
          <div className="ws-topbar-spacer" />
          <button
            className="ws-icon-btn"
            title="Zoom to fit"
            onClick={() => canvasRef.current?.zoomToFit()}
          ><Focus size={17} strokeWidth={2} aria-hidden /></button>
          <button
            className={`ws-icon-btn${tocOpen ? " active" : ""}`}
            title={tocOpen ? "Hide table of contents" : "Table of contents"}
            aria-pressed={tocOpen}
            onClick={() => setTocOpen((o) => !o)}
          ><ListTree size={17} strokeWidth={2} aria-hidden /></button>
          <button
            className={`ws-icon-btn${viewerOpen ? " active" : ""}`}
            title={viewerOpen ? "Hide viewer pane" : "Show viewer pane"}
            aria-pressed={viewerOpen}
            onClick={() => setViewer((v) => ({ ...v, open: !viewerOpen }))}
          ><PanelRight size={17} strokeWidth={2} aria-hidden /></button>
          <div className="ws-menu-anchor" onPointerDown={(e) => e.stopPropagation()}>
            <button
              className={`ws-icon-btn${menuOpen ? " active" : ""}`}
              title="More"
              onClick={() => setMenuOpen((o) => !o)}
            ><MoreHorizontal size={17} strokeWidth={2} aria-hidden /></button>
            {menuOpen && (
              <div className="ws-dd" role="menu">
                <div className="ws-dd-item" role="menuitem"
                  onClick={() => { setMenuOpen(false); setCmdk({ open: true }); }}>
                  <span className="ws-dd-ico"><Search size={15} strokeWidth={2} aria-hidden /></span> Search everything
                  <span className="ws-dd-kbd">⌘K</span>
                </div>
                {getPdfBridge() && (
                  <div className="ws-dd-item" role="menuitem"
                    onClick={() => { setMenuOpen(false); void openPdfFromDialog(); }}>
                    <span className="ws-dd-ico"><FileText size={15} strokeWidth={2} aria-hidden /></span> Open PDF…
                  </div>
                )}
                {getAiBridge() && (
                  <div className="ws-dd-item" role="menuitem"
                    onClick={() => { setMenuOpen(false); setAiSettingsOpen(true); }}>
                    <span className="ws-dd-ico"><Sparkles size={15} strokeWidth={2} aria-hidden /></span> AI settings
                  </div>
                )}
                {captureBridge && (
                  <>
                    <div className="ws-dd-sep" />
                    <div className="ws-dd-item" role="menuitem"
                      onClick={async () => { setMenuOpen(false); setConnectInfo(await captureBridge.getInfo()); }}>
                      <span className="ws-dd-ico"><Plug size={15} strokeWidth={2} aria-hidden /></span> Connect extension
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </header>

        {activeBoardId && (
          <Canvas
            key={activeBoardId}
            ref={canvasRef}
            boardId={activeBoardId}
            selectedCardIds={selectedCardIds}
            editingCardId={editingCardId}
            onEndEdit={() => setEditingCardId(null)}
            onSelect={(id) => {
              selectOne(id);
              if (editingCardId && id !== editingCardId) setEditingCardId(null);
            }}
            onSelectMany={(ids) => {
              setSelectedCardIds(ids);
              if (editingCardId) setEditingCardId(null);
            }}
            onOpen={openCard}
            onOpenRef={openReference}
            onDropCard={dropCardOnCanvas}
            onDropFiles={(files, wx, wy) => void dropFilesOnCanvas(files, wx, wy)}
            onContextMenu={(cardId, x, y) => { setCanvasMenu(null); setCtx({ cardId, x, y }); }}
            onBackgroundContextMenu={(wx, wy, x, y) => { setCtx(null); setCanvasMenu({ wx, wy, x, y }); }}
            onEmbed={embedIntoCard}
          />
        )}

        {tocOpen && activeBoardId && (
          <TocPanel
            boardId={activeBoardId}
            onClose={() => setTocOpen(false)}
            onJump={(cardId) => {
              const p = store
                .getPlacements(activeBoardId)
                .find((pl) => pl.cardId === cardId);
              if (!p) return;
              expandGroupOf(cardId);
              canvasRef.current?.centerOn(p);
              selectOne(cardId);
            }}
          />
        )}

      </main>

      {viewerOpen && (
        <>
          <div
            className={`ws-divider${dividerDrag ? " dragging" : ""}`}
            title="Drag to resize · double-click for 50/50"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              setDividerDrag(true);
            }}
            onPointerMove={(e) => {
              if (!dividerDrag) return;
              const width = clampViewerWidth(
                window.innerWidth - e.clientX,
                window.innerWidth,
                libraryOpen ? LIBRARY_W : 0,
              );
              setViewer((v) => ({ ...v, width }));
            }}
            onPointerUp={(e) => {
              try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
              setDividerDrag(false);
            }}
            onDoubleClick={() =>
              setViewer((v) => ({ ...v, width: halfViewerWidth(window.innerWidth) }))
            }
          />
          <ViewerHost
            readerTabs={readerTabInfos}
            activeTab={viewer.activeTab}
            onSelectTab={(id) => setViewer((v) => ({ ...v, activeTab: id }))}
            onCloseTab={closeReaderTab}
            onClose={() => setViewer((v) => ({ ...v, open: false }))}
            onOpenCard={(id) => openReference(id)}
            focusHighlight={focusHl}
            focusClip={focusClip}
            onDropHighlight={dropHighlightFromReader}
            openChatNonce={chatNonce}
            onOpenAiSettings={() => setAiSettingsOpen(true)}
            suspended={dividerDrag || overlayUp}
          />
        </>
      )}

      {cmdk.open && (
        <CommandPalette
          seed={cmdk.seed}
          onClose={() => setCmdk({ open: false })}
          onPick={(card) => {
            setCmdk({ open: false });
            openCard(card.id);
          }}
        />
      )}

      {ctx && (
        <div
          className="ws-ctx"
          style={{ left: ctx.x, top: ctx.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {canRead(ctx.cardId) && (
            <div className="ws-ctx-item" onClick={() => { readCard(ctx.cardId); setCtx(null); }}>
              <span className="ws-ctx-ico"><BookOpen size={13} strokeWidth={2} aria-hidden /></span> Read
            </div>
          )}
          {canRead(ctx.cardId) && getAiBridge() && (
            <div className="ws-ctx-item" onClick={() => {
              readCard(ctx.cardId);
              setChatNonce({ at: Date.now() });
              setCtx(null);
            }}>
              <span className="ws-ctx-ico"><Sparkles size={13} strokeWidth={2} aria-hidden /></span> Ask AI
            </div>
          )}
          <div className="ws-ctx-item" onClick={() => { removeFromBoard(ctx.cardId); setCtx(null); }}>
            <span className="ws-ctx-ico"><CornerUpLeft size={13} strokeWidth={2} aria-hidden /></span> Remove from board
          </div>
          <div className="ws-ctx-sep" />
          <div className="ws-ctx-item danger" onClick={() => { deleteCard(ctx.cardId); setCtx(null); }}>
            <span className="ws-ctx-ico"><Trash2 size={13} strokeWidth={2} aria-hidden /></span> Delete card
          </div>
        </div>
      )}

      {canvasMenu && (
        <div
          className="ws-ctx"
          style={{ left: canvasMenu.x, top: canvasMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="ws-ctx-label">New card</div>
          <div className="ws-ctx-item" onClick={() => { newNoteAt(canvasMenu.wx, canvasMenu.wy); setCanvasMenu(null); }}>
            <span className="ws-ctx-ico"><Plus size={13} strokeWidth={2} aria-hidden /></span> Blank note
          </div>
          <div className="ws-ctx-colors">
            {HIGHLIGHT_COLORS.map((c) => (
              <span
                key={c}
                className="ws-ctx-dot"
                title={`New ${c} note`}
                style={{ background: PALETTE[c].underline }}
                onClick={() => { newNoteAt(canvasMenu.wx, canvasMenu.wy, c); setCanvasMenu(null); }}
              />
            ))}
          </div>
        </div>
      )}

      {aiSettingsOpen && <AiSettings onClose={() => setAiSettingsOpen(false)} />}

      {connectInfo && (
        <div className="ws-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setConnectInfo(null); }}>
          <div className="ws-editor" style={{ width: "min(440px, 92vw)" }}>
            <div className="ws-editor-accent" style={{ background: "var(--ws-accent)" }} />
            <div className="ws-editor-titlebar">
              <div className="ws-editor-title-input" style={{ fontSize: 22 }}>Connect the capture extension</div>
            </div>
            <div className="ws-editor-scroll" style={{ fontSize: 14, lineHeight: 1.6 }}>
              <p style={{ marginTop: 0 }}>Load the unpacked extension from <code>dist-extension/</code>, open its
              popup → <em>Connection settings</em>, and paste:</p>
              <label className="ws-insp-label">Port</label>
              <input readOnly value={connectInfo.port} className="ws-tagedit"
                style={{ width: "100%", padding: 8, border: "1px solid var(--ws-line)", borderRadius: 8, fontFamily: "var(--ws-font-mono)" }} />
              <label className="ws-insp-label">Pairing token</label>
              <input readOnly value={connectInfo.token} onFocus={(e) => e.target.select()}
                style={{ width: "100%", padding: 8, border: "1px solid var(--ws-line)", borderRadius: 8, fontFamily: "var(--ws-font-mono)", fontSize: 12 }} />
            </div>
            <div className="ws-editor-foot" style={{ justifyContent: "flex-end" }}>
              <button className="ws-btn primary" onClick={() => setConnectInfo(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="ws-toast">
          <span>{toast.message}</span>
          {toast.actionLabel && <button onClick={toast.onAction}>{toast.actionLabel}</button>}
        </div>
      )}
    </div>
  );
}

export default function Workspace(): React.ReactElement {
  return (
    <WorkspaceProvider>
      <WorkspaceInner />
    </WorkspaceProvider>
  );
}
