// A near miss that earns a slow-motion cut-in gets one of two, picked at random:
//  - the overhead one (the camera rises to look straight down while time slows, with a purple grade), the drift's old
//    cut-in, unchanged;
//  - the faded, bleached one beside the car.
// `cutChance` is how likely a close enough pass is to get a cut-in at all, `overheadShare` how often that is the
// overhead one rather than the faded one. (How soon after one the next can come is the near-miss rest, difficulty.ts.)
export type NearMissCut = 'none' | 'overhead' | 'faded';
export function pickNearMissCut(roll: () => number, cutChance: number, overheadShare: number): NearMissCut {
  if (roll() >= cutChance) return 'none';
  return roll() < overheadShare ? 'overhead' : 'faded';
}
