import { useEffect, useState } from 'react';

// Which kind of controls the player is using right now: the last one touched wins, so every prompt in the game can
// show the right buttons (keycaps, Xbox buttons or touch words) and swap the moment they pick up something else.
export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
let current: InputDevice = coarse ? 'touch' : 'keyboard';
const listeners = new Set<(device: InputDevice) => void>();
const set = (device: InputDevice) => { if (device === current) return; current = device; listeners.forEach(listener => listener(device)); };
export const inputDevice = () => current;

let watching = false;
function watch() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('keydown', event => { if (event.isTrusted) set('keyboard'); }, true);
  window.addEventListener('pointerdown', event => { set(event.pointerType === 'touch' ? 'touch' : coarse ? 'touch' : 'keyboard'); }, true);
  // A pad only counts once it is actually used (a stick pushed or a button pressed), not merely plugged in.
  const poll = () => {
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad?.connected) continue;
      if (pad.buttons.some(button => button.pressed || button.value > 0.5) || pad.axes.some(axis => Math.abs(axis) > 0.5)) set('gamepad');
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}

export function useInputDevice() {
  const [device, setDevice] = useState(current);
  useEffect(() => {
    watch();
    listeners.add(setDevice);
    setDevice(current);
    return () => { listeners.delete(setDevice); };
  }, []);
  return device;
}
