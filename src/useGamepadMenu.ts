import { useEffect, useRef } from 'react';
import { createEdges, createRepeater, currentPad, nearestInDirection } from './game/gamepad';
import type { Direction } from './game/gamepad';

// The pad's buttons outside the driving itself (which Scene reads): pausing, the map, the camera, and moving
// around the menus. Game actions go through the same keys the keyboard uses (a synthetic key press on the window),
// so every rule about when they apply stays in one place; menus are driven by moving the browser's focus.
const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), [role="button"]:not([aria-disabled="true"])';

const press = (code: string) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));

function visible(element: HTMLElement) {
  if (element.closest('[aria-hidden="true"], .touch-controls, [inert]')) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const style = getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none' && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
}

// The part of the page the pad moves around in: the topmost dialog, or else the whole page (the start screen,
// the map), or nothing while driving.
function menuScope(context: { started: boolean; mapView: boolean }): HTMLElement | null {
  const dialogs = document.querySelectorAll<HTMLElement>('.modal-shade');
  if (dialogs.length) return dialogs[dialogs.length - 1];
  return !context.started || context.mapView ? document.querySelector<HTMLElement>('main') : null;
}

function move(scope: HTMLElement, direction: Direction) {
  const items = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
  if (!items.length) return;
  const active = document.activeElement as HTMLElement | null;
  const from = active ? items.indexOf(active) : -1;
  if (from < 0) { (items.find(item => item.matches('[autofocus], .start-button, .primary')) ?? items[0]).focus(); return; }
  const next = nearestInDirection(items.map(item => item.getBoundingClientRect()), from, direction);
  if (next >= 0) items[next].focus();
}

export function useGamepadMenu(context: { started: boolean; ready: boolean; mapView: boolean; paused: boolean }) {
  const latest = useRef(context);
  latest.current = context;
  useEffect(() => {
    const edges = createEdges(['select', 'back', 'menu', 'map', 'camera'] as const);
    const repeat = { up: createRepeater(), down: createRepeater(), left: createRepeater(), right: createRepeater() };
    let frame = 0, seenPad = false;
    const showFocus = () => document.body.classList.add('gamepad-nav');
    const hideFocus = (event: Event) => { if (event.isTrusted) document.body.classList.remove('gamepad-nav'); };
    window.addEventListener('pointerdown', hideFocus);
    window.addEventListener('keydown', hideFocus);

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const pad = currentPad();
      if (!pad) { seenPad = false; return; }
      const { started, ready, mapView } = latest.current;
      // Party screens read the pads themselves (every pad is a player there).
      if (document.querySelector('.party-lobby, .party-final')) return;
      const scope = menuScope(latest.current);
      const pressed = edges(pad);
      // The first frame of a freshly connected pad only records what is held.
      if (!seenPad) { seenPad = true; return; }
      if (Object.values(pressed).some(Boolean) || pad.up || pad.down || pad.left || pad.right) showFocus();

      if (scope) {
        for (const direction of ['up', 'down', 'left', 'right'] as const) {
          if (repeat[direction](pad[direction], now)) { showFocus(); move(scope, direction); }
        }
        if (pressed.select) {
          showFocus();
          const active = document.activeElement as HTMLElement | null;
          if (active && scope.contains(active) && active !== document.body && active.matches(FOCUSABLE)) active.click();
          else if (!started && ready) press('KeyW');
          else move(scope, 'down');
        }
        if (pressed.back) {
          showFocus();
          // A dialog's own close button, else the same thing Esc does.
          const close = scope.querySelector<HTMLElement>('.close-button, [aria-label^="Close"]');
          if (close && visible(close)) close.click(); else press('Escape');
        }
      } else {
        for (const direction of ['up', 'down', 'left', 'right'] as const) repeat[direction](false, now);
        if (pressed.back || pressed.camera) press('KeyC');
      }
      if (pressed.camera && scope) press('KeyC');
      if (pressed.map && started) press('KeyM');
      if (pressed.menu) {
        if (!started) { if (ready) press('KeyW'); }
        else if (document.querySelector('.run-over')) (document.querySelector('.run-over .primary') as HTMLElement | null)?.click();
        else press('Escape');
      }
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointerdown', hideFocus); window.removeEventListener('keydown', hideFocus); document.body.classList.remove('gamepad-nav'); };
  }, []);
}
