import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { humanizeError } from './api/client';
import { DialogProvider } from './components/Dialog';
import { toast, ToastHost } from './components/Toaster';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15_000 } },
  // Toute mutation en échec est signalée, une seule fois, sans que chaque page ait à le faire
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      if ((mutation.meta as { silent?: boolean } | undefined)?.silent) return;
      toast.error(humanizeError(err));
    },
  }),
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <DialogProvider>
          <App />
          <ToastHost />
        </DialogProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
