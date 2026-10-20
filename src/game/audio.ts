import { JUICE_CONFIG } from './config.ts';
import { createEngineState, stepEngine } from './engineModel.ts';
import { nightAmount } from './dayCycle.ts';
import slowMoWhooshUrl from '../assets/sound/alexis_gaming_cam-woosh-saber-laser-346099.mp3?url';
import ambienceUrl from '../assets/sound/soundreality-wind-blowing-457954.mp3?url';
import seaUrl from '../assets/sound/freesound_community-sea-and-seagull-wave-5932.mp3?url';
import planeUrl from '../assets/sound/loswin23-small-airplane-520026.mp3?url';

// Car audio on the Web Audio API. Layers, all feeding one master gain (and, for the world's sounds, a low-pass
// that closes in slow motion):
// - engine: a looped recording whose playback rate follows a fake rpm (see engineModel.ts: quick to rise, slow
//   to fall, a 5-gear gearbox with a dip on each shift, a pitch bump on boost), plus a "load" loop on top whose
//   volume follows the throttle, so pressing on sounds different from coasting;
// - wind: looped noise through a low-pass; louder and brighter with speed;
// - tyres: band-passed noise while drifting or braking hard;
// - off-road: a gravel/rumble loop while off the road;
// - one-shots: boost whoosh, landing thud, engine start, the slow-motion whoosh (near misses), boost ready.
// Every level and rate moves with setTargetAtTime (no clicks or zipper noise). Sound files are read from
// /public/audio (see FILES); any that are missing fall back to synthesised sound, and without an engine file the
// old oscillator engine plays. All the values below are live in the debug panel (` key), folder "Audio".
export const AUDIO_CONFIG = {
  master: 0.35,
  smoothing: 0.06,
  // Engine
  engineVolume: 0.5, engineThrottleVolume: 0.3, rpmIdleRate: 0.7, rpmMaxRate: 1.9, rpmRise: 7, rpmFall: 1.6,
  revInPlace: 0.55, coastRpm: 0.75, loadVolume: 0.35, loadRateRatio: 1,
  gears: 5, gearSpread: 0.85, shiftDrop: 0.35, shiftTime: 0.22, shiftDip: 0.5,
  // Other layers
  // Wind, off-road and thud are off by default (the mix stays simple); raise them here to bring them in.
  windVolume: 0, windMinHz: 200, windMaxHz: 1100,
  tireVolume: 0.06, tireHz: 1700, tireQ: 3, hardBrakeAccel: 9,
  offroadVolume: 0, offroadHz: 320,
  // The simple synthesised engine (used while there is no engine file): its volume, how much saw "body" it has
  // (harmonics that make it sound thick, even on small speakers) and how strongly it putters (a pulse at the
  // firing rate, the "brrr" of an engine).
  synthVolume: 0.055, engineBody: 0.7, engineRumble: 0.4,
  // How low the engine sits (× its pitch) and how much grit (soft saturation) it has.
  enginePitch: 1, engineGrit: 0.15,
  boostVolume: 0.2, boostPitchBump: 0.25, boostBumpTime: 0.6,
  thudVolume: 0.16,
  // Ramming a car under boost.
  impactVolume: 0.08,
  // The far-off birds by day. Kept very quiet: the site is meant to be calm.
  natureVolume: 0.5,
  // Ambience: a soft wind over the whole map, always there and barely heard.
  ambienceVolume: 0.045,
  // The sea (waves and gulls), heard only near the water, and very quietly.
  seaVolume: 0.06,
  // The little plane, heard when it flies near the camera.
  planeVolume: 0.12,
  startVolume: 0.25, slowMoWhooshVolume: 0.2, slowMoMuffleHz: 650, slowMoPitchDrop: 0.45,
  // Seconds trimmed from both ends of a loop (MP3 files carry a little silence there).
  loopTrim: 0.03,
};
type AudioKey = keyof typeof AUDIO_CONFIG;
export const AUDIO_RANGES: Record<AudioKey, [number, number, number]> = {
  master: [0, 1, 0.01], smoothing: [0.01, 0.3, 0.01],
  engineVolume: [0, 1.5, 0.01], engineThrottleVolume: [0, 1, 0.01], rpmIdleRate: [0.3, 1.5, 0.01], rpmMaxRate: [1, 3, 0.01],
  rpmRise: [0.5, 20, 0.1], rpmFall: [0.2, 10, 0.1], revInPlace: [0, 1, 0.01], coastRpm: [0, 1, 0.01],
  loadVolume: [0, 1.5, 0.01], loadRateRatio: [0.5, 2, 0.01],
  gears: [1, 6, 1], gearSpread: [0.4, 1.5, 0.01], shiftDrop: [0, 0.8, 0.01], shiftTime: [0, 0.8, 0.01], shiftDip: [0, 1, 0.01],
  windVolume: [0, 1, 0.01], windMinHz: [50, 2000, 10], windMaxHz: [300, 8000, 10],
  tireVolume: [0, 1, 0.01], tireHz: [300, 5000, 10], tireQ: [0.3, 10, 0.1], hardBrakeAccel: [2, 30, 0.5],
  offroadVolume: [0, 1, 0.01], offroadHz: [80, 2000, 10],
  synthVolume: [0, 0.4, 0.005], engineBody: [0, 1, 0.01], engineRumble: [0, 1, 0.01], enginePitch: [0.5, 1.5, 0.01], engineGrit: [0, 1, 0.01],
  boostVolume: [0, 1, 0.01], boostPitchBump: [0, 1, 0.01], boostBumpTime: [0.1, 2, 0.05],
  thudVolume: [0, 1, 0.01], impactVolume: [0, 1.5, 0.01], natureVolume: [0, 1.5, 0.01], ambienceVolume: [0, 0.4, 0.005], seaVolume: [0, 0.4, 0.005], planeVolume: [0, 0.6, 0.005],
  startVolume: [0, 1, 0.01], slowMoWhooshVolume: [0, 1, 0.01], slowMoMuffleHz: [200, 5000, 10], slowMoPitchDrop: [0, 0.9, 0.01],
  loopTrim: [0, 0.2, 0.005],
};

