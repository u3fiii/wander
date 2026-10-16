import { PALETTE } from './palette.ts';

export type VisualQuality = 'low' | 'high';

// Main visual controls for the miniature-world look. Switch to `low` to
// reduce shadow resolution and pixel density on less capable devices.
export const VISUAL_QUALITY: VisualQuality = 'high';

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
    sunIntensity: 2.65,
    skyFillColor: PALETTE.lightDaySkyFill,
    groundFillColor: PALETTE.lightDayGroundFill,
    hemisphereIntensity: 1.35,
    ambientColor: PALETTE.lightDayAmbient,
    ambientIntensity: 0.22,
    rimColor: PALETTE.lightDayRim,
    rimIntensity: 0.42,
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
    low: { shadowMapSize: 1536, maxDpr: 1.25, depthOfField: false },
    high: { shadowMapSize: 3072, maxDpr: 1.6, depthOfField: true },
  },
} as const;

export const ACTIVE_QUALITY = ART_DIRECTION.qualityProfiles[ART_DIRECTION.quality];
