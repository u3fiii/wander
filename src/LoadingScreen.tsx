import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { onLoadProgress } from './game/loadProgress';

const TIPS = ['Rolling out the little world…', 'Planting the trees…', 'Polishing the hubcaps…', 'Painting the road lines…', 'Waking up the traffic…', 'Warming up the engine…'];
// The bar never claims to be done until the scene has drawn its first frame.
const MAX_BEFORE_READY = 0.94;
// Kept on screen at least this long so it never flashes, then fades out.
const MIN_SHOW_MS = 1400;
// The loader copy fades first, the sky is exposed next, then the overlay is removed.
const CONTENT_FADE_MS = 300;
const SKY_REVEAL_MS = 450;
// The bar's pace: how long (s) it takes to settle on new progress, its top speed (whole bar per second), and how fast
// it creeps on its own while waiting; the `Finish` values are for the last stretch once everything is ready.
const BAR = { settle: 0.7, maxSpeed: 0.55, creep: 0.006, settleFinish: 0.35, maxSpeedFinish: 1.6 };
// Each tip stays up this long.
const TIP_MS = 2200;

// Full-screen loader shown until every model is loaded and the scene is rendering. Same markup and styles as the
// static loader in index.html, so the hand-off from the HTML page to React is seamless.
export default function LoadingScreen({ ready, onLeave }: { ready: boolean; onLeave: () => void }) {
  const [target, setTarget] = useState(0);
  const [tip, setTip] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'leaving' | 'gone'>('loading');
  const bar = useRef<HTMLSpanElement>(null);
  const label = useRef<HTMLElement>(null);
  const mounted = useRef(performance.now());
  // Carry the static loader's timing on from where it was (see .loader in index.html).
  const since = useRef(`${-Math.round(mounted.current)}ms`);
  const done = ready && phase !== 'loading';

  useEffect(() => onLoadProgress(f => setTarget(Math.min(f, MAX_BEFORE_READY))), []);
  useEffect(() => {
    if (phase !== 'loading') return;
    const timer = window.setInterval(() => setTip(n => (n + 1) % TIPS.length), TIP_MS);
    return () => window.clearInterval(timer);
  }, [phase]);
  // The bar follows the real progress on a damped spring with a speed limit, so it glides at an even, measured pace
  // instead of jumping when a big file lands, and never stops dead while one is still coming (a slow creep).
  const goal = useRef(0);
  goal.current = ready ? 1 : target;
  useEffect(() => {
    let frame = 0, value = 0, velocity = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const finishing = goal.current === 1;
      const aim = Math.max(goal.current, Math.min(value + BAR.creep * dt, MAX_BEFORE_READY));
      // Critically damped spring toward the aim (smooth start and stop), capped at a top speed (Unity's SmoothDamp).
      const settle = finishing ? BAR.settleFinish : BAR.settle, omega = 2 / settle;
      const x = omega * dt, decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
      const maxChange = (finishing ? BAR.maxSpeedFinish : BAR.maxSpeed) * settle;
      const change = Math.max(value - aim, -maxChange), target = value - change;
      const temp = (velocity + omega * change) * dt;
      velocity = (velocity - omega * temp) * decay;
      value = Math.min(aim, target + (change + temp) * decay);
      if (value >= aim) velocity = 0;
      if (bar.current) bar.current.style.transform = `scaleX(${value})`;
      if (label.current) label.current.textContent = `${Math.round(value * 100)}%`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const wait = Math.max(550, MIN_SHOW_MS - (performance.now() - mounted.current));
    const leave = window.setTimeout(() => setPhase('leaving'), wait);
    const reveal = window.setTimeout(onLeave, wait + CONTENT_FADE_MS);
    const gone = window.setTimeout(() => setPhase('gone'), wait + CONTENT_FADE_MS + SKY_REVEAL_MS);
    return () => { window.clearTimeout(leave); window.clearTimeout(reveal); window.clearTimeout(gone); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (phase === 'gone') return null;
  return <div className={`loader${done ? ' leaving' : ''}`} role="progressbar" aria-label="Loading the world" aria-busy={!ready} style={{ '--since': since.current } as CSSProperties}>
    <span className="loader-backdrop" aria-hidden="true" />
    <strong className="loader-brand" aria-label="Wander.">Wander<span className="loader-dot" aria-hidden="true">.</span></strong>
    <div className="loader-meter">
      <div className="loader-track"><span ref={bar} /></div>
      <p className="loader-text"><span key={ready ? 'ready' : tip}>{ready ? 'Ready to drive' : TIPS[tip]}</span><em ref={label}>0%</em></p>
    </div>
  </div>;
}
