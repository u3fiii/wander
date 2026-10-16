// The only place scene colors are defined. Everything 3D picks from here.
export const PALETTE = {
  // Base (~60%)
  land: '#aebc70',
  coastWall: '#b8a46a',
  sand: '#ecd9a4',
  // Loose earth kicked up off-road: dry, a little warmer than the grass.
  soil: '#9c8058',
  // Football pitch: warm orange turf, in the same warm family as the bridge and the village roofs.
  pitchOrange: '#e0894f',
  fieldStone: '#dccaa2',
  pavingLight: '#d8c7a0',
  pavingDark: '#b9a57e',
  oceanDeep: '#4f9ccc',
  oceanShallow: '#8fd0ec',
  // Road
  road: '#4a4f55',
  roadShoulder: '#8f9187',
  roadMarking: '#f2e6c4',
  bridgeAccent: '#e2795a',
  // Trees
  mainTree: '#86a84c',
  darkTree: '#5f8a45',
  lightTree: '#a8c060',
  accentTree: '#e0a948',
  trunk: '#8a6a4a',
  birchTrunk: '#f3ede0',
  // Houses
  buildingGreen: '#70956b',
  roofSage: '#7a9566',
  roofWarmBrown: '#8a6a4a',
  roofAccent: '#e2795a',
  wallWarmWhite: '#f3ede0',
  wallCream: '#e8dcc0',
  windows: '#3e4d5c',
  doorsTrim: '#8a6a4a',
  // Cars
  carRed: '#d9604c',
  carYellow: '#e8b64c',
  carBlue: '#5b86b8',
  carMint: '#8cc7a5',
  carCream: '#efe4cc',
  tires: '#2f3338',
  // Details
  clouds: '#ffffff',
  flowerCream: '#f2e6c4',
  transparentClear: '#000000',
  // Lighting (unchanged values, kept here so no hex lives elsewhere)
  lightDaySun: '#ffc985',
  lightDaySkyFill: '#eef0e2',
  lightDayGroundFill: '#9a9466',
  lightDayAmbient: '#fff3df',
  lightDayRim: '#ffd2a2',
  lightDayFog: '#cfe1dc',
  lightDayBounce: '#f0dcc0',
  haze: '#cfe8ee',
  atmosphere: '#e4fbff',
  sunWarm: '#fff4e0',
  lightNightSun: '#b9d4ff',
  lightNightSkyFill: '#789bc7',
  lightNightGroundFill: '#29384a',
  lightNightAmbient: '#718bad',
  lightNightRim: '#58779f',
  lightNightFog: '#29445b',
  lightNightBounce: '#38537d',
  boostViolet: '#9b84f4',
  boostPink: '#f08fce',
  boostRim: '#dda2ff',
} as const;

export type PaletteKey = keyof typeof PALETTE;
type Weighted = ReadonlyArray<readonly [PaletteKey, number]>;

export const ROOF_WEIGHTS: Weighted = [['roofAccent', 0.4], ['roofSage', 0.35], ['roofWarmBrown', 0.25]];
export const WALL_WEIGHTS: Weighted = [['wallWarmWhite', 0.5], ['wallCream', 0.35], ['buildingGreen', 0.15]];
export const TREE_WEIGHTS: Weighted = [['mainTree', 0.7], ['darkTree', 0.1], ['lightTree', 0.1], ['accentTree', 0.1]];
export const CAR_COLORS: PaletteKey[] = ['carRed', 'carYellow', 'carBlue', 'carMint', 'carCream'];
export const FLOWER_COLORS: PaletteKey[] = ['mainTree', 'flowerCream', 'accentTree', 'bridgeAccent'];

// Lightness jitter per instance, as a fraction (offsetHSL lightness).
export const JITTER = { houses: 0.05, trees: 0.08, cars: 0.03 } as const;

// Deterministic mulberry32 so layout and colors are identical on every load.
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function weightedPick(random: () => number, options: Weighted, exclude: ReadonlySet<PaletteKey> = new Set()): PaletteKey {
  const allowed = options.filter(([key]) => !exclude.has(key));
  const pool = allowed.length ? allowed : options;
  const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [key, weight] of pool) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return pool[pool.length - 1][0];
}
