import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, STAGE_POINTS, nextMorning, stageAt, stageProgress, stagesReached, stageTime, themeForStage } from './stages.ts';
import { nightAmount } from './dayCycle.ts';
import { THEMES } from './themes.ts';

test('the stages run day, purple dusk, amber, night, blossom, snow, and round again', () => {
  assert.deepEqual(STAGES.map(stage => stage.id), ['meadow', 'dusk', 'amber', 'night', 'blossom', 'frost']);
  assert.deepEqual(STAGES.map(stage => stage.name), ['Green', 'Purple', 'Amber', 'Night', 'Pink', 'Snow']);
  assert.ok(nightAmount(stageTime(1)) > 0 && nightAmount(stageTime(1)) < 1, 'purple is dusk');
  assert.equal(nightAmount(stageTime(3)), 1, 'night is night');
  assert.equal(nightAmount(stageTime(0)), 0, 'green is day');
  assert.equal(stageAt(6).id, 'meadow');
  assert.deepEqual(THEMES.map(theme => theme.id), STAGES.map(stage => stage.id), 'every stage has its own theme, in order');
});

test('the theme number only ever goes up, round after round, so every change eases in', () => {
  let last = -1;
  for (let stage = 0; stage < 30; stage++) {
    const theme = themeForStage(stage);
    assert.ok(theme >= last, `stage ${stage}`);
    assert.equal(THEMES[theme % THEMES.length].id, STAGES[stage % STAGES.length].id, `stage ${stage} shows its own look`);
    last = theme;
  }
});

test("a run starts on the next fresh morning and moves on every stage's worth of points", () => {
  assert.equal(nextMorning(0), 0);
  assert.equal(nextMorning(3), 6);
  assert.equal(nextMorning(6), 6);
  assert.equal(stagesReached(STAGE_POINTS - 1), 0);
  assert.equal(stagesReached(STAGE_POINTS * 2 + 5), 2);
  assert.equal(stageProgress(STAGE_POINTS * 1.5), 0.5);
});

test('the loop can grow, be reordered and shrink, the stage and its look always together', async () => {
  const { THEMES, addStage, moveStage, removeStage } = await import('./themes.ts');
  const before = STAGES.map(stage => stage.id);
  const added = addStage(2, 'Copper');
  assert.equal(STAGES[added].name, 'Copper');
  assert.equal(THEMES[added].id, STAGES[added].id, 'its own look, at the same place');
  assert.deepEqual(THEMES[added].colours, THEMES[2].colours, 'starting as a copy of the one it came from');
  assert.notEqual(THEMES[added].colours, THEMES[2].colours, 'but its own copy');
  const moved = moveStage(added, -1);
  assert.equal(STAGES[moved].name, 'Copper');
  assert.equal(THEMES[moved].id, STAGES[moved].id);
  removeStage(moved);
  assert.deepEqual(STAGES.map(stage => stage.id), before);
  assert.deepEqual(THEMES.map(theme => theme.id), before);
});

test('a stage can have its own start-screen design, and switching to it eases instead of snapping', async () => {
  const { THEMES, setSeparateHome, setTheme, setViewMode, themeState, advanceTheme, view } = await import('./themes.ts');
  setSeparateHome(2, true);
  THEMES[2].home!.colours.land = '#ff0000';
  setViewMode('drive', true);
  setTheme(2, true);
  setViewMode('home');
  assert.ok(themeState.progress < 1, 'eases');
  assert.equal(themeState.toLook, THEMES[2].home);
  advanceTheme(100);
  assert.equal(themeState.progress, 1);
  assert.equal(stageTime(2, true), stageTime(2), 'the start screen starts at the same time of day');
  setSeparateHome(2, false);
  setViewMode('drive', true);
  assert.equal(view.mode, 'drive');
  setTheme(0, true);
});
