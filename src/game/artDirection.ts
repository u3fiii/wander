import { PALETTE } from './palette.ts';

export type VisualQuality = 'low' | 'high';

// Main visual controls for the miniature-world look. Switch to `low` to
// reduce shadow resolution and pixel density on less capable devices.
export const VISUAL_QUALITY: VisualQuality = 'high';

export const ART_DIRECTION = {
  quality: VISUAL_QUALITY,
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
    sunIntensity: 1.05,
    skyFillColor: PALETTE.lightNightSkyFill,
    groundFillColor: PALETTE.lightNightGroundFill,
    hemisphereIntensity: 0.72,
    ambientColor: PALETTE.lightNightAmbient,
    ambientIntensity: 0.18,
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
    waterRoughness: 0.86,
    assetRoughness: 0.88,
    vehicleRoughness: 0.9,
  },
  qualityProfiles: {
    low: { shadowMapSize: 1536, maxDpr: 1.25 },
    high: { shadowMapSize: 3072, maxDpr: 1.6 },
  },
} as const;

export const ACTIVE_QUALITY = ART_DIRECTION.qualityProfiles[ART_DIRECTION.quality];
