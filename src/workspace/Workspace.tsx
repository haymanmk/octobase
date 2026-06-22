import * as React from "react";
import "./workspace.css";
import { WorkspaceProvider } from "./WorkspaceProvider.tsx";
import { useWorkspace } from "./store-context.ts";
import { Sidebar } from "./Sidebar.tsx";
import { Canvas } from "./Canvas.tsx";
import { Inspector } from "./Inspector.tsx";
import { CardEditor } from "./CardEditor.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { Reader } from "./reader/Reader.tsx";

interface ContextMenuState {
  cardId: string;
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
  const [selectedCardId, setSelectedCardId] = React.useState<string | null>(null);
  const [editingCardId, setEditingCardId] = React.useState<string | null>(null);
  const [readingCardId, setReadingCardId] = React.useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = React.useState(true);
  const [cmdk, setCmdk] = React.useState<{ open: boolean; seed?: string }>({ open: false });
  const [ctx, setCtx] = React.useState<ContextMenuState | null>(null);
  const [toast, setToast] = React.useState<ToastState | null>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the active board valid if it gets deleted.
  const version = store.getVersion();
  React.useEffect(() => {
    if (!store.getWhiteboard(activeBoardId)) {
      const first = store.getWhiteboards()[0];
      if (first) setActiveBoardId(first.id);
    }
  }, [store, activeBoardId, version]);

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

  // Dismiss the context menu on any outside click.
  React.useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [ctx]);

  const showToast = React.useCallback((t: ToastState) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const board = store.getWhiteboard(activeBoardId);

  const openCard = (cardId: string) => {
    setSelectedCardId(cardId);
    // Article cards open in the reader; everything else in the editor.
    if (store.getCard(cardId)?.kind === "article") {
      setReadingCardId(cardId);
    } else {
      setEditingCardId(cardId);
    }
  };

  const readCard = (cardId: string) => {
    const card = store.getCard(cardId);
    if (!card) return;
    // For a highlight, read its source article if we captured one.
    if (card.kind === "highlight") {
      const article = store
        .getCards()
        .find((c) => c.kind === "article" && c.sourceUrl === card.sourceUrl);
      if (article) {
        setReadingCardId(article.id);
        return;
      }
    }
    setReadingCardId(cardId);
  };

  const newCardOnBoard = () => {
    if (!activeBoardId) return;
    const offset = store.getPlacements(activeBoardId).length * 24;
    const { card } = store.createNoteOnBoard(activeBoardId, 80 + (offset % 240), 90 + (offset % 180), {
      title: "Untitled",
    });
    openCard(card.id);
  };

  const deleteCard = (cardId: string) => {
    const card = store.getCard(cardId);
    const snapshotPlacements = store
      .snapshot()
      .placements.filter((p) => p.cardId === cardId);
    store.deleteCard(cardId);
    if (selectedCardId === cardId) setSelectedCardId(null);
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
    if (selectedCardId === cardId) setSelectedCardId(null);
    showToast({
      message: "Moved to inbox",
      actionLabel: "Undo",
      onAction: () => { store.placeCard(p.whiteboardId, cardId, p.x, p.y, p.w, p.h); setToast(null); },
    });
  };

  const createLinkedCard = (title: string) => {
    if (!activeBoardId) return;
    const { card } = store.createNoteOnBoard(activeBoardId, 120, 120, { title });
    openCard(card.id);
  };

  const editingCard = editingCardId ? store.getCard(editingCardId) : null;

  return (
    <div className="ws-root">
      <Sidebar
        activeBoardId={activeBoardId}
        onSelectBoard={(id) => { setActiveBoardId(id); setSelectedCardId(null); }}
        onOpenCard={openCard}
        onOpenSearch={(seed) => setCmdk({ open: true, seed })}
      />

      <main className="ws-main">
        <header className="ws-topbar">
          <h2 className="ws-board-title">{board?.name ?? "octobase"}</h2>
          {board && (
            <span className="ws-board-sub">
              {store.getPlacements(board.id).length} cards
            </span>
          )}
          <div className="ws-topbar-spacer" />
          <button
            className={`ws-btn ghost`}
            onClick={() => setInspectorOpen((o) => !o)}
            title="Toggle inspector"
          >
            {inspectorOpen ? "Hide panel" : "Show panel"}
          </button>
          <button className="ws-btn" onClick={() => setCmdk({ open: true })}>⌕ Search</button>
          <button className="ws-btn primary" onClick={newCardOnBoard}>+ New card</button>
        </header>

        {activeBoardId && (
          <Canvas
            key={activeBoardId}
            boardId={activeBoardId}
            selectedCardId={selectedCardId}
            onSelect={setSelectedCardId}
            onOpen={openCard}
            onContextMenu={(cardId, x, y) => setCtx({ cardId, x, y })}
          />
        )}

        {inspectorOpen && selectedCardId && !editingCardId && (
          <Inspector
            cardId={selectedCardId}
            onClose={() => setInspectorOpen(false)}
            onOpenCard={(id) => { setSelectedCardId(id); }}
            onCreateLink={createLinkedCard}
          />
        )}
      </main>

      {editingCard && (
        <CardEditor
          key={editingCard.id}
          card={editingCard}
          onChange={(patch) => store.updateCard(editingCard.id, patch)}
          onClose={() => setEditingCardId(null)}
          onDelete={() => deleteCard(editingCard.id)}
        />
      )}

      {readingCardId && (
        <Reader
          cardId={readingCardId}
          onClose={() => setReadingCardId(null)}
          onOpenCard={(id) => {
            // Reader stays open; clicking a highlight selects/edits its card.
            const c = store.getCard(id);
            if (c && c.kind !== "article") {
              setSelectedCardId(id);
              setEditingCardId(id);
            } else {
              setReadingCardId(id);
            }
          }}
        />
      )}

      {cmdk.open && (
        <CommandPalette
          seed={cmdk.seed}
          onClose={() => setCmdk({ open: false })}
          onPick={(card) => {
            setCmdk({ open: false });
            // Ensure the card is on the current board so it is visible, then open.
            if (activeBoardId && !store.getPlacements(activeBoardId).some((p) => p.cardId === card.id)) {
              store.placeCard(activeBoardId, card.id, 120, 120);
            }
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
            <div className="ws-ctx-item" onClick={() => { readCard(ctx.cardId); setCtx(null); }}>📖 Read</div>
          )}
          <div className="ws-ctx-item" onClick={() => { setSelectedCardId(ctx.cardId); setEditingCardId(ctx.cardId); setCtx(null); }}>✎ Edit</div>
          <div className="ws-ctx-item" onClick={() => { removeFromBoard(ctx.cardId); setCtx(null); }}>⇤ Move to inbox</div>
          <div className="ws-ctx-sep" />
          <div className="ws-ctx-item danger" onClick={() => { deleteCard(ctx.cardId); setCtx(null); }}>🗑 Delete card</div>
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
