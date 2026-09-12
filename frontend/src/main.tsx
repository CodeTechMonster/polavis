import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import ThemeSync from './ThemeSync.tsx'

const App = lazy(() => import('./App.tsx'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeSync>
        <Suspense fallback={null}>
          <App />
        </Suspense>
      </ThemeSync>
    </QueryClientProvider>
  </StrictMode>,
)
