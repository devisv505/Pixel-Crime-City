const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

const joinOverlay = document.getElementById('joinOverlay');
const stepName = document.getElementById('stepName');
const stepColor = document.getElementById('stepColor');
const nameInput = document.getElementById('nameInput');
const toColorBtn = document.getElementById('toColorBtn');
const backBtn = document.getElementById('backBtn');
const joinBtn = document.getElementById('joinBtn');
const colorGrid = document.getElementById('colorGrid');
const customColorInput = document.getElementById('customColor');
const joinError = document.getElementById('joinError');

const hud = document.getElementById('hud');
const hudName = document.getElementById('hudName');
const hudHealth = document.getElementById('hudHealth');
const hudMode = document.getElementById('hudMode');
const hudMoney = document.getElementById('hudMoney');
const hudWanted = document.getElementById('hudWanted');

const COLOR_CHOICES = [
  '#58d2ff',
  '#ff8f6b',
  '#86e174',
  '#ffe07f',
  '#e8a0ff',
  '#ffffff',
  '#80f2e8',
  '#ff5577',
  '#6f8cff',
  '#ffc14f',
  '#8cffce',
  '#f6f6a2',
  '#c79dff',
  '#ffa7d5',
  '#9be4ff',
  '#b4ff8d',
];

const INPUT = {
  up: false,
  down: false,
  left: false,
  right: false,
  enter: false,
  horn: false,
  shootSeq: 0,
  weaponSlot: 2,
};

const POINTER = {
  canvasX: 0,
  canvasY: 0,
  worldX: 0,
  worldY: 0,
};

const WORLD = {
  width: 3840,
  height: 3840,
  tileSize: 16,
  blockPx: 320,
  roadStart: 128,
  roadEnd: 192,
  laneA: 144,
  laneB: 176,
};

const camera = { x: WORLD.width * 0.5, y: WORLD.height * 0.5 };
let viewScale = 3;

let socket = null;
let joined = false;
let playerId = null;
let selectedName = '';
let selectedColor = COLOR_CHOICES[0];
let snapshots = [];
let lastSnapshot = null;
let lastFrameTime = performance.now();
let inputSendAccumulator = 0;
let localPlayerCache = null;
let latestState = null;
let statusNotice = '';
let statusNoticeUntil = 0;

const seenEventIds = new Set();
const seenEventQueue = [];
const MAX_SEEN_EVENTS = 650;

const visualEffects = [];

class GameAudio {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.engineGain = null;
    this.engineOsc = null;
    this.engineFilter = null;
    this.ambienceGain = null;
    this.ambienceOsc = null;
    this.lastFootstepAt = 0;
  }

  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.24;
    this.masterGain.connect(this.ctx.destination);

    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 580;

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;

    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 52;
    this.engineOsc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);
    this.engineOsc.start();

    this.ambienceGain = this.ctx.createGain();
    this.ambienceGain.gain.value = 0.008;
    this.ambienceOsc = this.ctx.createOscillator();
    this.ambienceOsc.type = 'triangle';
    this.ambienceOsc.frequency.value = 32;
    this.ambienceOsc.connect(this.ambienceGain);
    this.ambienceGain.connect(this.masterGain);
    this.ambienceOsc.start();

    await this.ctx.resume();
  }

  triggerTone(type, frequency, duration, volume, distanceAttenuation = 1) {
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.value = frequency;

    const v = clamp(volume * distanceAttenuation, 0, 0.24);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(v + 0.0001, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + duration + 0.04);
  }

  playFootstep() {
    this.triggerTone('square', 165 + Math.random() * 30, 0.06, 0.04);
  }

  playHorn(distance = 0) {
    const attenuation = clamp(1 - distance / 900, 0.15, 1);
    this.triggerTone('square', 390, 0.22, 0.09, attenuation);
    this.triggerTone('sawtooth', 195, 0.24, 0.05, attenuation);
  }

  playImpact(distance = 0) {
    const attenuation = clamp(1 - distance / 700, 0.1, 1);
    this.triggerTone('triangle', 70 + Math.random() * 35, 0.12, 0.06, attenuation);
  }

  playShot(distance = 0) {
    const attenuation = clamp(1 - distance / 950, 0.1, 1);
    this.triggerTone('square', 860, 0.06, 0.06, attenuation);
    this.triggerTone('triangle', 180, 0.08, 0.04, attenuation);
  }

  playCash() {
    this.triggerTone('triangle', 740, 0.07, 0.05, 1);
    this.triggerTone('triangle', 920, 0.08, 0.05, 1);
  }

  update(state, now) {
    if (!this.ctx || !state || !state.localPlayer) return;

    const localPlayer = state.localPlayer;
    const localCar = localPlayer.inCarId ? state.carsById.get(localPlayer.inCarId) : null;
    const inCar = !!localCar;

    if (inCar) {
      const speed = Math.abs(localCar.speed || 0);
      const targetGain = 0.018 + Math.min(0.085, speed / 1850);
      const targetFreq = 44 + speed * 1.45;
      const targetFilter = 420 + speed * 3.8;

      this.engineGain.gain.linearRampToValueAtTime(targetGain, this.ctx.currentTime + 0.08);
      this.engineOsc.frequency.linearRampToValueAtTime(targetFreq, this.ctx.currentTime + 0.08);
      this.engineFilter.frequency.linearRampToValueAtTime(targetFilter, this.ctx.currentTime + 0.08);
    } else {
      this.engineGain.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.12);
    }

    const movingOnFoot = !inCar && (INPUT.up || INPUT.down || INPUT.left || INPUT.right) && localPlayer.health > 0;
    if (movingOnFoot && now - this.lastFootstepAt > 170) {
      this.lastFootstepAt = now;
      this.playFootstep();
    }
  }
}

