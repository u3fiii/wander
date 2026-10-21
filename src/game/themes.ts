import * as THREE from 'three';
import { PALETTE } from './palette.ts';
import type { PaletteKey } from './palette.ts';
import { STAGES, cardLook } from './stages.ts';
import type { Stage } from './stages.ts';

// Themes: each stage of the world (stages.ts) has its own look, and as a run moves on a stage the planet slowly takes
// on the next one, over a few seconds while the player drives on. Nothing is rebuilt: the world is always built in the base
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
  // The start screen's colours (see HomeUi).
  ui?: HomeUi;
  // The stage's own design for the start screen (the Stages tab's Home view), when it has one; otherwise the start
  // screen shows the driving design.
  home?: Look | null;
};
// A design: everything a theme sets but its name and its home-screen version.
export type Look = Omit<Theme, 'id' | 'home'>;
// The start screen's own colours in a design (blended along with the world's in a change, see App): the heading, the
// copy and the heading's dot; the main button and the second one (and their words); the dark tiles (and theirs).
export type HomeUi = { title: string; text: string; dot: string; button: string; buttonText: string; second: string; secondText: string; tile: string; tileText: string };
export const DAY_UI: HomeUi = { title: '#111111', text: '#111111', dot: '#e07a3c', button: '#f4b544', buttonText: '#2a1d05', second: '#f6f0de', secondText: '#173e3c', tile: '#20303a', tileText: '#ffffff' };
export const NIGHT_UI: HomeUi = { ...DAY_UI, title: '#f4ecd4', text: '#c9d2df', second: '#20303a', secondText: '#ffffff' };
export const uiOf = (look: Look): HomeUi => look.ui ?? DAY_UI;
export const copyLook = (look: Look): Look => ({
  colours: { ...look.colours }, sky: look.sky ? { ...look.sky } : null, sunWarmth: look.sunWarmth,
  adjust: look.adjust ? JSON.parse(JSON.stringify(look.adjust)) : undefined, weather: { kind: look.weather.kind, colours: [...look.weather.colours] },
  ui: { ...uiOf(look) },
});

