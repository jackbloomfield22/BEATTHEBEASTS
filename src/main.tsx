import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/bungee/400.css';
import '@fontsource-variable/inter';
import './ui/styles/global.css';
import { App } from './app/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
