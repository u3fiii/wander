// The main knobs for changing how the game feels.
export const DRIVE = {
  acceleration: 13, braking: 26, rollingDrag: 2.1, maxSpeed: 23,
  reverseSpeed: 8, steering: 0.67, carRadius: 1.1, worldLimit: 119,
  spawn: { x: 3.5, z: 35, heading: 0 },
};
export const ROADS = [-108, -54, 0, 54, 108];
export const BLOCKS = [-81, -27, 27, 81];
export const CAMERA = { followDistance: 12, followHeight: 7, smoothing: 4 };
export const STOPS = [
  { x: 3.5, z: -25, name: 'زیر سایهٔ چنارها', hint: 'خیابان ولیعصر', label: 'ولیعصر' },
  { x: -28, z: -57.5, name: 'از کنار سینما رد شو', hint: 'خیابان سینما', label: 'سینما' },
  { x: -57.5, z: 26, name: 'یک سلام به آزادی', hint: 'کنار میدان آزادی', label: 'آزادی' },
  { x: -25, z: 57.5, name: 'وقت یک چای است', hint: 'کافهٔ سرِ کوچه', label: 'کافه' },
];
