// The time of day: one continuous clock instead of a day/night switch. A full turn is a long day, a slow dusk
// through golden hour, sunset and the blue hour, a night, and a dawn back through pink and gold. The sky
// colours, the night blend (lights, fog, stars) and the warm low sun are all read from it, so the change is a
// slow spectrum you barely notice rather than a cut. The sun/moon button skips that: it cross-fades straight to
// full night or full day in a fraction of a second.
export const CYCLE = { day: 120, dusk: 44, night: 88, dawn: 36 };
const TOTAL = CYCLE.day + CYCLE.dusk + CYCLE.night + CYCLE.dawn;
const DUSK_START = CYCLE.day, NIGHT_START = DUSK_START + CYCLE.dusk, DAWN_START = NIGHT_START + CYCLE.night;
// How long the button's cross-fade takes (s).
const JUMP_SECONDS = 0.3;

// Sky keyframes between the day and night colours (which come from the look panel): [progress, top, horizon].
type Keys = Array<[number, string, string]>;
const DUSK_SKY: Keys = [
  [0.25, '#79b9dc', '#ffe0a8'], // golden hour
  [0.5, '#4f6ea8', '#ff9e6e'], // sunset
  [0.72, '#2a2d5c', '#c0667a'], // dusk
  [0.88, '#161a38', '#4a3a5e'], // blue hour
];
const DAWN_SKY: Keys = [
  [0.3, '#1a2142', '#5b4a78'], // first light
  [0.55, '#4d74ad', '#ffb48a'], // sunrise
  [0.8, '#6fb9e0', '#fde6c4'], // morning
];

// `jump` is the button's cross-fade: from one time of day to another, `progress` 0..1.
// `day` counts whole turns of the clock.
export const cycle = { time: 20, day: 0, jump: null as { from: number; to: number; progress: number } | null };

const smooth = (t: number) => t * t * (3 - 2 * t);
const step = (t: number, from: number, to: number) => smooth(Math.min(1, Math.max(0, (t - from) / (to - from))));
const wrap = (t: number) => ((t % TOTAL) + TOTAL) % TOTAL;

// Where in the cycle a time is: which part, and how far through it (0..1).
function part(time: number): { name: 'day' | 'dusk' | 'night' | 'dawn'; p: number } {
  const t = wrap(time);
  if (t < DUSK_START) return { name: 'day', p: t / CYCLE.day };
  if (t < NIGHT_START) return { name: 'dusk', p: (t - DUSK_START) / CYCLE.dusk };
  if (t < DAWN_START) return { name: 'night', p: (t - NIGHT_START) / CYCLE.night };
  return { name: 'dawn', p: (t - DAWN_START) / CYCLE.dawn };
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
// While the button's cross-fade runs, the current look is a blend of where it started and where it is going.
function blended<T>(time: number | undefined, at: (time: number) => T, combine: (a: T, b: T, t: number) => T): T {
  const jump = cycle.jump;
  if (time !== undefined || !jump) return at(time ?? cycle.time);
  return combine(at(jump.from), at(jump.to), smooth(jump.progress));
}

// 0 by day, 1 at night. The lights come on only once the sun is down, and go off soon after sunrise.
export function nightAmount(time?: number) { return blended(time, nightAt, mix); }
function nightAt(time: number) {
  const { name, p } = part(time);
  if (name === 'day') return 0;
  if (name === 'night') return 1;
  return name === 'dusk' ? step(p, 0.35, 0.95) : 1 - step(p, 0.1, 0.65);
}

// How strongly the low sun is warm (0..1): peaks around sunset and sunrise.
export function twilight(time?: number) { return blended(time, twilightAt, mix); }
function twilightAt(time: number) {
  const { name, p } = part(time);
  if (name === 'dusk') return Math.sin(Math.PI * Math.min(1, Math.max(0, (p - 0.08) / 0.72)));
  if (name === 'dawn') return Math.sin(Math.PI * Math.min(1, Math.max(0, (p - 0.2) / 0.65)));
  return 0;
}

const parse = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
export const mixHex = (a: string, b: string, t: number) => {
  const x = parse(a), y = parse(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};
function along(keys: Array<[number, string, string]>, p: number) {
  for (let i = 1; i < keys.length; i++) {
    if (p <= keys[i][0]) {
      const t = smooth((p - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
      return { top: mixHex(keys[i - 1][1], keys[i][1], t), horizon: mixHex(keys[i - 1][2], keys[i][2], t) };
    }
  }
  const last = keys[keys.length - 1];
  return { top: last[1], horizon: last[2] };
}

// The sky gradient's top and horizon colours at a time, between the given day and night colours.
type Sky = { top: string; horizon: string };
export function skyAt(day: Sky, night: Sky, time?: number): Sky {
  return blended(time, at => skyAtTime(day, night, at), (a, b, t) => ({ top: mixHex(a.top, b.top, t), horizon: mixHex(a.horizon, b.horizon, t) }));
}
function skyAtTime(day: Sky, night: Sky, time: number): Sky {
  const { name, p } = part(time);
  if (name === 'day') return day;
  if (name === 'night') return night;
  const keys: Keys = name === 'dusk'
    ? [[0, day.top, day.horizon], ...DUSK_SKY, [1, night.top, night.horizon]]
    : [[0, night.top, night.horizon], ...DAWN_SKY, [1, day.top, day.horizon]];
  return along(keys, p);
}

// Runs the clock at its own slow pace while `running`; the button's cross-fade runs regardless and, when it
// ends, the clock carries on from the time it went to.
export function advanceCycle(dt: number, running: boolean) {
  const jump = cycle.jump;
  if (jump) {
    jump.progress += dt / JUMP_SECONDS;
    if (jump.progress >= 1) { if (jump.to < jump.from) cycle.day++; cycle.time = jump.to; cycle.jump = null; }
  } else if (running) {
    const next = cycle.time + dt;
    if (next >= TOTAL) cycle.day++;
    cycle.time = wrap(next);
  }
}

// The sun/moon button: cross-fade straight to full night or full day. Pressed again mid-fade, it turns round.
export function goTo(phase: 'day' | 'night') {
  const to = phase === 'night' ? NIGHT_START + 2 : 2;
  const jump = cycle.jump;
  if (jump) {
    if ((part(jump.to).name === 'night') === (phase === 'night')) return;
    cycle.jump = { from: jump.to, to: jump.from, progress: 1 - jump.progress };
    return;
  }
  if (part(cycle.time).name === phase) return;
  cycle.jump = { from: cycle.time, to, progress: 0 };
}
// Which way the button should go next: toward whichever end the clock is heading or sitting nearest.
export function headingToNight() {
  if (cycle.jump) return part(cycle.jump.to).name === 'night';
  const { name } = part(cycle.time);
  return name === 'night' || name === 'dusk';
}
