export type VisualQuality = 'low' | 'mobile' | 'high';

// Image clarity and scenery cost are separate budgets. Touch devices keep sharp
// pixels, but spend less on small decorations, their shadows and depth of field. The shadow pass redraws every
// scenery caster again, so weaker devices also cover a smaller area and refresh it every `shadowInterval` frames.
export const QUALITY_PROFILES = {
  low: {
    shadowMapSize: 512, shadowExtent: 26, shadowInterval: 2, minDpr: 0.8, initialDpr: 1, maxDpr: 1.15,
    depthOfField: false, lightweightShading: true, msaa: 0, decorationDensity: 0.2, decorativeShadows: false, simpleSwimRings: true,
  },
  mobile: {
    shadowMapSize: 512, shadowExtent: 30, shadowInterval: 2, minDpr: 0.9, initialDpr: 1.3, maxDpr: 2,
    depthOfField: false, lightweightShading: true, msaa: 0, decorationDensity: 0.28, decorativeShadows: false, simpleSwimRings: true,
  },
  high: {
    shadowMapSize: 2048, shadowExtent: 42, shadowInterval: 1, minDpr: 0.9, initialDpr: 1.5, maxDpr: 1.5,
    depthOfField: true, lightweightShading: false, msaa: 4, decorationDensity: 1, decorativeShadows: true, simpleSwimRings: false,
  },
} as const;
export type QualityProfile = typeof QUALITY_PROFILES[VisualQuality];

const TIERS: readonly VisualQuality[] = ['low', 'mobile', 'high'];
const isTier = (value?: string | null): value is VisualQuality => TIERS.includes(value as VisualQuality);

// `console`: a games console's browser (Xbox). It reports a desktop's cores and memory, but the browser only gets a
// small share of the machine, so it gets the light profile. `fallback`: a lighter tier this device dropped to before
// after running too slow (see watchSlowFrames); it only ever lowers the pick.
export function selectVisualQuality({ forced, touch = false, cores = 8, memory = 8, console: gameConsole = false, fallback }: {
  forced?: string | null; touch?: boolean; cores?: number; memory?: number; console?: boolean; fallback?: string | null;
}): VisualQuality {
  if (isTier(forced)) return forced;
  const picked: VisualQuality = gameConsole ? 'low'
    : touch ? (cores <= 2 || memory <= 2 ? 'low' : 'mobile')
    : cores <= 4 || memory <= 4 ? 'low' : 'high';
  return isTier(fallback) && TIERS.indexOf(fallback) < TIERS.indexOf(picked) ? fallback : picked;
}

// The tier below, for a device that can't keep up with its own.
export const lighterTier = (tier: VisualQuality): VisualQuality => TIERS[Math.max(0, TIERS.indexOf(tier) - 1)];

// A device that can't hold even 30 frames a second for a good while of driving, at its lowest resolution or not, is
// on too heavy a tier. Only active rendering counts.
const SLOW = { fps: 26, seconds: 12 };
export const createSlowFrameState = () => ({ time: 0, frames: 0, slow: 0 });
export function watchSlowFrames(state: ReturnType<typeof createSlowFrameState>, delta: number, active: boolean) {
  if (!active || !Number.isFinite(delta) || delta <= 0 || delta > 0.5) return false;
  state.time += delta;
  state.frames++;
  if (state.time < 1) return false;
  state.slow = state.frames / state.time < SLOW.fps ? state.slow + state.time : 0;
  state.time = 0;
  state.frames = 0;
  return state.slow >= SLOW.seconds;
}

export function resolutionBounds(profile: QualityProfile, deviceDpr: number) {
  const native = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1;
  const max = Math.min(native, profile.maxDpr);
  return { min: Math.min(max, profile.minDpr), max, initial: Math.min(max, profile.initialDpr) };
}

