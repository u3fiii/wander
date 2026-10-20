import { CAR_CONFIG, JUICE_CONFIG } from './config.ts';

// Everything that makes a drift: when one starts, how the car slides and looks, what scores, and how the camera
// and the slow-motion cut-in treat it. Tuned live from the Drift tab of the look panel and saved back to
// driftTuning.json by Apply (dev only); driftTuning.ts lays the saved values over the numbers below on load.

// A drift that lasts scores when it ends: on the road, at speed, long enough (difficulty.driftMinTime), and without
// hitting anything. Brief gaps (the slide flickering as the wheel crosses centre) up to `grace` don't end it.
export const DRIFT_SCORE = { minSpeed: 3.5, grace: 0.4, settle: 0.3 };
// Drift camera, once a slide has settled in: it swings out to the outside of the turn to show the car's
// angle, drops a little lower, widens the lens a touch and leans into the corner. All gentle, on smooth easing.
export const DRIFT_CAM = { swing: 2.4, drop: 0.9, fov: 4, roll: 0.025, attack: 2.6, release: 1.8 };
// The overhead slow-motion cut-in (a tight head-on near miss triggers it, see nearMissCut.ts): the camera
// shoots up to look straight down on the car from `height` m (with the car heading up the screen; `turn` can swing
// it round the car on the way, off by default) while time slows to `slowScale` (gentler than a crash, so the slide
// still moves), holds a moment, then comes back down more slowly to land behind the car again. All on real time.
// `rise` and `hold` are when it is fully up and when it starts back down; `rest` keeps it rare.
// `pullOut` lifts the shot further by the same distance the boost camera backs away and rises (× BOOST_FEEL's
// pullBack + rise), so the overhead view opens out about as wide as a boost's.
export const DRIFT_CINE = { duration: 1.8, rise: 0.35, hold: 0.65, slowScale: 0.35, height: 13, back: 0.5, turn: 0, rest: 15, pullOut: 0.136 };

export type DriftTuning = Record<DriftKey, number>;
type DriftKey = 'driftYawBoost' | 'driftGripBoost' | 'handbrakeDecel' | 'handbrakeStraightFactor' | 'driftEntryTime' | 'driftExitTime' | 'driftMinSpeed' | 'driftSteerMin' | 'driftSpeedRatio' | 'driftSteer' | 'driftAngleMax' | 'driftStiffness' | 'driftDamping'
  | 'scoreMinSpeed' | 'scoreGrace' | 'scoreSettle' | 'camSwing' | 'camDrop' | 'camFov' | 'camRoll' | 'camAttack' | 'camRelease' | 'cineSlowScale' | 'cineRest';

// Each tuning key and the number it sets.
// (The config objects hold other kinds of value too, so they are read and written as loose records.)
type Numbers = Record<string, unknown>;
const CAR = CAR_CONFIG as unknown as Numbers, JUICE = JUICE_CONFIG as unknown as Numbers;
const TARGETS: Record<keyof DriftTuning, [Numbers, string]> = {
  driftYawBoost: [CAR, 'driftYawBoost'], driftGripBoost: [CAR, 'driftGripBoost'], handbrakeDecel: [CAR, 'handbrakeDecel'], handbrakeStraightFactor: [CAR, 'handbrakeStraightFactor'],
  driftEntryTime: [CAR, 'driftEntryTime'], driftExitTime: [CAR, 'driftExitTime'],
  driftMinSpeed: [CAR, 'driftMinSpeed'], driftSteerMin: [CAR, 'driftSteerMin'],
  driftSpeedRatio: [JUICE, 'driftSpeedRatio'], driftSteer: [JUICE, 'driftSteer'], driftAngleMax: [JUICE, 'driftAngleMax'],
  driftStiffness: [JUICE, 'driftStiffness'], driftDamping: [JUICE, 'driftDamping'],
  scoreMinSpeed: [DRIFT_SCORE, 'minSpeed'], scoreGrace: [DRIFT_SCORE, 'grace'], scoreSettle: [DRIFT_SCORE, 'settle'],
  camSwing: [DRIFT_CAM, 'swing'], camDrop: [DRIFT_CAM, 'drop'], camFov: [DRIFT_CAM, 'fov'], camRoll: [DRIFT_CAM, 'roll'],
  camAttack: [DRIFT_CAM, 'attack'], camRelease: [DRIFT_CAM, 'release'],
  cineSlowScale: [DRIFT_CINE, 'slowScale'], cineRest: [DRIFT_CINE, 'rest'],
};
export function applyDriftTuning(values: DriftTuning) {
  for (const key of Object.keys(TARGETS) as Array<keyof DriftTuning>) {
    const [target, name] = TARGETS[key];
    target[name] = values[key];
  }
}
export const currentDriftTuning = (): DriftTuning => Object.fromEntries(
  (Object.keys(TARGETS) as Array<keyof DriftTuning>).map(key => [key, TARGETS[key][0][TARGETS[key][1]]])) as DriftTuning;

