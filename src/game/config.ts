// Every knob for how the player car drives, moves and is filmed. Metres, seconds, radians.
export const CAR_CONFIG = {
  // Speed
  maxSpeed: 22,
  reverseMaxSpeed: 7,
  acceleration: 9,
  // Engine force tapers as (1 - accelTaper * (speed / limit)^2): a kick from standstill, softer near top speed.
  accelTaper: 0.92,
  reverseAcceleration: 9,
  // Reverse pulls almost as hard at its top speed as from a standstill, so backing out feels immediate.
  reverseTaper: 0.3,
  brakeDecel: 14,
  // Keyboard pedals ramp like analog ones (seconds from 0 to full, and back).
  throttleRampUpTime: 0.6,
  throttleRampDownTime: 0.2,
  brakeRampUpTime: 0.25,
  brakeRampDownTime: 0.15,
  gentleThrottleCap: 0.5,
  // Boost (Shift): a timed burst of extra speed and pull, then a cooldown before it can fire again.
  // A long, heavy push rather than a speed spike: the point of boost is the power to bulldoze traffic.
  boostSpeedFactor: 1.1,
  boostAccelFactor: 1.8,
  boostDuration: 5,
  boostCooldown: 5,
  boostOverspeedDecel: 8,
  // Gamepad: ignore small stick/trigger values, then apply a curve for fine control near centre.
  gamepadDeadzone: 0.1,
  gamepadCurve: 1.5,
  handbrakeDecel: 4,
  driftMinSpeed: 3,
  driftYawBoost: 1.25,
  driftGripBoost: 1.6,
  coastFriction: 0.45,
  airDrag: 0.004,
  // Steering and heading
  steerResponse: 5,
  steerReturn: 10,
  maxTurnRate: 4.2,
  // Below `lowSpeedTurnSpeed` the car still gets this share of full steering, so it can turn tightly while
  // manoeuvring or reversing (turn rate otherwise scales with speed up to top speed).
  lowSpeedTurnSpeed: 4,
  lowSpeedTurnFactor: 0.35,
  lateralGrip: 13,
  // Hidden road assist: how fast the heading eases back to the road direction (rad/s per rad),
  // the extra pull when heading for the edge, and how far from the centre the edge pull starts.
  roadAssist: 0.8,
  roadEdgeAssist: 3,
  roadEdgeStart: 1.8,
  // The approach to the bridge: extra road assist (per second) that fades out over this many radians from the deck.
  bridgeFunnelAssist: 14,
  bridgeFunnelReach: 0.5,
  // Boost makes holding the road easy: the road assist is this many times stronger (and reaches this far past
  // the road's edge, in metres), and steering turns in quicker with more grip.
  boostRoadAssistFactor: 3.5,
  boostAssistReach: 3,
  boostSteerFactor: 1.3,
  boostGripFactor: 1.6,
  // After a head-on hit: extra heading pull back to the road (per second) and for how long.
  crashAssist: 3.5,
  crashAssistTime: 1.2,
  // Back to road (F): how far from the road centre the car is put back, at most.
  recoverLaneOffset: 1.4,
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
  // Against traffic the car is a capsule: half the distance between its end-cap centres, and its half width.
  collisionHalfLength: 0.8,
  trafficRadius: 0.65,
  // Share of speed kept when ramming traffic; the player car is much heavier than NPCs.
  ramSpeedKeep: 0.85,
  // A side clip barely slows the player (it's the fun kind of hit).
  sideRamSpeedKeep: 0.95,
  // Ramming while boosting: the car bulldozes traffic aside, front or side alike, and only feels a little of
  // it: share of speed kept per hit, and how much of the usual heading nudge it takes.
  boostRamSpeedKeep: 1,
  // Heading nudge away from a struck car at full speed (radians).
  ramNudge: 0.05,
  boostRamNudgeFactor: 0,
  // Under boost the overlap with a struck car is eased out this much more gently (the other car moves, not you).
  // Speed lost per second while pressed against a car that hasn't been shoved clear yet, and how fast an overlap is eased out.
  trafficHoldDecel: 3,
  trafficSeparateRate: 10,
  // On a railing hit, how fast the heading straightens toward the bridge direction (per second).
  bridgeStraightenRate: 3,
  // How far past the deck model's ends (in longitude, radians) the railings and their end posts reach.
  bridgeEndOverlap: 0.012,
  // Fastest the car may be turned by a wall, trunk or shoreline it glances off (rad/s).
  deflectRate: 2.5,
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
  driftSpeedRatio: 0.7,
  driftSteer: 0.75,
  // Tire marks
  tireMarksEnabled: true,
  tireMarkLife: 4,
  tireMarkPool: 400,
  tireMarkWidth: 0.16,
  tireMarkSpacing: 0.3,
  tireMarkOpacity: 0.4,
  // Camera
  boostFovKick: 7.5,
  boostCameraPullback: 1.1,
  boostCameraLookAhead: 0.5,
  boostCameraPulseDecay: 3.8,
  fovKickDecay: 3,
  cameraLag: 0.15,
  cameraLagStiffness: 6,
  shakeMax: 0.35,
  shakeDecay: 1.8,
  shakeBoost: 0.6,
  shakeBrake: 0.15,
  shakeBump: 0.25,
  hardBrakeAccel: 12,
  cameraRollFactor: 0.3,
  // Effects
  dustEnabled: false,
  dustRate: 30,
  dustBurst: 14,
  dustLife: 1,
  dustSize: 0.35,
  // Soil clods kicked up when driving off-road: spawn rate at full speed (per second), how long they fly, and size.
  clodRate: 26,
  clodLife: 0.55,
  clodSize: 0.11,
  speedLinesEnabled: true,
  speedLinesThreshold: 0.7,
  speedLineCount: 40,
  flameEnabled: true,
  flameLength: 1.2,
  // HUD: smooth-driving streak levels up every `streakStep` seconds on the road above `streakSpeedRatio` of top speed.
  streakStep: 6,
  streakSpeedRatio: 0.55,
  streakShowTime: 2,
  hudSpringStiffness: 120,
  hudSpringDamping: 12,
  // A hit where the cars come together at least this fast (m/s) is a smash: it gets the red slow-motion cut-in.
  // (Top speed is about 18 m/s and traffic drives at 5-7, so full speed into an oncoming car is about 24.)
  crashCinematicClosing: 12,
  // Sound
  soundEnabled: true,
  engineVolume: 0.025,
  squealVolume: 0.016,
  whooshVolume: 0.06,
};
