// Every knob for how the player car drives, moves and is filmed. Metres, seconds, radians.
export const CAR_CONFIG = {
  // Speed
  maxSpeed: 22,
  reverseMaxSpeed: 5,
  acceleration: 9,
  // Engine force tapers as (1 - accelTaper * (speed / limit)^2): a kick from standstill, softer near top speed.
  accelTaper: 0.92,
  reverseAcceleration: 4.8,
  brakeDecel: 14,
  // Keyboard pedals ramp like analog ones (seconds from 0 to full, and back).
  throttleRampUpTime: 0.6,
  throttleRampDownTime: 0.2,
  brakeRampUpTime: 0.25,
  brakeRampDownTime: 0.15,
  gentleThrottleCap: 0.5,
  // Boost (Shift): a timed burst of extra speed and pull, then a cooldown before it can fire again.
  boostSpeedFactor: 1.3,
  boostAccelFactor: 1.5,
  boostDuration: 1.5,
  boostCooldown: 4,
  boostOverspeedDecel: 8,
  // Gamepad: ignore small stick/trigger values, then apply a curve for fine control near centre.
  gamepadDeadzone: 0.1,
  gamepadCurve: 1.5,
  handbrakeDecel: 7,
  driftMinSpeed: 4,
  driftYawBoost: 1.25,
  driftGripBoost: 1.6,
  coastFriction: 0.45,
  airDrag: 0.004,
  // Steering and heading
  steerResponse: 5,
  steerReturn: 10,
  maxTurnRate: 4.2,
  lateralGrip: 13,
  // Hidden road assist: how fast the heading eases back to the road direction (rad/s per rad),
  // the extra pull when heading for the edge, and how far from the centre the edge pull starts.
  roadAssist: 0.8,
  roadEdgeAssist: 3,
  roadEdgeStart: 1.8,
  // Off-road (on land, away from the road)
  offroadSpeedFactor: 0.5,
  offroadSlowdownTime: 1,
  offroadFrictionFactor: 2,
  // Body spring (visual only)
  maxRoll: 0.14,
  rollStiffness: 45,
  rollDamping: 7,
  maxPitch: 0.1,
  pitchPerAccel: 0.012,
  pitchStiffness: 55,
  pitchDamping: 8,
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
  collisionRadius: 0.7,
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
  speedFovBoost: 10,
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

// Game-feel extras: body squash/wiggle/drift, camera kicks and shake, effects, HUD and sound.
export const JUICE_CONFIG = {
  // Body
  squashImpulse: 0.6,
  squashStiffness: 180,
  squashDamping: 9,
  maxSquash: 0.12,
  wiggleFactor: 0.08,
  wiggleStiffness: 120,
  wiggleDamping: 7,
  // Drift look: body yaw relative to travel while sliding
  driftAngleMax: 0.25,
  driftStiffness: 40,
  driftDamping: 7,
  driftSpeedRatio: 0.95,
  driftSteer: 0.95,
  // Tire marks
  tireMarksEnabled: true,
  tireMarkLife: 3,
  tireMarkPool: 240,
  tireMarkWidth: 0.22,
  tireMarkSpacing: 0.25,
  // Camera
  boostFovKick: 5,
  fovKickDecay: 3,
  cameraLag: 0.15,
  cameraLagStiffness: 6,
  shakeMax: 0.35,
  shakeDecay: 1.8,
  shakeBoost: 0.6,
  shakeBrake: 0.45,
  shakeBump: 0.25,
  hardBrakeAccel: 12,
  cameraRollFactor: 0.3,
  // Effects
  dustEnabled: false,
  dustRate: 30,
  dustBurst: 14,
  dustLife: 1,
  dustSize: 0.35,
  speedLinesEnabled: true,
  speedLinesThreshold: 0.7,
  speedLineCount: 40,
  flameEnabled: true,
  flameLength: 1.2,
  // HUD: smooth-driving streak levels up every `streakStep` seconds on the road above `streakSpeedRatio` of top speed.
  streakStep: 5,
  streakSpeedRatio: 0.55,
  streakShowTime: 2,
  hudSpringStiffness: 120,
  hudSpringDamping: 12,
  // Sound
  soundEnabled: true,
  engineVolume: 0.03,
  squealVolume: 0.025,
  whooshVolume: 0.06,
};
