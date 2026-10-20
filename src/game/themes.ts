import * as THREE from 'three';
import { PALETTE } from './palette.ts';
import type { PaletteKey } from './palette.ts';

// Themes: as a run's score passes each milestone the planet slowly takes on a new look (the next theme, round and
// round), over a few seconds while the player drives on. Nothing is rebuilt: the world is always built in the base
// palette, and every themed colour is retinted as it is drawn (merged scenery in its shader, the few other things
// on the CPU), from one small table of per-colour factors that this module eases from one theme to the next.
export type Weather = { kind: 'none' | 'petals' | 'leaves' | 'snow'; colours: string[] };
// The colours that are touched up together in the Theme tab: the ground, the trees and the sea.
export type ColourGroup = 'ground' | 'trees' | 'sea';
const GROUP_OF: Partial<Record<PaletteKey, ColourGroup>> = {
  land: 'ground', coastWall: 'ground', sand: 'ground', mainTree: 'trees', darkTree: 'trees', lightTree: 'trees', accentTree: 'trees', oceanDeep: 'sea', oceanShallow: 'sea',
};
export type Theme = {
  id: string;
  colours: Partial<Record<PaletteKey, string>>;
  sky: { top: string; horizon: string } | null;
  // How much of the day look's warm (amber) sunlight the theme keeps.
  sunWarmth: number;
  // A touch-up over all of the theme's own colours (Theme tab): hue shift (a turn is 1), saturation ×, brightness added.
  adjust?: { hue: number; saturation: number; lightness: number; groups?: Record<ColourGroup, { hue: number; lightness: number }> };
  weather: Weather;
};

export const THEMES: Theme[] = [
  { id: 'meadow', colours: {}, sky: null, sunWarmth: 1, weather: { kind: 'none', colours: [] } },
  {
    id: 'amber',
    colours: {
      land: '#c6a463', coastWall: '#a98a56', sand: '#e8d29f', soil: '#8e6a44',
      mainTree: '#df8b3d', darkTree: '#b95a31', lightTree: '#ebb84c', accentTree: '#c8472f',
      flowerCream: '#f2c47c', buildingGreen: '#9c7a4e', roofSage: '#ad774c',
      oceanDeep: '#4a8db6', oceanShallow: '#8ac6d9',
      lightDaySkyFill: '#f6e6cc', haze: '#f0dcc2',
    },
    sky: { top: '#86b9d6', horizon: '#f6e3c8' }, sunWarmth: 1.2,
    weather: { kind: 'leaves', colours: ['#df8b3d', '#c8472f', '#ebb84c'] },
  },
  {
    id: 'blossom',
    colours: {
      land: '#a9c97a', coastWall: '#c7ae7c', sand: '#f3e2bb',
      mainTree: '#f2a7c0', darkTree: '#d97a9e', lightTree: '#f8c9d6', accentTree: '#fbe2e8',
      flowerCream: '#ffd9e6', oceanDeep: '#4fa6d2', oceanShallow: '#9be3ea',
      lightDaySkyFill: '#f7ecee', haze: '#f2e3ea',
    },
    sky: { top: '#7cc8ee', horizon: '#fbe9ef' }, sunWarmth: 0.8,
    weather: { kind: 'petals', colours: ['#f9d3df', '#fbe5ec'] },
  },
  {
    id: 'frost',
    colours: {
      land: '#eef3f6', coastWall: '#b7c3c9', sand: '#dfe7eb', soil: '#a3adb2',
      mainTree: '#4c7a5c', darkTree: '#3a6350', lightTree: '#dbe7ea', accentTree: '#f4f8f9',
      roofSage: '#eef3f5', roofAccent: '#f2f6f8', buildingGreen: '#7d998a',
      flowerCream: '#ffffff', fieldStone: '#e2e8ea', pavingLight: '#dde3e6', pavingDark: '#c0c8cb',
      oceanDeep: '#4a7ea6', oceanShallow: '#a2cde0',
      lightDaySkyFill: '#eef4f8', lightDayGroundFill: '#b9c3c7', haze: '#e2eef4',
    },
    sky: { top: '#9fc8e4', horizon: '#eef5f8' }, sunWarmth: 0.2,
    weather: { kind: 'snow', colours: ['#ffffff'] },
  },
];

