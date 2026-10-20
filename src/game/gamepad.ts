// Xbox / standard-mapping gamepad: driving and menus.
//
// While driving: RT gas, LT brake and reverse, left stick steers, A handbrake (drift), X or RB boost, LB gentle
// throttle, Y back to the road, B or right-stick click changes the camera, View (⧉) opens the map, Menu (☰)
// pauses. In menus and on the start screen the d-pad or left stick moves between buttons, A presses the focused
// one, B goes back, and Menu starts or resumes.
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
} as const;

type PadLike = { buttons: ReadonlyArray<{ pressed: boolean; value: number }>; axes: ReadonlyArray<number> };

const held = (pad: PadLike, index: number) => !!pad.buttons[index]?.pressed || (pad.buttons[index]?.value ?? 0) > 0.5;

// Everything the game reads from a pad in one place. Analog values are raw (the game shapes them).
export function readPadState(pad: PadLike) {
  return {
    throttle: pad.buttons[PAD.RT]?.value ?? 0,
    brake: pad.buttons[PAD.LT]?.value ?? 0,
    steer: pad.axes[0] ?? 0,
    handbrake: held(pad, PAD.A),
    boost: held(pad, PAD.X) || held(pad, PAD.RB),
    gentle: held(pad, PAD.LB),
    recover: held(pad, PAD.Y),
    camera: held(pad, PAD.RS),
    map: held(pad, PAD.VIEW),
    menu: held(pad, PAD.MENU),
    select: held(pad, PAD.A),
    back: held(pad, PAD.B),
    up: held(pad, PAD.UP) || (pad.axes[1] ?? 0) < -STICK_NAV,
    down: held(pad, PAD.DOWN) || (pad.axes[1] ?? 0) > STICK_NAV,
    left: held(pad, PAD.LEFT) || (pad.axes[0] ?? 0) < -STICK_NAV,
    right: held(pad, PAD.RIGHT) || (pad.axes[0] ?? 0) > STICK_NAV,
  };
}
export type PadState = ReturnType<typeof readPadState>;
const STICK_NAV = 0.6;

// The first connected pad's state, or nothing.
export function currentPad(): PadState | null {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  for (const pad of pads) if (pad && pad.connected) return readPadState(pad);
  return null;
}

// Press edges: true for a button only on the frame it goes down. Keeps the last frame's state.
export function createEdges<K extends string>(keys: readonly K[]) {
  const previous = {} as Record<K, boolean>;
  keys.forEach(key => { previous[key] = false; });
  return (state: Record<K, boolean>) => {
    const pressed = {} as Record<K, boolean>;
    for (const key of keys) { pressed[key] = state[key] && !previous[key]; previous[key] = state[key]; }
    return pressed;
  };
}

// Auto-repeat for holding a direction in a menu: fires at once, then after `first` ms, then every `every` ms.
export function createRepeater(first = 380, every = 130) {
  let since = 0, pressedAt = -1, fired = 0;
  return (down: boolean, now: number) => {
    if (!down) { pressedAt = -1; fired = 0; return false; }
    if (pressedAt < 0) { pressedAt = now; since = now; fired = 1; return true; }
    const due = fired === 1 ? first : every;
    if (now - since >= due) { since = now; fired = 2; return true; }
    return false;
  };
}

export type Rect = { left: number; top: number; width: number; height: number };
export type Direction = 'up' | 'down' | 'left' | 'right';

// Menu navigation: the index of the rect to move to from `from` in a direction, or -1. A rect counts if its
// centre lies in that half-plane; those straighter ahead win over those off to the side, then the nearer.
export function nearestInDirection(rects: Rect[], from: number, direction: Direction) {
  const centre = (rect: Rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  const origin = centre(rects[from]);
  let best = -1, bestScore = Infinity;
  rects.forEach((rect, index) => {
    if (index === from) return;
    const c = centre(rect);
    const dx = c.x - origin.x, dy = c.y - origin.y;
    const along = direction === 'up' ? -dy : direction === 'down' ? dy : direction === 'left' ? -dx : dx;
    const across = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy);
    if (along <= 1) return;
    // Off-axis counts double: a button straight below beats a nearer one far to the side.
    const score = along + across * 2;
    if (score < bestScore) { bestScore = score; best = index; }
  });
  return best;
}
