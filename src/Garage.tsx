import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ArrowRight, ChevronLeft, ChevronRight, X } from 'lucide-react';
import PlayerVehicle from './game/PlayerVehicle';
import { VEHICLES } from './game/vehicles';
import type { VehicleId } from './game/vehicles';
import { garageRatings, VEHICLE_PROFILES } from './game/vehicleHandling';

// The garage is a showroom: one car on a slowly turning platform, its name, one line about how it drives and four
// ratings, arrows (or ← →, or the pad) to the next car, and one button to drive it.

class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="garage-preview-error" role="alert">This car could not be loaded. Try another one or reopen the garage.</p> : this.props.children; }
}

function PreviewOrbit() {
  const { camera, gl } = useThree();
  const orbit = useRef<OrbitControls | null>(null);
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.set(0, 0.55, 0);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = true;
    controls.minPolarAngle = Math.PI / 4;
    controls.maxPolarAngle = Math.PI / 2.15;
    controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.autoRotateSpeed = 0.9;
    orbit.current = controls;
    return () => { controls.dispose(); orbit.current = null; };
  }, [camera, gl]);
  useFrame((_, delta) => orbit.current?.update(delta));
  return null;
}

// A soft round shadow under the car on the platform.
function useShadowTexture() {
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.25)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
  }, []);
}

// The car arriving on the platform: it settles in from a little smaller and lower each time it changes.
function Arrival({ id, children }: { id: VehicleId; children: ReactNode }) {
  const group = useRef<THREE.Group>(null!);
  const clock = useRef(0);
  useEffect(() => { clock.current = 0; }, [id]);
  useFrame((_, delta) => {
    clock.current = Math.min(1, clock.current + delta * 2.6);
    const t = 1 - Math.pow(1 - clock.current, 3);
    group.current.scale.setScalar(0.82 + 0.18 * t);
    group.current.position.y = -0.25 * (1 - t);
  });
  return <group ref={group}>{children}</group>;
}

function Stage({ id, onReady }: { id: VehicleId; onReady: () => void }) {
  const shadow = useShadowTexture();
  return <>
    <ambientLight intensity={1.4} />
    <directionalLight position={[3, 6, -4]} intensity={3} />
    <directionalLight position={[-4, 3, 4]} intensity={1.4} color="#bce6ef" />
    <group position={[0, -0.1, 0]}>
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <cylinderGeometry args={[2.35, 2.45, 0.12, 64]} />
        <meshStandardMaterial color="#2b3a42" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3.6, 3.6]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} />
      </mesh>
      <Suspense fallback={null}>
        <Arrival id={id}><PlayerVehicle key={id} vehicleId={id} onReady={onReady} /></Arrival>
      </Suspense>
    </group>
    <PreviewOrbit />
  </>;
}

// A rating as five segments, spread over the range the cars actually cover so their differences show.
const segments = (value: number) => Math.max(1, Math.min(5, Math.round(((value - 0.6) / 0.8) * 5)));

export default function Garage({ selected, onSelect, close }: {
  selected: VehicleId; onSelect: (id: VehicleId) => void; close: () => void;
}) {
  const [preview, setPreview] = useState(selected);
  const [loaded, setLoaded] = useState<VehicleId | null>(null);
  const ready = useCallback(() => setLoaded(preview), [preview]);
  const index = VEHICLES.findIndex(vehicle => vehicle.id === preview);
  const definition = VEHICLES[index];
  const profile = VEHICLE_PROFILES[preview];
  const root = useRef<HTMLElement>(null);
  const previousFocus = useRef(document.activeElement);
  const go = useCallback((step: number) => {
    const next = VEHICLES[(index + step + VEHICLES.length) % VEHICLES.length].id;
    setLoaded(null);
    setPreview(next);
  }, [index]);
  useEffect(() => () => {
    const element = previousFocus.current;
    if (element instanceof HTMLElement && element.isConnected) element.focus();
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') { event.preventDefault(); go(-1); }
      if (event.code === 'ArrowRight' || event.code === 'KeyD') { event.preventDefault(); go(1); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [go]);
  return <div className="modal-shade garage-shade" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={root} className="garage" role="dialog" aria-modal="true" aria-labelledby="garage-title" onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const buttons = root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]');
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
      <button className="close-button garage-close" aria-label="Close garage" onClick={close}><X /></button>
      <div className="garage-stage" aria-label={`${definition.name}, turning on its platform`} aria-busy={loaded !== preview}>
        <PreviewBoundary>
          <Canvas dpr={[1, 1.75]} camera={{ position: [4.6, 2.6, -5.2], fov: 32 }} gl={{ alpha: true, antialias: true }}>
            <Stage id={preview} onReady={ready} />
          </Canvas>
        </PreviewBoundary>
        <button className="garage-arrow previous" aria-label="Previous car" onClick={() => go(-1)}><ChevronLeft /></button>
        <button className="garage-arrow next" aria-label="Next car" onClick={() => go(1)}><ChevronRight /></button>
      </div>
      <div key={preview} className="garage-info" aria-live="polite">
        <span className="garage-role">{profile.role}{selected === preview && <em>Your car</em>}</span>
        <h2 id="garage-title">{definition.name}</h2>
        <p>{profile.strength}</p>
        <div className="garage-ratings" aria-label="How it drives">
          {garageRatings(preview).map(stat => {
            const filled = segments(stat.value);
            return <div key={stat.label} aria-label={`${stat.label} ${filled} of 5`}>
              <span>{stat.label}</span>
              <i>{Array.from({ length: 5 }, (_, i) => <b key={i} className={i < filled ? 'on' : ''} style={{ '--i': i } as CSSProperties} />)}</i>
            </div>;
          })}
        </div>
      </div>
      <div className="garage-pager" aria-hidden="true">{VEHICLES.map(vehicle => <i key={vehicle.id} className={vehicle.id === preview ? 'on' : ''} />)}</div>
      <button autoFocus className="primary garage-go" disabled={loaded !== preview} onClick={() => onSelect(preview)}>
        {preview === selected ? 'Keep driving this' : `Drive the ${definition.name}`} <ArrowRight size={18} />
      </button>
      <p className="garage-credit">“{definition.title}” by <a href={definition.source} target="_blank" rel="noreferrer">{definition.author}</a> · <a href={definition.licenseUrl} target="_blank" rel="noreferrer">{definition.license}</a></p>
    </section>
  </div>;
}
