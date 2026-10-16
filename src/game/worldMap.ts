import { IcosahedronGeometry } from 'three';
import { FULL_TURN, GLOBE_RADIUS, roadLatitude, sphereNormal, spherePoint } from './globe.ts';
import type { Vec3 } from './globe.ts';
import { PLANET_TERRAIN, planetNoise } from './planetTerrain.ts';

export const WORLD_SETTINGS = {
  roads: {
    mainWidth: 5.76,
    branchWidth: 3.8,
    shoulderExtra: 1.7,
    surfaceLift: 0.24,
    bridgeLongitude: 1.56,
    bridgeHalfSpan: 0.12,
    bridgeDeckHalfSpan: 0.1,
    bridgeHeight: 0.72,
  },
  regions: {
    citySize: 0.64,
    forestSize: 0.72,
    coastSize: 0.78,
    buildingDensity: 8,
    treeDensity: 34,
    mountainDensity: 6,
  },
} as const;

const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const smoothstep = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export type RegionKind = 'city' | 'forest' | 'coast';
export type RegionDefinition = {
  id: RegionKind;
  latitude: number;
  longitude: number;
  latitudeRadius: number;
  longitudeRadius: number;
};

const regionAtRoad = (id: RegionKind, longitude: number, radius: number, latitudeOffset = 0): RegionDefinition => ({
  id,
  longitude,
  latitude: roadLatitude(longitude) + latitudeOffset,
  latitudeRadius: radius,
  longitudeRadius: radius * 1.12,
});

export const REGIONS: RegionDefinition[] = [
  regionAtRoad('city', 0.72, WORLD_SETTINGS.regions.citySize, 0.08),
  regionAtRoad('forest', 2.75, WORLD_SETTINGS.regions.forestSize, 0.1),
  regionAtRoad('coast', 4.75, WORLD_SETTINGS.regions.coastSize, -0.09),
];

export function regionInfluence(region: RegionDefinition, latitude: number, longitude: number) {
  const dx = wrapAngle(longitude - region.longitude) * Math.max(0.35, Math.cos(region.latitude)) / region.longitudeRadius;
  const dy = (latitude - region.latitude) / region.latitudeRadius;
  const distance = Math.hypot(dx, dy);
  const edge = 1
    + 0.09 * Math.sin(longitude * 5 + region.longitude * 2)
    + 0.055 * Math.sin(latitude * 7 - region.latitude * 3);
  return smoothstep(edge, edge - 0.4, distance);
}

// The sea never comes closer to the road edge than this (metres), so the shoulder always has land beside it.
const ROAD_SHORE_MARGIN = 3.6;
// Single facets turned to water by hand: the wedge beside the bridge's south-east railing.
const WATER_CUT: ReadonlyArray<readonly [number, number]> = [[0.300, 1.685]];
const WATER_CUT_RADIUS = 0.03;

// A water channel (lat, lon polyline) that passes under the road bridge, joining the sea on both sides.
const BRIDGE_CHANNEL: ReadonlyArray<readonly [number, number]> = [[0.64, 1.3], [0.47, 1.45], [0.336, 1.56], [0.26, 1.85], [0.21, 2.25]];
const BRIDGE_CHANNEL_HALF_WIDTH = 3.2;

function distanceToChannel(latitude: number, longitude: number) {
  let nearest = Infinity;
  const cos = Math.cos(latitude);
  for (let index = 1; index < BRIDGE_CHANNEL.length; index++) {
    const [aLat, aLon] = BRIDGE_CHANNEL[index - 1];
    const [bLat, bLon] = BRIDGE_CHANNEL[index];
    const ax = wrapAngle(aLon - longitude) * cos, ay = aLat - latitude;
    const bx = wrapAngle(bLon - longitude) * cos, by = bLat - latitude;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)));
    nearest = Math.min(nearest, Math.hypot(ax + dx * t, ay + dy * t));
  }
  return nearest * GLOBE_RADIUS;
}

