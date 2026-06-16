import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { getSettings, setCalendarItemsFolder } from './store';
import './index.css';

// Expose a small slice of the store to the window so E2E (Playwright) demos can
// temporarily point the calendar-items folder at the demo folder and restore it
// afterward. This only reads/writes the live store; it is otherwise inert.
(window as unknown as { __testStore?: unknown }).__testStore = {
  getSettings,
  setCalendarItemsFolder,
};

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
