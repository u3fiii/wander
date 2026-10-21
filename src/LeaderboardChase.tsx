import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowRight, Crown, Flower2, Leaf, Moon, Snowflake, Sun, Sunset, Trophy } from 'lucide-react';
import { fetchStanding, fetchTop, sharedBoard } from './game/globalBoard';
import type { Standing } from './game/globalBoard';
import { cleanName, loadBest, loadDeviceId } from './game/leaderboard';
import type { Entry } from './game/leaderboard';
import './DriverCard.css';
import { STAGE_POINTS, cardLook, stageAt, stageProgress } from './game/stages';

const number = (n: number) => Math.max(0, Math.floor(n)).toLocaleString('en-US');

export function LeaderboardSpotlight({ open, level, best }: { open: () => void; level: { level: number; title: string }; best: number }) {
  const [board, setBoard] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(sharedBoard);
  useEffect(() => {
    let live = true;
    fetchTop().then(rows => { if (live) { setBoard(rows); setLoading(false); } });
    return () => { live = false; };
  }, []);
  const connected = board !== null;
  return <button className="driver-card" onClick={open} aria-label={`Level ${level.level}, ${level.title}. Personal best ${number(best)}. Open leaderboard.`}>
    <span className="driver-card-profile">
      <span className="driver-card-level" aria-hidden="true">{level.level}</span>
      <span className="driver-card-identity"><small>YOUR JOURNEY</small><strong>{level.title}</strong></span>
      <span className="driver-card-best"><small>PERSONAL BEST</small><strong>{number(best)}</strong></span>
    </span>
    <span className="driver-card-divider" />
    <span className="driver-card-heading"><span>{connected ? 'WORLD TOP 3' : loading ? 'FINDING RIVALS' : 'YOUR NEXT CHALLENGE'}</span><ArrowRight size={14} /></span>
    {connected && board.length > 0 ? <span className="driver-card-rivals">
      {[0, 1, 2].map(rank => {
        const entry = board[rank];
        return <span key={rank} className={`driver-card-rival${rank === 0 ? ' first' : ''}`} style={{ '--arrival': `${rank * 90}ms` } as CSSProperties}>
          <span className="driver-card-place">{rank === 0 ? <Crown size={14} /> : `0${rank + 1}`}</span>
          <span><strong>{entry ? cleanName(entry.name) || 'Unnamed' : 'Open spot'}</strong><small>{entry ? number(entry.score) : '—'}</small></span>
        </span>;
      })}
    </span> : <span className="driver-card-empty"><Trophy size={17} /><strong>{loading ? 'The chase is loading…' : connected ? 'Set the first record.' : best > 0 ? `Beat ${number(best)}. Make your next mark.` : 'Your first record starts here.'}</strong>{!connected && !loading && <small>LOCAL</small>}</span>}
  </button>;
}

// Each stage's emblem on the card, with its own idle motion (style.css: the sun turns, the leaf sways...).
const EMBLEMS: Record<string, typeof Sun> = { meadow: Sun, dusk: Sunset, amber: Leaf, night: Moon, blossom: Flower2, frost: Snowflake };

// A score this big landing at once (a near miss, a drift, a boost hit) makes the bar surge (see .stage-bar).
const SURGE_POINTS = 120;

