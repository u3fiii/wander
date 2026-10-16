import assert from 'node:assert/strict';
import test from 'node:test';
import { roadLatitude } from './globe.ts';
import { REGIONS, ROAD_PATHS, WORLD_SETTINGS, isLandAt, landInfluence, roadPathFrame, roadPoint, roadSurfaceElevation, roadTerrainElevation, terrainElevation, terrainNormal } from './worldMap.ts';
import { PLANET_TERRAIN, planetNoise } from './planetTerrain.ts';

const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('faceted terrain classification is deterministic and uses the configured shell height', () => {
  for (let latitudeIndex = 0; latitudeIndex <= 30; latitudeIndex++) {
    const latitude = -Math.PI / 2 + Math.PI * latitudeIndex / 30;
    for (let longitudeIndex = 0; longitudeIndex < 60; longitudeIndex++) {
      const longitude = Math.PI * 2 * longitudeIndex / 60;
      const elevation = terrainElevation(latitude, longitude);
      assert.equal(elevation, terrainElevation(latitude, longitude));
      assert.ok(elevation === 0 || elevation === PLANET_TERRAIN.landHeight);
      assert.equal(elevation > 0, isLandAt(latitude, longitude));
      const normalNoise = planetNoise(...terrainNormal(latitude, longitude));
      assert.ok(normalNoise >= 0 && normalNoise <= 1);
      const normal = terrainNormal(latitude, longitude);
      assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-6);
    }
  }
});

test('the city, forest and coast centers are separate pieces of dry land', () => {
  assert.deepEqual(REGIONS.map(region => region.id), ['city', 'forest', 'coast']);
  for (const region of REGIONS) {
    assert.ok(landInfluence(region.latitude, region.longitude) > 0.95);
    assert.equal(terrainElevation(region.latitude, region.longitude), PLANET_TERRAIN.landHeight);
  }
});

test('the road route is one continuous closed loop with a seamless join', () => {
  assert.deepEqual(ROAD_PATHS.map(path => path.id), ['main']);
  for (const path of ROAD_PATHS) {
    assert.equal(path.closed, true);
    assert.ok(distance(roadPoint(path, 0), roadPoint(path, 1)) < 1e-8);
    const beforeJoin = roadPoint(path, 1 - 1 / path.segments);
    const afterJoin = roadPoint(path, 1 / path.segments);
    assert.ok(distance(beforeJoin, roadPoint(path, 0)) < 1);
    assert.ok(distance(afterJoin, roadPoint(path, 0)) < 1);
  }
});

test('the road cross-section never flips or folds around the loop', () => {
  for (const path of ROAD_PATHS) {
    let previous = roadPathFrame(path, 0).side;
    for (let index = 1; index <= path.segments; index++) {
      const side = roadPathFrame(path, index / path.segments).side;
      const alignment = previous[0] * side[0] + previous[1] * side[1] + previous[2] * side[2];
      assert.ok(alignment > 0.99, `${path.id} frame flipped at segment ${index}`);
      previous = side;
    }
  }
});

test('road deck always clears terrain and changes height continuously', () => {
  for (const path of ROAD_PATHS) {
    let previous = roadSurfaceElevation(path.latitudeAt(0), path.longitudeAt(0));
    for (let index = 1; index <= 500; index++) {
      const t = index / 500;
      const latitude = path.latitudeAt(t), longitude = path.longitudeAt(t);
      const elevation = roadSurfaceElevation(latitude, longitude);
      const clearance = elevation - roadTerrainElevation(longitude);
      assert.ok(clearance >= WORLD_SETTINGS.roads.surfaceLift - 1e-9);
      assert.ok(clearance <= WORLD_SETTINGS.roads.surfaceLift + WORLD_SETTINGS.roads.bridgeHeight + 1e-9);
      assert.ok(Math.abs(elevation - previous) < 0.18, `${path.id} has a sharp height step`);
      previous = elevation;
    }
  }
  const bridgeLongitude = WORLD_SETTINGS.roads.bridgeLongitude;
  const bridgeLatitude = roadLatitude(bridgeLongitude);
  const bridgeClearance = roadSurfaceElevation(bridgeLatitude, bridgeLongitude)
    - roadTerrainElevation(bridgeLongitude);
  assert.ok(Math.abs(bridgeClearance - WORLD_SETTINGS.roads.surfaceLift - WORLD_SETTINGS.roads.bridgeHeight) < 1e-9);
});

test('the driving line has a gently changing vertical profile', () => {
  const samples = 1200;
  const elevations = Array.from({ length: samples }, (_, index) => roadTerrainElevation(Math.PI * 2 * index / samples));
  for (let index = 0; index < samples; index++) {
    const previous = elevations[(index - 1 + samples) % samples];
    const current = elevations[index];
    const next = elevations[(index + 1) % samples];
    assert.ok(Math.abs(next - current) < 0.025, 'road elevation changes too quickly');
    assert.ok(Math.abs(next - 2 * current + previous) < 0.006, 'road profile contains a vertical kink');
  }
});
