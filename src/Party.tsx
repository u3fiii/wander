import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { Crown, Users, X } from 'lucide-react';
import { PARTY, createPlayer, leftBehind, listenToKeys, ranking, sameSlot, slotLabel } from './game/party';
import type { PartyPlayer, PartyRun, Slot } from './game/party';
import { readPadState } from './game/gamepad';
import { playThud } from './game/audio';

// Party mode on screen: the lobby where players join, and while driving the scoreboard, the countdown, the stars
// as they are won, and who won the match. The rules themselves live in game/party.ts; the cars in the scene.

const pads = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()] : []);
// Fresh presses of a pad button (per pad), so holding A doesn't join and then start.
function padPresses() {
  const before = new Map<number, boolean[]>();
  return () => {
    const presses: Array<{ index: number; button: 'a' | 'b' | 'menu' }> = [];
    for (const pad of pads()) {
      if (!pad?.connected) continue;
      const state = readPadState(pad);
      const now = [state.select, state.back, state.menu];
      const was = before.get(pad.index);
      if (was) (['a', 'b', 'menu'] as const).forEach((button, i) => { if (now[i] && !was[i]) presses.push({ index: pad.index, button }); });
      before.set(pad.index, now);
    }
    return presses;
  };
}

const JOIN_HINTS = [
  { keys: ['A'], pad: true, label: 'on a controller' },
  { keys: ['W'], pad: false, label: 'W A S D' },
  { keys: ['↑'], pad: false, label: 'arrow keys' },
];

export function PartyLobby({ onStart, onClose }: { onStart: (players: PartyPlayer[]) => void; onClose: () => void }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const latest = useRef(slots);
  latest.current = slots;
  const actions = useRef({ onStart, onClose });
  actions.current = { onStart, onClose };
  useEffect(() => {
    listenToKeys();
    const join = (slot: Slot) => {
      const list = latest.current;
      if (list.some(item => sameSlot(item, slot)) || list.length >= PARTY.maxPlayers) return;
      playThud(0.4);
      setSlots([...list, slot]);
    };
    const leave = (slot: Slot) => setSlots(list => list.filter(item => !sameSlot(item, slot)));
    const go = () => { if (latest.current.length >= 2) actions.current.onStart(latest.current.map((slot, i) => createPlayer(i, slot))); };
    const key = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const codes: Record<string, () => void> = {
        KeyW: () => join({ kind: 'wasd' }), ArrowUp: () => join({ kind: 'arrows' }),
        KeyS: () => leave({ kind: 'wasd' }), ArrowDown: () => leave({ kind: 'arrows' }),
        Enter: go, Escape: () => actions.current.onClose(),
      };
      if (codes[event.code]) { event.preventDefault(); event.stopImmediatePropagation(); codes[event.code](); }
    };
    // Ahead of the game's own keys (which would start a solo run on W or ↑).
    window.addEventListener('keydown', key, true);
    const pressed = padPresses();
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      for (const press of pressed()) {
        const slot: Slot = { kind: 'pad', index: press.index };
        const joined = latest.current.some(item => sameSlot(item, slot));
        if (press.button === 'a') { if (!joined) join(slot); else go(); }
        if (press.button === 'menu') go();
        if (press.button === 'b') { if (joined) leave(slot); else actions.current.onClose(); }
      }
    };
    frame = requestAnimationFrame(tick);
    return () => { window.removeEventListener('keydown', key, true); cancelAnimationFrame(frame); };
  }, []);

  const players = slots.map((slot, i) => createPlayer(i, slot));
  return <div className="party-lobby" role="dialog" aria-modal="true" aria-labelledby="party-title">
    <section className="party-card">
      <button className="party-close" aria-label="Close party" onClick={onClose}><X /></button>
      <span className="eyebrow"><Users size={14} /> PARTY · ONE SCREEN</span>
      <h2 id="party-title">Everyone on one road</h2>
      <p className="party-rules">One race, all on one road — ram your friends off their line. It ends after {PARTY.matchTime / 60} minutes, or as soon as the last car falls to the bottom of the globe. Whoever is in front then wins.</p>
      <div className="party-slots">
        {Array.from({ length: PARTY.maxPlayers }, (_, i) => {
          const player = players[i];
          return player
            ? <div key={i} className="party-slot joined" style={{ '--player': player.colour } as CSSProperties}>
              <i className="party-car" aria-hidden="true" /><strong>{player.name}</strong><small>{slotLabel(player.slot)}</small>
            </div>
            : <div key={i} className="party-slot empty"><i className="party-car" aria-hidden="true" /><strong>Player {i + 1}</strong><small>Press to join</small></div>;
        })}
      </div>
      <div className="party-join" aria-label="How to join">
        {JOIN_HINTS.map(hint => <span key={hint.label}><span className="keys">{hint.keys.map(k => <kbd key={k} className={`glyph${hint.pad ? ' pad pad-a' : ''}`}>{k}</kbd>)}</span><small>{hint.label}</small></span>)}
      </div>
      <p className="party-horn">Ram a friend to knock them off their line · honk with <span className="keys"><kbd className="glyph">E</kbd><kbd className="glyph wide">Enter</kbd><kbd className="glyph pad pad-x">X</kbd></span></p>
      <button className="primary party-go" disabled={slots.length < 2} onClick={() => onStart(players)}>
        {slots.length < 2 ? `Waiting for ${2 - slots.length} more…` : `Start · ${slots.length} players`}
        {slots.length >= 2 && <span className="party-go-keys keys"><kbd className="glyph wide">Enter</kbd><kbd className="glyph pad pad-menu wide">Menu</kbd></span>}
      </button>
    </section>
  </div>;
}

