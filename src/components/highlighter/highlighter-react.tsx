import { createRoot } from 'react-dom/client';
import { Box, IconButton, Paper } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useEffect, useState } from 'react';
import { ThemeProvider } from '@components/theme-provider/theme-provider';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';

// Declare the electronAPI type
declare global {
  interface Window {
    electronAPI?: {
      sendTextSelection: (data: { text: string; action: string }) => void;
    };
  }
}

// Define the type for HighlighterHelperWidget props
export interface HighlighterHelperWidgetProps {
  visible?: boolean;
  onClose: () => void;
}

// Create the host element that will live in the website's DOM
const hostID = 'octobase-widget-root';
let hostElement = document.getElementById(hostID);
if (!hostElement) {
  hostElement = document.createElement('div');
  hostElement.id = hostID;
  document.body.appendChild(hostElement);
}

// Create Shadow DOM for isolation
// Check if shadow root already exists
const shadowRoot = hostElement.shadowRoot || hostElement.attachShadow({ mode: 'open' });
let reactRoot = createRoot(shadowRoot);

// Create an emotion cache for shadow DOM
const shadowCache = createCache({
  key: 'shadow-cache',
  container: shadowRoot, // This ensures styles are injected into shadow DOM
  prepend: true,
});

// Handle text selection event
const handleSelection = (text: string, rect: DOMRect) => {
  console.log('Selected text:', text);
  console.log('Selection position:', rect);

  // Update host element position based on rect
  hostElement!.style.position = 'absolute';
  hostElement!.style.top = `${rect.bottom + window.scrollY - 15}px`;
  hostElement!.style.left = `${rect.left + window.scrollX}px`;
  hostElement!.style.zIndex = '9999';

  console.log('Host element positioned at:', hostElement!.style.top, hostElement!.style.left);
}

// A custome react hook to monitor text selection
const useMonitorTextSelection = (): [string, React.Dispatch<React.SetStateAction<string>>] => {
  const [ selectedText, setSelectedText ] =useState<string>('');
  // Mouse up event handler
  const handleMouseUp = () => {
    const _selection = window.getSelection();
    const _selectedText = _selection ? _selection.toString() : '';

    if (_selectedText.length > 0 && _selection) {
      const range = _selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // Handle the selected text and its position
      handleSelection(_selectedText, rect);
      setSelectedText(_selectedText);
    }
  };

  useEffect(() => {
    // Clear the event listener first to avoid duplication
    document.removeEventListener('mouseup', handleMouseUp);
    // Monitor text selection
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      // Cleanup event listener on unmount
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return [
    selectedText,
    setSelectedText,
  ];
};

// Create the popup helper widget inside the shadow DOM
const HighlighterHelperWidget = (
) => {
  const [ selectedText, setSelectedText ] = useMonitorTextSelection();

  return (
    // Before rendering, we have to calculate position based on selection by DOMRect
    selectedText && <Paper
    elevation={4} 
    sx={{ p: 2, display: 'flex', alighItems: 'center', gap: 1 }}
    >
      <Box>Highlighter Helper</Box>
      <IconButton size='large' onClick={ () => setSelectedText('')} >
        <CloseIcon fontSize='small' />
      </IconButton>
    </Paper>
  );
}

// Auto-inject when loaded
(function() {
  // Render React component
  reactRoot?.render(
    <CacheProvider value={shadowCache}>
      <ThemeProvider>
        <HighlighterHelperWidget />
      </ThemeProvider>
    </CacheProvider>
  );
})();