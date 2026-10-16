import { Component, Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, SlidersHorizontal, ChevronLeft, CircleHelp, Maximize2, Moon, Pause, Play, RotateCcw, Sun, TriangleAlert, Volume2, VolumeX, X } from 'lucide-react';
import Scene from './game/Scene';
import type { Telemetry } from './game/Scene';
import { emptyControls, initialLoopCar, recoverToRoad } from './game/driving';
import type { ControlKey } from './game/driving';

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
import type { TrafficHit } from './game/obstacles';
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
import { setMuted, startAudio } from './game/audio';

const TITLE = 'Just drive.';
// How long each day or night phase lasts while driving (ms).
const DAY_CYCLE_MS = 45000;
// The automatic day/night change plays out slowly, over this many seconds (the button still switches quickly).
const AUTO_SHIFT_SECONDS = 10;
const formatNumber = (n: number) => Math.round(n).toLocaleString('en-US');
class SceneBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? <div className="error-screen"><h2>The 3D scene could not load</h2><p>Enable graphics acceleration in your browser and try again.</p><button className="primary" onClick={() => location.reload()}>Try again</button></div> : this.props.children; }
}
function Help({ close }: { close: () => void }) {
  return <div className="modal-shade" onClick={close}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e => e.stopPropagation()}>
    <button className="close-button" autoFocus aria-label="Close help" onClick={close}><X size={20} /></button>
    <span className="eyebrow">BEHIND THE WHEEL</span><h2 id="help-title">Circle the little world.</h2>
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
type LookMode = 'day' | 'night' | 'car' | 'camera' | 'boost';
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
  const [autoShift, setAutoShift] = useState(false);
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
  const [carValues, setCarValues] = useState<CarTuning>(() => Object.fromEntries(Object.keys(CAR_TUNING_SAVED).map(key => [key, CAR_CONFIG[key as keyof CarTuning]])) as CarTuning);
  const changeCar = (next: CarTuning) => { Object.assign(CAR_CONFIG, next); setCarValues(next); };
  // Day and night cycle by themselves while you drive: each phase lasts a few minutes. The button still switches
  // at any time, and a manual switch restarts the count for the new phase.
  useEffect(() => {
    if (!started || paused) return;
    const timer = window.setTimeout(() => { setAutoShift(true); setNight(value => !value); }, DAY_CYCLE_MS);
    return () => window.clearTimeout(timer);
  }, [started, paused, night]);
  const [cameraMode, setCameraMode] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const [help, setHelp] = useState(false);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Telemetry>(initialLoopCar);
  const [gamepad, setGamepad] = useState(false);
  const [muted, setMutedState] = useState(false);
  // Smooth-driving streak: grows while staying on the road at speed, resets off-road or when slowing right down.
  const streak = useRef({ time: 0, last: 0 });
  const [streakLevel, setStreakLevel] = useState(0);
  const streakMessages = ['Smooth driving', 'Nice line', 'Clean drive', 'Great flow', 'On a roll', 'Cruising', 'Road master', 'Zen mode'];
  const [streakShown, setStreakShown] = useState(false);
  // Traffic scoring: clipping a car from the side pays and gets a compliment; a head-on hit costs points and gets condolences.
  const [score, setScore] = useState(0);
  const [hitNote, setHitNote] = useState<{ id: number; kind: 'side' | 'front'; points: number; text: string } | null>(null);
  const hitCount = useRef(0);
  const hitTimer = useRef<number | undefined>(undefined);
  const hitMessages = {
    side: ['Nice flick!', 'Clean sideswipe!', 'Pinball pro!', 'Smooth knock!'],
    front: ['Ouch, our condolences.', 'Rough head-on hit.', 'Sorry for your loss.', 'Oof, that one hurt.'],
  };
  // A negative hit tints the frame red for the length of the crash cut-in (restarted on every new crash).

  // Under boost every hit is a win: the car is a bulldozer, so no condolences, only awe (and bonus points).
  const boostMessages = ['Who even are you?!', 'Absolute unit!', 'Out of my way!', 'Unstoppable!', 'Bulldozer mode!', 'Way too strong!'];
  const handleTrafficHit = useCallback((hit: TrafficHit) => {
    const magnitude = Math.round(hit.speed * 2) + 5;
    const points = hit.boosted ? Math.round(magnitude * 1.5) : hit.kind === 'side' ? magnitude : -magnitude;
    const count = hitCount.current++;
    const messages = hit.boosted ? boostMessages : hitMessages[hit.kind];
    setScore(total => total + points);
    setHitNote({ id: count, kind: hit.boosted ? 'side' : hit.kind, points, text: messages[count % messages.length] });
    window.clearTimeout(hitTimer.current);
    hitTimer.current = window.setTimeout(() => setHitNote(null), 2200);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (streakLevel === 0) { setStreakShown(false); return; }
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
  const speedArc = useRef<SVGPathElement>(null);
  useEffect(() => {
    let frame = 0, last = performance.now(), value = 0, velocity = 0;
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      velocity += (JUICE_CONFIG.hudSpringStiffness * (dataRef.current.speed - value) - JUICE_CONFIG.hudSpringDamping * velocity) * dt;
      value += velocity * dt;
      const shown = Math.max(0, value);
      if (speedText.current) speedText.current.textContent = formatNumber(shown);
      if (speedArc.current) speedArc.current.setAttribute('stroke-dasharray', `${Math.min(shown / (CAR_CONFIG.maxSpeed * 3.6), 1) * 100} 100`);
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
      panel.add({ copy: () => navigator.clipboard?.writeText(JSON.stringify({ CAR_CONFIG, JUICE_CONFIG }, null, 2)) }, 'copy').name('Copy values');
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
  const start = () => { setStarted(true); setPaused(false); controls.current = emptyControls(); };
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
  return <main className={`app scale-study ${night ? 'night' : ''} ${autoShift ? 'slow-shift' : ''} ${started ? 'playing' : 'intro'} ${ready ? 'ready' : ''}`} style={{ '--sky-top': look.skyTop, '--sky-horizon': look.skyHorizon, '--night-top': nightValues.skyTop, '--night-horizon': nightValues.skyHorizon, '--aurora': nightValues.aurora, '--boost-tint': boostValues.tintColour, '--boost-tint-opacity': boostValues.tintOpacity } as CSSProperties}>
    {showLook && <LookPanel
      mode={lookMode}
      onMode={mode => { setLookMode(mode); if (mode === 'day' || mode === 'night') { setAutoShift(false); setNight(mode === 'night'); } }}
      look={{ day: look, night: nightValues, car: carValues, camera: cameraValues, boost: boostValues }[lookMode]}
      sliders={{ day: DAY_LOOK_SLIDERS, night: NIGHT_LOOK_SLIDERS, car: CAR_TUNING_SLIDERS, camera: CAMERA_TUNING_SLIDERS, boost: BOOST_TUNING_SLIDERS }[lookMode]}
      colours={lookMode === 'boost' ? BOOST_TUNING_COLOURS : undefined}
      saved={{ day: DAY_LOOK_SAVED, night: NIGHT_LOOK_SAVED, car: CAR_TUNING_SAVED, camera: CAMERA_TUNING_SAVED, boost: BOOST_TUNING_SAVED }[lookMode]}
      endpoint={{ day: '/__day-look', night: '/__night-look', car: '/__car-tuning', camera: '/__camera-tuning', boost: '/__boost-tuning' }[lookMode]}
      onChange={values => {
        if (lookMode === 'day') changeLook(values as DayLook);
        else if (lookMode === 'night') changeNightLook(values as NightLook);
        else if (lookMode === 'car') changeCar(values as unknown as CarTuning);
        else if (lookMode === 'camera') changeCamera(values as unknown as CameraTuning);
        else changeBoost(values as unknown as BoostTuning);
      }}
      onClose={() => setShowLook(false)}
    />}
    <div className="scene"><NightSky /><SceneBoundary><Scene started={started} paused={paused || help} night={night} nightFade={autoShift ? AUTO_SHIFT_SECONDS : undefined} cameraMode={cameraMode} resetKey={resetKey} controls={controls} car={car} onTelemetry={setData} onReady={onReady} onTrafficHit={handleTrafficHit} /></SceneBoundary><div className={`boost-tint${started && data.boosting ? ' on' : ''}`} aria-hidden="true" /></div>
    <div className="vignette" />
    <header className="topbar">
      <a href="#" className="brand" aria-label="Wander, home" onClick={e => { e.preventDefault(); setStarted(false); setPaused(false); reset(); }}>
        <div className="brand-icon"><svg viewBox="0 0 32 32" fill="none"><path d="M5 26 12 6h8l7 20h-6c-1-7-3-11-5-13-2 2-4 6-5 13H5Z" stroke="currentColor" strokeWidth="1.8" /><path d="M13 9h6M3 28h26" stroke="currentColor" strokeWidth="1.4" /></svg></div>
        <div><strong dir="ltr">Wander<span>.</span></strong><small>DRIVE · DISCOVER</small></div>
      </a>
      {stuckHint
        ? <div className="road-warning" role="status"><TriangleAlert size={16} /><span>Stuck? Press <kbd>F</kbd> to hop back on the road</span></div>
        : roadWarning && <div className="road-warning" role="status"><TriangleAlert size={16} /><span>Off road — head back to the road</span></div>}
      <nav className="toolbar" aria-label="Game settings">
        <button aria-label={night ? 'Switch to evening' : 'Switch to night'} title={night ? 'Evening' : 'Night'} onClick={() => { setAutoShift(false); setNight(n => !n); }}>{night ? <Sun /> : <Moon />}</button>
        {import.meta.env.DEV && <button aria-label="Day look" title="Day look" className={showLook ? 'active' : ''} onClick={() => setShowLook(value => !value)}><SlidersHorizontal /></button>}
        <button aria-label={muted ? 'Unmute sound' : 'Mute sound'} title={muted ? 'Sound off' : 'Sound on'} onClick={() => setMutedState(m => !m)}>{muted ? <VolumeX /> : <Volume2 />}</button>
        <button className={cameraMode ? 'active' : ''} aria-label="Change camera view" title="Change camera · C" onClick={() => setCameraMode(n => 1 - n)}><Maximize2 /></button>
        <button aria-label="Controls and help" title="Controls and help" onClick={() => setHelp(true)}><CircleHelp /></button>
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
      <div className="speedometer"><svg className="speed-arc" viewBox="0 0 160 130"><path d="M 24 112 A 65 65 0 1 1 136 112" className="arc-track" /><path d="M 24 112 A 65 65 0 1 1 136 112" className="arc-fill" pathLength="100" strokeDasharray="0 100" ref={speedArc} /></svg><div className="speed-readout"><strong ref={speedText}>0</strong><small>km/h</small></div><div className="gear"><span>{car.current.speed < -0.1 ? 'R' : 'D'}</span><b>{formatNumber(data.distance)} m driven</b></div><div className="throttle-bar" aria-hidden="true"><span style={{ transform: `scaleX(${data.throttle ?? 0})` }} /></div><div className={`boost-bar${data.boosting ? ' firing' : ''}`} aria-label="Boost meter"><span style={{ transform: `scaleX(${data.boost ?? 1})` }} /></div></div>
      {hitNote && <div key={hitNote.id} className={`hit-note ${hitNote.kind}`} role="status">{hitNote.text} <b>{hitNote.points > 0 ? '+' : ''}{hitNote.points}</b></div>}
      {streakShown && <div key={streakLevel} className="streak" role="status">{streakMessages[(streakLevel - 1) % streakMessages.length]} <b>×{streakLevel}</b></div>}
      <div className="driving-actions"><button onClick={reset}><RotateCcw size={15} /> Restart</button><span className="score-chip">Score <b>{score}</b></span><span><kbd>Space</kbd> Brake</span><span><kbd>Shift</kbd> Boost</span><span><kbd>F</kbd> Back to road</span><span><kbd>C</kbd> Camera</span>{gamepad && <span className="gamepad-hint">Gamepad connected</span>}</div>
      <div className="touch-controls" aria-label="Touch controls"><SteeringWheel controls={controls} /><div className="pedals"><button className="reverse-touch" aria-label="Reverse" {...touch('back')}><ArrowDown /></button><button className="brake-touch" aria-label="Brake" {...touch('brake')}>Brake</button><button className="gas-touch" aria-label="Accelerate" {...touch('forward')}>Gas</button></div></div>
    </>}

    <footer className="page-footer"><span>WANDER · TAKE THE LONG WAY</span></footer>
    {started && paused && !help && <div className="modal-shade"><section className="modal pause-modal" role="dialog" aria-modal="true" aria-labelledby="pause-title"><span className="eyebrow">TAKE A BREATHER</span><h2 id="pause-title">The road will be here.</h2><p>Whenever you're ready, keep circling.</p><button autoFocus className="primary" onClick={() => setPaused(false)}>Resume drive <Play size={18} /></button><button className="text-button" onClick={() => { setStarted(false); setPaused(false); }}>Back to globe <ChevronLeft size={15} /></button></section></div>}
    {help && <Help close={() => setHelp(false)} />}
  </main>;
}
