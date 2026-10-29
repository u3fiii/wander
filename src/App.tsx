import { Component, Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Car, Check, Map as MapIcon, Palette, Sparkles, Timer, Users, Video, Menu, Trophy, SlidersHorizontal, ChevronLeft, ChevronRight, CircleHelp, CarFront, Maximize2, Minimize2, Moon, Pause, Play, RotateCcw, Sun, Trash2, TriangleAlert, Volume2, VolumeX, X } from 'lucide-react';
import Scene, { scoreDrift } from './game/Scene';
import Garage from './Garage';
import { loadVehicle, saveVehicle } from './game/vehicles';
import type { VehicleId } from './game/vehicles';
import { setActiveVehicle, DRIVING_CONFIG } from './game/vehicleHandling';
import LoadingScreen from './LoadingScreen';
import Coach from './Coach';
import BoostGauge from './BoostGauge';
import WaveButton from './WaveButton';
import { resetRunWave, waveScore, waveWord } from './game/wave';
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
function SteerPads({ controls, tutorial = false }: { controls: React.RefObject<{ left: boolean; right: boolean }>; tutorial?: boolean }) {
  type Side = 'left' | 'right';
  const [held, setHeld] = useState({ left: false, right: false });
  const [practiced, setPracticed] = useState({ left: false, right: false });
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
      if (tutorial && (left || right)) setPracticed(p => (p.left === (p.left || left) && p.right === (p.right || right) ? p : { left: p.left || left, right: p.right || right }));
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
  }, [controls, tap, ripple, tutorial]);
  const lessonActive = tutorial && !(practiced.left && practiced.right);
  return <div className="steer-pads" aria-label="Steering">
    {(['left', 'right'] as const).map(side => <div
      key={side}
      ref={element => { zones.current[side] = element; }}
      className={`steer-zone ${side}${held[side] ? ' held' : ''}${lessonActive ? ' tutorial' : ''}${practiced[side] ? ' practiced' : ''}`}
      role="button"
      aria-label={side === 'left' ? 'Steer left' : 'Steer right'}
      onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); set(side, true); }}
      onPointerUp={() => set(side, false)}
      onPointerCancel={() => set(side, false)}
      onLostPointerCapture={() => set(side, false)}
    >
      {lessonActive && <span className="steer-lesson" aria-hidden="true">{practiced[side] ? '✓ NICE!' : side === 'left' ? 'HOLD LEFT' : 'HOLD RIGHT'}</span>}
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
import { NIGHT_LOOK_COLOURS, NIGHT_LOOK_SAVED, NIGHT_LOOK_SLIDERS, nightLook } from './game/nightLook';
import type { NightLook } from './game/nightLook';
import { CAR_TUNING_SAVED, CAR_TUNING_SLIDERS } from './game/carTuning';
import { DRIFT_TUNING_SAVED, DRIFT_TUNING_SLIDERS, applyDriftTuning, currentDriftTuning } from './game/driftTuning';
import type { DriftTuning } from './game/driftTuning';
import type { CarTuning } from './game/carTuning';
import { CAMERA_TUNING_SAVED, CAMERA_TUNING_SLIDERS, applyCameraTuning, cameraTuning } from './game/cameraTuning';
import { BOOST_TUNING_COLOURS, BOOST_TUNING_SAVED, BOOST_TUNING_SLIDERS, applyBoostTuning, boostTuning, type BoostTuning } from './game/boostTuning';
import type { CameraTuning } from './game/cameraTuning';
import { CAR_CONFIG, JUICE_CONFIG } from './game/config';
import { NEAR_MISS_LOOK_COLOURS, NEAR_MISS_LOOK_SAVED, NEAR_MISS_LOOK_SLIDERS, nearMissLook } from './game/nearMissLook';
import type { NearMissLook } from './game/nearMissLook';
import { WARM_LIGHT_COLOURS, WARM_LIGHT_SAVED, WARM_LIGHT_SLIDERS, warmLight } from './game/warmLight';
import type { WarmLight } from './game/warmLight';
import { CAR_LOOK_COLOURS, CAR_LOOK_PRESETS, CAR_LOOK_SAVED, CAR_LOOK_SLIDERS, carLook } from './game/carLook';
import type { CarLook } from './game/carLook';
import { SOUND_TUNING_SAVED, SOUND_TUNING_SLIDERS, applySoundTuning, soundTuning } from './game/soundTuning';
import type { SoundTuning } from './game/soundTuning';
import { cinematicState } from './game/cinematic';
import { VISUAL_QUALITY } from './game/artDirection';
import { levelFor, loadXp, saveXp, streakXp } from './game/progression';
import { rampFor } from './game/difficulty';
import { HEARTS, HEART_GRACE_MS, emptyRunStats, loadBest, saveBest, stageFor } from './game/leaderboard';
import RunOver from './RunOver';
import Leaderboard from './Leaderboard';
import { LeaderboardChase } from './LeaderboardChase';
import { difficulty, setDifficultyLevel } from './game/difficulty';
import { goTo, jumpTo, mixHex, nightAmount, settleAt, skyAt, twilight } from './game/dayCycle';
import { HOME_STAGE_SECONDS, STAGES, cardLook, nextMorning, stageTime, stagesReached, themeForStage } from './game/stages';
import { THEMES, THEME_COLOURS, STAGE_SIMPLE_COLOURS, STAGE_SIMPLE_SLIDERS, uiOf, addStage, moveStage, removeStage, setSeparateHome, setViewMode, themeChoices, THEME_TUNING_SLIDERS, applyThemeTuning, currentThemeTuning, currentThemes, readThemeEdit, setTheme as previewTheme, themeSettings, themeState, writeThemeEdit } from './game/themes';
import type { ThemeEdit } from './game/themes';
import { markThemeTuningSaved, savedThemeTuning } from './game/themeTuning';
import { useGamepadMenu } from './useGamepadMenu';
import { useInputDevice } from './inputDevice';
import { setCssVar } from './cssVar';
import { PartyHud, PartyLobby } from './Party';
import { PARTY, lineUp } from './game/party';
import type { PartyPlayer, PartyRun } from './game/party';
import { Keys } from './Keys';
import type { Action } from './Keys';
import type { InputDevice } from './inputDevice';
import { AUDIO_CONFIG, AUDIO_RANGES, holdWorld, playEngineStart, setMuted, startAudio } from './game/audio';