// Score milestones: the look changes rarely, so each new one is an event. After the listed ones, every
// `MILESTONE_STEP` points brings another.
export const MILESTONES = [3000, 7000, 12000];
export const MILESTONE_STEP = 6000;
export function chapterFor(score: number) {
  let chapter = 0;
  for (const milestone of MILESTONES) if (score >= milestone) chapter++;
  const last = MILESTONES[MILESTONES.length - 1];
  if (score >= last) chapter += Math.floor((score - last) / MILESTONE_STEP);
  return chapter;
}
export const themeFor = (chapter: number) => THEMES[((chapter % THEMES.length) + THEMES.length) % THEMES.length];

// Every palette colour some theme changes gets a slot: drawn colours carry their slot, and the shader multiplies
// them by that slot's factor (themed colour ÷ base colour, per channel), so shading and per-object jitter survive.
export const THEMED_KEYS = [...new Set(THEMES.flatMap(theme => Object.keys(theme.colours)))] as PaletteKey[];
const base = THEMED_KEYS.map(key => new THREE.Color(PALETTE[key]));
export const themeSlotOf = (key: string | undefined) => (key ? THEMED_KEYS.indexOf(key as PaletteKey) : -1);
// A material's slot: the palette key it was made from, or else its colour if that is exactly one themed colour.
export function slotForColour(colour: THREE.Color, tolerance = 2e-3) {
  let found = -1;
  for (let slot = 0; slot < base.length; slot++) {
    const b = base[slot];
    if (Math.abs(b.r - colour.r) + Math.abs(b.g - colour.g) + Math.abs(b.b - colour.b) > tolerance) continue;
    if (found >= 0 && !base[found].equals(b)) return -1; // two different colours that close: leave it be
    if (found < 0) found = slot;
  }
  return found;
}
export function slotForMaterial(material: THREE.Material) {
  const keyed = themeSlotOf(material.userData.paletteKey);
  if (keyed >= 0) return keyed;
  const colour = (material as THREE.MeshStandardMaterial).color;
  return colour ? slotForColour(colour) : -1;
}

// The shared uniform the themed shaders read, and the factors behind it.
export const themeUniforms = { uThemeFactor: { value: THEMED_KEYS.map(() => new THREE.Vector3(1, 1, 1)) } };
export const THEME_SLOTS = THEMED_KEYS.length;

// How strongly a theme tints the world (0 = not at all, 1 = as designed, above 1 = pushed further), how long a change
// takes (s), and how much weather falls (× its usual amount): tuned live from the Theme tab of the look panel.
export const themeSettings = { strength: 1, seconds: 3.5, weather: 1, preview: false };
export const themeState = { from: 0, to: 0, progress: 1, version: 0 };
const themedHex = (theme: Theme, key: PaletteKey) => theme.colours[key] ?? PALETTE[key];
const fromColour = new THREE.Color(), toColour = new THREE.Color(), current = new THREE.Color(), tint = new THREE.Color(), scratch = new THREE.Color();
const ease = (t: number) => t * t * (3 - 2 * t);
export const themeMix = () => ease(themeState.progress);

