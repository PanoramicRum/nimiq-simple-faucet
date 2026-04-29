import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const container = document.getElementById('app');
if (!container) throw new Error('#app missing in index.html');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