// A word over a real knock (the scene sends where), in the colour of the one who did it.
const POP_WORDS = ['WHAM!', 'BAM!', 'SMASH!', 'BOOM!', 'CRUNCH!'];
type Pop = { id: number; x: number; y: number; colour: string; word: string; tilt: number };
function PartyPops() {
  const [pops, setPops] = useState<Pop[]>([]);
  useEffect(() => {
    let id = 0;
    const add = (event: Event) => {
      const { x, y, colour } = (event as CustomEvent<{ x: number; y: number; colour: string }>).detail;
      const pop = { id: ++id, x, y, colour, word: POP_WORDS[Math.floor(Math.random() * POP_WORDS.length)], tilt: (Math.random() * 2 - 1) * 10 };
      setPops(list => [...list.slice(-5), pop]);
      window.setTimeout(() => setPops(list => list.filter(item => item.id !== pop.id)), 1100);
    };
    window.addEventListener('party-pop', add);
    return () => window.removeEventListener('party-pop', add);
  }, []);
  return <div className="party-pops" aria-hidden="true">
    {pops.map(pop => <div key={pop.id} className="party-pop big" style={{ left: pop.x, top: pop.y, '--tilt': `${pop.tilt}deg`, '--player': pop.colour } as CSSProperties}>
      <i className="party-burst" /><b>{pop.word}</b>
    </div>)}
  </div>;
}

