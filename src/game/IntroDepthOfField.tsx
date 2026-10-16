import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ACTIVE_QUALITY, ART_DIRECTION } from './artDirection';
import { GLOBE_RADIUS } from './globe';
import type { CarState } from './driving';
import { cinematicState } from './cinematic';

const settings = ART_DIRECTION.introDepthOfField;
const driving = ART_DIRECTION.drivingDepthOfField;
const boostSettings = ART_DIRECTION.boostDepthOfField;
const crashSettings = ART_DIRECTION.crashDepthOfField;
const crashPoint = new THREE.Vector3();

// The color pass includes atmospheric glow; the depth pass must see the actual
// ground instead of treating transparent glow shells/particles as solid terrain.
class SurfaceBokehPass extends BokehPass {
  declare uniforms: Record<string, THREE.IUniform>;
  private hidden: THREE.Object3D[] = [];

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
    this.scene.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.every(material => material.transparent && !material.depthWrite)) this.hidden.push(object);
    });
    this.hidden.forEach(object => { object.visible = false; });
    // The color pass already refreshed shadows; depth-only rendering needs none.
    const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    try { super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive); }
    finally {
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      this.hidden.forEach(object => { object.visible = true; });
      this.hidden.length = 0;
    }
  }
}

type Pipeline = { composer: EffectComposer; bokeh: SurfaceBokehPass; output: OutputPass; dispose: () => void };

