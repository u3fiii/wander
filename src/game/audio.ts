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
  const { context, engineA, engineB, engineFilter, engineGain, squealGain } = graph;
  const now = context.currentTime;
  const on = active && JUICE_CONFIG.soundEnabled;
  const pitch = 55 + speedRatio * 140 + throttle * 25;
  engineA.frequency.setTargetAtTime(pitch, now, 0.06);
  engineB.frequency.setTargetAtTime(pitch * 0.5, now, 0.06);
  engineFilter.frequency.setTargetAtTime(300 + speedRatio * 700 + throttle * 300, now, 0.08);
  engineGain.gain.setTargetAtTime(on ? JUICE_CONFIG.engineVolume * (0.45 + throttle * 0.55) : 0, now, 0.1);
  squealGain.gain.setTargetAtTime(on ? JUICE_CONFIG.squealVolume * drift * Math.min(speedRatio * 2, 1) : 0, now, 0.05);
}
