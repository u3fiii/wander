import { useEffect, useState } from 'react';
import { Clock3, Crown, Route, Trophy, X } from 'lucide-react';
import { fetchDeviceEntry, fetchTop, sharedBoard } from './game/globalBoard';
import { cleanName, loadBoard, loadDeviceId } from './game/leaderboard';
import type { Entry } from './game/leaderboard';

const number = (n: number) => Math.round(n).toLocaleString('en-US');
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// The board as games show it, in one column: a stepped podium for the first three (second, first, third, the
// winner's step tallest, with a crown), each with a medal-ringed avatar, name and score above the step; places four
// to ten as a short list; and the player's own row pinned at the bottom, always in sight, even outside the ten.
// Empty places keep the podium's shape while scores load. `highlight` marks the player's new rank.
export function Podium({ board, highlight = -1, personal = null }: { board: Entry[]; highlight?: number; personal?: Entry | null }) {
  const deviceId = loadDeviceId();
  const isMine = (rank: number) => rank === highlight || (!!board[rank] && board[rank].deviceId === deviceId);
  const mineInTen = board.slice(0, 10).some((_, rank) => isMine(rank));
  const pinned = !mineInTen && personal ? personal : null;
  const step = (rank: number) => {
    const entry = board[rank], mine = isMine(rank), name = entry ? cleanName(entry.name) || 'Unnamed' : '';
    return <div key={rank} className={`lb-step s${rank + 1}${entry ? '' : ' empty'}${mine ? ' mine' : ''}`}>
      <div className="lb-player">
        {rank === 0 && <Crown className="lb-crown" aria-hidden="true" />}
        <span className="lb-avatar" aria-hidden="true">{entry ? name[0].toUpperCase() : ''}</span>
        <strong title={name}>{entry ? name : <i className="skeleton-line skeleton-name" aria-hidden="true" />}</strong>
        <b>{entry ? number(entry.score) : '—'}</b>
        {mine && <em className="board-you">YOU</em>}
      </div>
      <div className="lb-block">
        <span className="lb-place">{rank + 1}</span>
        {entry && <small><Route aria-hidden="true" />{number(entry.distance)} m · <Clock3 aria-hidden="true" />{clock(entry.seconds)}</small>}
      </div>
    </div>;
  };
  const row = (rank: number) => {
    const entry = board[rank], mine = isMine(rank);
    return <li key={rank} className={`lb-row${entry ? '' : ' empty'}${mine ? ' mine' : ''}`}>
      <span className="lb-rank">{rank + 1}</span>
      <span className="lb-name"><strong>{entry ? cleanName(entry.name) || 'Unnamed' : <i className="skeleton-line skeleton-name" aria-hidden="true" />}{mine && <em className="board-you">YOU</em>}</strong>
        {entry && <small>{number(entry.distance)} m · {clock(entry.seconds)}</small>}</span>
      <span className="lb-score">{entry ? number(entry.score) : ''}</span>
    </li>;
  };
  return <div className="lb-board">
    <div className="lb-podium" aria-label="Top three scores">{[1, 0, 2].map(step)}</div>
    <ol className="lb-list" start={4}>{Array.from({ length: 7 }, (_, index) => row(index + 3))}</ol>
    {pinned && <div className="lb-row mine lb-pinned">
      <span className="lb-rank">YOU</span>
      <span className="lb-name"><strong>{cleanName(pinned.name) || 'You'}</strong><small>{number(pinned.distance)} m · {clock(pinned.seconds)}</small></span>
      <span className="lb-score">{number(pinned.score)}</span>
    </div>}
  </div>;
}

// Dev only: `?boardDemo` in the address fills the board with made-up runs (yours at 5th), to look at its design.
const BOARD_DEMO: Entry[] | null = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('boardDemo')
  ? ([['Sara', 12161, 8529, 599], ['Ali', 7139, 2327, 161], ['Reza', 5787, 4010, 280], ['Mohammad', 4968, 4065, 318], ['You', 4293, 3099, 233],
    ['Patt', 4153, 2810, 222], ['Nima', 3936, 2748, 172], ['Lea', 3602, 3121, 232], ['Omid', 3596, 2889, 208], ['Usof', 3474, 2551, 222]] as const)
    .map(([name, score, distance, seconds], index) => ({ name, score, distance, seconds, date: index, deviceId: index === 4 ? loadDeviceId() : `demo-${index}` }))
  : null;

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
  const board = BOARD_DEMO ?? (view === 'everyone' ? everyone ?? [] : local);
  return <div className="modal-shade leaderboard-shade" onClick={close}><section className="modal leaderboard lb" role="dialog" aria-modal="true" aria-labelledby="board-title" onClick={event => event.stopPropagation()}>
    <button className="close-button" autoFocus aria-label="Close the leaderboard" onClick={close}><X size={18} /></button>
    <span className="lb-eyebrow"><Trophy size={14} /> LEADERBOARD</span>
    <h2 id="board-title">Top ten</h2>
    <div className="board-tabs" role="tablist">
      <button role="tab" aria-selected={view === 'everyone'} className={view === 'everyone' ? 'on' : ''} onClick={() => setView('everyone')}>Everyone</button>
      <button role="tab" aria-selected={view === 'device'} className={view === 'device' ? 'on' : ''} onClick={() => setView('device')}>This device</button>
    </div>
    {view === 'everyone' && !everyone && !BOARD_DEMO && <p className="board-empty">{!sharedBoard ? 'The shared leaderboard is not connected yet. Only scores on this device are available.' : failed ? 'The shared board could not be reached. Try again in a moment.' : 'Loading shared scores…'}</p>}
    {view === 'device' && board.length === 0 && <p className="board-empty">No runs yet. Three hearts, one road: your first run takes the top spot.</p>}
    <Podium board={board} personal={view === 'everyone' ? personal : local[0] ?? null} />
  </section></div>;
}