// Starts easing to theme `index` (or jumps there).
export function setTheme(index: number, instant = false) {
  const target = ((index % THEMES.length) + THEMES.length) % THEMES.length;
  if (instant) Object.assign(themeState, { from: target, to: target, progress: 1 });
  else if (target === themeState.to) return;
  else Object.assign(themeState, { from: themeState.to, to: target, progress: 0 });
  refresh();
}
// Moves the change along by `dt` seconds. True while something changed (so callers retint only then).
export function advanceTheme(dt: number) {
  if (themeState.progress >= 1) return false;
  themeState.progress = Math.min(1, themeState.progress + dt / Math.max(0.1, themeSettings.seconds));
  refresh();
  return true;
}
function refresh() {
  const from = THEMES[themeState.from], to = THEMES[themeState.to], t = themeMix();
  THEMED_KEYS.forEach((key, slot) => {
    themedColour(key, current, from, to, t);
    const b = base[slot];
    themeUniforms.uThemeFactor.value[slot].set(factor(current.r, b.r), factor(current.g, b.g), factor(current.b, b.b));
  });
  themeState.version++;
}
const factor = (target: number, original: number) => Math.min(12, target / Math.max(original, 0.02));

// The theme's colour for a palette key, touched up by its hue / saturation / brightness (only colours it overrides).
const hsl = { h: 0, s: 0, l: 0 };
function adjusted(theme: Theme, key: PaletteKey) {
  tint.set(themedHex(theme, key));
  const adjust = theme.adjust;
  if (!adjust || theme.colours[key] === undefined) return tint;
  const group = GROUP_OF[key] && adjust.groups ? adjust.groups[GROUP_OF[key]!] : undefined;
  tint.getHSL(hsl);
  return tint.setHSL(((hsl.h + adjust.hue + (group?.hue ?? 0)) % 1 + 1) % 1, Math.min(1, Math.max(0, hsl.s * adjust.saturation)), Math.min(1, Math.max(0, hsl.l + adjust.lightness + (group?.lightness ?? 0))));
}

// A palette colour as it looks right now (mid-change, a blend of the two themes).
export function themedColour(key: PaletteKey, out: THREE.Color, from = THEMES[themeState.from], to = THEMES[themeState.to], t = themeMix()) {
  // Each theme's colour is its distance from the base colour, scaled by the strength.
  scratch.set(PALETTE[key]);
  fromColour.copy(scratch).lerp(adjusted(from, key), themeSettings.strength);
  toColour.copy(scratch).lerp(adjusted(to, key), themeSettings.strength);
  return out.copy(fromColour).lerp(toColour, t);
}
const warmthOf = (theme: Theme) => 1 + (theme.sunWarmth - 1) * themeSettings.strength;
export const themeSunWarmth = () => THREE.MathUtils.lerp(warmthOf(THEMES[themeState.from]), warmthOf(THEMES[themeState.to]), themeMix());
export const currentThemes = () => ({ from: THEMES[themeState.from], to: THEMES[themeState.to], mix: themeMix() });

// Merged scenery: each vertex carries its slot (`themeSlot`, -1 for colours no theme touches) and the shader
// multiplies its colour by that slot's factor. One shared uniform, so a theme change costs nothing per mesh.
export function prepareThemedMaterial(material: THREE.Material) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uThemeFactor = themeUniforms.uThemeFactor;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float themeSlot;\nuniform vec3 uThemeFactor[${THEME_SLOTS}];`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        if (themeSlot >= 0.0) vColor.rgb = min(vColor.rgb * uThemeFactor[int(themeSlot + 0.5)], vec3(1.0));`);
  };
  material.customProgramCacheKey = () => `themed-${THEME_SLOTS}`;
}
export const RETINT = { slotFor: slotForMaterial, prepare: prepareThemedMaterial };

