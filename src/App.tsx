import { Component, Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, SlidersHorizontal, ChevronLeft, ChevronRight, CircleHelp, Maximize2, Moon, Pause, Play, RotateCcw, Sun, TriangleAlert, Volume2, VolumeX, X } from 'lucide-react';
import Scene from './game/Scene';
import LoadingScreen from './LoadingScreen';
import { LogoMark } from './Logo';
import Coach from './Coach';
import BoostGauge from './BoostGauge';
import type { DriftScore, Telemetry } from './game/Scene';
import { BOOST_EARN, DRIVE_MODE, earnBoost, emptyControls, initialLoopCar, recoverToRoad } from './game/driving';
import type { ControlKey } from './game/driving';

// Phones and tablets play in rails mode: the car drives itself and stays on the road, and the player only steers
// (see DRIVE_MODE in driving.ts). `?rails=off` brings back the wheel and pedals.
const RAILS = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
  && new URLSearchParams(window.location.search).get('rails') !== 'off';
DRIVE_MODE.rails = !!RAILS;

// Rails-mode steering: each half of the screen (below the header) steers that way while held, so there is no
// small target to find; a round glass button in each bottom corner shows it and lights up gold while held, and
// the held side glows faintly from its edge.
function SteerPads({ controls }: { controls: React.RefObject<{ left: boolean; right: boolean }> }) {
  const [held, setHeld] = useState({ left: false, right: false });
  const set = (side: 'left' | 'right', on: boolean) => { controls.current[side] = on; setHeld(h => (h[side] === on ? h : { ...h, [side]: on })); };
  return <div className="steer-pads" aria-label="Steering">
    {(['left', 'right'] as const).map(side => <div
      key={side}
      className={`steer-zone ${side}${held[side] ? ' held' : ''}`}
      role="button"
      aria-label={side === 'left' ? 'Steer left' : 'Steer right'}
      onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); set(side, true); }}
      onPointerUp={() => set(side, false)}
      onPointerCancel={() => set(side, false)}
      onLostPointerCapture={() => set(side, false)}
    >
      <span className="steer-button" aria-hidden="true">{side === 'left' ? <ChevronLeft /> : <ChevronRight />}</span>
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
import { SOUND_TUNING_SAVED, SOUND_TUNING_SLIDERS, applySoundTuning, soundTuning } from './game/soundTuning';
import type { SoundTuning } from './game/soundTuning';
import { cinematicState } from './game/cinematic';
import { VISUAL_QUALITY } from './game/artDirection';
import { levelFor, loadXp, saveXp, streakXp } from './game/progression';
import { difficulty, setDifficultyLevel } from './game/difficulty';
import { goTo, headingToNight, mixHex, nightAmount, skyAt, twilight } from './game/dayCycle';
import { AUDIO_CONFIG, AUDIO_RANGES, currentGear, playEngineStart, setMuted, startAudio } from './game/audio';