// Sound files, by name, in /public/audio. Each can be .mp3, .ogg, .wav or .m4a (tried in that order).
const FILES = ['engine', 'engine-load', 'engine-start', 'offroad', 'boost', 'thud'] as const;
type FileName = typeof FILES[number];
const EXTENSIONS = ['mp3', 'ogg', 'wav', 'm4a'];
const buffers: Partial<Record<FileName | 'slowmo' | 'ambience' | 'sea' | 'plane', AudioBuffer>> = {};

// Decoded ahead of time (an offline context needs no user gesture), so they are ready when the drive starts.
const decode = (url: string) => fetch(url)
  .then(response => (response.ok && !(response.headers.get('content-type') ?? '').includes('text/html') ? response.arrayBuffer() : Promise.reject(new Error('missing'))))
  .then(data => new OfflineAudioContext(1, 1, 44100).decodeAudioData(data));
async function load(name: FileName) {
  for (const extension of EXTENSIONS) {
    try { buffers[name] = await decode(`${import.meta.env.BASE_URL}audio/${name}.${extension}`); return; } catch { /* try the next */ }
  }
}
if (typeof window !== 'undefined' && typeof OfflineAudioContext !== 'undefined') {
  Promise.all(FILES.map(load)).then(() => { if (graph) buildLoops(); });
  decode(slowMoWhooshUrl).then(buffer => { buffers.slowmo = trimmed(buffer, 0.25, 2.2); if (graph) buildLoops(); }).catch(() => undefined);
  decode(ambienceUrl).then(buffer => { buffers.ambience = seamless(buffer, 2); if (graph) buildLoops(); }).catch(() => undefined);
  decode(seaUrl).then(buffer => { buffers.sea = seamless(buffer, 3); if (graph) buildLoops(); }).catch(() => undefined);
  decode(planeUrl).then(buffer => { buffers.plane = seamless(buffer, 3); if (graph) buildLoops(); }).catch(() => undefined);
}
// A piece of a recording, with a short fade at the end.
function trimmed(source: AudioBuffer, from: number, to: number) {
  const rate = source.sampleRate, start = Math.floor(from * rate);
  const out = new AudioBuffer({ numberOfChannels: source.numberOfChannels, length: Math.floor((to - from) * rate), sampleRate: rate });
  for (let c = 0; c < source.numberOfChannels; c++) {
    const input = source.getChannelData(c), output = out.getChannelData(c);
    for (let i = 0; i < output.length; i++) output[i] = (input[start + i] ?? 0) * Math.min(1, (output.length - i) / (0.25 * rate));
  }
  return out;
}

