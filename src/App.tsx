import { Component, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Check, ChevronLeft, CircleHelp, Compass, Flag, MapPin, Maximize2, Moon, Pause, Play, RotateCcw, Sun, X } from 'lucide-react';
import Scene from './game/Scene';
import type { Telemetry } from './game/Scene';
import { emptyControls, initialCar } from './game/driving';
import type { Controls } from './game/driving';
import { BLOCKS, ROADS, STOPS } from './game/config';

const fa = (n: number) => Math.round(n).toLocaleString('fa-IR');
class SceneBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? <div className="error-screen"><h2>صحنهٔ سه‌بعدی باز نشد</h2><p>شتاب‌دهی گرافیکی مرورگر را روشن کن و دوباره امتحان کن.</p><button className="primary" onClick={() => location.reload()}>تلاش دوباره</button></div> : this.props.children; }
}
function MiniMap({ data, stop }: { data: Telemetry; stop: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d')!; const size = 400, scale = 1.47;
    const p = (v: number) => size / 2 + v * scale;
    ctx.clearRect(0, 0, size, size); ctx.fillStyle = '#ede9d9'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#d2d6c2';
    for (const x of BLOCKS) for (const z of BLOCKS) ctx.fillRect(p(x - 19), p(z - 19), 38 * scale, 38 * scale);
    ctx.fillStyle = '#a2b49b'; ctx.fillRect(p(-46), p(8), 38 * scale, 38 * scale);
    ctx.strokeStyle = '#fbf7e9'; ctx.lineWidth = 10;
    ROADS.forEach(r => { ctx.beginPath(); ctx.moveTo(p(r), 12); ctx.lineTo(p(r), 388); ctx.stroke(); ctx.beginPath(); ctx.moveTo(12, p(r)); ctx.lineTo(388, p(r)); ctx.stroke(); });
    STOPS.forEach((s, i) => {
      ctx.beginPath(); ctx.arc(p(s.x), p(s.z), i === stop ? 10 : 5, 0, Math.PI * 2);
      ctx.fillStyle = i < stop ? '#3d6c5b' : i === stop ? '#d79842' : '#a2ae9a'; ctx.fill();
      if (i === stop) { ctx.strokeStyle = '#fff9dc'; ctx.lineWidth = 4; ctx.stroke(); }
    });
    ctx.save(); ctx.translate(p(data.x), p(data.z)); ctx.rotate(-data.heading);
    ctx.shadowColor = '#174e4c88'; ctx.shadowBlur = 8;
    ctx.fillStyle = '#176663'; ctx.strokeStyle = '#fff9df'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 8); ctx.lineTo(0, 4); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }, [data, stop]);
  return <div className="minimap"><canvas ref={ref} width={400} height={400} aria-label="نقشهٔ شهر و موقعیت ماشین" /><span className="north">N ↑</span><span className="map-label"><span /> {STOPS[stop]?.label ?? 'گشت آزاد'}</span></div>;
}
function Help({ close }: { close: () => void }) {
  return <div className="modal-shade" onClick={close}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e => e.stopPropagation()}>
    <button className="close-button" autoFocus aria-label="بستن راهنما" onClick={close}><X size={20} /></button>
    <span className="eyebrow">پشت فرمان</span><h2 id="help-title">شهر دست توست.</h2>
    <div className="help-row"><span>گاز و دنده عقب</span><span><kbd>W</kbd> <kbd>S</kbd> یا <kbd>↑</kbd> <kbd>↓</kbd></span></div>
    <div className="help-row"><span>فرمان</span><span><kbd>A</kbd> <kbd>D</kbd> یا <kbd>←</kbd> <kbd>→</kbd></span></div>
    <div className="help-row"><span>ترمز</span><kbd>Space</kbd></div>
    <div className="help-row"><span>تغییر دوربین</span><kbd>C</kbd></div>
    <div className="help-row"><span>برگشت به شروع</span><kbd>R</kbd></div>
    <div className="help-row"><span>توقف و ادامه</span><kbd>Esc</kbd></div>
    <p>برای پیچیدن سرعتت را کم کن. نشانه‌های طلایی را دنبال کن یا هر جا دلت خواست برو.</p>
    <button className="primary" onClick={close}>گرفتم <Check size={18} /></button>
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
  const [stop, setStop] = useState(0);
  const [toast, setToast] = useState('');
  const [data, setData] = useState<Telemetry>({ speed: 0, distance: 0, x: 3.5, z: 35, heading: 0 });
  const controls = useRef(emptyControls());
  const car = useRef(initialCar());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((text: string) => {
    setToast(text); if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3300);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const reset = useCallback(() => { controls.current = emptyControls(); setResetKey(k => k + 1); setStop(0); setPaused(false); notify('دوباره از اول خیابان'); }, [notify]);
  const start = () => { setStarted(true); setPaused(false); controls.current = emptyControls(); };
  const nextStop = useCallback(() => {
    setStop(n => n + 1); notify('رسیدی! یک گوشهٔ دیگر از شهر کشف شد.');
  }, [notify]);
  const onReady = useCallback(() => setReady(true), []);

  useEffect(() => {
    const mapping: Record<string, keyof Controls> = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'brake' };
    const held = new Set<string>();
    const clear = () => { held.clear(); controls.current = emptyControls(); };
    const down = (e: KeyboardEvent) => {
      const isButton = e.target instanceof HTMLElement && !!e.target.closest('button');
      if (isButton && (e.code === 'Space' || e.code === 'Enter')) return;
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

  const touch = (key: keyof Controls) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); controls.current[key] = true; },
    onPointerUp: () => { controls.current[key] = false; },
    onPointerCancel: () => { controls.current[key] = false; },
    onLostPointerCapture: () => { controls.current[key] = false; },
  });
  const destination = STOPS[stop];
  const distance = destination ? Math.hypot(data.x - destination.x, data.z - destination.z) : 0;
  return <main className={`app ${night ? 'night' : ''} ${started ? 'playing' : 'intro'}`}>
    <div className="scene"><SceneBoundary><Scene started={started} paused={paused || help} night={night} cameraMode={cameraMode} resetKey={resetKey} controls={controls} car={car} stop={stop} onTelemetry={setData} onStop={nextStop} onReady={onReady} /></SceneBoundary></div>
    <div className="vignette" />
    <header className="topbar">
      <a href="#" className="brand" aria-label="تهران‌گرد، صفحهٔ آغاز" onClick={e => { e.preventDefault(); setStarted(false); setPaused(false); reset(); }}>
        <div className="brand-icon"><svg viewBox="0 0 32 32" fill="none"><path d="M5 26 12 6h8l7 20h-6c-1-7-3-11-5-13-2 2-4 6-5 13H5Z" stroke="currentColor" strokeWidth="1.8" /><path d="M13 9h6M3 28h26" stroke="currentColor" strokeWidth="1.4" /></svg></div>
        <div><strong>تهران‌گرد<span>،</span></strong><small>TEHRAN DRIVE</small></div>
      </a>
      <div className="location-pill"><span className="live-dot" /><span>تهران، به روایت ما</span><span className="pill-divider" /><span>{night ? '۲۱:۳۰' : '۱۷:۴۵'}</span>{night ? <Moon size={15} /> : <Sun size={17} />}</div>
      <nav className="toolbar" aria-label="تنظیمات بازی">
        <button aria-label={night ? 'تغییر به عصر' : 'تغییر به شب'} title={night ? 'عصر' : 'شب'} onClick={() => setNight(n => !n)}>{night ? <Sun /> : <Moon />}</button>
        <button className={cameraMode ? 'active' : ''} aria-label="تغییر نمای دوربین" title="تغییر دوربین · C" onClick={() => setCameraMode(n => 1 - n)}><Maximize2 /></button>
        <button aria-label="راهنمای کنترل‌ها" title="راهنمای کنترل‌ها" onClick={() => setHelp(true)}><CircleHelp /></button>
        {started && <button aria-label={paused ? 'ادامهٔ رانندگی' : 'توقف بازی'} title="توقف · Esc" onClick={() => setPaused(p => !p)}>{paused ? <Play /> : <Pause />}</button>}
      </nav>
    </header>

    {!started && <section className="intro-card">
      <div className="eyebrow"><span /> گشت آزاد · نسخهٔ اول</div>
      <h1>یک دور<br />توی <span>شهر.</span></h1>
      <p>از سایهٔ چنارها تا میدان آزادی.<br />پشت فرمان بشین؛ تهران منتظرته.</p>
      <button className="primary start-button" disabled={!ready} onClick={start}>{ready ? 'بزن بریم' : 'شهر داره بیدار می‌شه…'}<ArrowLeft size={22} /></button>
      <div className="intro-controls"><span className="key-cluster"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>یا کلیدهای جهت‌دار</span></div>
      <div className="intro-caption">یک شهر کوچک، برای گشتن‌های بی‌عجله.</div>
    </section>}

    {started && <>
      <section className="journey-card" aria-label="مسیر گردش">
        <div className="journey-top"><span><Flag size={15} /> گشتِ عصرانه</span><span>{fa(Math.min(stop, 4))} / ۴</span></div>
        <h2>{destination?.name ?? 'شهر را گشتی!'}</h2>
        <p>{destination ? <><MapPin size={13} /> {destination.hint}<b>{fa(distance)} متر</b></> : 'حالا هر جا دوست داری برو. شهر مال توست.'}</p>
        <div className="progress-stops">{STOPS.map((s, i) => <span key={s.label} className={i < stop ? 'done' : i === stop ? 'current' : ''} title={s.label}>{i < stop ? <Check size={10} /> : null}</span>)}</div>
      </section>
      <div className="speedometer"><svg className="speed-arc" viewBox="0 0 160 130"><path d="M 24 112 A 65 65 0 1 1 136 112" className="arc-track" /><path d="M 24 112 A 65 65 0 1 1 136 112" className="arc-fill" pathLength="100" strokeDasharray={`${Math.min(data.speed / 85, 1) * 100} 100`} /></svg><div className="speed-readout"><strong>{fa(data.speed)}</strong><small>کیلومتر / ساعت</small></div><div className="gear"><span>{car.current.speed < -0.1 ? 'R' : 'D'}</span><b>{fa(data.distance)} متر گشت‌وگذار</b></div></div>
      <div className="driving-actions"><button onClick={reset}><RotateCcw size={15} /> از اول</button><span><kbd>Space</kbd> ترمز</span><span><kbd>C</kbd> دوربین</span></div>
      <div className="touch-controls" aria-label="کنترل لمسی"><div><button aria-label="فرمان چپ" {...touch('left')}><ArrowLeft /></button><button aria-label="فرمان راست" {...touch('right')}><ArrowRight /></button></div><div><button aria-label="دنده عقب" {...touch('back')}><ArrowDown /></button><button aria-label="گاز" {...touch('forward')}><ArrowUp /></button><button className="brake-touch" aria-label="ترمز" {...touch('brake')}>ترمز</button></div></div>
    </>}

    <aside className="map-panel"><div className="map-heading"><span><Compass size={14} /> حوالیِ تهران</span><span>۰۱</span></div><MiniMap data={data} stop={stop} /><div className="map-footer"><span>{started ? 'نشانهٔ طلایی را پیدا کن' : 'چهار گوشه، یک گشت کوتاه'}</span><ArrowUpRight size={15} /></div></aside>
    <footer className="page-footer"><span>ساخته‌شده برای گم‌شدن در کوچه‌ها</span><span>TEHRAN, REIMAGINED <i /> V.01</span></footer>
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    {started && paused && !help && <div className="modal-shade"><section className="modal pause-modal" role="dialog" aria-modal="true" aria-labelledby="pause-title"><span className="eyebrow">یک نفس تازه</span><h2 id="pause-title">شهر منتظرت می‌ماند.</h2><p>هر وقت آماده‌ای، برگرد پشت فرمان.</p><button autoFocus className="primary" onClick={() => setPaused(false)}>ادامهٔ گشت <Play size={18} /></button><button className="text-button" onClick={() => { setStarted(false); setPaused(false); }}>برگشت به شروع <ChevronLeft size={15} /></button></section></div>}
    {help && <Help close={() => setHelp(false)} />}
  </main>;
}
