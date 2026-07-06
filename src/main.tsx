import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyVisualMode, getStoredVisualMode } from './lib/visualMode'
import './index.css'
import './dashboard-chat.css'

applyVisualMode(getStoredVisualMode())

// Registrar el service worker (para poder instalar la app en el celular).
// Es de solo-passthrough (no cachea), asi que no afecta las actualizaciones.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* sin PWA no pasa nada */ });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
