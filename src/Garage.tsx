import { Component, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CarFront, Check, X } from 'lucide-react';
import PlayerVehicle from './game/PlayerVehicle';
import { VEHICLES } from './game/vehicles';
import type { VehicleId } from './game/vehicles';
import { garageRatings, VEHICLE_PROFILES } from './game/vehicleHandling';

class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="garage-preview-error" role="alert">This car could not be loaded. Try the other car or reopen the garage.</p> : this.props.children; }
}

function PreviewOrbit() {
  const { camera, gl } = useThree();
  const orbit = useRef<OrbitControls | null>(null);
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.set(0, 0.2, 0);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = true;
    controls.minPolarAngle = Math.PI / 4;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.autoRotateSpeed = 0.7;
    orbit.current = controls;
    return () => { controls.dispose(); orbit.current = null; };
  }, [camera, gl]);
  useFrame((_, delta) => orbit.current?.update(delta));
  return null;
}

export default function Garage({ selected, onSelect, close }: {
  selected: VehicleId; onSelect: (id: VehicleId) => void; close: () => void;
}) {
  const [preview, setPreview] = useState(selected);
  const [loaded, setLoaded] = useState<VehicleId | null>(null);
  const ready = useCallback(() => setLoaded(preview), [preview]);
  const definition = VEHICLES.find(vehicle => vehicle.id === preview)!;
  const profile = VEHICLE_PROFILES[preview];
  const root = useRef<HTMLElement>(null);
  const previousFocus = useRef(document.activeElement);
  useEffect(() => () => {
    const element = previousFocus.current;
    if (element instanceof HTMLElement && element.isConnected) element.focus();
  }, []);
  return <div className="modal-shade garage-shade" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={root} className="modal garage" role="dialog" aria-modal="true" aria-labelledby="garage-title" onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const buttons = root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]');
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
      <button autoFocus className="close-button" aria-label="Close garage" onClick={close}><X /></button>
      <span className="eyebrow"><CarFront size={16} /> GARAGE</span>
      <h2 id="garage-title">Your road. Your ride.</h2>
      <div className="garage-preview" aria-label={`${definition.name} car preview`} aria-busy={loaded !== preview}>
        <PreviewBoundary key={preview}>
          <Canvas dpr={[1, 1.5]} camera={{ position: [4, 2.8, -4.7], fov: 36 }} gl={{ alpha: true, antialias: true }}>
            <ambientLight intensity={1.5} />
            <directionalLight position={[3, 6, -4]} intensity={3} />
            <directionalLight position={[-4, 3, 4]} intensity={1.5} color="#bce6ef" />
            <Suspense fallback={null}><group position={[0, -0.55, 0]}><PlayerVehicle vehicleId={preview} onReady={ready} /></group></Suspense>
            <PreviewOrbit />
          </Canvas>
        </PreviewBoundary>
        {loaded !== preview && <span className="garage-loading" role="status">Preparing your ride…</span>}
        <span className="garage-preview-hint">Drag to look around</span>
      </div>
      <div className="garage-options" role="group" aria-label="Choose your car">
        {VEHICLES.map(vehicle => <button key={vehicle.id} className={`garage-option${preview === vehicle.id ? ' selected' : ''}`} aria-pressed={preview === vehicle.id} onClick={() => { if (vehicle.id !== preview) { setLoaded(null); setPreview(vehicle.id); } }}>
          <span>{vehicle.name}</span>{selected === vehicle.id && <Check size={16} aria-label="Current car" />}
          <small>{vehicle.description}</small>
        </button>)}
      </div>
      <div className="garage-character" aria-live="polite">
        <strong>{profile.role}</strong>
        <p>{profile.strength}</p>
        <p className="garage-tradeoff">{profile.weakness}</p>
      </div>
      <div className="garage-stats" aria-label="Relative vehicle ratings">
        {garageRatings(preview).map(stat => <div key={stat.label}>
          <span>{stat.label}</span>
          <meter min={0} max={1.5} value={stat.value} aria-label={stat.label}>{Math.round(stat.value / 1.5 * 100)}%</meter>
        </div>)}
      </div>
      <p className="garage-note">Different strengths. Find your kind of drive.</p>
      <button className="primary" disabled={loaded !== preview} onClick={() => onSelect(preview)}>{preview === selected ? 'Keep this ride' : 'Choose this ride'} <Check size={18} /></button>
      <p className="garage-credit">“{definition.title}” by <a href={definition.source} target="_blank" rel="noreferrer">{definition.author}</a> · <a href={definition.licenseUrl} target="_blank" rel="noreferrer">{definition.license}</a> · adapted for Wander</p>
    </section>
  </div>;
}
