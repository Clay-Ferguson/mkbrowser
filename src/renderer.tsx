import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { getSettings, setCalendarItemsFolder } from './store';
import { logger } from './shared/logUtil';
import './index.css';

// Expose a small slice of the store to the window so E2E (Playwright) demos can
// temporarily point the calendar-items folder at the demo folder and restore it
// afterward. This only reads/writes the live store; it is otherwise inert.
(window as unknown as { __testStore?: unknown }).__testStore = {
  getSettings,
  setCalendarItemsFolder,
};

// Every render crash is logged here, whether an ErrorBoundary caught it (the
// subtree shows an inline fallback) or not (React unmounts the whole root).
const root = createRoot(document.getElementById('root') as HTMLElement, {
  onUncaughtError: (error, errorInfo) => {
    logger.error('Uncaught render error:', error, errorInfo.componentStack);
  },
  onCaughtError: (error, errorInfo) => {
    logger.error('Render error caught by ErrorBoundary:', error, errorInfo.componentStack);
  },
});
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
