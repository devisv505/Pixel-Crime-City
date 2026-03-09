const protocolApi = window.ClientProtocol;
if (!protocolApi) {
  throw new Error('ClientProtocol is not loaded.');
}
const { decodeServerFrame, encodeJoinFrame, encodeInputFrame, encodeBuyFrame, encodeChatFrame } = protocolApi;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

const joinOverlay = document.getElementById('joinOverlay');
const stepName = document.getElementById('stepName');
const stepColor = document.getElementById('stepColor');
const nameInput = document.getElementById('nameInput');
const profileNameList = document.getElementById('profileNameList');
const profileHint = document.getElementById('profileHint');
const profileList = document.getElementById('profileList');
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
const hudOnline = document.getElementById('hudOnline');
const hudWorldStats = document.getElementById('hudWorldStats');
const mapBtn = document.getElementById('mapBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsPanel = document.getElementById('settingsPanel');
const settingsMusicVol = document.getElementById('settingsMusicVol');
const settingsSfxVol = document.getElementById('settingsSfxVol');
const settingsSirenVol = document.getElementById('settingsSirenVol');
const settingsMusicVolValue = document.getElementById('settingsMusicVolValue');
const settingsSfxVolValue = document.getElementById('settingsSfxVolValue');
const settingsSirenVolValue = document.getElementById('settingsSirenVolValue');
const settingsSaveBtn = document.getElementById('settingsSaveBtn');
const settingsCancelBtn = document.getElementById('settingsCancelBtn');
const chatBar = document.getElementById('chatBar');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');

const PROFILE_STORAGE_KEY = 'pcc_profiles_v1';
const PROFILE_LAST_NAME_KEY = 'pcc_profiles_last_name_v1';
const PROFILE_MAX_ENTRIES = 24;

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
  requestStats: false,
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
  worldRev: 0,
  shops: [],
  hospital: null,
};

const camera = { x: WORLD.width * 0.5, y: WORLD.height * 0.5 };
let viewScale = 3;

let socket = null;
let joined = false;
let playerId = null;
let selectedName = '';
let selectedColor = COLOR_CHOICES[0];
let selectedProfileTicket = '';
let localProfiles = [];
let snapshots = [];
let lastSnapshot = null;
let lastFrameTime = performance.now();
let inputSendAccumulator = 0;
let localPlayerCache = null;
let latestState = null;
let statusNotice = '';
let statusNoticeUntil = 0;
let mapVisible = false;
let renderNowMs = performance.now();
const walkAnimById = new Map();
let lastWalkAnimCleanupAt = 0;
let worldRev = 0;
let presenceOnlineCount = 0;
let presencePlayers = [];
const clientBloodStains = new Map();
let debugStatsVisible = false;
let nextInputSeq = 1;
let lastAckInputSeq = 0;
const pendingInputs = [];
let localPrediction = null;
let serverClockOffsetMs = 0;
let hasClockSync = false;
let smoothedRttMs = 120;
let dynamicInterpDelayMs = 90;
let lastServerSnapshotTime = 0;

const snapshotEntityState = {
  players: new Map(),
  cars: new Map(),
  npcs: new Map(),
  cops: new Map(),
  drops: new Map(),
  blood: new Map(),
};

const PLAYER_SPEED = 110;
const CAR_WIDTH = 24;
const CAR_HEIGHT = 14;
const CAR_COLLISION_HALF_LENGTH_SCALE = 0.47;
const CAR_COLLISION_HALF_WIDTH_SCALE = 0.47;
const CAR_BUILDING_COLLISION_INSET_PX = 2;
const INPUT_SEND_RATE = 72;
const LOCAL_PREDICTION_RATE = 120;
const REMOTE_INTERP_MIN_MS = 70;
const REMOTE_INTERP_MAX_MS = 100;
const PREDICTION_HARD_SNAP_DIST = 64;
const ENABLE_LOCAL_PREDICTION = false;
const SERVER_RENDER_DELAY_MS = 90;
const LOCAL_TELEPORT_SNAP_DIST = 220;
let localPredictionAccumulator = 0;
let lastMoveInputAtMs = 0;
let cameraHardSnapPending = false;

const seenEventIds = new Set();
const seenEventQueue = [];
const MAX_SEEN_EVENTS = 650;
const CLIENT_BLOOD_TTL = 240;

const visualEffects = [];
const AUDIO_PREF_MUSIC_KEY = 'pcc_music_volume';
const AUDIO_PREF_SFX_KEY = 'pcc_sfx_volume';
const AUDIO_PREF_SIREN_KEY = 'pcc_siren_volume';
const BASE_BUILDING_TEXTURE_SOURCES = [
  '/assets/buildings/building_01.png',
  '/assets/buildings/building_02.png',
  '/assets/buildings/building_03.png',
  '/assets/buildings/building_04.png',
  '/assets/buildings/building_05.png',
  '/assets/buildings/building_06.png',
  '/assets/buildings/building_07.png',
];
const ARMORY_BUILDING_TEXTURE_SOURCES = [
  '/assets/buildings/armory_01.png',
  '/assets/buildings/armory_02.png',
  '/assets/buildings/armory_03.png',
  '/assets/buildings/armory_04.png',
];
const HOSPITAL_BUILDING_TEXTURE_SOURCE = '/assets/buildings/hospital_01.png';
const BUILDING_TEXTURE_SOURCES = [
  ...BASE_BUILDING_TEXTURE_SOURCES,
  ...ARMORY_BUILDING_TEXTURE_SOURCES,
  HOSPITAL_BUILDING_TEXTURE_SOURCE,
];
const BLOCK_TEXTURE_SOURCES = ['/assets/buildings/block_01.png'];
const BASE_BUILDING_VARIANT_COUNT = BASE_BUILDING_TEXTURE_SOURCES.length;
const ARMORY_VARIANT_START = BASE_BUILDING_VARIANT_COUNT;
const HOSPITAL_VARIANT_INDEX = ARMORY_VARIANT_START + ARMORY_BUILDING_TEXTURE_SOURCES.length;
const buildingTextures = BUILDING_TEXTURE_SOURCES.map((src) => ({
  src,
  state: 'idle',
  width: 0,
  height: 0,
  image: null,
}));
const blockTextures = BLOCK_TEXTURE_SOURCES.map((src) => ({
  src,
  state: 'idle',
  width: 0,
  height: 0,
  image: null,
}));
let buildingTexturesRequested = false;
let blockTexturesRequested = false;

function parseAudioPref(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, 0, 1);
}

const audioSettings = {
  music: parseAudioPref(localStorage.getItem(AUDIO_PREF_MUSIC_KEY), 0.65),
  sfx: parseAudioPref(localStorage.getItem(AUDIO_PREF_SFX_KEY), 0.8),
  siren: parseAudioPref(localStorage.getItem(AUDIO_PREF_SIREN_KEY), 0.55),
};
const settingsDraft = {
  music: audioSettings.music,
  sfx: audioSettings.sfx,
  siren: audioSettings.siren,
};

function profileNameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase();
}

function parseStoredProfiles(raw) {
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const cleaned = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const name = String(entry.name || '')
      .trim()
      .replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 16) continue;
    const ticket = typeof entry.ticket === 'string' ? entry.ticket : '';
    const updatedAt = Number.isFinite(entry.updatedAt) ? Math.round(entry.updatedAt) : Date.now();
    cleaned.push({ name, ticket, updatedAt });
  }
  cleaned.sort((a, b) => b.updatedAt - a.updatedAt);
  return cleaned.slice(0, PROFILE_MAX_ENTRIES);
}

function saveProfilesToStorage() {
  const payload = localProfiles.slice(0, PROFILE_MAX_ENTRIES);
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(payload));
}

function findStoredProfileByName(name) {
  const key = profileNameKey(name);
  if (!key) return null;
  for (const profile of localProfiles) {
    if (profileNameKey(profile.name) === key) {
      return profile;
    }
  }
  return null;
}

function syncSelectedProfileFromName(name) {
  const profile = findStoredProfileByName(name);
  if (profile && profile.ticket) {
    selectedProfileTicket = profile.ticket;
    if (profileHint) {
      profileHint.textContent = `Saved progress ready for "${profile.name}".`;
    }
  } else {
    selectedProfileTicket = '';
    if (profileHint) {
      const text = String(name || '').trim();
      profileHint.textContent = text ? 'No save found: this name starts fresh.' : '';
    }
  }
}

function renderProfileUi() {
  if (profileNameList) {
    profileNameList.innerHTML = '';
    for (const profile of localProfiles) {
      const option = document.createElement('option');
      option.value = profile.name;
      profileNameList.appendChild(option);
    }
  }

  if (!profileList) return;
  profileList.innerHTML = '';
  if (localProfiles.length === 0) {
    profileList.classList.add('hidden');
    return;
  }
  profileList.classList.remove('hidden');

  const activeKey = profileNameKey(nameInput?.value || '');
  for (const profile of localProfiles) {
    const row = document.createElement('div');
    row.className = 'profile-row';
    if (profileNameKey(profile.name) === activeKey) {
      row.classList.add('active');
    }

    const label = document.createElement('span');
    label.className = 'profile-row-name';
    label.textContent = profile.name;
    row.appendChild(label);

    const useBtn = document.createElement('button');
    useBtn.type = 'button';
    useBtn.textContent = 'Use';
    useBtn.addEventListener('click', () => {
      nameInput.value = profile.name;
      syncSelectedProfileFromName(profile.name);
      renderProfileUi();
      nameInput.focus();
    });
    row.appendChild(useBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'secondary';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      localProfiles = localProfiles.filter((entry) => profileNameKey(entry.name) !== profileNameKey(profile.name));
      saveProfilesToStorage();
      if (profileNameKey(nameInput.value) === profileNameKey(profile.name)) {
        selectedProfileTicket = '';
        if (profileHint) {
          profileHint.textContent = 'Profile deleted. Current name will start fresh.';
        }
      }
      renderProfileUi();
    });
    row.appendChild(deleteBtn);
    profileList.appendChild(row);
  }
}

