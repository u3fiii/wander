import { useEffect, useRef, useState } from 'react';
import { fetchDeviceEntry, fetchStanding, fetchTop, sharedBoard, submitRun } from './game/globalBoard';
import type { FormEvent } from 'react';
import { ArrowRight, Check, ChevronLeft, Crown, RotateCcw, Route, Timer, Trophy, Wind } from 'lucide-react';
import { addEntry, cleanName, loadBoard, loadDeviceId, loadName, qualifies, saveBoard, saveName } from './game/leaderboard';
import type { Entry, RunStats } from './game/leaderboard';
import Leaderboard from './Leaderboard';
import './RunOver.css';
import EnglishNameInput from './EnglishNameInput';

const number = (n: number) => Math.round(n).toLocaleString('en-US');
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// The end of a run (all hearts gone): the score, big; a "new best" chip when it is one; the run's dashboard; then,
// if the score makes the top ten, a name to put on the board, and the board itself with this run highlighted.
export default function RunOver({ score, newBest, stats, onPlayAgain, onHome }: {
  score: number; newBest: boolean; stats: RunStats; onPlayAgain: () => void; onHome: () => void;
}) {
  // Wait for the shared board before deciding whether this run belongs in its top ten.
  const deviceId = loadDeviceId();
  const [board, setBoard] = useState<Entry[]>(() => sharedBoard ? [] : loadBoard());
  const [step, setStep] = useState<'loading' | 'name' | 'board' | 'saving'>(() => sharedBoard ? 'loading' : qualifies(loadBoard(), score) ? 'name' : 'board');
  const [boardScope, setBoardScope] = useState<'everyone' | 'device'>(sharedBoard ? 'everyone' : 'device');
  const [name, setName] = useState(loadName);
  const [rank, setRank] = useState(-1);
  const saved = useRef(false);
  const mounted = useRef(true);
  const [fullBoard, setFullBoard] = useState(false);
  const [personal, setPersonal] = useState<Entry | null>(() => loadBoard()[0] ?? null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [projectedRank, setProjectedRank] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    if (sharedBoard && score > 0) fetchStanding(score).then(result => { if (live) setProjectedRank(result?.rank ?? null); });
    return () => { live = false; };
  }, [score]);
  useEffect(() => {
    if (!sharedBoard) return;
    Promise.all([fetchTop(), fetchDeviceEntry(deviceId)]).then(([top, personal]) => {
      // Once the run is saved, its own result (with its rank) is what shows.
      if (saved.current || !mounted.current) return;
      const current = top ?? loadBoard();
      const comparison = personal && !current.some(entry => entry.deviceId === deviceId) ? [...current, personal] : current;
      setBoardScope(top ? 'everyone' : 'device');
      setBoard(current);
      setPersonal(personal ?? loadBoard()[0] ?? null);
      // Store a first device record even when it falls outside the visible top ten, so later runs can update it.
      setStep(qualifies(comparison, score, deviceId) || (!personal && score > 0) ? 'name' : 'board');
    });
  }, [score, deviceId]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const driver = cleanName(name);
    if (!driver || saved.current) return;
    const local = addEntry(loadBoard(), { name: driver, score, distance: stats.distance, seconds: stats.seconds, date: Date.now(), deviceId });
    saveBoard(local.board);
    saveName(driver);
    saved.current = true;
    setStep('saving');
    const shared = sharedBoard ? await submitRun({ name: driver, score, distance: stats.distance, seconds: stats.seconds, deviceId }) : null;
    if (!mounted.current) return;
    setPersonal(local.board.find(entry => entry.deviceId === deviceId) ?? null);
    setBoard(shared ? shared.board : local.board);
    setBoardScope(shared ? 'everyone' : 'device');
    setRank(shared ? shared.rank : local.rank);
    setStep('board');
  };
  // Three numbers that tell the run: how far, how long, how many cars it slipped past.
  const tiles = [
    { icon: <Route />, value: `${number(stats.distance)} m`, label: 'Distance' },
    { icon: <Timer />, value: clock(stats.seconds), label: 'Time' },
    { icon: <Wind />, value: number(stats.nearMisses), label: 'Near misses' },
  ];
  const bestEntry = personal ?? board.find(entry => entry.deviceId === deviceId);
  const gap = bestEntry ? Math.max(0, bestEntry.score - score) : 0;
  const records = boardScope === 'everyone' ? board.slice(0, 3) : bestEntry ? [bestEntry] : [];
  const saving = step === 'saving';
  return <>
    <div className="results-shade" hidden={fullBoard}>
      <section className={`results-card${newBest ? ' record-run' : ''}`} role="dialog" aria-modal="true" aria-labelledby="run-over-title">
        <header className="results-heading"><span><span className="results-flag" aria-hidden="true" /> RUN COMPLETE</span><span className="results-brand">Wander<span>.</span></span></header>
        <div className="results-body">
          <div className="results-performance">
            <div className="results-medal" aria-hidden="true">{newBest ? <Crown /> : <Trophy />}</div>
            <h2 id="run-over-title">{newBest ? 'NEW BEST!' : 'WHAT A RIDE.'}</h2>
            <div className="results-score" aria-label={`${number(score)} points`}><strong>{number(score)}</strong><span>POINTS</span></div>
            <div className="results-stats">{tiles.map(tile => <div key={tile.label}>{tile.icon}<strong>{tile.value}</strong><span>{tile.label}</span></div>)}</div>
          </div>
          <aside className="results-records" aria-label="Run records">
            <div className="results-section-title"><Trophy size={15} /><h3>{boardScope === 'everyone' ? 'THE CHASE' : 'YOUR RECORD'}</h3><span>{boardScope === 'everyone' ? 'GLOBAL' : 'LOCAL'}</span></div>
            {step === 'loading' ? <div className="results-status" role="status">Finding your rivals<span className="results-loading" aria-hidden="true">…</span></div> : <>
              {records.length > 0 ? <ol className="results-record-list">{records.map((entry, index) => <li key={entry.deviceId} className={`${index === 0 ? 'champion' : ''}${entry.deviceId === deviceId ? ' your-record' : ''}`}>
                <span className="results-place">{index === 0 ? <Crown size={20} /> : `0${index + 1}`}</span>
                <span className="results-driver"><strong>{cleanName(entry.name) || 'Unnamed'}</strong><small>{entry.deviceId === deviceId ? 'YOUR BEST' : index === 0 ? 'THE ONE TO BEAT' : `WORLD #${index + 1}`}</small></span>
                <b>{number(entry.score)}</b>
              </li>)}</ol> : <div className="results-empty"><Crown /><strong>MAKE YOUR MARK.</strong><span>Your first record starts here.</span></div>}
              {step === 'name' ? <form className="results-name" onSubmit={save}>
                <label htmlFor="run-name-input">{boardScope === 'everyone' && projectedRank !== null ? `CLAIM #${number(projectedRank)}` : 'MAKE IT OFFICIAL'}</label>
                <div className="results-name-row"><EnglishNameInput value={name} onChange={setName} /><button type="submit" disabled={!cleanName(name)} aria-label="Save your score">Save <Check size={16} /></button></div>
              </form> : <div className="results-challenge" role="status">
                {saving ? <><span className="results-loading">SAVING…</span><strong>Making your mark.</strong></> : saved.current ? <><span><Check size={13} /> RECORD SAVED</span><strong>{boardScope === 'everyone' && rank >= 0 ? `#${rank + 1}. Keep climbing.` : 'Ready for another?'}</strong></> : <><span>NEXT RUN</span><strong>{gap > 0 ? `${number(gap + 1)} to a new best.` : 'Take the next spot.'}</strong></>}
              </div>}
            </>}
            <div className="results-board-footer"><span title={boardScope === 'device' ? 'Scores are saved on this device. The shared board is currently unavailable.' : 'Shared leaderboard'}>{boardScope === 'device' ? 'ON THIS DEVICE' : 'WORLD LEADERBOARD'}</span><button onClick={() => setFullBoard(true)}>Leaderboard <ArrowRight size={14} /></button></div>
          </aside>
        </div>
        <footer className="results-actions">
          <button className="results-home" onClick={onHome} disabled={saving}><ChevronLeft size={17} /> Home</button>
          <button className="results-replay" autoFocus={step === 'board'} onClick={onPlayAgain} disabled={saving}>LET’S GO AGAIN <RotateCcw size={20} /></button>
        </footer>
      </section>
    </div>
    {fullBoard && <Leaderboard close={() => setFullBoard(false)} />}
  </>;
}