const audio = new GameAudio();
function mod(value, by) {
  return ((value % by) + by) % by;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function angleLerp(a, b, t) {
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

function hash2D(x, y) {
  let n = x * 374761393 + y * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  n ^= n >> 16;
  return (n >>> 0) / 4294967295;
}

function worldGroundTypeAt(x, y) {
  if (x < 0 || y < 0 || x >= WORLD.width || y >= WORLD.height) {
    return 'void';
  }

  const localX = mod(x, WORLD.blockPx);
  const localY = mod(y, WORLD.blockPx);
  const inVerticalRoad = localX >= WORLD.roadStart && localX < WORLD.roadEnd;
  const inHorizontalRoad = localY >= WORLD.roadStart && localY < WORLD.roadEnd;

  if (inVerticalRoad || inHorizontalRoad) {
    return 'road';
  }

  const sidePadding = 16;
  const inVerticalWalk = localX >= WORLD.roadStart - sidePadding && localX < WORLD.roadEnd + sidePadding;
  const inHorizontalWalk = localY >= WORLD.roadStart - sidePadding && localY < WORLD.roadEnd + sidePadding;
  if (inVerticalWalk || inHorizontalWalk) {
    return 'sidewalk';
  }

  const blockX = Math.floor(x / WORLD.blockPx);
  const blockY = Math.floor(y / WORLD.blockPx);
  const profile = hash2D(blockX, blockY);
  if (profile < 0.2) {
    return 'park';
  }

  const margin = 42 + Math.floor(hash2D(blockX + 11, blockY - 7) * 12);
  if (
    localX > margin &&
    localX < WORLD.blockPx - margin &&
    localY > margin &&
    localY < WORLD.blockPx - margin
  ) {
    return 'building';
  }

  return 'park';
}

function applyWorldFromServer(payload) {
  if (!payload) return;
  for (const key of Object.keys(WORLD)) {
    if (typeof payload[key] === 'number' && Number.isFinite(payload[key])) {
      WORLD[key] = payload[key];
    }
  }
}

function setStep(step) {
  const showName = step === 'name';
  stepName.classList.toggle('active', showName);
  stepColor.classList.toggle('active', !showName);
}

function setJoinError(text = '') {
  joinError.textContent = text;
}

function populateColorGrid() {
  colorGrid.innerHTML = '';
  COLOR_CHOICES.forEach((color) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'color-swatch';
    button.style.background = color;
    button.title = color;
    button.dataset.color = color;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', color === selectedColor ? 'true' : 'false');
    if (color === selectedColor) {
      button.classList.add('selected');
    }

    button.addEventListener('click', () => {
      selectColor(color);
    });

    colorGrid.appendChild(button);
  });
}

function selectColor(color) {
  selectedColor = color.toLowerCase();
  customColorInput.value = selectedColor;

  for (const node of colorGrid.querySelectorAll('.color-swatch')) {
    const selected = node.dataset.color === selectedColor;
    node.classList.toggle('selected', selected);
    node.setAttribute('aria-checked', selected ? 'true' : 'false');
  }
}

function wsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

function pushEffect(effect) {
  visualEffects.push(effect);
  while (visualEffects.length > 220) {
    visualEffects.shift();
  }
}

function screenToCanvas(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (canvas.width / Math.max(1, rect.width));
  const y = (clientY - rect.top) * (canvas.height / Math.max(1, rect.height));
  return { x, y };
}

function updatePointer(clientX, clientY) {
  const p = screenToCanvas(clientX, clientY);
  POINTER.canvasX = p.x;
  POINTER.canvasY = p.y;
  POINTER.worldX = camera.x - canvas.width * 0.5 + p.x;
  POINTER.worldY = camera.y - canvas.height * 0.5 + p.y;
  POINTER.worldX = clamp(POINTER.worldX, 0, WORLD.width);
  POINTER.worldY = clamp(POINTER.worldY, 0, WORLD.height);
}

function sendInput() {
  if (!socket || socket.readyState !== WebSocket.OPEN || !joined) {
    return;
  }

  socket.send(
    JSON.stringify({
      type: 'input',
      input: {
        up: INPUT.up,
        down: INPUT.down,
        left: INPUT.left,
        right: INPUT.right,
        enter: INPUT.enter,
        horn: INPUT.horn,
        shootSeq: INPUT.shootSeq,
        weaponSlot: INPUT.weaponSlot,
        aimX: Math.round(POINTER.worldX * 100) / 100,
        aimY: Math.round(POINTER.worldY * 100) / 100,
      },
    })
  );
}

function sendBuy(item) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !joined) {
    return;
  }
  socket.send(
    JSON.stringify({
      type: 'buy',
      item,
    })
  );
}

function resetSessionState() {
  joined = false;
  playerId = null;
  snapshots = [];
  lastSnapshot = null;
  localPlayerCache = null;
  INPUT.up = false;
  INPUT.down = false;
  INPUT.left = false;
  INPUT.right = false;
  INPUT.enter = false;
  INPUT.horn = false;
  INPUT.weaponSlot = 2;
  statusNotice = '';
  statusNoticeUntil = 0;
  latestState = null;
}

