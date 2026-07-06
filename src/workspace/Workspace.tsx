import * as React from "react";
import "./workspace.css";
import { WorkspaceProvider } from "./WorkspaceProvider.tsx";
import { useWorkspace } from "./store-context.ts";
import { Sidebar } from "./Sidebar.tsx";
import { Canvas, type CanvasHandle } from "./Canvas.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { getCaptureBridge, getDropBridge, getViewerBridge, type ExtensionInfo } from "./electron-bridge.ts";
import { applyHighlightDrop } from "./drop-highlight.ts";
import { ViewerHost, type ViewerTabInfo } from "./ViewerHost.tsx";
import {
  SIDEBAR_W,
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
  const viewerOpen = viewer.open && (viewerAvailable || viewer.readerTabs.length > 0);
  // The native browser view always paints above our DOM, so it must yield
  // whenever a full-window overlay is up (⌘K palette, extension dialog) or
  // the divider is mid-drag. Reading and editing are panes now — not overlays.
  const overlayUp = Boolean(cmdk.open || connectInfo);
  React.useEffect(() => saveViewerLayout(viewer), [viewer]);
  // Re-clamp when the window shrinks so the pane can't squeeze out the board.
  React.useEffect(() => {
    const onResize = () =>
      setViewer((v) => ({ ...v, width: clampViewerWidth(v.width, window.innerWidth) }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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
        showToast({ message: "Highlight saved to inbox" });
      }
    });
    return () => bridge.removeHighlightDroppedListener();
  }, [store, activeBoardId, showToast]);

  const board = store.getWhiteboard(activeBoardId);

  // ---- viewer tabs ----------------------------------------------------------

  const [focusHl, setFocusHl] = React.useState<{ id: string; at: number } | null>(null);

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
  }));

  // ---- card opening ---------------------------------------------------------

  /**
   * Open a card: articles get a reader tab; notes/highlights are brought onto
   * the active board (if not already there) and edited in place.
   */
  const openCard = (cardId: string, opts: { edit?: boolean } = {}) => {
    const card = store.getCard(cardId);
    if (!card) return;
    selectOne(cardId);
    if (card.kind === "article") {
      openReaderTab(cardId);
      return;
    }
    if (activeBoardId && !store.getPlacements(activeBoardId).some((p) => p.cardId === cardId)) {
      store.placeCard(activeBoardId, cardId, 120, 120);
    }
    if (opts.edit !== false) setEditingCardId(cardId);
  };

  const readCard = (cardId: string) => {
    const card = store.getCard(cardId);
    if (!card) return;
    // For a highlight, read its source article if we captured one — and
    // scroll straight to where the highlight lives.
    if (card.kind === "highlight") {
      const article = store
        .getCards()
        .find((c) => c.kind === "article" && c.sourceUrl === card.sourceUrl);
      if (article) {
        openReaderTab(article.id);
        setFocusHl({ id: cardId, at: Date.now() });
        return;
      }
    }
    openReaderTab(cardId);
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
      message: "Moved to inbox",
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
        />
      )}

      <main className="ws-main">
        <header className="ws-topbar">
          <button
            className="ws-icon-btn"
            title={viewer.sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            aria-pressed={viewer.sidebarOpen}
            onClick={() => setViewer((v) => ({ ...v, sidebarOpen: !v.sidebarOpen }))}
          >▦</button>
          <h2 className="ws-board-title">{board?.name ?? "octobase"}</h2>
          {board && (
            <span className="ws-board-sub">
              {store.getPlacements(board.id).length} cards
            </span>
          )}
          <div className="ws-topbar-spacer" />
          <button
            className="ws-icon-btn"
            title="Zoom to fit"
            onClick={() => canvasRef.current?.zoomToFit()}
          >⌖</button>
          <button
            className={`ws-icon-btn${viewerOpen ? " active" : ""}`}
            title={viewerOpen ? "Hide viewer pane" : "Show viewer pane"}
            aria-pressed={viewerOpen}
            onClick={() => setViewer((v) => ({ ...v, open: !viewerOpen }))}
          >◫</button>
          <div className="ws-menu-anchor" onPointerDown={(e) => e.stopPropagation()}>
            <button
              className={`ws-icon-btn${menuOpen ? " active" : ""}`}
              title="More"
              onClick={() => setMenuOpen((o) => !o)}
            >⋯</button>
            {menuOpen && (
              <div className="ws-dd" role="menu">
                <div className="ws-dd-item" role="menuitem"
                  onClick={() => { setMenuOpen(false); setCmdk({ open: true }); }}>
                  <span className="ws-dd-ico">🔍</span> Search everything
                  <span className="ws-dd-kbd">⌘K</span>
                </div>
                {captureBridge && (
                  <>
                    <div className="ws-dd-sep" />
                    <div className="ws-dd-item" role="menuitem"
                      onClick={async () => { setMenuOpen(false); setConnectInfo(await captureBridge.getInfo()); }}>
                      <span className="ws-dd-ico">🔌</span> Connect extension
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
            onDropCard={dropCardOnCanvas}
            onContextMenu={(cardId, x, y) => { setCanvasMenu(null); setCtx({ cardId, x, y }); }}
            onBackgroundContextMenu={(wx, wy, x, y) => { setCtx(null); setCanvasMenu({ wx, wy, x, y }); }}
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
              const width = clampViewerWidth(window.innerWidth - e.clientX, window.innerWidth);
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
            onOpenCard={(id) => openCard(id, { edit: false })}
            focusHighlight={focusHl}
            onDropHighlight={dropHighlightFromReader}
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
          {store.getCard(ctx.cardId)?.kind !== "note" && (
            <div className="ws-ctx-item" onClick={() => { readCard(ctx.cardId); setCtx(null); }}>
              <span className="ws-ctx-ico">📖</span> Read
            </div>
          )}
          <div className="ws-ctx-item" onClick={() => { removeFromBoard(ctx.cardId); setCtx(null); }}>
            <span className="ws-ctx-ico">⇤</span> Move to inbox
          </div>
          <div className="ws-ctx-sep" />
          <div className="ws-ctx-item danger" onClick={() => { deleteCard(ctx.cardId); setCtx(null); }}>
            <span className="ws-ctx-ico">🗑</span> Delete card
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
            <span className="ws-ctx-ico">＋</span> Blank note
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
