import { PALETTE } from './palette.ts';

export type VisualQuality = 'low' | 'high';

// Picked per device at load: phones and tablets, and computers with few cores or little memory, get `low`
// (smaller shadows, fewer pixels, no depth-of-field pass, no multisampling); the rest get `high`. `?quality=low`
// or `?quality=high` in the address forces one. On top of this the scene trims its own resolution while frames run
// slow (see AdaptiveResolution in Scene.tsx).
function detectQuality(): VisualQuality {
  if (typeof window === 'undefined') return 'high';
  const forced = new URLSearchParams(window.location.search).get('quality');
  if (forced === 'low' || forced === 'high') return forced;
  const touch = window.matchMedia?.('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 8;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return touch || cores <= 4 || memory <= 4 ? 'low' : 'high';
}
export const VISUAL_QUALITY: VisualQuality = detectQuality();

export const ART_DIRECTION = {
  quality: VISUAL_QUALITY,
  // Miniature focus. Low quality bypasses both overview and driving effects.
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
  qualityProfiles: {
    // `minDpr` is as far as the adaptive resolution may drop; `msaa` is the samples of the post-processing target.
    low: { shadowMapSize: 1024, minDpr: 0.7, maxDpr: 1.25, depthOfField: false, msaa: 0 },
    high: { shadowMapSize: 2048, minDpr: 0.9, maxDpr: 1.5, depthOfField: true, msaa: 4 },
  },
} as const;

export const ACTIVE_QUALITY = ART_DIRECTION.qualityProfiles[ART_DIRECTION.quality];