export function landInfluence(latitude: number, longitude: number) {
  if (WATER_CUT.some(([cutLatitude, cutLongitude]) => Math.hypot(latitude - cutLatitude,
    wrapAngle(longitude - cutLongitude) * Math.cos(latitude)) < WATER_CUT_RADIUS)) return 0;
  const [x, y, z] = sphereNormal(latitude, longitude);
  const noise = planetNoise(x, y, z);
  const region = Math.max(...REGIONS.map(candidate => regionInfluence(candidate, latitude, longitude)));
  const regionalLand = PLANET_TERRAIN.threshold - 0.08 + region * 0.24;
  const lateralRoadDistance = Math.abs(latitude - roadLatitude(longitude)) * GLOBE_RADIUS;
  const bridgeDistance = Math.abs(wrapAngle(longitude - WORLD_SETTINGS.roads.bridgeLongitude));
  const bridgeGap = bridgeDistance < WORLD_SETTINGS.roads.bridgeDeckHalfSpan * 1.12;
  const roadLand = !bridgeGap && lateralRoadDistance < WORLD_SETTINGS.roads.mainWidth * 0.5
    + WORLD_SETTINGS.roads.shoulderExtra + 1.4;
  let signal = Math.max(noise, regionalLand, roadLand ? PLANET_TERRAIN.threshold + 0.2 : 0);
  if (signal < PLANET_TERRAIN.threshold + 0.06 && !bridgeGap && lateralRoadDistance < 14
    && distanceToRoadNetwork(latitude, longitude) < ROAD_SHORE_MARGIN) {
    signal = PLANET_TERRAIN.threshold + 0.2;
  }
  if (!roadLand && Math.abs(latitude - 0.42) < 0.4 && distanceToChannel(latitude, longitude) < BRIDGE_CHANNEL_HALF_WIDTH) {
    signal = Math.min(signal, PLANET_TERRAIN.threshold - 0.2);
  }
  if (bridgeGap && lateralRoadDistance < WORLD_SETTINGS.roads.mainWidth * 0.75) {
    signal = Math.min(signal, PLANET_TERRAIN.threshold - 0.2);
  }
  return smoothstep(PLANET_TERRAIN.threshold - 0.055, PLANET_TERRAIN.threshold + 0.055, signal);
}

export function isLandAt(latitude: number, longitude: number) {
  return landInfluence(latitude, longitude) >= 0.5;
}

function naturalTerrainElevation(latitude: number, longitude: number) {
  return isLandAt(latitude, longitude) ? PLANET_TERRAIN.landHeight : 0;
}

export function roadTerrainElevation(longitude: number) {
  void longitude;
  return PLANET_TERRAIN.landHeight;
}

export function terrainElevation(latitude: number, longitude: number) {
  return naturalTerrainElevation(latitude, longitude);
}

export const MOUNTAIN_SITES = [
  { latitude: 0.95, longitude: 4.68, scale: 4, rotation: 0.35, variant: 0 },
  { latitude: -0.87, longitude: 1.89, scale: 4.3, rotation: 1.72, variant: 1 },
  { latitude: 0.67, longitude: 3.96, scale: 3.4, rotation: 2.58, variant: 0 },
  { latitude: 0.25, longitude: 5.58, scale: 3.8, rotation: 0.92, variant: 1 },
  { latitude: -0.31, longitude: 1.98, scale: 3.2, rotation: 2.16, variant: 0 },
  { latitude: -0.31, longitude: 5.4, scale: 3.5, rotation: 1.28, variant: 1 },
] as const;

// The land is drawn as flat icosahedron facets, so ground items must sit on the facet plane, not the sphere.
type Facet = { normal: Vec3; offset: number; edges: [Vec3, Vec3, Vec3]; centroid: Vec3; land?: boolean };
let facetCache: Facet[] | null = null;
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize3 = (a: Vec3): Vec3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

