import { createRoot } from 'react-dom/client';
import Layout from '@app/electron-layout';
import { ThemeProvider } from './components/theme-provider/theme-provider';

const root = createRoot(document.getElementById('app')!);
root.render(
  <ThemeProvider>
    <Layout />
  </ThemeProvider>
);