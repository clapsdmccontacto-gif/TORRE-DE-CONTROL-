import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { CloudGate } from './components/CloudGate.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CloudGate>
      <App />
    </CloudGate>
  </StrictMode>,
);