// A whole recording made to loop without a seam: its last `fade` seconds are crossfaded into its start.
function seamless(source: AudioBuffer, fade: number) {
  const rate = source.sampleRate, overlap = Math.min(Math.floor(fade * rate), Math.floor(source.length / 3));
  const out = new AudioBuffer({ numberOfChannels: source.numberOfChannels, length: source.length - overlap, sampleRate: rate });
  for (let c = 0; c < source.numberOfChannels; c++) {
    const input = source.getChannelData(c), output = out.getChannelData(c);
    for (let i = 0; i < output.length; i++) {
      if (i >= overlap) { output[i] = input[i]; continue; }
      const t = i / overlap;
      output[i] = input[i] * Math.sqrt(t) + input[source.length - overlap + i] * Math.sqrt(1 - t);
    }
  }
  return out;
}

type Loop = { source: AudioBufferSourceNode; gain: GainNode };
type Graph = {
  context: AudioContext; master: GainNode; world: BiquadFilterNode; noise: AudioBuffer;
  // Fallback engine (when there is no engine file): the original simple one (a triangle and a sine an octave
  // below through a soft low-pass), thickened by a saw and given a putter by a pulse at the firing rate.
  oscA: OscillatorNode; oscB: OscillatorNode; oscFilter: BiquadFilterNode; oscGain: GainNode;
  oscBody: OscillatorNode; bodyGain: GainNode; putter: OscillatorNode; putterDepth: GainNode; grit: WaveShaperNode; weight: BiquadFilterNode;
  wind: { filter: BiquadFilterNode; gain: GainNode };
  tires: { filter: BiquadFilterNode; gain: GainNode };
  rumble: { filter: BiquadFilterNode; gain: GainNode };
  engine?: Loop; load?: Loop; offroad?: Loop; ambience?: Loop; sea?: Loop; plane?: Loop;
};
let graph: Graph | null = null;
let muted = true;
const engine = createEngineState();
// Frames can stop without warning (tab hidden, window minimised, scene unmounted). If updates stop arriving,
// the continuous layers fade out instead of droning on at their last level.
const STALL_SILENCE_MS = 300;
let lastUpdate = 0;
let lastFrame = 0;