function landFacets() {
  if (facetCache) return facetCache;
  const geometry = new IcosahedronGeometry(1, PLANET_TERRAIN.detail);
  const position = geometry.getAttribute('position');
  const vertex = (index: number): Vec3 => [position.getX(index), position.getY(index), position.getZ(index)];
  facetCache = [];
  for (let index = 0; index < position.count; index += 3) {
    let [a, b, c] = [vertex(index), vertex(index + 1), vertex(index + 2)];
    let normal = normalize3(cross3([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
    if (dot3(normal, a) < 0) { normal = [-normal[0], -normal[1], -normal[2]]; [b, c] = [c, b]; }
    const centroid = normalize3([a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]]);
    facetCache.push({ normal, offset: dot3(normal, a), edges: [cross3(a, b), cross3(b, c), cross3(c, a)], centroid });
  }
  geometry.dispose();
  return facetCache;
}

function facetAt(direction: Vec3) {
  let best = landFacets()[0];
  let bestMargin = -Infinity;
  for (const facet of landFacets()) {
    const margin = Math.min(...facet.edges.map(edge => dot3(direction, edge)));
    if (margin > bestMargin) { best = facet; bestMargin = margin; }
    if (margin >= 0) break;
  }
  if (best.land === undefined) {
    best.land = isLandAt(Math.asin(Math.max(-1, Math.min(1, best.centroid[1]))), Math.atan2(best.centroid[0], best.centroid[2]));
  }
  return best;
}

export function terrainPoint(latitude: number, longitude: number, clearance = 0): Vec3 {
  const direction = sphereNormal(latitude, longitude);
  const facet = facetAt(direction);
  if (!facet.land) return spherePoint(latitude, longitude, terrainElevation(latitude, longitude) + clearance);
  const radius = (GLOBE_RADIUS + PLANET_TERRAIN.landHeight) * facet.offset / dot3(facet.normal, direction);
  return [
    direction[0] * radius + facet.normal[0] * clearance,
    direction[1] * radius - GLOBE_RADIUS + facet.normal[1] * clearance,
    direction[2] * radius + facet.normal[2] * clearance,
  ];
}

export function groundNormal(latitude: number, longitude: number): Vec3 {
  const facet = facetAt(sphereNormal(latitude, longitude));
  return facet.land ? facet.normal : sphereNormal(latitude, longitude);
}

export function terrainNormal(latitude: number, longitude: number): Vec3 {
  return sphereNormal(latitude, longitude);
}

export type RoadPath = {
  id: string;
  region: RegionKind | 'connector';
  closed: boolean;
  width: number;
  segments: number;
  latitudeAt: (t: number) => number;
  longitudeAt: (t: number) => number;
};

const mainLongitude = (t: number) => FULL_TURN * t;
const mainLatitude = (t: number) => roadLatitude(mainLongitude(t));

export const ROAD_PATHS: RoadPath[] = [
  { id: 'main', region: 'connector', closed: true, width: WORLD_SETTINGS.roads.mainWidth, segments: 520, latitudeAt: mainLatitude, longitudeAt: mainLongitude },
];

export function roadSurfaceElevation(latitude: number, longitude: number) {
  void latitude;
  const bridgeDistance = Math.abs(wrapAngle(longitude - WORLD_SETTINGS.roads.bridgeLongitude));
  const bridgeAmount = Math.max(0, 1 - bridgeDistance / WORLD_SETTINGS.roads.bridgeHalfSpan);
  const smoothBridgeAmount = bridgeAmount * bridgeAmount * (3 - 2 * bridgeAmount);
  return roadTerrainElevation(longitude)
    + WORLD_SETTINGS.roads.surfaceLift
    + WORLD_SETTINGS.roads.bridgeHeight * smoothBridgeAmount;
}

export function roadPoint(path: RoadPath, t: number, extraElevation = 0): Vec3 {
  const latitude = path.latitudeAt(t);
  const longitude = path.longitudeAt(t);
  return spherePoint(latitude, longitude, roadSurfaceElevation(latitude, longitude) + extraElevation);
}

export function roadPathFrame(path: RoadPath, t: number, extraElevation = 0) {
  const epsilon = 0.0005;
  const latitude = path.latitudeAt(t);
  const longitude = path.longitudeAt(t);
  const point = roadPoint(path, t, extraElevation);
  const before = roadPoint(path, t - epsilon, extraElevation);
  const after = roadPoint(path, t + epsilon, extraElevation);
  const tangent: Vec3 = [after[0] - before[0], after[1] - before[1], after[2] - before[2]];
  const length = Math.hypot(...tangent);
  tangent[0] /= length; tangent[1] /= length; tangent[2] /= length;
  const radial = sphereNormal(latitude, longitude);
  const side: Vec3 = [
    tangent[1] * radial[2] - tangent[2] * radial[1],
    tangent[2] * radial[0] - tangent[0] * radial[2],
    tangent[0] * radial[1] - tangent[1] * radial[0],
  ];
  const sideLength = Math.hypot(...side);
  side[0] /= sideLength; side[1] /= sideLength; side[2] /= sideLength;
  const normal: Vec3 = [
    side[1] * tangent[2] - side[2] * tangent[1],
    side[2] * tangent[0] - side[0] * tangent[2],
    side[0] * tangent[1] - side[1] * tangent[0],
  ];
  return { latitude, longitude, point, tangent, normal, side };
}

export function roadPathMetric(path: RoadPath, t: number) {
  const epsilon = 0.0005;
  const before = roadPoint(path, t - epsilon);
  const after = roadPoint(path, t + epsilon);
  return Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]) / (2 * epsilon);
}

export function distanceToRoadNetwork(latitude: number, longitude: number) {
  let nearest = Infinity;
  for (const path of ROAD_PATHS) {
    const samples = Math.max(32, Math.ceil(path.segments / 4));
    for (let index = 0; index <= samples; index++) {
      const t = index / samples;
      const pathLatitude = path.latitudeAt(t);
      const pathLongitude = path.longitudeAt(t);
      const dLongitude = wrapAngle(longitude - pathLongitude) * Math.cos((latitude + pathLatitude) * 0.5);
      const distance = Math.hypot(latitude - pathLatitude, dLongitude) * GLOBE_RADIUS;
      nearest = Math.min(nearest, distance - path.width * 0.5);
    }
  }
  return nearest;
}
