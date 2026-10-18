import { Component, Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, House, Trophy, Map as MapIcon, SlidersHorizontal, ChevronLeft, ChevronRight, CircleHelp, Maximize2, Moon, Pause, Play, RotateCcw, Sun, TriangleAlert, Volume2, VolumeX, X } from 'lucide-react';
import Scene from './game/Scene';
import LoadingScreen from './LoadingScreen';
import Coach from './Coach';
import BoostGauge from './BoostGauge';
import type { DriftScore, Telemetry } from './game/Scene';
import { BOOST_EARN, DRIVE_MODE, earnBoost, emptyControls, initialLoopCar, recoverToRoad } from './game/driving';
import type { ControlKey } from './game/driving';

// Header morph: switching between the start screen and the drive (and the map) runs through the browser's view
// transitions, so the header's pieces glide to their new places instead of jumping: the brand pill becomes the
// home button and level badge, shared buttons slide along, new ones spring in. Only the header is captured (see
// style.css), so the 3D scene keeps running underneath. Without support (or with reduced motion) it just switches.
function morph(update: () => void) {
  const doc = document as Document & { startViewTransition?: (callback: () => void) => unknown };
  if (!doc.startViewTransition || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { update(); return; }
  doc.startViewTransition(() => flushSync(update));
}

// A crisp, custom-drawn arrow pointer that stays directly under the mouse.
function GameCursor({ rootRef }: { rootRef: { current: HTMLElement | null } }) {
  const cursor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current, node = cursor.current;
    if (!root || !node || window.matchMedia('(pointer: coarse)').matches) return;
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const rect = root.getBoundingClientRect();
      node.style.transform = `translate3d(${event.clientX - rect.left}px,${event.clientY - rect.top}px,0)`;
      node.classList.add('visible');
    };
    const leave = () => { node.classList.remove('visible'); };
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerleave', leave);
    return () => {
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerleave', leave);
    };
  }, [rootRef]);
  return <div ref={cursor} className="game-cursor" aria-hidden="true">
    <svg viewBox="0 0 24 30" focusable="false">
      <path d="M.8.7V25l6.8-6.7 4.8 10 4.3-2-4.7-10 9.4-1.7L.8.7Z" />
    </svg>
  </div>;
}

// A heart: a glossy red shape with a soft highlight (the colours come from style.css).
const HEART_PATH = 'M12 21.2s-7.6-4.6-9.9-9.2C.5 8.7 2.5 4.5 6.4 4.1c2.1-.2 3.9.9 5.6 2.9 1.7-2 3.5-3.1 5.6-2.9 3.9.4 5.9 4.6 4.3 7.9-2.3 4.6-9.9 9.2-9.9 9.2z';
function HeartIcon({ className }: { className?: string }) {
  return <svg className={`heart-icon ${className ?? ''}`} viewBox="0 0 24 24" aria-hidden="true">
    <path className="heart-body" d={HEART_PATH} />
    <path className="heart-shine" d="M6.6 6.6c-1.6.3-2.6 1.8-2.4 3.4" />
  </svg>;
}

// Phones and tablets play in rails mode: the car drives itself and stays on the road, and the player only steers
// (see DRIVE_MODE in driving.ts). It follows the device live (a touch screen, or a browser switched into device
// mode after loading), so the wheel and pedals never show up by mistake; `?rails=off` brings them back on purpose.
const RAILS_ALLOWED = typeof window === 'undefined' || new URLSearchParams(window.location.search).get('rails') !== 'off';
const touchQuery = typeof window === 'undefined' ? null : window.matchMedia?.('(pointer: coarse)') ?? null;
function useRails() {
  const [touch, setTouch] = useState(() => !!touchQuery?.matches);
  useEffect(() => {
    if (!touchQuery) return;
    const update = () => setTouch(touchQuery.matches);
    touchQuery.addEventListener('change', update);
    return () => touchQuery.removeEventListener('change', update);
  }, []);
  const rails = RAILS_ALLOWED && touch;
  DRIVE_MODE.rails = rails;
  return rails;
}

// Rails-mode steering: each half of the screen (below the header) steers that way while held, so there is no
// small target to find; a round glass button in each bottom corner shows it and lights up gold while held, and
// the held side glows faintly from its edge.
// Ripples from the steering buttons: how far a tap's spreads (px); holding builds up over `build` s, sending pulses
// every `pulseEvery` s (from slow to fast) that spread up to (1 + `grow`) times as far.
const STEER_STRAIN = { reach: 94, build: 1.2, pulseEvery: [0.42, 0.2], grow: 0.9 } as const;
function SteerPads({ controls }: { controls: React.RefObject<{ left: boolean; right: boolean }> }) {
  type Side = 'left' | 'right';
  const [held, setHeld] = useState({ left: false, right: false });
  // Every press is a "tap" with its own short animation (a ripple and a punch of the button's face) that plays in
  // full however briefly the finger stays down, so quick little taps to ease round a bend look as alive as a hold.
  // A ripple is a tap's, or a pulse sent out while a button is held; `reach` is how far it spreads (px).
  const [taps, setTaps] = useState<Record<Side, Array<{ id: number; reach: number }>>>({ left: [], right: [] });
  const tapId = useRef(0);
  const lastTap = useRef<Record<Side, number>>({ left: 0, right: 0 });
  const ripple = useCallback((side: Side, reach: number) => {
    const id = ++tapId.current;
    setTaps(t => ({ ...t, [side]: [...t[side].slice(-4), { id, reach }] }));
    window.setTimeout(() => setTaps(t => ({ ...t, [side]: t[side].filter(other => other.id !== id) })), 900);
  }, []);
  const tap = useCallback((side: Side) => {
    const now = performance.now();
    if (now - lastTap.current[side] < 60) return;
    lastTap.current[side] = now;
    ripple(side, STEER_STRAIN.reach);
  }, [ripple]);
  // Holding a turn strains: the longer the hold (to `build` s), the faster the button sends out pulses, the further
  // they spread, and the harder it trembles and glows (the zone's --strain, 0..1, read by style.css).
  const zones = useRef<Record<Side, HTMLDivElement | null>>({ left: null, right: null });
  const holdStart = useRef<Record<Side, number>>({ left: 0, right: 0 });
  const lastPulse = useRef<Record<Side, number>>({ left: 0, right: 0 });
  const set = (side: Side, on: boolean) => {
    controls.current[side] = on;
    if (on) {
      // A tiny tap of vibration on each press, where the phone supports it, so the press is felt as well as seen.
      navigator.vibrate?.(8);
      tap(side);
    }
    setHeld(h => (h[side] === on ? h : { ...h, [side]: on }));
  };
  // The buttons light up for the keyboard too (arrows or A/D, e.g. a desktop browser in device mode): they follow
  // the controls themselves, whatever pressed them, and a new press from the keyboard is a tap as well.
  useEffect(() => {
    let frame = 0;
    const was = { left: false, right: false };
    const tick = () => {
      const { left, right } = controls.current;
      if (left && !was.left) tap('left');
      if (right && !was.right) tap('right');
      was.left = left; was.right = right;
      const now = performance.now();
      for (const side of ['left', 'right'] as const) {
        const on = side === 'left' ? left : right;
        if (!on) { holdStart.current[side] = 0; zones.current[side]?.style.setProperty('--strain', '0'); continue; }
        if (!holdStart.current[side]) holdStart.current[side] = now;
        const strain = Math.min(1, (now - holdStart.current[side]) / 1000 / STEER_STRAIN.build);
        zones.current[side]?.style.setProperty('--strain', strain.toFixed(3));
        const every = STEER_STRAIN.pulseEvery[0] + (STEER_STRAIN.pulseEvery[1] - STEER_STRAIN.pulseEvery[0]) * strain;
        if (strain > 0.15 && now - lastPulse.current[side] > every * 1000) {
          lastPulse.current[side] = now;
          ripple(side, STEER_STRAIN.reach * (1 + STEER_STRAIN.grow * strain));
        }
      }
      setHeld(h => (h.left === left && h.right === right ? h : { left, right }));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [controls, tap, ripple]);
  return <div className="steer-pads" aria-label="Steering">
    {(['left', 'right'] as const).map(side => <div
      key={side}
      ref={element => { zones.current[side] = element; }}
      className={`steer-zone ${side}${held[side] ? ' held' : ''}`}
      role="button"
      aria-label={side === 'left' ? 'Steer left' : 'Steer right'}
      onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); set(side, true); }}
      onPointerUp={() => set(side, false)}
      onPointerCancel={() => set(side, false)}
      onLostPointerCapture={() => set(side, false)}
    >
      <span className="steer-button" aria-hidden="true">
        {taps[side].map(({ id, reach }) => <i key={id} className="steer-ripple" style={{ '--reach': `${reach}px` } as CSSProperties} />)}
        <span key={taps[side].at(-1)?.id ?? 0} className="steer-face">{side === 'left' ? <ChevronLeft /> : <ChevronRight />}</span>
      </span>
    </div>)}
  </div>;
}