// Move an AudioParam toward a value, dropping anything scheduled earlier so per-frame updates don't stack up.
function glide(param: AudioParam, value: number, now: number, timeConstant = AUDIO_CONFIG.smoothing) {
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
  else { param.cancelScheduledValues(now); param.setValueAtTime(param.value, now); }
  param.setTargetAtTime(value, now, timeConstant);
}
function noiseBuffer(context: BaseAudioContext) {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
function noiseLayer(context: AudioContext, noise: AudioBuffer, type: BiquadFilterType, destination: AudioNode) {
  const source = context.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = type;
  const gain = context.createGain();
  gain.gain.value = 0;
  source.connect(filter).connect(gain).connect(destination);
  source.start();
  return { filter, gain };
}
function loop(buffer: AudioBuffer, destination: AudioNode): Loop {
  const { context } = graph!;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.loopStart = Math.min(AUDIO_CONFIG.loopTrim, buffer.duration / 4);
  source.loopEnd = Math.max(source.loopStart + 0.05, buffer.duration - AUDIO_CONFIG.loopTrim);
  const gain = context.createGain();
  gain.gain.value = 0;
  source.connect(gain).connect(destination);
  source.start(0, source.loopStart);
  return { source, gain };
}
function buildLoops() {
  if (!graph) return;
  if (buffers.engine && !graph.engine) graph.engine = loop(buffers.engine, graph.world);
  // Without a load file the load layer reuses the engine recording, a little higher.
  const loadBuffer = buffers['engine-load'] ?? buffers.engine;
  if (loadBuffer && !graph.load) graph.load = loop(loadBuffer, graph.world);
  if (buffers.offroad && !graph.offroad) graph.offroad = loop(buffers.offroad, graph.world);
  if (buffers.plane && !graph.plane) {
    graph.plane = loop(buffers.plane, graph.world);
    graph.plane.source.loopStart = 0;
    graph.plane.source.loopEnd = buffers.plane.duration;
  }
  if (buffers.sea && !graph.sea) {
    graph.sea = loop(buffers.sea, graph.world);
    graph.sea.source.loopStart = 0;
    graph.sea.source.loopEnd = buffers.sea.duration;
  }
  if (buffers.ambience && !graph.ambience) {
    graph.ambience = loop(buffers.ambience, graph.world);
    graph.ambience.source.loopStart = 0;
    graph.ambience.source.loopEnd = buffers.ambience.duration;
  }
}

function silence() {
  if (!graph) return;
  const now = graph.context.currentTime;
  for (const gain of [graph.oscGain, graph.wind.gain, graph.tires.gain, graph.rumble.gain, graph.engine?.gain, graph.load?.gain, graph.offroad?.gain, graph.ambience?.gain, graph.sea?.gain, graph.plane?.gain]) if (gain) glide(gain.gain, 0, now, 0.08);
}

// Starts the audio graph; call from a user gesture (browsers only allow sound after one).
export function startAudio() {
  if (graph || !JUICE_CONFIG.soundEnabled || typeof AudioContext === 'undefined') {
    graph?.context.resume();
    return;
  }
  const context = new AudioContext();
  const master = context.createGain();
  master.gain.value = muted ? 0 : AUDIO_CONFIG.master;
  master.connect(context.destination);
  const world = context.createBiquadFilter();
  world.type = 'lowpass';
  world.frequency.value = 18000;
  world.connect(master);
  const noise = noiseBuffer(context);

  // The synthesised engine: a low, warm, calm but weighty rumble (think of a big engine idling).
  // - Body: two sawtooths a few cents apart (a wide, rich tone) plus a sine sub an octave down (felt on
  //   headphones), through a gently resonant low-pass that opens under throttle and closes off it.
  // - Weight: a peaking boost on the second harmonic, so the bass is heard even on laptop and phone speakers, and
  //   a soft compressor that keeps the sound full and even.
  // - Burble: a smooth, rounded pulse at the firing rate (a sine on the level), not a choppy stutter.
  // - Grit: a touch of soft saturation for texture.
  const oscFilter = context.createBiquadFilter();
  oscFilter.type = 'lowpass';
  oscFilter.frequency.value = 220;
  oscFilter.Q.value = 2.2;
  const weight = context.createBiquadFilter();
  weight.type = 'peaking';
  weight.Q.value = 1.1;
  weight.gain.value = 13;
  const grit = context.createWaveShaper();
  grit.oversample = '2x';
  const pulse = context.createGain();
  pulse.gain.value = 1;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -26; compressor.knee.value = 18; compressor.ratio.value = 4;
  compressor.attack.value = 0.01; compressor.release.value = 0.2;
  const oscGain = context.createGain();
  oscGain.gain.value = 0;
  // More low end: a low shelf under everything.
  const lows = context.createBiquadFilter();
  lows.type = 'lowshelf';
  lows.frequency.value = 160;
  lows.gain.value = 9;
  oscFilter.connect(lows).connect(weight).connect(grit).connect(pulse).connect(compressor).connect(oscGain).connect(world);
  const oscA = context.createOscillator(), oscB = context.createOscillator(), oscBody = context.createOscillator();
  oscA.type = 'sawtooth'; oscBody.type = 'sawtooth'; oscB.type = 'sine';
  oscBody.detune.value = 12;
  const bodyGain = context.createGain();
  bodyGain.gain.value = 0;
  const subGain = context.createGain();
  subGain.gain.value = 1.8;
  oscA.connect(oscFilter); oscBody.connect(bodyGain).connect(oscFilter); oscB.connect(subGain).connect(oscFilter);
  const putter = context.createOscillator();
  putter.type = 'sine';
  const putterDepth = context.createGain();
  putterDepth.gain.value = 0;
  putter.connect(putterDepth).connect(pulse.gain);
  [oscA, oscB, oscBody, putter].forEach(oscillator => oscillator.start());

  graph = {
    context, master, world, noise, oscA, oscB, oscFilter, oscGain, oscBody, bodyGain, putter, putterDepth, grit, weight,
    wind: noiseLayer(context, noise, 'lowpass', world),
    tires: noiseLayer(context, noise, 'bandpass', world),
    rumble: noiseLayer(context, noise, 'lowpass', world),
  };
  buildLoops();
  window.setInterval(() => { if (performance.now() - lastUpdate > STALL_SILENCE_MS) silence(); }, 150);
  document.addEventListener('visibilitychange', () => {
    if (!graph) return;
    if (document.hidden) { silence(); graph.context.suspend(); } else graph.context.resume();
  });
}

export function setMuted(value: boolean) {
  muted = value;
  if (graph) glide(graph.master.gain, value ? 0 : AUDIO_CONFIG.master, graph.context.currentTime, 0.05);
}

// The grit curve: tanh saturation, `amount` 0 (clean) to 1 (rough), rebuilt only when it changes.
let gritAmount = -1;
function setGrit(shaper: WaveShaperNode, amount: number) {
  if (Math.abs(amount - gritAmount) < 0.005) return;
  gritAmount = amount;
  const drive = 1 + amount * 9, curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(x * drive) / Math.tanh(drive); }
  shaper.curve = curve;
}

