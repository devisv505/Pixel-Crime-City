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
const settingsBtn = document.getElementById('settingsBtn');
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsPanel = document.getElementById('settingsPanel');
const settingsMusicVol = document.getElementById('settingsMusicVol');
const settingsSfxVol = document.getElementById('settingsSfxVol');
const settingsMusicVolValue = document.getElementById('settingsMusicVolValue');
const settingsSfxVolValue = document.getElementById('settingsSfxVolValue');
const settingsSaveBtn = document.getElementById('settingsSaveBtn');
const settingsCancelBtn = document.getElementById('settingsCancelBtn');

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
  shootHeld: false,
  shootSeq: 0,
  weaponSlot: 1,
  clickAimX: 0,
  clickAimY: 0,
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
const AUDIO_PREF_MUSIC_KEY = 'pcc_music_volume';
const AUDIO_PREF_SFX_KEY = 'pcc_sfx_volume';

function parseAudioPref(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, 0, 1);
}

const audioSettings = {
  music: parseAudioPref(localStorage.getItem(AUDIO_PREF_MUSIC_KEY), 0.65),
  sfx: parseAudioPref(localStorage.getItem(AUDIO_PREF_SFX_KEY), 0.8),
};
const settingsDraft = {
  music: audioSettings.music,
  sfx: audioSettings.sfx,
};