// Touch steering: a round wheel you turn with a finger. Dragging it sets the steering (up to a 270° turn); letting go
// springs it back to the centre.
const WHEEL_LOCK = 270;
function SteeringWheel({ controls }: { controls: React.RefObject<{ steer?: number }> }) {
  const [turn, setTurn] = useState(0);
  const wheel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number; base: number } | null>(null);
  const angleOf = (event: React.PointerEvent) => {
    const rect = wheel.current!.getBoundingClientRect();
    return Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2)) * 180 / Math.PI;
  };
  const apply = (degrees: number) => {
    setTurn(degrees);
    controls.current.steer = Math.max(-1, Math.min(1, -degrees / 90));
  };
  return <div
    ref={wheel}
    className="steering-wheel"
    role="slider"
    aria-label="Steering wheel"
    aria-valuemin={-WHEEL_LOCK}
    aria-valuemax={WHEEL_LOCK}
    aria-valuenow={Math.round(turn)}
    style={{ transform: `rotate(${turn}deg)` }}
    onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { start: angleOf(event), base: turn }; }}
    onPointerMove={event => {
      if (!drag.current) return;
      let delta = angleOf(event) - drag.current.start;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      apply(Math.max(-WHEEL_LOCK, Math.min(WHEEL_LOCK, drag.current.base + delta)));
    }}
    onPointerUp={() => { drag.current = null; apply(0); }}
    onPointerCancel={() => { drag.current = null; apply(0); }}
  >
    <span className="wheel-top" />
  </div>;
}
import type { NearMiss, TrafficHit } from './game/obstacles';
import { NEAR_MISS } from './game/obstacles';
import { DAY_LOOK_SAVED, DAY_LOOK_SLIDERS, dayLook } from './game/dayLook';
import type { DayLook } from './game/dayLook';
import { NIGHT_LOOK_SAVED, NIGHT_LOOK_SLIDERS, nightLook } from './game/nightLook';
import type { NightLook } from './game/nightLook';
import { CAR_TUNING_SAVED, CAR_TUNING_SLIDERS } from './game/carTuning';
import type { CarTuning } from './game/carTuning';
import { CAMERA_TUNING_SAVED, CAMERA_TUNING_SLIDERS, applyCameraTuning, cameraTuning } from './game/cameraTuning';
import { BOOST_TUNING_COLOURS, BOOST_TUNING_SAVED, BOOST_TUNING_SLIDERS, applyBoostTuning, boostTuning, type BoostTuning } from './game/boostTuning';
import type { CameraTuning } from './game/cameraTuning';
import { CAR_CONFIG, JUICE_CONFIG } from './game/config';
import { NEAR_MISS_LOOK_COLOURS, NEAR_MISS_LOOK_SAVED, NEAR_MISS_LOOK_SLIDERS, nearMissLook } from './game/nearMissLook';
import type { NearMissLook } from './game/nearMissLook';
import { WARM_LIGHT_COLOURS, WARM_LIGHT_SAVED, WARM_LIGHT_SLIDERS, warmLight } from './game/warmLight';
import type { WarmLight } from './game/warmLight';
import { SOUND_TUNING_SAVED, SOUND_TUNING_SLIDERS, applySoundTuning, soundTuning } from './game/soundTuning';
import type { SoundTuning } from './game/soundTuning';
import { cinematicState } from './game/cinematic';
import { VISUAL_QUALITY } from './game/artDirection';
import { levelFor, loadXp, saveXp, streakXp } from './game/progression';
import { rampFor } from './game/difficulty';
import { HEARTS, HEART_GRACE_MS, emptyRunStats, loadBest, saveBest, stageFor } from './game/leaderboard';
import RunOver from './RunOver';
import Leaderboard from './Leaderboard';
import { difficulty, setDifficultyLevel } from './game/difficulty';
import { cycle, goTo, headingToNight, mixHex, nightAmount, resetToDay, skyAt, twilight } from './game/dayCycle';
import { AUDIO_CONFIG, AUDIO_RANGES, holdWorld, playEngineStart, setMuted, startAudio } from './game/audio';

