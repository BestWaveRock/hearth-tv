import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles/base.css';
import './styles/components.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  // StrictMode double-invokes effects in development. The focus engine and the
  // input drivers are written to tolerate that: registration returns an
  // idempotent cleanup, and every driver's stop() is safe to call twice.
  <StrictMode>
    <App />
  </StrictMode>,
);