function saveAudioSettings() {
  localStorage.setItem(AUDIO_PREF_MUSIC_KEY, String(audioSettings.music));
  localStorage.setItem(AUDIO_PREF_SFX_KEY, String(audioSettings.sfx));
}

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
    this.cityLoop = null;
    this.cityLoopPlaying = false;
    this.sirenLoop = null;
    this.sirenLoopPlaying = false;
    this.starFiveCue = null;
    this.lastStars = 0;
    this.masterBase = 0.24;
    this.cityBase = 0.16;
    this.sfxLevel = audioSettings.sfx;
    this.musicLevel = audioSettings.music;
    this.currentSirenVolume = 0;
    this.effectClips = new Map();
    this.effectLastAt = new Map();
  }

  ensureCityLoop() {
    if (this.cityLoop) {
      return;
    }

    const loop = new Audio('/assets/audio/city_bg.mp3');
    loop.loop = true;
    loop.preload = 'auto';
    loop.volume = this.cityBase * this.musicLevel;
    loop.addEventListener('ended', () => {
      loop.currentTime = 0;
      void loop.play().catch(() => {});
    });
    loop.addEventListener('error', () => {
      this.cityLoop = null;
      this.cityLoopPlaying = false;
    });
    this.cityLoop = loop;
  }

  tryStartCityLoop() {
    this.ensureCityLoop();
    if (!this.cityLoop || this.cityLoopPlaying) {
      return;
    }

    const maybePromise = this.cityLoop.play();
    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise
        .then(() => {
          this.cityLoopPlaying = true;
        })
        .catch(() => {});
    } else {
      this.cityLoopPlaying = true;
    }
  }

  ensureSirenLoop() {
    if (this.sirenLoop) {
      return;
    }

    const loop = new Audio('/assets/audio/police_sirene.mp3');
    loop.loop = true;
    loop.preload = 'auto';
    loop.volume = 0;
    loop.addEventListener('error', () => {
      this.sirenLoop = null;
      this.sirenLoopPlaying = false;
    });
    this.sirenLoop = loop;
  }

  setSirenVolume(volume) {
    this.ensureSirenLoop();
    if (!this.sirenLoop) return;

    this.currentSirenVolume = clamp(volume, 0, 0.32);
    const v = this.currentSirenVolume * this.sfxLevel;
    this.sirenLoop.volume = v;

    if (v > 0.01) {
      if (!this.sirenLoopPlaying) {
        const maybePromise = this.sirenLoop.play();
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise
            .then(() => {
              this.sirenLoopPlaying = true;
            })
            .catch(() => {});
        } else {
          this.sirenLoopPlaying = true;
        }
      }
      return;
    }

    if (this.sirenLoopPlaying) {
      this.sirenLoop.pause();
      this.sirenLoopPlaying = false;
      this.sirenLoop.currentTime = 0;
    }
  }

  ensureFiveStarCue() {
    if (this.starFiveCue) {
      return;
    }

    const cue = new Audio('/assets/audio/5_stars.mp3');
    cue.preload = 'auto';
    cue.volume = 0.3 * this.sfxLevel;
    cue.addEventListener('error', () => {
      this.starFiveCue = null;
    });
    this.starFiveCue = cue;
  }

  playFiveStarCue() {
    this.ensureFiveStarCue();
    if (!this.starFiveCue) return;

    this.starFiveCue.currentTime = 0;
    const maybePromise = this.starFiveCue.play();
    if (maybePromise && typeof maybePromise.catch === 'function') {
      maybePromise.catch(() => {});
    }
  }

  resetSessionAudioState() {
    this.lastStars = 0;
    this.setSirenVolume(0);
  }

  setLevels(musicLevel, sfxLevel) {
    this.musicLevel = clamp(musicLevel, 0, 1);
    this.sfxLevel = clamp(sfxLevel, 0, 1);

    if (this.masterGain) {
      this.masterGain.gain.value = this.masterBase * this.sfxLevel;
    }
    if (this.cityLoop) {
      this.cityLoop.volume = this.cityBase * this.musicLevel;
    }
    if (this.starFiveCue) {
      this.starFiveCue.volume = 0.3 * this.sfxLevel;
    }
    if (this.sirenLoop) {
      this.setSirenVolume(this.currentSirenVolume);
    }
  }

  async init() {
    this.tryStartCityLoop();

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
    this.masterGain.gain.value = this.masterBase * this.sfxLevel;
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

  ensureEffectClip(id, src) {
    if (this.effectClips.has(id)) {
      return this.effectClips.get(id);
    }
    const clip = new Audio(src);
    clip.preload = 'auto';
    clip.addEventListener('error', () => {
      this.effectClips.delete(id);
    });
    this.effectClips.set(id, clip);
    return clip;
  }

  playEffectClip(id, src, distance, baseVolume, maxDistance = 900, minAttenuation = 0.08, cooldownMs = 0) {
    const now = performance.now();
    const lastAt = this.effectLastAt.get(id) || 0;
    if (cooldownMs > 0 && now - lastAt < cooldownMs) {
      return false;
    }
    this.effectLastAt.set(id, now);

    const template = this.ensureEffectClip(id, src);
    if (!template) return false;

    const attenuation = clamp(1 - distance / maxDistance, minAttenuation, 1);
    const instance = template.cloneNode();
    instance.volume = clamp(baseVolume * attenuation * this.sfxLevel, 0, 1);
    const maybePromise = instance.play();
    if (maybePromise && typeof maybePromise.catch === 'function') {
      maybePromise.catch(() => {});
    }
    return true;
  }

  playWeaponShot(weapon, distance = 0) {
    if (weapon === 'shotgun') {
      if (this.playEffectClip('shotgun_blast', '/assets/audio/shotgun_blast.mp3', distance, 0.42, 1100, 0.1, 70)) {
        return;
      }
    } else if (weapon === 'machinegun') {
      if (this.playEffectClip('gun_pistol', '/assets/audio/gun_pistol.mp3', distance, 0.3, 1000, 0.08, 45)) {
        return;
      }
    } else if (weapon === 'pistol') {
      if (this.playEffectClip('gun_pistol', '/assets/audio/gun_pistol.mp3', distance, 0.34, 980, 0.08, 55)) {
        return;
      }
    }

    this.playShot(distance);
  }

  playExplosion(distance = 0) {
    if (this.playEffectClip('explosion', '/assets/audio/explosion.mp3', distance, 0.46, 1300, 0.1, 80)) {
      return;
    }
    this.playImpact(distance);
  }

  update(state, now) {
    if (!this.ctx || !state || !state.localPlayer) return;

    if (!this.cityLoopPlaying) {
      this.tryStartCityLoop();
    }

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

    const currentStars = Number(localPlayer.stars) || 0;
    if (this.lastStars < 5 && currentStars >= 5) {
      this.playFiveStarCue();
    }
    this.lastStars = currentStars;

    let nearestSiren = Infinity;
    for (const car of state.cars || []) {
      if ((car.type !== 'cop' && car.type !== 'ambulance') || !car.sirenOn) continue;
      const dxRaw = Math.abs((car.x || 0) - (localPlayer.x || 0));
      const dyRaw = Math.abs((car.y || 0) - (localPlayer.y || 0));
      const dx = Math.min(dxRaw, Math.max(0, WORLD.width - dxRaw));
      const dy = Math.min(dyRaw, Math.max(0, WORLD.height - dyRaw));
      const dist = Math.hypot(dx, dy);
      if (dist < nearestSiren) nearestSiren = dist;
    }
    if (Number.isFinite(nearestSiren)) {
      const sirenVolume = clamp(1 - nearestSiren / 920, 0, 1) * 0.28;
      this.setSirenVolume(sirenVolume);
    } else {
      this.setSirenVolume(0);
    }
  }
}