async function connectAndJoin() {
  if (joinBtn.disabled) return;

  const normalizedName = nameInput.value.trim().replace(/\s+/g, ' ');
  if (normalizedName.length < 2 || normalizedName.length > 16) {
    setJoinError('Name must be 2-16 characters.');
    return;
  }

  if (!/^#[0-9a-fA-F]{6}$/.test(selectedColor)) {
    setJoinError('Choose a valid color.');
    return;
  }

  setJoinError('');
  joinBtn.disabled = true;
  selectedName = normalizedName;

  await audio.init();

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }

  socket = new WebSocket(wsUrl());

  socket.addEventListener('open', () => {
    socket.send(
      JSON.stringify({
        type: 'join',
        name: selectedName,
        color: selectedColor,
      })
    );
  });

  socket.addEventListener('message', (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (!data || typeof data !== 'object') return;

    if (data.type === 'joined') {
      applyWorldFromServer(data.world);
      playerId = data.playerId;
      joined = true;
      joinOverlay.classList.add('hidden');
      hud.classList.remove('hidden');
      setJoinError('');
      joinBtn.disabled = false;
      return;
    }

    if (data.type === 'snapshot') {
      applyWorldFromServer(data.world);
      data.receivedAt = performance.now();
      snapshots.push(data);
      while (snapshots.length > 55) snapshots.shift();
      lastSnapshot = data;
      processEvents(data.events || []);
      return;
    }

    if (data.type === 'error') {
      setJoinError(data.message || 'Server error.');
      joinBtn.disabled = false;
      return;
    }

    if (data.type === 'notice') {
      statusNotice = data.message || '';
      statusNoticeUntil = performance.now() + 2200;
      return;
    }
  });

  socket.addEventListener('close', () => {
    const wasJoined = joined;
    resetSessionState();

    if (wasJoined) {
      joinOverlay.classList.remove('hidden');
      hud.classList.add('hidden');
      setStep('color');
      setJoinError('Connection lost. Press Join Shared World to reconnect.');
    }

    joinBtn.disabled = false;
  });

  socket.addEventListener('error', () => {
    setJoinError('Network error while connecting.');
    joinBtn.disabled = false;
  });
}
function processEvents(events) {
  if (!events || events.length === 0) return;

  for (const ev of events) {
    if (!ev || typeof ev.id !== 'number') continue;
    if (seenEventIds.has(ev.id)) continue;

    seenEventIds.add(ev.id);
    seenEventQueue.push(ev.id);

    const localPos = localPlayerCache || { x: WORLD.width * 0.5, y: WORLD.height * 0.5 };
    const ex = typeof ev.x === 'number' ? ev.x : localPos.x;
    const ey = typeof ev.y === 'number' ? ev.y : localPos.y;
    const distance = Math.hypot(ex - localPos.x, ey - localPos.y);

    if (ev.type === 'horn') {
      audio.playHorn(distance);
    } else if (ev.type === 'impact' || ev.type === 'defeat') {
      audio.playImpact(distance);
      pushEffect({ type: 'spark', x: ex, y: ey, ttl: 0.25 });
    } else if (ev.type === 'bullet') {
      audio.playShot(distance);
      pushEffect({
        type: 'bullet',
        x: ev.x,
        y: ev.y,
        toX: ev.toX ?? ev.x,
        toY: ev.toY ?? ev.y,
        progress: 0,
        speed: ev.weapon === 'shotgun' ? 3.6 : 4.8,
        ttl: 0.18,
      });
    } else if (ev.type === 'npcThrown') {
      audio.playImpact(distance);
      pushEffect({
        type: 'thrown',
        x: ev.x,
        y: ev.y,
        dir: ev.dir || 0,
        speed: ev.speed || 80,
        rot: ev.dir || 0,
        ttl: 0.85,
      });
    } else if (ev.type === 'npcDown') {
      pushEffect({ type: 'splat', x: ex, y: ey, ttl: 0.6 });
    } else if (ev.type === 'cashDrop') {
      pushEffect({
        type: 'dropSpark',
        x: ex,
        y: ey,
        ttl: 0.25,
      });
    } else if (ev.type === 'cashPickup' && ev.playerId === playerId) {
      audio.playCash();
      pushEffect({
        type: 'cash',
        x: ex,
        y: ey,
        text: `+$${ev.amount || 0}`,
        ttl: 0.9,
      });
    } else if (ev.type === 'purchase' && ev.playerId === playerId) {
      statusNotice = `Bought ${ev.item}`;
      statusNoticeUntil = performance.now() + 2200;
    }
  }

  while (seenEventQueue.length > MAX_SEEN_EVENTS) {
    const oldId = seenEventQueue.shift();
    seenEventIds.delete(oldId);
  }
}

