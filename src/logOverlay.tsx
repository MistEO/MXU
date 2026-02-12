import React from 'react';
import ReactDOM from 'react-dom/client';
import { LogOverlayApp } from './components/LogOverlay';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LogOverlayApp />
  </React.StrictMode>,
);
