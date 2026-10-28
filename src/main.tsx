import { createRoot } from 'react-dom/client';
import '@fontsource/outfit/latin-400.css';
import '@fontsource/outfit/latin-500.css';
import '@fontsource/outfit/latin-700.css';
import '@fontsource/outfit/latin-900.css';
import '@fontsource/quicksand/latin-400.css';
import '@fontsource/quicksand/latin-500.css';
import '@fontsource/quicksand/latin-700.css';
import App from './App';
import './style.css';
import './HomeMobile.css';

// Render after the locally bundled UI fonts are ready to avoid a layout jump.
Promise.all([
  document.fonts.load('700 20px Outfit'),
  document.fonts.load('500 20px Quicksand'),
]).catch(() => undefined).finally(() => {
  createRoot(document.getElementById('root')!).render(<App />);
});