// One-shot from a file, or the synthesised fallback.
function oneShot(buffer: AudioBuffer | undefined, volume: number, fallback: () => void, rate = 1) {
  if (!graph || muted) return;
  if (!buffer) { fallback(); return; }
  const { context, master } = graph;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  const gain = context.createGain();
  gain.gain.value = volume;
  source.connect(gain).connect(master);
  source.start();
}

// Synthesised whoosh: a band-passed noise sweep. Used for the red slow motion, and for boost without a file.
export function playWhoosh(volume = JUICE_CONFIG.whooshVolume) {
  if (!graph || muted) return;
  const { context, master, noise } = graph;
  const source = context.createBufferSource();
  source.buffer = noise;
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.2;
  const gain = context.createGain();
  const now = context.currentTime;
  filter.frequency.setValueAtTime(400, now);
  filter.frequency.exponentialRampToValueAtTime(2200, now + 0.6);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.08);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
  source.connect(filter).connect(gain).connect(master);
  source.start(now);
  source.stop(now + 0.75);
}

// Boost: a whoosh, plus a brief pitch bump on the engine (applied on the next update).
let boostPending = false;
export function playBoost() {
  boostPending = true;
  oneShot(buffers.boost, AUDIO_CONFIG.boostVolume, () => playWhoosh(AUDIO_CONFIG.boostVolume * 0.3));
}

