import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Gauge, Heart, Sparkles } from 'lucide-react';
import type { Controls } from './game/driving';
import { Keys } from './Keys';
import { currentPad } from './game/gamepad';
import type { InputDevice } from './inputDevice';

// The guide: teaching by doing, one thing at a time, in the player's own buttons (keyboard, Xbox pad or touch).
// 1. The first drive (a short lesson). On a computer the car already rolls on by itself, so it starts with steering
//    (both sides ticked as they are used), then holding the gas to go faster. On a phone the car drives itself and
//    the player only steers (the steering pads carry their own HOLD labels). The lesson ends by letting the traffic in.
// 2. The goal, once, as the traffic arrives: slip past cars to score (closer pays more), crashes cost hearts.
// 3. Tips at the right moment, once ever and only for something not used yet: drift on the first hard turn at speed,
//    boost the first time it is ready, and the camera and map after a while. A tip informs and fades by itself; using
//    it while it shows ticks it.
// Every prompt answers live: keys light while held, a bar fills with speed, a tick when done. The × skips the lesson.
const STEP_GIVE_UP_S = 20;

type Phase = 'wait' | 'steer' | 'speed' | 'goal' | 'free';
type Tip = 'goal' | 'drift' | 'boost' | 'views';
const SPEED_TARGET_KMH = 40;
const START_DELAY_MS = 900, DONE_HOLD_MS = 900, STEER_DONE_HOLD_MS = 500, TIP_SHOW_MS = 6000, GOAL_SHOW_MS = 6500;
const DRIFT_TIP = { minKmh: 36, hardSteer: 0.45 };
const VIEWS_TIP_AFTER = 45;

