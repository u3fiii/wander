import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// The .glb models are Draco-compressed (about a third of their original download). Every GLTF useLoader call
// passes this so the loader can decode them; the decoder (WebAssembly) is served from /draco/.
const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`).setDecoderConfig({ type: 'wasm' });
export const withDraco = (loader: GLTFLoader) => { loader.setDRACOLoader(draco); };