// A near miss: the recorded whoosh, unmuffled. Full with the grey slow motion, softer (`level`) without it.
export function playSlowMoWhoosh(level = 1) {
  oneShot(buffers.slowmo, AUDIO_CONFIG.slowMoWhooshVolume * level, () => playWhoosh(JUICE_CONFIG.whooshVolume * level));
}

// Ramming a car under boost: a heavy boom (a low sine dropping fast, under a short burst of noise), unmuffled.
export function playImpact() {
  if (!graph || muted) return;
  const { context, master, noise } = graph;
  const now = context.currentTime, volume = AUDIO_CONFIG.impactVolume;
  const tone = context.createOscillator();
  tone.type = 'sine';
  tone.frequency.setValueAtTime(120, now);
  tone.frequency.exponentialRampToValueAtTime(38, now + 0.28);
  const toneGain = context.createGain();
  toneGain.gain.setValueAtTime(0, now);
  toneGain.gain.linearRampToValueAtTime(volume, now + 0.008);
  toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  tone.connect(toneGain).connect(master);
  tone.start(now); tone.stop(now + 0.4);
  const burst = context.createBufferSource();
  burst.buffer = noise;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2400, now);
  filter.frequency.exponentialRampToValueAtTime(300, now + 0.2);
  const burstGain = context.createGain();
  burstGain.gain.setValueAtTime(volume * 0.6, now);
  burstGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
  burst.connect(filter).connect(burstGain).connect(master);
  burst.start(now, Math.random()); burst.stop(now + 0.25);
}

// A landing or bump: a short thud (strength 0..1.5).
export function playThud(strength = 1) {
  const volume = AUDIO_CONFIG.thudVolume * Math.min(1.5, Math.max(0, strength));
  oneShot(buffers.thud, volume, () => {
    const { context, world } = graph!;
    const now = context.currentTime;
    const tone = context.createOscillator();
    tone.type = 'sine';
    tone.frequency.setValueAtTime(95, now);
    tone.frequency.exponentialRampToValueAtTime(42, now + 0.16);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    tone.connect(gain).connect(world);
    tone.start(now);
    tone.stop(now + 0.22);
  });
}

// The engine starting up, when the drive begins (only with an engine-start file).
export function playEngineStart() {
  if (buffers['engine-start']) oneShot(buffers['engine-start'], AUDIO_CONFIG.startVolume, () => undefined);
}

// Boost ready: a soft, bright two-note rise (a fifth), quiet enough to sit under the engine.
export function playBoostReady() {
  if (!graph || muted) return;
  const { context, master } = graph;
  const now = context.currentTime;
  [[660, 0], [990, 0.09]].forEach(([frequency, delay]) => {
    const tone = context.createOscillator();
    tone.type = 'triangle';
    tone.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now + delay);
    gain.gain.linearRampToValueAtTime(JUICE_CONFIG.whooshVolume * 0.4, now + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.35);
    tone.connect(gain).connect(master);
    tone.start(now + delay);
    tone.stop(now + delay + 0.4);
  });
}

// The gear the engine is in (1 = first), for the speedometer.
export const currentGear = () => engine.gear + 1;

