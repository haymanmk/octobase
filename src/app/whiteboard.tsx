import { Box, Paper, Typography, Chip } from '@mui/material';
import * as React from 'react';

interface CardData {
  id: string;
  text: string;
  sourceUrl: string;
  x: number;
  y: number;
}

interface WhiteboardElectronAPI {
  onHighlightDropped?: (callback: (data: { text: string; sourceUrl: string; x: number; y: number; highlightId: string }) => void) => void;
  removeHighlightDroppedListener?: () => void;
}

function getElectronAPI(): WhiteboardElectronAPI | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electronAPI;
}

function WhiteboardCard({ card, onMove }: { card: CardData; onMove: (id: string, x: number, y: number) => void }) {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef(false);
  const offset = React.useRef({ x: 0, y: 0 });

  const handlePointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    offset.current = {
      x: e.clientX - card.x,
      y: e.clientY - card.y,
    };
    cardRef.current?.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    onMove(card.id, e.clientX - offset.current.x, e.clientY - offset.current.y);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    dragging.current = false;
    cardRef.current?.releasePointerCapture(e.pointerId);
  };

  let hostname = '';
  try {
    hostname = new URL(card.sourceUrl).hostname;
  } catch {
    hostname = card.sourceUrl;
  }

  return (
    <Paper
      ref={cardRef}
      elevation={3}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      sx={{
        position: 'absolute',
        left: card.x,
        top: card.y,
        transform: 'translate(-50%, -50%)',
        width: 240,
        maxHeight: 200,
        p: 1.5,
        borderRadius: 2,
        cursor: 'grab',
        userSelect: 'none',
        overflow: 'hidden',
        '&:active': { cursor: 'grabbing' },
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        transition: 'box-shadow 0.2s',
        '&:hover': { boxShadow: '0 6px 20px rgba(0,0,0,0.15)' },
      }}
    >
      <Typography
        variant="body2"
        sx={{
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 5,
          WebkitBoxOrient: 'vertical',
          lineHeight: 1.5,
          fontSize: '0.8rem',
        }}
      >
        {card.text}
      </Typography>
      {hostname && (
        <Chip
          label={hostname}
          size="small"
          variant="outlined"
          sx={{ fontSize: '0.65rem', maxWidth: 180, alignSelf: 'flex-start', mt: 'auto' }}
        />
      )}
    </Paper>
  );
}

function Whiteboard(): React.ReactElement {
  const [cards, setCards] = React.useState<CardData[]>([]);

  React.useEffect(() => {
    const handleDrop = (data: { text: string; sourceUrl: string; x: number; y: number; highlightId: string }) => {
      const newCard: CardData = {
        id: data.highlightId,
        text: data.text,
        sourceUrl: data.sourceUrl,
        x: data.x,
        y: data.y,
      };
      // Deduplicate: only add if this highlightId hasn't been added yet
      setCards(prev => {
        if (prev.some(c => c.id === data.highlightId)) return prev;
        return [...prev, newCard];
      });
    };

    getElectronAPI()?.onHighlightDropped?.(handleDrop);

    return () => {
      getElectronAPI()?.removeHighlightDroppedListener?.();
    };
  }, []);

  const handleCardMove = React.useCallback((id: string, x: number, y: number) => {
    setCards(prev => prev.map(c => c.id === id ? { ...c, x, y } : c));
  }, []);

  return (
    <Box sx={{
      width: '100%',
      height: '100%',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {cards.map(card => (
        <WhiteboardCard key={card.id} card={card} onMove={handleCardMove} />
      ))}
    </Box>
  );
}

export default Whiteboard;