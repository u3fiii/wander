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

// Road layouts: each chapter of a run (seasons.ts) bends the road a little differently, so its curves don't stay
// the same lap after lap. A layout adds a few gentle waves to the hand-shaped loop; they fade out round the bridge
// (`ROAD_ANCHORS`), where the road, the water channel and the bridge deck have to line up. No layout (the first
// chapter) is the original road. Everything built along the road reads it through these functions, so it follows.
export type RoadWave = { k: number; amplitude: number; phase: number };
// Round each anchor the waves are fully off within `still` (radians of longitude, wider than the bridge itself, as
// the road's smoothing below reaches 0.36 either way) and fade in by `clear`.
const ROAD_ANCHORS = [{ at: 1.56, still: 0.5, clear: 0.95 }];
let roadWaves: RoadWave[] = [];
// Bumped whenever the layout changes, for anything that caches what it worked out from the road.
export let roadLayoutVersion = 0;
// The layout's offset (and its slope) is tabulated round the loop when it is set: the road is read very often
// (physics, traffic, and many thousands of times while the world is built), so it must stay cheap.
const TABLE_SIZE = 2048;
const offsetTable = new Float64Array(TABLE_SIZE + 1);
const slopeTable = new Float64Array(TABLE_SIZE + 1);
export function setRoadLayout(waves: RoadWave[]) {
  if (waves.length === roadWaves.length && waves.every((wave, index) => wave.k === roadWaves[index].k
    && wave.amplitude === roadWaves[index].amplitude && wave.phase === roadWaves[index].phase)) return;
  roadWaves = waves;
  roadLayoutVersion++;
  for (let index = 0; index <= TABLE_SIZE; index++) {
    const angle = (index / TABLE_SIZE) * FULL_TURN;
    offsetTable[index] = exactOffset(angle);
    slopeTable[index] = (exactOffset(angle + 1e-4) - exactOffset(angle - 1e-4)) / 2e-4;
  }
}
function anchorMask(angle: number) {
  let mask = 1;
  for (const anchor of ROAD_ANCHORS) {
    const distance = Math.abs(Math.atan2(Math.sin(angle - anchor.at), Math.cos(angle - anchor.at)));
    const t = Math.max(0, Math.min(1, (distance - anchor.still) / (anchor.clear - anchor.still)));
    mask *= t * t * (3 - 2 * t);
  }
  return mask;
}
// The waves are in longitude, which shrinks towards the poles: scaled by cos² of the road's latitude there, they
// bend the road about as much wherever it runs.
function exactOffset(angle: number) {
  if (!roadWaves.length) return 0;
  let sum = 0;
  for (const wave of roadWaves) sum += wave.amplitude * Math.sin(wave.k * angle + wave.phase);
  const reach = Math.cos(shapeLatitude(angle));
  return anchorMask(angle) * reach * reach * sum;
}
function fromTable(table: Float64Array, angle: number) {
  if (!roadWaves.length) return 0;
  const at = (((angle / FULL_TURN) % 1) + 1) % 1 * TABLE_SIZE;
  const index = Math.floor(at), t = at - index;
  return table[index] + (table[index + 1] - table[index]) * t;
}
const layoutOffset = (angle: number) => fromTable(offsetTable, angle);
const layoutSlope = (angle: number) => fromTable(slopeTable, angle);

// The hand-shaped loop, before any layout.
function shapeLatitude(angle: number) {
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

function rawLoopLatitude(angle: number) {
  return shapeLatitude(angle) + layoutOffset(angle);
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
    + 0.66 * Math.sin(angle - 4.65) * southDetour
    + layoutSlope(angle);
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