function interpolateSnapshot(targetServerTime) {
  if (snapshots.length === 0) return null;
  if (snapshots.length === 1) {
    const single = snapshots[0];
    return {
      world: single.world,
      players: single.players || [],
      cars: single.cars || [],
      npcs: single.npcs || [],
      drops: single.drops || [],
      playersById: new Map((single.players || []).map((p) => [p.id, p])),
      carsById: new Map((single.cars || []).map((c) => [c.id, c])),
      localPlayer: (single.players || []).find((p) => p.id === playerId) || null,
    };
  }

  let older = snapshots[0];
  let newer = snapshots[snapshots.length - 1];

  for (let i = 0; i < snapshots.length - 1; i += 1) {
    const a = snapshots[i];
    const b = snapshots[i + 1];
    if (targetServerTime >= a.serverTime && targetServerTime <= b.serverTime) {
      older = a;
      newer = b;
      break;
    }
  }

  const span = Math.max(1, newer.serverTime - older.serverTime);
  const t = clamp((targetServerTime - older.serverTime) / span, 0, 1);

  const olderPlayers = new Map((older.players || []).map((p) => [p.id, p]));
  const olderCars = new Map((older.cars || []).map((c) => [c.id, c]));
  const olderNpcs = new Map((older.npcs || []).map((n) => [n.id, n]));
  const olderDrops = new Map((older.drops || []).map((d) => [d.id, d]));

  const players = (newer.players || []).map((next) => {
    const prev = olderPlayers.get(next.id) || next;
    return {
      ...next,
      x: lerp(prev.x, next.x, t),
      y: lerp(prev.y, next.y, t),
      dir: angleLerp(prev.dir, next.dir, t),
    };
  });

  const cars = (newer.cars || []).map((next) => {
    const prev = olderCars.get(next.id) || next;
    return {
      ...next,
      x: lerp(prev.x, next.x, t),
      y: lerp(prev.y, next.y, t),
      angle: angleLerp(prev.angle, next.angle, t),
      speed: lerp(prev.speed || 0, next.speed || 0, t),
    };
  });

  const npcs = (newer.npcs || []).map((next) => {
    const prev = olderNpcs.get(next.id) || next;
    if (!next.alive || !prev.alive) {
      return { ...next };
    }
    return {
      ...next,
      x: lerp(prev.x, next.x, t),
      y: lerp(prev.y, next.y, t),
      dir: angleLerp(prev.dir, next.dir, t),
    };
  });

  const drops = (newer.drops || []).map((next) => {
    const prev = olderDrops.get(next.id) || next;
    return {
      ...next,
      x: lerp(prev.x, next.x, t),
      y: lerp(prev.y, next.y, t),
    };
  });

  const playersById = new Map(players.map((p) => [p.id, p]));
  const carsById = new Map(cars.map((c) => [c.id, c]));

  return {
    world: newer.world,
    players,
    cars,
    npcs,
    drops,
    playersById,
    carsById,
    localPlayer: playersById.get(playerId) || null,
  };
}

function drawTile(type, sx, sy, tile, worldX, worldY) {
  if (type === 'road') {
    ctx.fillStyle = '#343b42';
    ctx.fillRect(sx, sy, tile, tile);

    const localX = mod(worldX, WORLD.blockPx);
    const localY = mod(worldY, WORLD.blockPx);
    const inVerticalRoad = localX >= WORLD.roadStart && localX < WORLD.roadEnd;
    const inHorizontalRoad = localY >= WORLD.roadStart && localY < WORLD.roadEnd;

    if (inHorizontalRoad && !inVerticalRoad && Math.floor(worldX / tile) % 2 === 0) {
      ctx.fillStyle = '#c7b663';
      ctx.fillRect(sx + (tile >> 1) - 1, sy + 1, 2, tile - 2);
    }

    if (inVerticalRoad && !inHorizontalRoad && Math.floor(worldY / tile) % 2 === 0) {
      ctx.fillStyle = '#c7b663';
      ctx.fillRect(sx + 1, sy + (tile >> 1) - 1, tile - 2, 2);
    }

    if (inVerticalRoad && inHorizontalRoad) {
      ctx.fillStyle = '#4a545d';
      ctx.fillRect(sx + 2, sy + 2, tile - 4, tile - 4);
    }
    return;
  }

  if (type === 'sidewalk') {
    ctx.fillStyle = '#70777f';
    ctx.fillRect(sx, sy, tile, tile);

    ctx.fillStyle = '#7d858e';
    if ((Math.floor(worldX / tile) + Math.floor(worldY / tile)) % 2 === 0) {
      ctx.fillRect(sx, sy, tile >> 1, tile >> 1);
    }
    return;
  }

  if (type === 'building') {
    ctx.fillStyle = '#4f565e';
    ctx.fillRect(sx, sy, tile, tile);

    const blockX = Math.floor(worldX / tile);
    const blockY = Math.floor(worldY / tile);
    if (hash2D(blockX, blockY) > 0.7) {
      ctx.fillStyle = '#8fa4b8';
      ctx.fillRect(sx + 4, sy + 4, 3, 3);
      ctx.fillRect(sx + tile - 7, sy + 4, 3, 3);
    }
    return;
  }

  ctx.fillStyle = '#345a38';
  ctx.fillRect(sx, sy, tile, tile);
  if (hash2D(Math.floor(worldX / tile), Math.floor(worldY / tile)) > 0.65) {
    ctx.fillStyle = '#3f6a42';
    ctx.fillRect(sx + 3, sy + 3, 2, 2);
  }
}

function drawWorld() {
  const viewW = canvas.width;
  const viewH = canvas.height;
  const tile = WORLD.tileSize;

  const worldLeft = camera.x - viewW * 0.5;
  const worldTop = camera.y - viewH * 0.5;

  const startX = Math.floor(worldLeft / tile) - 1;
  const startY = Math.floor(worldTop / tile) - 1;
  const endX = Math.floor((worldLeft + viewW) / tile) + 2;
  const endY = Math.floor((worldTop + viewH) / tile) + 2;

  ctx.fillStyle = '#203024';
  ctx.fillRect(0, 0, viewW, viewH);

  for (let ty = startY; ty <= endY; ty += 1) {
    const worldY = ty * tile;
    const sy = Math.floor(worldY - worldTop);

    for (let tx = startX; tx <= endX; tx += 1) {
      const worldX = tx * tile;
      const sx = Math.floor(worldX - worldLeft);
      const type = worldGroundTypeAt(worldX + tile * 0.5, worldY + tile * 0.5);
      drawTile(type, sx, sy, tile, worldX, worldY);
    }
  }
}

function findShopByIdInWorld(world, id) {
  const shops = world?.shops || [];
  for (const shop of shops) {
    if (shop.id === id) return shop;
  }
  return null;
}

