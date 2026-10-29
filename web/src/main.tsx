import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { ApiError } from './api/client';
import { App } from './App';
import { SessionProvider } from './auth/session';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retrying a 403 or 404 only delays the message the person needs to see.
      retry: (failures, error) => !(error instanceof ApiError && error.status < 500) && failures < 2,
    },
    // Never retry a write. Re-sending a scan or a cancellation is the server's decision to
    // refuse, not the client's to repeat.
    mutations: { retry: false },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element.');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
