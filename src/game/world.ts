import { BLOCKS, ROADS } from './config';
export type Box = { p: [number, number, number]; s: [number, number, number]; c: string; r?: number };
export type Tree = { x: number; z: number; scale: number };
export type Sign = { x: number; y: number; z: number; text: string; color: string; width: number; rotation?: number };
export const boxes: Box[] = [];
export const trees: Tree[] = [];
export const signs: Sign[] = [];
let seed = 36;
const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const box = (p: Box['p'], s: Box['s'], c: string, r = 0) => boxes.push({ p, s, c, r });
const walls = ['#c9b08e', '#d2bea0', '#bc8e71', '#d7c6a7', '#b8b0a1', '#c5a889'];

for (const road of ROADS) {
  box([road, 0.015, 0], [14, 0.08, 255], '#646c6a');
  box([0, 0.02, road], [255, 0.08, 14], '#646c6a');
  for (let j = -120; j <= 120; j += 7) {
    if (ROADS.some(r => Math.abs(j - r) < 11)) continue;
    box([road, 0.075, j], [0.16, 0.012, 2.7], '#d9c999');
    box([j, 0.08, road], [2.7, 0.012, 0.16], '#d9c999');
  }
}
for (const x of ROADS) for (const z of ROADS) {
  for (let i = -4; i <= 4; i += 1.4) {
    box([x + i, 0.09, z + 10], [0.65, 0.014, 2.5], '#d8d7c4');
    box([x + 10, 0.09, z + i], [2.5, 0.014, 0.65], '#d8d7c4');
  }
}

for (const x of BLOCKS) for (const z of BLOCKS) {
  box([x, 0.16, z], [40, 0.32, 40], '#c2bba7');
  // Alternating curb blocks are a small but familiar Tehran detail.
  for (let i = -19; i <= 19; i += 2) {
    const color = (i + 19) % 4 ? '#f0e8d3' : '#71887a';
    box([x + i, 0.3, z + 19.9], [2, 0.4, 0.32], color);
    box([x + i, 0.3, z - 19.9], [2, 0.4, 0.32], color);
    box([x + 19.9, 0.3, z + i], [0.32, 0.4, 2], color);
    box([x - 19.9, 0.3, z + i], [0.32, 0.4, 2], color);
  }
  if (x === -27 && z === 27) {
    box([x, 0.37, z], [32, 0.1, 32], '#d8cdb3');
    box([x, 0.45, z + 12], [23, 0.1, 5], '#709c9b');
    for (const dx of [-16, 16]) for (const dz of [-15, -5, 6, 16]) trees.push({ x: x + dx, z: z + dz, scale: 0.8 });
    continue;
  }
  if (x === 81 && z === -81) {
    box([x, 0.35, z], [35, 0.1, 35], '#8d9e6c');
    box([x, 0.42, z], [4, 0.1, 36], '#d5c6a5');
    for (let i = 0; i < 16; i++) trees.push({ x: x + (random() - 0.5) * 30, z: z + (random() - 0.5) * 30, scale: 0.7 + random() * 0.5 });
    continue;
  }
  for (const dx of [-9.4, 9.4]) for (const dz of [-9.4, 9.4]) {
    const bx = x + dx, bz = z + dz;
    const h = 7 + Math.floor(random() * 4) * 3;
    const w = 13.8 + random() * 2;
    box([bx, h / 2 + 0.35, bz], [w, h, 14.5], walls[Math.floor(random() * walls.length)]);
    box([bx, h + 0.45, bz], [w + 0.5, 0.32, 15.1], '#e1d3b6');
    box([bx - 2, h + 1.05, bz], [3, 1, 2.4], '#91a5a3'); // Roof cooler.
    box([bx + 3, h + 0.9, bz - 3], [2, 0.6, 2], '#aaa590');
    for (let y = 3.5; y < h - 0.5; y += 3) {
      for (const xx of [-4.2, 0, 4.2]) {
        box([bx + xx, y, bz + 7.28], [1.9, 1.6, 0.07], '#476461');
        box([bx + xx, y, bz - 7.28], [1.9, 1.6, 0.07], '#476461');
        box([bx + xx, y - 0.91, bz + 7.5], [2.3, 0.14, 0.5], '#e3d4b9');
      }
      for (const zz of [-4, 1, 5]) {
        box([bx + w / 2 + 0.02, y, bz + zz], [0.07, 1.6, 1.8], '#476461');
        box([bx - w / 2 - 0.02, y, bz + zz], [0.07, 1.6, 1.8], '#476461');
      }
    }
    // Street-level shops, shutters and striped awnings.
    for (const signZ of [bz - 7.35, bz + 7.35]) {
      box([bx, 1.5, signZ], [9, 2.2, 0.1], '#476461');
      const awningColor = random() > 0.5 ? '#527a6b' : '#b96d53';
      box([bx, 2.9, signZ + Math.sign(signZ - bz) * 0.55], [10, 0.18, 1.3], awningColor);
      for (let a = -4; a <= 4; a += 2) box([bx + a, 2.91, signZ + Math.sign(signZ - bz) * 0.55], [0.7, 0.19, 1.3], '#e5d8b5');
    }
  }
  for (const side of [-17.7, 17.7]) for (const n of [-12, 0, 12]) {
    trees.push({ x: x + side, z: z + n, scale: 0.7 + random() * 0.35 });
  }
}

const labels = ['سوپرمارکت بهار', 'نانوایی سنگک', 'کتابفروشی', 'کافه چنار', 'گل‌فروشی', 'خیاطی امید'];
for (let i = 0; i < BLOCKS.length; i++) for (let j = 0; j < BLOCKS.length; j++) {
  const x = BLOCKS[i], z = BLOCKS[j];
  if ((x === -27 && z === 27) || (x === 81 && z === -81)) continue;
  signs.push({ x: x - 9.4, y: 3.5, z: z + 16.85, width: 10, text: labels[(i * 4 + j) % labels.length], color: '#214f49' });
  signs.push({ x: x + 9.4, y: 3.5, z: z - 16.85, width: 10, text: labels[(i + j + 2) % labels.length], color: '#8e4c38', rotation: Math.PI });
}
signs.push({ x: -36.4, y: 5, z: -44, text: 'سینما تهران', color: '#863e32', width: 12 });

// Lamp posts and benches sit safely on the pavements.
for (const x of BLOCKS) for (const z of BLOCKS) for (const d of [-1, 1]) {
  box([x + d * 18.2, 3.3, z + 17.8], [0.15, 6, 0.15], '#58695e');
  box([x + d * 17.6, 6.3, z + 17.8], [1.4, 0.14, 0.3], '#58695e');
  box([x + d * 17.2, 6.18, z + 17.8], [0.6, 0.12, 0.45], '#f5df97');
  box([x - 4, 0.9, z + d * 18], [3, 0.18, 0.8], '#8f6650');
  box([x - 4, 1.4, z + d * 18.3], [3, 0.7, 0.12], '#8f6650');
}
