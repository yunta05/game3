(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  const overlay = document.getElementById("overlay");
  const resultScreen = document.getElementById("resultScreen");
  const resultStats = document.getElementById("resultStats");
  const startButton = document.getElementById("startButton");
  const retryButton = document.getElementById("retryButton");

  const hud = document.getElementById("hud");
  const hudScore = document.getElementById("hudScore");
  const hudSize = document.getElementById("hudSize");
  const hudChain = document.getElementById("hudChain");
  const hudThreat = document.getElementById("hudThreat");
  const hudTime = document.getElementById("hudTime");
  const hudHigh = document.getElementById("hudHigh");

  const volumeInput = document.getElementById("volume");
  const shakeToggle = document.getElementById("shakeToggle");

  const WORLD_SIZE = 4600;
  const BASE_DURATION = 360;
  const CHAIN_WINDOW = 2.0;
  const ABSORB_RATIO = 1.15;
  const MAX_DT = 0.033;
  const AI_STEP = 1 / 15;
  const NUTRIENT_COUNT = 360;

  const pointer = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5, active: false };
  const keys = { shift: false, space: false };

  let audioCtx;
  let lastTime = 0;
  let aiAccumulator = 0;
  let running = false;

  const settings = loadSettings();
  volumeInput.value = String(settings.volume);
  shakeToggle.checked = settings.shake;

  const game = {
    player: null,
    nutrients: [],
    microbes: [],
    hazards: [],
    particles: [],
    ripples: [],
    scorePops: [],
    elapsed: 0,
    threat: 1,
    totalAbsorbed: 0,
    score: 0,
    chain: 0,
    chainTimer: 0,
    maxChain: 0,
    bestRadius: 0,
    highScore: Number(localStorage.getItem("cell-chain-highscore") || 0),
    gameOver: false,
    cameraShake: 0
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function length(x, y) {
    return Math.hypot(x, y);
  }

  function loadSettings() {
    const saved = localStorage.getItem("cell-chain-settings");
    if (!saved) {
      return { volume: 0.35, shake: true };
    }
    try {
      const parsed = JSON.parse(saved);
      return {
        volume: clamp(Number(parsed.volume) || 0.35, 0, 1),
        shake: Boolean(parsed.shake)
      };
    } catch {
      return { volume: 0.35, shake: true };
    }
  }

  function saveSettings() {
    localStorage.setItem("cell-chain-settings", JSON.stringify(settings));
  }

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  function beep(freq, duration, gain = 0.03, type = "sine") {
    if (settings.volume <= 0) return;
    ensureAudio();
    const osc = audioCtx.createOscillator();
    const amp = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.value = gain * settings.volume;
    osc.connect(amp);
    amp.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.start(now);
    osc.stop(now + duration);
  }

  function createPlayer() {
    return {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 24,
      boostCooldown: 0,
      emitCooldown: 0,
      alive: true
    };
  }

  function spawnNutrient() {
    const angle = Math.random() * Math.PI * 2;
    const dist = rand(40, WORLD_SIZE * 0.48);
    return {
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      radius: rand(2.4, 5.2),
      value: rand(0.8, 1.5),
      hue: rand(120, 180)
    };
  }

  function spawnMicrobe(tier) {
    const angle = Math.random() * Math.PI * 2;
    const dist = rand(220, WORLD_SIZE * 0.46);
    const bases = {
      small: { r: rand(8, 15), speed: rand(120, 160), hue: rand(155, 200) },
      mid: { r: rand(17, 28), speed: rand(95, 125), hue: rand(45, 95) },
      large: { r: rand(30, 52), speed: rand(75, 105), hue: rand(0, 28) }
    };
    const b = bases[tier];
    return {
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      vx: 0,
      vy: 0,
      targetX: 0,
      targetY: 0,
      radius: b.r,
      tier,
      baseSpeed: b.speed,
      dirTimer: rand(0.8, 1.8),
      hue: b.hue,
      pulse: Math.random() * Math.PI * 2
    };
  }

  function spawnHazard(threat) {
    const side = Math.floor(Math.random() * 4);
    const margin = WORLD_SIZE * 0.5 + 220;
    const span = rand(-WORLD_SIZE * 0.5, WORLD_SIZE * 0.5);
    let x = 0;
    let y = 0;
    if (side === 0) {
      x = -margin;
      y = span;
    } else if (side === 1) {
      x = margin;
      y = span;
    } else if (side === 2) {
      x = span;
      y = -margin;
    } else {
      x = span;
      y = margin;
    }

    const toward = Math.atan2(-y, -x) + rand(-0.45, 0.45);
    const speed = rand(90, 130) + threat * 8;
    const radius = rand(38, 66) + threat * 1.2;
    return {
      x,
      y,
      vx: Math.cos(toward) * speed,
      vy: Math.sin(toward) * speed,
      radius,
      life: rand(7, 12),
      damage: threat >= 8 ? "lethal" : "heavy",
      hue: rand(310, 350)
    };
  }

  function resetGame() {
    game.player = createPlayer();
    game.nutrients = [];
    game.microbes = [];
    game.hazards = [];
    game.particles = [];
    game.ripples = [];
    game.scorePops = [];
    game.elapsed = 0;
    game.threat = 1;
    game.totalAbsorbed = 0;
    game.score = 0;
    game.chain = 0;
    game.chainTimer = 0;
    game.maxChain = 0;
    game.bestRadius = game.player.radius;
    game.gameOver = false;
    game.cameraShake = 0;

    for (let i = 0; i < NUTRIENT_COUNT; i += 1) {
      game.nutrients.push(spawnNutrient());
    }

    for (let i = 0; i < 42; i += 1) game.microbes.push(spawnMicrobe("small"));
    for (let i = 0; i < 20; i += 1) game.microbes.push(spawnMicrobe("mid"));
    for (let i = 0; i < 7; i += 1) game.microbes.push(spawnMicrobe("large"));

    updateHud();
  }

  function addAreaGrowth(target, absorbedRadius, factor) {
    const area = target.radius * target.radius + absorbedRadius * absorbedRadius * factor;
    target.radius = Math.sqrt(area);
  }

  function canAbsorb(aRadius, bRadius) {
    return aRadius >= bRadius * ABSORB_RATIO;
  }

  function addChain(points, x, y) {
    game.chain = game.chainTimer > 0 ? game.chain + 1 : 1;
    game.chainTimer = CHAIN_WINDOW;
    game.maxChain = Math.max(game.maxChain, game.chain);

    const multiplier = 1 + 0.11 * Math.max(0, game.chain - 1);
    const gained = Math.floor(points * multiplier);
    game.score += gained;

    game.scorePops.push({
      x,
      y,
      text: `+${gained} x${multiplier.toFixed(2)}`,
      life: 0.9
    });

    game.ripples.push({ x, y, r: 8, life: 0.35 });
    if (settings.shake) {
      game.cameraShake = Math.min(18, game.cameraShake + 2 + game.chain * 0.15);
    }
    beep(220 + Math.min(180, game.chain * 10), 0.09, 0.04, "triangle");
  }

  function consumeNutrient(index) {
    const n = game.nutrients[index];
    addAreaGrowth(game.player, n.radius, 0.24 * n.value);
    addChain(6, n.x, n.y);
    game.totalAbsorbed += 1;
    game.nutrients[index] = spawnNutrient();
  }

  function consumeMicrobe(index) {
    const m = game.microbes[index];
    addAreaGrowth(game.player, m.radius, 0.55);
    addChain(Math.floor(18 + m.radius * 1.6), m.x, m.y);
    game.totalAbsorbed += 1;
    const tier = m.tier;
    game.microbes[index] = spawnMicrobe(tier);
  }

  function spawnEmissionPellet() {
    const p = game.player;
    const dirX = pointer.x - canvas.width * 0.5;
    const dirY = pointer.y - canvas.height * 0.5;
    const len = Math.max(1, length(dirX, dirY));
    const nx = dirX / len;
    const ny = dirY / len;
    const r = clamp(p.radius * 0.22, 5, 13);

    p.vx -= nx * 70;
    p.vy -= ny * 70;
    p.radius = Math.sqrt(Math.max(16, p.radius * p.radius - r * r * 0.62));

    const pellet = {
      x: p.x + nx * (p.radius + r + 4),
      y: p.y + ny * (p.radius + r + 4),
      vx: nx * 240,
      vy: ny * 240,
      radius: r,
      life: 4.5,
      value: 1.35,
      hue: 180
    };
    game.nutrients.push(pellet);
    beep(170, 0.08, 0.035, "square");
  }

  function updatePlayer(dt) {
    const p = game.player;
    const dx = pointer.x - canvas.width * 0.5;
    const dy = pointer.y - canvas.height * 0.5;
    const d = Math.max(1, length(dx, dy));
    const nx = dx / d;
    const ny = dy / d;

    const massFactor = Math.sqrt(Math.max(1, p.radius / 14));
    let targetSpeed = 190 / massFactor;

    if (keys.shift && p.radius > 14) {
      targetSpeed *= 1.85;
      p.radius = Math.sqrt(Math.max(150, p.radius * p.radius - dt * 20));
      p.boostCooldown = 0.08;
      if (Math.random() < 0.32) {
        game.particles.push({ x: p.x, y: p.y, life: 0.35, r: rand(2, 5), hue: 182, vx: rand(-30, 30), vy: rand(-30, 30) });
      }
    } else {
      p.boostCooldown = Math.max(0, p.boostCooldown - dt);
    }

    const accel = 7.8;
    p.vx += (nx * targetSpeed - p.vx) * accel * dt;
    p.vy += (ny * targetSpeed - p.vy) * accel * dt;

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    const boundary = WORLD_SIZE * 0.5;
    p.x = clamp(p.x, -boundary, boundary);
    p.y = clamp(p.y, -boundary, boundary);

    if (keys.space && p.emitCooldown <= 0 && p.radius > 21) {
      spawnEmissionPellet();
      p.emitCooldown = 0.28;
    }
    p.emitCooldown = Math.max(0, p.emitCooldown - dt);

    game.bestRadius = Math.max(game.bestRadius, p.radius);
  }

  function desiredDirectionMicrobe(m) {
    const p = game.player;
    const dx = p.x - m.x;
    const dy = p.y - m.y;
    const d = Math.max(1, length(dx, dy));
    const nx = dx / d;
    const ny = dy / d;

    const canEatPlayer = canAbsorb(m.radius, p.radius);
    const playerCanEat = canAbsorb(p.radius, m.radius);

    if (m.tier === "small") {
      if (playerCanEat && d < 600) return { x: -nx, y: -ny };
      const swarmX = m.targetX - m.x;
      const swarmY = m.targetY - m.y;
      const sl = Math.max(1, length(swarmX, swarmY));
      return { x: swarmX / sl, y: swarmY / sl };
    }

    if (m.tier === "mid") {
      if (playerCanEat && d < 500) return { x: -nx, y: -ny };
      if (canEatPlayer && d < 520) return { x: nx, y: ny };
      const wanderX = m.targetX - m.x;
      const wanderY = m.targetY - m.y;
      const wl = Math.max(1, length(wanderX, wanderY));
      return { x: wanderX / wl, y: wanderY / wl };
    }

    if (m.tier === "large") {
      if (canEatPlayer && d < 760) return { x: nx, y: ny };
      if (playerCanEat && d < 700) return { x: -nx, y: -ny };
      const wanderX = m.targetX - m.x;
      const wanderY = m.targetY - m.y;
      const wl = Math.max(1, length(wanderX, wanderY));
      return { x: wanderX / wl, y: wanderY / wl };
    }

    return { x: 0, y: 0 };
  }

  function updateMicrobeAI(dt) {
    for (const m of game.microbes) {
      m.dirTimer -= dt;
      if (m.dirTimer <= 0) {
        m.targetX = m.x + rand(-220, 220);
        m.targetY = m.y + rand(-220, 220);
        m.dirTimer = rand(0.5, 1.7);
      }

      const dir = desiredDirectionMicrobe(m);
      const speedPenalty = Math.sqrt(Math.max(1, m.radius / 12));
      const targetSpeed = m.baseSpeed / speedPenalty;
      m.vx += (dir.x * targetSpeed - m.vx) * dt * 3.8;
      m.vy += (dir.y * targetSpeed - m.vy) * dt * 3.8;
    }
  }

  function updateMicrobes(dt) {
    const bound = WORLD_SIZE * 0.5;
    for (let i = 0; i < game.microbes.length; i += 1) {
      const m = game.microbes[i];
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.pulse += dt * 3;

      if (m.x < -bound || m.x > bound) m.vx *= -0.9;
      if (m.y < -bound || m.y > bound) m.vy *= -0.9;
      m.x = clamp(m.x, -bound, bound);
      m.y = clamp(m.y, -bound, bound);

      const dist = length(m.x - game.player.x, m.y - game.player.y);
      if (dist <= m.radius + game.player.radius) {
        if (canAbsorb(game.player.radius, m.radius)) {
          consumeMicrobe(i);
          continue;
        }
        if (canAbsorb(m.radius, game.player.radius)) {
          killPlayer("捕食された");
          return;
        }
      }
    }
  }

  function updateNutrients(dt) {
    for (let i = 0; i < game.nutrients.length; i += 1) {
      const n = game.nutrients[i];

      if (n.life !== undefined) {
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        n.vx *= 0.985;
        n.vy *= 0.985;
        n.life -= dt;
        if (n.life <= 0) {
          game.nutrients[i] = spawnNutrient();
          continue;
        }
      }

      const d = length(n.x - game.player.x, n.y - game.player.y);
      if (d <= n.radius + game.player.radius && canAbsorb(game.player.radius, n.radius)) {
        consumeNutrient(i);
      }
    }
  }

  function updateHazards(dt) {
    const targetHazards = Math.floor(1 + game.threat * 0.65);
    if (game.hazards.length < targetHazards && Math.random() < dt * (0.28 + game.threat * 0.12)) {
      game.hazards.push(spawnHazard(game.threat));
    }

    for (let i = game.hazards.length - 1; i >= 0; i -= 1) {
      const h = game.hazards[i];
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.life -= dt;

      const d = length(h.x - game.player.x, h.y - game.player.y);
      if (d < h.radius + game.player.radius) {
        if (h.damage === "lethal") {
          killPlayer("免疫反応により崩壊");
          return;
        }
        const loss = game.player.radius * 0.48;
        game.player.radius = Math.max(9, game.player.radius - loss);
        h.life = 0;
        game.cameraShake = Math.min(22, game.cameraShake + 12);
        beep(120, 0.17, 0.08, "sawtooth");
        if (game.player.radius <= 10) {
          killPlayer("酸性域で壊死");
          return;
        }
      }

      const out = Math.abs(h.x) > WORLD_SIZE * 0.7 || Math.abs(h.y) > WORLD_SIZE * 0.7;
      if (h.life <= 0 || out) game.hazards.splice(i, 1);
    }
  }

  function updateEffects(dt) {
    game.chainTimer = Math.max(0, game.chainTimer - dt);
    if (game.chainTimer <= 0) game.chain = 0;

    game.cameraShake = Math.max(0, game.cameraShake - dt * 25);

    for (let i = game.scorePops.length - 1; i >= 0; i -= 1) {
      const pop = game.scorePops[i];
      pop.y -= dt * 28;
      pop.life -= dt;
      if (pop.life <= 0) game.scorePops.splice(i, 1);
    }

    for (let i = game.ripples.length - 1; i >= 0; i -= 1) {
      const rp = game.ripples[i];
      rp.r += dt * 130;
      rp.life -= dt;
      if (rp.life <= 0) game.ripples.splice(i, 1);
    }

    for (let i = game.particles.length - 1; i >= 0; i -= 1) {
      const p = game.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) game.particles.splice(i, 1);
    }
  }

  function updateDifficulty() {
    game.threat = clamp(1 + game.elapsed / 28, 1, 12);

    if (game.microbes.length < 100 && Math.random() < 0.03 * (game.threat / 10)) {
      const r = Math.random();
      if (r < 0.56) game.microbes.push(spawnMicrobe("small"));
      else if (r < 0.9) game.microbes.push(spawnMicrobe("mid"));
      else game.microbes.push(spawnMicrobe("large"));
    }

    if (game.elapsed >= BASE_DURATION) {
      killPlayer("培地が飽和した");
    }
  }

  function killPlayer(reason) {
    if (game.gameOver) return;
    game.gameOver = true;
    running = false;
    hud.classList.add("hidden");

    game.highScore = Math.max(game.highScore, game.score);
    localStorage.setItem("cell-chain-highscore", String(game.highScore));

    resultStats.innerHTML = [
      `理由: ${reason}`,
      `スコア: ${game.score}`,
      `最大サイズ: ${game.bestRadius.toFixed(1)}`,
      `最大Chain: x${game.maxChain}`,
      `生存時間: ${game.elapsed.toFixed(1)}秒`,
      `吸収数: ${game.totalAbsorbed}`,
      `ハイスコア: ${game.highScore}`
    ].join("<br>");
    resultScreen.classList.add("active");
    beep(90, 0.35, 0.1, "sawtooth");
  }

  function worldToScreen(wx, wy, camX, camY) {
    return {
      x: wx - camX + canvas.width * 0.5,
      y: wy - camY + canvas.height * 0.5
    };
  }

  function drawCell(x, y, radius, hue, nucleusCount = 3, alpha = 1, pulse = 0) {
    const grad = ctx.createRadialGradient(x - radius * 0.32, y - radius * 0.32, radius * 0.2, x, y, radius);
    grad.addColorStop(0, `hsla(${hue}, 78%, 68%, ${0.85 * alpha})`);
    grad.addColorStop(1, `hsla(${hue}, 65%, 38%, ${0.25 * alpha})`);

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = Math.max(1.2, radius * 0.1);
    ctx.strokeStyle = `hsla(${hue}, 85%, 86%, ${0.55 * alpha})`;
    ctx.stroke();

    for (let i = 0; i < nucleusCount; i += 1) {
      const a = i / nucleusCount * Math.PI * 2 + pulse;
      const rr = radius * 0.22;
      const nx = x + Math.cos(a) * rr;
      const ny = y + Math.sin(a) * rr;
      ctx.beginPath();
      ctx.arc(nx, ny, Math.max(1, radius * 0.09), 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${hue + 20}, 60%, 20%, ${0.45 * alpha})`;
      ctx.fill();
    }
  }

  function drawBackground(camX, camY) {
    ctx.fillStyle = "#04080c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const grid = 68;
    const ox = (-camX * 0.15) % grid;
    const oy = (-camY * 0.15) % grid;
    ctx.strokeStyle = "rgba(38, 92, 110, 0.12)";
    ctx.lineWidth = 1;

    for (let x = ox; x < canvas.width; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = oy; y < canvas.height; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(160, 220, 240, 0.08)";
    for (let i = 0; i < 190; i += 1) {
      const px = (Math.sin(i * 84.233 + camX * 0.0007) * 0.5 + 0.5) * canvas.width;
      const py = (Math.cos(i * 54.119 + camY * 0.0008) * 0.5 + 0.5) * canvas.height;
      ctx.fillRect(px, py, 1.5, 1.5);
    }
  }

  function render() {
    const p = game.player;
    const shakeAmp = settings.shake ? game.cameraShake : 0;
    const shakeX = rand(-shakeAmp, shakeAmp);
    const shakeY = rand(-shakeAmp, shakeAmp);
    const camX = p.x + shakeX;
    const camY = p.y + shakeY;

    drawBackground(camX, camY);

    for (const rp of game.ripples) {
      const s = worldToScreen(rp.x, rp.y, camX, camY);
      ctx.beginPath();
      ctx.arc(s.x, s.y, rp.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(120, 250, 240, ${rp.life * 1.7})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    for (const n of game.nutrients) {
      const s = worldToScreen(n.x, n.y, camX, camY);
      if (s.x < -20 || s.y < -20 || s.x > canvas.width + 20 || s.y > canvas.height + 20) continue;
      drawCell(s.x, s.y, n.radius, n.hue, 1, 0.95);
    }

    for (const m of game.microbes) {
      const s = worldToScreen(m.x, m.y, camX, camY);
      if (s.x < -80 || s.y < -80 || s.x > canvas.width + 80 || s.y > canvas.height + 80) continue;
      drawCell(s.x, s.y, m.radius, m.hue, 2, 0.92, m.pulse);
    }

    for (const h of game.hazards) {
      const s = worldToScreen(h.x, h.y, camX, camY);
      const g = ctx.createRadialGradient(s.x, s.y, h.radius * 0.2, s.x, s.y, h.radius);
      g.addColorStop(0, "rgba(255, 110, 160, 0.52)");
      g.addColorStop(1, "rgba(255, 20, 90, 0.06)");
      ctx.beginPath();
      ctx.arc(s.x, s.y, h.radius, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 120, 170, 0.42)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    for (const pt of game.particles) {
      const s = worldToScreen(pt.x, pt.y, camX, camY);
      ctx.beginPath();
      ctx.arc(s.x, s.y, pt.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${pt.hue}, 85%, 68%, ${pt.life * 2.2})`;
      ctx.fill();
    }

    const ps = worldToScreen(p.x, p.y, camX, camY);
    drawCell(ps.x, ps.y, p.radius, 188, 4, 1, game.elapsed);

    for (const pop of game.scorePops) {
      const s = worldToScreen(pop.x, pop.y, camX, camY);
      ctx.fillStyle = `rgba(170, 255, 230, ${pop.life * 1.4})`;
      ctx.font = "bold 14px sans-serif";
      ctx.fillText(pop.text, s.x, s.y);
    }
  }

  function updateHud() {
    hudScore.textContent = String(game.score);
    hudSize.textContent = game.player.radius.toFixed(1);
    hudChain.textContent = `x${Math.max(1, game.chain)}`;
    hudThreat.textContent = game.threat.toFixed(1);
    hudTime.textContent = `${game.elapsed.toFixed(1)}s`;
    hudHigh.textContent = String(game.highScore);
  }

  function tick(t) {
    if (!lastTime) lastTime = t;
    const dt = Math.min(MAX_DT, (t - lastTime) / 1000);
    lastTime = t;

    if (running && !game.gameOver) {
      game.elapsed += dt;
      aiAccumulator += dt;

      updatePlayer(dt);
      while (aiAccumulator >= AI_STEP) {
        updateMicrobeAI(AI_STEP);
        aiAccumulator -= AI_STEP;
      }
      updateMicrobes(dt);
      updateNutrients(dt);
      updateHazards(dt);
      updateEffects(dt);
      updateDifficulty();
      updateHud();
    }

    render();
    requestAnimationFrame(tick);
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function startGame() {
    resetGame();
    overlay.classList.remove("active");
    resultScreen.classList.remove("active");
    hud.classList.remove("hidden");
    running = true;
    lastTime = 0;
    aiAccumulator = 0;
  }

  window.addEventListener("resize", resize);
  window.addEventListener("mousemove", (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Shift") keys.shift = true;
    if (e.code === "Space") {
      keys.space = true;
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "Shift") keys.shift = false;
    if (e.code === "Space") keys.space = false;
  });

  volumeInput.addEventListener("input", () => {
    settings.volume = clamp(Number(volumeInput.value), 0, 1);
    saveSettings();
  });
  shakeToggle.addEventListener("change", () => {
    settings.shake = shakeToggle.checked;
    saveSettings();
  });

  startButton.addEventListener("click", () => {
    ensureAudio();
    startGame();
  });

  retryButton.addEventListener("click", () => {
    startGame();
  });

  resize();
  resetGame();
  render();
  requestAnimationFrame(tick);
})();
