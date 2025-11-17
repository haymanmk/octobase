import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import Layout from './layout'
import ThemeProviderWrapper from './styles/theme/theme-provider.tsx'
import { BrowserRouter } from 'react-router'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProviderWrapper>
      <Layout>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </Layout>
    </ThemeProviderWrapper>
  </StrictMode>,
)