export type AudioInput = {
  speedRatio: number; throttle: number; drift: number; active: boolean;
  // Game time scale (below 1 in slow motion), the car's acceleration (m/s², for hard braking) and whether it is off the road.
  timeScale?: number; acceleration?: number; offroad?: boolean;
  // How near the sea the car is (0..1): the share of water around it.
  sea?: number;
  // How near the plane is to the camera (0..1).
  plane?: number;
};
const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function updateAudio(input: AudioInput) {
  if (!graph) return;
  const c = AUDIO_CONFIG;
  const nowMs = performance.now();
  const dt = Math.min(0.1, lastFrame ? (nowMs - lastFrame) / 1000 : 0);
  lastFrame = lastUpdate = nowMs;
  const { context } = graph;
  const now = context.currentTime;
  const on = input.active && JUICE_CONFIG.soundEnabled;
  const speed = Number.isFinite(input.speedRatio) ? Math.min(Math.max(input.speedRatio, 0), 1.5) : 0;
  const throttle = clamp01(input.throttle);
  glide(graph.master.gain, muted ? 0 : c.master, now, 0.05);

  // Slow motion: the world slows, drops in pitch and is muffled.
  const slow = clamp01((1 - (input.timeScale ?? 1)) / 0.82);
  const slowRate = 1 - c.slowMoPitchDrop * slow;
  // Paused (or on the map, or reading the help), the world is heard from a step back: muffled the same way.
  const muffle = Math.max(slow, worldHeld ? 0.75 : 0);
  glide(graph.world.frequency, 18000 * Math.pow(c.slowMoMuffleHz / 18000, muffle), now, worldHeld ? 0.25 : c.smoothing);
  natureTick(dt);

  // Engine.
  const { shifting } = stepEngine(engine, { throttle: on ? throttle : 0, speed, boostStarted: boostPending }, c, dt);
  boostPending = false;
  const rate = (lerp(c.rpmIdleRate, c.rpmMaxRate, engine.rpm) + engine.bump) * slowRate;
  const dip = shifting ? 1 - c.shiftDip : 1;
  const engineLevel = on ? c.engineVolume * (1 - c.engineThrottleVolume + c.engineThrottleVolume * throttle) * dip : 0;
  if (graph.engine) {
    glide(graph.engine.source.playbackRate, rate, now);
    glide(graph.engine.gain.gain, engineLevel, now);
    glide(graph.oscGain.gain, 0, now);
  } else {
    // Like an automatic: the pitch rises smoothly with speed (and a little with the throttle), in a low, narrow
    // range, so it stays calm instead of whining; the throttle opens the filter, which is where the power is.
    const pitch = (34 + Math.min(speed, 1.2) * 62 + throttle * 6) * (1 + engine.bump) * c.enginePitch * slowRate;
    setGrit(graph.grit, c.engineGrit);
    glide(graph.oscA.frequency, pitch, now, 0.12);
    glide(graph.oscBody.frequency, pitch, now, 0.12);
    glide(graph.oscB.frequency, pitch * 0.5, now, 0.12);
    glide(graph.bodyGain.gain, c.engineBody, now);
    glide(graph.weight.frequency, pitch * 2, now, 0.12);
    // The burble runs at the firing rate (half the pitch), smooth and rounded.
    glide(graph.putter.frequency, pitch * 0.5, now, 0.12);
    glide(graph.putterDepth.gain, c.engineRumble * 0.4, now);
    // Open enough to let the upper harmonics through: they are what small speakers can play, so the deep tone
    // is heard on a laptop or phone and not only felt on headphones.
    glide(graph.oscFilter.frequency, pitch * (5 + throttle * 3) + 160, now, 0.15);
    glide(graph.oscGain.gain, on ? c.synthVolume * (0.6 + throttle * 0.4) : 0, now, 0.15);
  }
  if (graph.load) {
    glide(graph.load.source.playbackRate, rate * c.loadRateRatio * (buffers['engine-load'] ? 1 : 1.12), now);
    glide(graph.load.gain.gain, on ? c.loadVolume * throttle * dip : 0, now, c.smoothing * 1.5);
  }

  // Wind: louder and brighter with speed.
  glide(graph.wind.gain.gain, on ? c.windVolume * speed * speed : 0, now, 0.15);
  glide(graph.wind.filter.frequency, lerp(c.windMinHz, c.windMaxHz, Math.min(1, speed)), now, 0.15);

  // Tyres: drifting, or braking hard while moving.
  const hardBrake = (input.acceleration ?? 0) < -c.hardBrakeAccel && speed > 0.15 ? 1 : 0;
  const tires = Math.max(clamp01(input.drift), hardBrake) * Math.min(1, speed * 2);
  glide(graph.tires.filter.frequency, c.tireHz, now);
  graph.tires.filter.Q.value = c.tireQ;
  glide(graph.tires.gain.gain, on ? c.tireVolume * tires : 0, now, 0.05);

  // Off-road: the gravel loop if there is one, else a low rumble of filtered noise.
  const rough = on && input.offroad ? Math.min(1, speed * 1.6) : 0;
  if (graph.offroad) {
    glide(graph.offroad.gain.gain, c.offroadVolume * rough, now, 0.12);
    glide(graph.offroad.source.playbackRate, (0.8 + speed * 0.5) * slowRate, now);
    glide(graph.rumble.gain.gain, 0, now);
  } else {
    glide(graph.rumble.filter.frequency, c.offroadHz, now);
    glide(graph.rumble.gain.gain, c.offroadVolume * 0.6 * rough, now, 0.12);
  }


  // Ambience: the soft wind under everything, slowly faded in.
  if (graph.ambience) glide(graph.ambience.gain.gain, JUICE_CONFIG.soundEnabled ? c.ambienceVolume : 0, now, 1.5);
  // The sea: rises and falls slowly with how near the water the car is.
  if (graph.sea) glide(graph.sea.gain.gain, JUICE_CONFIG.soundEnabled ? c.seaVolume * clamp01(input.sea ?? 0) : 0, now, 1.5);
  // The plane: swells as it passes near the camera and fades as it flies off.
  if (graph.plane) glide(graph.plane.gain.gain, JUICE_CONFIG.soundEnabled ? c.planeVolume * clamp01(input.plane ?? 0) : 0, now, 0.6);
}