const TITLE = 'take a spin.';
// Traffic note wording, kept to a word or two, and which notes win when two land close together.
const NOTE_TEXT = {
  // A hard knock that costs points (a crash that costs a heart is the big one below).
  smash: ['Ouch!', 'Hard knock', 'That hurt', 'Watch the road'],
  // A close pass pays: the closer and faster, the more.
  near: ['Close call!', 'Squeezed by!', 'Nice dodge!', 'Too close!'],
  boost: ['Blown aside!', 'Shockwave!', 'Out of the way!', 'Clear the road!'],
  flick: ['Nice flick!', 'Sideswipe!', 'Pinball!'],
  bump: ['Bump', 'Easy now', 'Careful'],
  level: ['Level up!'],
  newBest: ['New best!'],
  stage: ['Traffic picks up'],
  // Shown big, in the middle of the screen, while a slow-motion cut-in plays.
  // A crash that costs a heart: the text says so (the heart count is added, see handleTrafficHit).
  bigSmash: ['CRASH!', 'WRECKED!', 'OUCH!', 'HEART LOST'],
  // Near-miss slow-motion: the big reward for a close one (bigger points than a plain close call).
  bigNear: ['BY A HAIR!', 'THAT WAS TIGHT!', 'SO CLOSE!', 'CLOSE CALL!'],
  // Ramming cars under boost: big too, with the combo.
  bigBoost: ['SMASH!', 'BOOM!', 'WRECKING BALL!', 'OUT OF MY WAY!', 'UNSTOPPABLE!'],
  // The overhead near-miss cut-in, camera looking straight down: purple, slid in like the car, and the biggest payout.
  cineNear: ['THREADED IT!', 'NEEDLE EYE!', 'RAZOR THIN!', 'PERFECT PASS!'],
  // The shockwave going off: the word, and the cars it threw.
  bigWave: ['SHOCKWAVE!', 'KABOOM!', 'CLEARED OUT!', 'BOOM!'],
  drift: ['Nice drift!', 'Clean slide!'],
  bigDrift: ['Big drift!', 'Sideways!'],
  hugeDrift: ['Drift king!', 'Endless slide!'],
};
// Cars thrown by one boost: each is worth `points` more than the one before; a pause of `gap` ms starts a new run.
const BOOST_CHAIN = { points: 50, gap: 3000 };
const NOTE_RANK = { bigWave: 6, bigSmash: 5, bigNear: 5, bigBoost: 5, cineNear: 5, level: 4, newBest: 4, stage: 4, smash: 3, hugeDrift: 3, near: 2, boost: 2, bigDrift: 2, drift: 1, flick: 1, bump: 1 };
// Notes that show a badge (an XP reward, a score) instead of points.
const BADGE_NOTES: string[] = ['level', 'newBest', 'stage'];
// How long the end-of-run shot plays before the run-over card (ms); matches FINALE in Scene.tsx.
const FINALE_MS = 3400;
// How big a score change is, for how strongly the score reacts to it.
const bonusTier = (amount: number) => (amount < 0 ? 'loss' : amount < 40 ? 'small' : amount < 120 ? 'mid' : amount < 300 ? 'big' : 'huge');
// Points for every metre driven, so the score always climbs while driving (not while riding the curb).
const DISTANCE_POINTS = 0.5;
// Near-miss combo: each close pass within `window` s of the last raises the score multiplier by `step` (from ×1 up
// to `max`); every point earned (distance, drifts, close calls, boost) is multiplied by it. A crash ends it, and so
// does `window` s without a close pass. Riding the curb never builds it: the points are in the traffic.
const COMBO = { window: 8, step: 0.5, max: 4 };
const comboMultiplier = (count: number) => Math.min(COMBO.max, 1 + COMBO.step * Math.max(0, count - 1));
// Hits slower than this (m/s) still score, but without a note.
const QUIET_HIT_SPEED = 7;
// Whether a colour is light enough that dark words read on it.
const lightHex = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.55;
};
// A colour drained toward the finale's cold steel-blue grey (by `amount`, 0..1), as the picture is.
const steelHex = (hex: string, amount: number) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  const steel = [luma * 0.86, luma * 0.95 + 0.01, luma * 1.08 + 0.03].map(v => Math.min(1, Math.max(0, (v - 0.45) * 1.3 + 0.45)));
  return `#${[r, g, b].map((v, i) => Math.round((v + (steel[i] * 0.88 + v * 0.12 - v) * amount) * 255).toString(16).padStart(2, '0')).join('')}`;
};
// One formatter for every number on screen (`toLocaleString` would build a new one on each call, several a frame).
const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
const formatNumber = (n: number) => NUMBER_FORMAT.format(Math.round(n));
const urlNumber = (name: string) => (typeof window === 'undefined' ? 0 : Math.max(0, Math.floor(Number(new URLSearchParams(window.location.search).get(name)) || 0)));
const FIRST_STAGE = urlNumber('stage');
// The run's clock as m:ss.
const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const FIRST_ROAD = urlNumber('road');
class SceneBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? <div className="error-screen"><h2>The 3D scene could not load</h2><p>Enable graphics acceleration in your browser and try again.</p><button className="primary" onClick={() => location.reload()}>Try again</button></div> : this.props.children; }
}
// Help: how the game works first (in a few lines), then the controls for the keyboard, an Xbox pad or touch, opening
// on whichever the player is using.
const HELP_ROWS: Array<{ action: Action; label: string }> = [
  { action: 'steer', label: 'Steer' }, { action: 'gas', label: 'Go faster' }, { action: 'brake', label: 'Brake, then reverse' },
  { action: 'drift', label: 'Handbrake — drift in a turn' }, { action: 'boost', label: 'Boost (when charged)' },
  { action: 'recover', label: 'Back to the road' }, { action: 'camera', label: 'Change the view' }, { action: 'map', label: 'Map' },
  { action: 'pause', label: 'Pause' }, { action: 'restart', label: 'Restart' },
];
function Help({ close, rails, device }: { close: () => void; rails: boolean; device: InputDevice }) {
  const [tab, setTab] = useState<InputDevice>(rails ? 'touch' : device === 'touch' ? 'keyboard' : device);
  const tabs: Array<[InputDevice, string]> = rails ? [['touch', 'Touch']] : [['keyboard', 'Keyboard'], ['gamepad', 'Controller']];
  return <div className="modal-shade help-shade" onClick={close}><section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e => e.stopPropagation()}>
    <button className="close-button" autoFocus aria-label="Close help" onClick={close}><X size={18} /></button>
    <span className="eyebrow">HOW TO PLAY</span><h2 id="help-title">A small world, a long road.</h2>
    <ul className="help-how">
      <li><Car aria-hidden="true" /><span><b>The car rolls on by itself.</b> {rails ? 'Hold either side of the screen to steer.' : 'Steer, and hold the gas to go faster.'}</span></li>
      <li><Sparkles aria-hidden="true" /><span><b>Slip past cars to score</b> — the closer the call, the more it pays. Drift and boost for big points.</span></li>
      <li><HeartIcon className="full" /><span><b>Crashes cost a heart.</b> Three, and the run is over.</span></li>
      <li><Palette aria-hidden="true" /><span><b>Keep going</b> and the world changes its colours along the way.</span></li>
    </ul>
    {tabs.length > 1 && <div className="help-tabs" role="tablist">{tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>}
    {tab === 'touch'
      ? <div className="help-rows">
        <div className="help-row"><span>Steer</span><span>Hold the left or right side</span></div>
        <div className="help-row"><span>Boost (when charged)</span><span>Tap the flame</span></div>
        <div className="help-row"><span>Pause and more</span><span>The menu at the top left</span></div>
      </div>
      : <div className="help-rows">{HELP_ROWS.filter(row => tab === 'keyboard' || row.action !== 'restart').map(row => <div key={row.action} className="help-row"><span>{row.label}</span><Keys action={row.action} device={tab} /></div>)}</div>}
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
type LookMode = 'day' | 'night' | 'car' | 'carLook' | 'drift' | 'theme' | 'camera' | 'boost' | 'nearMiss' | 'sound' | 'warm';
function LookPanel({ mode, onMode, look, sliders, colours, choices, extra, saved, endpoint, serialize, onChange, onSaved, onClose }: {
  mode: LookMode; onMode: (mode: LookMode) => void; look: LookValues; sliders: LookSlider[]; colours?: Array<{ key: string; label: string }>; saved: LookValues;
  // A row of buttons choosing one value (the theme to edit).
  choices?: { key: string; options: Array<{ value: number; label: string }> };
  // Anything more the tab needs under its choices (the Stages tab's view switch and loop tools).
  extra?: ReactNode;
  // `onSaved`: after a successful Apply (the tab's saved version is now what was applied).
  endpoint: string; serialize?: () => unknown; onChange: (look: LookValues) => void; onSaved?: () => void; onClose: () => void;
}) {
  const [status, setStatus] = useState('');
  // Before and after: while ticked, the tab shows its saved values (and can't be edited); unticked, the edits return.
  const [comparing, setComparing] = useState(false);
  const edits = useRef<LookValues | null>(null);
  const compare = (on: boolean) => {
    if (on) { edits.current = look; onChange({ ...saved }); }
    else if (edits.current) { onChange(edits.current); edits.current = null; }
    setComparing(on);
  };
  // Leaving the tab (or another stage, in the Stages tab) ends a comparison as it was.
  useEffect(() => { edits.current = null; setComparing(false); }, [mode]);
  const set = (key: string, value: number | string) => { onChange({ ...look, [key]: value }); setStatus(''); };
  const apply = async () => {
    setStatus('Saving…');
    try {
      const response = await fetch(endpoint, { method: 'POST', body: JSON.stringify(serialize ? serialize() : look) });
      if (response.ok) onSaved?.();
      setStatus(response.ok ? 'Saved — tell Claude to use it' : 'Could not save');
    } catch { setStatus('Could not save (dev server only)'); }
  };
  return <div className="day-look" role="dialog" aria-label="Look">
    <div className="day-look-head">
      <div className="day-look-tabs">
        <button className={mode === 'day' ? 'on' : ''} onClick={() => { onMode('day'); setStatus(''); }}>Day</button>
        <button className={mode === 'night' ? 'on' : ''} onClick={() => { onMode('night'); setStatus(''); }}>Night</button>
        <button className={mode === 'car' ? 'on' : ''} onClick={() => { onMode('car'); setStatus(''); }}>Car</button>
        <button className={mode === 'carLook' ? 'on' : ''} onClick={() => { onMode('carLook'); setStatus(''); }}>Car look</button>
        <button className={mode === 'drift' ? 'on' : ''} onClick={() => { onMode('drift'); setStatus(''); }}>Drift</button>
        <button className={mode === 'theme' ? 'on' : ''} onClick={() => { onMode('theme'); setStatus(''); }}>Stages</button>
        <button className={mode === 'camera' ? 'on' : ''} onClick={() => { onMode('camera'); setStatus(''); }}>Camera</button>
        <button className={mode === 'boost' ? 'on' : ''} onClick={() => { onMode('boost'); setStatus(''); }}>Boost</button>
        <button className={mode === 'nearMiss' ? 'on' : ''} onClick={() => { onMode('nearMiss'); setStatus(''); }}>Near miss</button>
        <button className={mode === 'sound' ? 'on' : ''} onClick={() => { onMode('sound'); setStatus(''); }}>Sound</button>
        <button className={mode === 'warm' ? 'on' : ''} onClick={() => { onMode('warm'); setStatus(''); }}>Warm light</button>
      </div>
      <button aria-label="Close" onClick={onClose}><X size={14} /></button>
    </div>
    <label className={`day-look-compare${comparing ? ' on' : ''}`}><input type="checkbox" checked={comparing} onChange={event => compare(event.target.checked)} />
      <span>{comparing ? 'Showing the saved version (before)' : 'Compare with the saved version'}</span></label>
    <fieldset className="day-look-fields" disabled={comparing}>
    {choices && <div className="day-look-choices" role="group">
      {choices.options.map(option => <button key={option.value} className={Number(look[choices.key]) === option.value ? 'on' : ''} onClick={() => set(choices.key, option.value)}>{option.label}</button>)}
    </div>}
    {extra}
    {colours && <div className="day-look-colours">
      {colours.map(colour => <label key={colour.key}><span>{colour.label}</span><input type="color" value={String(look[colour.key])} onChange={event => set(colour.key, event.target.value)} /></label>)}
    </div>}
    {sliders.map(slider => <Fragment key={slider.key}>{slider.group && <p className="day-look-group">{slider.group}</p>}<label className="day-look-row">
      <span>{slider.label}<b>{Number(look[slider.key]).toFixed(slider.step < 0.01 ? 3 : 2)}</b></span>
      <input type="range" min={slider.min} max={slider.max} step={slider.step} value={Number(look[slider.key])}
        onChange={event => set(slider.key, Number(event.target.value))} />
    </label></Fragment>)}
    {'skyTop' in look && mode !== 'theme' && !colours?.some(colour => colour.key === 'skyTop') && <div className="day-look-colours">
      <label><span>Sky top</span><input type="color" value={String(look.skyTop)} onChange={event => set('skyTop', event.target.value)} /></label>
      <label><span>Sky horizon</span><input type="color" value={String(look.skyHorizon)} onChange={event => set('skyHorizon', event.target.value)} /></label>
    </div>}
    </fieldset>
    <div className="day-look-actions">
      <button disabled={comparing} onClick={() => { onChange({ ...saved }); setStatus(''); }}>Reset</button>
      <button className="apply" disabled={comparing} onClick={apply}>Apply</button>
    </div>
    {status && <p className="day-look-status">{status}</p>}
  </div>;
}

export default function App() {
  const [started, setStarted] = useState(false);
  const [boostUnlocked, setBoostUnlocked] = useState(false);
  const boostElapsed = useRef(0);
  const [firstDrive, setFirstDrive] = useState(() => localStorage.getItem('wander:first-drive-complete') !== 'yes');
  const [coachThisRun, setCoachThisRun] = useState(false);
  const [coachShowing, setCoachShowing] = useState(false);
  const [coachTransitioning, setCoachTransitioning] = useState(false);
  const RAILS = useRails();
  const coachTimers = useRef<number[]>([]);
  const clearCoachTimers = useCallback(() => {
    coachTimers.current.forEach(timer => window.clearTimeout(timer));
    coachTimers.current = [];
  }, []);
  const completeFirstDrive = useCallback(() => {
    localStorage.setItem('wander:first-drive-complete', 'yes');
    setFirstDrive(false);
  }, []);
  const finishRailsLesson = useCallback(() => {
    clearCoachTimers();
    setCoachThisRun(false);
    setCoachTransitioning(true);
    coachTimers.current.push(window.setTimeout(() => {
      setCoachTransitioning(false);
      coachTimers.current.push(window.setTimeout(() => {
        localStorage.setItem('wander:first-drive-complete', 'yes');
        setFirstDrive(false);
      }, 3000));
    }, 3000));
  }, [clearCoachTimers]);
  const [paused, setPaused] = useState(false);
  // Map view: mid-drive, the camera pulls back to the globe (which can be turned by dragging) and the game holds
  // still until the player goes back to the road. M, the map button, or Esc to return.
  const [mapView, setMapView] = useState(false);
  // A run: hearts lost to hard crashes, then the run-over card (see leaderboard.ts).
  const [hearts, setHearts] = useState(HEARTS);
  const [runOver, setRunOver] = useState(false);
  // The finale: the end-of-run shot (slow motion, an orbit round the car, the end grade, letterbox bars) that plays
  // before the run-over card.
  const [finale, setFinale] = useState(false);
  useEffect(() => {
    if (!started || paused || mapView || runOver || finale || boostUnlocked || (RAILS && firstDrive)) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      boostElapsed.current += (now - last) / 1000;
      last = now;
      if (boostElapsed.current >= 15) setBoostUnlocked(true);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [started, paused, mapView, runOver, finale, boostUnlocked, RAILS, firstDrive]);
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
  // The Stages tab edits one stage at a time (`theme`: its index, Green 0 … Snow 5), shown live as it is changed,
  // time of day included; the stage card's look, the strength, speed and weather amount are shared. Apply saves all.
  // The simple tab's key colours, read from the detailed ones they stand for, and (in changeTheme) written back to
  // them all: trees set the dark and light trees too, water the shallows, sky its horizon, the card its glow, the home
  // button its words (dark or light, whichever reads), and the home text both the heading and the copy.
  const withSimple = (edit: ThemeEdit) => ({ ...edit, simpleGround: edit.land, simpleTrees: edit.treeMain, simpleWater: edit.sea, simpleSky: edit.skyTop,
    simpleCard: edit.accent ?? '#8fd16a', simpleButton: edit.homeButton ?? '#f4b544', simpleHomeText: edit.homeTitle ?? '#111111' });
  const fromSimple = (next: LookValues, before: LookValues) => {
    const changed = (key: string) => next[key] !== undefined && next[key] !== before[key];
    const out: LookValues = { ...next };
    const c = (key: string) => String(next[key]);
    if (changed('simpleGround')) out.land = c('simpleGround');
    if (changed('simpleTrees')) Object.assign(out, { treeMain: c('simpleTrees'), treeDark: mixHex(c('simpleTrees'), '#000000', 0.28), treeLight: mixHex(c('simpleTrees'), '#ffffff', 0.24) });
    if (changed('simpleWater')) Object.assign(out, { sea: c('simpleWater'), seaShallow: mixHex(c('simpleWater'), '#ffffff', 0.38) });
    if (changed('simpleSky')) Object.assign(out, { skyTop: c('simpleSky'), skyHorizon: mixHex(c('simpleSky'), '#ffffff', 0.65) });
    if (changed('simpleCard')) Object.assign(out, { accent: c('simpleCard'), glow: mixHex(c('simpleCard'), '#ffffff', 0.55) });
    if (changed('simpleButton')) Object.assign(out, { homeButton: c('simpleButton'), homeButtonText: lightHex(c('simpleButton')) ? '#1d1405' : '#ffffff' });
    if (changed('simpleHomeText')) Object.assign(out, { homeTitle: c('simpleHomeText'), homeText: c('simpleHomeText') });
    return out;
  };
  // Simple first: five sliders and a few colours; everything else behind "More settings".
  const [stageDetail, setStageDetail] = useState(false);
  // `view`: 0 edits the road's design, 1 the start screen's (`separate` 1 when the stage has its own; with 0 the start
  // screen shows the road's design, and editing it edits that).
  const themeFlat = (index: number, base: { strength: number; seconds: number; weather: number }, view = 0): LookValues => {
    const separate = !!THEMES[index]?.home;
    return { theme: index, view, separate: separate ? 1 : 0, strength: base.strength, seconds: base.seconds, weather: base.weather,
      cardTint: cardLook.tint, cardCorner: cardLook.corner, cardBorder: cardLook.border, ...withSimple(readThemeEdit(index, view && separate ? 'home' : 'drive')) };
  };
  // The world's stage (stages.ts): it sets the planet's look and its time of day together. A run moves on a stage
  // with every STAGE_POINTS points, always starting on a fresh morning (`stageBase`); the start screen moves on by
  // itself every HOME_STAGE_SECONDS. The theme number follows the stage and only ever goes up.
  const [stage, setStage] = useState(FIRST_STAGE);
  const theme = themeForStage(stage);
  const stageBase = useRef(FIRST_STAGE);
  const stageNow = useRef(stage);
  stageNow.current = stage;
  // Each stage's time of day: straight there at first, then over the same few seconds the look takes to change.
  // The start screen and the road each show their own design of the stage when it has one (Stages tab, Home view):
  // starting a run or going home eases from one to the other, colours and time of day alike.
  const timeSet = useRef(false);
  useEffect(() => {
    const home = !started;
    setViewMode(home ? 'home' : 'drive', !timeSet.current);
    if (!timeSet.current) { timeSet.current = true; jumpTo(stageTime(stage, home)); return; }
    settleAt(stageTime(stage, home), themeSettings.seconds);
  }, [stage, started]);
  // While the Stages tab is open the world holds its stage, so the one being edited stays on screen.
  const stagesHeld = showLook && lookMode === 'theme';
  useEffect(() => {
    if (started || stagesHeld) return;
    const timer = window.setInterval(() => setStage(s => s + 1), HOME_STAGE_SECONDS * 1000);
    return () => window.clearInterval(timer);
  }, [started, stagesHeld]);
  // Dev only: `__nextStage()` moves to the next stage now.
  useEffect(() => { if (import.meta.env.DEV) (window as unknown as { __nextStage: () => void }).__nextStage = () => { stageBase.current++; setStage(s => s + 1); }; });
  const [road, setRoad] = useState(FIRST_ROAD);
  const savedDrive = (id: string) => { const edit = savedThemeTuning.current.themes[id]; if (!edit) return undefined; const { home: _home, ...drive } = edit; return drive; };
  // The saved values of stage `index` in the view being edited (its own start-screen design, if it has one saved).
  const themeSaved = (index: number, view = 0): LookValues => {
    const saved = savedThemeTuning.current, card = saved.card ?? cardLook;
    const id = THEMES[index].id, home = view === 1 && THEMES[index].home;
    const edit = home ? saved.themes[id]?.home ?? saved.themes[id] ?? readThemeEdit(index, 'home') : savedDrive(id) ?? readThemeEdit(index);
    return { theme: index, strength: saved.strength, seconds: saved.seconds, weather: saved.weather,
      cardTint: card.tint, cardCorner: card.corner, cardBorder: card.border, view, separate: THEMES[index].home ? 1 : 0, ...edit };
  };
  const [themeValues, setThemeValues] = useState<LookValues>(() => themeFlat(0, themeSettings, 1));
  // Shows stage `index` as the tab edits it: its road design (`viewing` 0) or its start-screen one (1).
  const showStage = (index: number, viewing: number) => {
    setViewMode(viewing === 1 ? 'home' : 'drive', true);
    previewTheme(index, true);
    jumpTo(stageTime(index, viewing === 1));
  };
  // The loop itself, from the tab: a stage of its own on the start screen, a new stage, a move, a stage taken out.
  const editLoop = (action: 'separate' | 'add' | 'earlier' | 'later' | 'remove') => {
    const index = Number(themeValues.theme), viewing = Number(themeValues.view);
    let next = index;
    if (action === 'separate') setSeparateHome(index, !THEMES[index].home);
    if (action === 'add') {
      const name = window.prompt('Name for the new stage (a copy of this one)', `${STAGES[index].name} 2`)?.trim();
      if (!name) return;
      next = addStage(index, name);
    }
    if (action === 'earlier' || action === 'later') next = moveStage(index, action === 'earlier' ? -1 : 1);
    if (action === 'remove') {
      if (STAGES.length <= 2 || !window.confirm(`Delete ${STAGES[index].name} from the stage loop? Click Apply to save the change.`)) return;
      next = removeStage(index);
    }
    showStage(next, viewing);
    setThemeValues(themeFlat(next, themeSettings, viewing));
  };
  const changeTheme = (next: LookValues) => {
    const index = Number(next.theme);
    // What's being edited follows where the game is: the start screen's design there, the road's while driving.
    const viewing = started ? 0 : 1;
    if (index !== Number(themeValues.theme) || viewing !== Number(themeValues.view)) {
      // Another stage or view to edit: show it, at its time of day, with its own values.
      showStage(index, viewing);
      setThemeValues(themeFlat(index, next as { strength: number; seconds: number; weather: number }, viewing));
      return;
    }
    Object.assign(themeSettings, { strength: Number(next.strength), seconds: Number(next.seconds), weather: Number(next.weather) });
    Object.assign(cardLook, { tint: Number(next.cardTint), corner: Number(next.cardCorner), border: Number(next.cardBorder) });
    // On the start screen the first change gives the stage its own start-screen design (a copy of the road's).
    if (viewing === 1 && !THEMES[index].home) setSeparateHome(index, true);
    writeThemeEdit(index, fromSimple(next, themeValues) as unknown as ThemeEdit, viewing === 1 ? 'home' : 'drive');
    applyThemeTuning(currentThemeTuning(), true);
    showStage(index, viewing);
    setThemeValues(themeFlat(index, themeSettings, viewing));
  };
  // While the Theme tab is open the theme's weather shows even over the start screen.
  // Opening the tab shows the stage being edited (its look and time of day); leaving it puts the run's own back.
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const editedTheme = useRef(1);
  editedTheme.current = Number(themeValues.theme);
  const editedView = useRef(0);
  editedView.current = Number(themeValues.view);
  const startedRef = useRef(started);
  startedRef.current = started;
  // The Stages tab edits the design of wherever the game is (start screen or road), and follows it when that changes.
  useEffect(() => {
    if (!showLook || lookMode !== 'theme') return;
    const viewing = started ? 0 : 1;
    setThemeValues(values => (Number(values.view) === viewing ? values : themeFlat(Number(values.theme), themeSettings, viewing)));
  }, [started, showLook, lookMode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const previewing = showLook && lookMode === 'theme';
    themeSettings.preview = previewing;
    if (previewing) showStage(editedTheme.current, editedView.current);
    else if (themeState.progress >= 1) {
      setViewMode(startedRef.current ? 'drive' : 'home', true);
      previewTheme(themeRef.current, true);
      jumpTo(stageTime(stageNow.current, !startedRef.current));
    }
    return () => { themeSettings.preview = false; };
  }, [showLook, lookMode]);
  const [driftValues, setDriftValues] = useState<DriftTuning>(currentDriftTuning);
  const changeDrift = (next: DriftTuning) => { applyDriftTuning(next); setDriftValues(next); };
  const [cameraValues, setCameraValues] = useState<CameraTuning>({ ...cameraTuning });
  const changeCamera = (next: CameraTuning) => { applyCameraTuning(next); setCameraValues(next); };
  const [boostValues, setBoostValues] = useState<BoostTuning>({ ...boostTuning });
  const changeBoost = (next: BoostTuning) => { applyBoostTuning(next); setBoostValues(next); };
  const [nearMissValues, setNearMissValues] = useState<NearMissLook>({ ...nearMissLook });
  const changeNearMiss = (next: NearMissLook) => { Object.assign(nearMissLook, next); setNearMissValues(next); };
  const [carLookValues, setCarLookValues] = useState<CarLook>({ ...carLook });
  const changeCarLook = (next: CarLook) => { Object.assign(carLook, next); setCarLookValues(next); };
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
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === mainRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else if (mainRef.current?.requestFullscreen) void mainRef.current.requestFullscreen().catch(() => {});
  };
  useEffect(() => {
    let frame = 0;
    const written: Record<string, string> = {};
    const tick = () => {
      // The day sky follows the theme, blended through a change.
      const themes = currentThemes();
      const plain = { top: dayLook.skyTop, horizon: dayLook.skyHorizon };
      // (A theme's sky is its own colours, scaled by the theme strength like the rest of its look.)
      const strength = Math.min(1, themeSettings.strength);
      const tinted = (theme: typeof themes.from) => ({ top: mixHex(plain.top, theme.sky?.top ?? plain.top, strength), horizon: mixHex(plain.horizon, theme.sky?.horizon ?? plain.horizon, strength) });
      const from = tinted(themes.from), to = tinted(themes.to);
      const daySky = { top: mixHex(from.top, to.top, themes.mix), horizon: mixHex(from.horizon, to.horizon, themes.mix) };
      const lit = skyAt(daySky, { top: nightLook.skyTop, horizon: nightLook.skyHorizon });
      // The end of a run drains the sky too, to the same cold steel-blue as the picture (IntroDepthOfField's finale).
      const ending = cinematicState.finale;
      const sky = ending > 0.001 ? { top: steelHex(lit.top, ending), horizon: steelHex(lit.horizon, ending) } : lit;
      const n = nightAmount();
      // Written only when a value changes: each write repaints the whole sky gradient.
      // The pale sun glow in the sky is a daytime thing only: gone as soon as sunset colours start.
      const next: Record<string, string> = { '--sky-top': sky.top, '--sky-horizon': sky.horizon, '--night-amount': n.toFixed(2), '--sun-glow': ((1 - n) * (1 - twilight()) ** 3).toFixed(2) };
      // The start screen's colours (each stage's own, Stages tab), blended through a change like the world's.
      const uiFrom = uiOf(themes.from), uiTo = uiOf(themes.to);
      for (const key of Object.keys(uiTo) as Array<keyof typeof uiTo>) next[`--home-${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`] = mixHex(uiFrom[key], uiTo[key], themes.mix);
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
  // Party mode (Party.tsx): the lobby, then a shared-screen race for 2–4 players.
  const [party, setParty] = useState<'off' | 'lobby' | 'on'>('off');
  const partyRun = useRef<PartyRun | null>(null);
  const [partyCount, setPartyCount] = useState(0);
  const [partyMatch, setPartyMatch] = useState(0);
  const partyOn = party === 'on';
  // Dev only: `__party.current` is the running party (players and cars) and `__PARTY` its rules, from the console.
  useEffect(() => { if (import.meta.env.DEV) Object.assign(window, { __party: partyRun, __PARTY: PARTY }); }, []);
  const [vehicleId, setVehicleId] = useState<VehicleId>(() => {
    const id = loadVehicle();
    setActiveVehicle(id);
    return id;
  });
  useEffect(() => { setActiveVehicle(vehicleId); }, [vehicleId]);
  const [garageOpen, setGarageOpen] = useState(false);
  const openGarage = () => {
    controls.current = emptyControls();
    setMobileMenuOpen(false);
    if (started) setPaused(true);
    setGarageOpen(true);
  };
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileBrandRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!mobileBrandRef.current?.contains(event.target as Node)) setMobileMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [mobileMenuOpen]);
  useEffect(() => { holdWorld(paused || help || boardOpen || mapView || garageOpen); }, [paused, help, boardOpen, mapView, garageOpen]);
  const [ready, setReady] = useState(false);
  // The intro reveal waits until the loading screen starts fading away.
  const [revealed, setRevealed] = useState(false);
  const [data, setData] = useState<Telemetry>(initialLoopCar);
  const [gamepad, setGamepad] = useState(false);
  // The controls in use right now (keyboard, pad or touch): every prompt shows its buttons.
  const device = useInputDevice();
  useGamepadMenu({ started, ready, mapView, paused });
  const [muted, setMutedState] = useState(true);
  // Smooth-driving streak: grows while staying on the road at speed, resets off-road or when slowing right down.
  const streak = useRef({ time: 0, last: 0 });
  const [streakLevel, setStreakLevel] = useState(0);
  const streakMessages = ['Smooth driving', 'Nice line', 'Clean drive', 'Great flow', 'On a roll', 'Cruising', 'Road master', 'Zen mode'];
  const [streakShown, setStreakShown] = useState(false);
  // Riding the curb for a moment: a quiet note that nothing scores there.
  const curbTime = useRef(0);
  const curbArmed = useRef(false);
  const [curbHint, setCurbHint] = useState(false);
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
  const nextMobileCelebration = useRef(0);
  const [combo, setCombo] = useState({ count: 0, id: 0 });
  const comboRef = useRef({ count: 0, until: 0 });
  const multiplier = () => (performance.now() < comboRef.current.until ? comboMultiplier(comboRef.current.count) : 1);
  const endCombo = useCallback(() => { comboRef.current = { count: 0, until: 0 }; setCombo(c => (c.count ? { count: 0, id: c.id + 1 } : c)); }, []);
  // The combo runs out by itself after its window without a close pass.
  useEffect(() => {
    if (!combo.count) return;
    const timer = window.setTimeout(endCombo, Math.max(0, comboRef.current.until - performance.now()));
    return () => window.clearTimeout(timer);
  }, [combo, endCombo]);
  const showNote = useCallback((kind: NoteKind, rawPoints: number, quiet: boolean, badge?: string, label?: string) => {
    // Early levels are kinder: good moves pay a little more and crashes cost less (see difficulty.ts); and every point
    // earned is multiplied by the near-miss combo.
    const points = Math.round(rawPoints * (rawPoints > 0 ? difficulty.bonus * multiplier() : difficulty.penalty));
    if (!BADGE_NOTES.includes(kind)) { setScore(total => total + points); if (points !== 0) setBonus(b => ({ id: (b?.id ?? 0) + 1, amount: points })); }
    if (points > 0 && !BADGE_NOTES.includes(kind)) setXp(total => total + points);
    const rank = NOTE_RANK[kind];
    const now = performance.now();
    const routine = RAILS && ['drift', 'near', 'flick', 'boost'].includes(kind);
    const topCelebration = RAILS && rawPoints >= 0 && !kind.startsWith('big') && kind !== 'cineNear' && kind !== 'newBest';
    if (quiet || routine || (topCelebration && now < nextMobileCelebration.current)
      || (now < shownNote.current.until && rank < shownNote.current.rank)) return;
    if (topCelebration) nextMobileCelebration.current = now + 10000;
    const fresh = NOTE_TEXT[kind].filter(text => text !== lastText.current);
    const options = fresh.length ? fresh : NOTE_TEXT[kind];
    const text = label ?? options[Math.floor(Math.random() * options.length)];
    lastText.current = text;
    shownNote.current = { rank, until: now + 1400 };
    setHitNote({ id: hitCount.current++, kind, points, text, badge });
    window.clearTimeout(hitTimer.current);
    hitTimer.current = window.setTimeout(() => setHitNote(null), kind === 'level' ? 3000 : kind === 'bigBoost' ? 1200 : kind === 'cineNear' ? 1550 : kind.startsWith('big') ? 1550 : 2200);
  }, [RAILS]);
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
  // Stages (stages.ts): every STAGE_POINTS points the world eases into its next stage over a few seconds while the
  // run goes on. Each new run after one has ended gets a new road layout (roadLayouts.ts; the
  // world is rebuilt for it then, between runs). `?stage=N` / `?road=N` start with another stage or road, for checking.
  // Dev only: lets the console jump the score to a milestone (`__setScore(3000)`).
  useEffect(() => { if (import.meta.env.DEV) (window as unknown as { __setScore: typeof setScore }).__setScore = setScore; }, []);
  useEffect(() => {
    if (!started || partyOn || stagesHeld) return;
    const target = stageBase.current + stagesReached(score);
    if (target > stage) setStage(target);
  }, [score, started, stage, partyOn, stagesHeld]);
  // Distance: half a point a metre, added as the car drives (not while held, and not across a reset).
  const lastDistance = useRef(0);
  const distanceCarry = useRef(0);
  useEffect(() => {
    const travelled = data.distance - lastDistance.current;
    lastDistance.current = data.distance;
    if (!started || halted || partyOn || travelled <= 0 || travelled > 60 || (data.curb ?? 0) > 0.5) return;
    distanceCarry.current += travelled * DISTANCE_POINTS * multiplier();
    const whole = Math.floor(distanceCarry.current);
    if (whole > 0) { distanceCarry.current -= whole; setScore(total => total + whole); }
  }, [data, started, halted, partyOn]);
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
    if (heartsRef.current <= 0 || now - lastHeartLoss.current < HEART_GRACE_MS) return -1;
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
    return left;
  }, []);
  // The run's clock: it counts only while driving, and every few seconds of it moves the run up a stage, which
  // makes the road harder (difficulty.ts: more and faster traffic, swaying cars...), with a note to say so.
  const stageRef = useRef(1);
  // The same clock, on screen.
  const [runSeconds, setRunSeconds] = useState(0);
  useEffect(() => {
    if (!started || halted) return;
    const timer = window.setInterval(() => {
      const stats = runStats.current;
      stats.seconds += 1;
      setRunSeconds(stats.seconds);
      const next = stageFor(stats.seconds);
      if (next === stageRef.current) return;
      stageRef.current = next;
      setDifficultyLevel(next);
      showNote('stage', 0, !!RAILS && next % 3 !== 0, '▲');
    }, 1000);
    return () => window.clearInterval(timer);
  }, [started, halted, showNote, RAILS]);
  // Boost hits still award a fixed bonus and flash, but no longer chain into a timed score multiplier.
  const [boostFlash, setBoostFlash] = useState(0);
  // The shockwave: a ring of light bursts from the button side of the screen as it fires; once it has spread, the
  // big word and its score (for every car it threw).
  const [waveFlash, setWaveFlash] = useState(0);
  const handleWave = useCallback((event: 'ready' | 'fire' | 'done', cars = 0) => {
    if (event === 'fire') setWaveFlash(n => n + 1);
    if (event === 'done') {
      // The more cars caught at once, the more each is worth (wave.ts, waveScore).
      showNote('bigWave', waveScore(cars), false, undefined, waveWord(cars));
      runStats.current.smashes += cars;
    }
  }, [showNote]);
  // How many cars the current boost run has thrown, and when the last one went (see BOOST_CHAIN).
  const boostChain = useRef(0), boostChainAt = useRef(0);
  const handleTrafficHit = useCallback((hit: TrafficHit) => {
    const magnitude = Math.round(hit.speed * 2) + 5;
    if (hit.boosted) {
      // Every car a boost throws (rammed, or blown aside by its wake) scores, and each next one in the same boost run
      // scores more (50, 100, 150...): a boost ploughed through a crowd pays. Always shown big, with the count.
      const now = performance.now();
      const chain = boostChain.current = now - boostChainAt.current > BOOST_CHAIN.gap ? 1 : boostChain.current + 1;
      boostChainAt.current = now;
      showNote('bigBoost', BOOST_CHAIN.points * chain, false, undefined, chain > 1 ? `SMASH ×${chain}` : undefined);
      runStats.current.smashes++;
      if (!hit.wake) setBoostFlash(n => n + 1);
    }
    else if (hit.closing >= JUICE_CONFIG.crashCinematicClosing) {
      // A head-on crash that gets the slow-motion costs a heart, and the note says how many are left.
      const left = hit.cinematic ? loseHeart() : -1;
      endCombo();
      const label = left < 0 ? undefined : left === 0 ? 'NO HEARTS LEFT' : left === 1 ? 'LAST HEART!' : `HEART LOST · ${left} LEFT`;
      showNote(hit.cinematic ? 'bigSmash' : 'smash', -(Math.round(hit.closing * 2) + 5), false, undefined, label);
    }
    else if (hit.kind === 'side') { showNote('flick', magnitude, hit.speed < QUIET_HIT_SPEED); if (hit.speed >= QUIET_HIT_SPEED) { earnBoost(car.current, BOOST_EARN.flick); } }
    else { showNote('bump', -Math.round(hit.speed + 3), hit.speed < QUIET_HIT_SPEED); if (hit.speed >= QUIET_HIT_SPEED) endCombo(); }
  }, [showNote, loseHeart, endCombo]);
  // A drift held long enough gets the overhead slow-motion cut-in, with its word (the points come when it ends).
  // A drift pays for how long and how fast it slid; longer ones get bigger words.
  const handleDrift = useCallback((drift: DriftScore) => {
    // A drift is scored on its quality, not just its length: how hard into the slide, how clean (on the road),
    // switching sides mid-slide (an S-drift) and threading near misses on the way all multiply its points, and
    // the note names the best thing about it.
    const points = scoreDrift(drift);
    const label = drift.threaded > 0 ? 'Threaded the needle!'
      : drift.switches > 0 ? (drift.switches > 1 ? `Switchback ×${drift.switches}!` : 'Switchback!')
      : drift.angle > 0.8 && drift.clean > 0.95 && drift.time >= 1.8 ? 'Perfect drift!'
      : drift.clean > 0.95 ? 'Clean drift' : 'Nice drift';
    showNote(points >= 160 ? 'hugeDrift' : points >= 70 ? 'bigDrift' : 'drift', points, !!RAILS && points < 160, undefined, label);
    earnBoost(car.current, BOOST_EARN.drift + BOOST_EARN.driftPerSecond * drift.time);
    runStats.current.drifts++;
  }, [showNote, RAILS]);
  // Near misses pay more the faster the pass and the thinner the gap.
  const handleNearMiss = useCallback((miss: NearMiss) => {
    runStats.current.nearMisses++;
    // A close pass pays for its speed and how thin the gap was; one that earns a slow-motion pays double, and the
    // overhead one triple, so the best passes are worth going for.
    const base = Math.round(miss.speed * (1 + 1.5 * (1 - Math.max(0, miss.gap) / NEAR_MISS.gap))) + 5;
    // Each close pass in a row raises the combo (and this one is paid at the new multiplier).
    const count = (performance.now() < comboRef.current.until ? comboRef.current.count : 0) + 1;
    comboRef.current = { count, until: performance.now() + COMBO.window * 1000 };
    setCombo(c => ({ count, id: c.id + 1 }));
    runStats.current.bestWeave = Math.max(runStats.current.bestWeave, count);
    const mult = comboMultiplier(count);
    showNote(miss.overhead ? 'cineNear' : miss.cinematic ? 'bigNear' : 'near', base * (miss.overhead ? 3 : miss.cinematic ? 2 : 1), false, mult > 1 ? `×${mult}` : undefined);
    earnBoost(car.current, BOOST_EARN.nearMiss);
  }, [showNote]);
  useEffect(() => {
    if (streakLevel === 0) { setStreakShown(false); return; }
    setXp(total => total + streakXp(streakLevel));
    earnBoost(car.current, BOOST_EARN.streak);
    const celebrate = !RAILS || (streakLevel >= 4 && streakLevel % 4 === 0 && performance.now() >= nextMobileCelebration.current);
    setStreakShown(celebrate);
    if (RAILS && celebrate) nextMobileCelebration.current = performance.now() + 10000;
    const timer = setTimeout(() => setStreakShown(false), JUICE_CONFIG.streakShowTime * 1000);
    return () => clearTimeout(timer);
  }, [streakLevel, RAILS]);
  useEffect(() => {
    const now = performance.now();
    const state = streak.current;
    const dt = state.last ? Math.min((now - state.last) / 1000, 0.5) : 0;
    state.last = now;
    if (!started || halted || partyOn) {
      curbTime.current = 0;
      curbArmed.current = false;
      setCurbHint(false);
      return;
    }
    const topSpeed = DRIVING_CONFIG.maxSpeed * 3.6;
    // A run starts parked at the road's edge, on the curb: the hint waits until the car has been out on the road once.
    if ((data.curb ?? 0) < 0.3) curbArmed.current = true;
    curbTime.current = curbArmed.current && (data.curb ?? 0) > 0.5 && !data.offroad ? curbTime.current + dt : 0;
    setCurbHint(curbTime.current > 1.2);
    if (data.offroad || (data.curb ?? 0) > 0.5 || data.speed < topSpeed * 0.3) state.time = 0;
    else if (data.speed > topSpeed * JUICE_CONFIG.streakSpeedRatio) state.time += dt;
    setStreakLevel(state.time > 0 ? Math.floor(state.time / JUICE_CONFIG.streakStep) + 1 : 0);
  }, [data, started, halted, partyOn]);
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
        const ratio = shown / Math.max(1, DRIVING_CONFIG.maxSpeed * 3.6);
        // Begin warming at 40% of normal top speed; the full boost palette
        // arrives just above it, leaving a little headroom for overspeed.
        const warm = Math.max(0, Math.min(1, (ratio - 0.4) / 0.65));
        const heat = warm * warm * (3 - 2 * warm);
        setCssVar(speedometer.current, '--speed-arc', `${(Math.min(ratio, 1) * 75).toFixed(1)} 100`);
        setCssVar(speedometer.current, '--speed-heat', heat.toFixed(2));
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
  }, [data, started, halted, partyOn]);
  const recover = useCallback(() => { recoverToRoad(car.current); stuck.current.time = 0; setStuckHint(false); }, []);
  const openPauseMenu = () => { controls.current = emptyControls(); setMobileMenuOpen(false); setPaused(true); };
  useEffect(() => {
    const update = () => setGamepad((navigator.getGamepads?.() ?? []).some(Boolean));
    window.addEventListener('gamepadconnected', update);
    window.addEventListener('gamepaddisconnected', update);
    return () => { window.removeEventListener('gamepadconnected', update); window.removeEventListener('gamepaddisconnected', update); };
  }, []);
  const controls = useRef(emptyControls());
  const car = useRef(initialLoopCar());
  const reset = useCallback(() => {
    boostElapsed.current = 0; setBoostUnlocked(false);
    resetRunWave();
    controls.current = emptyControls(); curbArmed.current = false; setResetKey(k => k + 1); setPaused(false); setScore(0); setHitNote(null);
    // A new run: hearts, stage, stats, stars, clean driving and the best-score note start over.
    beatBest.current = false; lastDistance.current = 0; distanceCarry.current = 0; comboRef.current = { count: 0, until: 0 }; setCombo({ count: 0, id: 0 }); shownScore.current = 0; if (scoreText.current) scoreText.current.textContent = '0'; bestAtRunStart.current = loadBest();
    setHearts(HEARTS); heartsRef.current = HEARTS; setRunOver(false); setFinale(false); runStats.current = emptyRunStats(); setRunSeconds(0);
    stageRef.current = 1; setDifficultyLevel(1);
    nextMobileCelebration.current = 0;
    // A new run starts on the next fresh morning.
    const morning = nextMorning(stageNow.current);
    stageBase.current = morning; setStage(morning);
  }, []);
  // The start screen stays mounted for a moment as the globe zooms in: its keys pill folds down to just the keys.
  const [introExit, setIntroExit] = useState(false);
  const [headerMotion, setHeaderMotion] = useState<'exiting' | 'entering' | ''>('');
  const headerMotionTimers = useRef<number[]>([]);
  const clearHeaderMotionTimers = () => {
    headerMotionTimers.current.forEach(timer => window.clearTimeout(timer));
    headerMotionTimers.current = [];
  };
  const start = (asParty = false) => {
    if (introExit) return;
    // Every run starts on a fresh morning: the next one round the loop from what the start screen was showing.
    const morning = nextMorning(stage);
    stageBase.current = morning; setStage(morning);
    clearCoachTimers();
    boostElapsed.current = 0; setBoostUnlocked(false);
    setCoachTransitioning(false);
    setCoachThisRun(firstDrive && !asParty);
    clearHeaderMotionTimers();
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
  const startRef = useRef(start);
  startRef.current = start;
  const returnToHero = () => {
    if (headerMotion === 'exiting') return;
    clearHeaderMotionTimers();
    controls.current = emptyControls();
    boostElapsed.current = 0; setBoostUnlocked(false);
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
  // Party: everyone lines up where the car is parked, and the camera dives in as for a solo run.
  const startParty = (players: PartyPlayer[]) => {
    lineUp(players, car.current.x);
    partyRun.current = { players, frozen: true, bumps: 0 };
    setPartyCount(players.length); setPartyMatch(m => m + 1); setParty('on');
    start(true);
  };
  const rematch = () => {
    const run = partyRun.current;
    if (!run) return;
    lineUp(run.players, run.players[0].car.x);
    run.frozen = true;
    setPartyMatch(m => m + 1);
  };
  const leaveParty = () => {
    reset(); returnToHero();
    window.setTimeout(() => { partyRun.current = null; setParty('off'); setPartyCount(0); }, 160);
  };

  useEffect(() => {
    const mapping: Record<string, ControlKey> = { ShiftLeft: 'boost', ShiftRight: 'boost', KeyE: 'wave', AltLeft: 'gentle', AltRight: 'gentle', KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'brake' };
    const held = new Set<string>();
    const clear = () => { held.clear(); controls.current = emptyControls(); };
    const down = (e: KeyboardEvent) => {
      if (garageOpen) { if (e.code === 'Escape') { e.preventDefault(); setGarageOpen(false); } return; }
      const target = e.target instanceof HTMLElement ? e.target : null;
      const isTextEntry = !!target && (target.matches('input,textarea,select') || target.isContentEditable || !!target.closest('[contenteditable="true"]'));
      if (isTextEntry) return;
      const isButton = !!target && !!target.closest('button');
      if (isButton && (e.code === 'Enter' || (e.code === 'Space' && (!started || paused || help)))) return;
      if (!started && ready && party === 'off' && !e.repeat && (e.code === 'KeyW' || e.code === 'ArrowUp')) {
        e.preventDefault();
        startRef.current();
      }
      if (mapping[e.code] && !paused && !help && !boardOpen && !mapView && !runOver && !finale) { e.preventDefault(); held.add(e.code); controls.current[mapping[e.code]] = true; }
      if (e.repeat) return;
      if (partyOn && ['KeyM', 'KeyR', 'KeyF', 'KeyC'].includes(e.code)) return;
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
  }, [started, paused, help, boardOpen, mapView, runOver, finale, reset, recover, mobileMenuOpen, garageOpen, ready, party, partyOn]);

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
      look={{ day: look, night: nightValues, car: carValues, carLook: carLookValues, drift: driftValues, theme: themeValues, camera: cameraValues, boost: boostValues, nearMiss: nearMissValues, sound: soundValues, warm: warmValues }[lookMode]}
      sliders={{ day: DAY_LOOK_SLIDERS, night: NIGHT_LOOK_SLIDERS, car: CAR_TUNING_SLIDERS, carLook: CAR_LOOK_SLIDERS, drift: DRIFT_TUNING_SLIDERS, theme: stageDetail ? THEME_TUNING_SLIDERS : STAGE_SIMPLE_SLIDERS, camera: CAMERA_TUNING_SLIDERS, boost: BOOST_TUNING_SLIDERS, nearMiss: NEAR_MISS_LOOK_SLIDERS, sound: SOUND_TUNING_SLIDERS, warm: WARM_LIGHT_SLIDERS }[lookMode]}
      colours={lookMode === 'theme' ? stageDetail ? THEME_COLOURS : STAGE_SIMPLE_COLOURS : lookMode === 'night' ? NIGHT_LOOK_COLOURS : lookMode === 'boost' ? BOOST_TUNING_COLOURS : lookMode === 'nearMiss' ? NEAR_MISS_LOOK_COLOURS : lookMode === 'warm' ? WARM_LIGHT_COLOURS : lookMode === 'carLook' ? CAR_LOOK_COLOURS : undefined}
      saved={{ day: DAY_LOOK_SAVED, night: NIGHT_LOOK_SAVED, car: CAR_TUNING_SAVED, carLook: CAR_LOOK_SAVED, drift: DRIFT_TUNING_SAVED, theme: themeSaved(Number(themeValues.theme), Number(themeValues.view)), camera: CAMERA_TUNING_SAVED, boost: BOOST_TUNING_SAVED, nearMiss: NEAR_MISS_LOOK_SAVED, sound: SOUND_TUNING_SAVED, warm: WARM_LIGHT_SAVED }[lookMode]}
      serialize={lookMode === 'theme' ? currentThemeTuning : undefined}
      onSaved={lookMode === 'theme' ? markThemeTuningSaved : undefined}
      choices={lookMode === 'theme' ? themeChoices() : undefined}
      extra={lookMode === 'theme' ? <div className="stage-tools">
        <p className="stage-editing">Editing: <b>{Number(themeValues.view) === 1 ? 'home page design' : 'driving design'}</b>
          {Number(themeValues.view) === 1 && !!themeValues.separate && <button onClick={() => editLoop('separate')}>use the driving design here</button>}</p>
        <button className={`stage-more${stageDetail ? ' on' : ''}`} onClick={() => setStageDetail(d => !d)}>{stageDetail ? 'Back to simple' : 'More settings'}</button>
        <div className="stage-loop" role="group" aria-label="The loop">
          <button onClick={() => editLoop('earlier')} disabled={Number(themeValues.theme) === 0}>← Earlier</button>
          <button onClick={() => editLoop('later')} disabled={Number(themeValues.theme) === STAGES.length - 1}>Later →</button>
          <button onClick={() => editLoop('add')}>+ New stage</button>
        </div>
        <div className="stage-delete-row">
          <button className="stage-delete" onClick={() => editLoop('remove')} disabled={STAGES.length <= 2}>
            <Trash2 size={14} aria-hidden="true" /> Delete stage
          </button>
          <span>{STAGES.length <= 2 ? 'Keep at least 2 stages' : STAGES[Number(themeValues.theme)]?.name}</span>
        </div>
      </div> : lookMode === 'carLook' ? <div className="car-presets" role="group" aria-label="Presets">
        <span>Start from</span>
        {CAR_LOOK_PRESETS.map(preset => <button key={preset.name} onClick={() => changeCarLook({ ...carLookValues, ...preset.look } as CarLook)}>{preset.name}</button>)}
      </div> : undefined}
      endpoint={{ day: '/__day-look', night: '/__night-look', car: '/__car-tuning', carLook: '/__car-look', drift: '/__drift-tuning', theme: '/__theme-tuning', camera: '/__camera-tuning', boost: '/__boost-tuning', nearMiss: '/__near-miss-look', sound: '/__sound-tuning', warm: '/__warm-light' }[lookMode]}
      onChange={values => {
        if (lookMode === 'day') changeLook(values as DayLook);
        else if (lookMode === 'night') changeNightLook(values as NightLook);
        else if (lookMode === 'car') changeCar(values as unknown as CarTuning);
        else if (lookMode === 'drift') changeDrift(values as unknown as DriftTuning);
        else if (lookMode === 'theme') changeTheme(values);
        else if (lookMode === 'camera') changeCamera(values as unknown as CameraTuning);
        else if (lookMode === 'boost') changeBoost(values as unknown as BoostTuning);
        else if (lookMode === 'nearMiss') changeNearMiss(values as unknown as NearMissLook);
        else if (lookMode === 'warm') changeWarm(values as unknown as WarmLight);
        else if (lookMode === 'carLook') changeCarLook(values as unknown as CarLook);
        else changeSound(values as unknown as SoundTuning);
      }}
      onClose={() => setShowLook(false)}
    />}
    <div className="scene"><div className="sky-glow" aria-hidden="true" /><NightSky /><SceneBoundary><Scene vehicleId={vehicleId} started={started && !mapView} paused={paused || help || boardOpen || mapView || runOver || garageOpen} mapView={mapView} trafficEnabled={!firstDrive && !partyOn} tutorialDriving={!!RAILS && firstDrive && (coachThisRun || coachTransitioning)} tutorialCamera={!!RAILS && firstDrive && coachThisRun} mobileCamera={!!RAILS} boostEnabled={boostUnlocked && !partyOn} party={partyOn ? partyRun : undefined} partyCount={partyOn ? partyCount : 0} finale={finale} danger={hearts === 1} cameraMode={cameraMode} resetKey={resetKey} theme={theme} road={road} controls={controls} car={car} onTelemetry={setData} onReady={onReady} onTrafficHit={handleTrafficHit} onNearMiss={handleNearMiss} onDrift={handleDrift} onWave={handleWave} /></SceneBoundary><div className={`boost-tint${started && data.boosting ? ' on' : ''}`} aria-hidden="true" /></div>
    <div className="vignette" />
    <header className={`topbar${headerMotion ? ` header-${headerMotion}` : ''}`}>
      {/* Three parts: the logo on the start screen or the driver's level while driving (left), the score
          (centre, driving only), and the settings with pause (right). No logo while driving. */}
      {started
        // A round menu button, then the driver's level.
        ? <div className="topbar-left">
          <button className="home-button" aria-label="Open menu" title="Menu" onClick={openPauseMenu}><Menu /></button>
          {!partyOn && <div className="level-badge" aria-label={`Level ${level.level}, ${level.title}, ${level.into} of ${level.need} XP`}>
          <span className="level-number" key={level.level}>{level.level}</span>
          <div><strong>{level.title}</strong><i><span style={{ transform: `scaleX(${level.into / level.need})` }} /></i><small>{level.into} / {level.need} XP</small></div>
          </div>}
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
              <button type="button" onClick={openGarage}><CarFront /><span>Choose your car</span></button>
              <button type="button" onClick={() => { setMobileMenuOpen(false); setCameraMode(mode => 1 - mode); }}><Maximize2 /><span>Change camera view</span></button>
              <button type="button" onClick={() => { setMobileMenuOpen(false); setBoardOpen(true); }}><Trophy /><span>Leaderboard</span></button>
              <button type="button" onClick={() => { setMobileMenuOpen(false); setHelp(true); }}><CircleHelp /><span>Controls and help</span></button>
            </div>}
          </div>
        </>}
      {/* The middle of the header is the score's, with the road to the next stage under it. The score counts up
          smoothly (distance adds to it all the time); a bonus makes it react in proportion to its size, with the
          amount floating off, and the combo beside it. The run's clock and the hearts sit on the right (below). */}
      {started && !partyOn && <div className="hud-center">
        <LeaderboardChase key={resetKey} score={score} stage={stage}
          scoreSlot={<>
            <b key={`score-${bonus?.id ?? 0}`} ref={scoreText} className={`score-value ${bonusTier(bonus?.amount ?? 0)}`}>{formatNumber(shownScore.current)}</b>
            {bonus && <span key={`float-${bonus.id}`} className={`score-float ${bonusTier(bonus.amount)}`} aria-hidden="true">{bonus.amount > 0 ? '+' : ''}{formatNumber(bonus.amount)}</span>}
            {/* The near-miss combo, beside the score it multiplies, with a bar running down until it ends. */}
            {combo.count > 1 && <span key={`combo-${combo.id}`} className="combo-pill" aria-label={`Score ×${comboMultiplier(combo.count)}`}>
              <b>×{comboMultiplier(combo.count)}</b><i style={{ animationDuration: `${COMBO.window}s` } as CSSProperties} />
            </span>}
          </>}
          visible={!mapView}
          active={!paused && !help && !boardOpen && !garageOpen && !mapView && !runOver && !finale}
          busy={!!hitNote || !!heartBreak || streakShown || coachShowing || !!roadWarning || !!stuckHint}
          open={() => setBoardOpen(true)} />
      </div>}
      {!started || halted || partyOn ? null : stuckHint
        ? <div className="road-warning" role="status"><TriangleAlert size={16} /><span>Stuck? Press <Keys action="recover" device={device} /> to hop back on the road</span></div>
        : roadWarning ? <div className="road-warning" role="status"><TriangleAlert size={16} /><span>Off road — head back to the road</span></div>
        : curbHint && <div className="curb-hint" role="status"><TriangleAlert size={15} /><span><b>Back onto the road!</b><span className="hint-detail"> The curb slows you down and scores nothing</span></span></div>}
      <div className="topbar-right">
      {started && !partyOn && <div className="hud-right">
        <div className="run-clock" aria-label={`${Math.floor(runSeconds / 60)} minutes ${runSeconds % 60} seconds`}><Timer aria-hidden="true" /><b>{clockText(runSeconds)}</b></div>
        <div key={`hearts-${heartBreak?.id ?? 0}`} className={`hearts-bar${hearts === 1 ? ' last' : ''}${heartBreak ? ' hit' : ''}`} aria-label={`${hearts} of ${HEARTS} hearts left`}>
          {Array.from({ length: HEARTS }, (_, i) => <HeartIcon key={i} className={i < hearts ? 'full' : i === hearts && heartBreak ? 'breaking' : 'lost'} />)}
        </div>
      </div>}
      <nav className="toolbar" aria-label="Game settings">
        {import.meta.env.DEV && <button aria-label="Day look" style={{ viewTransitionName: 'tool-look' } as CSSProperties} title="Day look" className={`desktop-only${showLook ? ' active' : ''}`} onClick={() => setShowLook(value => !value)}><SlidersHorizontal /></button>}
        <button aria-label={muted ? 'Unmute sound' : 'Mute sound'} style={{ viewTransitionName: 'tool-sound' } as CSSProperties} title={muted ? 'Sound off' : 'Sound on'} onClick={() => setMutedState(m => !m)}>{muted ? <VolumeX /> : <Volume2 />}</button>
        {!started && <button className={`desktop-only${fullscreen ? ' active' : ''}`} aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'} style={{ viewTransitionName: 'tool-camera' } as CSSProperties} title={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen}>{fullscreen ? <Minimize2 /> : <Maximize2 />}</button>}
        {!started && !runOver && !finale && <button className="desktop-only" aria-label="Choose your car" title="Garage" onClick={openGarage}><CarFront /></button>}
        {!started && <button aria-label="Leaderboard" title="Leaderboard" style={{ viewTransitionName: 'tool-board' } as CSSProperties} onClick={() => setBoardOpen(true)}><Trophy /></button>}
        {!started && <button className="desktop-only" aria-label="Controls and help" style={{ viewTransitionName: 'tool-help' } as CSSProperties} title="Controls and help" onClick={() => setHelp(true)}><CircleHelp /></button>}
        {started && !mapView && <button className="desktop-only" aria-label={paused ? 'Resume driving' : 'Pause game'} style={{ viewTransitionName: 'tool-pause' } as CSSProperties} title="Pause · Esc" onClick={() => setPaused(p => !p)}>{paused ? <Play /> : <Pause />}</button>}
      </nav>
      </div>
    </header>

    {(!started || introExit) && party !== 'lobby' && <section className={`intro-card${introExit ? ' exiting' : ''}`}>
      <h1 aria-label={TITLE}>{[...TITLE].map((c, i) => <span key={i} aria-hidden="true" className={`ch${c === '.' ? ' dot' : ''}`} style={{ '--d': `${1000 + i * 60}ms` } as CSSProperties}>{c === ' ' ? '\u00a0' : c}</span>)}</h1>
      <p className="intro-copy rise" style={{ '--d': '1700ms' } as CSSProperties}>
        <span>A small world, a long road.</span>
        <span>Drive in your browser. Nothing to install.</span>
      </p>
      <div className="cta">
        <div className="rise" style={{ '--d': '2100ms' } as CSSProperties}><button className="primary start-button" disabled={!ready} onClick={() => start()}><span>{ready ? 'Start driving' : 'Preparing the globe...'}</span><span className="start-arrow"><ArrowRight size={20} /></span></button></div>
        {!RAILS && <button className="party-button rise" style={{ '--d': '2200ms' } as CSSProperties} disabled={!ready} onClick={() => setParty('lobby')}><Users size={17} /><span>Party · 2–4 players</span></button>}
      </div>
      <div className="intro-howto" aria-label="How to play">
        <span className="rise" style={{ '--d': '2850ms' } as CSSProperties}><span className="howto-keys"><Keys action="steer" device={device} />{device !== 'touch' && <Keys action="gas" device={device} />}</span><small>{device === 'touch' ? 'to steer' : 'Steer · speed up'}</small></span>
        <span className="rise" style={{ '--d': '2950ms' } as CSSProperties}><Sparkles aria-hidden="true" /><small>Slip past traffic</small></span>
        <span className="rise" style={{ '--d': '3050ms' } as CSSProperties}><HeartIcon className="full" /><small>Three hearts</small></span>
      </div>
    </section>}

    {started && mapView && <div className="map-bar" role="dialog" aria-label="Map">
      <span className="map-hint">Drag to turn the world</span>
      <button className="map-back" autoFocus onClick={() => morph(() => setMapView(false))}>Back to the road <ArrowRight size={18} /></button>
      <span className="map-key"><kbd>M</kbd></span>
    </div>}
    {party === 'lobby' && !started && <PartyLobby onStart={startParty} onClose={() => setParty('off')} />}
    {started && partyOn && !mapView && <PartyHud key={partyMatch} run={partyRun} paused={paused || help} onRematch={rematch} onLeave={leaveParty} />}
    {started && !mapView && !partyOn && <>
      {boostFlash > 0 && <div key={boostFlash} className="boost-flash" aria-hidden="true" />}
      {heartBreak && <div key={`break-${heartBreak.id}`} className="heart-break" role="status" aria-label={heartBreak.left === 0 ? 'No hearts left' : `${heartBreak.left} hearts left`}>
        <div className="heart-break-pulse" aria-hidden="true" />
        <div className="heart-break-heart" aria-hidden="true"><HeartIcon className="half left" /><HeartIcon className="half right" /></div>
        <strong>{heartBreak.left === 0 ? 'OUT OF HEARTS' : heartBreak.left === 1 ? 'LAST HEART' : `${heartBreak.left} LEFT`}</strong>
      </div>}
      {/* The guide: the first-drive lesson, then the goal and tips at the right moments (Coach.tsx). */}
      <Coach onShowingChange={setCoachShowing} key={`coach-${resetKey}-${coachThisRun}`} lesson={coachThisRun} rails={!!RAILS} device={device} trafficOn={!firstDrive} active={!paused && !help && !roadWarning && !stuckHint && !finale && !runOver} controls={controls} speed={data.speed} offroad={!!data.offroad} boostReady={boostUnlocked && (data.boost ?? 0) >= 1 && !data.boosting} onComplete={RAILS ? finishRailsLesson : completeFirstDrive} onSkip={RAILS ? undefined : () => setCoachThisRun(false)} />
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
      {boostUnlocked && <BoostGauge car={car} controls={controls} offroad={!!data.offroad} mobile={!!RAILS} />}
      {!firstDrive && <WaveButton key={`wave-${resetKey}`} controls={controls} mobile={!!RAILS} />}
      {waveFlash > 0 && <div key={`wave-flash-${waveFlash}`} className="wave-flash" aria-hidden="true" />}
      {(!RAILS || !firstDrive) && hitNote && (hitNote.kind.startsWith('big') || hitNote.kind === 'cineNear'
        // During a slow-motion cut-in, or ramming cars under boost: big, the word built letter by letter.
        ? <div key={hitNote.id} className={`big-note ${{ bigSmash: 'smash', bigNear: 'near', bigBoost: 'boost', cineNear: 'near-cine', bigWave: 'wave' }[hitNote.kind as 'bigSmash']}`} role="status" aria-label={`${hitNote.text} ${hitNote.points}`}>
          <strong aria-hidden="true">{[...hitNote.text].map((letter, i) => <span key={i} style={{ '--i': i } as CSSProperties}>{letter === ' ' ? '\u00a0' : letter}</span>)}</strong>
          <span className="big-scores" aria-hidden="true">
            {hitNote.points !== 0 && <b style={{ '--i': hitNote.text.length } as CSSProperties}>{hitNote.points > 0 ? '+' : ''}{hitNote.points}</b>}
          </span>
        </div>
        : <div key={hitNote.id} className={`hit-note ${/drift/i.test(hitNote.kind) ? `drift ${hitNote.kind}` : hitNote.kind}`} role="status">{hitNote.text} <b>{BADGE_NOTES.includes(hitNote.kind) ? hitNote.badge : `${hitNote.points > 0 ? '+' : ''}${hitNote.points}`}</b>{!BADGE_NOTES.includes(hitNote.kind) && hitNote.badge && <b className="note-combo">{hitNote.badge}</b>}</div>)}
      {/* One line of captions at a time: a traffic note takes the slot over a streak. */}
      {(!RAILS || !firstDrive) && streakShown && !hitNote && <div key={streakLevel} className="hit-note streak" role="status">{streakMessages[(streakLevel - 1) % streakMessages.length]} <b>×{streakLevel}</b></div>}
      {/* What the other buttons do, in the player's own buttons; it fades back once they have had a look. */}
      {!RAILS && device !== 'touch' && <div key={`dock-${device}-${resetKey}`} className="controls-dock" aria-label="Controls">
        <span><Keys action="drift" device={device} />Drift</span>
        {boostUnlocked && <span><Keys action="boost" device={device} />Boost</span>}
        <span><Keys action="camera" device={device} />Camera</span>
        <span><Keys action="map" device={device} />Map</span>
        <span><Keys action="pause" device={device} />Pause</span>
      </div>}
      {RAILS ? <SteerPads key={`steer-${resetKey}`} controls={controls} tutorial={coachThisRun && firstDrive && !paused && !help && !roadWarning && !stuckHint} /> : <div className="touch-controls" aria-label="Touch controls"><SteeringWheel controls={controls} /><div className="pedals"><button className="reverse-touch" aria-label="Reverse" {...touch('back')}><ArrowDown /></button><button className="brake-touch" aria-label="Brake" {...touch('brake')}>Brake</button><button className="gas-touch" aria-label="Accelerate" {...touch('forward')}>Gas</button></div></div>}
    </>}

    {!started && <footer className="page-footer"><span>WANDER · THE LONG WAY ROUND</span></footer>}
    {started && paused && headerMotion !== 'exiting' && !help && !boardOpen && !garageOpen && <div className="modal-shade"><section className="modal pause-modal" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <span className="eyebrow">PAUSED</span><h2 id="pause-title">Take a breath.</h2>
      <div className="pause-stats">
        <div><small>Score · best {formatNumber(best)}</small><b>{formatNumber(score)}</b></div>
        <div><small>Level {level.level}</small><b>{level.title}</b><i><span style={{ transform: `scaleX(${level.into / level.need})` }} /></i></div>
        <div><small>Driven</small><b>{formatNumber(data.distance)} m</b></div>
      </div>
      <button autoFocus className="primary" onClick={() => setPaused(false)}>Keep going <Play size={18} /></button>
      <div className="modal-row">
        {partyOn ? <button className="secondary" onClick={() => { rematch(); setPaused(false); }}><RotateCcw size={15} /> New match</button> : <button className="secondary" onClick={reset}><RotateCcw size={15} /> Restart</button>}
        <button className="secondary" onClick={partyOn ? leaveParty : returnToHero}><ChevronLeft size={15} /> {partyOn ? 'Leave the party' : 'Back to the globe'}</button>
      </div>
      {/* Everything else lives here while driving, so the screen stays clear. */}
      <div className="pause-actions" role="group" aria-label="More">
        <button onClick={() => { setPaused(false); morph(() => setMapView(true)); }}><MapIcon /><span>Map</span></button>
        <button onClick={() => setCameraMode(mode => 1 - mode)}><Video /><span>{cameraMode ? 'Chase view' : 'Top view'}</span></button>
        <button onClick={openGarage}><CarFront /><span>Garage</span></button>
        <button onClick={() => setHelp(true)}><CircleHelp /><span>Controls</span></button>
        <button onClick={() => setMutedState(m => !m)}>{muted ? <VolumeX /> : <Volume2 />}<span>{muted ? 'Sound off' : 'Sound on'}</span></button>
        <button className="desktop-only" onClick={toggleFullscreen}>{fullscreen ? <Minimize2 /> : <Maximize2 />}<span>{fullscreen ? 'Window' : 'Full screen'}</span></button>
      </div>
    </section></div>}
    {garageOpen && <Garage selected={vehicleId} close={() => setGarageOpen(false)} onSelect={id => {
      setActiveVehicle(id);
      setVehicleId(id);
      saveVehicle(id);
      setGarageOpen(false);
    }} />}
    {help && <Help rails={!!RAILS} device={device} close={() => setHelp(false)} />}
    {boardOpen && <Leaderboard close={() => setBoardOpen(false)} />}
    {finale && <div className="letterbox" aria-hidden="true"><i /><i /></div>}
    {runOver && <RunOver score={score} newBest={beatBest.current} stats={runStats.current} onPlayAgain={() => { setRoad(r => r + 1); reset(); }}
      onHome={() => { setRoad(r => r + 1); reset(); returnToHero(); }} />}
    <LoadingScreen ready={ready} onLeave={() => setRevealed(true)} />
  </main>;
}
