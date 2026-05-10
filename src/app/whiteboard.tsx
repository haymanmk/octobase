import { Box, Paper, Typography, Chip, TextField, Snackbar, Button } from '@mui/material';
import * as React from 'react';
import { PALETTE } from '../components/highlighter/colors';
import type { Card } from '../types/highlight';

interface WhiteboardElectronAPI {
  loadCards?: () => Promise<Card[]>;
  saveCard?: (card: Card) => Promise<{ ok: true }>;
  deleteCard?: (id: string) => Promise<{ ok: true }>;
  onCardUpdated?: (cb: (c: Card) => void) => void;
  onCardDeleted?: (cb: (data: { id: string }) => void) => void;
  onHighlightDropped?: (cb: (data: { text: string; sourceUrl: string; x: number; y: number; highlightId: string }) => void) => void;
}

function getElectronAPI(): WhiteboardElectronAPI | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI;
}

function CardView({ card, onMove, onDelete, onUpdate }: {
  card: Card;
  onMove: (id: string, x: number, y: number) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Pick<Card, 'notes'>>) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef(false);
  const offset = React.useRef({ x: 0, y: 0 });
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [notesExpanded, setNotesExpanded] = React.useState(false);
  const [editingNotes, setEditingNotes] = React.useState(false);
  const [notesDraft, setNotesDraft] = React.useState(card.notes);

  React.useEffect(() => {
    if (editingNotes) setNotesDraft(card.notes);
  }, [editingNotes, card.notes]);

  const commitNotes = () => {
    if (notesDraft !== card.notes) onUpdate(card.id, { notes: notesDraft });
    setEditingNotes(false);
  };
  const cancelNotes = () => {
    setNotesDraft(card.notes);
    setEditingNotes(false);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    offset.current = { x: e.clientX - card.x, y: e.clientY - card.y };
    ref.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    onMove(card.id, e.clientX - offset.current.x, e.clientY - offset.current.y);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragging.current = false;
    ref.current?.releasePointerCapture(e.pointerId);
  };

  // Close the menu when the user clicks anywhere outside the menu and the
  // button that toggles it.
  React.useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [menuOpen]);

  let hostname = '';
  try { hostname = new URL(card.sourceUrl).hostname; } catch { hostname = card.sourceUrl; }

  const palette = PALETTE[card.color] ?? PALETTE.yellow;

  return (
    <Paper
      ref={ref}
      elevation={3}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      sx={{
        position: 'absolute',
        left: card.x, top: card.y,
        transform: 'translate(-50%, -50%)',
        width: 240, maxHeight: 260, p: 1.5,
        borderRadius: 2,
        cursor: 'grab', userSelect: 'none',
        // No overflow:hidden — the menu popup is positioned absolute inside
        // the Paper, and on short cards it must extend past the bottom of
        // the card without being clipped. Child text/notes have their own
        // overflow rules.
        '&:active': { cursor: 'grabbing' },
        display: 'flex', flexDirection: 'column', gap: 0.75,
        backgroundColor: palette.fill,
        borderBottom: `4px solid ${palette.underline}`,
        transition: 'box-shadow 0.2s',
        '&:hover': { boxShadow: '0 6px 20px rgba(0,0,0,0.18)' },
        '&:hover .card-menu-btn': { opacity: 1 },
      }}
    >
      <Box
        ref={buttonRef}
        className="card-menu-btn"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
        sx={{
          position: 'absolute',
          top: 4, right: 4,
          width: 22, height: 22,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.9)',
          border: '1px solid rgba(0,0,0,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, lineHeight: 1, color: 'rgba(0,0,0,0.6)',
          cursor: 'pointer',
          opacity: menuOpen ? 1 : 0,
          transition: 'opacity 0.15s',
          boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
          '&:hover': { color: 'rgba(0,0,0,0.9)' },
        }}
      >⋯</Box>
      {menuOpen && (
        <Box
          ref={menuRef}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          sx={{
            position: 'absolute',
            top: 30, right: 4,
            background: 'white',
            border: '1px solid #e5e5e5',
            borderRadius: 1,
            boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
            py: 0.5,
            minWidth: 110,
            zIndex: 10,
          }}
        >
          <Box
            onClick={() => { setMenuOpen(false); setEditingNotes(true); setNotesExpanded(true); }}
            sx={{
              px: 1.5, py: 0.75,
              fontSize: '0.8rem',
              cursor: 'pointer',
              '&:hover': { background: 'rgba(0,0,0,0.05)' },
            }}
          >Edit notes</Box>
          <Box
            onClick={() => { setMenuOpen(false); onDelete(card.id); }}
            sx={{
              px: 1.5, py: 0.75,
              fontSize: '0.8rem',
              color: '#ef4444',
              cursor: 'pointer',
              '&:hover': { background: 'rgba(239,68,68,0.08)' },
            }}
          >Delete</Box>
        </Box>
      )}
      <Typography
        variant="body2"
        sx={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', lineHeight: 1.5, fontSize: '0.8rem' }}
      >{card.text}</Typography>
      {card.tags?.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {card.tags.map(t => (
            <Chip key={t} label={t} size="small" sx={{ fontSize: '0.6rem', height: 18, bgcolor: 'rgba(255,255,255,0.6)' }} />
          ))}
        </Box>
      )}
      {editingNotes ? (
        <TextField
          autoFocus
          multiline
          minRows={2}
          maxRows={6}
          placeholder="Notes…"
          value={notesDraft}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={commitNotes}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); cancelNotes(); }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitNotes(); }
          }}
          variant="outlined"
          size="small"
          sx={{
            '& .MuiInputBase-root': {
              fontSize: '0.7rem',
              padding: 0.75,
              background: 'rgba(255,255,255,0.6)',
            },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(0,0,0,0.12)' },
          }}
        />
      ) : card.notes ? (
        <Typography
          variant="caption"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setNotesExpanded((p) => !p); }}
          title={notesExpanded ? 'Click to collapse' : 'Click to expand'}
          sx={{
            fontSize: '0.7rem',
            color: 'rgba(0,0,0,0.7)',
            cursor: 'pointer',
            ...(notesExpanded
              ? { whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }
              : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }
            ),
          }}
        >
          {card.notes}
        </Typography>
      ) : null}
      {hostname && (
        <Chip label={hostname} size="small" variant="outlined" sx={{ fontSize: '0.6rem', maxWidth: 180, alignSelf: 'flex-start', mt: 'auto', bgcolor: 'rgba(255,255,255,0.5)' }} />
      )}
    </Paper>
  );
}

