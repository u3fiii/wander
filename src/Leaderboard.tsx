import { useEffect, useState } from 'react';
import { Crown, Trophy, X } from 'lucide-react';
import { fetchTop, sharedBoard } from './game/globalBoard';
import { loadBoard } from './game/leaderboard';
import type { Entry } from './game/leaderboard';

const number = (n: number) => Math.round(n).toLocaleString('en-US');
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// The best five as a podium: first in the middle on the tallest gold block under a little crown, second on silver
// to its left, third on bronze to its right, each with its name and score above; fourth and fifth as rows below.
// Empty places stay as faint placeholders, five spots waiting to be filled. `highlight` (a rank) glows gold.
export function Podium({ board, highlight = -1 }: { board: Entry[]; highlight?: number }) {
  const place = (rank: number) => {
    const entry = board[rank];
    return <div key={rank} className={`podium-place p${rank + 1}${entry ? '' : ' empty'}${rank === highlight ? ' mine' : ''}`}>
      {rank === 0 && entry && <Crown className="podium-crown" />}
      <span className="podium-name">{entry?.name ?? '—'}</span>
      <b className="podium-score">{entry ? number(entry.score) : ''}</b>
      <div className="podium-block"><span>{rank + 1}</span></div>
    </div>;
  };
  return <div className="podium-board">
    <div className="podium">{[1, 0, 2].map(place)}</div>
    <ol className="podium-rest" start={4}>
      {[3, 4].map(rank => {
        const entry = board[rank];
        return <li key={rank} className={`${entry ? '' : 'empty'}${rank === highlight ? ' mine' : ''}`}>
          <span className="board-rank">{rank + 1}</span>
          <span className="board-name">{entry?.name ?? '—'}{entry && <small>{number(entry.distance)} m · {clock(entry.seconds)}</small>}</span>
          <span className="board-score">{entry ? number(entry.score) : ''}</span>
        </li>;
      })}
    </ol>
  </div>;
}

// The leaderboard card, from the header's trophy button. With the shared board set up it shows everyone's top five
// (and "This device" for the runs kept here); without it, or offline, just this device's.
export default function Leaderboard({ close }: { close: () => void }) {
  const [view, setView] = useState<'everyone' | 'device'>(sharedBoard ? 'everyone' : 'device');
  const [everyone, setEveryone] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (sharedBoard) fetchTop().then(top => (top ? setEveryone(top) : setFailed(true))); }, []);
  const local = loadBoard();
  const board = view === 'everyone' ? everyone ?? [] : local;
  return <div className="modal-shade" onClick={close}><section className="modal leaderboard" role="dialog" aria-modal="true" aria-labelledby="board-title" onClick={event => event.stopPropagation()}>
    <button className="close-button" autoFocus aria-label="Close the leaderboard" onClick={close}><X size={18} /></button>
    <span className="eyebrow"><Trophy size={14} /> LEADERBOARD</span>
    <h2 id="board-title">Top five</h2>
    {sharedBoard && <div className="board-tabs" role="tablist">
      <button role="tab" aria-selected={view === 'everyone'} className={view === 'everyone' ? 'on' : ''} onClick={() => setView('everyone')}>Everyone</button>
      <button role="tab" aria-selected={view === 'device'} className={view === 'device' ? 'on' : ''} onClick={() => setView('device')}>This device</button>
    </div>}
    {view === 'everyone' && !everyone && <p className="board-empty">{failed ? 'The shared board could not be reached. Try again in a moment.' : 'Loading the board…'}</p>}
    {(view === 'device' || everyone) && board.length === 0 && <p className="board-empty">No runs yet. Five hearts, one road: your first run takes the top spot.</p>}
    {(view === 'device' || everyone) && <Podium board={board} />}
  </section></div>;
}