type Banner = { id: number; kind: 'count' | 'match'; text: string; colour?: string; sub?: string };
const PLACES = ['1st', '2nd', '3rd', '4th'];
const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// The race itself: the countdown, the clock, everyone's place on the road, and at the end (time up, or the last car
// at the bottom of the globe) the order at that moment, with the winner congratulated.
export function PartyHud({ run, paused, onRematch, onLeave }: {
  run: RefObject<PartyRun | null>; paused: boolean; onRematch: () => void; onLeave: () => void;
}) {
  const [, setTick] = useState(0);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [results, setResults] = useState<PartyPlayer[] | null>(null);
  const [left, setLeft] = useState(PARTY.matchTime);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const actions = useRef({ onRematch, onLeave });
  actions.current = { onRematch, onLeave };

  useEffect(() => {
    let id = 0, frame = 0, phase: 'count' | 'race' | 'done' = 'count', count = PARTY.countdown + 1;
    let last = performance.now(), clock = 1.6, time = PARTY.matchTime;
    const show = (b: Omit<Banner, 'id'>) => setBanner({ ...b, id: ++id });
    const pressed = padPresses();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const party = run.current;
      if (!party) return;
      if (phase === 'done') {
        for (const press of pressed()) { if (press.button === 'a' || press.button === 'menu') actions.current.onRematch(); if (press.button === 'b') actions.current.onLeave(); }
        return;
      }
      pressed();
      if (pausedRef.current) return;
      if (phase === 'count') {
        // A beat for the camera to land, then 3 · 2 · 1 · GO.
        clock -= dt;
        if (clock > 0) return;
        clock = 0.75;
        count--;
        if (count > 0) { show({ kind: 'count', text: String(count) }); playThud(0.35); }
        else { show({ kind: 'count', text: 'GO!' }); playThud(0.8); party.frozen = false; phase = 'race'; }
        return;
      }
      const before = Math.ceil(time);
      time = Math.max(0, time - dt);
      if (Math.ceil(time) !== before) {
        setLeft(Math.ceil(time));
        // The last few seconds tick out loud.
        if (time > 0 && time <= 5) playThud(0.4);
      }
      const behind = leftBehind(party.players);
      if (time <= 0 || behind) {
        phase = 'done'; party.frozen = true;
        const order = ranking(party.players);
        setResults(order);
        playThud(1.2);
        show({ kind: 'match', text: `${order[0].name.toUpperCase()} WINS!`, colour: order[0].colour, sub: behind ? `${order[order.length - 1].name} fell to the bottom of the world` : 'Time\'s up' });
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [run]);

  // The countdown's numbers clear themselves; the winner stays.
  useEffect(() => {
    if (!banner || banner.kind === 'match') return;
    const timer = window.setTimeout(() => setBanner(b => (b?.id === banner.id ? null : b)), 700);
    return () => window.clearTimeout(timer);
  }, [banner]);
  // The board re-reads the players a few times a second (the order changes all the time).
  useEffect(() => { const timer = window.setInterval(() => setTick(t => t + 1), 200); return () => window.clearInterval(timer); }, []);

  const party = run.current;
  if (!party) return null;
  const order = ranking(party.players);
  return <>
    <PartyPops />
    <div className="party-board" aria-label="Party scores">
      {party.players.map(player => {
        const place = order.indexOf(player);
        return <div key={player.id} className={`party-chip${place === 0 ? ' leading' : ''}`} style={{ '--player': player.colour } as CSSProperties}>
          {place === 0 ? <Crown className="party-crown" aria-label="In front" /> : <i className="party-dot" aria-hidden="true" />}
          <strong>{player.name}</strong>
          <b className="party-place">{PLACES[place]}</b>
        </div>;
      })}
      <div className={`party-clock${left <= 10 ? ' hurry' : ''}`} aria-label={`${left} seconds left`}>{clockText(left)}</div>
    </div>
    {banner && <div key={banner.id} className={`party-banner ${banner.kind}`} role="status" style={{ '--player': banner.colour ?? '#fff' } as CSSProperties}>
      <strong>{banner.text}</strong>{banner.sub && <small>{banner.sub}</small>}
    </div>}
    {results && <div className="party-final" role="dialog" aria-label="Match over">
      <p className="party-congrats" style={{ '--player': results[0].colour } as CSSProperties}>Congratulations, {results[0].name}! 🎉</p>
      <ol className="party-results">
        {results.map((player, place) => <li key={player.id} style={{ '--player': player.colour } as CSSProperties}>
          <span>{PLACES[place]}</span><i className="party-dot" /><strong>{player.name}</strong>
        </li>)}
      </ol>
      <div className="party-final-buttons">
        <button className="primary" onClick={onRematch}>Play again <span className="keys"><kbd className="glyph pad pad-a">A</kbd></span></button>
        <button className="secondary" onClick={onLeave}>Leave <span className="keys"><kbd className="glyph pad pad-b">B</kbd></span></button>
      </div>
    </div>}
  </>;
}
