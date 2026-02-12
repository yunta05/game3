export const CELL = Object.freeze({
  EMPTY: 0,
  NANO: 1,
  WALL: 2,
  BLOCK: 3,
  SPLITTER: 4,
  GOAL: 5,
});

export const TOOL = Object.freeze({
  BLOCK: 'block',
  PURGE: 'purge',
  SPLITTER: 'splitter',
});

export function createGrid(width, height, fill = CELL.EMPTY) {
  return Array.from({ length: height }, () => Array(width).fill(fill));
}

export function cloneGrid(grid) {
  return grid.map((row) => [...row]);
}

export function countCells(grid, type) {
  let total = 0;
  for (const row of grid) {
    for (const cell of row) if (cell === type) total += 1;
  }
  return total;
}

export function inBounds(state, x, y) {
  return x >= 0 && y >= 0 && x < state.width && y < state.height;
}

export function neighbors(x, y, allowDiagonal) {
  const dirs = allowDiagonal
    ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  return dirs.map(([dx, dy]) => [x + dx, y + dy]);
}

export function canPlaceTool(state, tool, x, y) {
  if (!inBounds(state, x, y)) return false;
  const cell = state.grid[y][x];
  if (tool === TOOL.PURGE) return cell === CELL.NANO;
  return cell === CELL.EMPTY;
}

function isBlockingCell(cell) {
  return cell === CELL.WALL || cell === CELL.BLOCK;
}

export function applyPlayerAction(state, action) {
  const next = {
    ...state,
    grid: cloneGrid(state.grid),
    tools: { ...state.tools },
    cooldowns: { ...state.cooldowns },
    lastAction: action,
  };

  if (!action || action.type === 'wait') return next;

  if (!canPlaceTool(state, action.type, action.x, action.y)) {
    next.invalidAction = 'invalid-target';
    return next;
  }

  if ((next.tools[action.type] ?? 0) <= 0) {
    next.invalidAction = 'no-resource';
    return next;
  }

  if (action.type === TOOL.PURGE && (next.cooldowns.purge ?? 0) > 0) {
    next.invalidAction = 'cooldown';
    return next;
  }

  if (action.type === TOOL.BLOCK) {
    next.grid[action.y][action.x] = CELL.BLOCK;
    next.tools.block -= 1;
  } else if (action.type === TOOL.PURGE) {
    next.grid[action.y][action.x] = CELL.EMPTY;
    next.tools.purge -= 1;
    next.cooldowns.purge = state.rules.purgeCooldown;
  } else if (action.type === TOOL.SPLITTER) {
    next.grid[action.y][action.x] = CELL.SPLITTER;
    next.tools.splitter -= 1;
  }

  return next;
}

export function predictGrowthCells(state) {
  const targets = new Set();
  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      if (state.grid[y][x] !== CELL.NANO) continue;
      for (const [nx, ny] of neighbors(x, y, state.rules.diagonalGrowth)) {
        if (!inBounds(state, nx, ny)) continue;
        const targetCell = state.grid[ny][nx];
        if (targetCell === CELL.EMPTY || targetCell === CELL.GOAL) {
          targets.add(`${nx},${ny}`);
        }
      }
    }
  }
  return targets;
}

export function runGrowthPhase(state) {
  const nextGrid = cloneGrid(state.grid);
  const growthTargets = [];

  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      if (state.grid[y][x] !== CELL.NANO) continue;

      for (const [nx, ny] of neighbors(x, y, state.rules.diagonalGrowth)) {
        if (!inBounds(state, nx, ny)) continue;
        const targetCell = state.grid[ny][nx];
        if (isBlockingCell(targetCell) || targetCell === CELL.SPLITTER) continue;
        if (targetCell === CELL.EMPTY || targetCell === CELL.GOAL) {
          growthTargets.push([nx, ny]);
        }
      }
    }
  }

  for (const [x, y] of growthTargets) {
    nextGrid[y][x] = CELL.NANO;
  }

  return {
    ...state,
    grid: nextGrid,
    growthTargets,
  };
}

export function tickCooldowns(state) {
  const cooldowns = { ...state.cooldowns };
  for (const key of Object.keys(cooldowns)) cooldowns[key] = Math.max(0, cooldowns[key] - 1);
  return { ...state, cooldowns };
}

export function evaluateState(state) {
  const nanoCount = countCells(state.grid, CELL.NANO);
  const boardCells = state.width * state.height;
  const nanoRatio = nanoCount / boardCells;
  const goalBreached = state.goalCells.some(([x, y]) => state.grid[y][x] === CELL.NANO);

  const survivalMet = state.turn >= state.win.surviveTurns;
  const eradicateMet = state.win.eradicateAll && nanoCount === 0;
  const goalMet = state.win.protectGoalTurns > 0 && state.turn >= state.win.protectGoalTurns && !goalBreached;
  const won = !goalBreached && (survivalMet || eradicateMet || goalMet);

  const lostByRatio = nanoRatio > state.lose.maxNanoRatio;
  const lostByTurns = state.turn >= state.lose.maxTurns && !won;
  const noMoves = Object.values(state.tools).every((v) => v <= 0) && nanoCount > 0;
  const lost = goalBreached || lostByRatio || lostByTurns || (state.lose.stuckLose && noMoves);

  return {
    nanoCount,
    nanoRatio,
    goalBreached,
    won,
    lost,
  };
}

export function initState(level) {
  const grid = createGrid(level.width, level.height, CELL.EMPTY);

  for (const [x, y] of level.walls) grid[y][x] = CELL.WALL;
  for (const [x, y] of level.goals) grid[y][x] = CELL.GOAL;
  for (const [x, y] of level.nanos) grid[y][x] = CELL.NANO;

  return {
    id: level.id,
    name: level.name,
    width: level.width,
    height: level.height,
    grid,
    turn: 0,
    tools: { ...level.tools },
    cooldowns: { purge: 0 },
    goalCells: level.goals,
    rules: {
      diagonalGrowth: level.rules.diagonalGrowth,
      purgeCooldown: level.rules.purgeCooldown,
    },
    win: { ...level.win },
    lose: { ...level.lose },
    invalidAction: null,
    lastNanoCount: countCells(grid, CELL.NANO),
    growthTargets: [],
  };
}

export function advanceTurn(state, action) {
  let next = applyPlayerAction(state, action);
  next.invalidAction = next.invalidAction ?? null;
  next = runGrowthPhase(next);
  next = tickCooldowns(next);
  next.turn += 1;

  const evaluation = evaluateState(next);
  const prevNano = state.lastNanoCount;
  const increase = evaluation.nanoCount - prevNano;
  const growthRate = prevNano === 0 ? 0 : evaluation.nanoCount / prevNano;

  return {
    ...next,
    lastNanoCount: evaluation.nanoCount,
    stats: {
      nanoCount: evaluation.nanoCount,
      increase,
      growthRate,
      predictedNext: predictGrowthCells(next).size,
    },
    outcome: evaluation,
  };
}
