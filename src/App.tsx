import { createRoot } from 'react-dom/client';
import Workspace from '@/workspace/Workspace';
import { ThemeProvider } from './components/theme-provider/theme-provider';

const root = createRoot(document.getElementById('app')!);
root.render(
  <ThemeProvider>
    <Workspace />
  </ThemeProvider>
);
