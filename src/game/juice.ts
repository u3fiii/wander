import * as THREE from 'three';
import { CAR_CONFIG, JUICE_CONFIG } from './config.ts';
import { PALETTE } from './palette.ts';
import type { CarState } from './driving.ts';

const dummy = new THREE.Object3D();
const local = new THREE.Vector3();
const zero = new THREE.Matrix4().makeScale(0, 0, 0);

// Rear wheel contact points in the vehicle's own space (forward is -z, so the rear is +z).
type RearAxle = { halfTrack: number; rearZ: number };
const rearWheel = (side: number, out: THREE.Vector3, axle?: RearAxle) => out.set(
  side * (axle?.halfTrack ?? CAR_CONFIG.wheelHalfTrack * CAR_CONFIG.bodyScale),
  0.03,
  axle?.rearZ ?? -CAR_CONFIG.wheelRearZ * CAR_CONFIG.bodyScale,
);

// Tire marks: two continuous trails under the rear wheels while sliding. Each piece joins the wheel's last
// point to its new one (so the trail follows the real path of the slide, not the way the body faces), keeps its
// width, and fades out by transparency, softly, over its life. A trail breaks when the slide ends.
const up = new THREE.Vector3();
const along = new THREE.Vector3();
const across = new THREE.Vector3();
const basis = new THREE.Matrix4();
export function createTireMarks() {
  const count = JUICE_CONFIG.tireMarkPool;
  const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const fade = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  fade.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aFade', fade);
  const material = new THREE.MeshBasicMaterial({ color: PALETTE.tires, transparent: true, opacity: JUICE_CONFIG.tireMarkOpacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute float aFade;\nvarying float vFade;\nvoid main() {\n  vFade = aFade;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying float vFade;\nvoid main() {')
      .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n  diffuseColor.a *= vFade;');
  };
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, zero);
  return {
    mesh,
    fade,
    age: new Float32Array(count).fill(Infinity),
    // The last point laid by each rear wheel (left, right), or null when its trail is broken.
    last: [null, null] as Array<THREE.Vector3 | null>,
    next: 0,
    dispose: () => { geometry.dispose(); material.dispose(); mesh.dispose(); },
  };
}
export type TireMarks = ReturnType<typeof createTireMarks>;

export function updateTireMarks(marks: TireMarks, dt: number, vehicle: THREE.Object3D, car: CarState, active: boolean, axle?: RearAxle) {
  const sliding = active && JUICE_CONFIG.tireMarksEnabled && !!car.drift && Math.abs(car.speed) > 3;
  if (!sliding) marks.last = [null, null];
  else {
    vehicle.updateMatrix();
    up.set(0, 1, 0).applyQuaternion(vehicle.quaternion);
    [-1, 1].forEach((side, wheel) => {
      const point = rearWheel(side, local, axle).applyMatrix4(vehicle.matrix);
      const last = marks.last[wheel];
      if (!last) { marks.last[wheel] = point.clone(); return; }
      const length = point.distanceTo(last);
      if (length < JUICE_CONFIG.tireMarkSpacing) return;
      const i = marks.next;
      marks.next = (marks.next + 1) % marks.age.length;
      along.copy(point).sub(last).divideScalar(length);
      across.crossVectors(up, along).normalize();
      basis.makeBasis(across, up, along);
      dummy.quaternion.setFromRotationMatrix(basis);
      // A little overlap so the pieces read as one unbroken stripe.
      dummy.position.copy(point).add(last).multiplyScalar(0.5);
      dummy.scale.set(JUICE_CONFIG.tireMarkWidth, 1, length + 0.04);
      dummy.updateMatrix();
      marks.mesh.setMatrixAt(i, dummy.matrix);
      marks.age[i] = 0;
      last.copy(point);
    });
  }
  for (let i = 0; i < marks.age.length; i++) {
    if (marks.age[i] > JUICE_CONFIG.tireMarkLife) continue;
    marks.age[i] += dt;
    // Holds dark for most of its life, then eases away; it fades in over the first moment too.
    const life = marks.age[i] / JUICE_CONFIG.tireMarkLife;
    marks.fade.setX(i, Math.min(1, marks.age[i] * 12) * (1 - THREE.MathUtils.smoothstep(life, 0.45, 1)));
    if (life > 1) marks.mesh.setMatrixAt(i, zero);
  }
  marks.fade.needsUpdate = true;
  marks.mesh.instanceMatrix.needsUpdate = true;
}

// Speed lines: thin streaks around the screen edges that rush past the camera above a speed threshold.
// A crash (the red slow motion) gets a far stronger set on top: more, longer, thicker and brighter streaks,
// pulled in closer to the centre of the frame, like the focus lines of an action shot. They move on game time, so
// in the slow motion they crawl past.
const CRASH_LINES = { count: 34, innerRadius: 1.3, outerRadius: 4.4, length: 10, thickness: 0.1, opacity: 1, speed: 46, color: '#ffffff' };
// Each set of lines is one instanced mesh (one draw call, not one per line); `lines`/`crashLines` hold each line's
// place, written into the instances as they move.
function lineSet(geometry: THREE.BufferGeometry, material: THREE.Material, places: THREE.Object3D[]) {
  const mesh = new THREE.InstancedMesh(geometry, material, places.length);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // They ride with the camera, so they are always in view.
  mesh.frustumCulled = false;
  const sync = () => {
    places.forEach((place, index) => { place.updateMatrix(); mesh.setMatrixAt(index, place.matrix); });
    mesh.instanceMatrix.needsUpdate = true;
  };
  sync();
  return { mesh, sync };
}

export function createSpeedLines() {
  const count = JUICE_CONFIG.speedLineCount;
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(0.025, 0.025, 2.4);
  const material = new THREE.MeshBasicMaterial({ color: PALETTE.clouds, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const lines = Array.from({ length: count }, () => {
    const place = new THREE.Object3D();
    const angle = Math.random() * Math.PI * 2;
    const radius = 2.2 + Math.random() * 2.2;
    place.position.set(Math.cos(angle) * radius * 1.6, Math.sin(angle) * radius, -4 - Math.random() * 26);
    return place;
  });
  const lineMesh = lineSet(geometry, material, lines);
  group.add(lineMesh.mesh);
  const crashGeometry = new THREE.BoxGeometry(CRASH_LINES.thickness, CRASH_LINES.thickness, CRASH_LINES.length);
  // Added on top of the frame (additive), so they read as light, strong even over the red grade.
  const crashMaterial = new THREE.MeshBasicMaterial({ color: CRASH_LINES.color, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  const crashGroup = new THREE.Group();
  const crashLines = Array.from({ length: CRASH_LINES.count }, () => {
    const place = new THREE.Object3D();
    const angle = Math.random() * Math.PI * 2;
    const radius = CRASH_LINES.innerRadius + Math.random() * (CRASH_LINES.outerRadius - CRASH_LINES.innerRadius);
    place.position.set(Math.cos(angle) * radius * 1.6, Math.sin(angle) * radius, -3 - Math.random() * 24);
    place.scale.setScalar(0.6 + Math.random() * 0.8);
    return place;
  });
  const crashMesh = lineSet(crashGeometry, crashMaterial, crashLines);
  crashGroup.add(crashMesh.mesh);
  group.add(crashGroup);
  return {
    group, lines, material, crashGroup, crashLines, crashMaterial, syncLines: lineMesh.sync, syncCrashLines: crashMesh.sync,
    dispose: () => { geometry.dispose(); material.dispose(); crashGeometry.dispose(); crashMaterial.dispose(); lineMesh.mesh.dispose(); crashMesh.mesh.dispose(); },
  };
}
export type SpeedLines = ReturnType<typeof createSpeedLines>;

// `crash` (0..1) is how far into a crash cut-in the frame is. `dt` is game time (it moves the lines, slowed in
// slow motion); `realDt` is real time, which the fades run on, so they end with the cut-in, not five times later.
export function updateSpeedLines(lines: SpeedLines, dt: number, camera: THREE.Camera, speed: number, active: boolean, crash = 0, realDt = dt) {
  const ratio = Math.abs(speed) / CAR_CONFIG.maxSpeed;
  const strength = active && JUICE_CONFIG.speedLinesEnabled
    ? THREE.MathUtils.clamp((ratio - JUICE_CONFIG.speedLinesThreshold) / (1 - JUICE_CONFIG.speedLinesThreshold), 0, 1)
    : 0;
  const hit = active ? crash : 0;
  lines.material.opacity = THREE.MathUtils.damp(lines.material.opacity, Math.max(strength * 0.275, hit * 0.7), 10, realDt);
  // Squared, so the strong lines are gone a little before the cut-in has fully let go.
  lines.crashMaterial.opacity = CRASH_LINES.opacity * hit * hit;
  lines.crashGroup.visible = lines.crashMaterial.opacity > 0.01;
  lines.group.visible = lines.material.opacity > 0.01 || lines.crashGroup.visible;
  if (!lines.group.visible) return;
  lines.group.position.copy(camera.position);
  lines.group.quaternion.copy(camera.quaternion);
  for (const line of lines.lines) {
    line.position.z += (12 + Math.abs(speed) * 2.2) * dt;
    if (line.position.z > -1) line.position.z -= 30;
  }
  lines.syncLines();
  if (!lines.crashGroup.visible) return;
  for (const line of lines.crashLines) {
    line.position.z += CRASH_LINES.speed * dt;
    if (line.position.z > -1) line.position.z -= 26;
  }
  lines.syncCrashLines();
}

// Dust: cream low-poly puffs from the rear wheels, scaled by throttle and speed, with bursts on launch and drift.
export function createDust() {
  const count = 80;
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const material = new THREE.MeshStandardMaterial({ color: PALETTE.wallCream, roughness: 1, flatShading: true, transparent: true, opacity: 0.8, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, zero);
  return {
    mesh,
    age: new Float32Array(count).fill(1),
    life: new Float32Array(count).fill(1),
    size: new Float32Array(count),
    positions: Array.from({ length: count }, () => new THREE.Vector3()),
    velocities: Array.from({ length: count }, () => new THREE.Vector3()),
    next: 0,
    budget: 0,
    lastSpeed: 0,
    lastDrift: 0,
    dispose: () => { geometry.dispose(); material.dispose(); mesh.dispose(); },
  };
}
export type Dust = ReturnType<typeof createDust>;

export function updateDust(dust: Dust, dt: number, vehicle: THREE.Object3D, car: CarState, throttle: number, active: boolean, axle?: RearAxle) {
  const speed = Math.abs(car.speed);
  let spawn = 0;
  if (active && JUICE_CONFIG.dustEnabled) {
    const launch = dust.lastSpeed < 1 && speed > 1 && throttle > 0.5;
    const driftStart = car.drift && !dust.lastDrift;
    dust.budget += JUICE_CONFIG.dustRate * throttle * Math.min(speed / CAR_CONFIG.maxSpeed, 1) * dt
      + JUICE_CONFIG.dustRate * car.drift * dt;
    if (launch || driftStart) dust.budget += JUICE_CONFIG.dustBurst;
    spawn = Math.floor(dust.budget);
    dust.budget -= spawn;
  } else {
    dust.budget = 0;
  }
  dust.lastSpeed = speed;
  dust.lastDrift = car.drift;
  if (spawn > 0) vehicle.updateMatrix();
  for (let n = 0; n < spawn; n++) {
    const i = dust.next;
    dust.next = (dust.next + 1) % dust.age.length;
    dust.positions[i].copy(rearWheel(n % 2 ? 1 : -1, local, axle)).applyMatrix4(vehicle.matrix);
    dust.velocities[i].set((Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2).applyQuaternion(vehicle.quaternion);
    dust.age[i] = 0;
    dust.life[i] = JUICE_CONFIG.dustLife * (0.7 + Math.random() * 0.6);
    dust.size[i] = JUICE_CONFIG.dustSize * (0.6 + Math.random() * 0.8);
  }
  for (let i = 0; i < dust.age.length; i++) {
    if (dust.age[i] >= dust.life[i]) continue;
    dust.age[i] += dt;
    const t = Math.min(dust.age[i] / dust.life[i], 1);
    dust.velocities[i].multiplyScalar(Math.exp(-2 * dt));
    dust.positions[i].addScaledVector(dust.velocities[i], dt);
    dummy.position.copy(dust.positions[i]);
    dummy.quaternion.identity();
    dummy.scale.setScalar(t >= 1 ? 0 : dust.size[i] * (0.4 + t * 1.4) * (1 - t));
    dummy.updateMatrix();
    dust.mesh.setMatrixAt(i, dummy.matrix);
  }
  dust.mesh.instanceMatrix.needsUpdate = true;
}

// Soil clods: small low-poly chunks of earth thrown up from the rear wheels when driving off-road. They are
// flung back and up, fall under gravity and shrink away. Solid-looking and brief, unlike a dust cloud.
export function createSoilClods() {
  const count = 90;
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const material = new THREE.MeshStandardMaterial({ color: PALETTE.soil, roughness: 1, flatShading: true });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, zero);
  return {
    mesh,
    age: new Float32Array(count).fill(1),
    size: new Float32Array(count),
    positions: Array.from({ length: count }, () => new THREE.Vector3()),
    velocities: Array.from({ length: count }, () => new THREE.Vector3()),
    next: 0,
    budget: 0,
    dispose: () => { geometry.dispose(); material.dispose(); mesh.dispose(); },
  };
}
export type SoilClods = ReturnType<typeof createSoilClods>;

const GRAVITY = 11;
export function updateSoilClods(clods: SoilClods, dt: number, vehicle: THREE.Object3D, car: CarState, offroad: boolean, axle?: RearAxle) {
  const speedRatio = Math.min(Math.abs(car.speed) / CAR_CONFIG.maxSpeed, 1);
  if (offroad && Math.abs(car.speed) > 3) {
    clods.budget += JUICE_CONFIG.clodRate * speedRatio * dt;
  } else {
    clods.budget = 0;
  }
  const spawn = Math.floor(clods.budget);
  clods.budget -= spawn;
  if (spawn > 0) vehicle.updateMatrix();
  // Clods leave the wheels backwards (+z in the car's space), with a little side scatter and a lift.
  for (let n = 0; n < spawn; n++) {
    const i = clods.next;
    clods.next = (clods.next + 1) % clods.age.length;
    clods.positions[i].copy(rearWheel(n % 2 ? 1 : -1, local, axle)).applyMatrix4(vehicle.matrix);
    clods.velocities[i].set((Math.random() - 0.5) * 1.6, 1.2 + Math.random() * 1.6, 1.8 + Math.random() * 1.4)
      .multiplyScalar(0.6 + speedRatio * 0.9).applyQuaternion(vehicle.quaternion);
    clods.age[i] = 0;
    clods.size[i] = JUICE_CONFIG.clodSize * (0.6 + Math.random() * 0.8);
  }
  for (let i = 0; i < clods.age.length; i++) {
    if (clods.age[i] >= JUICE_CONFIG.clodLife) continue;
    clods.age[i] += dt;
    const t = Math.min(clods.age[i] / JUICE_CONFIG.clodLife, 1);
    clods.velocities[i].y -= GRAVITY * dt;
    clods.positions[i].addScaledVector(clods.velocities[i], dt);
    dummy.position.copy(clods.positions[i]);
    dummy.quaternion.identity();
    dummy.rotation.set(t * 5 + i, t * 3, i * 0.7);
    dummy.scale.setScalar(t >= 0.85 ? 0 : clods.size[i] * (1 - t * 0.4));
    dummy.updateMatrix();
    clods.mesh.setMatrixAt(i, dummy.matrix);
  }
  clods.mesh.instanceMatrix.needsUpdate = true;
}
