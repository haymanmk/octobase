import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import { CssBaseline, Fab, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { createTheme } from '@styles/theme/create-theme';

// Declare the electronAPI type
declare global {
  interface Window {
    electronAPI?: {
      sendTextSelection: (data: { text: string; action: string }) => void;
    };
  }
}

// Your injectable widget component
function InjectableWidget() {
  const theme = createTheme();

  const handleClick = () => {
    const selection = window.getSelection()?.toString();
    console.log('Widget clicked, selected text:', selection);
    // Send to main process via exposed API
    if (window.electronAPI) {
      window.electronAPI.sendTextSelection({
        text: selection || '',
        action: 'save-note'
      });
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Tooltip title="Save to notes" placement="left">
        <Fab
          color="primary"
          size="small"
          onClick={handleClick}
          sx={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            zIndex: 9999,
          }}
        >
          <AddIcon />
        </Fab>
      </Tooltip>
    </ThemeProvider>
  );
}

// Auto-inject when loaded
(function() {
  // Create container for our widget
  const container = document.createElement('div');
  container.id = 'octobase-widget-root';
  document.body.appendChild(container);

  // Render React component
  const root = createRoot(container);
  root.render(<InjectableWidget />);
})();