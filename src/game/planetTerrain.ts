import { GLOBE_RADIUS } from './globe.ts';

// Faceted planet controls. These values are intentionally kept together so
// the coastline density, coverage, elevation and palette can be tuned quickly.
export const PLANET_TERRAIN = {
  detail: 5,
  threshold: 0.5,
  landHeight: GLOBE_RADIUS * 0.03,
  noiseFrequency: 1.35,
  facetLightnessVariation: 0.04,
} as const;

const fade = (value: number) => value * value * value * (value * (value * 6 - 15) + 10);
const lerp = (a: number, b: number, amount: number) => a + (b - a) * amount;

function hash3(x: number, y: number, z: number) {
  let value = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function valueNoise3(x: number, y: number, z: number) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const tx = fade(x - x0), ty = fade(y - y0), tz = fade(z - z0);
  const x00 = lerp(hash3(x0, y0, z0), hash3(x0 + 1, y0, z0), tx);
  const x10 = lerp(hash3(x0, y0 + 1, z0), hash3(x0 + 1, y0 + 1, z0), tx);
  const x01 = lerp(hash3(x0, y0, z0 + 1), hash3(x0 + 1, y0, z0 + 1), tx);
  const x11 = lerp(hash3(x0, y0 + 1, z0 + 1), hash3(x0 + 1, y0 + 1, z0 + 1), tx);
  return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz);
}

export function planetNoise(x: number, y: number, z: number) {
  const frequency = PLANET_TERRAIN.noiseFrequency;
  const broad = valueNoise3(x * frequency + 11.7, y * frequency - 4.3, z * frequency + 8.1);
  const detail = valueNoise3(x * frequency * 2 + 2.4, y * frequency * 2 + 9.6, z * frequency * 2 - 5.2);
  return broad * 0.76 + detail * 0.24;
}
