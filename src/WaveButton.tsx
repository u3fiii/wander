import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Controls } from './game/driving';
import { WAVE, runWave } from './game/wave';

// The shockwave button, the boost's twin on the other side (magenta to its gold): a glass disc with a ring that fills as it charges.
// - Charging: dim, the ring filling, the seconds left in the middle. Presses pass through (to the steering beneath).
// - Ready: a magenta disc, rings of light rolling out of it, and its name above it. Tap (or E, or RB) to fire.
// - Fired: it slams in, a burst rings out of it, and it starts charging again.
const RING = 2 * Math.PI * 27;
export default function WaveButton({ controls, mobile = false }: { controls: RefObject<Controls>; mobile?: boolean }) {
  const ring = useRef<SVGCircleElement>(null);
  const seconds = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(runWave.charge >= 1);
  const [fired, setFired] = useState(0);
  useEffect(() => {
    let frame = 0, last = runWave.charge >= 1, lastId = runWave.id;
    const tick = () => {
      const now = runWave.charge >= 1;
      if (now !== last) { last = now; setReady(now); }
      if (runWave.id !== lastId) { lastId = runWave.id; setFired(n => n + 1); }
      ring.current?.setAttribute('stroke-dashoffset', String(RING * (1 - runWave.charge)));
      if (seconds.current) {
        const need = runWave.firstDone ? WAVE.every : WAVE.firstAfter;
        seconds.current.textContent = now ? '' : `${Math.max(1, Math.ceil(need - runWave.charged))}s`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  const press = (on: boolean) => {
    controls.current.wave = on;
    if (on && runWave.charge >= 1) navigator.vibrate?.(30);
  };
  return <button
    className={`wave-button ${ready ? 'ready' : 'charging'}`}
    aria-label={ready ? 'Shockwave ready' : 'Shockwave charging'}
    onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); press(true); }}
    onPointerUp={() => press(false)} onPointerCancel={() => press(false)} onLostPointerCapture={() => press(false)}
  >
    <svg className="wave-dial" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="27" fill="none" className="wave-track" />
      <circle ref={ring} cx="32" cy="32" r="27" fill="none" className="wave-ring" strokeDasharray={RING} transform="rotate(-90 32 32)" />
    </svg>
    {fired > 0 && <i key={fired} className="wave-burst" aria-hidden="true" />}
    {/* The mark: a dot with two rings round it, the wave itself. */}
    <svg className="wave-mark" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="3.6" fill="currentColor" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="currentColor" strokeWidth="2.4" className="wave-mark-inner" />
      <circle cx="16" cy="16" r="13.5" fill="none" stroke="currentColor" strokeWidth="2" className="wave-mark-outer" />
    </svg>
    <em ref={seconds} className="wave-seconds" />
    {/* On phones the name shows only once it is ready; with a keyboard it is always there, like the boost's. */}
    {(ready || !mobile) && <span className="wave-label">{mobile ? 'SHOCKWAVE' : <><kbd>E</kbd> Shockwave</>}</span>}
  </button>;
}
