import { useState } from 'react';
import type { FormEvent } from 'react';
import { ChevronLeft, RotateCcw, Route, Timer, Trophy, Wind } from 'lucide-react';
import { addEntry, cleanName, loadBoard, loadName, qualifies, saveBoard, saveName } from './game/leaderboard';
import type { Entry, RunStats } from './game/leaderboard';
import { Podium } from './Leaderboard';

const number = (n: number) => Math.round(n).toLocaleString('en-US');
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// The end of a run (all hearts gone): the score, big; a "new best" chip when it is one; the run's dashboard; then,
// if the score makes the top five, a name to put on the board, and the board itself with this run highlighted.
export default function RunOver({ score, newBest, stats, onPlayAgain, onHome }: {
  score: number; newBest: boolean; stats: RunStats; onPlayAgain: () => void; onHome: () => void;
}) {
  const [board, setBoard] = useState<Entry[]>(loadBoard);
  const [step, setStep] = useState<'name' | 'board'>(() => (qualifies(loadBoard(), score) ? 'name' : 'board'));
  const [name, setName] = useState(loadName);
  const [rank, setRank] = useState(-1);
  const save = (event: FormEvent) => {
    event.preventDefault();
    const driver = cleanName(name);
    const result = addEntry(board, { name: driver, score, distance: stats.distance, seconds: stats.seconds, date: Date.now() });
    saveBoard(result.board);
    saveName(driver);
    setBoard(result.board);
    setRank(result.rank);
    setStep('board');
  };
  // Three numbers that tell the run: how far, how long, how many cars it slipped past.
  const tiles = [
    { icon: <Route />, value: `${number(stats.distance)} m`, label: 'Distance' },
    { icon: <Timer />, value: clock(stats.seconds), label: 'Time' },
    { icon: <Wind />, value: number(stats.nearMisses), label: 'Near misses' },
  ];
  return <div className="modal-shade"><section className="modal run-over" role="dialog" aria-modal="true" aria-labelledby="run-over-title">
    <span className="eyebrow">RUN OVER</span>
    <h2 id="run-over-title" className="run-score">{number(score)}</h2>
    {newBest && <span className="run-best">New best!</span>}
    <div className="run-stats">{tiles.map(tile => <div key={tile.label}>{tile.icon}<b>{tile.value}</b><small>{tile.label}</small></div>)}</div>
    {step === 'name'
      ? <form className="run-name" onSubmit={save}>
        <label htmlFor="run-name-input"><Trophy size={15} /> You made the leaderboard</label>
        <div className="run-name-row">
          <input id="run-name-input" autoFocus maxLength={16} placeholder="Your name" value={name} onChange={event => setName(event.target.value)} />
          <button type="submit" className="primary">Save</button>
        </div>
      </form>
      : <>
        <Podium board={board} highlight={rank} />
        <button autoFocus className="primary" onClick={onPlayAgain}>Play again <RotateCcw size={18} /></button>
        <div className="modal-row"><button className="secondary" onClick={onHome}><ChevronLeft size={15} /> Home</button></div>
      </>}
  </section></div>;
}
