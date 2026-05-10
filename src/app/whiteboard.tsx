import { Box, Paper, Typography, Chip } from '@mui/material';
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

function CardView({ card, onMove }: { card: Card; onMove: (id: string, x: number, y: number) => void; onDelete: (id: string) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef(false);
  const offset = React.useRef({ x: 0, y: 0 });

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
        cursor: 'grab', userSelect: 'none', overflow: 'hidden',
        '&:active': { cursor: 'grabbing' },
        display: 'flex', flexDirection: 'column', gap: 0.75,
        backgroundColor: palette.fill,
        borderBottom: `4px solid ${palette.underline}`,
        transition: 'box-shadow 0.2s',
        '&:hover': { boxShadow: '0 6px 20px rgba(0,0,0,0.18)' },
      }}
    >
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
      {card.notes && (
        <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'rgba(0,0,0,0.7)', whiteSpace: 'pre-wrap', maxHeight: 72, overflow: 'hidden' }}>
          {card.notes}
        </Typography>
      )}
      {hostname && (
        <Chip label={hostname} size="small" variant="outlined" sx={{ fontSize: '0.6rem', maxWidth: 180, alignSelf: 'flex-start', mt: 'auto', bgcolor: 'rgba(255,255,255,0.5)' }} />
      )}
    </Paper>
  );
}

export default function Whiteboard(): React.ReactElement {
  const [cards, setCards] = React.useState<Card[]>([]);

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
    setCards(prev => prev.filter(c => c.id !== id));
    await getElectronAPI()?.deleteCard?.(id);
  }, []);

  return (
    <Box sx={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      {cards.map(c => <CardView key={c.id} card={c} onMove={handleMove} onDelete={handleDelete} />)}
    </Box>
  );
}
