// The engine's sound model, kept apart from the audio graph so it can be tested: a fake rpm (0 idle .. 1 redline)
// and a fake gearbox. Nothing here touches the driving physics; it only reads speed and throttle.
//
// - rpm follows a target with exponential smoothing: quick to rise (`rpmRise`), slow to fall (`rpmFall`).
// - The gear comes from speed: each gear covers a band of speed, shorter at the bottom. Within a gear the target
//   rpm climbs from low to the top of the gear; coasting holds it lower; standing still, the throttle revs it.
// - Reaching the top of a gear shifts up: rpm drops by `shiftDrop` at once and is held for `shiftTime` (the
//   audio dips its volume meanwhile), then rises again through the next gear. Slowing down shifts back down.
// - A boost adds a short pitch bump that fades over `boostBumpTime`.
export type EngineSettings = {
  gears: number; gearSpread: number; rpmRise: number; rpmFall: number; revInPlace: number; coastRpm: number;
  shiftDrop: number; shiftTime: number; boostPitchBump: number; boostBumpTime: number;
};
export type EngineState = { rpm: number; gear: number; shift: number; bump: number };
export const createEngineState = (): EngineState => ({ rpm: 0, gear: 0, shift: 0, bump: 0 });

// The top speed (as a fraction of top speed) of each gear: (i / gears) ^ spread, so the low gears are short.
export function gearTops(gears: number, spread: number) {
  const count = Math.max(1, Math.round(gears));
  return Array.from({ length: count }, (_, i) => Math.pow((i + 1) / count, spread));
}

const DOWNSHIFT_MARGIN = 0.85;
export function stepEngine(state: EngineState, input: { throttle: number; speed: number; boostStarted?: boolean }, settings: EngineSettings, dt: number) {
  const tops = gearTops(settings.gears, settings.gearSpread);
  const speed = Math.max(0, input.speed), throttle = Math.min(1, Math.max(0, input.throttle));
  let shifted: 'up' | 'down' | null = null;
  state.gear = Math.min(state.gear, tops.length - 1);
  while (state.gear < tops.length - 1 && speed > tops[state.gear]) { state.gear++; shifted = 'up'; }
  while (state.gear > 0 && speed < tops[state.gear - 1] * DOWNSHIFT_MARGIN) { state.gear--; shifted = shifted ?? 'down'; }
  if (shifted === 'up') { state.rpm = Math.max(0, state.rpm - settings.shiftDrop); state.shift = settings.shiftTime; }

  const low = state.gear > 0 ? tops[state.gear - 1] : 0, high = tops[state.gear];
  const inGear = Math.min(1.1, Math.max(0, (speed - low) / Math.max(1e-3, high - low)));
  const pulling = 0.18 + 0.82 * inGear;
  let target = speed < 0.03 ? throttle * settings.revInPlace : throttle > 0.05 ? pulling : pulling * settings.coastRpm;
  if (state.shift > 0) { state.shift = Math.max(0, state.shift - dt); target = Math.min(target, state.rpm); }
  const rate = target > state.rpm ? settings.rpmRise : settings.rpmFall;
  state.rpm += (target - state.rpm) * (1 - Math.exp(-rate * dt));

  if (input.boostStarted) state.bump = settings.boostPitchBump;
  else state.bump = Math.max(0, state.bump - dt * settings.boostPitchBump / Math.max(1e-3, settings.boostBumpTime));
  return { shifted, shifting: state.shift > 0 };
}
