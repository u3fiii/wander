import { PALETTE } from './palette.ts';
import { QUALITY_PROFILES, selectVisualQuality } from './renderQuality.ts';
import type { VisualQuality } from './renderQuality.ts';

export type { VisualQuality } from './renderQuality.ts';

export const QUALITY_FALLBACK_KEY = 'wander:quality-fallback';
const SLOW_VISITS_KEY = 'wander:slow-visits';
function storedFallback() {
  try { return window.localStorage.getItem(QUALITY_FALLBACK_KEY); } catch { return null; }
}
// A visit on this tier ran far too slow. One bad visit could be anything (a busy machine, a throttled window), so the
// lighter tier is remembered only after the second.
export function recordSlowVisit(tier: VisualQuality, lighter: VisualQuality) {
  try {
    const [seen, count] = (window.localStorage.getItem(SLOW_VISITS_KEY) ?? '').split(':');
    const visits = seen === tier ? Number(count) + 1 : 1;
    window.localStorage.setItem(SLOW_VISITS_KEY, `${tier}:${visits}`);
    if (visits >= 2) window.localStorage.setItem(QUALITY_FALLBACK_KEY, lighter);
  } catch { /* storage off: nothing to remember */ }
}

// Phones/tablets use a sharp but lighter scene; only constrained devices get low.
// ?quality=low|mobile|high allows comparison on the same device.
export const FORCED_QUALITY = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('quality');
function detectQuality(): VisualQuality {
  if (typeof window === 'undefined') return 'high';
  return selectVisualQuality({
    forced: FORCED_QUALITY,
    touch: window.matchMedia?.('(pointer: coarse)').matches,
    cores: navigator.hardwareConcurrency,
    memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    console: /Xbox|PlayStation|Nintendo/i.test(navigator.userAgent),
    fallback: storedFallback(),
  });
}
export const VISUAL_QUALITY: VisualQuality = detectQuality();

export const ART_DIRECTION = {
  quality: VISUAL_QUALITY,
  // Miniature focus. Mobile/low skip depth of field, retaining colour effects.
  introDepthOfField: {
    enabled: true,
    focusRangeFactor: 0.4,
    surfaceOffset: 1,
    aperture: 0.0003,
    maxBlur: 0.0035,
    damping: 5,
  },
  drivingDepthOfField: {
    enabled: true,
    focusRange: 11,
    lookAhead: 5,
    aperture: 0.00015,
    maxBlur: 0.0016,
    transitionEnd: 0.65,
  },
  // Crash cut-in on a negative hit: a razor-thin sharp band locked on the crash, heavy blur front and back.
  crashDepthOfField: {
    focusRange: 2.2,
    aperture: 0.0028,
    maxBlur: 0.016,
  },
  // Short cinematic emphasis during a real boost burst; near-field blur stays off.
  boostDepthOfField: {
    enabled: true,
    focusRange: 4,
    aperture: 0.0016,
    maxBlur: 0.011,
    attack: 10,
    release: 4,
  },
  day: {
    exposure: 1.03,
    sunColor: PALETTE.lightDaySun,
    sunIntensity: 2.25,
    skyFillColor: PALETTE.lightDaySkyFill,
    groundFillColor: PALETTE.lightDayGroundFill,
    hemisphereIntensity: 1.45,
    ambientColor: PALETTE.lightDayAmbient,
    ambientIntensity: 0.22,
    rimColor: PALETTE.lightDayRim,
    rimIntensity: 0.5,
    fogColor: PALETTE.lightDayFog,
    bounceColor: PALETTE.lightDayBounce,
  },
  night: {
    exposure: 0.82,
    sunColor: PALETTE.lightNightSun,
    // Moonlight: cool and a little lower, so the warm windows and street lamps carry the night.
    sunIntensity: 0.85,
    skyFillColor: PALETTE.lightNightSkyFill,
    groundFillColor: PALETTE.lightNightGroundFill,
    hemisphereIntensity: 0.6,
    ambientColor: PALETTE.lightNightAmbient,
    ambientIntensity: 0.14,
    rimColor: PALETTE.lightNightRim,
    rimIntensity: 0.25,
    fogColor: PALETTE.lightNightFog,
    bounceColor: PALETTE.lightNightBounce,
  },
  atmosphere: {
    overviewNear: 78,
    overviewFar: 158,
    drivingNear: 42,
    drivingFar: 112,
  },
  shadows: {
    extent: 42,
    near: 1,
    far: 180,
    bias: -0.00012,
    normalBias: 0.025,
    radius: 3,
  },
  materials: {
    asphaltRoughness: 0.95,
    waterRoughness: 0.97,
    assetRoughness: 0.88,
    vehicleRoughness: 0.9,
  },
  qualityProfiles: QUALITY_PROFILES,
} as const;

export const ACTIVE_QUALITY = ART_DIRECTION.qualityProfiles[ART_DIRECTION.quality];
