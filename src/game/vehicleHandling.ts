import { CAR_CONFIG } from './config.ts';

type NumericKey = { [K in keyof typeof CAR_CONFIG]: typeof CAR_CONFIG[K] extends number ? K : never }[keyof typeof CAR_CONFIG];
type VehicleProfile = {
  role: string; strength: string; weakness: string;
  factors: Partial<Record<NumericKey, number>>;
  impactPower: number; impactLoss: number;
};

// Multipliers sit over the live tuning baseline. Selecting or previewing a car never overwrites that baseline.
// A new ride needs its own trade-offs here as well as an asset entry in vehicles.ts.
export const VEHICLE_PROFILES = {
  classic: {
    role: 'Heavy cruiser',
    strength: 'More speed. Stronger shoves. Holds its line in traffic.',
    weakness: 'Slower off the line, wider turns and longer stops.',
    factors: { maxSpeed: 1.07, acceleration: 0.9, brakeDecel: 0.88, steerResponse: 0.82,
      steerReturn: 0.9, maxTurnRate: 0.88, lateralGrip: 0.92, boostAccelFactor: 1.12,
      ramNudge: 0.7, trafficHoldDecel: 0.7, trafficSeparateRate: 0.8, maxRoll: 1.1, rollStiffness: 0.9 },
    impactPower: 1.35, impactLoss: 0.65,
  },
  compact: {
    role: 'Agile city car',
    strength: 'Quick starts, sharp steering and shorter stops.',
    weakness: 'Lower top speed. Traffic knocks more speed off.',
    factors: { maxSpeed: 0.87, acceleration: 1.1, brakeDecel: 1.2, steerResponse: 1.35,
      steerReturn: 1.2, maxTurnRate: 1.12, lateralGrip: 1.2, boostAccelFactor: 0.95,
      ramNudge: 1.5, trafficHoldDecel: 1.4, trafficSeparateRate: 1.2, maxRoll: 0.85, rollStiffness: 1.2 },
    impactPower: 0.65, impactLoss: 1.65,
  },
  rover: {
    role: 'All-terrain bruiser',
    strength: 'Strongest shoves. Keeps pulling on dirt and grass.',
    weakness: 'Heavy steering, slower starts and longer braking.',
    factors: { maxSpeed: 0.95, acceleration: 0.82, brakeDecel: 0.78, steerResponse: 0.7,
      steerReturn: 0.82, maxTurnRate: 0.82, lateralGrip: 1.05, boostAccelFactor: 1.18,
      offroadSpeedFactor: 1.6, offroadFrictionFactor: 0.7, offroadSlowdownTime: 1.3,
      ramNudge: 0.5, trafficHoldDecel: 0.55, trafficSeparateRate: 0.7, maxRoll: 1.18, rollStiffness: 0.82 },
    impactPower: 1.5, impactLoss: 0.45,
  },
} satisfies Record<string, VehicleProfile>;

export type VehicleId = keyof typeof VEHICLE_PROFILES;
let active: VehicleId | null = null;
export const setActiveVehicle = (id: VehicleId) => { active = id; };
export const getActiveVehicle = () => active;
export const resetActiveVehicle = () => { active = null; };

export function vehicleConfig(id: VehicleId | null): typeof CAR_CONFIG {
  return new Proxy(CAR_CONFIG, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (!id || typeof value !== 'number') return value;
      const profile: VehicleProfile = VEHICLE_PROFILES[id];
      if (property === 'ramSpeedKeep' || property === 'frontRamSpeedKeep' || property === 'sideRamSpeedKeep' || property === 'boostRamSpeedKeep') {
        return Math.max(0, Math.min(1, 1 - (1 - value) * profile.impactLoss));
      }
      return value * (profile.factors[property as NumericKey] ?? 1);
    },
  });
}

const configs = Object.fromEntries(Object.keys(VEHICLE_PROFILES).map(id => [id, vehicleConfig(id as VehicleId)])) as Record<VehicleId, typeof CAR_CONFIG>;
// Stable read-only view for the simulation, camera and feedback; original dev sliders keep editing CAR_CONFIG.
export const DRIVING_CONFIG = new Proxy(CAR_CONFIG, {
  get(target, property, receiver) {
    return active ? Reflect.get(configs[active], property) : Reflect.get(target, property, receiver);
  },
});

export const impactPower = () => active ? VEHICLE_PROFILES[active].impactPower : 1;

export function garageRatings(id: VehicleId) {
  const profile: VehicleProfile = VEHICLE_PROFILES[id];
  return [
    { label: 'Speed', value: profile.factors.maxSpeed ?? 1 },
    { label: 'Handling', value: ((profile.factors.steerResponse ?? 1) + (profile.factors.lateralGrip ?? 1)) / 2 },
    { label: 'Braking', value: profile.factors.brakeDecel ?? 1 },
    { label: 'Impact', value: profile.impactPower },
  ];
}
