import { createRoot } from 'react-dom/client';
import Workspace from '@/workspace/Workspace';
import { ErrorBoundary } from '@/workspace/ErrorBoundary';
import { ThemeProvider } from './components/theme-provider/theme-provider';

// Surface silent failures: uncaught errors land in the console (which the
// main process mirrors into userData/octobase.log).
window.addEventListener('error', (e) => console.error('uncaught:', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => console.error('unhandled rejection:', e.reason));

const root = createRoot(document.getElementById('app')!);
root.render(
  <ErrorBoundary>
    <ThemeProvider>
      <Workspace />
    </ThemeProvider>
  </ErrorBoundary>
);
