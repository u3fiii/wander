export const GLOBE_RADIUS = 30;
export const LOOP_LATITUDE = 0.04;
export const LOOP_RADIUS = GLOBE_RADIUS * Math.cos(LOOP_LATITUDE);
export const LOOP_LENGTH = Math.PI * 2 * LOOP_RADIUS;
export const LOOP_LANE_SPACING = GLOBE_RADIUS * 0.42;
export const LOOP_LANES = [-LOOP_LANE_SPACING, 0, LOOP_LANE_SPACING];
export const JUNCTION_ANGLES = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
export const FULL_TURN = Math.PI * 2;

export type Vec3 = [number, number, number];

export function globeNormal(x: number, z: number): Vec3 {
  const distance = Math.hypot(x, z);
  if (distance === 0) return [0, 1, 0];
  const angle = distance / GLOBE_RADIUS;
  const sin = Math.sin(angle);
  return [sin * x / distance, Math.cos(angle), sin * z / distance];
}

export function globePoint(x: number, y: number, z: number): Vec3 {
  const distance = Math.hypot(x, z);
  const angle = distance / GLOBE_RADIUS;
  const horizontalScale = angle === 0 ? 1 : Math.sin(angle) / angle;
  const [normalX, normalY, normalZ] = globeNormal(x, z);
  return [
    x * horizontalScale + normalX * y,
    GLOBE_RADIUS * (Math.cos(angle) - 1) + normalY * y,
    z * horizontalScale + normalZ * y,
  ];
}

export function sphereNormal(latitude: number, longitude: number): Vec3 {
  const cosLatitude = Math.cos(latitude);
  return [cosLatitude * Math.sin(longitude), Math.sin(latitude), cosLatitude * Math.cos(longitude)];
}

export function spherePoint(latitude: number, longitude: number, elevation = 0): Vec3 {
  const [x, y, z] = sphereNormal(latitude, longitude);
  const radius = GLOBE_RADIUS + elevation;
  return [x * radius, y * radius - GLOBE_RADIUS, z * radius];
}

function rawLoopLatitude(angle: number) {
  const frontDetour = Math.exp(1.5 * (Math.cos(angle - 1.05) - 1));
  const northDetour = Math.exp(2 * (Math.cos(angle - 2) - 1));
  const southDetour = Math.exp(2 * (Math.cos(angle - 4.65) - 1));
  return LOOP_LATITUDE
    + 0.6 * Math.sin(angle - 0.35)
    + 0.24 * Math.sin(angle * 3 + 0.7)
    + 0.07 * Math.sin(angle * 5 - 0.85)
    - 0.42 * frontDetour
    + 0.28 * northDetour
    - 0.33 * southDetour;
}

function rawLoopSlope(angle: number) {
  const frontDetour = Math.exp(1.5 * (Math.cos(angle - 1.05) - 1));
  const northDetour = Math.exp(2 * (Math.cos(angle - 2) - 1));
  const southDetour = Math.exp(2 * (Math.cos(angle - 4.65) - 1));
  return 0.6 * Math.cos(angle - 0.35)
    + 0.72 * Math.cos(angle * 3 + 0.7)
    + 0.35 * Math.cos(angle * 5 - 0.85)
    + 0.63 * Math.sin(angle - 1.05) * frontDetour
    - 0.56 * Math.sin(angle - 2) * northDetour
    + 0.66 * Math.sin(angle - 4.65) * southDetour;
}

// A circular low-pass filter keeps the large detours while spreading
// their change of direction over a wider distance. Using the same filter for
// the derivative keeps steering, traffic and rendered road geometry aligned.
const ROAD_SMOOTHING_STEP = 0.18;
const ROAD_SMOOTHING_WEIGHTS = [1, 4, 6, 4, 1] as const;

function coastBendCorrection(angle: number) {
  const delta = angle - 5.1;
  return 0.24 * Math.exp(6 * (Math.cos(delta) - 1))
    - 0.2 * Math.exp(3 * (Math.cos(delta) - 1));
}

function coastBendCorrectionSlope(angle: number) {
  const delta = angle - 5.1;
  return -1.44 * Math.sin(delta) * Math.exp(6 * (Math.cos(delta) - 1))
    + 0.6 * Math.sin(delta) * Math.exp(3 * (Math.cos(delta) - 1));
}

export function loopLatitude(angle: number, lane = 0) {
  const latitude = ROAD_SMOOTHING_WEIGHTS.reduce((sum, weight, index) => (
    sum + weight * rawLoopLatitude(angle + (index - 2) * ROAD_SMOOTHING_STEP)
  ), 0) / 16 + coastBendCorrection(angle);
  return latitude + lane / GLOBE_RADIUS;
}

function loopSlope(angle: number) {
  return ROAD_SMOOTHING_WEIGHTS.reduce((sum, weight, index) => (
    sum + weight * rawLoopSlope(angle + (index - 2) * ROAD_SMOOTHING_STEP)
  ), 0) / 16 + coastBendCorrectionSlope(angle);
}

export function roadLatitude(angle: number, _routeIndex = 0) {
  return loopLatitude(angle);
}

export function roadPoint(angle: number, routeIndex: number, elevation = 0): Vec3 {
  return spherePoint(roadLatitude(angle, routeIndex), angle, elevation);
}

export function roadFrame(angle: number, routeIndex: number, elevation = 0) {
  const latitude = roadLatitude(angle, routeIndex);
  const point = roadPoint(angle, routeIndex, elevation);
  const normal = sphereNormal(latitude, angle);
  const epsilon = 0.001;
  const before = roadPoint(angle - epsilon, routeIndex);
  const after = roadPoint(angle + epsilon, routeIndex);
  const tangent: Vec3 = [after[0] - before[0], after[1] - before[1], after[2] - before[2]];
  const length = Math.hypot(...tangent);
  tangent[0] /= length; tangent[1] /= length; tangent[2] /= length;
  return { latitude, point, normal, tangent };
}

export function roadMetric(angle: number, routeIndex: number) {
  const epsilon = 0.001;
  const before = roadPoint(angle - epsilon, routeIndex);
  const after = roadPoint(angle + epsilon, routeIndex);
  return Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]) / (2 * epsilon);
}

export function loopPoint(angle: number, lane = 0, elevation = 0): Vec3 {
  return spherePoint(loopLatitude(angle, lane), angle, elevation);
}

export function loopFrame(angle: number, lane = 0, elevation = 0) {
  const latitude = loopLatitude(angle, lane);
  const point = loopPoint(angle, lane, elevation);
  const normal = sphereNormal(latitude, angle);
  const slope = loopSlope(angle);
  const cosLatitude = Math.cos(latitude);
  const sinLatitude = Math.sin(latitude);
  // Exact derivative stays perpendicular to the surface, including near a pole.
  const tangent: Vec3 = [
    cosLatitude * Math.cos(angle) - slope * sinLatitude * Math.sin(angle),
    slope * cosLatitude,
    -cosLatitude * Math.sin(angle) - slope * sinLatitude * Math.cos(angle),
  ];
  const tangentLength = Math.hypot(...tangent);
  tangent[0] /= tangentLength; tangent[1] /= tangentLength; tangent[2] /= tangentLength;
  return {
    latitude,
    point,
    normal,
    tangent,
  };
}

export function loopMetric(angle: number, lane = 0) {
  return GLOBE_RADIUS * Math.hypot(Math.cos(loopLatitude(angle, lane)), loopSlope(angle));
}
