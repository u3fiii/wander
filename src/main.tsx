import { createRoot } from 'react-dom/client';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/700.css';
import '@fontsource/vazirmatn/900.css';
import App from './App';
import './style.css';

// Wait for the local Persian font so canvas-based shop signs shape correctly.
document.fonts.load('700 20px Vazirmatn').catch(() => undefined).finally(() => {
  createRoot(document.getElementById('root')!).render(<App />);
});