const audio = new GameAudio();
function refreshSettingsPanel() {
  if (settingsMusicVol) {
    settingsMusicVol.value = String(Math.round(settingsDraft.music * 100));
  }
  if (settingsSfxVol) {
    settingsSfxVol.value = String(Math.round(settingsDraft.sfx * 100));
  }
  if (settingsMusicVolValue) {
    settingsMusicVolValue.textContent = `${Math.round(settingsDraft.music * 100)}%`;
  }
  if (settingsSfxVolValue) {
    settingsSfxVolValue.textContent = `${Math.round(settingsDraft.sfx * 100)}%`;
  }
}

function applyAudioSettings() {
  audio.setLevels(audioSettings.music, audioSettings.sfx);
}

function isSettingsOpen() {
  return !!settingsOverlay && !settingsOverlay.classList.contains('hidden');
}

function stopMovementInput() {
  INPUT.up = false;
  INPUT.down = false;
  INPUT.left = false;
  INPUT.right = false;
  INPUT.enter = false;
  INPUT.horn = false;
  INPUT.shootHeld = false;
}

function openSettingsPanel() {
  if (!settingsOverlay) return;
  settingsDraft.music = audioSettings.music;
  settingsDraft.sfx = audioSettings.sfx;
  refreshSettingsPanel();
  settingsOverlay.classList.remove('hidden');
  settingsOverlay.setAttribute('aria-hidden', 'false');
  stopMovementInput();
}

function closeSettingsPanel() {
  if (!settingsOverlay) return;
  settingsOverlay.classList.add('hidden');
  settingsOverlay.setAttribute('aria-hidden', 'true');
  stopMovementInput();
}

