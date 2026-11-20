import '@genui/annotation/styles.css';
import { ClockProvider } from '@zukhruf/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { router } from './router.tsx';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element is missing');

createRoot(root).render(
  <StrictMode>
    <ClockProvider clock={globalThis}>
      <RouterProvider router={router} />
    </ClockProvider>
  </StrictMode>,
);
