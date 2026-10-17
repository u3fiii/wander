// Difficulty grows with the driver's level, from one number: `r` is 0 at level 1 and 1 at `FULL_LEVEL`, on a
// smooth S-curve, so the first levels stay easy for a while (quiet roads, generous near misses and drifts, quick
// boosts, kind penalties) and it then firms up and levels off. Every setting below is a straight blend between
// its easy value (r = 0) and its full value (r = 1); the game reads the live `difficulty` object.
const FULL_LEVEL = 12;
const RANGES = {
  trafficCars: [3, 7], // how many traffic cars are on the road (of 7)
  trafficSpeed: [0.85, 1.15], // traffic cruising speed, × its own
  nearMissGap: [0.9, 0.55], // a pass this close (m) to a car counts as a near miss
  nearMissStaticGap: [0.75, 0.5], // the same for trees, poles, rocks, houses
  nearMissSpeed: [7, 10], // minimum speed of the pass (m/s)
  nearMissRest: [2, 5], // seconds before another near miss gets the slow motion
  driftMinTime: [0.7, 1.2], // a drift scores once it lasts this long (s)
  boostCooldown: [0.7, 1.2], // boost recharge time, × the tuned one
  bonus: [1.25, 1], // positive points ×
  penalty: [0.4, 1], // crash and bump penalties ×
} as const;
export type Difficulty = { [K in keyof typeof RANGES]: number } & { r: number };

export function rampFor(level: number) {
  const t = Math.min(1, Math.max(0, (level - 1) / (FULL_LEVEL - 1)));
  return t * t * (3 - 2 * t);
}
export function difficultyAt(level: number): Difficulty {
  const r = rampFor(level);
  const values = Object.fromEntries(Object.entries(RANGES).map(([key, [easy, full]]) => [key, easy + (full - easy) * r]));
  return { ...values, r, trafficCars: Math.round(values.trafficCars) } as Difficulty;
}

export const difficulty: Difficulty = difficultyAt(1);
export function setDifficultyLevel(level: number) { Object.assign(difficulty, difficultyAt(level)); }

// Which traffic cars run as the count grows: spread round the loop and mixed between the two directions, so a
// quiet road still has someone coming both ways.
const TRAFFIC_ORDER = [0, 3, 5, 4, 2, 1, 6];
export const trafficActive = (index: number) => TRAFFIC_ORDER.indexOf(index) < difficulty.trafficCars;