const TITLE = 'take a spin.';
// Traffic note wording, kept to a word or two, and which notes win when two land close together.
const NOTE_TEXT = {
  smash: ['Big crash!', 'Brutal hit.', 'Total wreck.', 'Ouch.'],
  near: ['Close call!', 'By a whisker!', 'Threaded it!', 'Inches!'],
  boost: ['Bulldozer!', 'Unstoppable!', 'Out of my way!', 'Absolute unit!'],
  flick: ['Nice flick!', 'Sideswipe!', 'Pinball!'],
  bump: ['Bump.', 'Easy now.', 'Careful.'],
  level: ['Level up!'],
  newBest: ['New best!'],
  stage: ['Traffic picks up'],
  // Shown big, in the middle of the screen, while a slow-motion cut-in plays.
  bigSmash: ['WRECKED!', 'KABOOM!', 'TOTALED!', 'BRUTAL!'],
  bigNear: ['BY A HAIR', 'TOO CLOSE', 'CLOSE CALL', 'INCHES'],
  // Ramming cars under boost: big too, with the combo.
  bigBoost: ['SMASH!', 'BOOM!', 'WRECKING BALL!', 'OUTTA MY WAY!', 'UNSTOPPABLE!'],
  // The drift cut-in (overhead camera): the word slides in like the car.
  cineDrift: ['SIDEWAYS', 'DRIFT KING', 'SMOOTH SLIDE', 'PURE STYLE'],
  drift: ['Nice drift!', 'Clean slide!'],
  bigDrift: ['Big drift!', 'Sideways!'],
  hugeDrift: ['Drift king!', 'Endless slide!'],
};
const NOTE_RANK = { bigSmash: 5, bigNear: 5, bigBoost: 5, cineDrift: 5, level: 4, newBest: 4, stage: 4, smash: 3, hugeDrift: 3, near: 2, boost: 2, bigDrift: 2, drift: 1, flick: 1, bump: 1 };
// Notes that show a badge (an XP reward, a score) instead of points.
const BADGE_NOTES: string[] = ['level', 'newBest', 'stage'];
// How long the end-of-run shot plays before the run-over card (ms); matches FINALE in Scene.tsx.
const FINALE_MS = 3400;
// How big a score change is, for how strongly the score reacts to it.
const bonusTier = (amount: number) => (amount < 0 ? 'loss' : amount < 40 ? 'small' : amount < 120 ? 'mid' : amount < 300 ? 'big' : 'huge');
// Points for every metre driven, so the score always climbs while driving.
const DISTANCE_POINTS = 0.5;
// Hits slower than this (m/s) still score, but without a note.
const QUIET_HIT_SPEED = 7;
const formatNumber = (n: number) => Math.round(n).toLocaleString('en-US');
class SceneBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? <div className="error-screen"><h2>The 3D scene could not load</h2><p>Enable graphics acceleration in your browser and try again.</p><button className="primary" onClick={() => location.reload()}>Try again</button></div> : this.props.children; }
}
function Help({ close }: { close: () => void }) {
  return <div className="modal-shade help-shade" onClick={close}><section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e => e.stopPropagation()}>
    <button className="close-button" autoFocus aria-label="Close help" onClick={close}><X size={18} /></button>
    <span className="eyebrow">CONTROLS</span><h2 id="help-title">Keep the wheel and the road.</h2>
    <div className="help-row"><span>Accelerate / brake & reverse</span><span><kbd>W</kbd> <kbd>S</kbd> or <kbd>↑</kbd> <kbd>↓</kbd></span></div>
    <div className="help-row"><span>Steer left / right</span><span><kbd>A</kbd> <kbd>D</kbd> or <kbd>←</kbd> <kbd>→</kbd></span></div>
    <div className="help-row"><span>Brake / handbrake drift</span><kbd>Space</kbd></div>
    <div className="help-row"><span>Boost</span><kbd>Shift</kbd></div>
    <div className="help-row"><span>Gentle throttle</span><kbd>Alt</kbd></div>
    <div className="help-row"><span>Back to road when stuck</span><kbd>F</kbd></div>
    <div className="help-row"><span>Tuning panel</span><kbd>`</kbd></div>
    <div className="help-row"><span>Change camera</span><kbd>C</kbd></div>
    <div className="help-row"><span>Restart</span><kbd>R</kbd></div>
    <div className="help-row"><span>Pause / resume</span><kbd>Esc</kbd></div>
    <div className="help-row"><span>Phone tilt assist</span><span>Lean into bends</span></div>
    <p>The car rolls on its own once you start; you choose the line. Lift off for corners, hold back to reverse. Weave through traffic, drift the bends, and bank your hearts for a bigger run.</p>
    <button className="primary" onClick={close}>Got it <Check size={18} /></button>
  </section></div>;
}

// Night sky behind the globe: twinkling stars and a slow aurora. Fades in with night mode.
const STAR_LAYERS = [0, 1, 2].map(layer => {
  let seed = 7 + layer * 131;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  return Array.from({ length: [70, 40, 18][layer] }, () => {
    const x = (random() * 100).toFixed(2), y = (random() * 72).toFixed(2);
    return `${x}vw ${y}vh 0 ${[0, 0.4, 0.8][layer]}px rgba(255,248,230,${(0.55 + random() * 0.45).toFixed(2)})`;
  }).join(',');
});
// Day sky behind the globe: now and then a small flock of birds crosses it (it fades out with the night).
function DaySky() {
  return <div className="day-sky" aria-hidden="true">
    <div className="day-birds">{[0, 1, 2, 3, 4].map(i => <svg key={i} viewBox="0 0 20 8" style={{ '--i': i } as CSSProperties}><path d="M0 6 L6 1 L10 5 L14 1 L20 6 L14 3 L10 7 L6 3 Z" /></svg>)}</div>
  </div>;
}

function NightSky() {
  return <div className="night-sky" aria-hidden="true">
    <div className="aurora"><span /><span /><span /></div>
    {STAR_LAYERS.map((shadow, layer) => <i key={layer} className={`stars stars-${layer}`} style={{ boxShadow: shadow }} />)}
  </div>;
}

// Look panel (dev tool): a few sliders for the day or night mood, applied live; Apply saves them to dayLook.json or
// nightLook.json. Picking a tab switches the game to that time of day so the changes can be seen.
type LookValues = Record<string, number | string>;
type LookSlider = { key: string; label: string; min: number; max: number; step: number; group?: string };
type LookMode = 'day' | 'night' | 'car' | 'camera' | 'boost' | 'nearMiss' | 'sound' | 'warm';
function LookPanel({ mode, onMode, look, sliders, colours, saved, endpoint, onChange, onClose }: {
  mode: LookMode; onMode: (mode: LookMode) => void; look: LookValues; sliders: LookSlider[]; colours?: Array<{ key: string; label: string }>; saved: LookValues;
  endpoint: string; onChange: (look: LookValues) => void; onClose: () => void;
}) {
  const [status, setStatus] = useState('');
  const set = (key: string, value: number | string) => { onChange({ ...look, [key]: value }); setStatus(''); };
  const apply = async () => {
    setStatus('Saving…');
    try {
      const response = await fetch(endpoint, { method: 'POST', body: JSON.stringify(look) });
      setStatus(response.ok ? 'Saved — tell Claude to use it' : 'Could not save');
    } catch { setStatus('Could not save (dev server only)'); }
  };
  return <div className="day-look" role="dialog" aria-label="Look">
    <div className="day-look-head">
      <div className="day-look-tabs">
        <button className={mode === 'day' ? 'on' : ''} onClick={() => { onMode('day'); setStatus(''); }}>Day</button>
        <button className={mode === 'night' ? 'on' : ''} onClick={() => { onMode('night'); setStatus(''); }}>Night</button>
        <button className={mode === 'car' ? 'on' : ''} onClick={() => { onMode('car'); setStatus(''); }}>Car</button>
        <button className={mode === 'camera' ? 'on' : ''} onClick={() => { onMode('camera'); setStatus(''); }}>Camera</button>
        <button className={mode === 'boost' ? 'on' : ''} onClick={() => { onMode('boost'); setStatus(''); }}>Boost</button>
        <button className={mode === 'nearMiss' ? 'on' : ''} onClick={() => { onMode('nearMiss'); setStatus(''); }}>Near miss</button>
        <button className={mode === 'sound' ? 'on' : ''} onClick={() => { onMode('sound'); setStatus(''); }}>Sound</button>
        <button className={mode === 'warm' ? 'on' : ''} onClick={() => { onMode('warm'); setStatus(''); }}>Warm light</button>
      </div>
      <button aria-label="Close" onClick={onClose}><X size={14} /></button>
    </div>
    {colours && <div className="day-look-colours">
      {colours.map(colour => <label key={colour.key}><span>{colour.label}</span><input type="color" value={String(look[colour.key])} onChange={event => set(colour.key, event.target.value)} /></label>)}
    </div>}
    {sliders.map(slider => <Fragment key={slider.key}>{slider.group && <p className="day-look-group">{slider.group}</p>}<label className="day-look-row">
      <span>{slider.label}<b>{Number(look[slider.key]).toFixed(slider.step < 0.01 ? 3 : 2)}</b></span>
      <input type="range" min={slider.min} max={slider.max} step={slider.step} value={Number(look[slider.key])}
        onChange={event => set(slider.key, Number(event.target.value))} />
    </label></Fragment>)}
    {'skyTop' in look && <div className="day-look-colours">
      <label><span>Sky top</span><input type="color" value={String(look.skyTop)} onChange={event => set('skyTop', event.target.value)} /></label>
      <label><span>Sky horizon</span><input type="color" value={String(look.skyHorizon)} onChange={event => set('skyHorizon', event.target.value)} /></label>
    </div>}
    <div className="day-look-actions">
      <button onClick={() => { onChange({ ...saved }); setStatus(''); }}>Reset</button>
      <button className="apply" onClick={apply}>Apply</button>
    </div>
    {status && <p className="day-look-status">{status}</p>}
  </div>;
}

export default function App() {
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const RAILS = useRails();
  // Phones: the run starts in whichever time of day was picked on the start screen; going home resets to daylight.
  useEffect(() => { if (!started && RAILS) resetToDay(); }, [started, RAILS]);
  // Phones: the day and night come round a little faster, and every run starts in daylight (below).
  useEffect(() => { cycle.speed = RAILS ? 1.3 : 1; }, [RAILS]);
  // Map view: mid-drive, the camera pulls back to the globe (which can be turned by dragging) and the game holds
  // still until the player goes back to the road. M, the map button, or Esc to return.
  const [mapView, setMapView] = useState(false);
  // A run: hearts lost to hard crashes, then the run-over card (see leaderboard.ts).
  const [hearts, setHearts] = useState(HEARTS);
  const [runOver, setRunOver] = useState(false);
  // The finale: the end-of-run shot (slow motion, an orbit round the car, the end grade, letterbox bars) that plays
  // before the run-over card.
  const [finale, setFinale] = useState(false);
  const runStats = useRef(emptyRunStats());
  const halted = paused || mapView || runOver;
  const [night, setNight] = useState(false);
  // Day look panel (dev): live daytime mood settings, mirrored into the shared dayLook object the scene reads.
  const [look, setLook] = useState<DayLook>({ ...dayLook });
  const [showLook, setShowLook] = useState(false);
  const changeLook = (next: DayLook) => { Object.assign(dayLook, next); setLook(next); };
  const [nightValues, setNightValues] = useState<NightLook>({ ...nightLook });
  const changeNightLook = (next: NightLook) => { Object.assign(nightLook, next); setNightValues(next); };
  const [lookMode, setLookMode] = useState<LookMode>('day');
  const [cameraValues, setCameraValues] = useState<CameraTuning>({ ...cameraTuning });
  const changeCamera = (next: CameraTuning) => { applyCameraTuning(next); setCameraValues(next); };
  const [boostValues, setBoostValues] = useState<BoostTuning>({ ...boostTuning });
  const changeBoost = (next: BoostTuning) => { applyBoostTuning(next); setBoostValues(next); };
  const [nearMissValues, setNearMissValues] = useState<NearMissLook>({ ...nearMissLook });
  const changeNearMiss = (next: NearMissLook) => { Object.assign(nearMissLook, next); setNearMissValues(next); };
  const [warmValues, setWarmValues] = useState<WarmLight>({ ...warmLight });
  const changeWarm = (next: WarmLight) => { Object.assign(warmLight, next); setWarmValues(next); };
  const [soundValues, setSoundValues] = useState<SoundTuning>({ ...soundTuning });
  const changeSound = (next: SoundTuning) => { applySoundTuning(next); setSoundValues(next); };
  // While the Near miss tab is open its grade stays on screen, so it can be tuned without chasing near misses.
  useEffect(() => { cinematicState.preview = showLook && lookMode === 'nearMiss'; }, [showLook, lookMode]);
  const [carValues, setCarValues] = useState<CarTuning>(() => Object.fromEntries(Object.keys(CAR_TUNING_SAVED).map(key => [key, CAR_CONFIG[key as keyof CarTuning]])) as CarTuning);
  const changeCar = (next: CarTuning) => { Object.assign(CAR_CONFIG, next); setCarValues(next); };
  // The time of day runs as one slow clock (dayCycle.ts, advanced by the scene). Each frame the sky gradient
  // takes its colours from it, the stars fade with it, and the page switches to its night styling halfway.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let frame = 0;
    const written: Record<string, string> = {};
    const tick = () => {
      const sky = skyAt({ top: dayLook.skyTop, horizon: dayLook.skyHorizon }, { top: nightLook.skyTop, horizon: nightLook.skyHorizon });
      const n = nightAmount();
      // Written only when a value changes: each write repaints the whole sky gradient.
      // The pale sun glow in the sky is a daytime thing only: gone as soon as sunset colours start.
      const next: Record<string, string> = { '--sky-top': sky.top, '--sky-horizon': sky.horizon, '--night-amount': n.toFixed(2), '--sun-glow': ((1 - n) * (1 - twilight()) ** 3).toFixed(2) };
      const style = mainRef.current?.style;
      for (const key in next) if (style && written[key] !== next[key]) { style.setProperty(key, next[key]); written[key] = next[key]; }
      setNight(n > 0.5);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  const [cameraMode, setCameraMode] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const [help, setHelp] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [tiltAssist, setTiltAssist] = useState(false);
  const [tiltNotice, setTiltNotice] = useState('');
  const mobileBrandRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!mobileBrandRef.current?.contains(event.target as Node)) setMobileMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [mobileMenuOpen]);
  useEffect(() => { holdWorld(paused || help || boardOpen || mapView); }, [paused, help, boardOpen, mapView]);
  const [ready, setReady] = useState(false);
  // The intro reveal waits until the loading screen starts fading away.
  const [revealed, setRevealed] = useState(false);
  const [data, setData] = useState<Telemetry>(initialLoopCar);
  const [gamepad, setGamepad] = useState(false);
  const [muted, setMutedState] = useState(true);
  // Smooth-driving streak: grows while staying on the road at speed, resets off-road or when slowing right down.
  const streak = useRef({ time: 0, last: 0 });
  const [streakLevel, setStreakLevel] = useState(0);
  const streakMessages = ['Smooth driving', 'Nice line', 'Clean drive', 'Great flow', 'On a roll', 'Cruising', 'Road master', 'Zen mode'];
  const [streakShown, setStreakShown] = useState(false);
  // Traffic notes match what the camera shows: a red smash (the slow-motion crash) costs points, a grey near
  // miss pays, a clip from the side pays a little, a soft bump costs a little, and under boost every hit pays.
  // They stay short and quiet: slow nudges score without a note, and a lesser note never covers a bigger one
  // that is still on screen.
  type NoteKind = keyof typeof NOTE_TEXT;
  const [score, setScore] = useState(0);
  const [bonus, setBonus] = useState<{ id: number; amount: number } | null>(null);
  // The number on screen chases the real score: quickly for a big jump (so a big bonus visibly counts up), and
  // without a re-render per frame.
  const scoreText = useRef<HTMLElement | null>(null);
  const shownScore = useRef(0);
  const scoreTarget = useRef(0);
  scoreTarget.current = score;
  useEffect(() => {
    let frame = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const gap = scoreTarget.current - shownScore.current;
      if (gap !== 0) {
        shownScore.current = Math.abs(gap) < 1 ? scoreTarget.current : shownScore.current + gap * Math.min(1, dt * 7);
        const text = formatNumber(shownScore.current);
        if (scoreText.current && scoreText.current.textContent !== text) scoreText.current.textContent = text;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  const [hitNote, setHitNote] = useState<{ id: number; kind: NoteKind; points: number; text: string; badge?: string } | null>(null);
  // Driver level: positive points and streaks add XP (see progression.ts); it is kept between visits.
  const [xp, setXp] = useState(loadXp);
  const level = levelFor(xp);
  const shownLevel = useRef(level.level);
  const levelRef = useRef(level.level);
  levelRef.current = level.level;
  const hitCount = useRef(0);
  const hitTimer = useRef<number | undefined>(undefined);
  const shownNote = useRef<{ rank: number; until: number }>({ rank: 0, until: 0 });
  const lastText = useRef('');
  const showNote = useCallback((kind: NoteKind, rawPoints: number, quiet: boolean, badge?: string, label?: string) => {
    // Early levels are kinder: good moves pay a little more and crashes cost less (see difficulty.ts).
    const points = Math.round(rawPoints * (rawPoints > 0 ? difficulty.bonus : difficulty.penalty));
    if (!BADGE_NOTES.includes(kind)) { setScore(total => total + points); if (points !== 0) setBonus(b => ({ id: (b?.id ?? 0) + 1, amount: points })); }
    if (points > 0 && !BADGE_NOTES.includes(kind)) setXp(total => total + points);
    const rank = NOTE_RANK[kind];
    const now = performance.now();
    if (quiet || (now < shownNote.current.until && rank < shownNote.current.rank)) return;
    const fresh = NOTE_TEXT[kind].filter(text => text !== lastText.current);
    const options = fresh.length ? fresh : NOTE_TEXT[kind];
    const text = label ?? options[Math.floor(Math.random() * options.length)];
    lastText.current = text;
    shownNote.current = { rank, until: now + 1400 };
    setHitNote({ id: hitCount.current++, kind, points, text, badge });
    window.clearTimeout(hitTimer.current);
    hitTimer.current = window.setTimeout(() => setHitNote(null), kind === 'level' ? 3000 : kind === 'bigBoost' ? 1200 : kind === 'cineDrift' ? 1550 : kind.startsWith('big') ? 1550 : 2200);
  }, []);
  // A level-up takes the caption slot over anything else, with the new title.
  useEffect(() => {
    saveXp(xp);
    if (level.level > shownLevel.current) { showNote('level', 0, false, `${level.level} · ${level.title}`); earnBoost(car.current, BOOST_EARN.levelUp); }
    shownLevel.current = level.level;
  }, [xp, level.level, level.title, showNote]);
  // Goal: the best score (the best run, kept in the browser; beating it, once per run, shows a note).
  const [best, setBest] = useState(loadBest);
  const bestAtRunStart = useRef(best);
  const beatBest = useRef(false);
  useEffect(() => {
    if (score <= best) return;
    setBest(score);
    saveBest(score);
    if (!beatBest.current && bestAtRunStart.current > 0) { beatBest.current = true; showNote('newBest', 0, false, formatNumber(score)); }
  }, [score]); // eslint-disable-line react-hooks/exhaustive-deps
  // Distance: half a point a metre, added as the car drives (not while held, and not across a reset).
  const lastDistance = useRef(0);
  const distanceCarry = useRef(0);
  useEffect(() => {
    const travelled = data.distance - lastDistance.current;
    lastDistance.current = data.distance;
    if (!started || halted || travelled <= 0 || travelled > 60) return;
    distanceCarry.current += travelled * DISTANCE_POINTS;
    const whole = Math.floor(distanceCarry.current);
    if (whole > 0) { distanceCarry.current -= whole; setScore(total => total + whole); }
  }, [data, started, halted]);
  // Hearts: a crash that gets the red slow motion costs one (with a short grace so one tussle takes only one);
  // a hard knock without the slow motion costs points, not a heart. The last heart ends the run
  // once the crash's slow motion has played.
  const lastHeartLoss = useRef(0);
  const heartsRef = useRef(hearts);
  heartsRef.current = hearts;
  // Losing one is a moment: a big heart cracks and falls apart in the middle of the screen with what is left, the
  // frame pulses red, and the lost heart in the HUD shatters away.
  const [heartBreak, setHeartBreak] = useState<{ id: number; left: number } | null>(null);
  useEffect(() => {
    if (!heartBreak) return;
    const timer = window.setTimeout(() => setHeartBreak(null), 1700);
    return () => window.clearTimeout(timer);
  }, [heartBreak]);
  const loseHeart = useCallback(() => {
    const now = performance.now();
    if (heartsRef.current <= 0 || now - lastHeartLoss.current < HEART_GRACE_MS) return;
    lastHeartLoss.current = now;
    const left = heartsRef.current - 1;
    heartsRef.current = left;
    setHearts(left);
    setHeartBreak(previous => ({ id: (previous?.id ?? 0) + 1, left }));
    if (left === 0) {
      // The last heart: the controls let go, the finale plays, then the run-over card.
      controls.current = emptyControls();
      setFinale(true);
      window.setTimeout(() => { runStats.current.distance = dataRef.current.distance; setRunOver(true); }, FINALE_MS);
    }
  }, []);
  // The run's clock: it counts only while driving, and every few seconds of it moves the run up a stage, which
  // makes the road harder (difficulty.ts: more and faster traffic, swaying cars...), with a note to say so.
  const stageRef = useRef(1);
  useEffect(() => {
    if (!started || halted) return;
    const timer = window.setInterval(() => {
      const stats = runStats.current;
      stats.seconds += 1;
      const next = stageFor(stats.seconds);
      if (next === stageRef.current) return;
      stageRef.current = next;
      setDifficultyLevel(next);
      showNote('stage', 0, false, `Stage ${next}`);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [started, halted, showNote]);
  // Boost hits still award a fixed bonus and flash, but no longer chain into a timed score multiplier.
  const [boostFlash, setBoostFlash] = useState(0);
  const handleTrafficHit = useCallback((hit: TrafficHit) => {
    const magnitude = Math.round(hit.speed * 2) + 5;
    if (hit.boosted) {
      showNote('bigBoost', Math.round(magnitude * 1.5), false);
      runStats.current.smashes++;
      setBoostFlash(n => n + 1);
    }
    else if (hit.closing >= JUICE_CONFIG.crashCinematicClosing) { if (hit.cinematic) loseHeart(); showNote(hit.cinematic ? 'bigSmash' : 'smash', -(Math.round(hit.closing * 2) + 5), false); }
    else if (hit.kind === 'side') { showNote('flick', magnitude, hit.speed < QUIET_HIT_SPEED); if (hit.speed >= QUIET_HIT_SPEED) { earnBoost(car.current, BOOST_EARN.flick); } }
    else { showNote('bump', -Math.round(hit.speed + 3), hit.speed < QUIET_HIT_SPEED); }
  }, [showNote, loseHeart]);
  // A drift held long enough gets the overhead slow-motion cut-in, with its word (the points come when it ends).
  const handleDriftCinematic = useCallback(() => showNote('cineDrift', 0, false), [showNote]);
  // A drift pays for how long and how fast it slid; longer ones get bigger words.
  const handleDrift = useCallback((drift: DriftScore) => {
    // A drift is scored on its quality, not just its length: how hard into the slide, how clean (on the road),
    // switching sides mid-slide (an S-drift) and threading near misses on the way all multiply its points, and
    // the note names the best thing about it.
    const angle = 0.6 + 0.8 * Math.min(1, drift.angle);
    const clean = 0.4 + 0.6 * Math.max(0, drift.clean);
    const switchback = 1 + 0.6 * Math.min(drift.switches, 3);
    const threaded = 1 + 0.5 * Math.min(drift.threaded, 3);
    const points = Math.round(drift.time * drift.speed * 1.2 * angle * clean * switchback * threaded);
    const label = drift.threaded > 0 ? 'Threaded the needle!'
      : drift.switches > 0 ? (drift.switches > 1 ? `Switchback ×${drift.switches}!` : 'Switchback!')
      : drift.angle > 0.8 && drift.clean > 0.95 && drift.time >= 1.8 ? 'Perfect drift!'
      : drift.clean > 0.95 ? 'Clean drift' : 'Nice drift';
    showNote(points >= 160 ? 'hugeDrift' : points >= 70 ? 'bigDrift' : 'drift', points, false, undefined, label);
    earnBoost(car.current, BOOST_EARN.drift + BOOST_EARN.driftPerSecond * drift.time);
    runStats.current.drifts++;
  }, [showNote]);
  // Near misses pay more the faster the pass and the thinner the gap.
  const handleNearMiss = useCallback((miss: NearMiss) => {
    runStats.current.nearMisses++;
    showNote(miss.cinematic ? 'bigNear' : 'near', Math.round(miss.speed * (1 + 1.5 * (1 - Math.max(0, miss.gap) / NEAR_MISS.gap))) + 5, false);
    earnBoost(car.current, BOOST_EARN.nearMiss);
  }, [showNote]);
  useEffect(() => {
    if (streakLevel === 0) { setStreakShown(false); return; }
    setXp(total => total + streakXp(streakLevel));
    earnBoost(car.current, BOOST_EARN.streak);
    setStreakShown(true);
    const timer = setTimeout(() => setStreakShown(false), JUICE_CONFIG.streakShowTime * 1000);
    return () => clearTimeout(timer);
  }, [streakLevel]);
  useEffect(() => {
    const now = performance.now();
    const state = streak.current;
    const dt = state.last ? Math.min((now - state.last) / 1000, 0.5) : 0;
    state.last = now;
    if (!started || halted) return;
    const topSpeed = CAR_CONFIG.maxSpeed * 3.6;
    if (data.offroad || data.speed < topSpeed * 0.3) state.time = 0;
    else if (data.speed > topSpeed * JUICE_CONFIG.streakSpeedRatio) state.time += dt;
    setStreakLevel(state.time > 0 ? Math.floor(state.time / JUICE_CONFIG.streakStep) + 1 : 0);
  }, [data, started, paused]);
  useEffect(() => { setMuted(muted); }, [muted]);
  // Browsers only allow audio after a user gesture.
  useEffect(() => {
    const unlock = () => startAudio();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, []);
  // The number, arc and fire colours follow the same spring. Heat comes from
  // actual speed, so braking cools the dial even if boost is still firing.
  const dataRef = useRef(data);
  dataRef.current = data;
  const speedText = useRef<HTMLElement>(null);
  const speedometer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0, last = performance.now(), value = 0, velocity = 0;
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      velocity += (JUICE_CONFIG.hudSpringStiffness * (dataRef.current.speed - value) - JUICE_CONFIG.hudSpringDamping * velocity) * dt;
      value += velocity * dt;
      const shown = Math.max(0, value);
      const text = formatNumber(shown);
      if (speedText.current && speedText.current.textContent !== text) speedText.current.textContent = text;
      if (speedometer.current) {
        const ratio = shown / Math.max(1, CAR_CONFIG.maxSpeed * 3.6);
        // Begin warming at 40% of normal top speed; the full boost palette
        // arrives just above it, leaving a little headroom for overspeed.
        const warm = Math.max(0, Math.min(1, (ratio - 0.4) / 0.65));
        const heat = warm * warm * (3 - 2 * warm);
        speedometer.current.style.setProperty('--speed-arc', `${(Math.min(ratio, 1) * 75).toFixed(2)} 100`);
        speedometer.current.style.setProperty('--speed-heat', heat.toFixed(3));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  // Live tuning panel (toggle with the backquote key); edits CAR_CONFIG / JUICE_CONFIG in place.
  useEffect(() => {
    let gui: { destroy(): void; show(show?: boolean): unknown; _hidden: boolean } | undefined;
    let disposed = false;
    const toggle = (event: KeyboardEvent) => { if (event.code === 'Backquote' && gui) gui.show(gui._hidden); };
    import('lil-gui').then(({ default: GUI }) => {
      if (disposed) return;
      // Hidden by default; the backquote key shows/hides it.
      const panel = new GUI({ title: 'Tuning (` to hide)' });
      panel.hide();
      const folderOf = (key: string) => {
        if (/camera|fov|shake|lag|roll ?factor|cameraRoll/i.test(key)) return 'Camera';
        if (/roll|pitch|bounce|bump|squash|wiggle|bodyScale/i.test(key)) return 'Body';
        if (/steer|turn|grip|drift|gamepad|wheelsteer/i.test(key)) return 'Steering';
        if (/tire|dust|speedLine|flame|hud|sound|volume/i.test(key)) return 'Effects';
        return 'Engine';
      };
      const folders = new Map(['Engine', 'Steering', 'Body', 'Camera', 'Effects'].map(name => [name, panel.addFolder(name)]));
      for (const config of [CAR_CONFIG, JUICE_CONFIG] as Record<string, unknown>[]) {
        for (const [key, value] of Object.entries(config)) {
          const folder = folders.get(folderOf(key))!;
          if (typeof value === 'boolean') folder.add(config, key);
          else if (typeof value === 'number') {
            const span = Math.max(Math.abs(value) * 3, 1);
            folder.add(config, key, value < 0 ? -span : 0, value < 0 ? 0 : span);
          }
        }
      }
      // Engine sound: just the few sliders that matter for the engine's character.
      const engineSound = panel.addFolder('Engine sound');
      ([['synthVolume', 'Volume'], ['engineBody', 'Thickness'], ['engineRumble', 'Putter'], ['enginePitch', 'Pitch'], ['engineGrit', 'Grit']] as const)
        .forEach(([key, name]) => { const [min, max, step] = AUDIO_RANGES[key]; engineSound.add(AUDIO_CONFIG, key, min, max, step).name(name); });
      // Audio: every value of the car audio (see audio.ts), applied live. Closed, as it is long.
      const audio = panel.addFolder('Audio (all)');
      for (const [key, [min, max, step]] of Object.entries(AUDIO_RANGES)) audio.add(AUDIO_CONFIG, key, min, max, step);
      audio.close();
      panel.add({ copy: () => navigator.clipboard?.writeText(JSON.stringify({ CAR_CONFIG, JUICE_CONFIG, AUDIO_CONFIG }, null, 2)) }, 'copy').name('Copy values');
      gui = panel as unknown as typeof gui;
    });
    window.addEventListener('keydown', toggle);
    return () => { disposed = true; gui?.destroy(); window.removeEventListener('keydown', toggle); };
  }, []);
  // Only warn after the car has stayed off the road for a moment, not on every brief excursion.
  const offRoadNow = started && !halted && !!data.offroad;
  const [roadWarning, setRoadWarning] = useState(false);
  useEffect(() => {
    if (!offRoadNow) { setRoadWarning(false); return; }
    const timer = setTimeout(() => setRoadWarning(true), 2000);
    return () => clearTimeout(timer);
  }, [offRoadNow]);
  // Stuck: a pedal is held but the car has barely moved for a moment. Then a hint offers the back-to-road key.
  const stuck = useRef({ time: 0, last: 0 });
  const [stuckHint, setStuckHint] = useState(false);
  useEffect(() => {
    const now = performance.now();
    const state = stuck.current;
    const dt = state.last ? Math.min((now - state.last) / 1000, 0.5) : 0;
    state.last = now;
    const pressing = (data.throttle ?? 0) > 0.3 || controls.current.back;
    state.time = started && !halted && pressing && data.speed < 3 ? state.time + dt : 0;
    if (state.time > 1.5) setStuckHint(true);
    else if (data.speed > 8 || !started) setStuckHint(false);
  }, [data, started, paused]);
  const recover = useCallback(() => { recoverToRoad(car.current); stuck.current.time = 0; setStuckHint(false); }, []);
  useEffect(() => {
    const update = () => setGamepad((navigator.getGamepads?.() ?? []).some(Boolean));
    window.addEventListener('gamepadconnected', update);
    window.addEventListener('gamepaddisconnected', update);
    return () => { window.removeEventListener('gamepadconnected', update); window.removeEventListener('gamepaddisconnected', update); };
  }, []);
  const controls = useRef(emptyControls());
  const tiltNoticeTimer = useRef<number | null>(null);
  const announceTilt = (message: string) => {
    setTiltNotice(message);
    if (tiltNoticeTimer.current !== null) window.clearTimeout(tiltNoticeTimer.current);
    tiltNoticeTimer.current = window.setTimeout(() => setTiltNotice(''), 2600);
  };
  const requestTiltAssist = async () => {
    if (tiltAssist) return;
    if (!window.isSecureContext) { announceTilt('Tilt assist needs a secure connection'); return; }
    if (!('DeviceOrientationEvent' in window)) { announceTilt('This browser does not support phone tilt'); return; }
    try {
      const orientation = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      if (orientation.requestPermission && await orientation.requestPermission() !== 'granted') {
        announceTilt('Allow motion access to use tilt assist');
        return;
      }
      setTiltAssist(true);
    } catch {
      announceTilt('Motion access was not available');
    }
  };
  useEffect(() => {
    if (!tiltAssist || !started) { controls.current.tilt = 0; return; }
    let neutral: number | null = null;
    let filtered = 0;
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.gamma === null) return;
      const angle = screen.orientation?.angle ?? 0;
      let axis = event.gamma;
      if (angle === 90) axis = -(event.beta ?? 0);
      else if (angle === 180) axis = -event.gamma;
      else if (angle === 270) axis = event.beta ?? 0;
      if (neutral === null) { neutral = axis; return; }
      const delta = axis - neutral;
      const amount = Math.min(1, Math.max(0, (Math.abs(delta) - 2.5) / 17));
      const target = -Math.sign(delta) * amount;
      filtered += (target - filtered) * 0.18;
      controls.current.tilt = filtered;
    };
    const recalibrate = () => { neutral = null; filtered = 0; controls.current.tilt = 0; };
    window.addEventListener('deviceorientation', onOrientation);
    window.addEventListener('orientationchange', recalibrate);
    return () => {
      window.removeEventListener('deviceorientation', onOrientation);
      window.removeEventListener('orientationchange', recalibrate);
      controls.current.tilt = 0;
    };
  }, [tiltAssist, started]);
  const car = useRef(initialLoopCar());
  const reset = useCallback(() => {
    controls.current = emptyControls(); setResetKey(k => k + 1); setPaused(false); setScore(0); setHitNote(null);
    // A new run: hearts, stage, stats, stars, clean driving and the best-score note start over.
    beatBest.current = false; lastDistance.current = 0; distanceCarry.current = 0; shownScore.current = 0; if (scoreText.current) scoreText.current.textContent = '0'; bestAtRunStart.current = loadBest();
    setHearts(HEARTS); heartsRef.current = HEARTS; setRunOver(false); setFinale(false); runStats.current = emptyRunStats();
    stageRef.current = 1; setDifficultyLevel(1);
    if (touchQuery?.matches) resetToDay();
  }, []);
  // The start screen stays mounted for a moment as the globe zooms in: its keys pill folds down to just the keys.
  const [introExit, setIntroExit] = useState(false);
  const [headerMotion, setHeaderMotion] = useState<'exiting' | 'entering' | ''>('');
  const headerMotionTimers = useRef<number[]>([]);
  const clearHeaderMotionTimers = () => {
    headerMotionTimers.current.forEach(timer => window.clearTimeout(timer));
    headerMotionTimers.current = [];
  };
  const start = () => {
    if (introExit) return;
    clearHeaderMotionTimers();
    void requestTiltAssist();
    setHeaderMotion('exiting');
    setIntroExit(true);
    headerMotionTimers.current.push(window.setTimeout(() => {
      setStarted(true); setPaused(false); setMapView(false);
      setHeaderMotion('entering');
      headerMotionTimers.current.push(window.setTimeout(() => setHeaderMotion(''), 280));
    }, 140));
    window.setTimeout(() => setIntroExit(false), 1200);
    startAudio(); playEngineStart(); controls.current = emptyControls();
  };
  const returnToHero = () => {
    if (headerMotion === 'exiting') return;
    clearHeaderMotionTimers();
    controls.current = emptyControls();
    setMobileMenuOpen(false);
    setHeaderMotion('exiting');
    setPaused(true);
    headerMotionTimers.current.push(window.setTimeout(() => {
      setStarted(false); setPaused(false); setMapView(false);
      setHeaderMotion('entering');
      headerMotionTimers.current.push(window.setTimeout(() => setHeaderMotion(''), 280));
    }, 140));
  };
  const onReady = useCallback(() => setReady(true), []);

  useEffect(() => {
    const mapping: Record<string, ControlKey> = { ShiftLeft: 'boost', ShiftRight: 'boost', AltLeft: 'gentle', AltRight: 'gentle', KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'brake' };
    const held = new Set<string>();
    const clear = () => { held.clear(); controls.current = emptyControls(); };
    const down = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const isTextEntry = !!target && (target.matches('input,textarea,select') || target.isContentEditable || !!target.closest('[contenteditable="true"]'));
      if (isTextEntry) return;
      const isButton = !!target && !!target.closest('button');
      if (isButton && (e.code === 'Enter' || (e.code === 'Space' && (!started || paused || help)))) return;
      if (mapping[e.code] && !paused && !help && !boardOpen && !mapView && !runOver && !finale) { e.preventDefault(); held.add(e.code); controls.current[mapping[e.code]] = true; }
      if (e.repeat) return;
      if (e.code === 'KeyM' && started && !paused && !help && !runOver && !finale) { clear(); morph(() => setMapView(v => !v)); }
      if (e.code === 'KeyR' && started && !help && !mapView && !runOver && !finale) reset();
      if (e.code === 'KeyF' && started && !paused && !help && !mapView && !runOver && !finale) recover();
      if (e.code === 'KeyC' && !help && !runOver && !finale) setCameraMode(n => 1 - n);
      if (e.code === 'Escape' && (runOver || finale)) return;
      if (e.code === 'Escape' && mobileMenuOpen) { setMobileMenuOpen(false); return; }
      if (e.code === 'Escape' && boardOpen) { setBoardOpen(false); return; }
      if (e.code === 'Escape') { clear(); if (help) setHelp(false); else if (mapView) morph(() => setMapView(false)); else if (started) setPaused(v => !v); }
    };
    const up = (e: KeyboardEvent) => { held.delete(e.code); if (mapping[e.code]) controls.current[mapping[e.code]] = [...held].some(key => mapping[key] === mapping[e.code]); };
    const blur = () => { clear(); if (started) setPaused(true); };
    const visibility = () => { if (document.hidden) blur(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility);
    return () => { clear(); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility); };
  }, [started, paused, help, boardOpen, mapView, runOver, finale, reset, recover, mobileMenuOpen]);

  const touch = (key: ControlKey) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); controls.current[key] = true; },
    onPointerUp: () => { controls.current[key] = false; },
    onPointerCancel: () => { controls.current[key] = false; },
    onLostPointerCapture: () => { controls.current[key] = false; },
  });
  return <main ref={mainRef} className={`app scale-study q-${VISUAL_QUALITY}${RAILS ? ' rails' : ''} ${night ? 'night' : ''} ${started ? 'playing' : 'intro'}${mapView ? ' map-view' : ''}${finale ? ' finale' : ''} ${revealed ? 'ready' : ''}`} style={{ '--night-top': nightValues.skyTop, '--night-horizon': nightValues.skyHorizon, '--aurora': nightValues.aurora, '--boost-tint': boostValues.tintColour, '--boost-tint-opacity': boostValues.tintOpacity } as CSSProperties}>
    {showLook && <LookPanel
      mode={lookMode}
      onMode={mode => { setLookMode(mode); if (mode === 'day' || mode === 'night' || mode === 'nearMiss') goTo(mode === 'day' ? 'day' : 'night'); }}
      look={{ day: look, night: nightValues, car: carValues, camera: cameraValues, boost: boostValues, nearMiss: nearMissValues, sound: soundValues, warm: warmValues }[lookMode]}
      sliders={{ day: DAY_LOOK_SLIDERS, night: NIGHT_LOOK_SLIDERS, car: CAR_TUNING_SLIDERS, camera: CAMERA_TUNING_SLIDERS, boost: BOOST_TUNING_SLIDERS, nearMiss: NEAR_MISS_LOOK_SLIDERS, sound: SOUND_TUNING_SLIDERS, warm: WARM_LIGHT_SLIDERS }[lookMode]}
      colours={lookMode === 'boost' ? BOOST_TUNING_COLOURS : lookMode === 'nearMiss' ? NEAR_MISS_LOOK_COLOURS : lookMode === 'warm' ? WARM_LIGHT_COLOURS : undefined}
      saved={{ day: DAY_LOOK_SAVED, night: NIGHT_LOOK_SAVED, car: CAR_TUNING_SAVED, camera: CAMERA_TUNING_SAVED, boost: BOOST_TUNING_SAVED, nearMiss: NEAR_MISS_LOOK_SAVED, sound: SOUND_TUNING_SAVED, warm: WARM_LIGHT_SAVED }[lookMode]}
      endpoint={{ day: '/__day-look', night: '/__night-look', car: '/__car-tuning', camera: '/__camera-tuning', boost: '/__boost-tuning', nearMiss: '/__near-miss-look', sound: '/__sound-tuning', warm: '/__warm-light' }[lookMode]}
      onChange={values => {
        if (lookMode === 'day') changeLook(values as DayLook);
        else if (lookMode === 'night') changeNightLook(values as NightLook);
        else if (lookMode === 'car') changeCar(values as unknown as CarTuning);
        else if (lookMode === 'camera') changeCamera(values as unknown as CameraTuning);
        else if (lookMode === 'boost') changeBoost(values as unknown as BoostTuning);
        else if (lookMode === 'nearMiss') changeNearMiss(values as unknown as NearMissLook);
        else if (lookMode === 'warm') changeWarm(values as unknown as WarmLight);
        else changeSound(values as unknown as SoundTuning);
      }}
      onClose={() => setShowLook(false)}
    />}
    <div className="scene"><DaySky /><div className="sky-glow" aria-hidden="true" /><NightSky /><SceneBoundary><Scene started={started && !mapView} paused={paused || help || boardOpen || mapView || runOver} mapView={mapView} finale={finale} danger={hearts === 1} cameraMode={cameraMode} resetKey={resetKey} controls={controls} car={car} onTelemetry={setData} onReady={onReady} onTrafficHit={handleTrafficHit} onNearMiss={handleNearMiss} onDrift={handleDrift} onDriftCinematic={handleDriftCinematic} /></SceneBoundary><div className={`boost-tint${started && data.boosting ? ' on' : ''}`} aria-hidden="true" /></div>
    <div className="vignette" />
    <header className={`topbar${headerMotion ? ` header-${headerMotion}` : ''}`}>
      {/* Three parts: the logo on the start screen or the driver's level while driving (left), the score
          (centre, driving only), and the settings with pause (right). No logo while driving. */}
      {started
        // A round home button (back to the start screen), then the driver's level.
        ? <div className="topbar-left">
          <button className="home-button" aria-label="Back to the start screen" title="Home" onClick={returnToHero}><House /></button>
          <div className="level-badge" aria-label={`Level ${level.level}, ${level.title}, ${level.into} of ${level.need} XP`}>
          <span className="level-number" key={level.level}>{level.level}</span>
          <div><strong>{level.title}</strong><i><span style={{ transform: `scaleX(${level.into / level.need})` }} /></i><small>{level.into} / {level.need} XP</small></div>
          </div>
        </div>
        : <>
          <a href="#" className="brand brand-desktop" aria-label="Wander, home" onClick={e => e.preventDefault()}>
            <div><strong dir="ltr">Wander<span>.</span></strong><small>take a spin</small></div>
          </a>
          <div className="mobile-brand-menu" ref={mobileBrandRef}>
            <button type="button" className="brand mobile-brand-trigger" aria-label="Wander menu" aria-expanded={mobileMenuOpen} aria-controls="mobile-brand-actions" onClick={() => setMobileMenuOpen(open => !open)}>
              <div><strong dir="ltr">Wander<span>.</span></strong><small>take a spin</small></div>
            </button>
            {mobileMenuOpen && <div className="mobile-brand-actions" id="mobile-brand-actions" role="group" aria-label="Game options">
              <button type="button" onClick={() => { setMobileMenuOpen(false); setCameraMode(mode => 1 - mode); }}><Maximize2 /><span>Change camera view</span></button>
              <button type="button" onClick={() => { setMobileMenuOpen(false); setBoardOpen(true); }}><Trophy /><span>Leaderboard</span></button>
              <button type="button" onClick={() => { setMobileMenuOpen(false); setHelp(true); }}><CircleHelp /><span>Controls and help</span></button>
            </div>}
          </div>
        </>}
      {/* Score and hearts side by side in the middle of the header. The score counts up smoothly (distance adds
          to it all the time); a bonus makes it react in proportion to its size, with the amount floating off. */}
      {started && <div className="hud-center">
        <div className="score-pill" aria-label={`Score ${score}, level ${level.level}`}>
          {/* Phones have no room for the level badge: its number joins the score instead (style.css). */}
          <span className="level-number score-level" aria-hidden="true">{level.level}</span>
          <span>Score</span><b key={`score-${bonus?.id ?? 0}`} ref={scoreText} className={`score-value ${bonusTier(bonus?.amount ?? 0)}`}>{formatNumber(shownScore.current)}</b>
          {bonus && <span key={`float-${bonus.id}`} className={`score-float ${bonusTier(bonus.amount)}`} aria-hidden="true">{bonus.amount > 0 ? '+' : ''}{formatNumber(bonus.amount)}</span>}
        </div>
        <div key={`hearts-${heartBreak?.id ?? 0}`} className={`hearts-bar${hearts === 1 ? ' last' : ''}${heartBreak ? ' hit' : ''}`} aria-label={`${hearts} of ${HEARTS} hearts left`}>
          {Array.from({ length: HEARTS }, (_, i) => <HeartIcon key={i} className={i < hearts ? 'full' : i === hearts && heartBreak ? 'breaking' : 'lost'} />)}
        </div>
      </div>}
      {stuckHint
        ? <div className="road-warning" role="status"><TriangleAlert size={16} /><span>Stuck? Press <kbd>F</kbd> to hop back on the road</span></div>
        : roadWarning && <div className="road-warning" role="status"><TriangleAlert size={16} /><span>Off road — head back to the road</span></div>}
      <nav className="toolbar" aria-label="Game settings">
        {/* Phones, on the start screen: pick day or night, and the run starts there. */}
        {!started && <button className="mode-toggle" aria-label={night ? 'Start in daylight' : 'Start at night'} title={night ? 'Day' : 'Night'} onClick={() => goTo(night ? 'day' : 'night')}>{night ? <Sun /> : <Moon />}</button>}
        <button className="desktop-only" aria-label={night ? 'Switch to evening' : 'Switch to night'} style={{ viewTransitionName: 'tool-night' } as CSSProperties} title={night ? 'Evening' : 'Night'} onClick={() => goTo(headingToNight() ? 'day' : 'night')}>{night ? <Sun /> : <Moon />}</button>
        {!started && <button className="mobile-home-theme" aria-label={night ? 'Switch to light mode' : 'Switch to dark mode'} title={night ? 'Light mode' : 'Dark mode'} onClick={() => goTo(headingToNight() ? 'day' : 'night')}>{night ? <Sun /> : <Moon />}</button>}
        {import.meta.env.DEV && <button aria-label="Day look" style={{ viewTransitionName: 'tool-look' } as CSSProperties} title="Day look" className={`desktop-only${showLook ? ' active' : ''}`} onClick={() => setShowLook(value => !value)}><SlidersHorizontal /></button>}
        <button aria-label={muted ? 'Unmute sound' : 'Mute sound'} style={{ viewTransitionName: 'tool-sound' } as CSSProperties} title={muted ? 'Sound off' : 'Sound on'} onClick={() => setMutedState(m => !m)}>{muted ? <VolumeX /> : <Volume2 />}</button>
        <button className={`desktop-only${cameraMode ? ' active' : ''}`} aria-label="Change camera view" style={{ viewTransitionName: 'tool-camera' } as CSSProperties} title="Change camera · C" onClick={() => setCameraMode(n => 1 - n)}><Maximize2 /></button>
        <button className="desktop-only" aria-label="Leaderboard" title="Leaderboard" style={{ viewTransitionName: 'tool-board' } as CSSProperties} onClick={() => setBoardOpen(true)}><Trophy /></button>
        <button className="desktop-only" aria-label="Controls and help" style={{ viewTransitionName: 'tool-help' } as CSSProperties} title="Controls and help" onClick={() => setHelp(true)}><CircleHelp /></button>
        {started && <button className={`desktop-only${mapView ? ' active' : ''}`} aria-label={mapView ? 'Back to the road' : 'Open the map'} style={{ viewTransitionName: 'tool-map' } as CSSProperties} title="Map · M" onClick={() => { controls.current = emptyControls(); morph(() => setMapView(v => !v)); }}><MapIcon /></button>}
        {started && !mapView && <button className="desktop-only" aria-label={paused ? 'Resume driving' : 'Pause game'} style={{ viewTransitionName: 'tool-pause' } as CSSProperties} title="Pause · Esc" onClick={() => setPaused(p => !p)}>{paused ? <Play /> : <Pause />}</button>}
      </nav>
    </header>

    {(!started || introExit) && <section className={`intro-card${introExit ? ' exiting' : ''}`}>
      {/* The driver's level, like the badge in the game's header; a welcome back for returning players. */}
      <div className="intro-level rise" style={{ '--d': '800ms' } as CSSProperties}>
        <span className="level-number">{level.level}</span><strong>{level.title}</strong>{best > 0 ? <span className="intro-welcome">Best {formatNumber(best)}</span> : xp > 0 && <span className="intro-welcome">Welcome back</span>}
      </div>
      <h1 aria-label={TITLE}>{[...TITLE].map((c, i) => <span key={i} aria-hidden="true" className={`ch${c === '.' ? ' dot' : ''}`} style={{ '--d': `${1000 + i * 60}ms` } as CSSProperties}>{c === ' ' ? '\u00a0' : c}</span>)}</h1>
      <p className="intro-copy rise" style={{ '--d': '1700ms' } as CSSProperties}>
        <span>A small world, a long road.</span>
        <span>Drive in your browser. Nothing to install.</span>
      </p>
      <div className="rise cta" style={{ '--d': '2100ms' } as CSSProperties}><button className="primary start-button" disabled={!ready} onClick={start}><span>{ready ? 'Start driving' : 'Preparing the globe...'}</span><span className="start-arrow"><ArrowRight size={20} /></span></button></div>
      <div className="intro-hints rise" style={{ '--d': '2500ms' } as CSSProperties}>
        <div className="intro-controls"><span className="key-cluster"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span className="keys-word">or arrow keys</span></div>
      </div>
    </section>}

    {started && mapView && <div className="map-bar" role="dialog" aria-label="Map">
      <span className="map-hint">Drag to turn the world</span>
      <button className="map-back" autoFocus onClick={() => morph(() => setMapView(false))}>Back to the road <ArrowRight size={18} /></button>
      <span className="map-key"><kbd>M</kbd></span>
    </div>}
    {started && !mapView && <>
      {boostFlash > 0 && <div key={boostFlash} className="boost-flash" aria-hidden="true" />}
      {heartBreak && <div key={`break-${heartBreak.id}`} className="heart-break" role="status" aria-label={heartBreak.left === 0 ? 'No hearts left' : `${heartBreak.left} hearts left`}>
        <div className="heart-break-pulse" aria-hidden="true" />
        <div className="heart-break-heart" aria-hidden="true"><HeartIcon className="half left" /><HeartIcon className="half right" /></div>
        <strong>{heartBreak.left === 0 ? 'OUT OF HEARTS' : heartBreak.left === 1 ? 'LAST HEART' : `${heartBreak.left} LEFT`}</strong>
      </div>}
      <Coach rails={!!RAILS} active={!paused && !help && !roadWarning && !stuckHint} controls={controls} speed={data.speed} offroad={!!data.offroad} boostReady={(data.boost ?? 1) >= 1 && !data.boosting} />
      <div className="speedometer" ref={speedometer}>
        <svg className="speed-dial" viewBox="0 0 64 64" aria-hidden="true">
          <defs>
            <linearGradient id="speed-fire" gradientUnits="userSpaceOnUse" x1="32" y1="5" x2="32" y2="59" gradientTransform="rotate(-135 32 32)">
              <stop offset="0" stopColor="#ffc35a" /><stop offset="0.5" stopColor="#ffb347" /><stop offset="1" stopColor="#ff5a36" />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="27" pathLength="100" className="arc-track" />
          <circle cx="32" cy="32" r="27" pathLength="100" className="arc-fill" />
          <circle cx="32" cy="32" r="27" pathLength="100" className="arc-heat" />
        </svg>
        <div className="speed-readout"><strong ref={speedText}>0</strong><small>km/h</small></div>
        <span className="speed-label"><b>{car.current.speed < -0.1 ? 'R' : 'D'}</b>{formatNumber(data.distance)} m</span>
      </div>
      <BoostGauge car={car} controls={controls} offroad={!!data.offroad} />
      {hitNote && (hitNote.kind.startsWith('big') || hitNote.kind === 'cineDrift'
        // During a slow-motion cut-in, or ramming cars under boost: big, the word built letter by letter.
        ? <div key={hitNote.id} className={`big-note ${{ bigSmash: 'smash', bigNear: 'near', bigBoost: 'boost', cineDrift: 'drift-cine' }[hitNote.kind as 'bigSmash']}`} role="status" aria-label={`${hitNote.text} ${hitNote.points}`}>
          <strong aria-hidden="true">{[...hitNote.text].map((letter, i) => <span key={i} style={{ '--i': i } as CSSProperties}>{letter === ' ' ? '\u00a0' : letter}</span>)}</strong>
          <span className="big-scores" aria-hidden="true">
            {hitNote.points !== 0 && <b style={{ '--i': hitNote.text.length } as CSSProperties}>{hitNote.points > 0 ? '+' : ''}{hitNote.points}</b>}
          </span>
        </div>
        : <div key={hitNote.id} className={`hit-note ${/drift/i.test(hitNote.kind) ? `drift ${hitNote.kind}` : hitNote.kind}`} role="status">{hitNote.text} <b>{BADGE_NOTES.includes(hitNote.kind) ? hitNote.badge : `${hitNote.points > 0 ? '+' : ''}${hitNote.points}`}</b>{!BADGE_NOTES.includes(hitNote.kind) && hitNote.badge && <b className="note-combo">{hitNote.badge}</b>}</div>)}
      {/* One line of captions at a time: a traffic note takes the slot over a streak. */}
      {streakShown && !hitNote && <div key={streakLevel} className="hit-note streak" role="status">{streakMessages[(streakLevel - 1) % streakMessages.length]} <b>×{streakLevel}</b></div>}
      <div className="driving-actions"><button onClick={reset}><RotateCcw size={15} /> Restart</button><span className="key-hint"><kbd>Space</kbd> Brake</span><span className="key-hint"><kbd>Shift</kbd> Boost</span><span className="key-hint"><kbd>F</kbd> Back to road</span><span className="key-hint"><kbd>C</kbd> Camera</span>{gamepad && <span className="gamepad-hint">Gamepad connected</span>}</div>
      {RAILS ? <SteerPads controls={controls} /> : <div className="touch-controls" aria-label="Touch controls"><SteeringWheel controls={controls} /><div className="pedals"><button className="reverse-touch" aria-label="Reverse" {...touch('back')}><ArrowDown /></button><button className="brake-touch" aria-label="Brake" {...touch('brake')}>Brake</button><button className="gas-touch" aria-label="Accelerate" {...touch('forward')}>Gas</button></div></div>}
    </>}

    {!started && <footer className="page-footer"><span>WANDER · THE LONG WAY ROUND</span></footer>}
    {started && paused && headerMotion !== 'exiting' && !help && !boardOpen && <div className="modal-shade"><section className="modal pause-modal" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <span className="eyebrow">PAUSED</span><h2 id="pause-title">Take a breath.</h2>
      <div className="pause-stats">
        <div><small>Score · best {formatNumber(best)}</small><b>{formatNumber(score)}</b></div>
        <div><small>Level {level.level}</small><b>{level.title}</b><i><span style={{ transform: `scaleX(${level.into / level.need})` }} /></i></div>
        <div><small>Driven</small><b>{formatNumber(data.distance)} m</b></div>
      </div>
      <button autoFocus className="primary" onClick={() => setPaused(false)}>Keep going <Play size={18} /></button>
      <div className="modal-row">
        <button className="secondary" onClick={reset}><RotateCcw size={15} /> Restart</button>
        <button className="secondary" onClick={returnToHero}><ChevronLeft size={15} /> Back to the globe</button>
      </div>
    </section></div>}
    {tiltNotice && <div className="toast tilt-toast" role="status">{tiltNotice}</div>}
    {help && <Help close={() => setHelp(false)} />}
    {boardOpen && <Leaderboard close={() => setBoardOpen(false)} />}
    {finale && <div className="letterbox" aria-hidden="true"><i /><i /></div>}
    {runOver && <RunOver score={score} newBest={beatBest.current} stats={runStats.current} onPlayAgain={reset}
      onHome={() => { reset(); returnToHero(); }} />}
    <LoadingScreen ready={ready} onLeave={() => setRevealed(true)} />
    <GameCursor rootRef={mainRef} />
  </main>;
}