function drawShopMarkers(state, worldLeft, worldTop) {
  const shops = state.world?.shops || [];
  for (const shop of shops) {
    const sx = Math.round(shop.x - worldLeft);
    const sy = Math.round(shop.y - worldTop);
    if (sx < -40 || sy < -40 || sx > canvas.width + 40 || sy > canvas.height + 40) {
      continue;
    }

    ctx.fillStyle = '#1e1212';
    ctx.fillRect(sx - 12, sy - 18, 24, 12);
    ctx.fillStyle = '#ff9f59';
    ctx.fillRect(sx - 10, sy - 16, 20, 8);
    ctx.fillStyle = '#101010';
    ctx.fillRect(sx - 7, sy - 4, 14, 6);
    ctx.fillStyle = '#fff1d6';
    ctx.font = '6px "Lucida Console", Monaco, monospace';
    const label = 'GUN';
    const w = ctx.measureText(label).width;
    ctx.fillText(label, sx - w * 0.5, sy - 10);
  }
}

function nearbyShopForPlayer(state, player, maxDistance = 34) {
  const shops = state.world?.shops || [];
  const maxSq = maxDistance * maxDistance;
  for (const shop of shops) {
    const dx = player.x - shop.x;
    const dy = player.y - shop.y;
    if (dx * dx + dy * dy <= maxSq) {
      return shop;
    }
  }
  return null;
}

function drawDrops(state, worldLeft, worldTop) {
  for (const drop of state.drops || []) {
    const sx = Math.round(drop.x - worldLeft);
    const sy = Math.round(drop.y - worldTop);
    if (sx < -16 || sy < -16 || sx > canvas.width + 16 || sy > canvas.height + 16) {
      continue;
    }

    ctx.fillStyle = '#245a2a';
    ctx.fillRect(sx - 4, sy - 3, 8, 6);
    ctx.fillStyle = '#7dff78';
    ctx.fillRect(sx - 3, sy - 2, 6, 4);
    ctx.fillStyle = '#0a2c0f';
    ctx.fillRect(sx - 1, sy - 2, 2, 4);
  }
}

function drawShopInterior(state) {
  const local = state.localPlayer;
  const shop = findShopByIdInWorld(state.world, local.insideShopId);
  const pistolPrice = shop?.stock?.pistol ?? 260;
  const shotgunPrice = shop?.stock?.shotgun ?? 720;

  ctx.fillStyle = '#18120f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < canvas.height; y += 16) {
    for (let x = 0; x < canvas.width; x += 16) {
      ctx.fillStyle = (x + y) % 32 === 0 ? '#2a1f19' : '#211812';
      ctx.fillRect(x, y, 16, 16);
    }
  }

  const panelX = Math.max(16, Math.floor(canvas.width * 0.16));
  const panelY = Math.max(14, Math.floor(canvas.height * 0.14));
  const panelW = Math.floor(canvas.width * 0.68);
  const panelH = Math.floor(canvas.height * 0.72);

  ctx.fillStyle = '#0f0c0a';
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.fillStyle = '#3e2c20';
  ctx.fillRect(panelX + 4, panelY + 4, panelW - 8, panelH - 8);
  ctx.fillStyle = '#d8c7a2';
  ctx.font = '10px "Lucida Console", Monaco, monospace';
  ctx.fillText(shop?.name || 'Gun Shop', panelX + 18, panelY + 24);
  ctx.font = '8px "Lucida Console", Monaco, monospace';
  ctx.fillText(`Money: $${local.money || 0}`, panelX + 18, panelY + 44);

  const pistolOwned = !!local.ownedPistol;
  const shotgunOwned = !!local.ownedShotgun;
  const weaponLabel =
    local.weapon === 'shotgun' ? 'equipped' : local.weapon === 'pistol' ? 'equipped' : 'holstered';

  ctx.fillStyle = pistolOwned ? '#8dff7c' : '#ffd3a2';
  ctx.fillText(`1) Pistol  $${pistolPrice}  ${pistolOwned ? '(owned)' : ''}`, panelX + 18, panelY + 74);
  ctx.fillStyle = shotgunOwned ? '#8dff7c' : '#ffd3a2';
  ctx.fillText(`2) Shotgun $${shotgunPrice} ${shotgunOwned ? '(owned)' : ''}`, panelX + 18, panelY + 92);

  ctx.fillStyle = '#bfc8d6';
  ctx.fillText(`Current: ${local.weapon} (${weaponLabel})`, panelX + 18, panelY + 118);
  ctx.fillStyle = '#e8e8e8';
  ctx.fillText('Press E to leave shop', panelX + 18, panelY + 140);
}

function drawCar(car, worldLeft, worldTop) {
  const sx = Math.round(car.x - worldLeft);
  const sy = Math.round(car.y - worldTop);

  if (sx < -32 || sy < -32 || sx > canvas.width + 32 || sy > canvas.height + 32) {
    return;
  }

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(car.angle);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.33)';
  ctx.fillRect(-11, 8, 22, 4);

  ctx.fillStyle = '#121820';
  ctx.fillRect(-12, -7, 24, 14);

  ctx.fillStyle = car.color;
  ctx.fillRect(-10, -6, 20, 12);

  ctx.fillStyle = '#0b1017';
  ctx.fillRect(-6, -4, 12, 8);

  ctx.fillStyle = '#a4c6df';
  ctx.fillRect(-5, -3, 4, 3);
  ctx.fillRect(1, -3, 4, 3);

  ctx.fillStyle = '#0c1014';
  ctx.fillRect(-11, -8, 4, 2);
  ctx.fillRect(7, -8, 4, 2);
  ctx.fillRect(-11, 6, 4, 2);
  ctx.fillRect(7, 6, 4, 2);

  if (car.npcDriver && !car.driverId) {
    ctx.fillStyle = '#f0c39a';
    ctx.fillRect(-1, -2, 2, 2);
  }

  if (car.type === 'cop') {
    ctx.fillStyle = '#ef4f5a';
    ctx.fillRect(-2, -7, 2, 2);
    ctx.fillStyle = '#5ea7ff';
    ctx.fillRect(0, -7, 2, 2);
  }

  ctx.restore();
}
const SPRITES = {
  down: [
    '........',
    '..1111..',
    '..1221..',
    '.133331.',
    '.133331.',
    '..3443..',
    '..3443..',
    '.5....5.',
  ],
  up: [
    '........',
    '..1111..',
    '..1221..',
    '.133331.',
    '.133331.',
    '..3443..',
    '..3443..',
    '.5....5.',
  ],
  side: [
    '........',
    '..111...',
    '..1221..',
    '.13331..',
    '.13331..',
    '..3441..',
    '..3441..',
    '..5..5..',
  ],
};