// The middle of the driving header: the stage's emblem, the score (`scoreSlot`, drawn by the HUD), the rank (or
// personal best) chase, and the road to the next stage of the world (stages.ts), all in the current stage's
// colours. A new stage, or a new rank, briefly takes over the caption under the bar.
export function LeaderboardChase({ score, scoreSlot, stage, active, busy, visible, open }: {
  score: number; scoreSlot: ReactNode; stage: number; active: boolean; busy: boolean; visible: boolean; open: () => void;
}) {
  const [standing, setStanding] = useState<Standing | null>(null);
  const [online, setOnline] = useState(false);
  // `always`: shown even while other notes are on screen (a new stage).
  const [notice, setNotice] = useState<{ title: string; detail: string; always?: boolean } | null>(null);
  // A big score landing: where the bar was and where it jumped to, for the surge.
  const [surge, setSurge] = useState<{ id: number; from: number; to: number } | null>(null);
  const lastScore = useRef(score);
  const [personalBest] = useState(loadBest);
  const latest = useRef({ score, active });
  latest.current = { score, active };
  const announced = useRef({ stage, rank: Infinity });
  const lastNotice = useRef(0);
  const device = useRef(loadDeviceId());
  useEffect(() => {
    if (!active || !sharedBoard) return;
    let live = true;
    let timer = 0;
    const refresh = async () => {
      const result = await fetchStanding(latest.current.score, device.current);
      if (!live) return;
      setOnline(result !== null);
      setStanding(result);
      timer = window.setTimeout(refresh, 12000);
    };
    void refresh();
    return () => { live = false; window.clearTimeout(timer); };
  }, [active]);
  // A sampled rank only applies until the run crosses the next record or drops
  // below the sampled score. Never invent a position between server responses.
  const rank = score > 0 && online && standing && score >= standing.score && (!standing.next || score <= standing.next.score) ? standing.rank : null;
  // A new stage is always announced, straight away; a new rank waits for a quiet moment.
  useEffect(() => {
    const previous = announced.current;
    if (stage === previous.stage) return;
    const fresh = stage > previous.stage;
    previous.stage = stage;
    if (!fresh || !active) return;
    lastNotice.current = performance.now();
    setNotice({ title: stageAt(stage).title, detail: stageAt(stage).line, always: true });
  }, [stage, active]);
  useEffect(() => {
    if (!active || busy || score <= 0 || performance.now() - lastNotice.current < 18000) return;
    const previous = announced.current;
    if (rank !== null && (rank === 1 && previous.rank > 1 || rank <= 3 && previous.rank > 3 || rank <= 10 && previous.rank > 10) && score >= 100) {
      previous.rank = Math.min(previous.rank, rank);
      lastNotice.current = performance.now();
      setNotice({ title: rank === 1 ? 'CROWN CHASER!' : rank <= 3 ? 'TOP 3!' : 'TOP 10!', detail: `PROJECTED #${rank}` });
    }
  }, [score, rank, active, busy, personalBest, standing]);
  // A big score in one go: the bar surges over the stretch it just gained.
  useEffect(() => {
    const gained = score - lastScore.current;
    const from = stageProgress(lastScore.current), to = stageProgress(score);
    lastScore.current = score;
    if (gained >= SURGE_POINTS && active) setSurge(s => ({ id: (s?.id ?? 0) + 1, from: to >= from ? from : 0, to }));
  }, [score, active]);
  useEffect(() => {
    if (!surge) return;
    const timer = window.setTimeout(() => setSurge(s => (s?.id === surge.id ? null : s)), 1100);
    return () => window.clearTimeout(timer);
  }, [surge]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4400);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const rival = online ? standing?.next : null;
  // The bar: the way through this stage to the next one, about a minute of driving.
  const points = Math.max(0, Math.floor(score));
  const progress = stageProgress(points);
  const toNext = STAGE_POINTS - (points % STAGE_POINTS);
  const current = stageAt(stage), next = stageAt(stage + 1);
  const detail = rival ? `${cleanName(rival.name) || 'NEXT RIVAL'} · ${number(Math.max(0, rival.score + 1 - points))} TO PASS` : online && rank === 1 ? 'HOLD THE CROWN' : personalBest >= points && personalBest > 0 ? `BEAT ${number(personalBest)}` : 'KEEP CLIMBING';
  const showNotice = !!notice && active && (!!notice.always || !busy);
  const badge = online ? rank ? `#${number(rank)}` : '…' : 'PB';
  const Emblem = EMBLEMS[current.id] ?? Sun;
  return <button hidden={!visible} className={`rank-chase${showNotice ? ' celebrating' : ''}${rank === 1 ? ' leading' : ''}${surge ? ' surging' : ''}`} onClick={open}
    style={{ '--stage-accent': current.accent, '--stage-glow': current.glow, '--card-tint': cardLook.tint, '--card-corner': cardLook.corner, '--card-border': cardLook.border } as CSSProperties}
    aria-label={`Score ${number(points)}. Stage: ${current.title.toLowerCase()}. Open leaderboard. ${online ? rank ? `Provisional rank ${rank}.` : 'Updating rank.' : 'Personal best challenge.'} ${number(toNext)} points to the next stage, ${next.title.toLowerCase()}. ${detail}`}>
    <span className="rank-chase-line">
      {/* Keyed by stage: a new stage flips the emblem over to its own, with a ring of light. */}
      <span key={current.id} className={`stage-emblem emblem-${current.id}`} aria-hidden="true"><Emblem /><i className="emblem-ring" /></span>
      <span className="chase-score">{scoreSlot}</span>
      <strong className="rank-position">{rank === 1 ? <Crown size={13} /> : <Trophy size={12} />}{badge}</strong>
    </span>
    <span key={`stage-${stage}`} className="stage-bar" aria-hidden="true">
      <i className="stage-fill" style={{ width: `${progress * 100}%` }} />
      {surge && <i key={surge.id} className="stage-gain" style={{ left: `${surge.from * 100}%`, width: `${Math.max(2, (surge.to - surge.from) * 100)}%` }} />}
      {surge && <i key={`shine-${surge.id}`} className="stage-shine" />}
      <i className="stage-head" style={{ left: `${progress * 100}%` }} />
    </span>
    <span className="rank-chase-detail">
      {showNotice
        ? <span className="rank-shout" key={notice.title}><b>{notice.title}</b> {notice.detail}</span>
        : <><span className="rank-sprint"><b>{number(toNext)}</b> TO <em key={next.id} style={{ color: next.glow }}>{next.title}</em></span><span className="rank-goal">{detail}</span></>}
      <ArrowRight size={11} />
    </span>
    <span className="rank-announcement" role="status" aria-live="polite" aria-atomic="true">{showNotice ? `${notice.title}. ${notice.detail}` : ''}</span>
  </button>;
}
