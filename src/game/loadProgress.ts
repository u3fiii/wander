import * as THREE from 'three';

// Asset loading progress for the loading screen. Every loader made by useLoader goes through three's default
// loading manager, so its counts cover all models and textures. The total grows as Suspense finds new models,
// so the reported fraction only ever moves forward.
type Listener = (fraction: number) => void;
const listeners = new Set<Listener>();
let fraction = 0;

THREE.DefaultLoadingManager.onProgress = (_url, loaded, total) => {
  fraction = Math.max(fraction, total ? loaded / total : 0);
  listeners.forEach(listener => listener(fraction));
};

export function onLoadProgress(listener: Listener) {
  listeners.add(listener);
  listener(fraction);
  return () => { listeners.delete(listener); };
}
