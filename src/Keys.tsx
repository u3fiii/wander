import type { InputDevice } from './inputDevice';

// The buttons for a game action, drawn for the device in use: keycaps, Xbox buttons (in their own colours) or a word
// for touch. One table, so every prompt, hint and help row agrees.
export type Action = 'steer' | 'gas' | 'brake' | 'drift' | 'boost' | 'recover' | 'camera' | 'map' | 'pause' | 'restart';

const KEYBOARD: Record<Action, string[]> = {
  steer: ['A', 'D'], gas: ['W'], brake: ['S'], drift: ['Space'], boost: ['Shift'], recover: ['F'], camera: ['C'], map: ['M'], pause: ['Esc'], restart: ['R'],
};
const GAMEPAD: Record<Action, string[]> = {
  steer: ['LS'], gas: ['RT'], brake: ['LT'], drift: ['A'], boost: ['X'], recover: ['Y'], camera: ['B'], map: ['View'], pause: ['Menu'], restart: [],
};
const TOUCH: Partial<Record<Action, string>> = { steer: 'Hold left / right', boost: 'Tap the flame', drift: 'Brake in a turn', gas: 'Gas pedal' };

export const keysFor = (action: Action, device: InputDevice) => (device === 'gamepad' ? GAMEPAD[action] : KEYBOARD[action]);

export function Keys({ action, device, lit = [] }: { action: Action; device: InputDevice; lit?: string[] }) {
  if (device === 'touch') return TOUCH[action] ? <span className="keys touch">{TOUCH[action]}</span> : null;
  const keys = keysFor(action, device);
  if (!keys.length) return null;
  return <span className={`keys ${device}`}>
    {keys.map(key => <kbd key={key} className={`glyph${device === 'gamepad' ? ` pad pad-${key.toLowerCase()}` : ''}${key.length > 2 ? ' wide' : ''}${lit.includes(key) ? ' on' : ''}`}>{key}</kbd>)}
  </span>;
}
