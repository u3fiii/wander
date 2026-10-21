import { CYCLE_LENGTH, TIME_OF_DAY } from './dayCycle.ts';

// The world's stages: one loop, each about a minute of driving. A stage sets the planet's look (its own theme in
// themes.ts, same order) and its time of day together, so the day no longer turns by itself:
// green day, the purple sky of dusk, golden amber, night, pink blossom, snow, and round again. In a run the next
// stage comes with every `STAGE_POINTS` points (about a minute at an ordinary pace); on the start screen, every
// `HOME_STAGE_SECONDS`. `name` is the short name the Stages tab uses; `clock` is its time of day as a share of the
// day's turn (dayCycle.ts); `accent`/`glow` colour the stage card. All tunable in the Stages tab (themes.ts).
// `icon`: which emblem the card shows (see LeaderboardChase). `homeClock`: the time of day on the start screen, when
// the stage has its own start-screen design (themes.ts Theme.home). `from`: for a stage added in the tab, the one it
// was made from.
export type Stage = { id: string; name: string; title: string; line: string; icon: string; clock: number; homeClock?: number; accent: string; glow: string; from?: string };
const at = (time: number) => time / CYCLE_LENGTH;
export const STAGES: Stage[] = [
  { id: 'meadow', icon: 'meadow', name: 'Green', title: 'GREEN AGAIN', line: 'A fresh morning on the loop', clock: at(TIME_OF_DAY.day), accent: '#8fd16a', glow: '#d6ff9a' },
  { id: 'dusk', icon: 'dusk', name: 'Purple', title: 'PURPLE HOUR', line: 'The sun slips under the hills', clock: at(TIME_OF_DAY.dusk), accent: '#b48cff', glow: '#ff9ed2' },
  { id: 'amber', icon: 'amber', name: 'Amber', title: 'GOLDEN ROAD', line: 'The world turns amber', clock: at(TIME_OF_DAY.day), accent: '#ffb347', glow: '#ffe08a' },
  { id: 'night', icon: 'night', name: 'Night', title: 'NIGHT DRIVE', line: 'Lights on, eyes open', clock: at(TIME_OF_DAY.night), accent: '#7aa2ff', glow: '#bfe0ff' },
  { id: 'blossom', icon: 'blossom', name: 'Pink', title: 'IN FULL BLOOM', line: 'Petals on the wind', clock: at(TIME_OF_DAY.day), accent: '#ff8fc4', glow: '#ffd0e6' },
  { id: 'frost', icon: 'frost', name: 'Snow', title: 'FIRST FROST', line: 'Snow on the hills', clock: at(TIME_OF_DAY.day), accent: '#9fd8ff', glow: '#ffffff' },
];
// The stage card, the same for every stage: how strongly the stage's colour tints it (`tint`), the glow in its
// top corner (`corner`) and its border (`border`), each 0..1.
export const cardLook = { tint: 0.38, corner: 0.28, border: 0.6 };
export const STAGE_POINTS = 3000;
export const HOME_STAGE_SECONDS = 30;

export const stageAt = (index: number) => STAGES[((index % STAGES.length) + STAGES.length) % STAGES.length];
// Each stage has its own theme, and the theme number counts on with the stage, round after round of the loop, so
// it never goes back (going back would switch at once instead of easing).
export const themeForStage = (index: number) => index;
// The stage's time of day on the clock (s): on the road, or on the start screen (`home`) if it has its own.
export const stageTime = (index: number, home = false) => {
  const stage = stageAt(index);
  return (home && stage.homeClock !== undefined ? stage.homeClock : stage.clock) * CYCLE_LENGTH;
};
// The first stage of a loop at or after `index`: a run always starts at the top of the loop.
export const nextMorning = (index: number) => Math.ceil(index / STAGES.length) * STAGES.length;
// How far a run is into its current stage (0..1), from its points.
export const stageProgress = (score: number) => (Math.max(0, score) % STAGE_POINTS) / STAGE_POINTS;
export const stagesReached = (score: number) => Math.floor(Math.max(0, score) / STAGE_POINTS);
