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

export function selectVisualQuality({ forced, touch = false, cores = 8, memory = 8 }: {
  forced?: string | null; touch?: boolean; cores?: number; memory?: number;
}): VisualQuality {
  if (forced === 'low' || forced === 'mobile' || forced === 'high') return forced;
  if (touch) return cores <= 2 || memory <= 2 ? 'low' : 'mobile';
  return cores <= 4 || memory <= 4 ? 'low' : 'high';
}

export function resolutionBounds(profile: QualityProfile, deviceDpr: number) {
  const native = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1;
  const max = Math.min(native, profile.maxDpr);
  return { min: Math.min(max, profile.minDpr), max, initial: Math.min(max, profile.initialDpr) };
}

const ADAPT = { window: 1.5, slow: 1 / 55, smooth: 1 / 58, down: 0.15, up: 0.1, slowWindows: 2, goodWindows: 2, warmup: 3, recoveryDelay: 20 };
export const createResolutionState = () => ({ time: 0, frames: 0, good: 0, slow: 0, warmup: ADAPT.warmup, recovery: 0 });

// Sample active rendering only. Loading, tab switches and pause/resume must not
// count as GPU overload or contribute old samples toward a quality increase.
export function adaptResolution(state: ReturnType<typeof createResolutionState>, delta: number, active: boolean,
  dpr: number, bounds: { min: number; max: number }) {
  if (!active || !Number.isFinite(delta) || delta <= 0 || delta > 0.25) {
    Object.assign(state, createResolutionState());
    return dpr;
  }
  if (state.warmup > 0) { state.warmup -= delta; return dpr; }
  state.recovery = Math.max(0, state.recovery - delta);
  state.time += delta;
  state.frames++;
  if (state.time < ADAPT.window) return dpr;
  const average = state.time / state.frames;
  state.time = 0;
  state.frames = 0;
  let next = dpr;
  if (average > ADAPT.slow) {
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