function drawPixelCharacter(x, y, dir, bodyColor, skinColor, shirtDark, label = null) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fillRect(x - 4, y + 6, 8, 3);

  let matrix = SPRITES.down;
  let flip = false;

  if (Math.abs(Math.cos(dir)) > Math.abs(Math.sin(dir))) {
    matrix = SPRITES.side;
    flip = Math.cos(dir) < 0;
  } else {
    matrix = Math.sin(dir) < 0 ? SPRITES.up : SPRITES.down;
  }

  const unit = 2;
  const palette = {
    '1': '#0f1620',
    '2': skinColor,
    '3': bodyColor,
    '4': shirtDark,
    '5': '#111111',
  };

  for (let row = 0; row < matrix.length; row += 1) {
    const line = matrix[row];
    for (let col = 0; col < line.length; col += 1) {
      const token = line[col];
      if (token === '.') continue;
      const px = flip ? matrix[0].length - 1 - col : col;
      ctx.fillStyle = palette[token];
      ctx.fillRect(x - 8 + px * unit, y - 10 + row * unit, unit, unit);
    }
  }

  if (label) {
    ctx.fillStyle = '#f3f7ff';
    ctx.font = '6px "Lucida Console", Monaco, monospace';
    const w = ctx.measureText(label).width;
    ctx.fillText(label, x - w * 0.5, y - 12);
  }
}

function drawPixelPlayer(player, worldLeft, worldTop) {
  const x = Math.round(player.x - worldLeft);
  const y = Math.round(player.y - worldTop);

  if (x < -24 || y < -24 || x > canvas.width + 24 || y > canvas.height + 24) {
    return;
  }

  if (player.health <= 0) {
    ctx.fillStyle = '#a32d2d';
    ctx.fillRect(x - 4, y - 1, 8, 2);
    ctx.fillRect(x - 1, y - 4, 2, 8);
    return;
  }

  drawPixelCharacter(x, y, player.dir || 0, player.color, '#f0c39a', '#1a3452', player.name);
}

function drawNpc(npc, worldLeft, worldTop) {
  if (!npc.alive) return;

  const x = Math.round(npc.x - worldLeft);
  const y = Math.round(npc.y - worldTop);
  if (x < -20 || y < -20 || x > canvas.width + 20 || y > canvas.height + 20) {
    return;
  }

  drawPixelCharacter(x, y, npc.dir || 0, npc.shirtColor || '#8092a6', npc.skinColor || '#f0c39a', '#2a3342');
}

function updateEffects(dt) {
  for (let i = visualEffects.length - 1; i >= 0; i -= 1) {
    const effect = visualEffects[i];
    effect.ttl -= dt;

    if (effect.type === 'thrown') {
      effect.x += Math.cos(effect.dir) * effect.speed * dt;
      effect.y += Math.sin(effect.dir) * effect.speed * dt;
      effect.speed *= Math.pow(0.26, dt * 5);
      effect.rot += dt * 8;
    } else if (effect.type === 'cash') {
      effect.y -= 22 * dt;
    } else if (effect.type === 'bullet') {
      effect.progress = Math.min(1, (effect.progress || 0) + dt * (effect.speed || 4.5));
    }

    if (effect.ttl <= 0) {
      visualEffects.splice(i, 1);
    }
  }
}

function drawEffects(worldLeft, worldTop) {
  for (const effect of visualEffects) {
    if (effect.type === 'bullet') {
      const bx = lerp(effect.x, effect.toX, effect.progress || 0);
      const by = lerp(effect.y, effect.toY, effect.progress || 0);
      const sx = Math.round(bx - worldLeft);
      const sy = Math.round(by - worldTop);
      const tailX = Math.round(lerp(effect.x, bx, 0.82) - worldLeft);
      const tailY = Math.round(lerp(effect.y, by, 0.82) - worldTop);
      ctx.strokeStyle = '#ffd98f';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.fillStyle = '#fff3cc';
      ctx.fillRect(sx - 1, sy - 1, 2, 2);
    } else if (effect.type === 'thrown') {
      const sx = Math.round(effect.x - worldLeft);
      const sy = Math.round(effect.y - worldTop);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(effect.rot || 0);
      ctx.fillStyle = '#f0c39a';
      ctx.fillRect(-3, -2, 6, 4);
      ctx.fillStyle = '#808891';
      ctx.fillRect(-4, 1, 8, 2);
      ctx.restore();
    } else if (effect.type === 'cash') {
      const sx = Math.round(effect.x - worldLeft);
      const sy = Math.round(effect.y - worldTop);
      ctx.fillStyle = '#9fff8f';
      ctx.font = '7px "Lucida Console", Monaco, monospace';
      ctx.fillText(effect.text, sx - 11, sy - 6);
    } else if (effect.type === 'spark') {
      const sx = Math.round(effect.x - worldLeft);
      const sy = Math.round(effect.y - worldTop);
      ctx.fillStyle = '#f9d38a';
      ctx.fillRect(sx - 1, sy - 1, 2, 2);
    } else if (effect.type === 'splat') {
      const sx = Math.round(effect.x - worldLeft);
      const sy = Math.round(effect.y - worldTop);
      ctx.fillStyle = '#8f2222';
      ctx.fillRect(sx - 2, sy - 1, 4, 2);
      ctx.fillRect(sx - 1, sy - 2, 2, 4);
    } else if (effect.type === 'dropSpark') {
      const sx = Math.round(effect.x - worldLeft);
      const sy = Math.round(effect.y - worldTop);
      ctx.fillStyle = '#8dff83';
      ctx.fillRect(sx - 1, sy - 1, 2, 2);
    }
  }
}

