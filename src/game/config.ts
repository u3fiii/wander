// Every knob for how the player car drives, moves and is filmed. Metres, seconds, radians.
export const CAR_CONFIG = {
  // Speed
  maxSpeed: 18,
  reverseMaxSpeed: 5,
  acceleration: 7.2,
  reverseAcceleration: 4.8,
  brakeDecel: 18,
  handbrakeDecel: 7,
  driftMinSpeed: 4,
  driftYawBoost: 1.5,
  driftGripBoost: 2.2,
  coastFriction: 0.65,
  airDrag: 0.012,
  // Steering and heading
  steerResponse: 8,
  steerReturn: 10,
  maxTurnRate: 4.2,
  lateralGrip: 8,
  // Off-road (on land, away from the road)
  offroadSpeedFactor: 0.5,
  offroadSlowdownTime: 1,
  offroadFrictionFactor: 2,
  // Body spring (visual only)
  maxRoll: 0.09,
  rollStiffness: 90,
  rollDamping: 9,
  maxPitch: 0.045,
  pitchPerAccel: 0.006,
  pitchStiffness: 110,
  pitchDamping: 10,
  bounceStiffness: 160,
  bounceDamping: 11,
  bounceKick: 0.0025,
  bumpHeight: 0.012,
  offroadBumpFactor: 2.5,
  // Wheels, in the car model's own space (front is +z, ground is y = 0)
  wheelRadius: 0.3,
  wheelWidth: 0.22,
  wheelHalfTrack: 0.365,
  wheelFrontZ: 0.76,
  // Body radius used for collisions with trees, rocks, houses and mountains.
  collisionRadius: 0.85,
  // Share of speed kept when ramming traffic; the player car is much heavier than NPCs.
  ramSpeedKeep: 0.85,
  // On a railing hit, how much of the angle away from the bridge direction is kept per step (lower = straightens faster).
  bridgeStraighten: 0.85,
  // Shoreline: heading step tried when sliding along the water's edge, and speed lost per second while scraping it.
  shoreSlideStep: 0.06,
  shoreScrape: 1.5,
  // Visual size of the whole car (rig and placeholder wheels), relative to the 2.4-unit model.
  bodyScale: 1.2,
  wheelRearZ: -0.57,
  maxWheelSteerAngle: 0.52,
  wheelNodeNames: { FL: '', FR: '', RL: '', RR: '' },
  logModelNodes: false,
  // Camera
  cameraDistance: 13,
  cameraHeight: 16,
  cameraHeightPerSpeed: 0.035,
  cameraLookAhead: 6,
  cameraSmoothing: 4,
  topCameraDistance: 24,
  topCameraHeight: 24,
  topCameraLookAhead: 3,
  baseFov: 50,
  speedFovBoost: 8,
  fovSmoothing: 5,
};

export const DRIVE = {
  acceleration: 13, braking: 26, rollingDrag: 2.1, maxSpeed: 23,
  reverseSpeed: 8, steering: 0.67, carRadius: 1.1, worldLimit: 119,
  spawn: { x: 3.5, z: 35, heading: 0 },
};
export const BLOCKS = [-81, -27, 27, 81];

// Water and integration settings for driving on the globe.
export const LOOP_DRIVE = {
  waterShoreInfluence: 0.055, waterStopInfluence: 0.008,
  waterSurfaceInfluence: 0.035, maxWaterTravel: 2.4,
  waterDrag: 3.2, waterRoadMargin: 0.45,
  waterCrawlSpeed: 0.35, waterMinimumMobility: 0.12,
  maxFrameDelta: 0.05, physicsStep: 1 / 120,
};