function saveSettingsPanel() {
  audioSettings.music = settingsDraft.music;
  audioSettings.sfx = settingsDraft.sfx;
  applyAudioSettings();
  saveAudioSettings();
  closeSettingsPanel();
}

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
        shootHeld: INPUT.shootHeld,
        shootSeq: INPUT.shootSeq,
        weaponSlot: INPUT.weaponSlot,
        aimX: Math.round(POINTER.worldX * 100) / 100,
        aimY: Math.round(POINTER.worldY * 100) / 100,
        clickAimX: Math.round(INPUT.clickAimX * 100) / 100,
        clickAimY: Math.round(INPUT.clickAimY * 100) / 100,
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
  closeSettingsPanel();
  audio.resetSessionAudioState();
  INPUT.up = false;
  INPUT.down = false;
  INPUT.left = false;
  INPUT.right = false;
  INPUT.enter = false;
  INPUT.horn = false;
  INPUT.shootHeld = false;
  INPUT.shootSeq = 0;
  INPUT.weaponSlot = 1;
  INPUT.clickAimX = WORLD.width * 0.5;
  INPUT.clickAimY = WORLD.height * 0.5;
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
      audio.playWeaponShot(ev.weapon, distance);
      pushEffect({
        type: 'bullet',
        x: ev.x,
        y: ev.y,
        toX: ev.toX ?? ev.x,
        toY: ev.toY ?? ev.y,
        progress: 0,
        speed:
          ev.weapon === 'shotgun' ? 3.6 : ev.weapon === 'machinegun' ? 6.0 : ev.weapon === 'bazooka' ? 2.4 : 4.8,
        ttl: 0.18,
      });
    } else if (ev.type === 'explosion') {
      audio.playExplosion(distance);
      pushEffect({
        type: 'explosion',
        x: ev.x,
        y: ev.y,
        radius: ev.radius || 144,
        ttl: 0.38,
      });
    } else if (ev.type === 'melee') {
      pushEffect({
        type: 'melee',
        x: ev.x,
        y: ev.y,
        toX: ev.toX ?? ev.x,
        toY: ev.toY ?? ev.y,
        ttl: 0.12,
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
    } else if (ev.type === 'pvpKill') {
      if (ev.killerId === playerId) {
        statusNotice = 'You eliminated a player';
      } else if (ev.victimId === playerId) {
        statusNotice = 'You were eliminated';
      } else {
        statusNotice = '';
      }
      if (statusNotice) {
        statusNoticeUntil = performance.now() + 2200;
      }
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
      cops: single.cops || [],
      drops: single.drops || [],
      blood: single.blood || [],
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
  const olderCops = new Map((older.cops || []).map((c) => [c.id, c]));
  const olderDrops = new Map((older.drops || []).map((d) => [d.id, d]));
  const olderBlood = new Map((older.blood || []).map((b) => [b.id, b]));

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

  const cops = (newer.cops || []).map((next) => {
    const prev = olderCops.get(next.id) || next;
    if (!next.alive || !prev.alive || next.inCarId) {
      return { ...next };
    }
    return {
      ...next,
      x: lerp(prev.x, next.x, t),
      y: lerp(prev.y, next.y, t),
      dir: angleLerp(prev.dir || 0, next.dir || 0, t),
    };
  });

  const blood = (newer.blood || []).map((next) => {
    const prev = olderBlood.get(next.id) || next;
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
    cops,
    drops,
    blood,
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
    ctx.fillStyle = '#4a4f56';
    ctx.fillRect(sx, sy, tile, tile);

    const blockX = Math.floor(worldX / tile);
    const blockY = Math.floor(worldY / tile);
    const seed = hash2D(blockX, blockY);
    ctx.fillStyle = seed > 0.5 ? '#59616b' : '#424850';
    ctx.fillRect(sx, sy, tile, 2);
    ctx.fillRect(sx, sy + tile - 2, tile, 2);
    if (seed > 0.28) {
      ctx.fillStyle = '#90a5b8';
      ctx.fillRect(sx + 3, sy + 4, 2, 2);
      ctx.fillRect(sx + 7, sy + 4, 2, 2);
      ctx.fillRect(sx + 11, sy + 4, 2, 2);
    }
    if (seed > 0.74) {
      ctx.fillStyle = '#343942';
      ctx.fillRect(sx + 6, sy + 8, 4, 4);
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

    ctx.fillStyle = '#2f3238';
    ctx.fillRect(sx - 16, sy - 16, 32, 24);
    ctx.fillStyle = '#505863';
    ctx.fillRect(sx - 14, sy - 14, 28, 5);
    ctx.fillStyle = '#1a1d22';
    ctx.fillRect(sx - 4, sy - 3, 8, 10);
    ctx.fillStyle = '#2d1d15';
    ctx.fillRect(sx - 13, sy - 23, 26, 7);
    ctx.fillStyle = '#ffb768';
    ctx.font = '6px "Lucida Console", Monaco, monospace';
    const label = 'GUN SHOP';
    const w = ctx.measureText(label).width;
    ctx.fillText(label, sx - w * 0.5, sy - 18);
  }
}

function drawHospitalMarker(state, worldLeft, worldTop) {
  const hospital = state.world?.hospital;
  if (!hospital) return;

  const sx = Math.round(hospital.x - worldLeft);
  const sy = Math.round(hospital.y - worldTop);
  if (sx < -50 || sy < -50 || sx > canvas.width + 50 || sy > canvas.height + 50) {
    return;
  }

  ctx.fillStyle = '#d9dce3';
  ctx.fillRect(sx - 18, sy - 15, 36, 25);
  ctx.fillStyle = '#aeb4bf';
  ctx.fillRect(sx - 16, sy - 13, 32, 5);
  ctx.fillStyle = '#232730';
  ctx.fillRect(sx - 5, sy - 2, 10, 12);
  ctx.fillStyle = '#b72f36';
  ctx.fillRect(sx - 13, sy - 24, 26, 7);
  ctx.fillStyle = '#ffe5ea';
  ctx.font = '6px "Lucida Console", Monaco, monospace';
  const label = 'HOSP';
  const w = ctx.measureText(label).width;
  ctx.fillText(label, sx - w * 0.5, sy - 19);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(sx - 2, sy - 11, 4, 10);
  ctx.fillRect(sx - 6, sy - 7, 12, 4);
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

function drawBloodStains(state, worldLeft, worldTop) {
  for (const stain of state.blood || []) {
    const sx = Math.round(stain.x - worldLeft);
    const sy = Math.round(stain.y - worldTop);
    if (sx < -18 || sy < -18 || sx > canvas.width + 18 || sy > canvas.height + 18) {
      continue;
    }

    ctx.fillStyle = '#6d1a1d';
    ctx.fillRect(sx - 4, sy - 2, 8, 4);
    ctx.fillRect(sx - 2, sy - 4, 4, 8);
    ctx.fillRect(sx - 6, sy - 1, 2, 2);
    ctx.fillRect(sx + 4, sy + 1, 2, 2);
  }
}

function drawShopInterior(state) {
  const local = state.localPlayer;
  const shop = findShopByIdInWorld(state.world, local.insideShopId);
  const shotgunPrice = shop?.stock?.shotgun ?? 500;
  const machinegunPrice = shop?.stock?.machinegun ?? 1000;
  const bazookaPrice = shop?.stock?.bazooka ?? 5000;

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

  const shotgunOwned = !!local.ownedShotgun;
  const machinegunOwned = !!local.ownedMachinegun;
  const bazookaOwned = !!local.ownedBazooka;
  const weaponLabel = local.weapon || 'fist';

  ctx.fillStyle = '#d8d8d8';
  ctx.fillText('You start with a Gun (slot 1)', panelX + 18, panelY + 62);
  ctx.fillStyle = shotgunOwned ? '#8dff7c' : '#ffd3a2';
  ctx.fillText(`1) Buy Shotgun $${shotgunPrice} ${shotgunOwned ? '(owned)' : ''}`, panelX + 18, panelY + 82);
  ctx.fillStyle = machinegunOwned ? '#8dff7c' : '#ffd3a2';
  ctx.fillText(`2) Buy Machinegun $${machinegunPrice} ${machinegunOwned ? '(owned)' : ''}`, panelX + 18, panelY + 100);
  ctx.fillStyle = bazookaOwned ? '#8dff7c' : '#ffd3a2';
  ctx.fillText(`3) Buy Bazooka $${bazookaPrice} ${bazookaOwned ? '(owned)' : ''}`, panelX + 18, panelY + 118);
  ctx.fillStyle = '#cbd3db';
  ctx.fillText('4) Equip Gun', panelX + 18, panelY + 136);

  ctx.fillStyle = '#bfc8d6';
  ctx.fillText(`Current Weapon: ${weaponLabel}`, panelX + 18, panelY + 154);
  ctx.fillStyle = '#e8e8e8';
  ctx.fillText('Press E to leave shop', panelX + 18, panelY + 172);
}

const CAR_SPRITE_TEMPLATE_FALLBACK = [
  '..11111....11..12.......',
  '..233331111331123111111.',
  '.28444333343333331343592',
  '142235333433333312245393',
  '332244444444443222235443',
  '332145555555543222225543',
  '332145555555543222225543',
  '332145555555543222225543',
  '331145555555543222225543',
  '331144444444443222235443',
  '132135333433333412245393',
  '.28444333343333331433591',
  '..233331111331113111111.',
  '..11111....11..12.......',
];
const CAR_TEMPLATE_WIDTH = 24;
const CAR_TEMPLATE_HEIGHT = 14;
const CUSTOM_CAR_SPRITE_PATH = 'assets/cars/car.png';
const carSpriteCache = new Map();
let customCarTemplate = null;
let customCarTemplateState = 'idle';

function classifyCarTemplateCell(avgA, r, g, b) {
  if (avgA < 20) return '.';

  if (r > 190 && g > 185 && b > 160) return '7';
  if (r > 130 && r > g * 1.25 && r > b * 1.35) return '8';

  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (b > g + 18 && b > r + 18) {
    if (lum < 78) return '3';
    if (lum < 108) return '4';
    return '5';
  }

  if (lum < 38) return '1';
  if (lum < 68) return '2';
  if (lum < 110) return '6';
  return '9';
}

function extractCarTemplateFromImage(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;

  const scan = document.createElement('canvas');
  scan.width = w;
  scan.height = h;
  const gx = scan.getContext('2d');
  gx.imageSmoothingEnabled = false;
  gx.drawImage(img, 0, 0);

  const pixels = gx.getImageData(0, 0, w, h).data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (pixels[i + 3] < 24) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  let nonEmpty = 0;
  const rows = [];

  for (let by = 0; by < CAR_TEMPLATE_HEIGHT; by += 1) {
    let row = '';
    const py0 = minY + Math.floor((by * bh) / CAR_TEMPLATE_HEIGHT);
    const py1 = minY + Math.max(py0 - minY + 1, Math.floor(((by + 1) * bh) / CAR_TEMPLATE_HEIGHT));

    for (let bx = 0; bx < CAR_TEMPLATE_WIDTH; bx += 1) {
      const px0 = minX + Math.floor((bx * bw) / CAR_TEMPLATE_WIDTH);
      const px1 = minX + Math.max(px0 - minX + 1, Math.floor(((bx + 1) * bw) / CAR_TEMPLATE_WIDTH));

      let sumA = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;

      for (let py = py0; py < py1; py += 1) {
        for (let px = px0; px < px1; px += 1) {
          const i = (py * w + px) * 4;
          const a = pixels[i + 3];
          const aw = a / 255;
          sumA += a;
          sumR += pixels[i] * aw;
          sumG += pixels[i + 1] * aw;
          sumB += pixels[i + 2] * aw;
          count += 1;
        }
      }

      const avgA = count > 0 ? sumA / count : 0;
      let r = 0;
      let g = 0;
      let b = 0;
      if (sumA > 0) {
        const norm = sumA / 255;
        r = sumR / norm;
        g = sumG / norm;
        b = sumB / norm;
      }

      const token = classifyCarTemplateCell(avgA, r, g, b);
      if (token !== '.') nonEmpty += 1;
      row += token;
    }

    rows.push(row);
  }

  return nonEmpty >= 56 ? rows : null;
}

function ensureCustomCarTemplate() {
  if (customCarTemplateState !== 'idle') return;
  customCarTemplateState = 'loading';
  const img = new Image();
  img.onload = () => {
    const extracted = extractCarTemplateFromImage(img);
    if (extracted) {
      customCarTemplate = extracted;
      customCarTemplateState = 'ready';
    } else {
      customCarTemplate = null;
      customCarTemplateState = 'missing';
    }
    carSpriteCache.clear();
  };
  img.onerror = () => {
    customCarTemplate = null;
    customCarTemplateState = 'missing';
    carSpriteCache.clear();
  };
  img.src = `${CUSTOM_CAR_SPRITE_PATH}?v=${Date.now()}`;
}

function normalizeHexColor(value, fallback = '#5ca1ff') {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) {
    return text.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(text)) {
    const r = text[1];
    const g = text[2];
    const b = text[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

function hexToRgb(hex) {
  const safe = normalizeHexColor(hex);
  return {
    r: Number.parseInt(safe.slice(1, 3), 16),
    g: Number.parseInt(safe.slice(3, 5), 16),
    b: Number.parseInt(safe.slice(5, 7), 16),
  };
}

function rgbToHex(r, g, b) {
  const rr = clamp(Math.round(r), 0, 255).toString(16).padStart(2, '0');
  const gg = clamp(Math.round(g), 0, 255).toString(16).padStart(2, '0');
  const bb = clamp(Math.round(b), 0, 255).toString(16).padStart(2, '0');
  return `#${rr}${gg}${bb}`;
}

function shadeHex(hex, multiplier) {
  const c = hexToRgb(hex);
  return rgbToHex(c.r * multiplier, c.g * multiplier, c.b * multiplier);
}

function mixHex(a, b, ratio) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const t = clamp(ratio, 0, 1);
  return rgbToHex(lerp(ca.r, cb.r, t), lerp(ca.g, cb.g, t), lerp(ca.b, cb.b, t));
}

function getCarSpritePalette(type, bodyColor) {
  const fallback = type === 'cop' ? '#4878c6' : '#4f9dff';
  const base = normalizeHexColor(type === 'cop' ? '#4878c6' : bodyColor, fallback);
  const shadow = shadeHex(base, 0.56);
  const body = shadeHex(base, 0.78);
  const light = shadeHex(base, 1.06);
  const highlight = mixHex(base, '#ffffff', 0.3);

  return {
    '1': '#0c1118',
    '2': shadow,
    '3': body,
    '4': light,
    '5': '#1c2736',
    '6': type === 'cop' ? '#3f5b78' : '#567291',
    '7': '#fff2c8',
    '8': '#ff5061',
    '9': type === 'cop' ? '#f0f5ff' : highlight,
  };
}

function buildCarSprite(type, bodyColor) {
  const template = customCarTemplateState === 'ready' && customCarTemplate ? customCarTemplate : CAR_SPRITE_TEMPLATE_FALLBACK;
  const width = template[0].length;
  const height = template.length;
  const sprite = document.createElement('canvas');
  sprite.width = width;
  sprite.height = height;
  const g = sprite.getContext('2d');
  const palette = getCarSpritePalette(type, bodyColor);
  g.imageSmoothingEnabled = false;

  for (let y = 0; y < height; y += 1) {
    const row = template[y];
    for (let x = 0; x < width; x += 1) {
      const token = row[x];
      if (token === '.') continue;
      const color = palette[token];
      if (!color) continue;
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    }
  }

  if (type === 'cop') {
    g.fillStyle = '#e7edf8';
    g.fillRect(6, Math.floor(height * 0.5) - 1, width - 12, 2);
    const cx = Math.floor(width * 0.5);
    g.fillStyle = '#e9f3ff';
    g.fillRect(cx - 2, 5, 4, 2);
    g.fillStyle = '#ef4f5a';
    g.fillRect(cx - 2, 4, 2, 2);
    g.fillStyle = '#5ea7ff';
    g.fillRect(cx, 4, 2, 2);
  }

  return sprite;
}

function getCarSprite(type, bodyColor) {
  ensureCustomCarTemplate();
  const fallback = type === 'cop' ? '#5ca1ff' : '#4f9dff';
  const safeColor = normalizeHexColor(bodyColor, fallback);
  const sourceKey = customCarTemplateState === 'ready' ? 'custom' : 'fallback';
  const key = `${sourceKey}|${type}|${safeColor}`;
  const cached = carSpriteCache.get(key);
  if (cached) return cached;
  const sprite = buildCarSprite(type, safeColor);
  carSpriteCache.set(key, sprite);
  return sprite;
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

  const sprite = getCarSprite(car.type, car.color);
  const halfW = Math.floor(sprite.width * 0.5);
  const halfH = Math.floor(sprite.height * 0.5);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.33)';
  ctx.fillRect(-Math.floor(sprite.width * 0.46), halfH - 1, Math.floor(sprite.width * 0.92), 3);

  ctx.drawImage(sprite, -halfW, -halfH);

  if (car.type === 'cop') {
    const sirenActive = !!car.sirenOn;
    const flashStep = Math.floor(performance.now() / 120) % 2;
    const blueOn = sirenActive && flashStep === 0;
    const redOn = sirenActive && flashStep === 1;
    ctx.fillStyle = blueOn ? '#6fb8ff' : '#24374a';
    ctx.fillRect(-3, -halfH + 1, 3, 2);
    ctx.fillStyle = redOn ? '#ff5c68' : '#3f262b';
    ctx.fillRect(0, -halfH + 1, 3, 2);
  }

  if (car.type === 'ambulance') {
    const sirenActive = !!car.sirenOn;
    const flashStep = Math.floor(performance.now() / 120) % 2;
    const blueOn = sirenActive && flashStep === 0;
    const redOn = sirenActive && flashStep === 1;
    ctx.fillStyle = '#e6ebf7';
    ctx.fillRect(-6, -1, 12, 2);
    ctx.fillStyle = '#c8343e';
    ctx.fillRect(-1, -4, 2, 8);
    ctx.fillRect(-4, -1, 8, 2);
    ctx.fillStyle = blueOn ? '#6fb8ff' : '#233747';
    ctx.fillRect(-3, -halfH + 1, 3, 2);
    ctx.fillStyle = redOn ? '#ff5c68' : '#3f262b';
    ctx.fillRect(0, -halfH + 1, 3, 2);
  }

  if (car.npcDriver && !car.driverId) {
    ctx.fillStyle = '#f0c39a';
    ctx.fillRect(-1, -1, 2, 2);
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
  const x = Math.round(npc.x - worldLeft);
  const y = Math.round(npc.y - worldTop);
  if (x < -20 || y < -20 || x > canvas.width + 20 || y > canvas.height + 20) {
    return;
  }

  if (!npc.alive) {
    if (npc.corpseState === 'carried') return;
    ctx.fillStyle = '#2a3342';
    ctx.fillRect(x - 6, y - 2, 12, 4);
    ctx.fillStyle = npc.shirtColor || '#8092a6';
    ctx.fillRect(x - 5, y - 1, 10, 2);
    ctx.fillStyle = npc.skinColor || '#f0c39a';
    ctx.fillRect(x + 3, y - 1, 3, 2);
    return;
  }

  drawPixelCharacter(x, y, npc.dir || 0, npc.shirtColor || '#8092a6', npc.skinColor || '#f0c39a', '#2a3342');
}

function drawCop(cop, worldLeft, worldTop) {
  if (cop.inCarId) {
    return;
  }
  const x = Math.round(cop.x - worldLeft);
  const y = Math.round(cop.y - worldTop);
  if (x < -20 || y < -20 || x > canvas.width + 20 || y > canvas.height + 20) {
    return;
  }
  if (!cop.alive) {
    if (cop.corpseState === 'carried') return;
    ctx.fillStyle = '#1f3157';
    ctx.fillRect(x - 6, y - 2, 12, 4);
    ctx.fillStyle = '#3e76d8';
    ctx.fillRect(x - 5, y - 1, 10, 2);
    ctx.fillStyle = '#efc39e';
    ctx.fillRect(x + 3, y - 1, 3, 2);
    return;
  }
  const uniform = cop.mode === 'hunt' ? '#4a8dff' : '#3e76d8';
  drawPixelCharacter(x, y, cop.dir || 0, uniform, '#efc39e', '#1f3157');
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
    } else if (effect.type === 'melee') {
      const sx = Math.round(effect.x - worldLeft);
      const sy = Math.round(effect.y - worldTop);
      const tx = Math.round(effect.toX - worldLeft);
      const ty = Math.round(effect.toY - worldTop);
      ctx.strokeStyle = '#f0f3ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    } else if (effect.type === 'explosion') {
      const sx = Math.round(effect.x - worldLeft);
      const sy = Math.round(effect.y - worldTop);
      const life = clamp(effect.ttl / 0.38, 0, 1);
      const r = Math.max(8, (effect.radius || 144) * (1 - life));
      ctx.fillStyle = 'rgba(255, 172, 88, 0.26)';
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 228, 158, 0.92)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(4, r * 0.72), 0, Math.PI * 2);
      ctx.stroke();
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
  drawHospitalMarker(state, worldLeft, worldTop);
  drawBloodStains(state, worldLeft, worldTop);
  drawDrops(state, worldLeft, worldTop);

  const drawList = [];
  for (const car of state.cars) {
    drawList.push({ kind: 'car', y: car.y, item: car });
  }
  for (const npc of state.npcs) {
    if (!npc.alive && npc.corpseState === 'carried') continue;
    drawList.push({ kind: 'npc', y: npc.y + 4, item: npc });
  }
  for (const cop of state.cops || []) {
    drawList.push({ kind: 'cop', y: cop.y + 5, item: cop });
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
    } else if (entry.kind === 'cop') {
      drawCop(entry.item, worldLeft, worldTop);
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
  const health = Math.max(0, Number.isFinite(p.health) ? p.health : 0);
  const lives = Math.max(0, Math.min(5, Math.ceil(health / 20)));
  hudHealth.textContent = `Lives: ${'♥'.repeat(lives)}${'♡'.repeat(5 - lives)}`;
  const weaponLabel =
    p.weapon === 'bazooka'
      ? 'bazooka'
      : p.weapon === 'machinegun'
        ? 'machinegun'
        : p.weapon === 'shotgun'
          ? 'shotgun'
          : p.weapon === 'pistol'
            ? 'gun'
            : 'fists';
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
  if (tag === 'INPUT') {
    const type = String(target.getAttribute('type') || '').toLowerCase();
    // HUD sliders should not block gameplay keys (WASD/1..4/etc.).
    if (type === 'range') {
      return false;
    }
    return true;
  }
  if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') {
    return true;
  }
  return target.isContentEditable;
}

function shouldHandleGameKey(event) {
  if (!joined) return false;
  if (!joinOverlay.classList.contains('hidden')) return false;
  if (isSettingsOpen()) return false;
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
  if (
    event.code !== 'Digit1' &&
    event.code !== 'Digit2' &&
    event.code !== 'Digit3' &&
    event.code !== 'Digit4'
  ) {
    return false;
  }

  const local = latestState?.localPlayer;
  if (!local) {
    return false;
  }

  if (local.insideShopId) {
    if (event.code === 'Digit1') {
      sendBuy('shotgun');
    } else if (event.code === 'Digit2') {
      sendBuy('machinegun');
    } else if (event.code === 'Digit3') {
      sendBuy('bazooka');
    } else if (event.code === 'Digit4') {
      INPUT.weaponSlot = 1;
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
  } else if (event.code === 'Digit4') {
    INPUT.weaponSlot = 4;
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
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      if (!joined) return;
      if (isSettingsOpen()) {
        closeSettingsPanel();
      } else {
        openSettingsPanel();
      }
    });
  }

  if (settingsMusicVol) {
    settingsMusicVol.addEventListener('input', (event) => {
      const value = Number(event.target.value);
      settingsDraft.music = clamp(value / 100, 0, 1);
      refreshSettingsPanel();
    });
  }

  if (settingsSfxVol) {
    settingsSfxVol.addEventListener('input', (event) => {
      const value = Number(event.target.value);
      settingsDraft.sfx = clamp(value / 100, 0, 1);
      refreshSettingsPanel();
    });
  }

  if (settingsCancelBtn) {
    settingsCancelBtn.addEventListener('click', () => {
      closeSettingsPanel();
    });
  }

  if (settingsSaveBtn) {
    settingsSaveBtn.addEventListener('click', () => {
      saveSettingsPanel();
    });
  }

  if (settingsOverlay) {
    settingsOverlay.addEventListener('mousedown', (event) => {
      if (!settingsPanel) return;
      if (event.target === settingsOverlay) {
        closeSettingsPanel();
      }
    });
  }

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
    if (joined && event.code === 'KeyO' && !event.repeat) {
      if (isSettingsOpen()) {
        closeSettingsPanel();
      } else {
        openSettingsPanel();
      }
      event.preventDefault();
      return;
    }

    if (isSettingsOpen() && event.code === 'Escape') {
      closeSettingsPanel();
      event.preventDefault();
      return;
    }

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
    if (!local || local.insideShopId || !local.weapon) return;

    updatePointer(event.clientX, event.clientY);
    INPUT.clickAimX = POINTER.worldX;
    INPUT.clickAimY = POINTER.worldY;
    INPUT.shootHeld = true;
    INPUT.shootSeq = (INPUT.shootSeq + 1) >>> 0;
    event.preventDefault();
  });

  window.addEventListener('mouseup', (event) => {
    if (event.button !== 0) return;
    INPUT.shootHeld = false;
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
    INPUT.shootHeld = false;
  });

  window.addEventListener('resize', resizeCanvas);
}

function boot() {
  applyAudioSettings();
  refreshSettingsPanel();
  populateColorGrid();
  selectColor(selectedColor);
  setStep('name');
  resizeCanvas();
  attachUiEvents();
  startRenderLoop();
  nameInput.focus();
}

boot();