const TITLE = 'Just drive.';
// Traffic note wording, kept to a word or two, and which notes win when two land close together.
const NOTE_TEXT = {
  smash: ['Big crash!', 'Brutal hit.', 'Total wreck.', 'Ouch.'],
  near: ['Close call!', 'By a whisker!', 'Threaded it!', 'Inches!'],
  boost: ['Bulldozer!', 'Unstoppable!', 'Out of my way!', 'Absolute unit!'],
  flick: ['Nice flick!', 'Sideswipe!', 'Pinball!'],
  bump: ['Bump.', 'Easy now.', 'Careful.'],
  level: ['Level up!'],
  // Shown big, in the middle of the screen, while a slow-motion cut-in plays.
  bigSmash: ['WRECKED!', 'KABOOM!', 'TOTALED!', 'BRUTAL!'],
  bigNear: ['BY A HAIR', 'TOO CLOSE', 'CLOSE CALL', 'INCHES'],
  drift: ['Nice drift!', 'Clean slide!'],
  bigDrift: ['Big drift!', 'Sideways!'],
  hugeDrift: ['Drift king!', 'Endless slide!'],
};
const NOTE_RANK = { bigSmash: 5, bigNear: 5, level: 4, smash: 3, hugeDrift: 3, near: 2, boost: 2, bigDrift: 2, drift: 1, flick: 1, bump: 1 };
// Hits slower than this (m/s) still score, but without a note.
const QUIET_HIT_SPEED = 7;
const formatNumber = (n: number) => Math.round(n).toLocaleString('en-US');
class SceneBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? <div className="error-screen"><h2>The 3D scene could not load</h2><p>Enable graphics acceleration in your browser and try again.</p><button className="primary" onClick={() => location.reload()}>Try again</button></div> : this.props.children; }
}
function Help({ close }: { close: () => void }) {
  return <div className="modal-shade" onClick={close}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e => e.stopPropagation()}>
    <button className="close-button" autoFocus aria-label="Close help" onClick={close}><X size={18} /></button>
    <span className="eyebrow">CONTROLS</span><h2 id="help-title">Circle the little world.</h2>
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
    <p>Steer freely around the globe. Ease off the accelerator and slow down for corners. Hold reverse to brake, then back up.</p>
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
type LookMode = 'day' | 'night' | 'car' | 'camera' | 'boost' | 'nearMiss' | 'sound';
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
  const [ready, setReady] = useState(false);
  // The intro reveal waits until the loading screen starts fading away.
  const [revealed, setRevealed] = useState(false);
  const [data, setData] = useState<Telemetry>(initialLoopCar);
  const [gamepad, setGamepad] = useState(false);
  const [muted, setMutedState] = useState(false);
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
  const [hitNote, setHitNote] = useState<{ id: number; kind: NoteKind; points: number; text: string; badge?: string } | null>(null);
  // Driver level: positive points and streaks add XP (see progression.ts); it is kept between visits.
  const [xp, setXp] = useState(loadXp);
  const level = levelFor(xp);
  const shownLevel = useRef(level.level);
  const hitCount = useRef(0);
  const hitTimer = useRef<number | undefined>(undefined);
  const shownNote = useRef<{ rank: number; until: number }>({ rank: 0, until: 0 });
  const lastText = useRef('');
  const showNote = useCallback((kind: NoteKind, rawPoints: number, quiet: boolean, badge?: string) => {
    // Early levels are kinder: good moves pay a little more and crashes cost less (see difficulty.ts).
    const points = Math.round(rawPoints * (rawPoints > 0 ? difficulty.bonus : difficulty.penalty));
    if (kind !== 'level') setScore(total => total + points);
    if (points > 0 && kind !== 'level') setXp(total => total + points);
    const rank = NOTE_RANK[kind];
    const now = performance.now();
    if (quiet || (now < shownNote.current.until && rank < shownNote.current.rank)) return;
    const fresh = NOTE_TEXT[kind].filter(text => text !== lastText.current);
    const options = fresh.length ? fresh : NOTE_TEXT[kind];
    const text = options[Math.floor(Math.random() * options.length)];
    lastText.current = text;
    shownNote.current = { rank, until: now + 1400 };
    setHitNote({ id: hitCount.current++, kind, points, text, badge });
    window.clearTimeout(hitTimer.current);
    hitTimer.current = window.setTimeout(() => setHitNote(null), kind === 'level' ? 3000 : kind.startsWith('big') ? 1550 : 2200);
  }, []);
  // A level-up takes the caption slot over anything else, with the new title.
  useEffect(() => {
    saveXp(xp);
    setDifficultyLevel(level.level);
    if (level.level > shownLevel.current) { showNote('level', 0, false, `${level.level} · ${level.title}`); earnBoost(car.current, BOOST_EARN.levelUp); }
    shownLevel.current = level.level;
  }, [xp, level.level, level.title, showNote]);
  const handleTrafficHit = useCallback((hit: TrafficHit) => {
    const magnitude = Math.round(hit.speed * 2) + 5;
    if (hit.boosted) showNote('boost', Math.round(magnitude * 1.5), false);
    else if (hit.closing >= JUICE_CONFIG.crashCinematicClosing) showNote(hit.cinematic ? 'bigSmash' : 'smash', -(Math.round(hit.closing * 2) + 5), false);
    else if (hit.kind === 'side') { showNote('flick', magnitude, hit.speed < QUIET_HIT_SPEED); if (hit.speed >= QUIET_HIT_SPEED) earnBoost(car.current, BOOST_EARN.flick); }
    else showNote('bump', -Math.round(hit.speed + 3), hit.speed < QUIET_HIT_SPEED);
  }, [showNote]);
  // A drift pays for how long and how fast it slid; longer ones get bigger words.
  const handleDrift = useCallback((drift: DriftScore) => {
    showNote(drift.time >= 3.5 ? 'hugeDrift' : drift.time >= 2 ? 'bigDrift' : 'drift', Math.round(drift.time * drift.speed * 1.2), false);
    earnBoost(car.current, BOOST_EARN.drift + BOOST_EARN.driftPerSecond * drift.time);
  }, [showNote]);
  // Near misses pay more the faster the pass and the thinner the gap.
  const handleNearMiss = useCallback((miss: NearMiss) => {
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
    if (!started || paused) return;
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
  // Speedometer number and arc follow the speed through a spring, so they overshoot a little.
  const dataRef = useRef(data);
  dataRef.current = data;
  const speedText = useRef<HTMLElement>(null);
  const speedArc = useRef<SVGCircleElement>(null);
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
      if (speedArc.current) speedArc.current.setAttribute('stroke-dasharray', `${Math.min(shown / (CAR_CONFIG.maxSpeed * 3.6), 1) * 75} 100`);
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
  const offRoadNow = started && !paused && !!data.offroad;
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
    state.time = started && !paused && pressing && data.speed < 3 ? state.time + dt : 0;
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
  const car = useRef(initialLoopCar());
  const reset = useCallback(() => { controls.current = emptyControls(); setResetKey(k => k + 1); setPaused(false); setScore(0); setHitNote(null); }, []);
  const start = () => { startAudio(); playEngineStart(); setStarted(true); setPaused(false); controls.current = emptyControls(); };
  const onReady = useCallback(() => setReady(true), []);

  useEffect(() => {
    const mapping: Record<string, ControlKey> = { ShiftLeft: 'boost', ShiftRight: 'boost', AltLeft: 'gentle', AltRight: 'gentle', KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'brake' };
    const held = new Set<string>();
    const clear = () => { held.clear(); controls.current = emptyControls(); };
    const down = (e: KeyboardEvent) => {
      const isButton = e.target instanceof HTMLElement && !!e.target.closest('button');
      if (isButton && (e.code === 'Enter' || (e.code === 'Space' && (!started || paused || help)))) return;
      if (mapping[e.code] && !paused && !help) { e.preventDefault(); held.add(e.code); controls.current[mapping[e.code]] = true; }
      if (e.repeat) return;
      if (e.code === 'KeyR' && started && !help) reset();
      if (e.code === 'KeyF' && started && !paused && !help) recover();
      if (e.code === 'KeyC' && !help) setCameraMode(n => 1 - n);
      if (e.code === 'Escape') { clear(); if (help) setHelp(false); else if (started) setPaused(v => !v); }
    };
    const up = (e: KeyboardEvent) => { held.delete(e.code); if (mapping[e.code]) controls.current[mapping[e.code]] = [...held].some(key => mapping[key] === mapping[e.code]); };
    const blur = () => { clear(); if (started) setPaused(true); };
    const visibility = () => { if (document.hidden) blur(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility);
    return () => { clear(); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility); };
  }, [started, paused, help, reset, recover]);

  const touch = (key: ControlKey) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); controls.current[key] = true; },
    onPointerUp: () => { controls.current[key] = false; },
    onPointerCancel: () => { controls.current[key] = false; },
    onLostPointerCapture: () => { controls.current[key] = false; },
  });
  return <main ref={mainRef} className={`app scale-study q-${VISUAL_QUALITY}${RAILS ? ' rails' : ''} ${night ? 'night' : ''} ${started ? 'playing' : 'intro'} ${revealed ? 'ready' : ''}`} style={{ '--night-top': nightValues.skyTop, '--night-horizon': nightValues.skyHorizon, '--aurora': nightValues.aurora, '--boost-tint': boostValues.tintColour, '--boost-tint-opacity': boostValues.tintOpacity } as CSSProperties}>
    {showLook && <LookPanel
      mode={lookMode}
      onMode={mode => { setLookMode(mode); if (mode === 'day' || mode === 'night' || mode === 'nearMiss') goTo(mode === 'day' ? 'day' : 'night'); }}
      look={{ day: look, night: nightValues, car: carValues, camera: cameraValues, boost: boostValues, nearMiss: nearMissValues, sound: soundValues }[lookMode]}
      sliders={{ day: DAY_LOOK_SLIDERS, night: NIGHT_LOOK_SLIDERS, car: CAR_TUNING_SLIDERS, camera: CAMERA_TUNING_SLIDERS, boost: BOOST_TUNING_SLIDERS, nearMiss: NEAR_MISS_LOOK_SLIDERS, sound: SOUND_TUNING_SLIDERS }[lookMode]}
      colours={lookMode === 'boost' ? BOOST_TUNING_COLOURS : lookMode === 'nearMiss' ? NEAR_MISS_LOOK_COLOURS : undefined}
      saved={{ day: DAY_LOOK_SAVED, night: NIGHT_LOOK_SAVED, car: CAR_TUNING_SAVED, camera: CAMERA_TUNING_SAVED, boost: BOOST_TUNING_SAVED, nearMiss: NEAR_MISS_LOOK_SAVED, sound: SOUND_TUNING_SAVED }[lookMode]}
      endpoint={{ day: '/__day-look', night: '/__night-look', car: '/__car-tuning', camera: '/__camera-tuning', boost: '/__boost-tuning', nearMiss: '/__near-miss-look', sound: '/__sound-tuning' }[lookMode]}
      onChange={values => {
        if (lookMode === 'day') changeLook(values as DayLook);
        else if (lookMode === 'night') changeNightLook(values as NightLook);
        else if (lookMode === 'car') changeCar(values as unknown as CarTuning);
        else if (lookMode === 'camera') changeCamera(values as unknown as CameraTuning);
        else if (lookMode === 'boost') changeBoost(values as unknown as BoostTuning);
        else if (lookMode === 'nearMiss') changeNearMiss(values as unknown as NearMissLook);
        else changeSound(values as unknown as SoundTuning);
      }}
      onClose={() => setShowLook(false)}
    />}
    <div className="scene"><DaySky /><NightSky /><SceneBoundary><Scene started={started} paused={paused || help} cameraMode={cameraMode} resetKey={resetKey} controls={controls} car={car} onTelemetry={setData} onReady={onReady} onTrafficHit={handleTrafficHit} onNearMiss={handleNearMiss} onDrift={handleDrift} /></SceneBoundary><div className={`boost-tint${started && data.boosting ? ' on' : ''}`} aria-hidden="true" /></div>
    <div className="vignette" />
    <header className="topbar">
      {/* Three parts: the logo on the start screen or the driver's level while driving (left), the score
          (centre, driving only), and the settings with pause (right). No logo while driving. */}
      {started
        ? <div className="level-badge" aria-label={`Level ${level.level}, ${level.title}, ${level.into} of ${level.need} XP`}>
          <span className="level-number" key={level.level}>{level.level}</span>
          <div><strong>{level.title}</strong><i><span style={{ transform: `scaleX(${level.into / level.need})` }} /></i><small>{level.into} / {level.need} XP</small></div>
        </div>
        : <a href="#" className="brand" aria-label="Wander, home" onClick={e => e.preventDefault()}>
          <LogoMark size={46} />
          <div><strong dir="ltr">Wander<span>.</span></strong><small>DRIVE · DISCOVER</small></div>
        </a>}
      {started && <div className="score-pill" aria-label={`Score ${score}`}><span>Score</span><b key={score}>{formatNumber(score)}</b></div>}
      {stuckHint
        ? <div className="road-warning" role="status"><TriangleAlert size={16} /><span>Stuck? Press <kbd>F</kbd> to hop back on the road</span></div>
        : roadWarning && <div className="road-warning" role="status"><TriangleAlert size={16} /><span>Off road — head back to the road</span></div>}
      <nav className="toolbar" aria-label="Game settings">
        <button aria-label={night ? 'Switch to evening' : 'Switch to night'} title={night ? 'Evening' : 'Night'} onClick={() => goTo(headingToNight() ? 'day' : 'night')}>{night ? <Sun /> : <Moon />}</button>
        {import.meta.env.DEV && <button aria-label="Day look" title="Day look" className={`desktop-only${showLook ? ' active' : ''}`} onClick={() => setShowLook(value => !value)}><SlidersHorizontal /></button>}
        <button aria-label={muted ? 'Unmute sound' : 'Mute sound'} title={muted ? 'Sound off' : 'Sound on'} onClick={() => setMutedState(m => !m)}>{muted ? <VolumeX /> : <Volume2 />}</button>
        <button className={`desktop-only${cameraMode ? ' active' : ''}`} aria-label="Change camera view" title="Change camera · C" onClick={() => setCameraMode(n => 1 - n)}><Maximize2 /></button>
        <button className="desktop-only" aria-label="Controls and help" title="Controls and help" onClick={() => setHelp(true)}><CircleHelp /></button>
        {started && <button aria-label={paused ? 'Resume driving' : 'Pause game'} title="Pause · Esc" onClick={() => setPaused(p => !p)}>{paused ? <Play /> : <Pause />}</button>}
      </nav>
    </header>

    {!started && <section className="intro-card">
      <h1 aria-label={TITLE}>{[...TITLE].map((c, i) => <span key={i} aria-hidden="true" className="ch" style={{ '--d': `${1000 + i * 60}ms` } as CSSProperties}>{c === ' ' ? '\u00a0' : c}</span>)}</h1>
      <p className="intro-copy rise" style={{ '--d': '1700ms' } as CSSProperties}>
        <span>Explore a little world behind the wheel.</span>
        <span>Play in your browser. No download needed.</span>
      </p>
      <div className="rise cta" style={{ '--d': '2100ms' } as CSSProperties}><button className="primary start-button" disabled={!ready} onClick={start}>{ready ? 'Start driving' : 'Preparing the globe...'}<ArrowRight size={22} /></button></div>
      <div className="intro-controls rise" style={{ '--d': '2500ms' } as CSSProperties}><span className="key-cluster"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>or arrow keys</span></div>
      <div className="intro-caption rise" style={{ '--d': '2900ms' } as CSSProperties}>Drag to rotate · Shift-drag to move</div>
    </section>}

    {started && <>
      <Coach rails={!!RAILS} active={!paused && !help && !roadWarning && !stuckHint} controls={controls} speed={data.speed} offroad={!!data.offroad} boostReady={(data.boost ?? 1) >= 1 && !data.boosting} />
      <div className="speedometer">
        <svg className="speed-dial" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="27" pathLength="100" fill="none" className="arc-track" /><circle cx="32" cy="32" r="27" pathLength="100" fill="none" className="arc-fill" strokeDasharray="0 100" ref={speedArc} /></svg>
        <div className="speed-readout"><strong ref={speedText}>0</strong><small>km/h</small></div>
        <span className="speed-label"><b>{car.current.speed < -0.1 ? 'R' : data.speed < 2 ? 'N' : currentGear()}</b>{formatNumber(data.distance)} m</span>
      </div>
      <BoostGauge car={car} controls={controls} offroad={!!data.offroad} />
      {hitNote && (hitNote.kind === 'bigSmash' || hitNote.kind === 'bigNear'
        // During a slow-motion cut-in: big, in the middle of the screen, the word built letter by letter.
        ? <div key={hitNote.id} className={`big-note ${hitNote.kind === 'bigSmash' ? 'smash' : 'near'}`} role="status" aria-label={`${hitNote.text} ${hitNote.points}`}>
          <strong aria-hidden="true">{[...hitNote.text].map((letter, i) => <span key={i} style={{ '--i': i } as CSSProperties}>{letter === ' ' ? '\u00a0' : letter}</span>)}</strong>
          <b aria-hidden="true" style={{ '--i': hitNote.text.length } as CSSProperties}>{hitNote.points > 0 ? '+' : ''}{hitNote.points}</b>
        </div>
        : <div key={hitNote.id} className={`hit-note ${/drift/i.test(hitNote.kind) ? `drift ${hitNote.kind}` : hitNote.kind}`} role="status">{hitNote.text} <b>{hitNote.badge ?? `${hitNote.points > 0 ? '+' : ''}${hitNote.points}`}</b></div>)}
      {/* One line of captions at a time: a traffic note takes the slot over a streak. */}
      {streakShown && !hitNote && <div key={streakLevel} className="hit-note streak" role="status">{streakMessages[(streakLevel - 1) % streakMessages.length]} <b>×{streakLevel}</b></div>}
      <div className="driving-actions"><button onClick={reset}><RotateCcw size={15} /> Restart</button><span className="key-hint"><kbd>Space</kbd> Brake</span><span className="key-hint"><kbd>Shift</kbd> Boost</span><span className="key-hint"><kbd>F</kbd> Back to road</span><span className="key-hint"><kbd>C</kbd> Camera</span>{gamepad && <span className="gamepad-hint">Gamepad connected</span>}</div>
      {RAILS ? <SteerPads controls={controls} /> : <div className="touch-controls" aria-label="Touch controls"><SteeringWheel controls={controls} /><div className="pedals"><button className="reverse-touch" aria-label="Reverse" {...touch('back')}><ArrowDown /></button><button className="brake-touch" aria-label="Brake" {...touch('brake')}>Brake</button><button className="gas-touch" aria-label="Accelerate" {...touch('forward')}>Gas</button></div></div>}
    </>}

    {!started && <footer className="page-footer"><span>WANDER · TAKE THE LONG WAY</span></footer>}
    {started && paused && !help && <div className="modal-shade"><section className="modal pause-modal" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <span className="eyebrow">PAUSED</span><h2 id="pause-title">The road will be here.</h2>
      <div className="pause-stats">
        <div><small>Score</small><b>{formatNumber(score)}</b></div>
        <div><small>Level {level.level}</small><b>{level.title}</b><i><span style={{ transform: `scaleX(${level.into / level.need})` }} /></i></div>
        <div><small>Driven</small><b>{formatNumber(data.distance)} m</b></div>
      </div>
      <button autoFocus className="primary" onClick={() => setPaused(false)}>Resume drive <Play size={18} /></button>
      <div className="modal-row">
        <button className="secondary" onClick={reset}><RotateCcw size={15} /> Restart</button>
        <button className="secondary" onClick={() => { setStarted(false); setPaused(false); }}><ChevronLeft size={15} /> Back to globe</button>
      </div>
    </section></div>}
    {help && <Help close={() => setHelp(false)} />}
    <LoadingScreen ready={ready} onLeave={() => setRevealed(true)} />
  </main>;
}
