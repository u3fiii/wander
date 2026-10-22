// The shockwave: a reward that comes round every so often. Fired, a ring of force spreads from the car out to `radius`
// m in `spread` s and throws every traffic car it reaches (each one at the moment the ring gets to it, so the hits
// ripple outwards). Nothing else changes: the player's car drives straight on, at its own pace, and the camera stays.
//
// - `firstAfter`: seconds of driving before the first one is ready; `every`: seconds to charge the next.
//   (Every few seconds for now, to try it out; later it should be rarer than the boost.)
// - `fling`, `hop`, `spin`: how much harder than a boost hit the ring throws a car (Scene.tsx, traffic reaction).
// - `impact`: the hit speed (m/s) the ring hands each car, as if rammed at that speed.
// - `untouchable`: seconds a thrown car passes through the player's (it may tumble back into it: never a crash).
// - `points`: what one car thrown is worth. Each more car in the same wave is worth one `points` more than the one
//   before (100, then 200, 300...), so firing into a crowd pays far more than picking off cars one by one.
export const WAVE = {
  radius: 7, spread: 0.55, firstAfter: 10, every: 10,
  fling: 1.6, hop: 2.4, spin: 1.5, impact: 20, untouchable: 1.6, points: 100,
};

const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

// One run's shockwave: its charge (0..1), and the wave in flight (`time` since it was fired, -1 when none).
export function createWave() {
  return { charge: 0, charged: 0, firstDone: false, id: 0, time: -1, hits: 0 };
}
export type WaveState = ReturnType<typeof createWave>;
export const ready = (wave: WaveState) => wave.charge >= 1;

// Fills the charge while driving. Returns true on the frame it becomes ready.
export function chargeWave(wave: WaveState, dt: number) {
  if (wave.charge >= 1) return false;
  wave.charged += dt;
  const need = wave.firstDone ? WAVE.every : WAVE.firstAfter;
  wave.charge = Math.min(1, wave.charged / need);
  return wave.charge >= 1;
}

// Fires it if it is ready. Returns whether it went.
export function fireWave(wave: WaveState) {
  if (!ready(wave)) return false;
  wave.charge = 0;
  wave.charged = 0;
  wave.firstDone = true;
  wave.id++;
  wave.time = 0;
  wave.hits = 0;
  return true;
}

// The ring's radius (m) now, or -1 once it has spread all the way (or when there is none).
export function waveRadius(wave: WaveState) {
  if (wave.time < 0 || wave.time > WAVE.spread) return -1;
  return WAVE.radius * easeOut(wave.time / WAVE.spread);
}

// Done once it has spread and been counted.
export const waveOver = (wave: WaveState) => wave.time >= WAVE.spread + 0.3;

// The run's shockwave, shared by the scene (charging, firing, the ring and what it throws) and the HUD (the button).
// `origin` is where it was fired, in the globe's space.
export const runWave = { ...createWave(), origin: [0, 0, 0] as [number, number, number] };
export function resetRunWave() { Object.assign(runWave, createWave()); }

// A wave's score for the cars it threw: 1 → 100, 2 → 300, 3 → 600, 4 → 1000...
export const waveScore = (cars: number) => WAVE.points * cars * (cars + 1) / 2;
// And its word: the more cars, the bigger.
export const waveWord = (cars: number) => cars === 0 ? 'MISSED' : cars === 1 ? 'SHOCKWAVE!' : cars === 2 ? 'DOUBLE!' : cars === 3 ? 'TRIPLE!' : `MEGA WAVE ×${cars}`;
