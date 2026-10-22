import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Flame } from 'lucide-react';
import type { CarState, Controls } from './game/driving';
import { CAR_CONFIG } from './game/config';
import { difficulty } from './game/difficulty';
import { playReady } from './game/audio';

// Boost meter beside the speedometer: a glass disc with a ring round it and a flame in the middle.
// - Charging: the ring fills, and the seconds left show in the label. Skilled moves top it up, shown as a "+%"
//   that floats off the meter with a flash of the ring.
// - Ready: the ring is full and gold, the disc breathes, and becoming ready gets a pop, a ripple and a soft chime.
// - Burning: the ring drains in fire colours while the flame flickers.
// Off the road a ready boost can't fire, so it dims and says so. It is also a button: tapping it boosts (the only
// way to boost on a touch screen), and on a keyboard it shows Shift.
const RING = 2 * Math.PI * 27;
export default function BoostGauge({ car, controls, offroad, mobile = false }: { car: RefObject<CarState>; controls: RefObject<Controls>; offroad: boolean; mobile?: boolean }) {
  const ring = useRef<SVGCircleElement>(null);
  const seconds = useRef<HTMLElement>(null);
  const [state, setState] = useState<'charging' | 'ready' | 'burning'>(() => (car.current.boostCharge >= 1 ? 'ready' : 'charging'));
  const [readyCount, setReadyCount] = useState(0);
  // A top-up from a skilled move: the share it added, shown as a little "+%" that floats off the meter.
  const [gain, setGain] = useState<{ id: number; amount: number } | null>(null);
  useEffect(() => {
    if (!gain) return;
    const timer = window.setTimeout(() => setGain(null), 1100);
    return () => window.clearTimeout(timer);
  }, [gain]);
  useEffect(() => {
    let frame = 0, last = state, lastCharge = car.current.boostCharge, gains = 0;
    const tick = () => {
      const c = car.current;
      const jump = c.boostCharge - lastCharge;
      if (!c.boosting && jump > 0.03) setGain({ id: ++gains, amount: Math.round(jump * 100) });
      lastCharge = c.boostCharge;
      const next = c.boosting ? 'burning' : c.boostCharge >= 1 ? 'ready' : 'charging';
      if (next !== last) {
        if (next === 'ready' && last === 'charging') { setReadyCount(n => n + 1); playReady(); }
        last = next;
        setState(next);
      }
      ring.current?.setAttribute('stroke-dashoffset', String(RING * (1 - c.boost)));
      if (seconds.current) seconds.current.textContent = next === 'charging' ? `${Math.ceil((1 - c.boostCharge) * CAR_CONFIG.boostCooldown * difficulty.boostCooldown)}s` : '';
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [car]);
  const blocked = state === 'ready' && offroad;
  const [shake, setShake] = useState(0);
  const press = (on: boolean) => {
    controls.current.boost = on;
    if (!on) return;
    // Felt as well as seen: a firm buzz when it fires, a double tick when it can't (off the road).
    if (state === 'ready' && !offroad) navigator.vibrate?.(28);
    else if (blocked) { navigator.vibrate?.([10, 40, 10]); setShake(n => n + 1); }
  };
  return <button
    // (Two classes taking turns restart the shake on each refused press without remounting the button mid-press.)
    className={`boost-gauge ${state}${blocked ? ' blocked' : ''}${shake ? ` refused-${shake % 2}` : ''}`}
    aria-label={state === 'ready' ? 'Boost ready' : state === 'burning' ? 'Boosting' : 'Boost charging'}
    onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); press(true); }}
    onPointerUp={() => press(false)} onPointerCancel={() => press(false)} onLostPointerCapture={() => press(false)}
  >
    <svg className="boost-dial" viewBox="0 0 64 64" aria-hidden="true">
      <defs><linearGradient id="boost-fire" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#ff5a36" /><stop offset="1" stopColor="#ffc35a" /></linearGradient></defs>
      <circle cx="32" cy="32" r="27" fill="none" className="boost-track" />
      <circle ref={ring} cx="32" cy="32" r="27" fill="none" className="boost-ring" strokeDasharray={RING} transform="rotate(-90 32 32)" />
    </svg>
    {readyCount > 0 && <i key={readyCount} className="boost-ripple" aria-hidden="true" />}
    {gain && <b key={gain.id} className="boost-gain" aria-hidden="true">+{gain.amount}%</b>}
    <Flame className="boost-flame" fill="currentColor" strokeWidth={1.5} />
    <span className="boost-label">{blocked ? 'Road only' : state === 'ready' ? mobile ? 'TAP TO BOOST!' : <><kbd>Shift</kbd> Ready</> : state === 'burning' ? 'Boost!' : <><span className="boost-label-word">Charging</span> <em ref={seconds} className="boost-seconds" /></>}</span>
  </button>;
}
