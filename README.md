# Wander

A small, playable low-poly driving world built with React, TypeScript and Three.js / React Three Fiber. The deterministic globe contains a small city, a clustered forest and a coastal district connected by a continuous road and driveable branches.

## Open in Cursor

Use **File → Open Folder** and select this `wander` folder.

With Node.js 22.12+ installed:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. To make a production build: `npm run build`. To check driving behavior: `npm test`.

## Controls

- W / Up: accelerate; S / Down: brake, then reverse
- A / D or Left / Right: steer continuously, including between junctions
- Space: brake
- C: follow / overhead camera
- R: return to the starting point on the globe
- Escape: pause / resume
- Toolbar: day/night, camera, help, pause
- Touch screens: on-screen driving controls

Follow the roads around the globe or explore freely. Steering controls the car's heading everywhere; it does not automatically switch road loops. Ease off the accelerator to coast and slow down for corners. The game pauses when you switch away from its window.

The road network is one winding continuous loop around the globe. Every road vertex is projected back onto the displaced globe surface so the route stays attached to land and water.

Seven NPC vehicles circulate independently across those routes in both directions: taxi, police car, SUV, van, ambulance, truck and delivery van. The player car uses the supplied sports hatchback model.

## Where things live

- `src/game/config.ts`: `LOOP_DRIVE` tuning for acceleration, braking, steering, grip and speed; camera settings
- `src/game/driving.ts`: spherical driving physics and the legacy flat-world collision model
- `src/game/globe.ts`: globe coordinates and road frames
- `src/game/planetTerrain.ts`: faceted planet constants, palette and deterministic 3D land noise
- `src/game/worldMap.ts`: regions, shared land classification and road definitions
- `src/game/Scene.tsx`: car model, wheel steering/rotation, body movement, brake lights and follow camera
- `src/game/MiniatureWorld.tsx`: generated land/water meshes, roads, bridges and instanced scenery
- `src/App.tsx`: controls, speedometer and menus
- `src/style.css`: interface appearance and responsive layout

Vehicle meshes and their shared color-map texture come from the Kenney car assets in `src/assets/kenny cars`. Physics are intentionally arcade-style: progressive acceleration, rolling resistance, speed-sensitive steering and limited cornering grip. Movement follows the car's heading on the sphere, with small physics steps for consistent behavior across frame rates. Body lean is cosmetic; NPC traffic follows the road centerlines and does not currently collide with the player.

The previous player vehicle (kept for reference, no longer loaded) uses [Low poly Japan Offroad Car](https://sketchfab.com/3d-models/low-poly-japan-offroad-car-5bde8c57de3d4be880ed6457f88636ad) by [Han66st](https://sketchfab.com/Han66st), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). The supplied source files and original license are kept in `src/assets/low_poly_japan_offroad_car`.

The town uses varied buildings and planters from the supplied Kenney city assets in `src/assets/kenny city`. Lighting, atmosphere, material palette and visual quality live in `ART_DIRECTION` at the top of `src/game/artDirection.ts`. Planet detail, land threshold and shell height live in `PLANET_TERRAIN` at the top of `src/game/planetTerrain.ts`; road, bridge and region settings live in `WORLD_SETTINGS` at the top of `src/game/worldMap.ts`.

## Future model workflow

The open-source [img2threejs](https://github.com/img2threejs/img2threejs) project is an Apache-2.0 agent skill for rebuilding reference images as editable Three.js code. It can be evaluated for a more recognizable car in a later iteration. It is not installed or used by this version; AI model usage may have a separate cost. Similarly named hosted converters are separate services.

Fonts: Outfit and Quicksand through Fontsource (SIL Open Font License). Icons: Lucide (ISC). Dependencies and their licenses remain with their respective packages.

Road palette and raised curb profile are adapted from [Low Poly UFO Scene](https://sketchfab.com/3d-models/low-poly-ufo-scene-207cb85b20a5430eb636966d408f1bd0) by [EdwinRC](https://sketchfab.com/Edwin3D), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). The supplied source files and original license are kept in `src/assets/low_poly_ufo_scene`.

Clouds use [Low Poly Cloud](https://sketchfab.com/3d-models/low-poly-cloud-81910476b24d4fc5a73c908d6c2a38a2) by [Hyungjung Kim](https://sketchfab.com/hyungjungkim), licensed under [CC BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/). The supplied source files and original license are kept in `src/assets/low_poly_cloud`.

The bridge, rocks, ground cover, flowers and lanterns use [Japanese Bridge Garden](https://sketchfab.com/3d-models/japanese-bridge-garden-d122e17593eb4012913cde927486d15a) by [kristenlee](https://sketchfab.com/kristenlee), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). The supplied source files, runtime GLB conversion and original license are kept in `src/assets/japanese_bridge_garden`.

Additional greenery uses [Low poly trees](https://sketchfab.com/3d-models/low-poly-trees-51cae4a194344e8bbfbd0a4cff205f76) by [Aditya Graphical](https://sketchfab.com/Adityakm), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). The supplied source files, self-contained runtime GLB conversion and original license are kept in `src/assets/low_poly_trees`.

Mountains use [Low Poly Mountain Free](https://sketchfab.com/3d-models/low-poly-mountain-free-dabda46f9be2416c93a4b584be17786b) by [Poly Craftsman](https://sketchfab.com/lowpolyartwork), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). The supplied source files, self-contained runtime GLB conversion and original license are kept in `src/assets/low_poly_mountain_free`.

The plane uses [Low Poly Plane](https://sketchfab.com/3d-models/low-poly-plane-76230052903540e9aeb46b7db35329e4) by [scailman](https://sketchfab.com/scailman), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). The supplied source files, self-contained runtime GLB conversion and original license are kept in `src/assets/low_poly_plane`.

The rope bridge uses [old ropebridge low poly](https://sketchfab.com/3d-models/old-ropebridge-low-poly-6e88260f326b488a92778b9ef43fdd67) by [lucq22](https://sketchfab.com/lucq22), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). The supplied source files, self-contained runtime GLB conversion and original license are kept in `src/assets/old_ropebridge_low_poly`.

The player vehicle uses [Low Poly Car](https://sketchfab.com/3d-models/low-poly-car-ffcf987149df4e528ebf1e2dec6a9f8a) by [ion_omat](https://sketchfab.com/ion_omat), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). The supplied source files, self-contained runtime GLB conversion and original license are kept in `src/assets/low_poly_car`.