// Everything else on the planet (not merged): its materials' and instances' colours are retinted on the CPU, from
// colours noted once when the world is built. `track` walks a finished world; `apply` retints it.
type Tracked = { materials: { material: THREE.MeshStandardMaterial; base: THREE.Color; slot: number }[]; instances: { mesh: THREE.InstancedMesh; base: Float32Array; slots: Int16Array }[] };
export function trackRetint(root: THREE.Object3D, skip: (object: THREE.Object3D) => boolean): Tracked {
  const tracked: Tracked = { materials: [], instances: [] };
  const seen = new Set<THREE.Material>();
  const visit = (object: THREE.Object3D) => {
    if (skip(object)) return;
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]) {
        if (seen.has(material) || !material.color) continue;
        seen.add(material);
        const slot = slotForMaterial(material);
        if (slot >= 0) tracked.materials.push({ material, base: material.color.clone(), slot });
      }
      const instanced = mesh as THREE.InstancedMesh;
      if (instanced.isInstancedMesh && instanced.instanceColor) {
        const colours = instanced.instanceColor.array as Float32Array;
        const slots = new Int16Array(instanced.count);
        const colour = new THREE.Color();
        let any = false;
        for (let index = 0; index < instanced.count; index++) {
          // Instances are jittered a little, so they are matched more loosely.
          slots[index] = slotForColour(colour.fromArray(colours, index * 3), 0.12);
          any ||= slots[index] >= 0;
        }
        if (any) tracked.instances.push({ mesh: instanced, base: colours.slice(), slots });
      }
    }
    object.children.forEach(visit);
  };
  visit(root);
  return tracked;
}
export function applyRetint(tracked: Tracked) {
  const factors = themeUniforms.uThemeFactor.value;
  for (const { material, base, slot } of tracked.materials) {
    const f = factors[slot];
    material.color.setRGB(Math.min(1, base.r * f.x), Math.min(1, base.g * f.y), Math.min(1, base.b * f.z));
  }
  for (const { mesh, base, slots } of tracked.instances) {
    const colours = mesh.instanceColor!.array as Float32Array;
    for (let index = 0; index < slots.length; index++) {
      const slot = slots[index];
      if (slot < 0) continue;
      const f = factors[slot], k = index * 3;
      colours[k] = Math.min(1, base[k] * f.x); colours[k + 1] = Math.min(1, base[k + 1] * f.y); colours[k + 2] = Math.min(1, base[k + 2] * f.z);
    }
    mesh.instanceColor!.needsUpdate = true;
  }
}

// ---- Tuning (the Theme tab of the look panel; saved values come from themeTuning.json via themeTuning.ts) ----
// What can be edited per theme, and the palette colours it stands for.
export const THEME_EDIT_COLOURS = {
  land: 'land', treeMain: 'mainTree', treeDark: 'darkTree', treeLight: 'lightTree', treeAccent: 'accentTree', sea: 'oceanDeep', seaShallow: 'oceanShallow',
} as const satisfies Record<string, PaletteKey>;
export type ThemeEdit = { [K in keyof typeof THEME_EDIT_COLOURS]: string } & { skyTop: string; skyHorizon: string; sunWarmth: number; hue: number; saturation: number; lightness: number } & { [K in `${ColourGroup}Hue` | `${ColourGroup}Light`]: number };
export type ThemeTuning = { strength: number; seconds: number; weather: number; themes: Record<string, ThemeEdit> };
// The Theme tab: which theme is being edited, the shared settings, and the colour pickers (the two sky colours get
// their own pair of pickers in the panel).
export const THEME_COLOURS = [
  { key: 'land', label: 'Ground' }, { key: 'treeMain', label: 'Trees' }, { key: 'treeDark', label: 'Dark trees' }, { key: 'treeLight', label: 'Light trees' },
  { key: 'treeAccent', label: 'Accent trees' }, { key: 'sea', label: 'Sea' }, { key: 'seaShallow', label: 'Sea (shallow)' },
  { key: 'skyTop', label: 'Sky top' }, { key: 'skyHorizon', label: 'Sky horizon' },
];
// The themes the tab can edit (and show, with their weather, over the start screen too).
export const THEME_CHOICES = { key: 'theme', options: [{ value: 1, label: 'Amber' }, { value: 2, label: 'Blossom' }, { value: 3, label: 'Frost' }] };
export const THEME_TUNING_SLIDERS: Array<{ key: string; label: string; min: number; max: number; step: number; group?: string }> = [
  { group: 'Light', key: 'sunWarmth', label: 'Sunlight warmth', min: 0, max: 1.6, step: 0.05 },
  { group: 'Tint all colours', key: 'hue', label: 'Hue', min: -0.5, max: 0.5, step: 0.005 },
  { key: 'saturation', label: 'Richness', min: 0, max: 2, step: 0.02 },
  { key: 'lightness', label: 'Brightness', min: -0.3, max: 0.3, step: 0.01 },
  { group: 'Ground', key: 'groundHue', label: 'Hue', min: -0.5, max: 0.5, step: 0.005 },
  { key: 'groundLight', label: 'Brightness', min: -0.3, max: 0.3, step: 0.01 },
  { group: 'Trees', key: 'treesHue', label: 'Hue', min: -0.5, max: 0.5, step: 0.005 },
  { key: 'treesLight', label: 'Brightness', min: -0.3, max: 0.3, step: 0.01 },
  { group: 'Sea', key: 'seaHue', label: 'Hue', min: -0.5, max: 0.5, step: 0.005 },
  { key: 'seaLight', label: 'Brightness', min: -0.3, max: 0.3, step: 0.01 },
  { group: 'All themes', key: 'strength', label: 'How strongly a theme tints', min: 0, max: 1.5, step: 0.05 },
  { key: 'weather', label: 'Weather amount (all themes)', min: 0, max: 1, step: 0.05 },
  { key: 'seconds', label: 'Change takes (s)', min: 1, max: 12, step: 0.5 },
];
const PLAIN_SKY = { top: '#72cef0', horizon: '#e6f7f3' };

