import { CELL, TOOL, advanceTurn, evaluateState, initState, predictGrowthCells } from './logic.js';
import { LEVELS } from './levels.js';

const STORAGE_KEY = 'nano-puzzle-v1';

const els = {
  levelSelect: document.getElementById('level-select'),
  canvas: document.getElementById('board-canvas'),
  turn: document.getElementById('turn'),
  nano: document.getElementById('nano-count'),
  growth: document.getElementById('growth-rate'),
  prediction: document.getElementById('prediction'),
  message: document.getElementById('message'),
  restart: document.getElementById('restart-btn'),
  endTurn: document.getElementById('end-turn-btn'),
  predictToggle: document.getElementById('predict-toggle'),
  block: document.getElementById('tool-block'),
  purge: document.getElementById('tool-purge'),
  splitter: document.getElementById('tool-splitter'),
  cleared: document.getElementById('cleared-count'),
};

const ctx = els.canvas.getContext('2d');

const app = {
  levelIndex: 0,
  state: null,
  selectedTool: TOOL.BLOCK,
  settings: { predict: true },
  progress: {},
};

function loadStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    app.progress = parsed.progress ?? {};
    app.settings = { ...app.settings, ...(parsed.settings ?? {}) };
  } catch (_e) {
    app.progress = {};
  }
}

function saveStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ progress: app.progress, settings: app.settings }));
}

function setupLevelOptions() {
  for (const [index, level] of LEVELS.entries()) {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${level.name} (${level.width}x${level.height})`;
    els.levelSelect.append(option);
  }
}

function startLevel(index) {
  app.levelIndex = index;
  app.state = initState(LEVELS[index]);
  app.state.stats = {
    nanoCount: app.state.lastNanoCount,
    increase: 0,
    growthRate: 1,
    predictedNext: predictGrowthCells(app.state).size,
  };
  els.levelSelect.value = String(index);
  els.message.textContent = 'ツールを選択してセルをクリック後、「ターン確定」を押してください。';
  render();
}

function boardMetrics() {
  const level = LEVELS[app.levelIndex];
  const maxW = 820;
  const width = Math.min(window.innerWidth - 24, maxW);
  const cell = Math.floor(Math.min(width / level.width, 34));
  const w = cell * level.width;
  const h = cell * level.height;
  els.canvas.width = w;
  els.canvas.height = h;
  return { cell };
}

function cellAtPoint(clientX, clientY) {
  const rect = els.canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const cell = els.canvas.width / app.state.width;
  return {
    x: Math.floor(x / cell),
    y: Math.floor(y / cell),
  };
}

function cellColor(cell) {
  switch (cell) {
    case CELL.EMPTY: return '#0f172a';
    case CELL.NANO: return '#ef4444';
    case CELL.WALL: return '#475569';
    case CELL.BLOCK: return '#22c55e';
    case CELL.SPLITTER: return '#eab308';
    case CELL.GOAL: return '#3b82f6';
    default: return '#111827';
  }
}

function drawBoard() {
  const { cell } = boardMetrics();
  const predicted = app.settings.predict ? predictGrowthCells(app.state) : new Set();

  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);

  for (let y = 0; y < app.state.height; y += 1) {
    for (let x = 0; x < app.state.width; x += 1) {
      const value = app.state.grid[y][x];
      ctx.fillStyle = cellColor(value);
      ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);

      if (predicted.has(`${x},${y}`) && value !== CELL.NANO) {
        ctx.fillStyle = 'rgba(248, 113, 113, 0.35)';
        ctx.fillRect(x * cell + 4, y * cell + 4, cell - 8, cell - 8);
      }

      if (value === CELL.SPLITTER) {
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x * cell + 5, y * cell + 5);
        ctx.lineTo(x * cell + cell - 5, y * cell + cell - 5);
        ctx.stroke();
      }
    }
  }
}

function renderHUD() {
  const stats = app.state.stats;
  els.turn.textContent = String(app.state.turn);
  els.nano.textContent = String(stats.nanoCount);
  const percent = ((stats.growthRate - 1) * 100).toFixed(0);
  els.growth.textContent = `${percent >= 0 ? '+' : ''}${percent}% (${stats.increase >= 0 ? '+' : ''}${stats.increase})`;
  els.prediction.textContent = `+${stats.predictedNext}`;

  els.block.textContent = `Block (${app.state.tools.block})`;
  els.purge.textContent = `Purge (${app.state.tools.purge}) CD:${app.state.cooldowns.purge}`;
  els.splitter.textContent = `Splitter (${app.state.tools.splitter})`;

  document.querySelectorAll('[data-tool]').forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === app.selectedTool);
  });

  const clearedCount = Object.keys(app.progress).length;
  els.cleared.textContent = `${clearedCount} / ${LEVELS.length}`;
}

function render() {
  drawBoard();
  renderHUD();
}

function updateOutcomeUI() {
  const outcome = evaluateState(app.state);
  if (outcome.won) {
    app.progress[app.state.id] = true;
    saveStorage();
    els.message.textContent = '勝利！ 次のレベルに挑戦できます。';
  } else if (outcome.lost) {
    els.message.textContent = '失敗：増殖を封じられませんでした。リトライしてください。';
  }
}

function onBoardClick(evt) {
  const outcome = evaluateState(app.state);
  if (outcome.won || outcome.lost) return;

  const { x, y } = cellAtPoint(evt.clientX, evt.clientY);
  const next = advanceTurn(app.state, { type: app.selectedTool, x, y });

  if (next.invalidAction) {
    els.message.textContent = `無効な行動: ${next.invalidAction}`;
    return;
  }

  app.state = next;
  render();
  updateOutcomeUI();
}

function endTurnWithoutAction() {
  const outcome = evaluateState(app.state);
  if (outcome.won || outcome.lost) return;
  app.state = advanceTurn(app.state, { type: 'wait' });
  render();
  updateOutcomeUI();
}

function bindEvents() {
  els.canvas.addEventListener('click', onBoardClick);
  els.endTurn.addEventListener('click', endTurnWithoutAction);
  els.restart.addEventListener('click', () => startLevel(app.levelIndex));
  els.levelSelect.addEventListener('change', (evt) => startLevel(Number(evt.target.value)));

  document.querySelectorAll('[data-tool]').forEach((button) => {
    button.addEventListener('click', () => {
      app.selectedTool = button.dataset.tool;
      renderHUD();
    });
  });

  els.predictToggle.addEventListener('change', (evt) => {
    app.settings.predict = evt.target.checked;
    saveStorage();
    render();
  });

  window.addEventListener('resize', render);
}

function boot() {
  loadStorage();
  setupLevelOptions();
  els.predictToggle.checked = app.settings.predict;
  bindEvents();
  startLevel(0);
}

boot();
