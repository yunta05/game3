import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL, TOOL, advanceTurn, initState } from '../src/logic.js';

function baseLevel() {
  return {
    id: 99,
    name: 'test',
    width: 5,
    height: 5,
    nanos: [[2, 2]],
    walls: [],
    goals: [],
    tools: { block: 3, purge: 2, splitter: 1 },
    rules: { diagonalGrowth: false, purgeCooldown: 2 },
    win: { surviveTurns: 20, eradicateAll: false, protectGoalTurns: 0 },
    lose: { maxNanoRatio: 1, maxTurns: 20, stuckLose: false },
  };
}

test('growth is simultaneous and does not chain in one turn', () => {
  const state = initState(baseLevel());
  const next = advanceTurn(state, { type: 'wait' });

  assert.equal(next.grid[2][2], CELL.NANO);
  assert.equal(next.grid[1][2], CELL.NANO);
  assert.equal(next.grid[3][2], CELL.NANO);
  assert.equal(next.grid[2][1], CELL.NANO);
  assert.equal(next.grid[2][3], CELL.NANO);
  assert.equal(next.grid[0][2], CELL.EMPTY);
});

test('block prevents erosion', () => {
  const state = initState(baseLevel());
  const placed = advanceTurn(state, { type: TOOL.BLOCK, x: 2, y: 1 });
  assert.equal(placed.grid[1][2], CELL.BLOCK);
});

test('purge removes nano with cooldown', () => {
  const state = initState(baseLevel());
  const purged = advanceTurn(state, { type: TOOL.PURGE, x: 2, y: 2 });
  assert.equal(purged.grid[2][2], CELL.EMPTY);
  assert.equal(purged.cooldowns.purge, 1);
});

test('goal breach loses level', () => {
  const level = baseLevel();
  level.goals = [[2, 1]];
  const state = initState(level);
  const next = advanceTurn(state, { type: 'wait' });
  assert.equal(next.outcome.goalBreached, true);
  assert.equal(next.outcome.lost, true);
});