export function readThemeEdit(index: number): ThemeEdit {
  const theme = THEMES[index];
  const edit = { skyTop: theme.sky?.top ?? PLAIN_SKY.top, skyHorizon: theme.sky?.horizon ?? PLAIN_SKY.horizon, sunWarmth: theme.sunWarmth, hue: theme.adjust?.hue ?? 0, saturation: theme.adjust?.saturation ?? 1, lightness: theme.adjust?.lightness ?? 0 } as ThemeEdit;
  for (const group of ['ground', 'trees', 'sea'] as const) {
    (edit as unknown as Record<string, number>)[`${group}Hue`] = theme.adjust?.groups?.[group].hue ?? 0;
    (edit as unknown as Record<string, number>)[`${group}Light`] = theme.adjust?.groups?.[group].lightness ?? 0;
  }
  for (const [field, key] of Object.entries(THEME_EDIT_COLOURS)) (edit as unknown as Record<string, string>)[field] = theme.colours[key as PaletteKey] ?? PALETTE[key as PaletteKey];
  return edit;
}
export function writeThemeEdit(index: number, edit: ThemeEdit) {
  const theme = THEMES[index];
  for (const [field, key] of Object.entries(THEME_EDIT_COLOURS)) theme.colours[key as PaletteKey] = (edit as unknown as Record<string, string>)[field];
  theme.sky = { top: edit.skyTop, horizon: edit.skyHorizon };
  theme.sunWarmth = edit.sunWarmth;
  const group = (name: ColourGroup) => ({ hue: edit[`${name}Hue`] ?? 0, lightness: edit[`${name}Light`] ?? 0 });
  theme.adjust = { hue: edit.hue ?? 0, saturation: edit.saturation ?? 1, lightness: edit.lightness ?? 0, groups: { ground: group('ground'), trees: group('trees'), sea: group('sea') } };
}
export function currentThemeTuning(): ThemeTuning {
  return { ...themeSettings, themes: Object.fromEntries(THEMES.slice(1).map((theme, index) => [theme.id, readThemeEdit(index + 1)])) };
}
// Lays tuning over the themes and settings, then shows it (instantly) if `show`.
export function applyThemeTuning(tuning: ThemeTuning, show = false) {
  Object.assign(themeSettings, { strength: tuning.strength, seconds: tuning.seconds, weather: tuning.weather });
  THEMES.forEach((theme, index) => { const edit = tuning.themes[theme.id]; if (edit && index > 0) writeThemeEdit(index, edit); });
  if (show) setTheme(themeState.to, true); else refresh();
}
