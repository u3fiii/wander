import { FULL_TURN, loopMetric } from './globe.ts';
import { initialLoopCar } from './driving.ts';
import type { CarState, Controls } from './driving.ts';
import { readPadState } from './gamepad.ts';

// Party mode: up to four players on one screen, Micro Machines style, made for fun more than for winning. One race,
// no rounds, no points: everyone drives round the same loop, ramming each other off their line, and the camera keeps
// the pack in view, pulling back as it spreads until the whole globe shows. It ends when `matchTime` s are up or when
// the last car has fallen back to the bottom of the globe (`outDistance` behind the first), whichever comes first;
// the order on the road at that moment is the result. The ones behind get a little extra pace.
export type Slot = { kind: 'wasd' } | { kind: 'arrows' } | { kind: 'pad'; index: number };
export type PartyPlayer = {
  id: number; slot: Slot; name: string; colour: string;
  car: CarState;
  out: boolean;
  // How far round the loop it has driven (radians of longitude, never wrapping), to tell who leads.
  travelled: number;
  fx: PartyFx;
};
// How a car reacts to being hit, the way traffic does in a solo run (real-ish, a little exaggerated): its hop (m, and
// how fast it rises), its lean away from the hit (rad, a spring), its squash (+ flat, a spring), the shove it was
// given (m/s, along and across the road), the spin added to its heading (rad/s), and the horn's cool-down.
export type PartyFx = {
  lift: number; liftV: number; roll: number; rollV: number; squash: number; squashV: number;
  knockX: number; knockZ: number; spin: number; honk: number;
};
export const calmFx = (): PartyFx => ({ lift: 0, liftV: 0, roll: 0, rollV: 0, squash: 0, squashV: 0, knockX: 0, knockZ: 0, spin: 0, honk: 0 });
// What one collision did, for the scene's sounds, shake and comic words: where (loop coordinates), how hard (closing
// speed, m/s), and the car that took a real knock, if it was hard enough.
export type PartyHit = { a: PartyPlayer; b: PartyPlayer; closing: number; x: number; z: number; knocked?: PartyPlayer };
// What the scene and the screen share during a party: the players, whether the cars are held (countdown, between
// rounds), and a running count of bumps (for the sound).
export type PartyRun = { players: PartyPlayer[]; frozen: boolean; bumps: number };
export const PARTY = {
  maxPlayers: 4,
  matchTime: 120,
  // The race is over once the last car is this far (m along the road) behind the first (the globe is about 190 m
  // round): the camera, pulled all the way out, then has the first car near the top of the screen and the last near
  // the bottom.
  outDistance: 48,
  // Extra pace (m/s per second) for whoever is furthest behind; the leader eases off by half that.
  catchUp: 3,
  // The line-up at the start of a round: side by side (m from the centre line) and a little staggered.
  grid: [-1.95, -0.65, 0.65, 1.95],
  // Bumper cars: each car a capsule (half the distance between its end-cap centres, and its half width, m, as against
  // traffic), and how much of the closing speed bounces back.
  bump: { halfLength: 0.8, radius: 0.65, bounce: 0.35 },
  // Hits, like traffic hits in a solo run: the car that is hit is shoved away (`push` × the closing speed, mostly
  // sideways, so a good hit puts it on the curb), spun (`spin` × the closing speed, at most `maxSpin` rad/s, easing
  // off at `spinDamping`), punted forward if hit from behind (`punt`), and hops, leans and squashes more the harder it
  // was (full at `strengthSpeed` m/s). The car that hit it feels `recoil` of all that. Over `hard` m/s it is a real
  // knock (with a crunch and a word); under `light` m/s it's just a touch.
  hit: {
    hard: 4, light: 1.5, strengthSpeed: 16, push: 0.75, knockDecay: 3.2, spin: 0.22, maxSpin: 3, spinDamping: 2.5, punt: 0.7,
    recoil: 0.35, hopMin: 1.4, hopMax: 5.5, gravity: 22, bounce: 0.32,
    rollKick: 5, rollKickMax: 9, rollStiffness: 70, airRollStiffness: 12, rollDamping: 6, maxRoll: 0.7,
    squashKick: 5, landSquash: 0.05, squashStiffness: 220, squashDamping: 11, maxSquash: 0.22,
  },
  countdown: 3,
};
export const PLAYER_LOOKS = [
  { name: 'Red', colour: '#e0533d' }, { name: 'Blue', colour: '#3d7be0' },
  { name: 'Green', colour: '#3fae49' }, { name: 'Yellow', colour: '#f2c230' },
];

