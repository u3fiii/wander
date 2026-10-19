import { useEffect, useState } from 'react';
import { Clock3, Crown, Route, X } from 'lucide-react';
import { fetchDeviceEntry, fetchTop, sharedBoard } from './game/globalBoard';
import { cleanName, loadBoard, loadDeviceId } from './game/leaderboard';
import type { Entry } from './game/leaderboard';

const number = (n: number) => Math.round(n).toLocaleString('en-US');
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// The first three runs get full podium cards with the same distance and time details as the remaining seven.
// Empty places keep the stage visible while scores load. `highlight` marks the player's new rank.
export function Podium({ board, highlight = -1, personal = null }: { board: Entry[]; highlight?: number; personal?: Entry | null }) {
  const deviceId = loadDeviceId();
  const personalOutsideBoard = personal && !board.some(entry => entry.deviceId === personal.deviceId) ? personal : null;
  const place = (rank: number) => {
    const entry = board[rank];
    const mine = rank === highlight || (!!entry && entry.deviceId === deviceId);
    return <div key={rank} className={`podium-place p${rank + 1}${entry ? '' : ' empty'}${mine ? ' mine' : ''}`}>
      <div className="podium-block">
        <div className="podium-top"><span className="podium-rank">{String(rank + 1).padStart(2, '0')}</span>{rank === 0 && <Crown className={`podium-crown${entry ? '' : ' waiting'}`} />}</div>
        <span className="podium-name" title={entry ? cleanName(entry.name) : undefined}>{entry ? <span className="podium-name-text">{cleanName(entry.name)}</span> : <i className="skeleton-line skeleton-name" aria-hidden="true" />}{mine && <em className="board-you">YOU</em>}</span>
        <div className="podium-points" aria-label={entry ? `${number(entry.score)} points` : 'Score pending'}><b className="podium-score">{entry ? number(entry.score) : <i className="skeleton-line skeleton-score" aria-hidden="true" />}</b></div>
        <div className="podium-stats">
          <div title="Distance"><Route aria-hidden="true" /><b>{entry ? `${number(entry.distance)} m` : '—'}</b></div>
          <div title="Time"><Clock3 aria-hidden="true" /><b>{entry ? clock(entry.seconds) : '—'}</b></div>
        </div>
      </div>
    </div>;
  };
  return <div className="podium-board">
    <div className="podium-arena"><div className="podium" aria-label="Top three scores">{[1, 0, 2].map(place)}</div></div>
    <ol className="podium-rest" start={4}>
      {Array.from({ length: 7 }, (_, index) => index + 3).map(rank => {
        const entry = board[rank];
        const mine = rank === highlight || (!!entry && entry.deviceId === deviceId);
        return <li key={rank} className={`${entry ? '' : 'empty'}${mine ? ' mine' : ''}`}>
          <span className="board-rank">{rank + 1}</span>
          <span className="board-name"><strong>{entry ? <><span className="board-name-text">{cleanName(entry.name)}</span>{mine && <em className="board-you">YOU</em>}</> : <i className="skeleton-line skeleton-name" aria-hidden="true" />}</strong>{entry && <small>{number(entry.distance)} m <i>·</i> {clock(entry.seconds)}</small>}</span>
          <span className="board-score">{entry ? number(entry.score) : <i className="skeleton-line skeleton-score" aria-hidden="true" />}</span>
        </li>;
      })}
      {personalOutsideBoard && <li className="mine personal-outside-topten">
        <span className="board-rank">YOU</span>
        <span className="board-name"><strong><span className="board-name-text">{cleanName(personalOutsideBoard.name)}</span></strong><small>{number(personalOutsideBoard.distance)} m <i>·</i> {clock(personalOutsideBoard.seconds)}</small></span>
        <span className="board-score">{number(personalOutsideBoard.score)}</span>
      </li>}
    </ol>
  </div>;
}

// The leaderboard card, from the header's trophy button. Always open on the shared board so a missing
// connection cannot be mistaken for a leaderboard shared between players.
export default function Leaderboard({ close }: { close: () => void }) {
  const [view, setView] = useState<'everyone' | 'device'>('everyone');
  const [everyone, setEveryone] = useState<Entry[] | null>(null);
  const [personal, setPersonal] = useState<Entry | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!sharedBoard) return;
    fetchTop().then(top => (top ? setEveryone(top) : setFailed(true)));
    fetchDeviceEntry().then(setPersonal);
  }, []);
  const local = loadBoard();
  const board = view === 'everyone' ? everyone ?? [] : local;
  return <div className="modal-shade leaderboard-shade" onClick={close}><section className="modal leaderboard" role="dialog" aria-modal="true" aria-labelledby="board-title" onClick={event => event.stopPropagation()}>
    <button className="close-button" autoFocus aria-label="Close the leaderboard" onClick={close}><X size={18} /></button>
    <h2 id="board-title">Top ten<span>Three places on the podium. One at the top.</span></h2>
    <div className="board-tabs" role="tablist">
      <button role="tab" aria-selected={view === 'everyone'} className={view === 'everyone' ? 'on' : ''} onClick={() => setView('everyone')}>Everyone</button>
      <button role="tab" aria-selected={view === 'device'} className={view === 'device' ? 'on' : ''} onClick={() => setView('device')}>This device</button>
    </div>
    {view === 'everyone' && !everyone && <p className="board-empty">{!sharedBoard ? 'The shared leaderboard is not connected yet. Only scores on this device are available.' : failed ? 'The shared board could not be reached. Try again in a moment.' : 'Loading shared scores…'}</p>}
    {view === 'device' && board.length === 0 && <p className="board-empty">No runs yet. Three hearts, one road: your first run takes the top spot.</p>}
    <Podium board={board} personal={view === 'everyone' ? personal : local[0] ?? null} />
  </section></div>;
}