// One look per stage of the world (stages.ts), in the same order: green, purple dusk, amber, night, pink, snow. The
// dusk and night looks start as copies of the green and amber ones (the time of day does the rest), and each can be
// tuned on its own in the Stages tab.
const amberLook = (): Omit<Theme, 'id'> => ({
  colours: {
    land: '#c6a463', coastWall: '#a98a56', sand: '#e8d29f', soil: '#8e6a44',
    mainTree: '#df8b3d', darkTree: '#b95a31', lightTree: '#ebb84c', accentTree: '#c8472f',
    flowerCream: '#f2c47c', buildingGreen: '#9c7a4e', roofSage: '#ad774c',
    oceanDeep: '#4a8db6', oceanShallow: '#8ac6d9',
    lightDaySkyFill: '#f6e6cc', haze: '#f0dcc2',
  },
  sky: { top: '#86b9d6', horizon: '#f6e3c8' }, sunWarmth: 1.2,
  weather: { kind: 'leaves', colours: ['#df8b3d', '#c8472f', '#ebb84c'] },
});
export const THEMES: Theme[] = [
  { id: 'meadow', colours: {}, sky: null, sunWarmth: 1, weather: { kind: 'none', colours: [] } },
  { id: 'dusk', colours: {}, sky: null, sunWarmth: 1, weather: { kind: 'none', colours: [] } },
  { id: 'amber', ...amberLook() },
  { id: 'night', ...amberLook(), ui: { ...NIGHT_UI } },
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
// Which design the world shows: the start screen's ('home') or the road's ('drive'), see Theme.home.
export type ViewMode = 'home' | 'drive';
export const view = { mode: 'drive' as ViewMode };
const wrapIndex = (index: number) => ((index % THEMES.length) + THEMES.length) % THEMES.length;
// A stage's design as the world would show it in `mode`.
export const lookOf = (index: number, mode: ViewMode = view.mode): Look => {
  const theme = THEMES[wrapIndex(index)];
  return mode === 'home' && theme.home ? theme.home : theme;
};
// The change under way: from one design to another (indices of the stages, and the designs themselves, since the
// same stage can blend from its home design to its driving one).
export const themeState = { from: 0, to: 0, progress: 1, version: 0, fromLook: THEMES[0] as Look, toLook: THEMES[0] as Look };
const themedHex = (theme: Look, key: PaletteKey) => theme.colours[key] ?? PALETTE[key];
const fromColour = new THREE.Color(), toColour = new THREE.Color(), current = new THREE.Color(), tint = new THREE.Color(), scratch = new THREE.Color();
const ease = (t: number) => t * t * (3 - 2 * t);
export const themeMix = () => ease(themeState.progress);

// Starts easing to theme `index` (or jumps there).
export function setTheme(index: number, instant = false) {
  const target = wrapIndex(index), look = lookOf(target);
  if (instant) Object.assign(themeState, { from: target, to: target, progress: 1, fromLook: look, toLook: look });
  else if (target === themeState.to && look === themeState.toLook) return;
  else Object.assign(themeState, { from: themeState.to, to: target, progress: 0, fromLook: themeState.toLook, toLook: look });
  refresh();
}
// Switches between the start screen's designs and the road's, easing over the usual few seconds (or at once).
export function setViewMode(mode: ViewMode, instant = false) {
  view.mode = mode;
  const look = lookOf(themeState.to);
  if (look === themeState.toLook) return;
  if (instant) Object.assign(themeState, { from: themeState.to, progress: 1, fromLook: look, toLook: look });
  else Object.assign(themeState, { from: themeState.to, progress: 0, fromLook: themeState.toLook, toLook: look });
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
  const from = themeState.fromLook, to = themeState.toLook, t = themeMix();
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
function adjusted(theme: Look, key: PaletteKey) {
  tint.set(themedHex(theme, key));
  const adjust = theme.adjust;
  if (!adjust || theme.colours[key] === undefined) return tint;
  const group = GROUP_OF[key] && adjust.groups ? adjust.groups[GROUP_OF[key]!] : undefined;
  tint.getHSL(hsl);
  return tint.setHSL(((hsl.h + adjust.hue + (group?.hue ?? 0)) % 1 + 1) % 1, Math.min(1, Math.max(0, hsl.s * adjust.saturation)), Math.min(1, Math.max(0, hsl.l + adjust.lightness + (group?.lightness ?? 0))));
}

// A palette colour as it looks right now (mid-change, a blend of the two themes).
export function themedColour(key: PaletteKey, out: THREE.Color, from = themeState.fromLook, to = themeState.toLook, t = themeMix()) {
  // Each theme's colour is its distance from the base colour, scaled by the strength.
  scratch.set(PALETTE[key]);
  fromColour.copy(scratch).lerp(adjusted(from, key), themeSettings.strength);
  toColour.copy(scratch).lerp(adjusted(to, key), themeSettings.strength);
  return out.copy(fromColour).lerp(toColour, t);
}
const warmthOf = (theme: Look) => 1 + (theme.sunWarmth - 1) * themeSettings.strength;
export const themeSunWarmth = () => THREE.MathUtils.lerp(warmthOf(themeState.fromLook), warmthOf(themeState.toLook), themeMix());
export const currentThemes = () => ({ from: themeState.fromLook, to: themeState.toLook, mix: themeMix() });

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

// ---- Tuning (the Stages tab of the look panel; saved values come from themeTuning.json via themeTuning.ts) ----
// Each stage's look is its theme here, plus the stage's own time of day and card colours (stages.ts), edited together.
// What can be edited per theme, and the palette colours it stands for.
export const THEME_EDIT_COLOURS = {
  land: 'land', treeMain: 'mainTree', treeDark: 'darkTree', treeLight: 'lightTree', treeAccent: 'accentTree', sea: 'oceanDeep', seaShallow: 'oceanShallow',
} as const satisfies Record<string, PaletteKey>;
export type ThemeEdit = { [K in keyof typeof THEME_EDIT_COLOURS]: string } & { skyTop: string; skyHorizon: string; sunWarmth: number; hue: number; saturation: number; lightness: number } & { [K in `${ColourGroup}Hue` | `${ColourGroup}Light`]: number }
  & { clock?: number; accent?: string; glow?: string } & Partial<Record<`home${Capitalize<keyof HomeUi>}`, string>>;
// `card`: the stage card's shared look (stages.ts cardLook). `stages`: the loop, in order (with the ones added in the
// tab, each made from the stage named in `from`). Each stage's edit is its driving design, with `home` its own
// start-screen design when it has one.
export type StageMeta = { id: string; name: string; title: string; line: string; icon: string; from?: string };
export type ThemeTuning = { strength: number; seconds: number; weather: number; card?: typeof cardLook; stages?: StageMeta[]; themes: Record<string, ThemeEdit & { home?: ThemeEdit }> };
// The Stages tab: which stage is being edited, the shared settings, and the colour pickers.
export const THEME_COLOURS = [
  { key: 'homeTitle', label: 'Home: heading' }, { key: 'homeText', label: 'Home: text' }, { key: 'homeDot', label: 'Home: heading dot' },
  { key: 'homeButton', label: 'Home: main button' }, { key: 'homeButtonText', label: 'Home: main button words' },
  { key: 'homeSecond', label: 'Home: second button' }, { key: 'homeSecondText', label: 'Home: second button words' },
  { key: 'homeTile', label: 'Home: tiles' }, { key: 'homeTileText', label: 'Home: tile words' },
  { key: 'accent', label: 'Card colour' }, { key: 'glow', label: 'Card glow' },
  { key: 'land', label: 'Ground' }, { key: 'treeMain', label: 'Trees' }, { key: 'treeDark', label: 'Dark trees' }, { key: 'treeLight', label: 'Light trees' },
  { key: 'treeAccent', label: 'Accent trees' }, { key: 'sea', label: 'Sea' }, { key: 'seaShallow', label: 'Sea (shallow)' },
  { key: 'skyTop', label: 'Sky top' }, { key: 'skyHorizon', label: 'Sky horizon' },
];
// The stages the tab can edit (and show, with their weather and time of day, over the start screen too), by the
// short names used to talk about them.
export const themeChoices = () => ({ key: 'theme', options: STAGES.map((stage, index) => ({ value: index, label: stage.name })) });
export const THEME_TUNING_SLIDERS: Array<{ key: string; label: string; min: number; max: number; step: number; group?: string }> = [
  { group: 'Time of day', key: 'clock', label: 'Day 0–0.42 · dusk 0.42–0.57 · night 0.57–0.88 · dawn', min: 0, max: 0.999, step: 0.002 },
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
  { group: 'Stage card (all stages)', key: 'cardTint', label: 'Stage colour in the card', min: 0, max: 1, step: 0.02 },
  { key: 'cardCorner', label: 'Glow in the corner', min: 0, max: 1, step: 0.02 },
  { key: 'cardBorder', label: 'Border colour', min: 0, max: 1, step: 0.02 },
  { group: 'All stages', key: 'strength', label: 'How strongly a stage tints', min: 0, max: 1.5, step: 0.05 },
  { key: 'weather', label: 'Weather amount', min: 0, max: 1, step: 0.05 },
  { key: 'seconds', label: 'Change takes (s)', min: 1, max: 12, step: 0.5 },
];
// The Stages tab, simply: five sliders that each change something you can see, and a few key colours, each of which
// sets several of the detailed ones (see App's simple-colour handling). The rest waits behind "More settings".
export const STAGE_SIMPLE_SLIDERS: Array<{ key: string; label: string; min: number; max: number; step: number; group?: string }> = [
  { key: 'clock', label: 'Time of day  ·  morning → sunset → night', min: 0, max: 0.999, step: 0.002 },
  { key: 'sunWarmth', label: 'Warmth  ·  cool → warm sunlight', min: 0, max: 1.6, step: 0.05 },
  { key: 'hue', label: 'Colour shift  ·  turns every colour round the wheel', min: -0.5, max: 0.5, step: 0.005 },
  { key: 'saturation', label: 'Colourfulness  ·  muted → vivid', min: 0, max: 2, step: 0.02 },
  { key: 'lightness', label: 'Brightness  ·  dark → bright', min: -0.3, max: 0.3, step: 0.01 },
];
export const STAGE_SIMPLE_COLOURS = [
  { key: 'simpleGround', label: 'Ground' }, { key: 'simpleTrees', label: 'Trees' }, { key: 'simpleWater', label: 'Water' },
  { key: 'simpleSky', label: 'Sky' }, { key: 'simpleCard', label: 'Card' }, { key: 'simpleButton', label: 'Home button' },
  { key: 'simpleHomeText', label: 'Home text' },
];
const PLAIN_SKY = { top: '#72cef0', horizon: '#e6f7f3' };
// A start-screen colour's field in an edit: `title` → `homeTitle`.
const uiField = (key: string) => `home${key[0].toUpperCase()}${key.slice(1)}`;

export function readThemeEdit(index: number, mode: ViewMode = 'drive'): ThemeEdit {
  const theme = lookOf(index, mode);
  const edit = { skyTop: theme.sky?.top ?? PLAIN_SKY.top, skyHorizon: theme.sky?.horizon ?? PLAIN_SKY.horizon, sunWarmth: theme.sunWarmth, hue: theme.adjust?.hue ?? 0, saturation: theme.adjust?.saturation ?? 1, lightness: theme.adjust?.lightness ?? 0 } as ThemeEdit;
  for (const group of ['ground', 'trees', 'sea'] as const) {
    (edit as unknown as Record<string, number>)[`${group}Hue`] = theme.adjust?.groups?.[group].hue ?? 0;
    (edit as unknown as Record<string, number>)[`${group}Light`] = theme.adjust?.groups?.[group].lightness ?? 0;
  }
  for (const [field, key] of Object.entries(THEME_EDIT_COLOURS)) (edit as unknown as Record<string, string>)[field] = theme.colours[key as PaletteKey] ?? PALETTE[key as PaletteKey];
  const stage = STAGES[index];
  if (stage) Object.assign(edit, { clock: mode === 'home' ? stage.homeClock ?? stage.clock : stage.clock, accent: stage.accent, glow: stage.glow });
  for (const [key, value] of Object.entries(uiOf(theme))) (edit as Record<string, unknown>)[uiField(key)] = value;
  return edit;
}
// Writes an edit into a stage's driving design, or its start-screen design (`mode` 'home', when it has its own).
export function writeThemeEdit(index: number, edit: ThemeEdit, mode: ViewMode = 'drive') {
  const theme = lookOf(index, mode);
  for (const [field, key] of Object.entries(THEME_EDIT_COLOURS)) theme.colours[key as PaletteKey] = (edit as unknown as Record<string, string>)[field];
  const ui = { ...uiOf(theme) };
  for (const key of Object.keys(ui) as Array<keyof HomeUi>) { const value = (edit as Record<string, unknown>)[uiField(key)]; if (typeof value === 'string') ui[key] = value; }
  theme.ui = ui;
  theme.sky = { top: edit.skyTop, horizon: edit.skyHorizon };
  theme.sunWarmth = edit.sunWarmth;
  const group = (name: ColourGroup) => ({ hue: edit[`${name}Hue`] ?? 0, lightness: edit[`${name}Light`] ?? 0 });
  theme.adjust = { hue: edit.hue ?? 0, saturation: edit.saturation ?? 1, lightness: edit.lightness ?? 0, groups: { ground: group('ground'), trees: group('trees'), sea: group('sea') } };
  const stage = STAGES[index];
  if (stage) {
    if (edit.clock !== undefined) {
      if (mode === 'home' && THEMES[index].home) stage.homeClock = Number(edit.clock);
      else stage.clock = Number(edit.clock);
    }
    if (edit.accent) stage.accent = edit.accent;
    if (edit.glow) stage.glow = edit.glow;
  }
}
export function currentThemeTuning(): ThemeTuning {
  return {
    ...themeSettings, card: { ...cardLook },
    stages: STAGES.map(({ id, name, title, line, icon, from }) => ({ id, name, title, line, icon, ...(from ? { from } : {}) })),
    themes: Object.fromEntries(THEMES.map((theme, index) => [theme.id, { ...readThemeEdit(index), ...(theme.home ? { home: readThemeEdit(index, 'home') } : {}) }])),
  };
}
// Lays tuning over the themes and settings, then shows it (instantly) if `show`. With a saved loop (`stages`) the
// stages are put in its order, ones added in the tab are made again from their source, and ones taken out go.
export function applyThemeTuning(tuning: ThemeTuning, show = false) {
  Object.assign(themeSettings, { strength: tuning.strength, seconds: tuning.seconds, weather: tuning.weather });
  if (tuning.card) Object.assign(cardLook, tuning.card);
  if (tuning.stages?.length) {
    const themes: Theme[] = [], stages: Stage[] = [];
    for (const meta of tuning.stages) {
      let index = STAGES.findIndex(stage => stage.id === meta.id);
      if (index < 0) index = Math.max(0, STAGES.findIndex(stage => stage.id === meta.from));
      const known = STAGES[index].id === meta.id;
      themes.push(known ? THEMES[index] : { id: meta.id, ...copyLook(THEMES[index]), home: null });
      stages.push(known ? Object.assign(STAGES[index], meta) : { ...STAGES[index], ...meta, homeClock: undefined });
    }
    THEMES.splice(0, THEMES.length, ...themes);
    STAGES.splice(0, STAGES.length, ...stages);
  }
  THEMES.forEach((theme, index) => {
    const edit = tuning.themes[theme.id];
    if (!edit) return;
    writeThemeEdit(index, edit);
    setSeparateHome(index, !!edit.home);
    if (edit.home) writeThemeEdit(index, edit.home, 'home');
  });
  themeState.to = Math.min(themeState.to, THEMES.length - 1);
  if (show) setTheme(themeState.to, true); else { Object.assign(themeState, { fromLook: lookOf(themeState.from), toLook: lookOf(themeState.to) }); refresh(); }
}

// ---- The loop of stages, edited in the Stages tab: each stage's own start-screen design, and adding, moving and
// taking out stages (the stage and its theme always move together, so their indices stay the same). ----
export function setSeparateHome(index: number, on: boolean) {
  const theme = THEMES[index], stage = STAGES[index];
  if (on && !theme.home) { theme.home = copyLook(theme); stage.homeClock = stage.clock; }
  if (!on) { theme.home = null; stage.homeClock = undefined; }
}
// A copy of stage `after`, named `name`, straight after it in the loop. Returns its index.
export function addStage(after: number, name: string) {
  const theme = THEMES[after], stage = STAGES[after];
  let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'stage';
  while (STAGES.some(item => item.id === id)) id += '-2';
  THEMES.splice(after + 1, 0, { id, ...copyLook(theme), home: theme.home ? copyLook(theme.home) : null });
  STAGES.splice(after + 1, 0, { ...stage, id, name, title: name.toUpperCase(), line: '', from: stage.from ?? stage.id });
  return after + 1;
}
// Moves stage `index` one place earlier (`step` -1) or later (+1) round the loop. Returns where it went.
export function moveStage(index: number, step: -1 | 1) {
  const to = index + step;
  if (to < 0 || to >= STAGES.length) return index;
  [THEMES[index], THEMES[to]] = [THEMES[to], THEMES[index]];
  [STAGES[index], STAGES[to]] = [STAGES[to], STAGES[index]];
  return to;
}
// Takes stage `index` out of the loop (never the last two). Returns the stage to show next.
export function removeStage(index: number) {
  if (STAGES.length <= 2) return index;
  THEMES.splice(index, 1);
  STAGES.splice(index, 1);
  return Math.min(index, STAGES.length - 1);
}