// The keys each keyboard slot uses, so two can share one keyboard.
const KEYS = {
  wasd: { gas: 'KeyW', brake: 'KeyS', left: 'KeyA', right: 'KeyD', drift: 'Space', horn: 'KeyE' },
  arrows: { gas: 'ArrowUp', brake: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', drift: 'ShiftRight', horn: 'Enter' },
};
const held = new Set<string>();
let listening = false;
// Keys held right now (for the keyboard slots). Started once, lives for the page.
export function listenToKeys() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('keydown', event => held.add(event.code));
  window.addEventListener('keyup', event => held.delete(event.code));
  window.addEventListener('blur', () => held.clear());
}
export const keyHeld = (code: string) => held.has(code);

// One player's controls this frame, from their slot.
export function slotControls(slot: Slot, pads: ReadonlyArray<Gamepad | null> = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []): Controls {
  if (slot.kind === 'pad') {
    const pad = pads[slot.index];
    if (!pad) return { forward: false, back: false, left: false, right: false, brake: false };
    const state = readPadState(pad);
    const shape = (value: number) => (Math.abs(value) < 0.12 ? 0 : value);
    return { forward: false, back: false, left: false, right: false, brake: state.handbrake, throttle: shape(state.throttle), reverse: shape(state.brake), steer: -shape(state.steer) };
  }
  const k = KEYS[slot.kind];
  return { forward: held.has(k.gas), back: held.has(k.brake), left: held.has(k.left), right: held.has(k.right), brake: held.has(k.drift) };
}
// The same, filled in for the car physics: analog pedals and steering from either kind of slot.
export function slotDrive(slot: Slot, pads?: ReadonlyArray<Gamepad | null>): Controls {
  const c = slotControls(slot, pads);
  return { ...c, boost: false, throttle: c.throttle ?? Number(c.forward), reverse: c.reverse ?? Number(c.back), steer: c.steer ?? Number(c.left) - Number(c.right) };
}
// The horn: E, Enter or X on a pad.
export function slotHorn(slot: Slot, pads: ReadonlyArray<Gamepad | null> = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []) {
  if (slot.kind === 'pad') { const pad = pads[slot.index]; return !!pad && readPadState(pad).boost; }
  return held.has(KEYS[slot.kind].horn);
}
export const slotLabel = (slot: Slot) => (slot.kind === 'wasd' ? 'W A S D' : slot.kind === 'arrows' ? 'Arrow keys' : `Controller ${slot.index + 1}`);
export const sameSlot = (a: Slot, b: Slot) => a.kind === b.kind && (a.kind !== 'pad' || (b.kind === 'pad' && a.index === b.index));

export function createPlayer(id: number, slot: Slot): PartyPlayer {
  const look = PLAYER_LOOKS[id % PLAYER_LOOKS.length];
  return { id, slot, name: look.name, colour: look.colour, car: initialLoopCar(), out: false, travelled: 0, fx: calmFx() };
}

// Lines everyone up side by side at `x` (the leader's spot), stopped, for a new round.
export function lineUp(players: PartyPlayer[], x: number) {
  players.forEach((player, index) => {
    player.car = { ...initialLoopCar(), x, z: PARTY.grid[index] ?? 0 };
    player.out = false;
    player.travelled = x;
    player.fx = calmFx();
  });
}

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
// Keeps each player's running distance round the loop up to date (call after moving the cars).
export function track(player: PartyPlayer, previousX: number) {
  player.travelled += wrap(player.car.x - previousX);
}

