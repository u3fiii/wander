import { CAR_CONFIG } from './config.ts';
import type { VehicleId } from './vehicleHandling.ts';

// Measured after import normalization, in the game's -Z-forward vehicle space (before bodyScale).
const layouts = {
  compact: { halfTrack: 0.469, rearAxle: 0.807, lampWidth: 0.45, front: -1.12, rear: 1.12,
    headHeight: 0.575, tailHeight: 0.75, exhaust: [0.183, 0.225, 1.2] },
  rover: { halfTrack: 0.374, rearAxle: 0.454, lampWidth: 0.334, front: -1.132, rear: 0.71,
    headHeight: 0.442, tailHeight: 0.186, exhaust: [0.38, 0.13, 0.78] },
} as const;

export function vehicleEffects(id: VehicleId) {
  const scale = CAR_CONFIG.bodyScale;
  if (id === 'classic') return {
    halfTrack: CAR_CONFIG.wheelHalfTrack * scale, rearAxle: -CAR_CONFIG.wheelRearZ * scale,
    lampWidth: 0.36 * scale, front: -(CAR_CONFIG.wheelFrontZ * scale + 0.35),
    rear: -CAR_CONFIG.wheelRearZ * scale + 0.4, headHeight: 0.5, tailHeight: 0.5,
    exhaust: [0.22 * scale, 0.42, -CAR_CONFIG.wheelRearZ * scale + 0.2] as [number, number, number],
  };
  const layout = layouts[id];
  return { halfTrack: layout.halfTrack * scale, rearAxle: layout.rearAxle * scale,
    lampWidth: layout.lampWidth * scale, front: layout.front * scale, rear: layout.rear * scale,
    headHeight: layout.headHeight * scale, tailHeight: layout.tailHeight * scale,
    exhaust: layout.exhaust.map(value => value * scale) as [number, number, number] };
}
