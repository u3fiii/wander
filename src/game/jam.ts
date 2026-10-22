// Traffic jams: once the player has learned the shockwave, the road now and then bunches its cars up ahead of them,
// to give the wave something worth firing at (or a wall to be saved from). Until then traffic is left as it was.
//
// - `learnAfter`: waves that threw at least one car before the shockwave counts as learned (kept on the device).
// - `every`: seconds between jams at the least; one only forms while the wave is ready.
// - `ahead`: m ahead of the player (along the road) the jam forms, out of sight past the curve of the globe.
// - `clearance`: m a car must be from the player to be moved into the jam (so none is seen to jump).
// - `size`: cars in it, both ways; `spacing`: m between them along the road (a wave's 7 m catches most of them).
// - `speed`: the crawl they keep (m/s); it breaks up `endPast` m after the player has passed it, or after `maxTime` s.
export const JAM = { learnAfter: 2, every: 25, ahead: 55, clearance: 25, size: 5, spacing: 4.2, speed: 1.5, endPast: 12, maxTime: 30 };

const LEARN_KEY = 'wander:wave-learned';
function storedCount() {
  try { return Number(window.localStorage.getItem(LEARN_KEY)) || 0; } catch { return 0; }
}
let learned = typeof window === 'undefined' ? 0 : storedCount();
export const waveLearned = () => learned >= JAM.learnAfter;
// A wave went off: it counts towards learning only if it caught something.
export function recordWave(cars: number) {
  if (cars <= 0 || waveLearned()) return;
  learned++;
  try { window.localStorage.setItem(LEARN_KEY, String(learned)); } catch { /* storage off: learned for this visit only */ }
}
export const setWaveLearned = (count: number) => { learned = count; };

// The jam on the road now: the cars in it (traffic index → where along the road it was put, 0..1), its centre, how
// long it has stood, and the time since the last one.
export const trafficJam = { id: 0, active: false, centre: 0, time: 0, since: 0, members: new Map<number, number>() };
export function resetJam() { Object.assign(trafficJam, { active: false, time: 0, since: 0 }); trafficJam.members.clear(); }

const wrap = (progress: number) => ((progress % 1) + 1) % 1;
// Signed distance (m) from `from` to `to` along the road, the short way round.
export const along = (from: number, to: number, length: number) => {
  const d = wrap(to - from);
  return (d > 0.5 ? d - 1 : d) * length;
};

// Plans a jam `JAM.ahead` m in front of the player (`player`, road progress 0..1, driving towards higher progress), on
// a road that is `length` m per whole unit of progress where the player is. Only cars far enough from the player move into it; the ones going the player's way come
// first. Returns the cars and where each goes, or nothing if too few are free.
export function planJam(player: number, length: number, cars: { index: number; progress: number; forward: boolean }[]) {
  const centre = wrap(player + JAM.ahead / length);
  const free = cars.filter(car => Math.abs(along(player, car.progress, length)) >= JAM.clearance)
    .sort((a, b) => Number(b.forward) - Number(a.forward));
  if (free.length < 3) return null;
  const chosen = free.slice(0, JAM.size);
  // Laid out round the centre (0, +1, -1, +2, -2 spacings), each in its own lane by its direction, so both lanes fill.
  const members = new Map<number, number>();
  chosen.forEach((car, slot) => {
    const step = slot === 0 ? 0 : Math.ceil(slot / 2) * (slot % 2 ? 1 : -1);
    members.set(car.index, wrap(centre + step * JAM.spacing / length));
  });
  return { centre, members };
}

// One step of the jam's life. `ready`: the wave is ready to fire; `allowed`: driving, with traffic about. Returns a
// plan to start a jam when one should form now (the scene places the cars), otherwise nothing.
export function stepJam(dt: number, player: number, length: number, ready: boolean, allowed: boolean,
  cars: { index: number; progress: number; forward: boolean }[]) {
  const jam = trafficJam;
  jam.since += dt;
  if (jam.active) {
    jam.time += dt;
    if (!allowed || jam.time > JAM.maxTime || along(jam.centre, player, length) > JAM.endPast) { jam.active = false; jam.members.clear(); }
    return null;
  }
  if (!allowed || !ready || !waveLearned() || jam.since < JAM.every) return null;
  const plan = planJam(player, length, cars);
  if (!plan) return null;
  Object.assign(jam, { id: jam.id + 1, active: true, centre: plan.centre, time: 0, since: 0 });
  jam.members = plan.members;
  return plan;
}
