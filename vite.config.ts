import { writeFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Dev only: the look panel's Apply button posts its settings here, and they are saved to src/game/dayLook.json or
// src/game/nightLook.json.
function lookSaver(route: string, file: string): Plugin {
  return {
    name: `look-saver-${route}`,
    configureServer(server) {
      server.middlewares.use(route, (request, response) => {
        if (request.method !== 'POST') { response.statusCode = 405; response.end(); return; }
        let body = '';
        request.on('data', chunk => { body += chunk; });
        request.on('end', () => {
          try {
            const look = JSON.parse(body);
            writeFileSync(new URL(file, import.meta.url), `${JSON.stringify(look, null, 2)}\n`);
            response.end('saved');
          } catch {
            response.statusCode = 400;
            response.end('bad settings');
          }
        });
      });
    },
  };
}

export default defineConfig({ plugins: [react(), lookSaver('/__day-look', './src/game/dayLook.json'), lookSaver('/__night-look', './src/game/nightLook.json'), lookSaver('/__car-tuning', './src/game/carTuning.json'), lookSaver('/__camera-tuning', './src/game/cameraTuning.json'), lookSaver('/__boost-tuning', './src/game/boostTuning.json')], build: { chunkSizeWarningLimit: 1100 } });