function drawCrosshair(worldLeft, worldTop, state) {
  if (
    !state.localPlayer ||
    state.localPlayer.inCarId ||
    state.localPlayer.insideShopId ||
    state.localPlayer.health <= 0
  ) {
    return;
  }

  const cx = Math.round(POINTER.worldX - worldLeft);
  const cy = Math.round(POINTER.worldY - worldTop);
  if (cx < -10 || cy < -10 || cx > canvas.width + 10 || cy > canvas.height + 10) {
    return;
  }

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 5, cy);
  ctx.lineTo(cx - 2, cy);
  ctx.moveTo(cx + 2, cy);
  ctx.lineTo(cx + 5, cy);
  ctx.moveTo(cx, cy - 5);
  ctx.lineTo(cx, cy - 2);
  ctx.moveTo(cx, cy + 2);
  ctx.lineTo(cx, cy + 5);
  ctx.stroke();
}

function renderState(state, dt) {
  updateEffects(dt);
  latestState = state;

  if (!state || !state.localPlayer) {
    ctx.fillStyle = '#0f1820';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawEffects(camera.x - canvas.width * 0.5, camera.y - canvas.height * 0.5);
    return;
  }

  camera.x = lerp(camera.x, state.localPlayer.x, 0.18);
  camera.y = lerp(camera.y, state.localPlayer.y, 0.18);

  const halfW = canvas.width * 0.5;
  const halfH = canvas.height * 0.5;
  camera.x = clamp(camera.x, halfW, WORLD.width - halfW);
  camera.y = clamp(camera.y, halfH, WORLD.height - halfH);

  const worldLeft = camera.x - halfW;
  const worldTop = camera.y - halfH;

  if (state.localPlayer.insideShopId) {
    drawShopInterior(state);
    if (statusNotice && performance.now() < statusNoticeUntil) {
      ctx.fillStyle = '#f6e7b9';
      ctx.font = '8px "Lucida Console", Monaco, monospace';
      const w = ctx.measureText(statusNotice).width;
      ctx.fillText(statusNotice, Math.floor(canvas.width * 0.5 - w * 0.5), 18);
    }
    return;
  }

  drawWorld();
  drawShopMarkers(state, worldLeft, worldTop);
  drawDrops(state, worldLeft, worldTop);

  const drawList = [];
  for (const car of state.cars) {
    drawList.push({ kind: 'car', y: car.y, item: car });
  }
  for (const npc of state.npcs) {
    if (!npc.alive) continue;
    drawList.push({ kind: 'npc', y: npc.y + 4, item: npc });
  }
  for (const player of state.players) {
    if (player.insideShopId) continue;
    if (player.inCarId) continue;
    drawList.push({ kind: 'player', y: player.y + 5, item: player });
  }

  drawList.sort((a, b) => a.y - b.y);
  for (const entry of drawList) {
    if (entry.kind === 'car') {
      drawCar(entry.item, worldLeft, worldTop);
    } else if (entry.kind === 'npc') {
      drawNpc(entry.item, worldLeft, worldTop);
    } else {
      drawPixelPlayer(entry.item, worldLeft, worldTop);
    }
  }

  drawEffects(worldLeft, worldTop);
  drawCrosshair(worldLeft, worldTop, state);

  const local = state.localPlayer;
  if (local.health < 35) {
    const alpha = (35 - local.health) / 110;
    ctx.fillStyle = `rgba(170, 20, 20, ${alpha.toFixed(3)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (!local.inCarId) {
    const nearbyShop = nearbyShopForPlayer(state, local);
    if (nearbyShop) {
      ctx.fillStyle = '#ffe8bc';
      ctx.font = '8px "Lucida Console", Monaco, monospace';
      const text = 'Press E to enter Gun Shop';
      const w = ctx.measureText(text).width;
      ctx.fillText(text, Math.floor(canvas.width * 0.5 - w * 0.5), canvas.height - 12);
    }
  }

  if (statusNotice && performance.now() < statusNoticeUntil) {
    ctx.fillStyle = '#f6e7b9';
    ctx.font = '8px "Lucida Console", Monaco, monospace';
    const w = ctx.measureText(statusNotice).width;
    ctx.fillText(statusNotice, Math.floor(canvas.width * 0.5 - w * 0.5), 14);
  }
}

function updateHud(state) {
  if (!state || !state.localPlayer) return;

  const p = state.localPlayer;
  localPlayerCache = { x: p.x, y: p.y };

  hudName.textContent = `Player: ${p.name}`;
  hudHealth.textContent = `HP: ${Math.max(0, p.health | 0)}`;
  const weaponLabel =
    p.weapon === 'shotgun' ? 'shotgun' : p.weapon === 'pistol' ? 'pistol' : 'unarmed';
  if (p.insideShopId) {
    hudMode.textContent = 'Mode: In Gun Shop';
  } else if (p.inCarId) {
    hudMode.textContent = 'Mode: Driving';
  } else {
    hudMode.textContent = `Mode: On Foot (${weaponLabel})`;
  }
  hudMoney.textContent = `Money: $${p.money || 0}`;
  hudWanted.textContent = p.stars > 0 ? `Stars: ${'*'.repeat(p.stars)}` : 'Stars: none';
}
function resizeCanvas() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  viewScale = w < 760 ? 2 : 3;

  canvas.width = Math.max(320, Math.floor(w / viewScale));
  canvas.height = Math.max(200, Math.floor(h / viewScale));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.imageSmoothingEnabled = false;

  updatePointer(w * 0.5, h * 0.5);
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') {
    return true;
  }
  return target.isContentEditable;
}

function shouldHandleGameKey(event) {
  if (!joined) return false;
  if (!joinOverlay.classList.contains('hidden')) return false;
  if (isEditableTarget(event.target)) return false;
  if (isEditableTarget(document.activeElement)) return false;
  return true;
}

function setKeyState(event, isDown) {
  const code = event.code;

  if (code === 'ArrowUp' || code === 'KeyW') {
    INPUT.up = isDown;
  } else if (code === 'ArrowDown' || code === 'KeyS') {
    INPUT.down = isDown;
  } else if (code === 'ArrowLeft' || code === 'KeyA') {
    INPUT.left = isDown;
  } else if (code === 'ArrowRight' || code === 'KeyD') {
    INPUT.right = isDown;
  } else if (code === 'KeyE') {
    INPUT.enter = isDown;
  } else if (code === 'Space') {
    INPUT.horn = isDown;
    if (isDown) {
      audio.playHorn(0);
    }
  } else {
    return;
  }

  event.preventDefault();
}

function handleActionKey(event) {
  if (event.code !== 'Digit1' && event.code !== 'Digit2' && event.code !== 'Digit3') {
    return false;
  }

  const local = latestState?.localPlayer;
  if (!local) {
    return false;
  }

  if (local.insideShopId) {
    if (event.code === 'Digit1') {
      sendBuy('pistol');
    } else if (event.code === 'Digit2') {
      sendBuy('shotgun');
    }
    event.preventDefault();
    return true;
  }

  if (event.code === 'Digit1') {
    INPUT.weaponSlot = 1;
  } else if (event.code === 'Digit2') {
    INPUT.weaponSlot = 2;
  } else if (event.code === 'Digit3') {
    INPUT.weaponSlot = 3;
  }
  event.preventDefault();
  return true;
}

function startRenderLoop() {
  function frame(now) {
    const dt = clamp((now - lastFrameTime) / 1000, 0, 0.15);
    lastFrameTime = now;

    if (joined) {
      inputSendAccumulator += dt;
      while (inputSendAccumulator >= 1 / 30) {
        sendInput();
        inputSendAccumulator -= 1 / 30;
      }

      const serverTimeReference = Date.now() - 100;
      const state = interpolateSnapshot(serverTimeReference);
      if (state && state.localPlayer) {
        renderState(state, dt);
        updateHud(state);
        audio.update(state, now);
      } else {
        renderState(null, dt);
      }
    } else {
      renderState(null, dt);
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function attachUiEvents() {
  toColorBtn.addEventListener('click', () => {
    const normalizedName = nameInput.value.trim().replace(/\s+/g, ' ');
    if (normalizedName.length < 2 || normalizedName.length > 16) {
      setJoinError('Name must be 2-16 characters.');
      return;
    }

    selectedName = normalizedName;
    setJoinError('');
    setStep('color');
  });

  backBtn.addEventListener('click', () => {
    setJoinError('');
    setStep('name');
  });

  joinBtn.addEventListener('click', () => {
    connectAndJoin();
  });

  customColorInput.addEventListener('input', (event) => {
    const value = String(event.target.value || '').toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(value)) {
      selectColor(value);
    }
  });

  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      toColorBtn.click();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (!shouldHandleGameKey(event)) return;
    if (handleActionKey(event)) return;
    if (event.repeat) return;
    setKeyState(event, true);
  });

  window.addEventListener('keyup', (event) => {
    if (!shouldHandleGameKey(event)) return;
    setKeyState(event, false);
  });

  canvas.addEventListener('mousemove', (event) => {
    updatePointer(event.clientX, event.clientY);
  });

  canvas.addEventListener('mousedown', (event) => {
    if (!joined) return;
    if (event.button !== 0) return;
    const local = latestState?.localPlayer;
    if (!local || local.insideShopId || local.weapon === 'none') return;

    updatePointer(event.clientX, event.clientY);
    INPUT.shootSeq = (INPUT.shootSeq + 1) >>> 0;
    audio.playShot(0);
    event.preventDefault();
  });

  canvas.addEventListener('contextmenu', (event) => {
    if (joined) {
      event.preventDefault();
    }
  });

  window.addEventListener('blur', () => {
    INPUT.up = false;
    INPUT.down = false;
    INPUT.left = false;
    INPUT.right = false;
    INPUT.enter = false;
    INPUT.horn = false;
  });

  window.addEventListener('resize', resizeCanvas);
}

function boot() {
  populateColorGrid();
  selectColor(selectedColor);
  setStep('name');
  resizeCanvas();
  attachUiEvents();
  startRenderLoop();
  nameInput.focus();
}

boot();