export const DRIFT_TUNING_SLIDERS: Array<{ key: keyof DriftTuning; label: string; min: number; max: number; step: number; group?: string }> = [
  { group: 'When a drift starts', key: 'driftMinSpeed', label: 'Slowest speed to drift', min: 1, max: 12, step: 0.1 },
  { key: 'driftSteerMin', label: 'Wheel turn needed (brake held)', min: 0.05, max: 0.8, step: 0.01 },
  { key: 'driftSpeedRatio', label: 'Fast slide: speed (× top speed)', min: 0.3, max: 1, step: 0.01 },
  { key: 'driftSteer', label: 'Fast slide: wheel turn needed', min: 0.3, max: 1, step: 0.01 },
  { group: 'How the car slides', key: 'driftYawBoost', label: 'Turn sharper in a drift', min: 1, max: 2.4, step: 0.01 },
  { key: 'driftGripBoost', label: 'Grip in a drift', min: 0.8, max: 3, step: 0.01 },
  { key: 'driftEntryTime', label: 'Slide builds over (s)', min: 0.02, max: 1, step: 0.01 },
  { key: 'driftExitTime', label: 'Slide straightens over (s)', min: 0.02, max: 1.5, step: 0.01 },
  { key: 'handbrakeDecel', label: 'Speed lost sliding (m/s²)', min: 0, max: 16, step: 0.1 },
  { key: 'handbrakeStraightFactor', label: 'Handbrake straight (× brakes)', min: 0, max: 1.5, step: 0.05 },
  { group: 'How the car looks', key: 'driftAngleMax', label: 'Body angle', min: 0, max: 0.6, step: 0.005 },
  { key: 'driftStiffness', label: 'Body snap', min: 10, max: 120, step: 1 },
  { key: 'driftDamping', label: 'Body settle', min: 2, max: 20, step: 0.5 },
  { group: 'What scores', key: 'scoreMinSpeed', label: 'Slowest speed that scores', min: 1, max: 12, step: 0.1 },
  { key: 'scoreGrace', label: 'Gap that does not end a drift (s)', min: 0, max: 1.5, step: 0.05 },
  { key: 'scoreSettle', label: 'Delay before the drift camera (s)', min: 0, max: 1.5, step: 0.05 },
  { group: 'Drift camera', key: 'camSwing', label: 'Swing out', min: 0, max: 6, step: 0.1 },
  { key: 'camDrop', label: 'Drop lower', min: 0, max: 3, step: 0.05 },
  { key: 'camFov', label: 'Widen the lens', min: 0, max: 14, step: 0.5 },
  { key: 'camRoll', label: 'Lean into the corner', min: 0, max: 0.12, step: 0.005 },
  { key: 'camAttack', label: 'Speed in', min: 0.5, max: 8, step: 0.1 },
  { key: 'camRelease', label: 'Speed out', min: 0.5, max: 8, step: 0.1 },
  { group: 'Overhead slow-motion (near miss uses it)', key: 'cineSlowScale', label: 'Slow motion speed', min: 0.1, max: 1, step: 0.01 },
  { key: 'cineRest', label: 'Rest between cut-ins (s)', min: 0, max: 60, step: 1 },
];
