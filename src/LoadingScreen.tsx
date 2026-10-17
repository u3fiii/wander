import { useEffect, useRef, useState } from 'react';
import { onLoadProgress } from './game/loadProgress';

const TIPS = ['Rolling out the little world…', 'Planting the trees…', 'Polishing the hubcaps…', 'Painting the road lines…', 'Waking up the traffic…', 'Warming up the engine…'];
// The bar never claims to be done until the scene has drawn its first frame.
const MAX_BEFORE_READY = 0.94;
// Kept on screen at least this long so it never flashes, then fades out.
const MIN_SHOW_MS = 900;
const FADE_MS = 650;

// Full-screen loader shown until every model is loaded and the scene is rendering. Same markup and styles as the
// static loader in index.html, so the hand-off from the HTML page to React is seamless.
export default function LoadingScreen({ ready, onLeave }: { ready: boolean; onLeave: () => void }) {
  const [target, setTarget] = useState(0);
  const [tip, setTip] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'leaving' | 'gone'>('loading');
  const bar = useRef<HTMLSpanElement>(null);
  const label = useRef<HTMLElement>(null);
  const mounted = useRef(performance.now());
  const done = ready && phase !== 'loading';

  useEffect(() => onLoadProgress(f => setTarget(Math.min(f, MAX_BEFORE_READY))), []);
  useEffect(() => {
    if (phase !== 'loading') return;
    const timer = window.setInterval(() => setTip(n => (n + 1) % TIPS.length), 1800);
    return () => window.clearInterval(timer);
  }, [phase]);
  // The bar eases toward the real progress (and creeps slowly while waiting on a big file).
  const goal = useRef(0);
  goal.current = ready ? 1 : target;
  useEffect(() => {
    let frame = 0, value = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const aim = Math.max(goal.current, Math.min(value + 0.004 * dt, MAX_BEFORE_READY));
      value += (aim - value) * Math.min(1, dt * (goal.current === 1 ? 9 : 4));
      if (bar.current) bar.current.style.transform = `scaleX(${value})`;
      if (label.current) label.current.textContent = `${Math.round(value * 100)}%`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const wait = Math.max(350, MIN_SHOW_MS - (performance.now() - mounted.current));
    const leave = window.setTimeout(() => { setPhase('leaving'); onLeave(); }, wait);
    const gone = window.setTimeout(() => setPhase('gone'), wait + FADE_MS);
    return () => { window.clearTimeout(leave); window.clearTimeout(gone); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (phase === 'gone') return null;
  return <div className={`loader${done ? ' leaving' : ''}`} role="progressbar" aria-label="Loading the world" aria-busy={!ready}>
    <div className="loader-planet" aria-hidden="true"><i className="loader-orbit"><b /></i></div>
    <strong className="loader-brand">Wander<span>.</span></strong>
    <div className="loader-track"><span ref={bar} /></div>
    <p className="loader-text"><span key={tip}>{ready ? 'Ready to drive' : TIPS[tip]}</span><em ref={label}>0%</em></p>
  </div>;
}
