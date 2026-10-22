// Jumps: the car follows the road's rise and fall, and over a crest (the bridge's hump) taken fast enough it leaves
// the road and flies on a real arc. It lifts off when the road drops away faster than `gravity` (m/s²) plus the tyres'
// `grip` can pull it down. Below `minSpeed` (m/s) the suspension soaks the crest up; the launch grows to its full
// `launch` share of the climb by `fullSpeed`, so top speed and boost fly furthest. (The scene tips the nose to follow
// the flight and lands it with a squash of `landSquash`, a thud and a jolt of `landShake`.)
export const JUMP = { gravity: 24, grip: 16, minSpeed: 15, fullSpeed: 24, launch: 0.9, landSquash: 9, landShake: 0.5 };

export const createJump = () => ({ height: 0, velocity: 0, ground: null as number | null, groundSpeed: 0, flying: false });
export type JumpState = ReturnType<typeof createJump>;
const smoothstep = (low: number, high: number, value: number) => { const t = Math.max(0, Math.min(1, (value - low) / (high - low))); return t * t * (3 - 2 * t); };

// One step: `ground` is the road's height under the car now. Returns how hard it came down (m/s) on the step it
// lands, otherwise 0. `active` false (off the road, not driving) keeps it on the ground.
export function stepJump(state: JumpState, ground: number, speed: number, dt: number, active: boolean) {
  const groundSpeed = state.ground === null || dt <= 0 ? 0 : (ground - state.ground) / dt;
  const jumped = state.ground !== null && Math.abs(ground - state.ground) > 1;
  state.ground = ground;
  state.groundSpeed = groundSpeed;
  if (!active || jumped || dt <= 0) {
    Object.assign(state, { height: ground, velocity: 0, flying: false });
    return 0;
  }
  if (state.flying) {
    state.velocity -= JUMP.gravity * dt;
    state.height += state.velocity * dt;
    if (state.height > ground) return 0;
    const impact = Math.max(0, groundSpeed - state.velocity);
    Object.assign(state, { height: ground, velocity: groundSpeed, flying: false });
    return impact;
  }
  const fast = smoothstep(JUMP.minSpeed, JUMP.fullSpeed, speed);
  if (fast > 0 && (state.velocity - groundSpeed) / dt > JUMP.gravity + JUMP.grip) {
    // Off the crest: it carries (a share of, by speed) the climb it had into the air.
    state.flying = true;
    state.velocity = groundSpeed + (state.velocity - groundSpeed) * JUMP.launch * fast - JUMP.gravity * dt;
    state.height += state.velocity * dt;
    return 0;
  }
  state.height = ground;
  state.velocity = groundSpeed;
  return 0;
}