export default function Whiteboard(): React.ReactElement {
  const [cards, setCards] = React.useState<Card[]>([]);
  const [pendingDelete, setPendingDelete] = React.useState<Card | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const initial = (await getElectronAPI()?.loadCards?.()) ?? [];
      if (!cancelled) setCards(initial);
    })();
    getElectronAPI()?.onCardUpdated?.((c: Card) => {
      setCards(prev => {
        const idx = prev.findIndex(x => x.id === c.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = c;
          return next;
        }
        return [...prev, c];
      });
    });
    getElectronAPI()?.onCardDeleted?.(({ id }) => {
      setCards(prev => prev.filter(c => c.id !== id));
    });
    return () => { cancelled = true; };
  }, []);

  const handleMove = React.useCallback(async (id: string, x: number, y: number) => {
    setCards(prev => {
      const next = prev.map(c => c.id === id ? { ...c, x, y, updatedAt: Date.now() } : c);
      const moved = next.find(c => c.id === id);
      if (moved) getElectronAPI()?.saveCard?.(moved);
      return next;
    });
  }, []);

  const handleDelete = React.useCallback(async (id: string) => {
    let removed: Card | undefined;
    setCards(prev => {
      removed = prev.find(c => c.id === id);
      return prev.filter(c => c.id !== id);
    });
    if (removed) setPendingDelete(removed);
    await getElectronAPI()?.deleteCard?.(id);
  }, []);

  const handleUndoDelete = React.useCallback(async () => {
    const restoring = pendingDelete;
    if (!restoring) return;
    setPendingDelete(null);
    const refreshed: Card = { ...restoring, updatedAt: Date.now() };
    // saveCard's broadcast (card:updated) re-adds the card to state via the
    // onCardUpdated listener; no need to setCards here.
    await getElectronAPI()?.saveCard?.(refreshed);
  }, [pendingDelete]);

  const handleUpdate = React.useCallback(async (id: string, patch: Partial<Pick<Card, 'notes'>>) => {
    let updated: Card | undefined;
    setCards(prev => {
      const next = prev.map(c => {
        if (c.id !== id) return c;
        const merged = { ...c, ...patch, updatedAt: Date.now() };
        updated = merged;
        return merged;
      });
      return next;
    });
    if (updated) await getElectronAPI()?.saveCard?.(updated);
  }, []);

  return (
    <Box sx={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      {cards.map(c => <CardView key={c.id} card={c} onMove={handleMove} onDelete={handleDelete} onUpdate={handleUpdate} />)}
      <Snackbar
        open={!!pendingDelete}
        autoHideDuration={5000}
        onClose={(_e, reason) => {
          if (reason === 'clickaway') return;
          setPendingDelete(null);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message="Card deleted"
        action={
          <Button color="inherit" size="small" onClick={handleUndoDelete} sx={{ textDecoration: 'underline', textTransform: 'none' }}>
            Undo
          </Button>
        }
      />
    </Box>
  );
}