export default function IntroDepthOfField({ zoom, globe, vehicle, car, active }: {
  zoom: RefObject<number>; globe: RefObject<THREE.Group>; vehicle: RefObject<THREE.Group>;
  car: RefObject<CarState>; active: boolean;
}) {
  const { gl, scene, camera, size, viewport } = useThree();
  const pipeline = useRef<Pipeline | null>(null);
  const focus = useRef<number | null>(null);
  const amount = useRef(1);
  const boostAmount = useRef(0);
  const center = useRef(new THREE.Vector3());
  const surface = useRef(new THREE.Vector3());
  const carFocus = useRef(new THREE.Vector3());
  const forward = useRef(new THREE.Vector3());
  const orientation = useRef(new THREE.Quaternion());

  useEffect(() => {
    if ((!settings.enabled && !driving.enabled) || !ACTIVE_QUALITY.depthOfField || new URLSearchParams(window.location.search).get('introDof') === 'off') return;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    target.samples = Math.min(4, gl.capabilities.maxSamples);
    const composer = new EffectComposer(gl, target);
    const color = new RenderPass(scene, camera);
    const bokeh = new SurfaceBokehPass(scene, camera as THREE.PerspectiveCamera, {
      focus: 85, aperture: settings.aperture, maxblur: settings.maxBlur,
    });
    // A wide sharp band keeps a whole neighbourhood readable, rather than a
    // single thin focal plane. Preserve canvas alpha over the CSS sky gradient.
    bokeh.uniforms.focusRange = { value: GLOBE_RADIUS * settings.focusRangeFactor };
    bokeh.uniforms.nearBlur = { value: 1 };
    // Beyond the globe and its clouds there is only the moon (and the empty sky): keep that sharp, since
    // anything that far would otherwise get the maximum blur and turn the moon into a smudge.
    bokeh.uniforms.sharpBeyond = { value: 1e6 };
    bokeh.materialBokeh.fragmentShader = bokeh.materialBokeh.fragmentShader
      .replace('uniform float focus;', 'uniform float focus;\nuniform float focusRange;\nuniform float nearBlur;\nuniform float sharpBeyond;')
      .replace('vec2 dofblur =', 'factor = sign(factor) * max(abs(factor) - focusRange, 0.0);\nif (factor > 0.0) factor *= nearBlur;\nif (-viewZ > sharpBeyond) factor = 0.0;\nvec2 dofblur =')
      .replace('gl_FragColor.a = 1.0;', 'gl_FragColor.a = col.a / 41.0;');
    const output = new OutputPass();
    // The canvas sits over a CSS sky. Convert unpremultiplied color, then restore
    // premultiplication so transparent atmosphere edges do not become bright halos.
    // A cool hit gets its own look here (uGrade 0..1): faded, bleached colour with firm contrast and very soft
    // light glowing out of the highlights.
    output.material.uniforms.uGrade = { value: 0 };
    output.material.uniforms.uTexel = { value: new THREE.Vector2(1, 1) };
    // Head-on crashes (the red ones) push the contrast up instead (uImpact 0..1).
    output.material.uniforms.uImpact = { value: 0 };
    output.material.fragmentShader = output.material.fragmentShader
      .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\nuniform float uGrade;\nuniform vec2 uTexel;\nuniform float uImpact;')
      .replace('gl_FragColor = texture2D( tDiffuse, vUv );', `gl_FragColor = texture2D( tDiffuse, vUv );
 gl_FragColor.rgb /= max(gl_FragColor.a, 0.00001);
 vec3 softLight = gl_FragColor.rgb;
 if (uGrade > 0.001) {
   vec2 r = uTexel * 5.0;
   vec4 around = texture2D(tDiffuse, vUv + vec2(r.x, 0.0)) + texture2D(tDiffuse, vUv - vec2(r.x, 0.0))
     + texture2D(tDiffuse, vUv + vec2(0.0, r.y)) + texture2D(tDiffuse, vUv - vec2(0.0, r.y))
     + texture2D(tDiffuse, vUv + r) + texture2D(tDiffuse, vUv - r)
     + texture2D(tDiffuse, vUv + vec2(r.x, -r.y)) + texture2D(tDiffuse, vUv + vec2(-r.x, r.y));
   softLight = around.rgb / max(around.a, 0.00001);
 }`)
      .replace('\n\t\t}', `
 if (uGrade > 0.001) {
   float luma = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
   // Faded and bleached rather than grey: half the colour drained and lifted toward a pale cream, a firm
   // S-curve for contrast, then a gentle glow (a wide blur of the frame) blooming out of the highlights.
   float punchy = clamp((luma - 0.55) * 1.35 + 0.55, 0.0, 1.0);
   punchy = punchy * punchy * (3.0 - 2.0 * punchy);
   vec3 tone = mix(gl_FragColor.rgb, vec3(luma), 0.5) * (punchy / max(luma, 0.0001));
   tone = mix(tone, vec3(0.97, 0.94, 0.88), 0.12);
   float softLuma = dot(softLight, vec3(0.299, 0.587, 0.114));
   vec3 bloom = vec3(smoothstep(0.45, 1.0, softLuma)) * vec3(1.0, 0.98, 0.94);
   vec3 graded = tone + bloom * 0.35 * (1.0 - tone * 0.5);
   gl_FragColor.rgb = clamp(mix(gl_FragColor.rgb, graded, uGrade), 0.0, 1.0);
 }
 float edge = smoothstep(0.3, 0.85, length((vUv - 0.5) * vec2(1.0, 1.2)));
 if (uImpact > 0.001) {
   // Head-on crash: a red grade (brightness mapped onto a dark-to-light red ramp, deeper toward the edges) and a hard contrast curve,
   // drawn here in one pass so the red and the contrast always rise and fade together.
   vec3 base = gl_FragColor.rgb;
   float baseLuma = dot(base, vec3(0.299, 0.587, 0.114));
   vec3 redTone = mix(vec3(0.16, 0.01, 0.01), vec3(1.0, 0.38, 0.32), baseLuma);
   vec3 tinted = mix(base, redTone, 0.68 + 0.22 * edge) * (1.0 - edge * 0.3);
   vec3 contrasted = clamp((tinted - 0.5) * 1.45 + 0.5, 0.0, 1.0);
   contrasted = contrasted * contrasted * (3.0 - 2.0 * contrasted);
   gl_FragColor.rgb = mix(base, mix(tinted, contrasted, 0.85), uImpact);
 }
 // Cinematic finish, always on and very light: highlights take a touch of warmth, and the frame settles with a
 // soft vignette, so the whole scene reads as one warm, filmic picture.
 float finishLuma = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
 vec2 vignetteOffset = vUv - 0.5;
 float vignette = 1.0 - dot(vignetteOffset, vignetteOffset) * 0.5;
 gl_FragColor.rgb *= mix(vec3(1.0), vec3(1.035, 1.0, 0.94), smoothstep(0.35, 1.0, finishLuma));
 gl_FragColor.rgb *= mix(1.0, vignette, 0.55);
 gl_FragColor.rgb *= gl_FragColor.a;
 if (uImpact > 0.001) {
   // The sky is CSS behind the canvas, so the crash's dark red vignette is laid over it here too.
   float veil = edge * 0.5 * uImpact;
   gl_FragColor = vec4(vec3(0.5, 0.05, 0.04) * veil + gl_FragColor.rgb * (1.0 - veil), veil + gl_FragColor.a * (1.0 - veil));
 }
\t\t}`);
    composer.addPass(color); composer.addPass(bokeh); composer.addPass(output);
    pipeline.current = { composer, bokeh, output, dispose: () => {
      color.dispose(); bokeh.dispose(); output.dispose(); composer.dispose();
    } };
    return () => { pipeline.current?.dispose(); pipeline.current = null; };
  }, [gl, scene, camera]);

  useEffect(() => {
    const current = pipeline.current;
    if (!current) return;
    current.composer.setPixelRatio(Math.min(viewport.dpr, 1.5));
    current.composer.setSize(size.width, size.height);
    const ratio = Math.min(viewport.dpr, 1.5);
    current.output.material.uniforms.uTexel.value.set(1 / (size.width * ratio), 1 / (size.height * ratio));
    current.bokeh.uniforms.aspect.value = size.width / Math.max(1, size.height);
  }, [size.width, size.height, viewport.dpr]);

  // Run after the camera and vehicle update. Driving keeps a wider sharp band
  // and disables foreground blur, protecting the car and the road beneath it.
  useFrame((_, delta) => {
    const current = pipeline.current;
    if (!current) { gl.render(scene, camera); return; }
    const dt = Math.min(delta, 0.05);
    const boostActive = boostSettings.enabled && active && car.current.boosting > 0 && car.current.speed > 2;
    boostAmount.current = THREE.MathUtils.damp(boostAmount.current, boostActive ? 1 : 0, boostActive ? boostSettings.attack : boostSettings.release, dt);
    const boost = THREE.MathUtils.smoothstep(boostAmount.current, 0, 1);
    const blend = THREE.MathUtils.smoothstep(zoom.current, 0, driving.transitionEnd);
    const overviewAmount = settings.enabled ? 1 - blend : 0;
    const drivingAmount = driving.enabled ? blend : 0;
    const desired = overviewAmount + drivingAmount;
    amount.current = THREE.MathUtils.damp(amount.current, desired, settings.damping, dt);
    if (desired === 0 && amount.current < 0.002) {
      amount.current = 0; gl.render(scene, camera); return;
    }
    camera.updateMatrixWorld();
    if (globe.current) {
      globe.current.getWorldPosition(center.current);
      surface.current.copy(camera.position).sub(center.current).normalize()
        .multiplyScalar(GLOBE_RADIUS + settings.surfaceOffset).add(center.current);
      const overviewDepth = -surface.current.applyMatrix4(camera.matrixWorldInverse).z;
      let drivingDepth = overviewDepth;
      if (vehicle.current && drivingAmount > 0) {
        vehicle.current.getWorldPosition(carFocus.current);
        vehicle.current.getWorldQuaternion(orientation.current);
        forward.current.set(0, 0, -1).applyQuaternion(orientation.current);
        carFocus.current.addScaledVector(forward.current, driving.lookAhead);
        drivingDepth = -carFocus.current.applyMatrix4(camera.matrixWorldInverse).z;
      }
      const depth = THREE.MathUtils.lerp(overviewDepth, drivingDepth, blend);
      focus.current = focus.current === null ? depth : THREE.MathUtils.damp(focus.current, depth, settings.damping, dt);
      current.bokeh.uniforms.focus.value = Math.max(camera.near, focus.current);
      current.bokeh.uniforms.sharpBeyond.value = camera.position.distanceTo(center.current) + GLOBE_RADIUS * 1.8;
    }
    const drivingFocusRange = THREE.MathUtils.lerp(driving.focusRange, boostSettings.focusRange, boost);
    const drivingAperture = THREE.MathUtils.lerp(driving.aperture, boostSettings.aperture, boost);
    const drivingMaxBlur = THREE.MathUtils.lerp(driving.maxBlur, boostSettings.maxBlur, boost);
    current.bokeh.uniforms.focusRange.value = THREE.MathUtils.lerp(GLOBE_RADIUS * settings.focusRangeFactor, drivingFocusRange, blend);
    current.bokeh.uniforms.nearBlur.value = 1 - blend;
    current.bokeh.uniforms.aperture.value = (settings.aperture * overviewAmount + drivingAperture * drivingAmount) * amount.current;
    current.bokeh.uniforms.maxblur.value = (settings.maxBlur * overviewAmount + drivingMaxBlur * drivingAmount) * amount.current;
    // Crash cut-in: lock focus on the crash and exaggerate the blur in front of and behind it.
    const crash = cinematicState.crash;
    if (crash > 0) {
      const uniforms = current.bokeh.uniforms;
      const crashDepth = -crashPoint.copy(cinematicState.focus).applyMatrix4(camera.matrixWorldInverse).z;
      uniforms.focus.value = THREE.MathUtils.lerp(uniforms.focus.value, Math.max(camera.near, crashDepth), crash);
      uniforms.focusRange.value = THREE.MathUtils.lerp(uniforms.focusRange.value, crashSettings.focusRange, crash);
      uniforms.nearBlur.value = THREE.MathUtils.lerp(uniforms.nearBlur.value, 1, crash);
      uniforms.aperture.value = THREE.MathUtils.lerp(uniforms.aperture.value, crashSettings.aperture, crash);
      uniforms.maxblur.value = THREE.MathUtils.lerp(uniforms.maxblur.value, crashSettings.maxBlur, crash);
    }
    current.output.material.uniforms.uGrade.value = cinematicState.cool;
    current.output.material.uniforms.uImpact.value = Math.max(0, cinematicState.crash - cinematicState.cool);
    current.composer.render(dt);
  }, 1);

  return null;
}