// `cpuBound`: frames this slow while the main thread's own work (the game's code and three.js preparing the frame)
// takes up this share of the frame or more are the processor's fault, not the pixels': fewer pixels wouldn't help,
// so the picture is left sharp.
const ADAPT = { window: 1.5, slow: 1 / 55, smooth: 1 / 58, down: 0.15, up: 0.1, slowWindows: 2, goodWindows: 2, warmup: 3, recoveryDelay: 20, cpuBound: 0.5 };
export const createResolutionState = () => ({ time: 0, frames: 0, cpu: 0, good: 0, slow: 0, warmup: ADAPT.warmup, recovery: 0 });

// Sample active rendering only. Loading, tab switches and pause/resume must not
// count as GPU overload or contribute old samples toward a quality increase. `cpu` is how long the main thread
// worked on this frame (s), when known.
export function adaptResolution(state: ReturnType<typeof createResolutionState>, delta: number, active: boolean,
  dpr: number, bounds: { min: number; max: number }, cpu = 0) {
  if (!active || !Number.isFinite(delta) || delta <= 0 || delta > 0.25) {
    Object.assign(state, createResolutionState());
    return dpr;
  }
  if (state.warmup > 0) { state.warmup -= delta; return dpr; }
  state.recovery = Math.max(0, state.recovery - delta);
  state.time += delta;
  state.cpu += cpu;
  state.frames++;
  if (state.time < ADAPT.window) return dpr;
  const average = state.time / state.frames;
  const cpuBound = state.cpu / state.frames >= average * ADAPT.cpuBound;
  state.time = 0;
  state.frames = 0;
  state.cpu = 0;
  let next = dpr;
  if (average > ADAPT.slow && cpuBound) {
    // Slow, but from the processor: leave the resolution be.
    state.good = 0;
    state.slow = 0;
  } else if (average > ADAPT.slow) {
    state.good = 0;
    if (++state.slow >= ADAPT.slowWindows) {
      next -= ADAPT.down;
      state.slow = 0;
      // A stronger phone can climb to its own limit. After overload, give the
      // device time to settle before probing higher resolution again.
      state.recovery = ADAPT.recoveryDelay;
    }
  } else if (average < ADAPT.smooth && state.recovery === 0) {
    state.slow = 0;
    if (++state.good >= ADAPT.goodWindows) { next += ADAPT.up; state.good = 0; }
  } else {
    state.good = 0;
    state.slow = 0;
  }
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(next * 100) / 100));
}

// Frame pacing for devices that can't hold 60: a steady 30 feels smoother than a rate that wobbles between 35 and
// 55. After `slowFor` s of driving slower than `slow`, the game draws at 30; once the work per frame has stayed
// light enough to fit a 60 Hz frame with room to spare (`light` of it) for `lightFor` s, it tries 60 again, and if
// that was too hopeful it waits longer each time before the next try (`retry`, doubling).
const PACING = { slow: 1 / 45, slowFor: 4, light: 0.55, lightFor: 8, retry: 20, warmup: 3 };
export const createPacingState = () => ({ fps: 60, slowTime: 0, lightTime: 0, wait: 0, retry: PACING.retry, warmup: PACING.warmup });
export function adaptPacing(state: ReturnType<typeof createPacingState>, delta: number, active: boolean, cpu: number) {
  if (!active || !Number.isFinite(delta) || delta <= 0 || delta > 0.25) {
    state.slowTime = 0; state.lightTime = 0; state.warmup = PACING.warmup;
    return state.fps;
  }
  if (state.warmup > 0) { state.warmup -= delta; return state.fps; }
  state.wait = Math.max(0, state.wait - delta);
  if (state.fps === 60) {
    state.slowTime = delta > PACING.slow ? state.slowTime + delta : Math.max(0, state.slowTime - delta * 0.5);
    if (state.slowTime >= PACING.slowFor) {
      state.fps = 30; state.slowTime = 0; state.lightTime = 0;
      state.wait = state.retry; state.retry *= 2;
    }
  } else {
    state.lightTime = cpu < (1 / 60) * PACING.light ? state.lightTime + delta : 0;
    if (state.lightTime >= PACING.lightFor && state.wait === 0) { state.fps = 60; state.lightTime = 0; state.warmup = PACING.warmup; }
  }
  return state.fps;
}
