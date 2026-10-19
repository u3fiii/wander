import classicUrl from '../assets/low_poly_car/low-poly-car.glb?url';
import compactUrl from '../assets/low_poly_small_car/small-car.glb?url';
import roverUrl from '../assets/Range Rover by IvOfficial - 8zk4o6nALW.glb?url';

import { VEHICLE_PROFILES } from './vehicleHandling';
import type { VehicleId } from './vehicleHandling';
export type { VehicleId } from './vehicleHandling';
export const VEHICLES = [
  { id: 'classic', name: 'Classic', description: VEHICLE_PROFILES.classic.role, url: classicUrl,
    title: 'Low Poly Car', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', wheelNodes: undefined,
    author: 'ion_omat', source: 'https://sketchfab.com/3d-models/low-poly-car-ffcf987149df4e528ebf1e2dec6a9f8a' },
  { id: 'compact', name: 'Compact', description: VEHICLE_PROFILES.compact.role, url: compactUrl,
    title: 'Low Poly Small car', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    wheelNodes: { FL: 'FL_Wheel', FR: 'FR_Wheel', RL: 'RL_Wheel', RR: 'RR_Wheel' },
    author: 'scailman', source: 'https://sketchfab.com/3d-models/low-poly-small-car-ebe7c5e98a7448b5abb2eaf0cb22b766' },
  { id: 'rover', name: 'Range Rover', description: VEHICLE_PROFILES.rover.role, url: roverUrl,
    title: 'Range Rover', license: 'CC BY', licenseUrl: 'https://poly.pizza/m/8zk4o6nALW',
    wheelNodes: { FL: 'Tire1', FR: 'Tire3', RL: 'Tire2', RR: 'Tire4' },
    author: 'IvOfficial', source: 'https://poly.pizza/m/8zk4o6nALW' },
] as const;

export function loadVehicle(): VehicleId {
  try {
    const saved = localStorage.getItem('wander.vehicle');
    return VEHICLES.find(vehicle => vehicle.id === saved)?.id ?? 'classic';
  }
  catch { return 'classic'; }
}

export function saveVehicle(id: VehicleId) {
  try { localStorage.setItem('wander.vehicle', id); } catch { /* Storage can be unavailable in private browsing. */ }
}
