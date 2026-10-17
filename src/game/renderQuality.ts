export type VisualQuality = 'low' | 'mobile' | 'high';

// Image clarity and scenery cost are separate budgets. Touch devices keep sharp
// pixels, but spend less on small decorations, their shadows and depth of field.
export const QUALITY_PROFILES = {
  low: {
    shadowMapSize: 1024, minDpr: 1, initialDpr: 1.25, maxDpr: 1.25,
    depthOfField: false, msaa: 0, decorationDensity: 0.35, decorativeShadows: false, simpleSwimRings: true,
  },
  mobile: {
    shadowMapSize: 1024, minDpr: 1.25, initialDpr: 1.75, maxDpr: 2,
    depthOfField: false, msaa: 0, decorationDensity: 0.5, decorativeShadows: false, simpleSwimRings: true,
  },
  high: {
    shadowMapSize: 2048, minDpr: 0.9, initialDpr: 1.5, maxDpr: 1.5,
    depthOfField: true, msaa: 4, decorationDensity: 1, decorativeShadows: true, simpleSwimRings: false,
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

const ADAPT = { window: 1.5, slow: 1 / 48, smooth: 1 / 57, down: 0.15, up: 0.1, slowWindows: 2, goodWindows: 4, warmup: 3 };
export const createResolutionState = () => ({ time: 0, frames: 0, good: 0, slow: 0, warmup: ADAPT.warmup });

// Sample active rendering only. Loading, tab switches and pause/resume must not
// count as GPU overload or contribute old samples toward a quality increase.
export function adaptResolution(state: ReturnType<typeof createResolutionState>, delta: number, active: boolean,
  dpr: number, bounds: { min: number; max: number }) {
  if (!active || !Number.isFinite(delta) || delta <= 0 || delta > 0.25) {
    Object.assign(state, createResolutionState());
    return dpr;
  }
  if (state.warmup > 0) { state.warmup -= delta; return dpr; }
  state.time += delta;
  state.frames++;
  if (state.time < ADAPT.window) return dpr;
  const average = state.time / state.frames;
  state.time = 0;
  state.frames = 0;
  let next = dpr;
  if (average > ADAPT.slow) {
    state.good = 0;
    if (++state.slow >= ADAPT.slowWindows) { next -= ADAPT.down; state.slow = 0; }
  } else if (average < ADAPT.smooth) {
    state.slow = 0;
    if (++state.good >= ADAPT.goodWindows) { next += ADAPT.up; state.good = 0; }
  } else {
    state.good = 0;
    state.slow = 0;
  }
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(next * 100) / 100));
}