// The leader, and how far (m along the road) each player is behind it.
export function standings(players: PartyPlayer[]) {
  const racing = players.filter(player => !player.out);
  const leader = racing.reduce<PartyPlayer | undefined>((best, player) => (!best || player.travelled > best.travelled ? player : best), undefined);
  const metric = leader ? loopMetric(leader.car.x) : 0;
  return { leader, behind: (player: PartyPlayer) => (leader ? (leader.travelled - player.travelled) * metric : 0) };
}

// How far (m along the road) the last car is behind the first, by road length (see `pack`), and whether that is far
// enough to end the race.
export function roadGap(players: PartyPlayer[]) { return pack(players).length; }
export const leftBehind = (players: PartyPlayer[]) => roadGap(players) >= PARTY.outDistance;

// A gentle hand for whoever is behind: the further back, the more extra pace (and the leader eases off a touch), so
// the pack stays together and everyone is in it.
export function catchUp(players: PartyPlayer[], dt: number) {
  const { leader, behind } = standings(players);
  if (!leader) return;
  let furthest = 0;
  for (const player of players) {
    if (player === leader || player.out) continue;
    const gap = behind(player);
    furthest = Math.max(furthest, gap);
    if (gap > 1.5 && player.car.speed > 0.5) player.car.speed += PARTY.catchUp * Math.min(1, gap / PARTY.outDistance) * dt;
  }
  if (furthest > 3 && leader.car.speed > 0.5) leader.car.speed -= PARTY.catchUp * 0.5 * Math.min(1, furthest / PARTY.outDistance) * dt;
}
// Everyone in their order on the road, first car first (the result when the race ends).
export const ranking = (players: PartyPlayer[]) => [...players].sort((a, b) => b.travelled - a.travelled);

// Bumper cars: each car is a capsule the length of its body (the same shape it has against traffic). Two that touch
// are pushed fully apart, so they never sink into each other, and bounce off a little, trading speed along the hit.
// In loop coordinates: `x` round the loop, `z` across the road (both in metres here).
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
// The closest points of two segments p + s·d and q + t·e (s, t in 0..1).
function closest(px: number, pz: number, dx: number, dz: number, qx: number, qz: number, ex: number, ez: number) {
  const rx = px - qx, rz = pz - qz;
  const a = dx * dx + dz * dz, e = ex * ex + ez * ez, f = ex * rx + ez * rz, c = dx * rx + dz * rz, b = dx * ex + dz * ez;
  const denom = a * e - b * b;
  let s = denom > 1e-9 ? clamp01((b * f - c * e) / denom) : 0;
  let t = (b * s + f) / e;
  if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
  return { s, t };
}
export function bump(players: PartyPlayer[]) {
  // A car in the air flies over the others.
  const racing = players.filter(player => !player.out && player.fx.lift < 0.3);
  const { halfLength, radius, bounce } = PARTY.bump;
  const hits: PartyHit[] = [];
  for (let i = 0; i < racing.length; i++) {
    for (let j = i + 1; j < racing.length; j++) {
      const a = racing[i].car, b = racing[j].car;
      const metric = loopMetric(a.x);
      // b relative to a, in metres.
      const bx = wrap(b.x - a.x) * metric, bz = b.z - a.z;
      if (bx * bx + bz * bz > (2 * halfLength + 2 * radius) ** 2) continue;
      const ax = Math.cos(a.heading) * halfLength, az = Math.sin(a.heading) * halfLength;
      const ex = Math.cos(b.heading) * halfLength, ez = Math.sin(b.heading) * halfLength;
      const { s, t } = closest(-ax, -az, 2 * ax, 2 * az, bx - ex, bz - ez, 2 * ex, 2 * ez);
      const cx = -ax + 2 * ax * s, cz = -az + 2 * az * s, kx = bx - ex + 2 * ex * t, kz = bz - ez + 2 * ez * t;
      let nx = kx - cx, nz = kz - cz;
      const distance = Math.hypot(nx, nz);
      if (distance >= 2 * radius) continue;
      if (distance > 1e-4) { nx /= distance; nz /= distance; } else { nx = 0; nz = bz >= 0 ? 1 : -1; }
      // Apart, half each, all the way.
      const half = (2 * radius - distance) / 2 + 0.01;
      a.z -= nz * half; b.z += nz * half;
      a.x -= (nx * half) / metric; b.x += (nx * half) / metric;
      a.x = ((a.x % FULL_TURN) + FULL_TURN) % FULL_TURN; b.x = ((b.x % FULL_TURN) + FULL_TURN) % FULL_TURN;
      // Bounce: how fast they close along the hit, shared out (each car only moves along its own heading).
      const ua = Math.cos(a.heading) * nx + Math.sin(a.heading) * nz, ub = Math.cos(b.heading) * nx + Math.sin(b.heading) * nz;
      const closing = a.speed * ua - b.speed * ub;
      const hit: PartyHit = { a: racing[i], b: racing[j], closing: Math.max(0, closing), x: ((a.x + wrap(b.x - a.x) / 2) % FULL_TURN + FULL_TURN) % FULL_TURN, z: (a.z + b.z) / 2 };
      hits.push(hit);
      if (closing <= 0) continue;
      const impulse = closing * (1 + bounce) / 2;
      a.speed -= impulse * ua; b.speed += impulse * ub;
      // Whoever drove into whom: the car whose own speed made more of the closing hits; the other one gets it.
      const hitterIsA = a.speed * ua + impulse * ua >= -(b.speed * ub - impulse * ub);
      const victim = hitterIsA ? racing[j] : racing[i], hitter = hitterIsA ? racing[i] : racing[j];
      const away = hitterIsA ? 1 : -1;
      if (closing > PARTY.hit.light) {
        knock(victim, closing, nx * away, nz * away, 1);
        knock(hitter, closing, -nx * away, -nz * away, PARTY.hit.recoil);
      }
      if (closing > PARTY.hit.hard) hit.knocked = victim;
    }
  }
  return hits;
}

