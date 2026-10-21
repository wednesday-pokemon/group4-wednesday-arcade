// Entry point: global styles, keyboard mount guard, React root.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/styles/tokens.css';
import './ui/styles/base.css';
import './ui/styles/components.css';
import './ui/styles/screens.css';
import './ui/styles/hud.css';
import './ui/styles/dashboard.css';
import { App } from './app/App.tsx';
import { installMountGuard } from './app/keyboard.ts';

installMountGuard();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