// ---------------------------------------------------------------------------------------------------------------
// Far-off birds: now and then, by day, a bird calls in the distance (two or three quick rising whistles), very
// quiet and through the world's sounds (so it is muffled in slow motion and while the game is held).
let worldHeld = false;
// While paused, on the map or in the help, the world's sounds are muffled (see updateAudio).
export function holdWorld(held: boolean) { worldHeld = held; }

function whistle(frequency: number, at: number, length: number, volume: number, glideTo: number) {
  if (!graph || muted) return;
  const { context, world } = graph;
  const start = context.currentTime + at;
  const tone = context.createOscillator();
  tone.type = 'sine';
  tone.frequency.setValueAtTime(frequency, start);
  tone.frequency.exponentialRampToValueAtTime(glideTo, start + length * 0.8);
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume * AUDIO_CONFIG.natureVolume, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  tone.connect(gain).connect(world);
  tone.start(start);
  tone.stop(start + length + 0.05);
}

let natureWait = 4;
function natureTick(dt: number) {
  if (!graph || muted || !JUICE_CONFIG.soundEnabled) return;
  natureWait -= dt;
  if (natureWait > 0) return;
  if (nightAmount() < 0.3) {
    const base = 2200 + Math.random() * 900, calls = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < calls; i++) whistle(base, i * 0.13, 0.09, 0.016, base * 1.35);
    natureWait = 7 + Math.random() * 12;
  } else natureWait = 3;
}

// Party mode's horn: a short, silly two-tone toot, its pitch set per player.
export function playHonk(pitch = 1) {
  if (!graph) return;
  const { context, world } = graph;
  const now = context.currentTime;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = 1800;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.09, now + 0.01);
  gain.gain.setValueAtTime(0.09, now + 0.2);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
  for (const ratio of [1, 1.26]) {
    const tone = context.createOscillator();
    tone.type = 'square';
    tone.frequency.setValueAtTime(330 * pitch * ratio, now);
    tone.frequency.linearRampToValueAtTime(300 * pitch * ratio, now + 0.24);
    tone.connect(filter);
    tone.start(now); tone.stop(now + 0.27);
  }
  filter.connect(gain).connect(world);
}
