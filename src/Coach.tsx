import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { Controls } from './game/driving';

// First-drive coach, in two layers.
// 1. Getting going (right after the start): only the throttle, then steering. Both answer the player live: the
//    key caps light up while pressed, the throttle bar fills with the car's speed and drains if they let go, and
//    each side of the steering is ticked as it is used. Once moving and turning, the coach steps aside.
// 2. Tips at the right moment, once each, and only for something not used yet: boost after a stretch of steady
//    driving, drift the first time the car takes a hard turn at speed. A tip just informs and fades by itself;
//    using the key while it shows ticks it.
// Shown until the first-drive lesson is completed. The × skips it.
type Phase = 'wait' | 'drive' | 'steer' | 'free' | 'off';
type Tip = 'boost' | 'drift';
const DRIVE_TARGET_KMH = 22;
const START_DELAY_MS = 900, DONE_HOLD_MS = 900, STEER_DONE_HOLD_MS = 500, TIP_SHOW_MS = 5500;
const BOOST_TIP = { afterDriving: 20, minKmh: 30 };
const DRIFT_TIP = { minKmh: 38, hardSteer: 0.45 };
// What the player has already used this visit, so tips never explain something they know.
const used = { boost: false, brake: false };
const shownTipsThisVisit = new Set<Tip>();

export default function Coach({ rails = false, active, controls, speed, offroad, boostReady, onComplete }: {
  rails?: boolean; active: boolean; controls: RefObject<Controls>; speed: number; offroad: boolean; boostReady: boolean; onComplete: () => void;
}) {
  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const [phase, setPhase] = useState<Phase>(rails ? 'steer' : 'wait');
  const [tip, setTip] = useState<{ kind: Tip; ticked: boolean } | null>(null);
  const [done, setDone] = useState(false);
  const [keys, setKeys] = useState({ forward: false, left: false, right: false });
  const [sides, setSides] = useState({ left: false, right: false });
  const live = useRef({ speed, offroad, boostReady });
  live.current = { speed, offroad, boostReady };
  const tipsShown = useRef(shownTipsThisVisit);

  useEffect(() => {
    if (!active || phase !== 'wait') return;
    const timer = window.setTimeout(() => setPhase('drive'), START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [active, phase]);

  // One watcher for everything: key lights, step completion and the moment for a tip.
  useEffect(() => {
    if (!active || phase === 'off' || phase === 'wait') return;
    let last = performance.now(), driving = 0, hardTurn = 0, steering = 0;
    const timer = window.setInterval(() => {
      const now = performance.now(), dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const c = controls.current, { speed: kmh, offroad: off, boostReady: ready } = live.current;
      const left = c.left || (c.steer ?? 0) > 0.2, right = c.right || (c.steer ?? 0) < -0.2;
      if (c.boost) used.boost = true;
      if (c.brake) used.brake = true;
      setKeys(k => (k.forward === c.forward && k.left === left && k.right === right ? k : { forward: c.forward, left, right }));
      if (phase === 'drive' && kmh >= DRIVE_TARGET_KMH) setDone(true);
      if (phase === 'steer') {
        if (left || right) steering += dt;
        setSides(s => (s.left === (s.left || left) && s.right === (s.right || right) ? s : { left: s.left || left, right: s.right || right }));
        if (!rails && steering > 1.6) setDone(true);
      }
      if (phase !== 'free') return;
      driving = !off && kmh > BOOST_TIP.minKmh ? driving + dt : driving;
      hardTurn = kmh > DRIFT_TIP.minKmh && (left || right) ? hardTurn + dt : 0;
      setTip(current => {
        if (current) return current.kind === 'boost' && c.boost || current.kind === 'drift' && c.brake && (left || right) ? { ...current, ticked: true } : current;
        if (!rails && !used.brake && !tipsShown.current.has('drift') && hardTurn > DRIFT_TIP.hardSteer) { tipsShown.current.add('drift'); return { kind: 'drift', ticked: false }; }
        if (!touch && !used.boost && ready && !tipsShown.current.has('boost') && driving > BOOST_TIP.afterDriving) { tipsShown.current.add('boost'); return { kind: 'boost', ticked: false }; }
        return null;
      });
      if (tipsShown.current.size === (rails ? 0 : touch ? 1 : 2) && !tip) setPhase('off');
    }, 50);
    return () => window.clearInterval(timer);
  }, [active, phase, controls, touch, tip, rails, onComplete]);

  // Steering is done once both sides have been used.
  useEffect(() => { if (phase === 'steer' && sides.left && sides.right) setDone(true); }, [phase, sides]);
  // A finished step shows its tick for a moment, then the next one comes.
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => {
      setDone(false);
      if (phase === 'steer') onComplete();
      setPhase(p => (p === 'drive' ? 'steer' : rails ? 'off' : 'free'));
    }, phase === 'steer' && rails ? STEER_DONE_HOLD_MS : DONE_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [done, phase, rails, onComplete]);
  // A tip fades by itself (sooner once ticked).
  useEffect(() => {
    if (!tip) return;
    const timer = window.setTimeout(() => setTip(null), tip.ticked ? DONE_HOLD_MS : TIP_SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [tip]);

  if (!active) return null;
  const tick = <b className="coach-tick">✓</b>;
  let body: ReactNode = null, className = 'coach', id = '';
  if (phase === 'drive') {
    id = 'drive';
    className += done ? ' ticked' : keys.forward ? ' working' : '';
    body = <>
      {!touch && <span className="coach-keys"><kbd className={keys.forward ? 'on' : ''}>W</kbd><kbd className={keys.forward ? 'on' : ''}>↑</kbd></span>}
      <span>{done ? 'You\'re moving!' : keys.forward ? 'Keep holding…' : touch ? 'Hold Gas to drive' : 'Hold to drive'}</span>
      {done ? tick : null}
      <i className="coach-fill" aria-hidden="true"><span style={{ transform: `scaleX(${Math.min(1, speed / DRIVE_TARGET_KMH)})` }} /></i>
    </>;
  } else if (phase === 'steer') {
    id = 'steer';
    className += done ? ' ticked' : '';
    body = <>
      {!touch && <span className="coach-keys">
        <kbd className={`${keys.left ? 'on' : ''}${sides.left ? ' used' : ''}`}>A</kbd><kbd className={`${keys.right ? 'on' : ''}${sides.right ? ' used' : ''}`}>D</kbd>
      </span>}
      <span>{done ? 'Nice, you\'ve got it.' : rails ? sides.left || sides.right ? 'Great! Now hold the other arrow' : 'Hold the bottom arrows to steer' : touch ? 'Turn the wheel to steer' : 'Steer left and right'}</span>
      {done ? tick : null}
    </>;
  } else if (tip) {
    id = tip.kind;
    className += ' tip' + (tip.ticked ? ' ticked' : '');
    body = tip.kind === 'boost'
      ? <>{!touch && <span className="coach-keys"><kbd>Shift</kbd></span>}<span>{tip.ticked ? 'Whoosh!' : 'Boost is ready'}</span>{tip.ticked ? tick : null}</>
      : <>{!touch && <span className="coach-keys"><kbd>Space</kbd></span>}<span>{tip.ticked ? 'Sideways!' : touch ? 'Hold Brake in a turn to drift' : 'Hold in a turn to drift'}</span>{tip.ticked ? tick : null}</>;
  }
  if (!body) return null;
  return <div data-phase={id} className={className} role="status">{body}</div>;
}
