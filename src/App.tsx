import { Component, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronLeft, CircleHelp, Maximize2, Moon, Pause, Play, RotateCcw, Sun, X } from 'lucide-react';
import Scene from './game/Scene';
import type { Telemetry } from './game/Scene';
import { emptyControls, initialLoopCar } from './game/driving';
import type { Controls } from './game/driving';
import { CAR_CONFIG } from './game/config';

const TITLE = 'Just drive.';
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
    <div className="help-row"><span>Brake</span><kbd>Space</kbd></div>
    <div className="help-row"><span>Change camera</span><kbd>C</kbd></div>
    <div className="help-row"><span>Restart</span><kbd>R</kbd></div>
    <div className="help-row"><span>Pause / resume</span><kbd>Esc</kbd></div>
    <p>Steer freely around the globe. Ease off the accelerator and slow down for corners. Hold reverse to brake, then back up.</p>
    <button className="primary" onClick={close}>Got it <Check size={18} /></button>
  </section></div>;
}

export default function App() {
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [night, setNight] = useState(false);
  const [cameraMode, setCameraMode] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const [help, setHelp] = useState(false);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Telemetry>(initialLoopCar);
  const controls = useRef(emptyControls());
  const car = useRef(initialLoopCar());
  const reset = useCallback(() => { controls.current = emptyControls(); setResetKey(k => k + 1); setPaused(false); }, []);
  const start = () => { setStarted(true); setPaused(false); controls.current = emptyControls(); };
  const onReady = useCallback(() => setReady(true), []);

  useEffect(() => {
    const mapping: Record<string, keyof Controls> = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'brake' };
    const held = new Set<string>();
    const clear = () => { held.clear(); controls.current = emptyControls(); };
    const down = (e: KeyboardEvent) => {
      const isButton = e.target instanceof HTMLElement && !!e.target.closest('button');
      if (isButton && (e.code === 'Enter' || (e.code === 'Space' && (!started || paused || help)))) return;
      if (mapping[e.code] && started && !paused && !help) { e.preventDefault(); held.add(e.code); controls.current[mapping[e.code]] = true; }
      if (e.repeat) return;
      if (e.code === 'KeyR' && started && !help) reset();
      if (e.code === 'KeyC' && !help) setCameraMode(n => 1 - n);
      if (e.code === 'Escape') { clear(); if (help) setHelp(false); else if (started) setPaused(v => !v); }
    };
    const up = (e: KeyboardEvent) => { held.delete(e.code); if (mapping[e.code]) controls.current[mapping[e.code]] = [...held].some(key => mapping[key] === mapping[e.code]); };
    const blur = () => { clear(); if (started) setPaused(true); };
    const visibility = () => { if (document.hidden) blur(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility);
    return () => { clear(); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility); };
  }, [started, paused, help, reset]);

  useEffect(() => {
    if (started) return;
    const move = (event: PointerEvent) => {
      document.documentElement.style.setProperty('--mx', (event.clientX / innerWidth * 2 - 1).toFixed(3));
      document.documentElement.style.setProperty('--my', (event.clientY / innerHeight * 2 - 1).toFixed(3));
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [started]);

  const touch = (key: keyof Controls) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); controls.current[key] = true; },
    onPointerUp: () => { controls.current[key] = false; },
    onPointerCancel: () => { controls.current[key] = false; },
    onLostPointerCapture: () => { controls.current[key] = false; },
  });
  return <main className={`app scale-study ${night ? 'night' : ''} ${started ? 'playing' : 'intro'} ${ready ? 'ready' : ''}`}>
    <div className="scene"><SceneBoundary><Scene started={started} paused={paused || help} night={night} cameraMode={cameraMode} resetKey={resetKey} controls={controls} car={car} onTelemetry={setData} onReady={onReady} /></SceneBoundary></div>
    <div className="vignette" />
    <header className="topbar">
      <a href="#" className="brand" aria-label="Wander, home" onClick={e => { e.preventDefault(); setStarted(false); setPaused(false); reset(); }}>
        <div className="brand-icon"><svg viewBox="0 0 32 32" fill="none"><path d="M5 26 12 6h8l7 20h-6c-1-7-3-11-5-13-2 2-4 6-5 13H5Z" stroke="currentColor" strokeWidth="1.8" /><path d="M13 9h6M3 28h26" stroke="currentColor" strokeWidth="1.4" /></svg></div>
        <div><strong dir="ltr">Wander<span>.</span></strong><small>DRIVE · DISCOVER</small></div>
      </a>
      <div className="location-pill"><span className="live-dot" /><span>ONE SMALL WORLD · ENDLESS LOOP</span></div>
      <nav className="toolbar" aria-label="Game settings">
        <button aria-label={night ? 'Switch to evening' : 'Switch to night'} title={night ? 'Evening' : 'Night'} onClick={() => setNight(n => !n)}>{night ? <Sun /> : <Moon />}</button>
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
      <div className="speedometer"><svg className="speed-arc" viewBox="0 0 160 130"><path d="M 24 112 A 65 65 0 1 1 136 112" className="arc-track" /><path d="M 24 112 A 65 65 0 1 1 136 112" className="arc-fill" pathLength="100" strokeDasharray={`${Math.min(data.speed / (CAR_CONFIG.maxSpeed * 3.6), 1) * 100} 100`} /></svg><div className="speed-readout"><strong>{formatNumber(data.speed)}</strong><small>km/h</small></div><div className="gear"><span>{car.current.speed < -0.1 ? 'R' : 'D'}</span><b>{formatNumber(data.distance)} m driven</b></div></div>
      <div className="driving-actions"><button onClick={reset}><RotateCcw size={15} /> Restart</button><span><kbd>Space</kbd> Brake</span><span><kbd>C</kbd> Camera</span></div>
      <div className="touch-controls" aria-label="Touch controls"><div><button aria-label="Steer left" {...touch('left')}><ArrowLeft /></button><button aria-label="Steer right" {...touch('right')}><ArrowRight /></button></div><div><button aria-label="Brake and reverse" {...touch('back')}><ArrowDown /></button><button aria-label="Accelerate" {...touch('forward')}><ArrowUp /></button><button className="brake-touch" aria-label="Brake" {...touch('brake')}>Brake</button></div></div>
    </>}

    <footer className="page-footer"><span>WANDER · TAKE THE LONG WAY</span></footer>
    {started && paused && !help && <div className="modal-shade"><section className="modal pause-modal" role="dialog" aria-modal="true" aria-labelledby="pause-title"><span className="eyebrow">TAKE A BREATHER</span><h2 id="pause-title">The road will be here.</h2><p>Whenever you're ready, keep circling.</p><button autoFocus className="primary" onClick={() => setPaused(false)}>Resume drive <Play size={18} /></button><button className="text-button" onClick={() => { setStarted(false); setPaused(false); }}>Back to globe <ChevronLeft size={15} /></button></section></div>}
    {help && <Help close={() => setHelp(false)} />}
  </main>;
}
