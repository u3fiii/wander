import { FULL_TURN, GLOBE_RADIUS, loopFrame, loopLatitude, loopMetric, setRoadLayout } from './globe.ts';
import type { RoadWave } from './globe.ts';
import { MOUNTAIN_SITES } from './worldMap.ts';
import { seededRandom } from './palette.ts';

// The road layout for each chapter of a run: chapter 0 is the original road; every later chapter adds its own
// few waves (a seeded pick, so a chapter always gets the same road). A pick is only kept if the road stays one a
// player can drive: no bend much tighter than the tightest of the original road, clear of the mountains, and away
// from the poles. Otherwise the next seed is tried.
export const ROAD_LAYOUT = {
  waves: 3,
  harmonics: [3, 4, 5, 6, 7],
  amplitude: [0.09, 0.17], // radians of latitude (× 30 m) at the equator
  maxBendRatio: 1.25, // vs the original road's sharpest bend
  maxLatitude: 1.15,
  mountainClearance: 12, // m from a mountain's centre to the road's centre line
  tries: 40,
};

const SAMPLES = 720;
// The road's bends: how fast its heading turns (rad per m), sampled round the loop.
export function bendProfile() {
  const bends: number[] = [];
  let previous = loopFrame(0).tangent;
  for (let index = 1; index <= SAMPLES; index++) {
    const angle = (index / SAMPLES) * FULL_TURN;
    const frame = loopFrame(angle);
    const tangent = frame.tangent;
    const dot = Math.max(-1, Math.min(1, previous[0] * tangent[0] + previous[1] * tangent[1] + previous[2] * tangent[2]));
    bends.push(Math.acos(dot) / (loopMetric(angle) * FULL_TURN / SAMPLES));
    previous = tangent;
  }
  return bends;
}

function mountainClearance() {
  let nearest = Infinity;
  for (const site of MOUNTAIN_SITES) {
    for (let index = 0; index < SAMPLES; index++) {
      const angle = (index / SAMPLES) * FULL_TURN;
      const latitude = loopLatitude(angle);
      const dLongitude = Math.atan2(Math.sin(site.longitude - angle), Math.cos(site.longitude - angle)) * Math.cos((latitude + site.latitude) / 2);
      nearest = Math.min(nearest, Math.hypot(site.latitude - latitude, dLongitude) * GLOBE_RADIUS);
    }
  }
  return nearest;
}

function pick(seed: number): RoadWave[] {
  const random = seededRandom(seed);
  const harmonics = [...ROAD_LAYOUT.harmonics];
  return Array.from({ length: ROAD_LAYOUT.waves }, () => {
    const k = harmonics.splice(Math.floor(random() * harmonics.length), 1)[0];
    const [low, high] = ROAD_LAYOUT.amplitude;
    // Higher harmonics bend harder for the same sideways reach, so they get less of it.
    const amplitude = (low + random() * (high - low)) * Math.min(1, 4 / k);
    return { k, amplitude, phase: random() * FULL_TURN };
  });
}

let baseSharpest: number | null = null;
const cache = new Map<number, RoadWave[]>();

// Whether the road as it is now is fine to drive (see ROAD_LAYOUT).
export function layoutIsDrivable(sharpestAllowed: number) {
  const bends = bendProfile();
  if (Math.max(...bends) > sharpestAllowed) return false;
  for (let index = 0; index < SAMPLES; index++) if (Math.abs(loopLatitude((index / SAMPLES) * FULL_TURN)) > ROAD_LAYOUT.maxLatitude) return false;
  return mountainClearance() >= ROAD_LAYOUT.mountainClearance;
}

// The waves for a chapter (none for the first), checked as above. Leaves the road set to them.
export function roadLayoutFor(chapter: number): RoadWave[] {
  if (chapter <= 0) { setRoadLayout([]); return []; }
  const known = cache.get(chapter);
  if (known) { setRoadLayout(known); return known; }
  if (baseSharpest === null) { setRoadLayout([]); baseSharpest = Math.max(...bendProfile()); }
  let chosen: RoadWave[] = [];
  for (let attempt = 0; attempt < ROAD_LAYOUT.tries; attempt++) {
    const waves = pick(chapter * 7919 + attempt * 104729);
    setRoadLayout(waves);
    if (layoutIsDrivable(baseSharpest * ROAD_LAYOUT.maxBendRatio)) { chosen = waves; break; }
  }
  setRoadLayout(chosen);
  cache.set(chapter, chosen);
  return chosen;
}