// A car's reaction to a hit pushing it along (dx, dz) at `closing` m/s (`share` of it, for the one that did the
// hitting): shoved, spun, punted on if hit from behind, and a hop, a lean away from the hit and a squash.
function knock(player: PartyPlayer, closing: number, dx: number, dz: number, share: number) {
  const fx = player.fx, h = PARTY.hit, car = player.car;
  const strength = Math.min(1, closing / h.strengthSpeed) * share;
  const along = Math.cos(car.heading) * dx + Math.sin(car.heading) * dz, across = -Math.sin(car.heading) * dx + Math.cos(car.heading) * dz;
  const sideways = Math.abs(across);
  fx.knockX += dx * closing * h.push * share * Math.max(sideways, 0.35);
  fx.knockZ += dz * closing * h.push * share * Math.max(sideways, 0.35);
  // Pushed on its side ahead of the middle, its nose swings away; behind the middle, its tail does.
  const turn = (across >= 0 ? 1 : -1) * (along >= 0 ? -1 : 1);
  fx.spin = Math.max(-h.maxSpin, Math.min(h.maxSpin, fx.spin + turn * closing * h.spin * share * Math.max(sideways, 0.3)));
  if (along > 0.3) car.speed += closing * h.punt * along * share;
  fx.liftV = Math.max(fx.liftV, (h.hopMin + (h.hopMax - h.hopMin) * strength) * (share < 1 ? 0.5 : 1));
  // The roof leans the way it is pushed (the tyres grip while the body is shoved).
  fx.rollV += -(across >= 0 ? 1 : -1) * (h.rollKick + (h.rollKickMax - h.rollKick) * strength) * Math.max(sideways, 0.3);
  fx.squashV += h.squashKick * (0.4 + strength);
}