// What the player has used or been shown, kept in the browser, so nothing is ever explained twice.
const SEEN_KEY = 'wander:tips-seen';
const loadSeen = () => { try { return new Set<Tip>(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')); } catch { return new Set<Tip>(); } };
const seen = loadSeen();
const markSeen = (tip: Tip) => { seen.add(tip); try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch { /* storage unavailable */ } };
const used = { boost: false, drift: false, views: false };

export default function Coach({ rails = false, lesson, active, controls, speed, offroad, boostReady, trafficOn, device, onComplete, onSkip, onShowingChange }: {
  rails?: boolean; lesson: boolean; active: boolean; controls: RefObject<Controls>; speed: number; offroad: boolean; boostReady: boolean;
  trafficOn: boolean; device: InputDevice; onComplete: () => void; onSkip?: () => void; onShowingChange?: (showing: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>(lesson ? (rails ? 'steer' : 'wait') : 'free');
  const [tip, setTip] = useState<{ kind: Tip; ticked: boolean } | null>(null);
  const [done, setDone] = useState(false);
  const [keys, setKeys] = useState({ gas: false, left: false, right: false });
  const [sides, setSides] = useState({ left: false, right: false });
  const live = useRef({ speed, offroad, boostReady, trafficOn });
  live.current = { speed, offroad, boostReady, trafficOn };

  useEffect(() => {
    if (!active || phase !== 'wait') return;
    const timer = window.setTimeout(() => setPhase('steer'), START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [active, phase]);

  // One watcher for everything: lit keys, step completion and the moment for a tip.
  useEffect(() => {
    if (!active || phase === 'wait') return;
    let last = performance.now(), steering = 0, hardTurn = 0, free = 0, stepTime = 0;
    const timer = window.setInterval(() => {
      const now = performance.now(), dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const c = controls.current, { speed: kmh, offroad: off, boostReady: ready, trafficOn: traffic } = live.current;
      // The pad is read by the scene, not through controls, so the lesson reads it too.
      const pad = currentPad();
      const padSteer = pad ? pad.steer : 0;
      const left = c.left || (c.steer ?? 0) > 0.2 || padSteer < -0.35, right = c.right || (c.steer ?? 0) < -0.2 || padSteer > 0.35;
      const gas = c.forward || (c.throttle ?? 0) > 0.2 || (pad?.throttle ?? 0) > 0.2;
      const boost = c.boost || !!pad?.boost, brake = c.brake || !!pad?.handbrake;
      if (boost) used.boost = true;
      if (brake && (left || right)) used.drift = true;
      setKeys(k => (k.gas === gas && k.left === left && k.right === right ? k : { gas, left, right }));
      if (phase === 'steer') {
        if (left || right) steering += dt;
        setSides(s => (s.left === (s.left || left) && s.right === (s.right || right) ? s : { left: s.left || left, right: s.right || right }));
        if (!rails && steering > 1.6) setDone(true);
      }
      if (phase === 'speed' && kmh >= SPEED_TARGET_KMH) setDone(true);
      // A step never holds the lesson up for long: whatever the input, it moves on (and the traffic comes in).
      if (phase === 'steer' || phase === 'speed') { stepTime += dt; if (stepTime > STEP_GIVE_UP_S) setDone(true); }
      if (phase === 'goal') {
        if (traffic && !seen.has('goal')) { markSeen('goal'); setTip({ kind: 'goal', ticked: false }); setPhase('free'); }
        else if (seen.has('goal')) setPhase('free');
        return;
      }
      if (phase !== 'free') return;
      free += dt;
      hardTurn = kmh > DRIFT_TIP.minKmh && (left || right) && !off ? hardTurn + dt : 0;
      setTip(current => {
        if (current) {
          const ticked = current.kind === 'boost' && boost || current.kind === 'drift' && brake && (left || right);
          return ticked && !current.ticked ? { ...current, ticked: true } : current;
        }
        const show = (kind: Tip) => { markSeen(kind); return { kind, ticked: false }; };
        // (Not during the camera's swoop down at the start: once the car has been rolling a moment.)
        if (traffic && !seen.has('goal') && free > 3 && kmh > 8) return show('goal');
        if (!rails && !used.drift && !seen.has('drift') && hardTurn > DRIFT_TIP.hardSteer) return show('drift');
        if (!used.boost && ready && !seen.has('boost')) return show('boost');
        if (!rails && !seen.has('views') && free > VIEWS_TIP_AFTER) return show('views');
        return null;
      });
    }, 50);
    return () => window.clearInterval(timer);
  }, [active, phase, controls, rails]);

  // Steering is done once both sides have been used.
  useEffect(() => { if (phase === 'steer' && sides.left && sides.right) setDone(true); }, [phase, sides]);
  // A finished step shows its tick for a moment, then the next one comes; the last one lets the traffic in.
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => {
      setDone(false);
      if (phase === 'steer' && !rails) { setPhase('speed'); return; }
      onComplete();
      setPhase('goal');
    }, phase === 'steer' && rails ? STEER_DONE_HOLD_MS : DONE_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [done, phase, rails, onComplete]);
  // A tip fades by itself (sooner once ticked).
  useEffect(() => {
    if (!tip) return;
    const timer = window.setTimeout(() => setTip(null), tip.ticked ? DONE_HOLD_MS : tip.kind === 'goal' ? GOAL_SHOW_MS : TIP_SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [tip]);

  const showing = active && (phase === 'steer' || phase === 'speed' || !!tip);
  useEffect(() => { onShowingChange?.(showing); }, [showing, onShowingChange]);
  useEffect(() => () => onShowingChange?.(false), [onShowingChange]);
  if (!active) return null;
  const tick = <b className="coach-tick" aria-hidden="true">✓</b>;
  const skip = onSkip && (phase === 'steer' || phase === 'speed') && !done
    ? <button type="button" className="coach-skip" aria-label="Skip the lesson" onClick={() => { onComplete(); onSkip(); setPhase('goal'); }}>Skip</button> : null;
  const touch = device === 'touch';
  let body: ReactNode = null, className = 'coach', id = '';
  if (phase === 'steer') {
    id = 'steer';
    className += done ? ' ticked' : keys.left || keys.right ? ' working' : '';
    const lit = device === 'keyboard' ? [keys.left ? 'A' : '', keys.right ? 'D' : ''] : keys.left || keys.right ? ['LS'] : [];
    body = <>
      {!touch && <Keys action="steer" device={device} lit={lit} />}
      <span className="coach-text">
        <strong>{done ? 'Nice, you\'ve got it.' : rails ? sides.left || sides.right ? 'Now hold the other side' : 'Hold left or right to steer' : 'Steer left and right'}</strong>
        {!done && <small>{rails ? 'The car drives itself — you just steer' : 'The car rolls on by itself'}</small>}
      </span>
      {!done && !rails && <span className="coach-sides" aria-hidden="true"><i className={sides.left ? 'on' : ''} /><i className={sides.right ? 'on' : ''} /></span>}
      {done ? tick : skip}
    </>;
  } else if (phase === 'speed') {
    id = 'speed';
    className += done ? ' ticked' : keys.gas ? ' working' : '';
    body = <>
      <Keys action="gas" device={device} lit={keys.gas ? ['W', 'RT'] : []} />
      <span className="coach-text">
        <strong>{done ? 'Flying!' : keys.gas ? 'Keep holding…' : 'Hold to go faster'}</strong>
        {!done && <small>Let go any time — it cruises on its own</small>}
      </span>
      {done ? tick : skip}
      <i className="coach-fill" aria-hidden="true"><span style={{ transform: `scaleX(${Math.min(1, speed / SPEED_TARGET_KMH)})` }} /></i>
    </>;
  } else if (tip?.kind === 'goal') {
    return <div className="coach-goal" role="status" data-phase="goal">
      <span className="coach-goal-title">Here comes the traffic</span>
      <ul>
        <li><Sparkles aria-hidden="true" /><span><b>Slip past cars</b> to score — the closer, the more</span></li>
        <li><Gauge aria-hidden="true" /><span><b>Drift and boost</b> for big points</span></li>
        <li><Heart aria-hidden="true" /><span><b>Crashes cost a heart</b> — three and the run is over</span></li>
      </ul>
    </div>;
  } else if (tip) {
    id = tip.kind;
    className += ' tip' + (tip.ticked ? ' ticked' : '');
    body = tip.kind === 'boost'
      ? <>{<Keys action="boost" device={device} />}<span className="coach-text"><strong>{tip.ticked ? 'Whoosh!' : 'Boost is ready'}</strong>{!tip.ticked && <small>Blows cars aside, even ones you pass close to</small>}</span>{tip.ticked ? tick : null}</>
      : tip.kind === 'drift'
        ? <>{<Keys action="drift" device={device} />}<span className="coach-text"><strong>{tip.ticked ? 'Sideways!' : 'Hold in a turn to drift'}</strong>{!tip.ticked && <small>Long drifts score big</small>}</span>{tip.ticked ? tick : null}</>
        : <><Keys action="camera" device={device} /><span className="coach-text"><strong>Change the view</strong><small>and open the map</small></span><Keys action="map" device={device} /></>;
  }
  if (!body) return null;
  return <div data-phase={id} className={className} role="status">{body}</div>;
}
