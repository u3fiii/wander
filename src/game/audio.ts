import { JUICE_CONFIG } from './config.ts';

// Synthesised car sounds (no files): engine tone that follows speed/throttle, a tire squeal
// while drifting, and a whoosh when boost fires. Audio only starts after a user interaction.
type Graph = {
  context: AudioContext;
  master: GainNode;
  engineA: OscillatorNode;
  engineB: OscillatorNode;
  engineFilter: BiquadFilterNode;
  engineGain: GainNode;
  squealGain: GainNode;
  noise: AudioBuffer;
};

let graph: Graph | null = null;
let muted = false;
// Frames can stop without warning (tab hidden, window minimised, scene unmounted). If updates stop
// arriving, the engine and squeal are faded out instead of droning on at their last level.
const STALL_SILENCE_MS = 300;
let lastUpdate = 0;

// Move an AudioParam toward a value, dropping anything scheduled earlier so per-frame updates
// don't stack up on the automation timeline (that is what made the engine lag or hang on a pitch).
function glide(param: AudioParam, value: number, now: number, timeConstant: number) {
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
  else { param.cancelScheduledValues(now); param.setValueAtTime(param.value, now); }
  param.setTargetAtTime(value, now, timeConstant);
}

function silence() {
  if (!graph) return;
  const now = graph.context.currentTime;
  glide(graph.engineGain.gain, 0, now, 0.08);
  glide(graph.squealGain.gain, 0, now, 0.05);
}

function noiseBuffer(context: AudioContext) {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export function startAudio() {
  if (graph || !JUICE_CONFIG.soundEnabled || typeof AudioContext === 'undefined') {
    graph?.context.resume();
    return;
  }
  const context = new AudioContext();
  const master = context.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(context.destination);

  const engineFilter = context.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 350;
  const engineGain = context.createGain();
  engineGain.gain.value = 0;
  engineFilter.connect(engineGain).connect(master);
  const engineA = context.createOscillator();
  engineA.type = 'triangle';
  const engineB = context.createOscillator();
  engineB.type = 'sine';
  engineA.connect(engineFilter);
  engineB.connect(engineFilter);
  engineA.start();
  engineB.start();

  const noise = noiseBuffer(context);
  const squealSource = context.createBufferSource();
  squealSource.buffer = noise;
  squealSource.loop = true;
  const squealFilter = context.createBiquadFilter();
  squealFilter.type = 'bandpass';
  squealFilter.frequency.value = 1800;
  squealFilter.Q.value = 3;
  const squealGain = context.createGain();
  squealGain.gain.value = 0;
  squealSource.connect(squealFilter).connect(squealGain).connect(master);
  squealSource.start();

  graph = { context, master, engineA, engineB, engineFilter, engineGain, squealGain, noise };
  window.setInterval(() => { if (performance.now() - lastUpdate > STALL_SILENCE_MS) silence(); }, 150);
  document.addEventListener('visibilitychange', () => {
    if (!graph) return;
    if (document.hidden) { silence(); graph.context.suspend(); } else graph.context.resume();
  });
}

export function setMuted(value: boolean) {
  muted = value;
  if (graph) graph.master.gain.setTargetAtTime(value ? 0 : 1, graph.context.currentTime, 0.05);
}

export function playWhoosh() {
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
  gain.gain.linearRampToValueAtTime(JUICE_CONFIG.whooshVolume, now + 0.08);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
  source.connect(filter).connect(gain).connect(master);
  source.start(now);
  source.stop(now + 0.75);
}

// speedRatio: 0..1+, throttle: 0..1, drift: 0..1, active: whether the car is being driven.
export function updateAudio(speedRatio: number, throttle: number, drift: number, active: boolean) {
  if (!graph) return;
  lastUpdate = performance.now();
  const { context, engineA, engineB, engineFilter, engineGain, squealGain } = graph;
  const now = context.currentTime;
  const on = active && JUICE_CONFIG.soundEnabled;
  const ratio = Number.isFinite(speedRatio) ? Math.min(Math.max(speedRatio, 0), 1.5) : 0;
  const pedal = Number.isFinite(throttle) ? Math.min(Math.max(throttle, 0), 1) : 0;
  const pitch = 55 + ratio * 140 + pedal * 25;
  glide(engineA.frequency, pitch, now, 0.06);
  glide(engineB.frequency, pitch * 0.5, now, 0.06);
  glide(engineFilter.frequency, 300 + ratio * 700 + pedal * 300, now, 0.08);
  glide(engineGain.gain, on ? JUICE_CONFIG.engineVolume * (0.45 + pedal * 0.55) : 0, now, 0.1);
  glide(squealGain.gain, on ? JUICE_CONFIG.squealVolume * drift * Math.min(ratio * 2, 1) : 0, now, 0.05);
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
    gain.gain.linearRampToValueAtTime(JUICE_CONFIG.whooshVolume * 0.55, now + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.35);
    tone.connect(gain).connect(master);
    tone.start(now + delay);
    tone.stop(now + delay + 0.4);
  });
}