// Moves a car's reaction on: the hop and its landing (a bounce and a squash), the lean and squash springs, the shove
// and the spin. Returns how hard it just landed (m/s, 0 if it didn't), for the sound.
export function stepFx(player: PartyPlayer, dt: number) {
  const fx = player.fx, car = player.car, h = PARTY.hit;
  let landed = 0;
  if (fx.lift > 0 || fx.liftV > 0) {
    fx.liftV -= h.gravity * dt;
    fx.lift += fx.liftV * dt;
    if (fx.lift <= 0) {
      fx.lift = 0;
      if (fx.liftV < -1.5) { landed = -fx.liftV; fx.squashV += landed * h.landSquash * 10; fx.liftV = landed * h.bounce; }
      else fx.liftV = 0;
    }
  }
  const stiffness = fx.lift > 0 ? h.airRollStiffness : h.rollStiffness;
  fx.rollV += (-fx.roll * stiffness - fx.rollV * h.rollDamping) * dt;
  fx.roll = Math.max(-h.maxRoll, Math.min(h.maxRoll, fx.roll + fx.rollV * dt));
  fx.squashV += (-fx.squash * h.squashStiffness - fx.squashV * h.squashDamping) * dt;
  fx.squash = Math.max(-h.maxSquash, Math.min(h.maxSquash, fx.squash + fx.squashV * dt));
  if (fx.knockX || fx.knockZ) {
    car.x = (((car.x + (fx.knockX * dt) / loopMetric(car.x)) % FULL_TURN) + FULL_TURN) % FULL_TURN;
    car.z += fx.knockZ * dt;
    const keep = Math.exp(-h.knockDecay * dt);
    fx.knockX *= keep; fx.knockZ *= keep;
    if (Math.hypot(fx.knockX, fx.knockZ) < 0.05) { fx.knockX = 0; fx.knockZ = 0; }
  }
  if (fx.spin) {
    car.heading += fx.spin * dt;
    fx.spin *= Math.exp(-h.spinDamping * dt);
    if (Math.abs(fx.spin) < 0.02) fx.spin = 0;
  }
  fx.honk = Math.max(0, fx.honk - dt);
  return landed;
}

// The controls a car really gets: none while its wheels are off the ground.
export function partyControls(player: PartyPlayer, controls: Controls): Controls {
  if (player.fx.lift <= 0.05) return controls;
  return { ...controls, forward: false, back: false, left: false, right: false, brake: false, throttle: 0, reverse: 0, steer: 0 };
}

// Where the camera looks: halfway along the road between the first car and the last (by road length, not by angle
// round the axis: the road climbs and dips in latitude, so equal angles aren't equal distances, and pulled all the way
// out they should sit at opposite ends of the globe), the middle of them across the road, and how far from there the
// furthest one is (m), for how far the camera pulls back; and the road length from the last car to the first (m).
const PACK_STEPS = 48;
export function pack(players: PartyPlayer[]) {
  const racing = players.filter(player => !player.out);
  if (!racing.length) return { x: 0, z: 0, spread: 0, length: 0 };
  const ahead = Math.max(...racing.map(player => player.travelled)), behind = Math.min(...racing.map(player => player.travelled));
  // `travelled` runs on round the loop without wrapping; the car's own x is the same place, wrapped.
  const ref = racing[0];
  const from = ref.car.x + behind - ref.travelled, gap = ahead - behind;
  // The road length along the gap in small steps, then the step where half of it is reached.
  const lengths: number[] = [0];
  for (let i = 0; i < PACK_STEPS; i++) lengths.push(lengths[i] + loopMetric(from + (gap * (i + 0.5)) / PACK_STEPS) * gap / PACK_STEPS);
  const half = lengths[PACK_STEPS] / 2;
  let i = 0;
  while (i < PACK_STEPS - 1 && lengths[i + 1] < half) i++;
  const part = lengths[i + 1] > lengths[i] ? (half - lengths[i]) / (lengths[i + 1] - lengths[i]) : 0;
  const x = (((from + (gap * (i + part)) / PACK_STEPS) % FULL_TURN) + FULL_TURN) % FULL_TURN;
  const z = racing.reduce((sum, player) => sum + player.car.z, 0) / racing.length;
  const across = Math.max(0, ...racing.map(player => Math.abs(player.car.z - z)));
  return { x, z, spread: Math.hypot(half, across), length: lengths[PACK_STEPS] };
}
