import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/shell.css';
import './styles/ppi.css';
import './styles/workbench.css';
import './styles/settings.css';

// One theme: dark. Also switches Swagger UI to its built-in dark mode.
document.documentElement.classList.add('dark-mode');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
