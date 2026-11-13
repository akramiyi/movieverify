import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  const registerSw = () => {
    navigator.serviceWorker.register('/sw.js')
      .catch(err => console.log('SW error:', err));
  };
  if (typeof document !== 'undefined' && (document.readyState === 'complete' || document.readyState === 'interactive')) {
    registerSw();
  } else {
    window.addEventListener('load', registerSw);
  }
}