function upsertStoredProfile(name, ticket) {
  const cleanName = String(name || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (cleanName.length < 2 || cleanName.length > 16) return;
  if (typeof ticket !== 'string' || !ticket) return;

  const key = profileNameKey(cleanName);
  localProfiles = localProfiles.filter((entry) => profileNameKey(entry.name) !== key);
  localProfiles.unshift({
    name: cleanName,
    ticket,
    updatedAt: Date.now(),
  });
  localProfiles = localProfiles.slice(0, PROFILE_MAX_ENTRIES);
  saveProfilesToStorage();
  localStorage.setItem(PROFILE_LAST_NAME_KEY, cleanName);
  if (profileNameKey(nameInput.value) === key) {
    selectedProfileTicket = ticket;
  }
  renderProfileUi();
}

function loadProfilesFromStorage() {
  localProfiles = parseStoredProfiles(localStorage.getItem(PROFILE_STORAGE_KEY));
  const remembered = String(localStorage.getItem(PROFILE_LAST_NAME_KEY) || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (remembered.length >= 2 && remembered.length <= 16) {
    nameInput.value = remembered;
  } else if (localProfiles.length > 0) {
    nameInput.value = localProfiles[0].name;
  }
  syncSelectedProfileFromName(nameInput.value);
  renderProfileUi();
}

function saveAudioSettings() {
  localStorage.setItem(AUDIO_PREF_MUSIC_KEY, String(audioSettings.music));
  localStorage.setItem(AUDIO_PREF_SFX_KEY, String(audioSettings.sfx));
  localStorage.setItem(AUDIO_PREF_SIREN_KEY, String(audioSettings.siren));
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
    this.sirenLevel = audioSettings.siren;
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
    const v = this.currentSirenVolume * this.sfxLevel * this.sirenLevel;
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

  setLevels(musicLevel, sfxLevel, sirenLevel = this.sirenLevel) {
    this.musicLevel = clamp(musicLevel, 0, 1);
    this.sfxLevel = clamp(sfxLevel, 0, 1);
    this.sirenLevel = clamp(sirenLevel, 0, 1);

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

  playCopWitness(distance = 0) {
    if (this.playEffectClip('police_scream_drop', '/assets/audio/police_scream_drop.mp3', distance, 0.38, 1200, 0.08, 900)) {
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

    let loudestSiren = 0;
    const halfW = canvas.width * 0.5;
    const halfH = canvas.height * 0.5;
    for (const car of state.cars || []) {
      if ((car.type !== 'cop' && car.type !== 'ambulance') || !car.sirenOn) continue;
      const dxRaw = Math.abs((car.x || 0) - (localPlayer.x || 0));
      const dyRaw = Math.abs((car.y || 0) - (localPlayer.y || 0));
      const dx = Math.min(dxRaw, Math.max(0, WORLD.width - dxRaw));
      const dy = Math.min(dyRaw, Math.max(0, WORLD.height - dyRaw));
      const dist = Math.hypot(dx, dy);
      const distMix = clamp(1 - dist / 920, 0, 1);
      if (distMix <= 0) continue;

      const cameraDx = wrapDelta((car.x || 0) - camera.x, WORLD.width);
      const cameraDy = wrapDelta((car.y || 0) - camera.y, WORLD.height);
      const outsideX = Math.max(0, Math.abs(cameraDx) - halfW);
      const outsideY = Math.max(0, Math.abs(cameraDy) - halfH);
      const outsideDist = Math.hypot(outsideX, outsideY);
      let offscreenFactor = 1;
      if (outsideDist > 0) {
        const nearEdge = clamp(1 - outsideDist / 620, 0, 1);
        offscreenFactor = 0.08 + nearEdge * 0.14;
      }

      const sirenMix = distMix * 0.28 * offscreenFactor;
      if (sirenMix > loudestSiren) {
        loudestSiren = sirenMix;
      }
    }
    this.setSirenVolume(loudestSiren);
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
  if (settingsSirenVol) {
    settingsSirenVol.value = String(Math.round(settingsDraft.siren * 100));
  }
  if (settingsMusicVolValue) {
    settingsMusicVolValue.textContent = `${Math.round(settingsDraft.music * 100)}%`;
  }
  if (settingsSfxVolValue) {
    settingsSfxVolValue.textContent = `${Math.round(settingsDraft.sfx * 100)}%`;
  }
  if (settingsSirenVolValue) {
    settingsSirenVolValue.textContent = `${Math.round(settingsDraft.siren * 100)}%`;
  }
}

function applyAudioSettings() {
  audio.setLevels(audioSettings.music, audioSettings.sfx, audioSettings.siren);
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
  settingsDraft.siren = audioSettings.siren;
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
  audioSettings.siren = settingsDraft.siren;
  applyAudioSettings();
  saveAudioSettings();
  closeSettingsPanel();
}

function loadBuildingTexture(index) {
  const target = buildingTextures[index];
  if (!target || target.state === 'loading' || target.state === 'ready') return;
  target.state = 'loading';

  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    try {
      const buffer = document.createElement('canvas');
      buffer.width = img.width;
      buffer.height = img.height;
      const g = buffer.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0);
      target.width = img.width;
      target.height = img.height;
      target.image = buffer;
      target.state = 'ready';
    } catch {
      target.state = 'missing';
    }
  };
  img.onerror = () => {
    target.state = 'missing';
  };
  img.src = target.src;
}

function ensureBuildingTexturesLoaded() {
  if (buildingTexturesRequested) return;
  buildingTexturesRequested = true;
  for (let i = 0; i < buildingTextures.length; i += 1) {
    loadBuildingTexture(i);
  }
}

function loadBlockTexture(index) {
  const target = blockTextures[index];
  if (!target || target.state === 'loading' || target.state === 'ready') return;
  target.state = 'loading';

  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    try {
      const buffer = document.createElement('canvas');
      buffer.width = img.width;
      buffer.height = img.height;
      const g = buffer.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0);
      target.width = img.width;
      target.height = img.height;
      target.image = buffer;
      target.state = 'ready';
    } catch {
      target.state = 'missing';
    }
  };
  img.onerror = () => {
    target.state = 'missing';
  };
  img.src = target.src;
}

function ensureBlockTexturesLoaded() {
  if (blockTexturesRequested) return;
  blockTexturesRequested = true;
  for (let i = 0; i < blockTextures.length; i += 1) {
    loadBlockTexture(i);
  }
}

function refreshMapToggleUi() {
  if (!mapBtn) return;
  mapBtn.classList.toggle('active', mapVisible);
  mapBtn.textContent = mapVisible ? 'Map ON' : 'Map';
}

function toggleMapOverlay() {
  mapVisible = !mapVisible;
  refreshMapToggleUi();
}

function mod(value, by) {
  return ((value % by) + by) % by;
}

function wrapDelta(value, size) {
  if (value > size * 0.5) return value - size;
  if (value < -size * 0.5) return value + size;
  return value;
}

function wrapCoord(value, size) {
  if (!Number.isFinite(value)) return 0;
  return mod(value, size);
}

function wrapWorldX(value) {
  return wrapCoord(value, WORLD.width);
}

function wrapWorldY(value) {
  return wrapCoord(value, WORLD.height);
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

function normalizeAngle(angle) {
  let a = Number.isFinite(angle) ? angle : 0;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function wrappedLerp(from, to, t, size) {
  return wrapCoord(from + wrapDelta(to - from, size) * t, size);
}

function approach(value, target, amount) {
  if (value < target) {
    return Math.min(target, value + amount);
  }
  if (value > target) {
    return Math.max(target, value - amount);
  }
  return value;
}

function angleApproach(current, target, maxStep) {
  const delta = normalizeAngle(target - current);
  if (Math.abs(delta) <= maxStep) {
    return target;
  }
  return current + Math.sign(delta) * maxStep;
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
  if (!blockHasBuildings(blockX, blockY)) {
    return 'park';
  }

  const plotIndex = plotIndexForLocalCoord(localX, localY);
  if (plotIndex !== null) {
    const rect = centeredBuildingRectForPlot(blockX, blockY, plotIndex);
    if (localX > rect.x0 && localX < rect.x1 && localY > rect.y0 && localY < rect.y1) {
      return 'building';
    }
  }
  return 'park';
}

function groundTypeAtWrapped(x, y) {
  return worldGroundTypeAt(wrapWorldX(x), wrapWorldY(y));
}

function isSolidForPed(x, y) {
  const g = groundTypeAtWrapped(x, y);
  return g === 'building' || g === 'void';
}

function isSolidForCar(x, y) {
  const worldX = wrapWorldX(x);
  const worldY = wrapWorldY(y);
  const g = groundTypeAtWrapped(worldX, worldY);
  if (g === 'void') return true;
  if (g !== 'building') return false;

  const localX = mod(worldX, WORLD.blockPx);
  const localY = mod(worldY, WORLD.blockPx);
  const plotIndex = plotIndexForLocalCoord(localX, localY);
  if (plotIndex === null) return false;

  const blockX = Math.floor(worldX / WORLD.blockPx);
  const blockY = Math.floor(worldY / WORLD.blockPx);
  const rect = centeredBuildingRectForPlot(blockX, blockY, plotIndex);
  const inset = CAR_BUILDING_COLLISION_INSET_PX;
  return (
    localX > rect.x0 + inset &&
    localX < rect.x1 - inset &&
    localY > rect.y0 + inset &&
    localY < rect.y1 - inset
  );
}

function carBodyPoints(car) {
  const points = [{ x: car.x, y: car.y }];
  const halfL = CAR_WIDTH * CAR_COLLISION_HALF_LENGTH_SCALE;
  const halfW = CAR_HEIGHT * CAR_COLLISION_HALF_WIDTH_SCALE;
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  const basis = [
    { fx: halfL, fy: halfW },
    { fx: halfL, fy: -halfW },
    { fx: -halfL, fy: halfW },
    { fx: -halfL, fy: -halfW },
    { fx: halfL, fy: 0 },
    { fx: -halfL, fy: 0 },
  ];
  for (const b of basis) {
    const px = car.x + c * b.fx - s * b.fy;
    const py = car.y + s * b.fx + c * b.fy;
    points.push({ x: px, y: py });
  }
  return points;
}

function carCollidesSolid(car) {
  const points = carBodyPoints(car);
  for (const p of points) {
    if (isSolidForCar(p.x, p.y)) return true;
  }
  return false;
}

function enforcePredictedCarCollisions(car, prevX, prevY) {
  car.x = wrapWorldX(car.x);
  car.y = wrapWorldY(car.y);

  if (carCollidesSolid(car)) {
    let resolved = false;
    if (Number.isFinite(prevX) && Number.isFinite(prevY)) {
      const cx = car.x;
      const cy = car.y;
      for (let i = 1; i <= 8; i += 1) {
        const t = i / 8;
        car.x = wrappedLerp(cx, prevX, t, WORLD.width);
        car.y = wrappedLerp(cy, prevY, t, WORLD.height);
        if (!carCollidesSolid(car)) {
          resolved = true;
          break;
        }
      }
    }
    if (!resolved) {
      const retreat = [6, 10, 14, 18];
      for (const amount of retreat) {
        car.x = wrapWorldX(car.x + Math.cos(car.angle + Math.PI) * amount);
        car.y = wrapWorldY(car.y + Math.sin(car.angle + Math.PI) * amount);
        if (!carCollidesSolid(car)) {
          resolved = true;
          break;
        }
      }
    }
    if (!resolved) {
      car.x = wrapWorldX(prevX);
      car.y = wrapWorldY(prevY);
    }
    car.speed *= -0.24;
  }

  car.x = wrapWorldX(car.x);
  car.y = wrapWorldY(car.y);
}

function blockHasBuildings(blockX, blockY) {
  return hash2D(blockX, blockY) >= 0.2;
}

function centeredBuildingRectForPlot(blockX, blockY, plotIndex) {
  const xSide = plotIndex % 2;
  const ySide = plotIndex > 1 ? 1 : 0;
  const lotX0 = xSide === 0 ? 0 : WORLD.roadEnd;
  const lotX1 = xSide === 0 ? WORLD.roadStart : WORLD.blockPx;
  const lotY0 = ySide === 0 ? 0 : WORLD.roadEnd;
  const lotY1 = ySide === 0 ? WORLD.roadStart : WORLD.blockPx;
  const lotSize = Math.min(lotX1 - lotX0, lotY1 - lotY0);
  const seed = hash2D(blockX * 71 + plotIndex * 17 + 11, blockY * 89 - plotIndex * 23 - 7);
  const size = Math.max(56, Math.min(lotSize - 20, 72 + Math.floor(seed * 12)));
  const x0 = Math.floor((lotX0 + lotX1 - size) * 0.5);
  const y0 = Math.floor((lotY0 + lotY1 - size) * 0.5);
  return { x0, y0, x1: x0 + size, y1: y0 + size };
}

function buildingVariantForPlot(blockX, blockY, plotIndex) {
  return Math.floor(
    hash2D(blockX * 31 + 17 + plotIndex * 7, blockY * 43 - 29 + plotIndex * 11) * BASE_BUILDING_VARIANT_COUNT
  );
}

function blockVariantForBlock(blockX, blockY) {
  if (!blockTextures.length) return 0;
  return Math.floor(hash2D(blockX * 53 + 11, blockY * 67 - 19) * blockTextures.length);
}

function plotIndexForLocalCoord(localX, localY) {
  const xSide = localX < WORLD.roadStart ? 0 : localX >= WORLD.roadEnd ? 1 : null;
  const ySide = localY < WORLD.roadStart ? 0 : localY >= WORLD.roadEnd ? 1 : null;
  if (xSide === null || ySide === null) return null;
  return ySide * 2 + xSide; // 0 TL, 1 TR, 2 BL, 3 BR
}

function buildSpecialPlotVariantMap(world) {
  const result = new Map();
  if (!world) return result;

  const shops = world.shops || [];
  for (let i = 0; i < shops.length; i += 1) {
    const shop = shops[i];
    if (!shop) continue;
    const blockX = Math.floor(shop.x / WORLD.blockPx);
    const blockY = Math.floor(shop.y / WORLD.blockPx);
    const localX = mod(shop.x, WORLD.blockPx);
    const localY = mod(shop.y, WORLD.blockPx);
    const plotIndex = plotIndexForLocalCoord(localX, localY);
    if (plotIndex === null) continue;
    const variant = ARMORY_VARIANT_START + (i % ARMORY_BUILDING_TEXTURE_SOURCES.length);
    result.set(`${blockX},${blockY},${plotIndex}`, variant);
  }

  const hospital = world.hospital;
  if (hospital) {
    const blockX = Math.floor(hospital.x / WORLD.blockPx);
    const blockY = Math.floor(hospital.y / WORLD.blockPx);
    const localX = mod(hospital.x, WORLD.blockPx);
    const localY = mod(hospital.y, WORLD.blockPx);
    const plotIndex = plotIndexForLocalCoord(localX, localY);
    if (plotIndex !== null) {
      result.set(`${blockX},${blockY},${plotIndex}`, HOSPITAL_VARIANT_INDEX);
    }
  }

  return result;
}

function getBuildingPlotInfo(localX, localY, blockX, blockY) {
  const plotIndex = plotIndexForLocalCoord(localX, localY);
  if (plotIndex === null) return null;

  const rect = centeredBuildingRectForPlot(blockX, blockY, plotIndex);
  if (localX <= rect.x0 || localX >= rect.x1 || localY <= rect.y0 || localY >= rect.y1) {
    return null;
  }

  return { plotIndex, x0: rect.x0, x1: rect.x1, y0: rect.y0, y1: rect.y1 };
}

function drawSolarRoofTile(sx, sy, tile) {
  ctx.fillStyle = '#123351';
  ctx.fillRect(sx + 1, sy + 1, tile - 2, tile - 2);
  ctx.fillStyle = '#27679e';
  ctx.fillRect(sx + 2, sy + 2, tile - 4, tile - 4);
  ctx.fillStyle = '#5ba0de';
  ctx.fillRect(sx + 3, sy + 3, tile - 6, 2);
}

function drawFanRoofTile(sx, sy, tile) {
  ctx.fillStyle = '#8e959d';
  ctx.fillRect(sx + 1, sy + 1, tile - 2, tile - 2);
  ctx.fillStyle = '#596067';
  ctx.fillRect(sx + 3, sy + 3, tile - 6, tile - 6);
  ctx.fillStyle = '#3f454b';
  ctx.fillRect(sx + 4, sy + Math.floor(tile * 0.5), tile - 8, 1);
  ctx.fillRect(sx + Math.floor(tile * 0.5), sy + 4, 1, tile - 8);
}

function drawVentRoofTile(sx, sy, tile) {
  ctx.fillStyle = '#9da3aa';
  ctx.fillRect(sx + 2, sy + 3, tile - 4, tile - 5);
  ctx.fillStyle = '#707780';
  ctx.fillRect(sx + 2, sy + 3, tile - 4, 2);
  ctx.fillStyle = '#5a616a';
  ctx.fillRect(sx + 3, sy + 7, tile - 6, 1);
}

function drawPenthouseRoofTile(sx, sy, tile) {
  ctx.fillStyle = '#6e737b';
  ctx.fillRect(sx + 1, sy + 1, tile - 2, tile - 2);
  ctx.fillStyle = '#4b5159';
  ctx.fillRect(sx + 1, sy + 1, tile - 2, 3);
  ctx.fillStyle = '#8f959e';
  ctx.fillRect(sx + 4, sy + 5, tile - 8, tile - 8);
}

function drawSkylightRoofTile(sx, sy, tile) {
  ctx.fillStyle = '#4f6984';
  ctx.fillRect(sx + 3, sy + 4, tile - 6, tile - 8);
  ctx.fillStyle = '#86a9c9';
  ctx.fillRect(sx + 4, sy + 5, tile - 8, 2);
  ctx.fillStyle = '#2c3f53';
  ctx.fillRect(sx + 4, sy + tile - 5, tile - 8, 1);
}

function drawWaterTankRoofTile(sx, sy, tile) {
  ctx.fillStyle = '#7e868f';
  ctx.fillRect(sx + 4, sy + 3, tile - 8, tile - 6);
  ctx.fillStyle = '#a8afb7';
  ctx.fillRect(sx + 5, sy + 4, tile - 10, 2);
  ctx.fillStyle = '#5d646d';
  ctx.fillRect(sx + 5, sy + tile - 4, tile - 10, 1);
  ctx.fillStyle = '#444b54';
  ctx.fillRect(sx + 3, sy + tile - 2, tile - 6, 1);
}

function drawDuctRoofTile(sx, sy, tile) {
  ctx.fillStyle = '#8a9199';
  ctx.fillRect(sx + 2, sy + 6, tile - 4, 3);
  ctx.fillStyle = '#666d75';
  ctx.fillRect(sx + 2, sy + 6, tile - 4, 1);
  ctx.fillStyle = '#a7adb4';
  ctx.fillRect(sx + 4, sy + 7, tile - 8, 1);
}

function drawAntennaRoofTile(sx, sy, tile) {
  ctx.fillStyle = '#70767f';
  ctx.fillRect(sx + 7, sy + 4, 2, tile - 6);
  ctx.fillStyle = '#949aa3';
  ctx.fillRect(sx + 6, sy + 3, 4, 1);
  ctx.fillRect(sx + 5, sy + 6, 1, 1);
  ctx.fillRect(sx + 10, sy + 7, 1, 1);
}

function isMainRoofCell(variant, btX, btY) {
  const core = btX >= 4 && btX <= 15 && btY >= 4 && btY <= 15;
  if (!core) return false;

  if (variant === 0) {
    return !(btX >= 13 && btY >= 12);
  }
  if (variant === 1) {
    return !(btX >= 12 && btY <= 6);
  }
  if (variant === 2) {
    return !(btX >= 14 && btY <= 5);
  }
  return !(btX <= 6 && btY <= 6);
}

function drawInsetRoofCell(sx, sy, tile) {
  ctx.fillStyle = '#a19c94';
  ctx.fillRect(sx + 1, sy + 1, tile - 2, tile - 2);
  ctx.fillStyle = '#8a857e';
  ctx.fillRect(sx + 1, sy + 1, tile - 2, 2);
  ctx.fillStyle = '#7d7871';
  ctx.fillRect(sx + 1, sy + tile - 3, tile - 2, 2);
}

function drawInnerRoofParapet(variant, sx, sy, tile, btX, btY) {
  if (!isMainRoofCell(variant, btX, btY)) return;

  const n = isMainRoofCell(variant, btX, btY - 1);
  const s = isMainRoofCell(variant, btX, btY + 1);
  const w = isMainRoofCell(variant, btX - 1, btY);
  const e = isMainRoofCell(variant, btX + 1, btY);

  if (!n) {
    ctx.fillStyle = '#d7d2ca';
    ctx.fillRect(sx + 1, sy + 1, tile - 2, 1);
  }
  if (!s) {
    ctx.fillStyle = '#8a857e';
    ctx.fillRect(sx + 1, sy + tile - 2, tile - 2, 1);
  }
  if (!w) {
    ctx.fillStyle = '#d7d2ca';
    ctx.fillRect(sx + 1, sy + 1, 1, tile - 2);
  }
  if (!e) {
    ctx.fillStyle = '#8a857e';
    ctx.fillRect(sx + tile - 2, sy + 1, 1, tile - 2);
  }
}

function drawCommonRoofMicroDetails(variant, sx, sy, tile, blockX, blockY, btX, btY) {
  if (btX < 4 || btX > 15 || btY < 4 || btY > 15) return;

  const detailSeed = hash2D(blockX * 97 + btX * 3 + variant * 11, blockY * 131 + btY * 5 - variant * 7);
  const accentSeed = hash2D(blockX * 67 + btX * 11, blockY * 71 + btY * 13 + variant * 19);

  if (detailSeed > 0.992) {
    drawAntennaRoofTile(sx, sy, tile);
  } else if (detailSeed > 0.975) {
    drawWaterTankRoofTile(sx, sy, tile);
  } else if (detailSeed > 0.946 && btX % 2 === 0) {
    drawDuctRoofTile(sx, sy, tile);
  } else if (detailSeed > 0.905 && (btX + btY) % 3 === 0) {
    drawSkylightRoofTile(sx, sy, tile);
  }

  if (accentSeed > 0.987) {
    ctx.fillStyle = '#5d636c';
    ctx.fillRect(sx + 1, sy + 11, tile - 2, 1);
  }
}

function drawBlockTextureTile(blockVariant, sx, sy, tile, localX, localY) {
  const texture = blockTextures[blockVariant];
  if (!texture || texture.state !== 'ready' || !texture.image || texture.width < 2 || texture.height < 2) {
    return false;
  }

  const leftSpan = WORLD.roadStart;
  const rightSpan = WORLD.blockPx - WORLD.roadEnd;
  if (leftSpan <= 0 || rightSpan <= 0) return false;

  const toLotNorm = (v) => {
    if (v < WORLD.roadStart) return v / leftSpan;
    if (v >= WORLD.roadEnd) return (v - WORLD.roadEnd) / rightSpan;
    return null;
  };

  const endX = Math.min(WORLD.blockPx - 0.001, localX + tile - 0.001);
  const endY = Math.min(WORLD.blockPx - 0.001, localY + tile - 0.001);
  const u0 = toLotNorm(localX);
  const v0 = toLotNorm(localY);
  const u1 = toLotNorm(endX);
  const v1 = toLotNorm(endY);
  if (u0 === null || v0 === null || u1 === null || v1 === null) {
    return false;
  }

  // Transparent pixels in block textures should reveal ground.
  ctx.fillStyle = '#345a38';
  ctx.fillRect(sx, sy, tile, tile);

  const cu0 = clamp(u0, 0, 1);
  const cv0 = clamp(v0, 0, 1);
  const cu1 = clamp(u1, 0, 1);
  const cv1 = clamp(v1, 0, 1);

  const srcX = clamp(Math.floor(cu0 * (texture.width - 1)), 0, texture.width - 1);
  const srcY = clamp(Math.floor(cv0 * (texture.height - 1)), 0, texture.height - 1);
  const srcX2 = clamp(Math.ceil(cu1 * (texture.width - 1)), srcX + 1, texture.width);
  const srcY2 = clamp(Math.ceil(cv1 * (texture.height - 1)), srcY + 1, texture.height);
  const srcW = Math.max(1, srcX2 - srcX);
  const srcH = Math.max(1, srcY2 - srcY);

  ctx.drawImage(texture.image, srcX, srcY, srcW, srcH, sx, sy, tile, tile);
  return true;
}

function drawBuildingTextureTile(variant, plot, sx, sy, tile, localX, localY, hasUnderlay = false) {
  const texture = buildingTextures[variant];
  if (!texture || texture.state !== 'ready' || !texture.image || texture.width < 2 || texture.height < 2) {
    return false;
  }
  if (!plot) return false;

  // Transparent pixels in source textures should reveal underlying lot ground.
  if (!hasUnderlay) {
    ctx.fillStyle = '#345a38';
    ctx.fillRect(sx, sy, tile, tile);
  }

  const spanX = Math.max(1, plot.x1 - plot.x0);
  const spanY = Math.max(1, plot.y1 - plot.y0);
  const u0 = clamp((localX - plot.x0) / spanX, 0, 1);
  const v0 = clamp((localY - plot.y0) / spanY, 0, 1);
  const u1 = clamp((localX + tile - plot.x0) / spanX, 0, 1);
  const v1 = clamp((localY + tile - plot.y0) / spanY, 0, 1);

  const srcX = clamp(Math.floor(u0 * (texture.width - 1)), 0, texture.width - 1);
  const srcY = clamp(Math.floor(v0 * (texture.height - 1)), 0, texture.height - 1);
  const srcX2 = clamp(Math.ceil(u1 * (texture.width - 1)), srcX + 1, texture.width);
  const srcY2 = clamp(Math.ceil(v1 * (texture.height - 1)), srcY + 1, texture.height);
  const srcW = Math.max(1, srcX2 - srcX);
  const srcH = Math.max(1, srcY2 - srcY);

  ctx.drawImage(texture.image, srcX, srcY, srcW, srcH, sx, sy, tile, tile);
  return true;
}

function drawBuildingParapetEdges(sx, sy, tile, worldX, worldY, edgeLight, edgeDark) {
  const cx = worldX + tile * 0.5;
  const cy = worldY + tile * 0.5;
  const north = worldGroundTypeAt(cx, cy - tile) === 'building';
  const south = worldGroundTypeAt(cx, cy + tile) === 'building';
  const west = worldGroundTypeAt(cx - tile, cy) === 'building';
  const east = worldGroundTypeAt(cx + tile, cy) === 'building';

  if (!north) {
    ctx.fillStyle = edgeLight;
    ctx.fillRect(sx, sy, tile, 2);
  }
  if (!south) {
    ctx.fillStyle = edgeDark;
    ctx.fillRect(sx, sy + tile - 2, tile, 2);
  }
  if (!west) {
    ctx.fillStyle = edgeLight;
    ctx.fillRect(sx, sy, 2, tile);
  }
  if (!east) {
    ctx.fillStyle = edgeDark;
    ctx.fillRect(sx + tile - 2, sy, 2, tile);
  }
}

function drawBuildingRoofDetails(variant, sx, sy, tile, blockX, blockY, btX, btY) {
  if (!isMainRoofCell(variant, btX, btY)) {
    drawInsetRoofCell(sx, sy, tile);
    return;
  }

  if (variant === 0) {
    const inSolarField = btX >= 4 && btX <= 13 && btY >= 4 && btY <= 13;
    const inSmallSolar = btX >= 11 && btX <= 14 && btY >= 14 && btY <= 15;
    if ((inSolarField && ((btX + btY) % 2 === 0 || btX % 3 === 0)) || inSmallSolar) {
      drawSolarRoofTile(sx, sy, tile);
    }
    if ((btX >= 14 && btX <= 15 && btY >= 4 && btY <= 6) || (btX === 15 && btY === 8)) {
      drawPenthouseRoofTile(sx, sy, tile);
    }
    if (btX === 12 && btY === 5) {
      drawVentRoofTile(sx, sy, tile);
    }
    if (btX >= 4 && btX <= 6 && btY === 14) {
      drawDuctRoofTile(sx, sy, tile);
    }
    drawCommonRoofMicroDetails(variant, sx, sy, tile, blockX, blockY, btX, btY);
    drawInnerRoofParapet(variant, sx, sy, tile, btX, btY);
    return;
  }

  if (variant === 1) {
    const fanCells =
      ((btY === 5 || btY === 6) && (btX === 6 || btX === 7 || btX === 8)) ||
      (btY === 8 && (btX === 10 || btX === 11 || btX === 12)) ||
      (btY === 11 && (btX === 12 || btX === 13 || btX === 14)) ||
      (btY === 13 && (btX === 11 || btX === 12));
    if (fanCells) {
      drawFanRoofTile(sx, sy, tile);
    }
    if ((btX >= 9 && btX <= 10 && btY >= 5 && btY <= 6) || (btX === 9 && btY === 4)) {
      drawVentRoofTile(sx, sy, tile);
    }
    if (btX >= 14 && btX <= 15 && btY >= 12 && btY <= 13) {
      drawPenthouseRoofTile(sx, sy, tile);
    }
    if (btY === 9 && btX >= 7 && btX <= 9) {
      drawDuctRoofTile(sx, sy, tile);
    }
    drawCommonRoofMicroDetails(variant, sx, sy, tile, blockX, blockY, btX, btY);
    drawInnerRoofParapet(variant, sx, sy, tile, btX, btY);
    return;
  }

  if (variant === 2) {
    const fanCells =
      (btY === 6 && (btX === 5 || btX === 6 || btX === 7)) ||
      (btY === 9 && (btX === 5 || btX === 6)) ||
      (btY === 12 && (btX === 10 || btX === 11 || btX === 12));
    if (fanCells) {
      drawFanRoofTile(sx, sy, tile);
    }
    if (btX >= 12 && btX <= 15 && btY >= 7 && btY <= 8) {
      drawSolarRoofTile(sx, sy, tile);
    }
    if ((btX >= 11 && btX <= 13 && btY >= 10 && btY <= 11) || (btX === 14 && btY === 10)) {
      drawPenthouseRoofTile(sx, sy, tile);
    }
    if (btX === 8 && btY === 6) {
      drawVentRoofTile(sx, sy, tile);
    }
    if (btX >= 12 && btX <= 14 && btY === 13) {
      drawDuctRoofTile(sx, sy, tile);
    }
    drawCommonRoofMicroDetails(variant, sx, sy, tile, blockX, blockY, btX, btY);
    drawInnerRoofParapet(variant, sx, sy, tile, btX, btY);
    return;
  }

  const longSolarStrip = btX >= 6 && btX <= 15 && (btY === 11 || btY === 12);
  if (longSolarStrip) {
    drawSolarRoofTile(sx, sy, tile);
  }
  const fanCells =
    (btY === 6 && (btX === 6 || btX === 7)) ||
    (btY === 7 && (btX === 6 || btX === 7)) ||
    (btY === 10 && btX === 14);
  if (fanCells) {
    drawFanRoofTile(sx, sy, tile);
  }
  if ((btX === 12 && btY === 6) || (btX >= 9 && btX <= 10 && btY >= 8 && btY <= 9)) {
    drawVentRoofTile(sx, sy, tile);
  }
  if (btX >= 11 && btX <= 13 && btY === 5) {
    drawDuctRoofTile(sx, sy, tile);
  }
  drawCommonRoofMicroDetails(variant, sx, sy, tile, blockX, blockY, btX, btY);
  drawInnerRoofParapet(variant, sx, sy, tile, btX, btY);
}

function applyWorldFromServer(payload) {
  if (!payload) return;
  for (const key of Object.keys(WORLD)) {
    if (typeof payload[key] === 'number' && Number.isFinite(payload[key])) {
      WORLD[key] = payload[key];
    }
  }
  if (Array.isArray(payload.shops)) {
    WORLD.shops = payload.shops.map((shop) => ({ ...shop }));
  }
  if (payload.hospital && typeof payload.hospital === 'object') {
    WORLD.hospital = { ...payload.hospital };
  }
  if (typeof payload.worldRev === 'number' && Number.isFinite(payload.worldRev)) {
    WORLD.worldRev = payload.worldRev;
    worldRev = payload.worldRev;
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

function buildCurrentInputPayload(seq) {
  return {
    seq: seq >>> 0,
    shootSeq: INPUT.shootSeq >>> 0,
    clientSendTime: Math.round(performance.now()) >>> 0,
    up: INPUT.up,
    down: INPUT.down,
    left: INPUT.left,
    right: INPUT.right,
    enter: INPUT.enter,
    horn: INPUT.horn,
    shootHeld: INPUT.shootHeld,
    weaponSlot: INPUT.weaponSlot,
    requestStats: INPUT.requestStats,
    aimX: Math.round(POINTER.worldX * 100) / 100,
    aimY: Math.round(POINTER.worldY * 100) / 100,
    clickAimX: Math.round(INPUT.clickAimX * 100) / 100,
    clickAimY: Math.round(INPUT.clickAimY * 100) / 100,
    dt: 1 / INPUT_SEND_RATE,
  };
}

function sendInput() {
  if (!socket || socket.readyState !== WebSocket.OPEN || !joined) {
    return;
  }

  const payload = buildCurrentInputPayload(nextInputSeq);
  nextInputSeq = (nextInputSeq + 1) >>> 0;
  if (ENABLE_LOCAL_PREDICTION) {
    pendingInputs.push(payload);
    while (pendingInputs.length > 256) pendingInputs.shift();
  }
  socket.send(encodeInputFrame(payload));
}

function sendBuy(item) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !joined) {
    return;
  }
  socket.send(encodeBuyFrame(item));
}

function sendChat(rawText) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !joined) {
    return;
  }
  const text = String(rawText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  if (!text) return;
  socket.send(encodeChatFrame(text));
}

function resetSessionState() {
  joined = false;
  playerId = null;
  snapshots = [];
  lastSnapshot = null;
  localPlayerCache = null;
  presenceOnlineCount = 0;
  presencePlayers = [];
  clientBloodStains.clear();
  debugStatsVisible = false;
  nextInputSeq = 1;
  lastAckInputSeq = 0;
  pendingInputs.length = 0;
  localPrediction = null;
  hasClockSync = false;
  serverClockOffsetMs = 0;
  smoothedRttMs = 120;
  dynamicInterpDelayMs = SERVER_RENDER_DELAY_MS;
  lastServerSnapshotTime = 0;
  localPredictionAccumulator = 0;
  cameraHardSnapPending = false;
  snapshotEntityState.players.clear();
  snapshotEntityState.cars.clear();
  snapshotEntityState.npcs.clear();
  snapshotEntityState.cops.clear();
  snapshotEntityState.drops.clear();
  snapshotEntityState.blood.clear();
  walkAnimById.clear();
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
  INPUT.requestStats = false;
  statusNotice = '';
  statusNoticeUntil = 0;
  latestState = null;
  mapVisible = false;
  refreshMapToggleUi();
  if (chatBar) {
    chatBar.classList.add('hidden');
  }
  if (chatInput) {
    chatInput.value = '';
    chatInput.blur();
  }
}

function shopIdFromIndex(index) {
  if (!Number.isInteger(index) || index < 0) return null;
  const shop = WORLD.shops[index];
  return shop ? shop.id : null;
}

function hydratePlayerRecord(record) {
  const chatMsLeft = Number.isFinite(record.chatMsLeft) ? Math.max(0, record.chatMsLeft) : 0;
  return {
    ...record,
    insideShopId: shopIdFromIndex(record.insideShopIndex),
    chatText: chatMsLeft > 0 ? record.chatText || '' : '',
    chatUntil: chatMsLeft > 0 ? Date.now() + chatMsLeft : 0,
  };
}

function hydrateEventRecord(event) {
  const out = { ...event };
  if (out.type === 'enterShop' || out.type === 'exitShop') {
    out.shopId = shopIdFromIndex(out.shopIndex);
  }
  return out;
}

function applySectionDelta(targetMap, section, hydrate) {
  if (!section) return;
  const add = Array.isArray(section.add) ? section.add : [];
  const update = Array.isArray(section.update) ? section.update : [];
  const remove = Array.isArray(section.remove) ? section.remove : [];
  for (const id of remove) {
    targetMap.delete(id);
  }
  for (const record of add) {
    targetMap.set(record.id, hydrate ? hydrate(record) : { ...record });
  }
  for (const record of update) {
    targetMap.set(record.id, hydrate ? hydrate(record) : { ...record });
  }
}

function applySnapshotDelta(data) {
  if (data.keyframe) {
    snapshotEntityState.players.clear();
    snapshotEntityState.cars.clear();
    snapshotEntityState.npcs.clear();
    snapshotEntityState.cops.clear();
    snapshotEntityState.drops.clear();
    snapshotEntityState.blood.clear();
  }

  const sections = data.sections || {};
  applySectionDelta(snapshotEntityState.players, sections.players, hydratePlayerRecord);
  applySectionDelta(snapshotEntityState.cars, sections.cars);
  applySectionDelta(snapshotEntityState.npcs, sections.npcs);
  applySectionDelta(snapshotEntityState.cops, sections.cops);
  applySectionDelta(snapshotEntityState.drops, sections.drops);
  applySectionDelta(snapshotEntityState.blood, sections.blood);

  const players = Array.from(snapshotEntityState.players.values());
  const cars = Array.from(snapshotEntityState.cars.values());
  const npcs = Array.from(snapshotEntityState.npcs.values());
  const cops = Array.from(snapshotEntityState.cops.values());
  const drops = Array.from(snapshotEntityState.drops.values());
  const blood = Array.from(snapshotEntityState.blood.values());

  const playersById = new Map(players.map((p) => [p.id, p]));
  const carsById = new Map(cars.map((c) => [c.id, c]));

  return {
    serverTime: data.serverTime,
    worldRev: data.worldRev,
    keyframe: data.keyframe,
    ackInputSeq: data.ackInputSeq >>> 0,
    clientSendTimeEcho: data.clientSendTimeEcho >>> 0,
    interpolationDelayMs: data.interpolationDelayMs,
    scope: data.scope || null,
    stats: data.stats || null,
    players,
    cars,
    npcs,
    cops,
    drops,
    blood,
    playersById,
    carsById,
    localPlayer: playersById.get(playerId) || null,
    events: (data.events || []).map(hydrateEventRecord),
  };
}

function isSeqAcked(seq, ack) {
  return ((ack - seq) >>> 0) < 0x80000000;
}

function pruneAckedInputs(ackSeq) {
  while (pendingInputs.length > 0 && isSeqAcked(pendingInputs[0].seq >>> 0, ackSeq >>> 0)) {
    pendingInputs.shift();
  }
}

function carPhysicsByType(type) {
  if (type === 'cop') return { maxSpeed: 190, turnSpeed: 3.1 };
  if (type === 'ambulance') return { maxSpeed: 165, turnSpeed: 2.6 };
  return { maxSpeed: 145, turnSpeed: 2.2 };
}

function stepPredictedMovement(pred, input, dt) {
  if (!pred || pred.health <= 0 || pred.insideShopId) return;

  if (!pred.inCarId) {
    let mx = 0;
    let my = 0;
    if (input.left) mx -= 1;
    if (input.right) mx += 1;
    if (input.up) my -= 1;
    if (input.down) my += 1;
    if (mx !== 0 || my !== 0) {
      const len = Math.hypot(mx, my);
      mx /= len;
      my /= len;
      const nx = wrapWorldX(pred.x + mx * PLAYER_SPEED * dt);
      const ny = wrapWorldY(pred.y + my * PLAYER_SPEED * dt);
      if (!isSolidForPed(nx, pred.y)) pred.x = nx;
      if (!isSolidForPed(pred.x, ny)) pred.y = ny;
    }
    const dx = input.aimX - pred.x;
    const dy = input.aimY - pred.y;
    if (dx * dx + dy * dy > 4) {
      pred.dir = Math.atan2(dy, dx);
    }
    pred.x = wrapWorldX(pred.x);
    pred.y = wrapWorldY(pred.y);
    return;
  }

  if (!pred.car || pred.car.id !== pred.inCarId) return;
  const car = pred.car;
  const physics = carPhysicsByType(car.type);
  const throttle = input.up ? 1 : 0;
  const brake = input.down ? 1 : 0;
  const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  const acceleration = throttle * 300 - brake * 260;
  car.speed += acceleration * dt;
  if (!throttle && !brake) {
    car.speed *= Math.pow(0.88, dt * 8);
  }

  if (groundTypeAtWrapped(car.x, car.y) !== 'road') {
    car.speed *= Math.pow(0.92, dt * 12);
  }
  car.speed = clamp(car.speed, -92, physics.maxSpeed);

  if (steer !== 0) {
    const steeringStrength = clamp(Math.abs(car.speed) / 90, 0.24, 1.3);
    const reverseFactor = car.speed < 0 ? -1 : 1;
    car.angle += steer * physics.turnSpeed * steeringStrength * dt * reverseFactor;
  }

  const prevX = car.x;
  const prevY = car.y;
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  enforcePredictedCarCollisions(car, prevX, prevY);
  pred.x = car.x;
  pred.y = car.y;
  pred.dir = normalizeAngle(car.angle);
}

function createPredictionFromState(state) {
  if (!state || !state.localPlayer) return null;
  const local = state.localPlayer;
  const pred = {
    id: local.id,
    x: local.x,
    y: local.y,
    dir: local.dir || 0,
    inCarId: local.inCarId || null,
    insideShopId: local.insideShopId || null,
    health: local.health || 0,
    car: null,
  };
  if (pred.inCarId) {
    const car = state.carsById.get(pred.inCarId);
    if (car) {
      pred.car = {
        id: car.id,
        type: car.type,
        x: car.x,
        y: car.y,
        angle: car.angle || 0,
        speed: car.speed || 0,
      };
      pred.x = pred.car.x;
      pred.y = pred.car.y;
      pred.dir = pred.car.angle;
    }
  }
  return pred;
}

function currentRealtimePredictionInput() {
  return {
    up: INPUT.up,
    down: INPUT.down,
    left: INPUT.left,
    right: INPUT.right,
    enter: INPUT.enter,
    horn: INPUT.horn,
    shootHeld: INPUT.shootHeld,
    weaponSlot: INPUT.weaponSlot,
    requestStats: INPUT.requestStats,
    aimX: Math.round(POINTER.worldX * 100) / 100,
    aimY: Math.round(POINTER.worldY * 100) / 100,
    clickAimX: Math.round(INPUT.clickAimX * 100) / 100,
    clickAimY: Math.round(INPUT.clickAimY * 100) / 100,
  };
}

function reconcilePrediction(state, ackInputSeq) {
  if (!ENABLE_LOCAL_PREDICTION) {
    localPrediction = null;
    pendingInputs.length = 0;
    return;
  }
  if (!state || !state.localPlayer) {
    localPrediction = null;
    pendingInputs.length = 0;
    return;
  }
  pruneAckedInputs(ackInputSeq);
  const base = createPredictionFromState(state);
  if (!base) {
    localPrediction = null;
    return;
  }
  for (const input of pendingInputs) {
    stepPredictedMovement(base, input, input.dt || 1 / INPUT_SEND_RATE);
  }

  if (!localPrediction) {
    localPrediction = base;
    return;
  }

  const inCar = !!base.inCarId;
  const healthStateChanged = (localPrediction.health > 0) !== (base.health > 0);
  const stateChanged =
    healthStateChanged ||
    localPrediction.inCarId !== base.inCarId ||
    localPrediction.insideShopId !== base.insideShopId;
  if (stateChanged) {
    localPrediction = base;
    return;
  }

  const dx = wrapDelta(base.x - localPrediction.x, WORLD.width);
  const dy = wrapDelta(base.y - localPrediction.y, WORLD.height);
  const dist = Math.hypot(dx, dy);
  const hardSnapDist = inCar ? 180 : 90;
  if (dist > hardSnapDist) {
    localPrediction = base;
    return;
  }

  localPrediction.inCarId = base.inCarId;
  localPrediction.insideShopId = base.insideShopId;
  localPrediction.health = base.health;

  if (inCar && base.car) {
    if (!localPrediction.car || localPrediction.car.id !== base.car.id) {
      localPrediction = base;
      return;
    }

    const cdx = wrapDelta(base.car.x - localPrediction.car.x, WORLD.width);
    const cdy = wrapDelta(base.car.y - localPrediction.car.y, WORLD.height);
    const cdist = Math.hypot(cdx, cdy);
    const angleDiff = Math.abs(normalizeAngle(base.car.angle - localPrediction.car.angle));
    const speedDiff = Math.abs((base.car.speed || 0) - (localPrediction.car.speed || 0));

    if (cdist > 200 || angleDiff > 1.6 || speedDiff > 110) {
      localPrediction = base;
      return;
    }

    // Prediction-first: keep current local trajectory unless a large desync is detected.
    localPrediction.car.type = base.car.type;
    localPrediction.x = localPrediction.car.x;
    localPrediction.y = localPrediction.car.y;
    localPrediction.dir = localPrediction.car.angle;
    return;
  }

  // On foot prediction-first: keep local position/direction, only hard-snap on large divergence above.
  localPrediction.car = null;
}

function stepLocalPredictionRealtime(dt) {
  if (!ENABLE_LOCAL_PREDICTION) return;
  if (!localPrediction || dt <= 0) return;
  const step = 1 / LOCAL_PREDICTION_RATE;
  localPredictionAccumulator += dt;
  const input = currentRealtimePredictionInput();
  if (input.up || input.down || input.left || input.right) {
    lastMoveInputAtMs = performance.now();
  }
  let loops = 0;
  while (localPredictionAccumulator >= step && loops < 8) {
    stepPredictedMovement(localPrediction, input, step);
    localPredictionAccumulator -= step;
    loops += 1;
  }
  if (loops >= 8) {
    localPredictionAccumulator = 0;
  }
}

function applyPredictionToInterpolatedState(state) {
  if (!ENABLE_LOCAL_PREDICTION) return;
  if (!state || !state.localPlayer || !localPrediction) return;
  const local = state.playersById.get(playerId);
  if (!local) return;
  local.x = localPrediction.x;
  local.y = localPrediction.y;
  local.dir = localPrediction.dir;
  local.inCarId = localPrediction.inCarId || null;
  state.localPlayer = local;
  if (localPrediction.inCarId && localPrediction.car) {
    const car = state.carsById.get(localPrediction.inCarId);
    if (car) {
      car.x = localPrediction.car.x;
      car.y = localPrediction.car.y;
      car.angle = localPrediction.car.angle;
      car.speed = localPrediction.car.speed;
    }
  }
}

function snapCameraToLocal(local) {
  if (!local) return;
  const halfW = canvas.width * 0.5;
  const halfH = canvas.height * 0.5;
  camera.x = clamp(local.x, halfW, WORLD.width - halfW);
  camera.y = clamp(local.y, halfH, WORLD.height - halfH);
  camera.x = Math.round(camera.x);
  camera.y = Math.round(camera.y);
}

function updateClockSync(snapshotMessage, receiveNowMs) {
  const echoed = snapshotMessage.clientSendTimeEcho >>> 0;
  if (echoed > 0) {
    const sampleRtt = receiveNowMs - echoed;
    if (Number.isFinite(sampleRtt) && sampleRtt > 0 && sampleRtt < 5000) {
      smoothedRttMs = smoothedRttMs * 0.95 + sampleRtt * 0.05;
    }
  }

  const oneWay = smoothedRttMs * 0.5;
  const sampleOffset = receiveNowMs - snapshotMessage.serverTime - oneWay;
  if (!hasClockSync) {
    serverClockOffsetMs = sampleOffset;
    hasClockSync = true;
  } else {
    serverClockOffsetMs = serverClockOffsetMs * 0.96 + sampleOffset * 0.04;
  }

  if (!ENABLE_LOCAL_PREDICTION) {
    dynamicInterpDelayMs = SERVER_RENDER_DELAY_MS;
  } else {
    const baseDelay = Number.isFinite(snapshotMessage.interpolationDelayMs)
      ? snapshotMessage.interpolationDelayMs
      : 85;
    dynamicInterpDelayMs = clamp(baseDelay + smoothedRttMs * 0.06, REMOTE_INTERP_MIN_MS, REMOTE_INTERP_MAX_MS);
  }
  lastServerSnapshotTime = snapshotMessage.serverTime;
}

function estimatedServerTimeNow(localNowMs) {
  if (!hasClockSync) return lastServerSnapshotTime;
  return localNowMs - serverClockOffsetMs;
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
  const matchedProfile = findStoredProfileByName(selectedName);
  selectedProfileTicket = matchedProfile?.ticket || '';

  await audio.init();

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }

  socket = new WebSocket(wsUrl());
  socket.binaryType = 'arraybuffer';

  socket.addEventListener('open', () => {
    socket.send(encodeJoinFrame(selectedName, selectedColor, selectedProfileTicket));
  });

  socket.addEventListener('message', (event) => {
    let data;
    try {
      data = decodeServerFrame(event.data);
    } catch {
      return;
    }

    if (!data || typeof data !== 'object') return;

    if (data.type === 'joined') {
      applyWorldFromServer(data.world);
      if (typeof data.worldRev === 'number' && Number.isFinite(data.worldRev)) {
        worldRev = data.worldRev;
      }
      playerId = data.playerId;
      joined = true;
      nextInputSeq = 1;
      lastAckInputSeq = 0;
      pendingInputs.length = 0;
      localPrediction = null;
      hasClockSync = false;
      serverClockOffsetMs = 0;
      smoothedRttMs = 120;
      dynamicInterpDelayMs = SERVER_RENDER_DELAY_MS;
      cameraHardSnapPending = true;
      if (typeof data.progressTicket === 'string' && data.progressTicket) {
        selectedProfileTicket = data.progressTicket;
        upsertStoredProfile(selectedName, data.progressTicket);
      } else {
        localStorage.setItem(PROFILE_LAST_NAME_KEY, selectedName);
      }
      joinOverlay.classList.add('hidden');
      hud.classList.remove('hidden');
      if (chatBar) {
        chatBar.classList.remove('hidden');
      }
      setJoinError('');
      joinBtn.disabled = false;
      return;
    }

    if (data.type === 'snapshot') {
      if (typeof data.worldRev === 'number' && Number.isFinite(data.worldRev)) {
        worldRev = data.worldRev;
      }
      const receiveNow = performance.now();
      updateClockSync(data, receiveNow);
      const previousLocal = lastSnapshot?.localPlayer || null;
      const snapshot = applySnapshotDelta(data);
      const currentLocal = snapshot.localPlayer || null;
      snapshot.receivedAt = receiveNow;

      let forceLocalSnap = false;
      if (!ENABLE_LOCAL_PREDICTION && previousLocal && currentLocal) {
        const rawDx = Math.abs(currentLocal.x - previousLocal.x);
        const rawDy = Math.abs(currentLocal.y - previousLocal.y);
        const crossedWrap = rawDx > WORLD.width * 0.5 || rawDy > WORLD.height * 0.5;
        const dx = wrapDelta(currentLocal.x - previousLocal.x, WORLD.width);
        const dy = wrapDelta(currentLocal.y - previousLocal.y, WORLD.height);
        const travelDist = Math.hypot(dx, dy);
        const respawned = (previousLocal.health || 0) <= 0 && (currentLocal.health || 0) > 0;
        const teleported = travelDist > LOCAL_TELEPORT_SNAP_DIST;
        forceLocalSnap = crossedWrap || respawned || teleported;
      }

      if (forceLocalSnap) {
        snapshots.length = 0;
        snapshots.push(snapshot);
        cameraHardSnapPending = true;
      } else {
        snapshots.push(snapshot);
        while (snapshots.length > 55) snapshots.shift();
      }

      lastSnapshot = snapshot;
      processEvents(snapshot.events || []);
      if (typeof data.progressTicket === 'string' && data.progressTicket) {
        selectedProfileTicket = data.progressTicket;
        upsertStoredProfile(selectedName, data.progressTicket);
      }
      if (ENABLE_LOCAL_PREDICTION) {
        lastAckInputSeq = data.ackInputSeq >>> 0;
        reconcilePrediction(snapshot, lastAckInputSeq);
      } else {
        localPrediction = null;
      }
      return;
    }

    if (data.type === 'presence') {
      presenceOnlineCount = Number.isFinite(data.onlineCount) ? Math.max(0, data.onlineCount) : presenceOnlineCount;
      presencePlayers = Array.isArray(data.players) ? data.players : [];
      if (typeof data.worldRev === 'number' && Number.isFinite(data.worldRev)) {
        worldRev = data.worldRev;
      }
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
      if (chatBar) {
        chatBar.classList.add('hidden');
      }
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
    } else if (ev.type === 'copWitness') {
      if (ev.playerId === playerId) {
        audio.playCopWitness(distance);
      }
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
        skinColor: ev.skinColor || '#f0c39a',
        shirtColor: ev.shirtColor || '#808891',
        shirtDark: ev.shirtDark || '#2a3342',
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
    } else if (ev.type === 'bloodSpawn') {
      if (ev.stainId && Number.isFinite(ev.x) && Number.isFinite(ev.y)) {
        clientBloodStains.set(ev.stainId, {
          id: ev.stainId,
          x: ev.x,
          y: ev.y,
          ttl: Number.isFinite(ev.ttl) ? ev.ttl : 180,
          maxTtl: Number.isFinite(ev.ttl) ? ev.ttl : 180,
        });
      }
    } else if (ev.type === 'bloodRemove') {
      if (ev.stainId) {
        clientBloodStains.delete(ev.stainId);
      }
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
      world: WORLD,
      players: single.players || [],
      cars: single.cars || [],
      npcs: single.npcs || [],
      cops: single.cops || [],
      drops: single.drops || [],
      blood: single.blood || [],
      stats: single.stats || null,
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
      x: wrappedLerp(prev.x, next.x, t, WORLD.width),
      y: wrappedLerp(prev.y, next.y, t, WORLD.height),
      dir: angleLerp(prev.dir, next.dir, t),
    };
  });

  const cars = (newer.cars || []).map((next) => {
    const prev = olderCars.get(next.id) || next;
    return {
      ...next,
      x: wrappedLerp(prev.x, next.x, t, WORLD.width),
      y: wrappedLerp(prev.y, next.y, t, WORLD.height),
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
      x: wrappedLerp(prev.x, next.x, t, WORLD.width),
      y: wrappedLerp(prev.y, next.y, t, WORLD.height),
      dir: angleLerp(prev.dir, next.dir, t),
    };
  });

  const drops = (newer.drops || []).map((next) => {
    const prev = olderDrops.get(next.id) || next;
    return {
      ...next,
      x: wrappedLerp(prev.x, next.x, t, WORLD.width),
      y: wrappedLerp(prev.y, next.y, t, WORLD.height),
    };
  });

  const cops = (newer.cops || []).map((next) => {
    const prev = olderCops.get(next.id) || next;
    if (!next.alive || !prev.alive || next.inCarId) {
      return { ...next };
    }
    return {
      ...next,
      x: wrappedLerp(prev.x, next.x, t, WORLD.width),
      y: wrappedLerp(prev.y, next.y, t, WORLD.height),
      dir: angleLerp(prev.dir || 0, next.dir || 0, t),
    };
  });

  const blood = (newer.blood || []).map((next) => {
    const prev = olderBlood.get(next.id) || next;
    return {
      ...next,
      x: wrappedLerp(prev.x, next.x, t, WORLD.width),
      y: wrappedLerp(prev.y, next.y, t, WORLD.height),
    };
  });

  const playersById = new Map(players.map((p) => [p.id, p]));
  const carsById = new Map(cars.map((c) => [c.id, c]));

  return {
    world: WORLD,
    players,
    cars,
    npcs,
    cops,
    drops,
    blood,
    stats: newer.stats || null,
    playersById,
    carsById,
    localPlayer: playersById.get(playerId) || null,
  };
}

function drawBuildingDropShadowOnGround(sx, sy, tile, worldX, worldY) {
  const cx = worldX + tile * 0.5;
  const cy = worldY + tile * 0.5;
  const leftIsBuilding = worldGroundTypeAt(cx - tile, cy) === 'building';
  const topIsBuilding = worldGroundTypeAt(cx, cy - tile) === 'building';
  const diagIsBuilding = worldGroundTypeAt(cx - tile, cy - tile) === 'building';

  if (leftIsBuilding) {
    ctx.fillStyle = 'rgba(12, 16, 20, 0.16)';
    ctx.fillRect(sx, sy + 1, 4, tile - 1);
  }

  if (topIsBuilding) {
    ctx.fillStyle = 'rgba(12, 16, 20, 0.14)';
    ctx.fillRect(sx + 1, sy, tile - 1, 4);
  }

  if (diagIsBuilding) {
    ctx.fillStyle = 'rgba(12, 16, 20, 0.12)';
    ctx.fillRect(sx, sy, 4, 4);
  }
}

function drawTile(type, sx, sy, tile, worldX, worldY, specialPlotVariants) {
  if (type === 'road') {
    ctx.fillStyle = '#343b42';
    ctx.fillRect(sx, sy, tile, tile);

    const localX = mod(worldX, WORLD.blockPx);
    const localY = mod(worldY, WORLD.blockPx);
    const inVerticalRoad = localX >= WORLD.roadStart && localX < WORLD.roadEnd;
    const inHorizontalRoad = localY >= WORLD.roadStart && localY < WORLD.roadEnd;
    const roadMid = (WORLD.roadStart + WORLD.roadEnd) * 0.5;
    const centerMark = roadMid - 1;

    if (
      inHorizontalRoad &&
      !inVerticalRoad &&
      localY <= centerMark &&
      localY + tile > centerMark &&
      Math.floor(worldX / tile) % 2 === 0
    ) {
      const centerOffsetY = Math.floor(centerMark - localY);
      ctx.fillStyle = '#c7b663';
      ctx.fillRect(sx + 1, sy + centerOffsetY, tile - 2, 2);
    }

    if (
      inVerticalRoad &&
      !inHorizontalRoad &&
      localX <= centerMark &&
      localX + tile > centerMark &&
      Math.floor(worldY / tile) % 2 === 0
    ) {
      const centerOffsetX = Math.floor(centerMark - localX);
      ctx.fillStyle = '#c7b663';
      ctx.fillRect(sx + centerOffsetX, sy + 1, 2, tile - 2);
    }

    if (inVerticalRoad && inHorizontalRoad) {
      ctx.fillStyle = '#4a545d';
      ctx.fillRect(sx + 2, sy + 2, tile - 4, tile - 4);
    }
    return;
  }

  const blockWorldX = Math.floor(worldX / WORLD.blockPx);
  const blockWorldY = Math.floor(worldY / WORLD.blockPx);
  const localX = mod(worldX, WORLD.blockPx);
  const localY = mod(worldY, WORLD.blockPx);
  const blockVariant = blockVariantForBlock(blockWorldX, blockWorldY);
  const hasBlockUnderlay = drawBlockTextureTile(blockVariant, sx, sy, tile, localX, localY);

  if (type === 'sidewalk') {
    if (hasBlockUnderlay) {
      drawBuildingDropShadowOnGround(sx, sy, tile, worldX, worldY);
      return;
    }

    ctx.fillStyle = '#70777f';
    ctx.fillRect(sx, sy, tile, tile);

    ctx.fillStyle = '#7d858e';
    if ((Math.floor(worldX / tile) + Math.floor(worldY / tile)) % 2 === 0) {
      ctx.fillRect(sx, sy, tile >> 1, tile >> 1);
    }
    drawBuildingDropShadowOnGround(sx, sy, tile, worldX, worldY);
    return;
  }

  if (type === 'building') {
    const plot = getBuildingPlotInfo(localX, localY, blockWorldX, blockWorldY);
    const plotKey = plot ? `${blockWorldX},${blockWorldY},${plot.plotIndex}` : null;
    const specialVariant = plotKey ? specialPlotVariants?.get(plotKey) : null;
    const fallbackPlotIndex = plotIndexForLocalCoord(localX, localY) ?? 0;
    const variant = Number.isInteger(specialVariant)
      ? specialVariant
      : buildingVariantForPlot(blockWorldX, blockWorldY, plot ? plot.plotIndex : fallbackPlotIndex);
    if (drawBuildingTextureTile(variant, plot, sx, sy, tile, localX, localY, hasBlockUnderlay)) {
      return;
    }

    const btX = Math.floor(localX / tile);
    const btY = Math.floor(localY / tile);
    const fallbackVariant = variant % 4;
    const roofPalette = [
      { base: '#bbb6ae', speck: '#c8c4bc', edgeLight: '#d7d2ca', edgeDark: '#8e8a84' },
      { base: '#c2bdb4', speck: '#cdc9c1', edgeLight: '#ddd8d0', edgeDark: '#97928b' },
      { base: '#b6b2ab', speck: '#c3bfb7', edgeLight: '#d2cdc5', edgeDark: '#88847d' },
      { base: '#beb8af', speck: '#cbc7bf', edgeLight: '#dad5cd', edgeDark: '#928d86' },
    ][fallbackVariant];

    ctx.fillStyle = roofPalette.base;
    ctx.fillRect(sx, sy, tile, tile);

    const speckSeed = hash2D(blockWorldX * 37 + btX, blockWorldY * 41 + btY);
    if (speckSeed > 0.74) {
      ctx.fillStyle = roofPalette.speck;
      ctx.fillRect(sx + 3, sy + 3, 2, 2);
    }

    drawBuildingRoofDetails(fallbackVariant, sx, sy, tile, blockWorldX, blockWorldY, btX, btY);
    drawBuildingParapetEdges(sx, sy, tile, worldX, worldY, roofPalette.edgeLight, roofPalette.edgeDark);

    if (speckSeed > 0.92) {
      ctx.fillStyle = '#5f6872';
      ctx.fillRect(sx + 6, sy + 6, 2, 2);
    }
    return;
  }

  if (type === 'park') {
    if (hasBlockUnderlay) {
      drawBuildingDropShadowOnGround(sx, sy, tile, worldX, worldY);
      return;
    }
  }

  ctx.fillStyle = '#345a38';
  ctx.fillRect(sx, sy, tile, tile);
  if (hash2D(Math.floor(worldX / tile), Math.floor(worldY / tile)) > 0.65) {
    ctx.fillStyle = '#3f6a42';
    ctx.fillRect(sx + 3, sy + 3, 2, 2);
  }
  drawBuildingDropShadowOnGround(sx, sy, tile, worldX, worldY);
}

function drawWorld(state) {
  ensureBuildingTexturesLoaded();
  ensureBlockTexturesLoaded();
  const specialPlotVariants = buildSpecialPlotVariantMap(state?.world);
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
      drawTile(type, sx, sy, tile, worldX, worldY, specialPlotVariants);
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

function drawFloatingLabel(worldX, worldY, worldLeft, worldTop, text, color, yOffset, phase = 0) {
  const sx = Math.round(worldX - worldLeft);
  const baseY = Math.round(worldY - worldTop + yOffset);
  const bob = Math.sin(performance.now() * 0.005 + phase) * 3;
  const sy = Math.round(baseY + bob);
  if (sx < -80 || sy < -40 || sx > canvas.width + 80 || sy > canvas.height + 40) return;

  ctx.font = '8px "Lucida Console", Monaco, monospace';
  ctx.textBaseline = 'middle';
  const w = Math.ceil(ctx.measureText(text).width);
  const padX = 4;
  const padY = 2;

  ctx.fillStyle = 'rgba(16, 18, 22, 0.72)';
  ctx.fillRect(sx - Math.floor(w * 0.5) - padX, sy - 4 - padY, w + padX * 2, 8 + padY * 2);

  ctx.fillStyle = '#111316';
  ctx.fillText(text, sx - Math.floor(w * 0.5) + 1, sy + 1);
  ctx.fillStyle = color;
  ctx.fillText(text, sx - Math.floor(w * 0.5), sy);
}

function drawFloatingHospitalSign(worldX, worldY, worldLeft, worldTop, yOffset, phase = 0) {
  const sx = Math.round(worldX - worldLeft);
  const baseY = Math.round(worldY - worldTop + yOffset);
  const bob = Math.sin(performance.now() * 0.005 + phase) * 3;
  const sy = Math.round(baseY + bob);
  if (sx < -80 || sy < -40 || sx > canvas.width + 80 || sy > canvas.height + 40) return;

  const w = 16;
  const h = 14;
  const x = sx - Math.floor(w * 0.5);
  const y = sy - Math.floor(h * 0.5);

  ctx.fillStyle = 'rgba(16, 18, 22, 0.72)';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = '#eceff3';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#c9ced6';
  ctx.fillRect(x + 1, y + 1, w - 2, 1);
  ctx.fillStyle = '#f5f7fa';
  ctx.fillRect(x + 1, y + h - 2, w - 2, 1);

  ctx.fillStyle = '#d63e44';
  ctx.fillRect(x + 6, y + 3, 4, 8);
  ctx.fillRect(x + 4, y + 5, 8, 4);
}

function specialBuildingSignAnchor(worldX, worldY) {
  const blockX = Math.floor(worldX / WORLD.blockPx);
  const blockY = Math.floor(worldY / WORLD.blockPx);
  const localX = mod(worldX, WORLD.blockPx);
  const localY = mod(worldY, WORLD.blockPx);
  const plotIndex = plotIndexForLocalCoord(localX, localY);
  if (plotIndex === null) {
    return { x: worldX, y: worldY };
  }

  const rect = centeredBuildingRectForPlot(blockX, blockY, plotIndex);
  const anchorX = blockX * WORLD.blockPx + (rect.x0 + rect.x1) * 0.5;
  const anchorY = blockY * WORLD.blockPx + rect.y0 + 4;
  return { x: anchorX, y: anchorY };
}

function drawSpecialBuildingSigns(state, worldLeft, worldTop) {
  const shops = state.world?.shops || [];
  for (let i = 0; i < shops.length; i += 1) {
    const shop = shops[i];
    const anchor = specialBuildingSignAnchor(shop.x, shop.y);
    drawFloatingLabel(anchor.x, anchor.y, worldLeft, worldTop, 'GUNS', '#ffd477', -12, i * 0.9);
  }

  const hospital = state.world?.hospital;
  if (hospital) {
    const anchor = specialBuildingSignAnchor(hospital.x, hospital.y);
    drawFloatingHospitalSign(anchor.x, anchor.y, worldLeft, worldTop, -14, 1.4);
  }
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
  const serverBlood = state?.blood || [];
  const merged = [];
  const seen = new Set();
  for (const stain of serverBlood) {
    if (!stain || !stain.id) continue;
    merged.push(stain);
    seen.add(stain.id);
  }
  for (const stain of clientBloodStains.values()) {
    if (!stain || seen.has(stain.id)) continue;
    merged.push(stain);
  }

  for (const stain of merged) {
    const sx = Math.round(stain.x - worldLeft);
    const sy = Math.round(stain.y - worldTop);
    if (sx < -18 || sy < -18 || sx > canvas.width + 18 || sy > canvas.height + 18) {
      continue;
    }

    const maxTtl = Number.isFinite(stain.maxTtl) ? stain.maxTtl : CLIENT_BLOOD_TTL;
    const ttl = Number.isFinite(stain.ttl) ? stain.ttl : maxTtl;
    const alpha = clamp(ttl / Math.max(1, maxTtl), 0.2, 1);
    ctx.fillStyle = `rgba(109,26,29,${alpha.toFixed(3)})`;
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

function drawCarShadow(sx, sy, angle, sprite) {
  const verticalWeight = Math.abs(Math.sin(angle));
  const shadowOffsetX = Math.round(1 + verticalWeight * 4);
  const shadowOffsetY = Math.round(3 + (1 - verticalWeight) * 3);

  ctx.save();
  ctx.translate(sx + shadowOffsetX, sy + shadowOffsetY);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
  ctx.fillRect(-Math.floor(sprite.width * 0.44), -Math.floor(sprite.height * 0.24), Math.floor(sprite.width * 0.88), Math.floor(sprite.height * 0.48));
  ctx.restore();
}

function drawCar(car, worldLeft, worldTop) {
  const sx = Math.round(car.x - worldLeft);
  const sy = Math.round(car.y - worldTop);

  if (sx < -32 || sy < -32 || sx > canvas.width + 32 || sy > canvas.height + 32) {
    return;
  }

  const sprite = getCarSprite(car.type, car.color);
  drawCarShadow(sx, sy, car.angle, sprite);

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(car.angle);

  const halfW = Math.floor(sprite.width * 0.5);
  const halfH = Math.floor(sprite.height * 0.5);

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

function cleanupWalkAnimationCache(now) {
  if (now - lastWalkAnimCleanupAt < 3000) return;
  lastWalkAnimCleanupAt = now;
  for (const [id, state] of walkAnimById.entries()) {
    if (now - state.lastSeenAt > 5000) {
      walkAnimById.delete(id);
    }
  }
}

function getWalkAnimationState(id, worldX, worldY) {
  const now = renderNowMs;
  let state = walkAnimById.get(id);
  if (!state) {
    state = {
      x: worldX,
      y: worldY,
      phase: Math.random() < 0.5 ? 0 : 1,
      lastSeenAt: now,
    };
    walkAnimById.set(id, state);
  }

  const dx = wrapDelta(worldX - state.x, WORLD.width);
  const dy = wrapDelta(worldY - state.y, WORLD.height);
  const dist = Math.hypot(dx, dy);
  const moving = dist > 0.18;

  if (moving) {
    state.phase = (state.phase + clamp(dist * 0.2, 0.06, 0.34)) % 2;
  }

  state.x = worldX;
  state.y = worldY;
  state.lastSeenAt = now;
  return {
    moving,
    step: state.phase >= 1 ? 1 : 0,
  };
}

function drawPixelCharacter(x, y, dir, bodyColor, skinColor, shirtDark, label = null, walkStep = 0, walking = false) {
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
      let drawY = y - 10 + row * unit;
      if (walking && token === '5') {
        const leftLeg = px < matrix[0].length * 0.5;
        const liftedLeg = (walkStep === 0 && leftLeg) || (walkStep === 1 && !leftLeg);
        if (liftedLeg) {
          drawY -= 1;
        }
      }
      ctx.fillRect(x - 8 + px * unit, drawY, unit, unit);
    }
  }

  if (label) {
    ctx.fillStyle = '#f3f7ff';
    ctx.font = '6px "Lucida Console", Monaco, monospace';
    const w = ctx.measureText(label).width;
    ctx.fillText(label, x - w * 0.5, y - 12);
  }
}

function wrapSpeechText(text, maxWidth) {
  const words = String(text || '').split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) {
    lines.push(current);
  }
  return lines.slice(0, 3);
}

function drawSpeechBubble(x, y, text) {
  if (!text) return;
  if (typeof text !== 'string') return;
  const safe = text.trim();
  if (!safe) return;

  ctx.font = '6px "Lucida Console", Monaco, monospace';
  const maxLineWidth = 118;
  const lines = wrapSpeechText(safe, maxLineWidth);
  if (lines.length === 0) return;

  let textW = 0;
  for (const line of lines) {
    textW = Math.max(textW, ctx.measureText(line).width);
  }

  const padX = 6;
  const padY = 4;
  const lineH = 8;
  const bubbleW = Math.ceil(textW + padX * 2);
  const bubbleH = Math.ceil(lines.length * lineH + padY * 2 - 1);
  const bx = Math.round(x - bubbleW * 0.5);
  const by = Math.round(y - 30 - bubbleH);
  const tipX = Math.round(x);
  const tipY = Math.round(y - 14);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.fillRect(bx + 2, by + 2, bubbleW, bubbleH);
  ctx.fillRect(tipX + 2, by + bubbleH + 2, 3, 4);

  ctx.fillStyle = '#11161e';
  ctx.fillRect(bx - 1, by - 1, bubbleW + 2, bubbleH + 2);
  ctx.fillRect(tipX - 2, by + bubbleH, 5, 5);

  ctx.fillStyle = '#fbfdff';
  ctx.fillRect(bx, by, bubbleW, bubbleH);
  ctx.fillRect(tipX - 1, by + bubbleH + 1, 3, 3);

  ctx.fillStyle = '#11161e';
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lw = ctx.measureText(line).width;
    const tx = Math.round(x - lw * 0.5);
    const ty = by + padY + 6 + i * lineH;
    ctx.fillText(line, tx, ty);
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

  const walk = getWalkAnimationState(`p:${player.id}`, player.x, player.y);
  drawPixelCharacter(x, y, player.dir || 0, player.color, '#f0c39a', '#1a3452', player.name, walk.step, walk.moving);
  if (typeof player.chatUntil === 'number' && player.chatUntil > Date.now()) {
    drawSpeechBubble(x, y, player.chatText || '');
  }
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

  const walk = getWalkAnimationState(`n:${npc.id}`, npc.x, npc.y);
  drawPixelCharacter(
    x,
    y,
    npc.dir || 0,
    npc.shirtColor || '#8092a6',
    npc.skinColor || '#f0c39a',
    npc.shirtDark || '#2a3342',
    null,
    walk.step,
    walk.moving
  );
}

function drawCopIdentityMarker(x, y, alert = false) {
  // Distinct police cap + badge + label so cops are easy to identify.
  ctx.fillStyle = '#0b1320';
  ctx.fillRect(x - 4, y - 14, 8, 1);
  ctx.fillStyle = '#5ea8ff';
  ctx.fillRect(x - 3, y - 15, 6, 2);
  ctx.fillStyle = '#f2d16b';
  ctx.fillRect(x - 1, y - 10, 2, 2);

  ctx.fillStyle = 'rgba(8, 16, 26, 0.74)';
  ctx.fillRect(x - 7, y - 24, 14, 7);
  ctx.fillStyle = alert ? '#ffe57a' : '#9bc6ff';
  ctx.font = '5px "Lucida Console", Monaco, monospace';
  const label = alert ? 'ALERT' : 'COP';
  const width = Math.ceil(ctx.measureText(label).width);
  ctx.fillText(label, x - Math.floor(width * 0.5), y - 19);
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
  const walk = getWalkAnimationState(`c:${cop.id}`, cop.x, cop.y);
  drawPixelCharacter(x, y, cop.dir || 0, uniform, '#efc39e', '#1f3157', null, walk.step, walk.moving);
  drawCopIdentityMarker(x, y, cop.alert);
  if (cop.alert) {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(x - 1, y - 15, 2, 7);
    ctx.fillRect(x - 1, y - 7, 2, 2);
    ctx.fillStyle = '#ffe164';
    ctx.fillRect(x, y - 14, 1, 5);
    ctx.fillRect(x, y - 7, 1, 1);
  }
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
      ctx.fillStyle = effect.skinColor || '#f0c39a';
      ctx.fillRect(-3, -2, 6, 4);
      ctx.fillStyle = effect.shirtColor || '#808891';
      ctx.fillRect(-4, 1, 8, 2);
      ctx.fillStyle = effect.shirtDark || '#2a3342';
      ctx.fillRect(-2, 3, 4, 1);
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

function drawMapOverlay(state) {
  if (!mapVisible || !state || !state.localPlayer) return;

  const world = state.world || WORLD;
  const mapSize = clamp(Math.round(Math.min(canvas.width, canvas.height) * 0.4), 130, 220);
  const mapW = mapSize;
  const mapH = Math.max(96, Math.round((world.height / Math.max(1, world.width)) * mapSize));
  const panelPadding = 6;
  const headerH = 10;
  const legendH = 18;
  const panelW = mapW + panelPadding * 2;
  const panelH = mapH + panelPadding * 2 + headerH + legendH;
  const px = canvas.width - panelW - 8;
  const py = 8;
  const mapX = px + panelPadding;
  const mapY = py + panelPadding + headerH;

  const sx = mapW / Math.max(1, world.width);
  const sy = mapH / Math.max(1, world.height);
  const toMapX = (x) => mapX + clamp(x, 0, world.width) * sx;
  const toMapY = (y) => mapY + clamp(y, 0, world.height) * sy;

  ctx.fillStyle = 'rgba(7, 12, 17, 0.84)';
  ctx.fillRect(px, py, panelW, panelH);
  ctx.strokeStyle = 'rgba(178, 216, 236, 0.8)';
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, panelW - 1, panelH - 1);

  ctx.fillStyle = '#90c9e8';
  ctx.font = '6px "Lucida Console", Monaco, monospace';
  ctx.fillText('CITY MAP (M)', px + 6, py + 8);
  const onlineCount = presenceOnlineCount > 0 ? presenceOnlineCount : (state.players || []).length;
  const onlineText = `Online:${onlineCount}`;
  const onlineWidth = ctx.measureText(onlineText).width;
  ctx.fillStyle = '#d9f2ff';
  ctx.fillText(onlineText, px + panelW - 6 - onlineWidth, py + 8);

  ctx.fillStyle = '#1e2f3c';
  ctx.fillRect(mapX, mapY, mapW, mapH);

  ctx.fillStyle = '#33444f';
  const roadW = Math.max(1, Math.round((world.roadEnd - world.roadStart) * sx));
  for (let bx = 0; bx <= world.width; bx += world.blockPx) {
    const rx = Math.round(mapX + (bx + world.roadStart) * sx);
    ctx.fillRect(rx, mapY, roadW, mapH);
  }
  for (let by = 0; by <= world.height; by += world.blockPx) {
    const ry = Math.round(mapY + (by + world.roadStart) * sy);
    ctx.fillRect(mapX, ry, mapW, roadW);
  }

  const shops = world.shops || [];
  for (const shop of shops) {
    const x = Math.round(toMapX(shop.x));
    const y = Math.round(toMapY(shop.y));
    ctx.fillStyle = '#58d979';
    ctx.fillRect(x - 2, y - 2, 4, 4);
  }

  if (world.hospital) {
    const hx = Math.round(toMapX(world.hospital.x));
    const hy = Math.round(toMapY(world.hospital.y));
    ctx.fillStyle = '#f6f6f6';
    ctx.fillRect(hx - 1, hy - 3, 2, 6);
    ctx.fillRect(hx - 3, hy - 1, 6, 2);
    ctx.fillStyle = '#ea6363';
    ctx.fillRect(hx - 1, hy - 2, 2, 4);
    ctx.fillRect(hx - 2, hy - 1, 4, 2);
  }

  const markerPlayers = presencePlayers.length > 0 ? presencePlayers : state.players || [];
  for (const p of markerPlayers) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const x = Math.round(toMapX(p.x));
    const y = Math.round(toMapY(p.y));
    const isLocal = p.id === state.localPlayer.id;
    const baseColor = typeof p.color === 'string' && p.color ? p.color : '#7cc8ff';
    const size = isLocal ? 5 : 4;
    const half = Math.floor(size * 0.5);
    ctx.fillStyle = baseColor;
    ctx.fillRect(x - half, y - half, size, size);
    ctx.fillStyle = '#020406';
    ctx.fillRect(x - 1, y - 1, 2, 2);
    if (isLocal) {
      ctx.strokeStyle = '#fff0a0';
      ctx.strokeRect(x - half - 1 + 0.5, y - half - 1 + 0.5, size + 2, size + 2);
    }
  }

  const viewW = Math.max(4, Math.round(canvas.width * sx));
  const viewH = Math.max(4, Math.round(canvas.height * sy));
  const viewX = Math.round(toMapX(camera.x - canvas.width * 0.5));
  const viewY = Math.round(toMapY(camera.y - canvas.height * 0.5));
  ctx.strokeStyle = 'rgba(243, 225, 130, 0.92)';
  ctx.strokeRect(viewX, viewY, viewW, viewH);

  const legendY = mapY + mapH + 6;
  ctx.font = '5px "Lucida Console", Monaco, monospace';
  ctx.fillStyle = '#58d979';
  ctx.fillRect(px + 8, legendY, 4, 4);
  ctx.fillStyle = '#d7edf9';
  ctx.fillText('Shop', px + 14, legendY + 4);

  ctx.fillStyle = '#f6f6f6';
  ctx.fillRect(px + 40, legendY + 1, 2, 4);
  ctx.fillRect(px + 39, legendY + 2, 4, 2);
  ctx.fillStyle = '#d7edf9';
  ctx.fillText('Hospital', px + 45, legendY + 4);

  ctx.fillStyle = '#7cc8ff';
  ctx.fillRect(px + 81, legendY, 4, 4);
  ctx.fillStyle = '#020406';
  ctx.fillRect(px + 82, legendY + 1, 2, 2);
  ctx.fillStyle = '#d7edf9';
  ctx.fillText('Player', px + 87, legendY + 4);
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

  const halfW = canvas.width * 0.5;
  const halfH = canvas.height * 0.5;
  if (localPrediction) {
    // Keep local movement responsive and remove visual "rollback" caused by camera lag.
    camera.x = Math.round(state.localPlayer.x - halfW) + halfW;
    camera.y = Math.round(state.localPlayer.y - halfH) + halfH;
  } else if (cameraHardSnapPending) {
    snapCameraToLocal(state.localPlayer);
    cameraHardSnapPending = false;
  } else {
    camera.x = lerp(camera.x, state.localPlayer.x, 0.18);
    camera.y = lerp(camera.y, state.localPlayer.y, 0.18);
  }

  camera.x = clamp(camera.x, halfW, WORLD.width - halfW);
  camera.y = clamp(camera.y, halfH, WORLD.height - halfH);
  if (!localPrediction) {
    camera.x = Math.round(camera.x);
    camera.y = Math.round(camera.y);
  }

  const worldLeft = camera.x - halfW;
  const worldTop = camera.y - halfH;

  if (state.localPlayer.insideShopId) {
    drawShopInterior(state);
    drawMapOverlay(state);
    if (statusNotice && performance.now() < statusNoticeUntil) {
      ctx.fillStyle = '#f6e7b9';
      ctx.font = '8px "Lucida Console", Monaco, monospace';
      const w = ctx.measureText(statusNotice).width;
      ctx.fillText(statusNotice, Math.floor(canvas.width * 0.5 - w * 0.5), 18);
    }
    return;
  }

  drawWorld(state);
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

  drawSpecialBuildingSigns(state, worldLeft, worldTop);
  drawEffects(worldLeft, worldTop);
  drawCrosshair(worldLeft, worldTop, state);
  drawMapOverlay(state);

  const local = state.localPlayer;
  if (local.health < 35) {
    const alpha = (35 - local.health) / 110;
    ctx.fillStyle = `rgba(170, 20, 20, ${alpha.toFixed(3)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (!local.inCarId) {
    const nearbyShop = nearbyShopForPlayer(state, local);
    if (nearbyShop) {
      ctx.font = '8px "Lucida Console", Monaco, monospace';
      const text = 'Press E to enter Gun Shop';
      const w = ctx.measureText(text).width;
      const chatVisible = !!(chatBar && !chatBar.classList.contains('hidden'));
      const bottomOffset = chatVisible ? 32 : 12;
      const tx = Math.floor(canvas.width * 0.5 - w * 0.5);
      const ty = canvas.height - bottomOffset;
      ctx.fillStyle = 'rgba(10, 14, 18, 0.76)';
      ctx.fillRect(tx - 4, ty - 8, Math.ceil(w) + 8, 11);
      ctx.fillStyle = '#121820';
      ctx.fillText(text, tx + 1, ty + 1);
      ctx.fillStyle = '#fff2ab';
      ctx.fillText(text, tx, ty);
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
  if (hudOnline) {
    const online = presenceOnlineCount > 0 ? presenceOnlineCount : (state.players || []).length;
    hudOnline.textContent = `Online: ${online}`;
  }
  if (hudWorldStats) {
    if (!debugStatsVisible || !state.stats) {
      hudWorldStats.textContent = '';
      hudWorldStats.style.display = 'none';
    } else {
      const s = state.stats;
      hudWorldStats.style.display = '';
      hudWorldStats.textContent =
        `NPC: ${s.npcAlive || 0} | Cars: ${s.carsCivilian || 0} | Officers: ${s.copsAlive || 0} | Cop Cars: ${s.carsCop || 0} | Ambulance: ${s.carsAmbulance || 0}`;
    }
  }
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

function stepClientBlood(dt) {
  if (clientBloodStains.size === 0) return;
  for (const stain of clientBloodStains.values()) {
    stain.ttl -= dt;
    if (stain.ttl <= 0) {
      clientBloodStains.delete(stain.id);
    }
  }
}

function startRenderLoop() {
  function frame(now) {
    const dt = clamp((now - lastFrameTime) / 1000, 0, 0.15);
    lastFrameTime = now;
    renderNowMs = now;
    cleanupWalkAnimationCache(now);
    stepClientBlood(dt);

    if (joined) {
      inputSendAccumulator += dt;
      while (inputSendAccumulator >= 1 / INPUT_SEND_RATE) {
        sendInput();
        inputSendAccumulator -= 1 / INPUT_SEND_RATE;
      }

      if (ENABLE_LOCAL_PREDICTION) {
        stepLocalPredictionRealtime(dt);
      }

      const serverTimeReference = estimatedServerTimeNow(now) - dynamicInterpDelayMs;
      const state = interpolateSnapshot(serverTimeReference);
      if (state && state.localPlayer) {
        if (ENABLE_LOCAL_PREDICTION) {
          applyPredictionToInterpolatedState(state);
        }
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
  if (mapBtn) {
    mapBtn.addEventListener('click', () => {
      if (!joined) return;
      toggleMapOverlay();
    });
  }

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

  if (settingsSirenVol) {
    settingsSirenVol.addEventListener('input', (event) => {
      const value = Number(event.target.value);
      settingsDraft.siren = clamp(value / 100, 0, 1);
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

  const submitChat = () => {
    if (!chatInput) return;
    const text = chatInput.value;
    sendChat(text);
    chatInput.value = '';
    chatInput.blur();
  };

  if (chatSendBtn) {
    chatSendBtn.addEventListener('click', () => {
      if (!joined) return;
      submitChat();
    });
  }

  if (chatInput) {
    chatInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        if (!joined) return;
        submitChat();
        return;
      }
      if (event.key === 'Escape') {
        chatInput.blur();
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
    syncSelectedProfileFromName(selectedName);
    renderProfileUi();
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

  nameInput.addEventListener('input', () => {
    syncSelectedProfileFromName(nameInput.value);
    renderProfileUi();
  });

  window.addEventListener('keydown', (event) => {
    if (joined && event.code === 'KeyM' && !event.repeat) {
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return;
      if (isSettingsOpen()) return;
      toggleMapOverlay();
      event.preventDefault();
      return;
    }

    if (joined && event.code === 'KeyO' && !event.repeat) {
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return;
      if (isSettingsOpen()) {
        closeSettingsPanel();
      } else {
        openSettingsPanel();
      }
      event.preventDefault();
      return;
    }

    if (joined && event.code === 'KeyU' && !event.repeat) {
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return;
      debugStatsVisible = !debugStatsVisible;
      INPUT.requestStats = debugStatsVisible;
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
  ensureBuildingTexturesLoaded();
  ensureBlockTexturesLoaded();
  refreshMapToggleUi();
  refreshSettingsPanel();
  populateColorGrid();
  selectColor(selectedColor);
  loadProfilesFromStorage();
  setStep('name');
  resizeCanvas();
  attachUiEvents();
  startRenderLoop();
  nameInput.focus();
}

boot();
