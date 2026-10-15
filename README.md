# تهران‌گرد · Tehran Drive

A small, playable driving world inspired by Tehran. React + TypeScript + Three.js / React Three Fiber, powered by Vite. The streets are a fictional compact layout, not an accurate Tehran map. All current 3D scenery and the car are built in code; no model service, API key, or backend is required.

## Open in Cursor

Use **File → Open Folder** and select this `tehran-drive` folder.

With Node.js 22.12+ installed:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. To make a production build: `npm run build`. To check driving behavior: `npm test`.

## Controls

- WASD / arrow keys: accelerate, reverse, steer
- Space: brake
- C: follow / overhead camera
- R: return to the starting street and restart the route
- Escape: pause / resume
- Toolbar: day/night, camera, help, pause
- Touch screens: on-screen driving controls

Follow four golden markers, or explore freely. Slow down for corners. The game pauses when you switch away from its window.

## Where things live

- `src/game/config.ts`: speed, steering, starting position, camera settings, route stops
- `src/game/driving.ts`: arcade movement and curb/boundary collisions
- `src/game/Scene.tsx`: car model, follow camera, lighting, trees, landmarks
- `src/game/world.ts`: city layout, building geometry and shop signs
- `src/App.tsx`: controls, minimap, journey progress, menus
- `src/style.css`: interface appearance and responsive layout

The current car is a stylized original sedan. Wheel rotation and steering are separate from its body, so its model can be replaced while keeping the driving system. Physics are intentionally arcade-style; there is no traffic or suspension simulation in this first version.

## Future model workflow

The open-source [img2threejs](https://github.com/img2threejs/img2threejs) project is an Apache-2.0 agent skill for rebuilding reference images as editable Three.js code. It can be evaluated for a more recognizable car in a later iteration. It is not installed or used by this version; AI model usage may have a separate cost. Similarly named hosted converters are separate services.

Fonts: Vazirmatn through `@fontsource/vazirmatn` (SIL Open Font License). Icons: Lucide (ISC). Dependencies and their licenses remain with their respective packages.
