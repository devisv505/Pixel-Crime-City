const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const {
  OPCODES,
  ITEM_TO_CODE,
  SNAPSHOT_SECTION_ORDER,
  decodeClientFrame,
  encodeErrorFrame,
  encodeNoticeFrame,
  encodeJoinedFrame,
  encodePresenceFrame,
  encodeSnapshotFrame,
} = require('./server-protocol');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function envFlag(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  const value = String(raw).trim().toLowerCase();
  if (!value) return defaultValue;
  return !(value === '0' || value === 'false' || value === 'off' || value === 'no');
}

const PORT = Number(process.env.PORT || 3000);
const TICK_RATE = Math.max(10, Math.min(60, Number(process.env.TICK_RATE) || 36));
const DT = 1 / TICK_RATE;
const SNAPSHOT_RATE = Math.max(1, Math.min(TICK_RATE, Number(process.env.SNAPSHOT_RATE) || 24));
const PRESENCE_RATE = Math.max(1, Math.min(TICK_RATE, Number(process.env.PRESENCE_RATE) || 1));
const SNAPSHOT_KEYFRAME_EVERY = Math.max(4, Number(process.env.SNAPSHOT_KEYFRAME_EVERY) || 20);
const SNAPSHOT_INTERP_DELAY_MS = Math.max(
  60,
  Math.min(140, Number(process.env.SNAPSHOT_INTERP_DELAY_MS) || 85)
);
const COLLISION_GRID_CELL = 96;
const AOI_PED_RADIUS = Math.max(320, Number(process.env.AOI_PED_RADIUS) || 900);
const AOI_CAR_RADIUS = Math.max(AOI_PED_RADIUS, Number(process.env.AOI_CAR_RADIUS) || 1200);
const AOI_PED_RADIUS_SQ = AOI_PED_RADIUS * AOI_PED_RADIUS;
const AOI_CAR_RADIUS_SQ = AOI_CAR_RADIUS * AOI_CAR_RADIUS;
const OPT_AOI = envFlag('OPT_AOI', true);
const OPT_ZONE_LOD = envFlag('OPT_ZONE_LOD', true);
const OPT_CLIENT_VFX = envFlag('OPT_CLIENT_VFX', true);
const WORLD_REV = Number.isFinite(Number(process.env.WORLD_REV)) ? Number(process.env.WORLD_REV) : 1;
const PROGRESS_SECRET = String(process.env.PROGRESS_SECRET || 'pcc-progress-secret-v1');
const PROGRESS_TOKEN_VERSION = 1;
const PROGRESS_KEY = crypto.createHash('sha256').update(PROGRESS_SECRET).digest();
const CRIME_REPUTATION_LEGACY_FILE_ENV = String(process.env.CRIME_REPUTATION_FILE || '').trim();
const CRIME_REPUTATION_DB_FILE_ENV = String(process.env.CRIME_REPUTATION_DB_FILE || '').trim();
const CRIME_REPUTATION_DIR_ENV = String(process.env.CRIME_REPUTATION_DIR || '').trim();
const CRIME_REPUTATION_DB_DIR_ENV = String(process.env.CRIME_REPUTATION_DB_DIR || '').trim();
const CRIME_REPUTATION_DATA_DIR = path.resolve(
  CRIME_REPUTATION_DB_DIR_ENV ||
    CRIME_REPUTATION_DIR_ENV ||
    (CRIME_REPUTATION_LEGACY_FILE_ENV
      ? path.dirname(path.resolve(CRIME_REPUTATION_LEGACY_FILE_ENV))
      : path.join(__dirname, 'data'))
);
const CRIME_REPUTATION_DB_FILE = path.resolve(
  CRIME_REPUTATION_DB_FILE_ENV || path.join(CRIME_REPUTATION_DATA_DIR, 'crime-reputation.sqlite')
);
const CRIME_REPUTATION_LEGACY_JSON_FILE = path.resolve(
  CRIME_REPUTATION_LEGACY_FILE_ENV || path.join(CRIME_REPUTATION_DATA_DIR, 'crime-reputation.json')
);
const CRIME_BOARD_DEFAULT_PAGE_SIZE = 8;
const CRIME_BOARD_MAX_PAGE_SIZE = 32;
const CRIME_WEIGHTS = Object.freeze({
  npc_kill: 10,
  npc_kill_witnessed: 16,
  cop_assault: 2,
  cop_kill: 22,
  player_kill: 13,
  car_theft_civilian: 6,
  car_theft_ambulance: 9,
  car_theft_cop: 18,
  car_theft_cop_unattended: 12,
  car_destroy_civilian: 8,
  car_destroy_ambulance: 11,
  car_destroy_cop: 14,
  cop_car_assault: 20,
  vehicular_assault: 3,
});

const WORLD = {
  width: 3840,
  height: 3840,
  tileSize: 16,
  blockSizeTiles: 20,
  roadStartTile: 8,
  roadWidthTiles: 4,
};

const BLOCK_PX = WORLD.tileSize * WORLD.blockSizeTiles;
const ROAD_START = WORLD.roadStartTile * WORLD.tileSize;
const ROAD_END = ROAD_START + WORLD.roadWidthTiles * WORLD.tileSize;
const LANE_A = ROAD_START + 16;
const LANE_B = ROAD_START + 48;

const PLAYER_SPEED = 110;
const PLAYER_RADIUS = 7;
const DROP_LIFETIME = 22;
const DROP_PICKUP_RADIUS = 14;
const STAR_DECAY_PER_SECOND = 1 / 60;

const NPC_COUNT = 512;
const NPC_RADIUS = 6;
const COP_RADIUS = 7;
const COP_HEALTH = 200;
const COP_CAR_DISMOUNT_RADIUS = 92;
const COP_CAR_RECALL_RADIUS = 320;
const COP_DEPLOY_PICK_RADIUS = 220;
const COP_CAR_DEFAULT_CREW_SIZE = 2;
const COP_COMBAT_STANDOFF_MIN = 96;
const COP_COMBAT_STANDOFF_MAX = 168;
const COP_COMBAT_STANDOFF_PIVOT = 132;

const TRAFFIC_COUNT = 254;
const COP_COUNT = 32;
const COP_OFFICER_COUNT = 32;
const AMBULANCE_COUNT = 8;
const AMBULANCE_CAPACITY = 3;
const CAR_STUCK_RESPAWN_SECONDS = 5;
const CAR_MAX_HEALTH = 100;
const CAR_SMOKE_HEALTH = 50;
const CAR_RESPAWN_SECONDS = 30;
const MAX_NAME_LENGTH = 16;
const POLICE_WITNESS_RADIUS = 190;
const COP_ALERT_MARK_SECONDS = 2.4;
const NPC_HOSPITAL_FALLBACK_SECONDS = 60;
const COP_HOSPITAL_FALLBACK_SECONDS = 60;
const CHAT_DURATION_MS = 30_000;
const CHAT_MAX_LENGTH = 90;
const BLOOD_STAIN_LIFETIME = 240;

const clients = new Map();
const players = new Map();
const cars = new Map();
const npcs = new Map();
const cops = new Map();
const cashDrops = new Map();
const bloodStains = new Map();
let crimeReputationDb = null;
const crimeReputationSql = {};

let nextId = 1;
let nextEventId = 1;
let pendingEvents = [];
let tickSpatialContext = null;
let tickLodContext = null;
let nextProtocolId = 1;
const protocolIdsByEntityId = new Map();
const entityIdByProtocolId = new Map();
let bytesSentSinceReport = 0;
let nextMetricsAt = Date.now() + 5_000;
const tickMsWindow = [];
const snapshotBuildMsWindow = [];
let snapshotAccumulator = 0;
let presenceAccumulator = 0;

const CAR_PALETTE = ['#f9ce4e', '#ff7a5e', '#83d3ff', '#8eff92', '#d9a5ff', '#f2f2f2', '#a6ffef'];
const NPC_PALETTE = ['#f0c39a', '#f5d0b2', '#d2a67f', '#efba9f', '#c78f6f', '#e9c09a'];
const NPC_SHIRT_PALETTE = ['#5a8ad6', '#66b47a', '#c46060', '#b085d8', '#dfa04f', '#61b8b7', '#808891'];
const SHOP_STOCK = {
  shotgun: 500,
  machinegun: 1000,
  bazooka: 5000,
};
const SHOPS = [
  { id: 'shop_north', name: 'North Arms', x: BLOCK_PX * 8 + 228, y: BLOCK_PX * 2 + 236, radius: 34 },
  { id: 'shop_south', name: 'South Arms', x: BLOCK_PX * 4 + 236, y: BLOCK_PX * 9 + 234, radius: 34 },
  { id: 'shop_east', name: 'East Arms', x: BLOCK_PX * 10 + 236, y: BLOCK_PX * 4 + 228, radius: 34 },
  { id: 'shop_west', name: 'West Arms', x: BLOCK_PX * 1 + 236, y: BLOCK_PX * 7 + 232, radius: 34 },
  { id: 'shop_mid', name: 'Midtown Arms', x: BLOCK_PX * 6 + 232, y: BLOCK_PX * 6 + 236, radius: 34 },
  { id: 'shop_dock', name: 'Dock Arms', x: BLOCK_PX * 10 + 232, y: BLOCK_PX * 10 + 232, radius: 34 },
];
const SHOP_INDEX_BY_ID = new Map(SHOPS.map((shop, index) => [shop.id, index]));
const HOSPITAL = {
  id: 'hospital_central',
  name: 'City Hospital',
  x: BLOCK_PX * 5 + 228,
  y: BLOCK_PX * 0 + 228,
  radius: 42,
  dropX: BLOCK_PX * 5 + LANE_B,
  dropY: BLOCK_PX * 0 + ROAD_END + 16,
  releaseX: BLOCK_PX * 5 + ROAD_END + 8,
  releaseY: BLOCK_PX * 0 + ROAD_END + 8,
};
const STATIC_WORLD_PAYLOAD = Object.freeze({
  worldRev: WORLD_REV,
  width: WORLD.width,
  height: WORLD.height,
  tileSize: WORLD.tileSize,
  blockPx: BLOCK_PX,
  roadStart: ROAD_START,
  roadEnd: ROAD_END,
  laneA: LANE_A,
  laneB: LANE_B,
  shops: SHOPS.map((shop) =>
    Object.freeze({
      id: shop.id,
      name: shop.name,
      x: shop.x,
      y: shop.y,
      radius: shop.radius,
      stock: SHOP_STOCK,
    })
  ),
  hospital: Object.freeze({
    id: HOSPITAL.id,
    name: HOSPITAL.name,
    x: HOSPITAL.x,
    y: HOSPITAL.y,
    radius: HOSPITAL.radius,
  }),
});
const CAR_COLLISION_HALF_LENGTH_SCALE = 0.47;
const CAR_COLLISION_HALF_WIDTH_SCALE = 0.47;
const CAR_BUILDING_COLLISION_INSET_PX = 2;
const WEAPONS = {
  fist: {
    cooldown: 0.42,
    pellets: 1,
    spread: 0,
    range: 28,
    damage: 28,
    type: 'melee',
  },
  pistol: {
    cooldown: 0.22,
    pellets: 1,
    spread: 0.012,
    range: 320,
    damage: 100,
    type: 'bullet',
  },
  shotgun: {
    cooldown: 0.82,
    pellets: 6,
    spread: 0.22,
    range: 225,
    damage: 58,
    type: 'bullet',
  },
  machinegun: {
    cooldown: 0.1,
    pellets: 1,
    spread: 0.03,
    range: 330,
    damage: 45,
    type: 'bullet',
  },
  bazooka: {
    cooldown: 1.1,
    pellets: 1,
    spread: 0.02,
    range: 360,
    damage: 130,
    type: 'bullet',
  },
};

function mod(value, by) {
  return ((value % by) + by) % by;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wrapCoord(value, size) {
  if (!Number.isFinite(value)) return 0;
  return mod(value, size);
}

function wrapWorldX(x) {
  return wrapCoord(x, WORLD.width);
}

function wrapWorldY(y) {
  return wrapCoord(y, WORLD.height);
}

function wrapWorldPosition(entity) {
  entity.x = wrapWorldX(entity.x);
  entity.y = wrapWorldY(entity.y);
}

function wrapDelta(delta, size) {
  return mod(delta + size * 0.5, size) - size * 0.5;
}

function wrappedLerp(from, to, t, size) {
  return wrapCoord(from + wrapDelta(to - from, size) * t, size);
}

function wrappedDistanceSq(x1, y1, x2, y2) {
  const dx = wrapDelta(x2 - x1, WORLD.width);
  const dy = wrapDelta(y2 - y1, WORLD.height);
  return dx * dx + dy * dy;
}

function wrappedVector(x1, y1, x2, y2) {
  const dx = wrapDelta(x2 - x1, WORLD.width);
  const dy = wrapDelta(y2 - y1, WORLD.height);
  return {
    dx,
    dy,
    distSq: dx * dx + dy * dy,
    dist: Math.hypot(dx, dy),
  };
}

function wrappedDirection(fromX, fromY, toX, toY) {
  const v = wrappedVector(fromX, fromY, toX, toY);
  return Math.atan2(v.dy, v.dx);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function approach(value, target, amount) {
  if (value < target) {
    return Math.min(value + amount, target);
  }
  return Math.max(value - amount, target);
}

function angleWrap(value) {
  let v = value;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
}

function angleApproach(current, target, maxStep) {
  const delta = angleWrap(target - current);
  if (Math.abs(delta) <= maxStep) {
    return target;
  }
  return current + Math.sign(delta) * maxStep;
}

function snapToRightAngle(angle) {
  const quarter = Math.PI / 2;
  return Math.round(angle / quarter) * quarter;
}

function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, maxExclusive) {
  return Math.floor(randRange(min, maxExclusive));
}

function hash2D(x, y) {
  let n = x * 374761393 + y * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  n ^= n >> 16;
  return (n >>> 0) / 4294967295;
}

function quantized(value, precision = 100) {
  return Math.round(value * precision) / precision;
}

function pushMetricSample(buffer, value, max = 240) {
  if (!Number.isFinite(value)) return;
  buffer.push(value);
  if (buffer.length > max) {
    buffer.splice(0, buffer.length - max);
  }
}

function percentile(values, p) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function idPhase(id) {
  if (!id) return 0;
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

function entityInsidePlayerAoi(player, x, y, radiusSq) {
  return wrappedDistanceSq(player.x, player.y, x, y) <= radiusSq;
}

function makeId(prefix) {
  return `${prefix}_${nextId++}`;
}

function protocolIdForEntity(entityId) {
  if (!entityId) return 0;
  const existing = protocolIdsByEntityId.get(entityId);
  if (existing) return existing;
  const id = nextProtocolId++;
  protocolIdsByEntityId.set(entityId, id);
  entityIdByProtocolId.set(id, entityId);
  return id;
}

function protocolIdForEntityOptional(entityId) {
  if (!entityId) return 0;
  return protocolIdForEntity(entityId);
}

function releaseProtocolId(entityId) {
  if (!entityId) return;
  const protocolId = protocolIdsByEntityId.get(entityId);
  if (!protocolId) return;
  protocolIdsByEntityId.delete(entityId);
  entityIdByProtocolId.delete(protocolId);
}

function normalizeHexColor(value, fallback = '#ffffff') {
  if (typeof value !== 'string') return fallback;
  const c = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(c)) return fallback;
  return c;
}

function shopIndexById(id) {
  if (!id) return null;
  const index = SHOP_INDEX_BY_ID.get(id);
  return Number.isInteger(index) ? index : null;
}

function plotIndexForLocalCoord(localX, localY) {
  const xSide = localX < ROAD_START ? 0 : localX >= ROAD_END ? 1 : null;
  const ySide = localY < ROAD_START ? 0 : localY >= ROAD_END ? 1 : null;
  if (xSide === null || ySide === null) return null;
  return ySide * 2 + xSide; // 0 TL, 1 TR, 2 BL, 3 BR
}

function centeredBuildingRectForPlot(blockX, blockY, plotIndex) {
  const xSide = plotIndex % 2;
  const ySide = plotIndex > 1 ? 1 : 0;
  const lotX0 = xSide === 0 ? 0 : ROAD_END;
  const lotX1 = xSide === 0 ? ROAD_START : BLOCK_PX;
  const lotY0 = ySide === 0 ? 0 : ROAD_END;
  const lotY1 = ySide === 0 ? ROAD_START : BLOCK_PX;
  const lotSize = Math.min(lotX1 - lotX0, lotY1 - lotY0);
  const seed = hash2D(blockX * 71 + plotIndex * 17 + 11, blockY * 89 - plotIndex * 23 - 7);
  const size = Math.max(56, Math.min(lotSize - 20, 72 + Math.floor(seed * 12)));
  const x0 = Math.floor((lotX0 + lotX1 - size) * 0.5);
  const y0 = Math.floor((lotY0 + lotY1 - size) * 0.5);
  return { x0, y0, x1: x0 + size, y1: y0 + size };
}

function groundTypeAt(x, y) {
  const worldX = wrapWorldX(x);
  const worldY = wrapWorldY(y);

  const localX = mod(worldX, BLOCK_PX);
  const localY = mod(worldY, BLOCK_PX);
  const inVerticalRoad = localX >= ROAD_START && localX < ROAD_END;
  const inHorizontalRoad = localY >= ROAD_START && localY < ROAD_END;

  if (inVerticalRoad || inHorizontalRoad) {
    return 'road';
  }

  const sidePadding = 16;
  const inVerticalWalk = localX >= ROAD_START - sidePadding && localX < ROAD_END + sidePadding;
  const inHorizontalWalk = localY >= ROAD_START - sidePadding && localY < ROAD_END + sidePadding;
  if (inVerticalWalk || inHorizontalWalk) {
    return 'sidewalk';
  }

  const blockX = Math.floor(worldX / BLOCK_PX);
  const blockY = Math.floor(worldY / BLOCK_PX);
  const profile = hash2D(blockX, blockY);
  if (profile < 0.2) {
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

function roadInfoAt(x, y) {
  const localX = mod(x, BLOCK_PX);
  const localY = mod(y, BLOCK_PX);
  const inVerticalRoad = localX >= ROAD_START && localX < ROAD_END;
  const inHorizontalRoad = localY >= ROAD_START && localY < ROAD_END;
  return { inVerticalRoad, inHorizontalRoad };
}

function isSolidForPed(x, y) {
  const g = groundTypeAt(x, y);
  return g === 'building' || g === 'void';
}

function isSolidForCar(x, y) {
  const worldX = wrapWorldX(x);
  const worldY = wrapWorldY(y);
  const g = groundTypeAt(worldX, worldY);
  if (g === 'void') return true;
  if (g !== 'building') return false;

  const localX = mod(worldX, BLOCK_PX);
  const localY = mod(worldY, BLOCK_PX);
  const plotIndex = plotIndexForLocalCoord(localX, localY);
  if (plotIndex === null) return false;

  const blockX = Math.floor(worldX / BLOCK_PX);
  const blockY = Math.floor(worldY / BLOCK_PX);
  const rect = centeredBuildingRectForPlot(blockX, blockY, plotIndex);
  const inset = CAR_BUILDING_COLLISION_INSET_PX;
  return (
    localX > rect.x0 + inset &&
    localX < rect.x1 - inset &&
    localY > rect.y0 + inset &&
    localY < rect.y1 - inset
  );
}

function isIntersection(x, y) {
  const localX = mod(x, BLOCK_PX);
  const localY = mod(y, BLOCK_PX);
  return localX >= ROAD_START && localX < ROAD_END && localY >= ROAD_START && localY < ROAD_END;
}

function laneFor(coord, forwardPositive) {
  const block = Math.floor(coord / BLOCK_PX);
  const base = block * BLOCK_PX;
  return base + (forwardPositive ? LANE_B : LANE_A);
}

function isPreferredPedGround(ground) {
  return ground === 'sidewalk' || ground === 'park';
}

function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/\s+/g, ' ').replace(/[^a-zA-Z0-9 _-]/g, '');
  if (cleaned.length < 2 || cleaned.length > MAX_NAME_LENGTH) {
    return null;
  }
  return cleaned;
}

function sanitizeColor(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(value)) {
    return null;
  }
  return value;
}

function sanitizeChatText(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_MAX_LENGTH);
  return cleaned;
}

function toBase64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(text) {
  if (typeof text !== 'string' || !text) return null;
  const safe = text.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (safe.length % 4)) % 4;
  const padded = safe + '='.repeat(padLength);
  try {
    return Buffer.from(padded, 'base64');
  } catch {
    return null;
  }
}

function normalizeProgressPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (Number(payload.v) !== PROGRESS_TOKEN_VERSION) return null;
  const name = sanitizeName(payload.name);
  if (!name) return null;
  return {
    v: PROGRESS_TOKEN_VERSION,
    name,
    money: clamp(Math.round(Number(payload.money) || 0), 0, 0xffffffff),
    ownedShotgun: !!payload.ownedShotgun,
    ownedMachinegun: !!payload.ownedMachinegun,
    ownedBazooka: !!payload.ownedBazooka,
  };
}

function buildProgressPayloadFromPlayer(player) {
  return normalizeProgressPayload({
    v: PROGRESS_TOKEN_VERSION,
    name: player.name,
    money: player.money,
    ownedShotgun: player.ownedShotgun,
    ownedMachinegun: player.ownedMachinegun,
    ownedBazooka: player.ownedBazooka,
  });
}

function encodeProgressTicket(payload) {
  const normalized = normalizeProgressPayload(payload);
  if (!normalized) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', PROGRESS_KEY, iv);
  const encoded = Buffer.concat([cipher.update(JSON.stringify(normalized), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return toBase64Url(Buffer.concat([iv, tag, encoded]));
}

function decodeProgressTicket(ticket) {
  const raw = fromBase64Url(ticket);
  if (!raw || raw.length < 29) return null;
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', PROGRESS_KEY, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return normalizeProgressPayload(JSON.parse(plain));
  } catch {
    return null;
  }
}

function createProgressTicketForPlayer(player) {
  const payload = buildProgressPayloadFromPlayer(player);
  if (!payload) return '';
  return encodeProgressTicket(payload);
}

function progressSignatureFromPlayer(player) {
  const safeName = sanitizeName(player?.name || '') || '';
  const money = clamp(Math.round(Number(player?.money) || 0), 0, 0xffffffff);
  return `${safeName}|${money}|${player?.ownedShotgun ? 1 : 0}|${player?.ownedMachinegun ? 1 : 0}|${player?.ownedBazooka ? 1 : 0}`;
}

function restoreProgressForPlayer(player, ticket, expectedName) {
  if (!player || typeof ticket !== 'string' || !ticket) return false;
  if (ticket.length > 2048) return false;
  const decoded = decodeProgressTicket(ticket);
  if (!decoded) return false;
  if (decoded.name.toLowerCase() !== String(expectedName || '').toLowerCase()) return false;
  player.money = decoded.money;
  player.ownedShotgun = !!decoded.ownedShotgun;
  player.ownedMachinegun = !!decoded.ownedMachinegun;
  player.ownedBazooka = !!decoded.ownedBazooka;
  player.weapon = 'pistol';
  player.input.weaponSlot = 1;
  return true;
}

function normalizedNameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase();
}

function sanitizeProfileId(raw) {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.trim().toLowerCase();
  if (cleaned.length < 6 || cleaned.length > 96) return '';
  if (!/^[a-z0-9][a-z0-9._:-]{5,95}$/.test(cleaned)) return '';
  return cleaned;
}

function legacyProfileIdForName(name) {
  const key = normalizedNameKey(name);
  if (!key) return '';
  return `legacy:${key}`;
}

function crimeProfileTag(profileId) {
  const text = String(profileId || '');
  if (!text) return 'anon';
  const short = text
    .slice(-6)
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
  return short || 'anon';
}

function clampCrimeRating(value) {
  return clamp(Math.round(Number(value) || 0), 0, 0xffffffff);
}

function normalizeCrimeReputationRecord(record, fallbackProfileId = '') {
  if (!record || typeof record !== 'object') return null;
  const name = sanitizeName(record.name);
  const profileId =
    sanitizeProfileId(record.profileId) ||
    sanitizeProfileId(fallbackProfileId) ||
    legacyProfileIdForName(name);
  if (!name || !profileId) return null;
  return {
    profileId,
    name,
    crimeRating: clampCrimeRating(record.crimeRating),
    lastColor: normalizeHexColor(record.lastColor, '#58d2ff'),
    updatedAt: Number.isFinite(record.updatedAt) ? Math.max(0, Math.round(record.updatedAt)) : Date.now(),
  };
}

function crimeRecordFromRow(row, fallbackProfileId = '') {
  if (!row || typeof row !== 'object') return null;
  return normalizeCrimeReputationRecord(
    {
      profileId: row.profileId,
      name: row.name,
      crimeRating: row.crimeRating,
      lastColor: row.lastColor,
      updatedAt: row.updatedAt,
    },
    fallbackProfileId
  );
}

function ensureCrimeReputationDb() {
  if (crimeReputationDb) return true;
  try {
    fs.mkdirSync(path.dirname(CRIME_REPUTATION_DB_FILE), { recursive: true });
    crimeReputationDb = new Database(CRIME_REPUTATION_DB_FILE);
    crimeReputationDb.pragma('journal_mode = WAL');
    crimeReputationDb.pragma('synchronous = NORMAL');
    crimeReputationDb.exec(`
      CREATE TABLE IF NOT EXISTS crime_reputation (
        profile_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        crime_rating INTEGER NOT NULL DEFAULT 0,
        last_color TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_crime_reputation_ranking
        ON crime_reputation (crime_rating DESC, updated_at DESC, name ASC);
    `);
    crimeReputationSql.selectByProfileId = crimeReputationDb.prepare(`
      SELECT
        profile_id AS profileId,
        name,
        crime_rating AS crimeRating,
        last_color AS lastColor,
        updated_at AS updatedAt
      FROM crime_reputation
      WHERE profile_id = @profileId
      LIMIT 1
    `);
    crimeReputationSql.upsertMeta = crimeReputationDb.prepare(`
      INSERT INTO crime_reputation (profile_id, name, crime_rating, last_color, updated_at)
      VALUES (@profileId, @name, @crimeRating, @lastColor, @updatedAt)
      ON CONFLICT(profile_id) DO UPDATE SET
        name = excluded.name,
        last_color = excluded.last_color,
        updated_at = excluded.updated_at
    `);
    crimeReputationSql.upsertFull = crimeReputationDb.prepare(`
      INSERT INTO crime_reputation (profile_id, name, crime_rating, last_color, updated_at)
      VALUES (@profileId, @name, @crimeRating, @lastColor, @updatedAt)
      ON CONFLICT(profile_id) DO UPDATE SET
        name = excluded.name,
        crime_rating = excluded.crime_rating,
        last_color = excluded.last_color,
        updated_at = excluded.updated_at
    `);
    crimeReputationSql.renameLegacyProfileId = crimeReputationDb.prepare(`
      UPDATE crime_reputation
      SET profile_id = @nextProfileId, name = @name, last_color = @lastColor, updated_at = @updatedAt
      WHERE profile_id = @legacyProfileId
    `);
    crimeReputationSql.setCrimeRating = crimeReputationDb.prepare(`
      UPDATE crime_reputation
      SET crime_rating = @crimeRating, name = @name, last_color = @lastColor, updated_at = @updatedAt
      WHERE profile_id = @profileId
    `);
    crimeReputationSql.countAll = crimeReputationDb.prepare('SELECT COUNT(1) AS total FROM crime_reputation');
    crimeReputationSql.listPage = crimeReputationDb.prepare(`
      SELECT
        profile_id AS profileId,
        name,
        crime_rating AS crimeRating,
        last_color AS lastColor,
        updated_at AS updatedAt
      FROM crime_reputation
      ORDER BY crime_rating DESC, updated_at DESC, name ASC
      LIMIT @limit OFFSET @offset
    `);
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[crime] failed to open sqlite store at ${CRIME_REPUTATION_DB_FILE}: ${error.message}`);
    if (crimeReputationDb) {
      try {
        crimeReputationDb.close();
      } catch {}
    }
    crimeReputationDb = null;
    for (const key of Object.keys(crimeReputationSql)) {
      delete crimeReputationSql[key];
    }
    return false;
  }
}

function importLegacyCrimeReputationJsonIfNeeded() {
  if (!crimeReputationDb) return;
  if (path.resolve(CRIME_REPUTATION_LEGACY_JSON_FILE) === path.resolve(CRIME_REPUTATION_DB_FILE)) return;

  const currentCount = Number(crimeReputationSql.countAll.get()?.total) || 0;
  if (currentCount > 0) return;

  let parsed = null;
  try {
    const raw = fs.readFileSync(CRIME_REPUTATION_LEGACY_JSON_FILE, 'utf8');
    if (!raw.trim()) return;
    parsed = JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    // eslint-disable-next-line no-console
    console.warn(`[crime] failed to read legacy json ${CRIME_REPUTATION_LEGACY_JSON_FILE}: ${error.message}`);
    return;
  }

  const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : null;
  if (!entries || entries.length === 0) return;

  const records = [];
  for (const entry of entries) {
    const normalized = normalizeCrimeReputationRecord(entry, entry?.profileId);
    if (normalized) records.push(normalized);
  }
  if (records.length === 0) return;

  const insertMany = crimeReputationDb.transaction((items) => {
    for (const record of items) {
      crimeReputationSql.upsertFull.run({
        profileId: record.profileId,
        name: record.name,
        crimeRating: record.crimeRating,
        lastColor: record.lastColor,
        updatedAt: record.updatedAt,
      });
    }
  });

  try {
    insertMany(records);
    // eslint-disable-next-line no-console
    console.log(`[crime] imported ${records.length} legacy records into sqlite store`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[crime] failed to import legacy json into sqlite store: ${error.message}`);
  }
}

function loadCrimeReputationStore() {
  if (!ensureCrimeReputationDb()) return;
  importLegacyCrimeReputationJsonIfNeeded();
}

function closeCrimeReputationStore() {
  if (!crimeReputationDb) return;
  try {
    crimeReputationDb.close();
  } catch {}
  crimeReputationDb = null;
  for (const key of Object.keys(crimeReputationSql)) {
    delete crimeReputationSql[key];
  }
}

function resolveCrimeProfileIdForJoin(name, profileId) {
  return sanitizeProfileId(profileId) || legacyProfileIdForName(name);
}

function upsertCrimeReputationRecord(profileId, name, color) {
  if (!ensureCrimeReputationDb()) return null;
  const safeName = sanitizeName(name);
  if (!safeName) return null;
  const normalizedProfileId = resolveCrimeProfileIdForJoin(safeName, profileId);
  if (!normalizedProfileId) return null;
  const safeColor = normalizeHexColor(color, '#58d2ff');
  const now = Date.now();

  try {
    let record = crimeRecordFromRow(
      crimeReputationSql.selectByProfileId.get({ profileId: normalizedProfileId }),
      normalizedProfileId
    );

    if (!record && !normalizedProfileId.startsWith('legacy:')) {
      const legacyId = legacyProfileIdForName(safeName);
      const legacyRecord = crimeRecordFromRow(crimeReputationSql.selectByProfileId.get({ profileId: legacyId }), legacyId);
      if (legacyRecord) {
        crimeReputationSql.renameLegacyProfileId.run({
          nextProfileId: normalizedProfileId,
          name: safeName,
          lastColor: safeColor,
          updatedAt: now,
          legacyProfileId: legacyId,
        });
        record = crimeRecordFromRow(
          crimeReputationSql.selectByProfileId.get({ profileId: normalizedProfileId }),
          normalizedProfileId
        );
      }
    }

    if (!record) {
      crimeReputationSql.upsertFull.run({
        profileId: normalizedProfileId,
        name: safeName,
        crimeRating: 0,
        lastColor: safeColor,
        updatedAt: now,
      });
    } else {
      crimeReputationSql.upsertMeta.run({
        profileId: normalizedProfileId,
        name: safeName,
        crimeRating: record.crimeRating,
        lastColor: safeColor,
        updatedAt: now,
      });
    }

    return crimeRecordFromRow(
      crimeReputationSql.selectByProfileId.get({ profileId: normalizedProfileId }),
      normalizedProfileId
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[crime] failed to upsert reputation record ${normalizedProfileId}: ${error.message}`);
    return null;
  }
}

function attachCrimeReputationToPlayer(player, profileId) {
  if (!player) return;
  const record = upsertCrimeReputationRecord(profileId, player.name, player.color);
  if (!record) {
    player.profileId = resolveCrimeProfileIdForJoin(player.name, profileId);
    player.crimeRating = 0;
    return;
  }
  player.profileId = record.profileId;
  player.crimeRating = clampCrimeRating(record.crimeRating);
}

function addCrimeRating(player, amount) {
  if (!player) return;
  const gain = clampCrimeRating(amount);
  if (gain <= 0) return;
  const current = clampCrimeRating(player.crimeRating);
  const next = clampCrimeRating(current + gain);
  if (next === current) return;

  player.crimeRating = next;
  const record = upsertCrimeReputationRecord(player.profileId, player.name, player.color);
  if (!record) return;
  player.profileId = record.profileId;
  try {
    crimeReputationSql.setCrimeRating.run({
      profileId: record.profileId,
      name: sanitizeName(player.name) || record.name,
      crimeRating: next,
      lastColor: normalizeHexColor(player.color, record.lastColor || '#58d2ff'),
      updatedAt: Date.now(),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[crime] failed to persist crime gain for ${record.profileId}: ${error.message}`);
  }
}

function removeCrimeRating(player, amount) {
  if (!player) return;
  const loss = clampCrimeRating(amount);
  if (loss <= 0) return;
  const current = clampCrimeRating(player.crimeRating);
  const next = clampCrimeRating(current - loss);
  if (next === current) return;

  player.crimeRating = next;
  const record = upsertCrimeReputationRecord(player.profileId, player.name, player.color);
  if (!record) return;
  player.profileId = record.profileId;
  try {
    crimeReputationSql.setCrimeRating.run({
      profileId: record.profileId,
      name: sanitizeName(player.name) || record.name,
      crimeRating: next,
      lastColor: normalizeHexColor(player.color, record.lastColor || '#58d2ff'),
      updatedAt: Date.now(),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[crime] failed to persist crime loss for ${record.profileId}: ${error.message}`);
  }
}

function crimeWeightForDestroyedCar(car) {
  if (!car) return CRIME_WEIGHTS.car_destroy_civilian;
  if (car.type === 'cop') return CRIME_WEIGHTS.car_destroy_cop;
  if (car.type === 'ambulance') return CRIME_WEIGHTS.car_destroy_ambulance;
  return CRIME_WEIGHTS.car_destroy_civilian;
}

function onlineCrimeProfileIds() {
  const online = new Set();
  for (const player of players.values()) {
    const profileId = resolveCrimeProfileIdForJoin(player.name, player.profileId);
    if (profileId) {
      online.add(profileId);
    }
  }
  return online;
}

app.get('/api/crime-leaderboard', (req, res) => {
  if (!ensureCrimeReputationDb()) {
    res.status(503).json({
      page: 1,
      pageSize: CRIME_BOARD_DEFAULT_PAGE_SIZE,
      total: 0,
      totalPages: 1,
      players: [],
      error: 'Crime store unavailable',
    });
    return;
  }

  const requestedPage = Number.parseInt(String(req.query.page || '1'), 10);
  const requestedPageSize = Number.parseInt(String(req.query.pageSize || CRIME_BOARD_DEFAULT_PAGE_SIZE), 10);
  const pageSize = clamp(
    Number.isFinite(requestedPageSize) ? requestedPageSize : CRIME_BOARD_DEFAULT_PAGE_SIZE,
    1,
    CRIME_BOARD_MAX_PAGE_SIZE
  );

  try {
    const total = Number(crimeReputationSql.countAll.get()?.total) || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = clamp(Number.isFinite(requestedPage) ? requestedPage : 1, 1, totalPages);
    const start = (page - 1) * pageSize;
    const onlineIds = onlineCrimeProfileIds();
    const rows = total > 0 ? crimeReputationSql.listPage.all({ limit: pageSize, offset: start }) : [];

    res.json({
      page,
      pageSize,
      total,
      totalPages,
      players: rows
        .map((row, index) => {
          const record = crimeRecordFromRow(row, row.profileId);
          if (!record) return null;
          return {
            rank: start + index + 1,
            name: record.name,
            crimeRating: clampCrimeRating(record.crimeRating),
            color: normalizeHexColor(record.lastColor, '#58d2ff'),
            profileTag: crimeProfileTag(record.profileId),
            online: onlineIds.has(record.profileId),
          };
        })
        .filter(Boolean),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[crime] failed to query leaderboard: ${error.message}`);
    res.status(500).json({
      page: 1,
      pageSize,
      total: 0,
      totalPages: 1,
      players: [],
      error: 'Crime leaderboard query failed',
    });
  }
});

process.on('exit', () => {
  closeCrimeReputationStore();
});

app.use(express.static(path.join(__dirname, 'public')));

function emitEvent(type, payload) {
  pendingEvents.push({
    id: nextEventId++,
    type,
    at: Date.now(),
    ...payload,
  });
}

function randomRoadSpawn() {
  const horizontal = Math.random() < 0.5;
  if (horizontal) {
    const blockY = randInt(0, Math.floor(WORLD.height / BLOCK_PX));
    const y = blockY * BLOCK_PX + (Math.random() < 0.5 ? LANE_A : LANE_B);
    const x = randRange(48, WORLD.width - 48);
    const angle = Math.random() < 0.5 ? 0 : Math.PI;
    return { x, y, angle };
  }

  const blockX = randInt(0, Math.floor(WORLD.width / BLOCK_PX));
  const x = blockX * BLOCK_PX + (Math.random() < 0.5 ? LANE_A : LANE_B);
  const y = randRange(48, WORLD.height - 48);
  const angle = Math.random() < 0.5 ? Math.PI * 0.5 : -Math.PI * 0.5;
  return { x, y, angle };
}

function randomRoadSpawnNear(x, y) {
  const blocksX = Math.floor(WORLD.width / BLOCK_PX);
  const blocksY = Math.floor(WORLD.height / BLOCK_PX);
  const originX = wrapWorldX(x);
  const originY = wrapWorldY(y);
  const originBlockX = Math.floor(originX / BLOCK_PX);
  const originBlockY = Math.floor(originY / BLOCK_PX);

  for (let i = 0; i < 36; i += 1) {
    const horizontal = Math.random() < 0.5;
    if (horizontal) {
      const blockY = mod(originBlockY + randInt(-2, 3), blocksY);
      const spawnY = blockY * BLOCK_PX + (Math.random() < 0.5 ? LANE_A : LANE_B);
      const spawnX = wrapWorldX(originX + randRange(-BLOCK_PX * 1.8, BLOCK_PX * 1.8));
      const angle = Math.random() < 0.5 ? 0 : Math.PI;
      if (!isSolidForCar(spawnX, spawnY)) {
        return { x: spawnX, y: spawnY, angle };
      }
    } else {
      const blockX = mod(originBlockX + randInt(-2, 3), blocksX);
      const spawnX = blockX * BLOCK_PX + (Math.random() < 0.5 ? LANE_A : LANE_B);
      const spawnY = wrapWorldY(originY + randRange(-BLOCK_PX * 1.8, BLOCK_PX * 1.8));
      const angle = Math.random() < 0.5 ? Math.PI * 0.5 : -Math.PI * 0.5;
      if (!isSolidForCar(spawnX, spawnY)) {
        return { x: spawnX, y: spawnY, angle };
      }
    }
  }

  return randomRoadSpawn();
}

function randomPedSpawn() {
  for (let i = 0; i < 140; i++) {
    const fromRoad = randomRoadSpawn();
    const side = Math.random() < 0.5 ? -1 : 1;
    const offset = randRange(24, 44);
    const angle = fromRoad.angle + Math.PI * 0.5;
    const x = clamp(fromRoad.x + Math.cos(angle) * offset * side, 24, WORLD.width - 24);
    const y = clamp(fromRoad.y + Math.sin(angle) * offset * side, 24, WORLD.height - 24);
    if (!isSolidForPed(x, y) && isPreferredPedGround(groundTypeAt(x, y))) {
      return { x, y };
    }
  }

  return { x: WORLD.width * 0.5, y: WORLD.height * 0.5 };
}

function findSafePedSpawnNear(x, y, maxRadius = 140, preferSafeGround = true) {
  const baseX = wrapWorldX(x);
  const baseY = wrapWorldY(y);
  const dirs = [
    0,
    Math.PI * 0.5,
    Math.PI,
    -Math.PI * 0.5,
    Math.PI * 0.25,
    Math.PI * 0.75,
    -Math.PI * 0.25,
    -Math.PI * 0.75,
  ];
  const radii = [0, 8, 14, 20, 28, 38, 50, 64, 82, 104, 128, 156];

  for (const radius of radii) {
    if (radius > maxRadius) continue;
    for (const dir of dirs) {
      const px = wrapWorldX(baseX + Math.cos(dir) * radius + randRange(-2, 2));
      const py = wrapWorldY(baseY + Math.sin(dir) * radius + randRange(-2, 2));
      if (isSolidForPed(px, py)) continue;
      if (preferSafeGround && !isPreferredPedGround(groundTypeAt(px, py))) continue;
      return { x: px, y: py };
    }
  }

  return null;
}

function findShopById(id) {
  if (!id) return null;
  for (const shop of SHOPS) {
    if (shop.id === id) return shop;
  }
  return null;
}

function findNearbyShop(player, maxDistance) {
  const maxDistSq = maxDistance * maxDistance;
  for (const shop of SHOPS) {
    const dx = player.x - shop.x;
    const dy = player.y - shop.y;
    if (dx * dx + dy * dy <= maxDistSq) {
      return shop;
    }
  }
  return null;
}

function makeCashDrop(x, y, amount) {
  const id = makeId('drop');
  const angle = randRange(0, Math.PI * 2);
  const speed = randRange(24, 56);
  const drop = {
    id,
    x,
    y,
    amount,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    ttl: DROP_LIFETIME,
    pickupDelay: 0.45,
  };
  cashDrops.set(id, drop);
  return drop;
}

function makeBloodStain(x, y) {
  const id = makeId('blood');
  const stain = {
    id,
    x,
    y,
    ttl: BLOOD_STAIN_LIFETIME,
  };
  bloodStains.set(id, stain);
  if (OPT_CLIENT_VFX) {
    emitEvent('bloodSpawn', {
      stainId: id,
      x,
      y,
      ttl: BLOOD_STAIN_LIFETIME,
    });
  }
  return stain;
}

function hospitalReleaseSpawn() {
  const anchors = [
    { x: HOSPITAL.releaseX, y: HOSPITAL.releaseY },
    { x: HOSPITAL.dropX, y: HOSPITAL.dropY },
    { x: HOSPITAL.x, y: HOSPITAL.y },
  ];
  const radii = [0, 8, 14, 20, 28, 36, 48, 64, 86];
  const dirs = [
    0,
    Math.PI * 0.5,
    Math.PI,
    -Math.PI * 0.5,
    Math.PI * 0.25,
    Math.PI * 0.75,
    -Math.PI * 0.25,
    -Math.PI * 0.75,
  ];

  for (const anchor of anchors) {
    for (const radius of radii) {
      for (const dir of dirs) {
        const x = wrapWorldX(anchor.x + Math.cos(dir) * radius + randRange(-2, 2));
        const y = wrapWorldY(anchor.y + Math.sin(dir) * radius + randRange(-2, 2));
        if (!isSolidForPed(x, y) && isPreferredPedGround(groundTypeAt(x, y))) {
          return { x, y };
        }
      }
    }
  }

  for (const anchor of anchors) {
    for (const radius of radii) {
      for (const dir of dirs) {
        const x = wrapWorldX(anchor.x + Math.cos(dir) * radius);
        const y = wrapWorldY(anchor.y + Math.sin(dir) * radius);
        if (!isSolidForPed(x, y)) {
          return { x, y };
        }
      }
    }
  }
  return randomPedSpawn();
}

function randomCurbSpawn() {
  const spawn = randomRoadSpawn();
  const side = Math.random() < 0.5 ? -1 : 1;
  const offset = randRange(26, 44);
  const angle = spawn.angle + Math.PI * 0.5;
  const x = clamp(spawn.x + Math.cos(angle) * offset * side, 20, WORLD.width - 20);
  const y = clamp(spawn.y + Math.sin(angle) * offset * side, 20, WORLD.height - 20);
  return { x, y };
}

function addStars(player, amount, cooldown = 22) {
  player.starHeat = clamp(player.starHeat + amount, 0, 5);
  player.starCooldown = Math.max(player.starCooldown, cooldown);
  player.stars = clamp(Math.ceil(player.starHeat - 0.001), 0, 5);
}

function forceFiveStars(player, cooldown = 42) {
  player.starHeat = 5;
  player.starCooldown = Math.max(player.starCooldown, cooldown);
  player.stars = 5;
}

function policeWitnessReport(x, y, radius = POLICE_WITNESS_RADIUS) {
  const r2 = radius * radius;
  const witnessCopIds = [];
  let witnessX = x;
  let witnessY = y;
  let bestDistSq = Infinity;
  let policeNear = false;

  for (const cop of cops.values()) {
    if (!cop.alive || cop.inCarId) continue;
    const dx = cop.x - x;
    const dy = cop.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r2) {
      policeNear = true;
      witnessCopIds.push(cop.id);
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        witnessX = cop.x;
        witnessY = cop.y;
      }
    }
  }

  for (const car of cars.values()) {
    if (car.type !== 'cop' || car.destroyed) continue;
    const dx = car.x - x;
    const dy = car.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r2) {
      policeNear = true;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        witnessX = car.x;
        witnessY = car.y;
      }
    }
  }

  return { policeNear, witnessCopIds, witnessX, witnessY };
}

function releaseCarDriver(car) {
  if (!car.driverId) return;
  const player = players.get(car.driverId);
  if (player) {
    player.inCarId = null;
  }
  car.driverId = null;
  car.abandonTimer = 0;
}

function makeCar(type = 'civilian') {
  const spawn = randomRoadSpawn();
  const isCop = type === 'cop';
  const isAmbulance = type === 'ambulance';
  const baseSpeed = isCop ? 75 : isAmbulance ? 60 : 55;
  const maxSpeed = isCop ? 190 : isAmbulance ? 165 : 145;
  const turnSpeed = isCop ? 3.1 : isAmbulance ? 2.6 : 2.2;
  const car = {
    id: makeId('car'),
    type,
    x: spawn.x,
    y: spawn.y,
    angle: spawn.angle,
    speed: baseSpeed,
    maxSpeed,
    turnSpeed,
    width: 24,
    height: 14,
    health: CAR_MAX_HEALTH,
    destroyed: false,
    destroyedTimer: 0,
    destroyedX: spawn.x,
    destroyedY: spawn.y,
    driverId: null,
    npcDriver: true,
    abandonTimer: 0,
    aiCooldown: randRange(0.35, 1.35),
    hornCooldown: randRange(0, 1),
    bodyHitCooldown: 0,
    dismountCooldown: 0,
    dismountCopIds: [],
    crewCopIds: [],
    dismountTargetPlayerId: null,
    sirenOn: false,
    ambulanceMode: 'idle',
    ambulanceTargetType: null,
    ambulanceTargetId: null,
    ambulanceLoad: [],
    stuckTimer: 0,
    lastMoveX: spawn.x,
    lastMoveY: spawn.y,
    color: isCop ? '#5ca1ff' : isAmbulance ? '#f4f6fb' : CAR_PALETTE[randInt(0, CAR_PALETTE.length)],
    npcOccupantCount: isCop || isAmbulance ? 2 : 1,
    stolenFromNpc: false,
    occupantNpcIds: [],
    ownerNpcId: null,
    ownerReturnTimer: 0,
  };
  cars.set(car.id, car);
  return car;
}

function carCruiseSpeedByType(type) {
  if (type === 'cop') return 88;
  if (type === 'ambulance') return 72;
  return 62;
}

function randomRoadSpawnFarFrom(x, y, minDistance = BLOCK_PX * 2.2) {
  const minDistSq = minDistance * minDistance;
  for (let i = 0; i < 72; i += 1) {
    const spawn = randomRoadSpawn();
    if (wrappedDistanceSq(spawn.x, spawn.y, x, y) >= minDistSq && !isSolidForCar(spawn.x, spawn.y)) {
      return spawn;
    }
  }
  return randomRoadSpawnNear(x, y);
}

function resetCarForRespawn(car, spawn) {
  const isCop = car.type === 'cop';
  const isAmbulance = car.type === 'ambulance';
  car.x = spawn.x;
  car.y = spawn.y;
  car.angle = spawn.angle;
  car.speed = isCop ? 75 : isAmbulance ? 60 : 55;
  car.maxSpeed = isCop ? 190 : isAmbulance ? 165 : 145;
  car.turnSpeed = isCop ? 3.1 : isAmbulance ? 2.6 : 2.2;
  car.health = CAR_MAX_HEALTH;
  car.destroyed = false;
  car.destroyedTimer = 0;
  car.destroyedX = spawn.x;
  car.destroyedY = spawn.y;
  car.driverId = null;
  car.npcDriver = true;
  car.abandonTimer = 0;
  car.aiCooldown = randRange(0.25, 1.15);
  car.hornCooldown = randRange(0, 1);
  car.bodyHitCooldown = 0;
  car.dismountCooldown = 0;
  car.sirenOn = false;
  car.stuckTimer = 0;
  car.lastMoveX = spawn.x;
  car.lastMoveY = spawn.y;
  car.stolenFromNpc = false;
  car.ownerNpcId = null;
  car.ownerReturnTimer = 0;
  car.occupantNpcIds = [];
  if (car.type === 'cop') {
    car.dismountCopIds = [];
    car.dismountTargetPlayerId = null;
  }
  if (car.type === 'ambulance') {
    dropAmbulanceLoadAtCar(car);
    resetAmbulanceTask(car);
    car.ambulanceMode = 'idle';
    car.ambulanceTargetType = null;
    car.ambulanceTargetId = null;
  }
}

function killCarOccupants(car, attacker = null) {
  const killerId = attacker && attacker.id ? attacker.id : null;

  if (car.driverId) {
    const driver = players.get(car.driverId);
    if (driver) {
      damagePlayer(driver, 999, attacker || null);
    }
    car.driverId = null;
  }

  if (Array.isArray(car.occupantNpcIds)) {
    for (const npcId of car.occupantNpcIds) {
      const npc = npcs.get(npcId);
      if (npc && npc.alive) {
        killNpc(npc, killerId);
      }
    }
    car.occupantNpcIds = [];
  }
  car.ownerNpcId = null;
  car.stolenFromNpc = false;
  car.ownerReturnTimer = 0;

  for (const cop of cops.values()) {
    if (!cop.alive || cop.inCarId !== car.id) continue;
    damageCop(cop, 999, attacker || null);
  }
}

function destroyCar(car, attacker = null) {
  if (!car || car.destroyed) return;
  const blastX = car.x;
  const blastY = car.y;
  const killer = attacker && attacker.health > 0 ? attacker : null;

  car.destroyed = true;
  car.health = 0;
  car.destroyedTimer = CAR_RESPAWN_SECONDS;
  car.destroyedX = blastX;
  car.destroyedY = blastY;
  car.speed = 0;
  car.npcDriver = false;
  car.abandonTimer = 0;
  car.aiCooldown = 0;
  car.bodyHitCooldown = 0;
  car.sirenOn = false;

  if (car.type === 'cop') {
    car.dismountCopIds = [];
    car.dismountTargetPlayerId = null;
  }
  if (car.type === 'ambulance') {
    dropAmbulanceLoadAtCar(car);
    resetAmbulanceTask(car);
    car.ambulanceMode = 'idle';
  }

  const reward = randInt(10, 21);
  const drop = makeCashDrop(blastX, blastY, reward);
  emitEvent('cashDrop', {
    dropId: drop.id,
    amount: reward,
    x: drop.x,
    y: drop.y,
  });

  if (killer && !killer.insideShopId) {
    const starGain = car.type === 'cop' ? 1.6 : car.type === 'ambulance' ? 1.25 : 0.9;
    addStars(killer, starGain, 30);
    addCrimeRating(killer, crimeWeightForDestroyedCar(car));
  }

  killCarOccupants(car, attacker);
  applyExplosionDamage(blastX, blastY, attacker, 72, { sourceCarId: car.id });
}

function damageCar(car, amount, attacker = null) {
  if (!car || car.destroyed) return false;
  const dmg = Number(amount);
  if (!Number.isFinite(dmg) || dmg <= 0) return false;
  triggerCopCarAggroOnAttack(car, attacker);
  car.health = clamp(car.health - dmg, 0, CAR_MAX_HEALTH);
  if (car.health <= 0) {
    destroyCar(car, attacker);
    return true;
  }
  return false;
}

function carDamageFromWeapon(weaponName) {
  if (weaponName === 'machinegun') return 2.2;
  if (weaponName === 'shotgun') return 3.2;
  if (weaponName === 'pistol') return 4;
  return 0;
}

function copCarHasOfficersInside(car) {
  if (!car || car.type !== 'cop' || car.destroyed) return false;
  const crew = Array.isArray(car.crewCopIds) ? car.crewCopIds : [];
  for (const copId of crew) {
    const cop = cops.get(copId);
    if (cop && cop.alive && cop.inCarId === car.id) return true;
  }
  for (const cop of cops.values()) {
    if (cop.alive && cop.inCarId === car.id) return true;
  }
  return false;
}

function triggerCopCarAggroOnAttack(car, attacker) {
  if (!car || car.type !== 'cop' || car.destroyed) return;
  if (!attacker || attacker.health <= 0 || attacker.insideShopId) return;
  if (!copCarHasOfficersInside(car)) return;

  forceFiveStars(attacker, 48);
  addCrimeRating(attacker, CRIME_WEIGHTS.cop_car_assault);
  car.dismountTargetPlayerId = attacker.id;
  tryDeployCopOfficers(car, attacker, true);
  if (Array.isArray(car.dismountCopIds) && car.dismountCopIds.length > 0) {
    car.sirenOn = true;
  }
}

function makeNpc() {
  const spawn = randomPedSpawn();
  const npc = {
    id: makeId('npc'),
    x: spawn.x,
    y: spawn.y,
    dir: randRange(-Math.PI, Math.PI),
    baseSpeed: randRange(28, 45),
    wanderTimer: randRange(0.3, 1.6),
    panicTimer: 0,
    crossingTimer: 0,
    health: 100,
    alive: true,
    respawnTimer: 0,
    corpseState: 'none',
    bodyClaimedBy: null,
    bodyCarriedBy: null,
    reviveTimer: 0,
    corpseDownTimer: 0,
    skinColor: NPC_PALETTE[randInt(0, NPC_PALETTE.length)],
    shirtColor: NPC_SHIRT_PALETTE[randInt(0, NPC_SHIRT_PALETTE.length)],
    shirtDark: '#2a3342',
    reclaimCarId: null,
  };
  npcs.set(npc.id, npc);
  return npc;
}

function respawnNpc(npc, spawnOverride = null) {
  const spawn = spawnOverride || randomPedSpawn();
  npc.x = spawn.x;
  npc.y = spawn.y;
  npc.dir = randRange(-Math.PI, Math.PI);
  npc.baseSpeed = randRange(28, 45);
  npc.wanderTimer = randRange(0.4, 1.8);
  npc.panicTimer = 0;
  npc.crossingTimer = 0;
  npc.health = 100;
  npc.alive = true;
  npc.respawnTimer = 0;
  npc.corpseState = 'none';
  npc.bodyClaimedBy = null;
  npc.bodyCarriedBy = null;
  npc.reviveTimer = 0;
  npc.corpseDownTimer = 0;
  npc.reclaimCarId = null;
}

function makeCopUnit() {
  const spawn = randomCurbSpawn();
  const cop = {
    id: makeId('cop'),
    x: spawn.x,
    y: spawn.y,
    dir: randRange(-Math.PI, Math.PI),
    cooldown: randRange(0.4, 1.2),
    patrolTimer: randRange(0.4, 1.8),
    health: COP_HEALTH,
    alive: true,
    corpseState: 'none',
    bodyClaimedBy: null,
    bodyCarriedBy: null,
    reviveTimer: 0,
    corpseDownTimer: 0,
    homeCarId: null,
    rejoinCarId: null,
    assignedCarId: null,
    inCarId: null,
    mode: 'patrol',
    targetPlayerId: null,
    alertTimer: 0,
    combatStrafeDir: Math.random() < 0.5 ? -1 : 1,
    combatStrafeTimer: randRange(0.8, 1.6),
  };
  cops.set(cop.id, cop);
  return cop;
}

function respawnCop(cop, spawnOverride = null, rejoinPreviousCar = false) {
  const spawn = spawnOverride || randomCurbSpawn();
  const homeCarId = cop.homeCarId || null;
  const desiredCarId = rejoinPreviousCar ? cop.rejoinCarId || homeCarId : homeCarId;
  const desiredCar = desiredCarId ? cars.get(desiredCarId) : null;
  const canRejoin = !!(desiredCar && desiredCar.type === 'cop' && !desiredCar.destroyed);

  cop.x = spawn.x;
  cop.y = spawn.y;
  cop.dir = randRange(-Math.PI, Math.PI);
  cop.cooldown = randRange(0.35, 1.0);
  cop.patrolTimer = randRange(0.6, 1.8);
  cop.health = COP_HEALTH;
  cop.alive = true;
  cop.corpseState = 'none';
  cop.bodyClaimedBy = null;
  cop.bodyCarriedBy = null;
  cop.reviveTimer = 0;
  cop.corpseDownTimer = 0;
  cop.rejoinCarId = rejoinPreviousCar && canRejoin ? desiredCarId : null;
  cop.assignedCarId = canRejoin ? desiredCarId : null;
  cop.inCarId = null;
  cop.mode = canRejoin ? 'return' : 'patrol';
  cop.targetPlayerId = null;
  cop.alertTimer = 0;
  cop.combatStrafeDir = Math.random() < 0.5 ? -1 : 1;
  cop.combatStrafeTimer = randRange(0.8, 1.6);
}

function removeCopFromAssignedCar(cop) {
  if (!cop || !cop.assignedCarId) return;
  const car = cars.get(cop.assignedCarId);
  if (car && Array.isArray(car.dismountCopIds)) {
    car.dismountCopIds = car.dismountCopIds.filter((id) => id !== cop.id);
    if (car.dismountCopIds.length === 0) {
      car.dismountTargetPlayerId = null;
    }
  }
  cop.assignedCarId = null;
}

function killCop(cop, killer = null) {
  if (!cop || !cop.alive) return;

  const recoveryCarId = cop.assignedCarId || cop.inCarId || cop.rejoinCarId || cop.homeCarId || null;
  cop.rejoinCarId = recoveryCarId;
  if (recoveryCarId && !cop.assignedCarId) {
    cop.assignedCarId = recoveryCarId;
  }
  cop.alive = false;
  cop.health = 0;
  cop.mode = 'down';
  cop.corpseState = 'down';
  cop.bodyClaimedBy = null;
  cop.bodyCarriedBy = null;
  cop.reviveTimer = 0;
  cop.corpseDownTimer = 0;
  cop.targetPlayerId = null;
  cop.cooldown = 0;
  cop.inCarId = null;
  makeBloodStain(cop.x, cop.y);

  if (killer && killer.health > 0) {
    addStars(killer, 1.25, 34);
    addCrimeRating(killer, CRIME_WEIGHTS.cop_kill);
    const reward = randInt(4, 21);
    const drop = makeCashDrop(cop.x, cop.y, reward);
    emitEvent('cashDrop', {
      dropId: drop.id,
      amount: reward,
      x: drop.x,
      y: drop.y,
    });
  }
  dispatchAmbulanceForCop(cop);
  emitEvent('defeat', { x: cop.x, y: cop.y });
}

function damageCop(cop, amount, attacker = null) {
  if (!cop || !cop.alive || amount <= 0) return;

  cop.health -= amount;
  cop.cooldown = Math.max(cop.cooldown, 0.12);
  emitEvent('impact', { x: cop.x, y: cop.y });

  if (attacker && attacker.health > 0) {
    cop.targetPlayerId = attacker.id;
    cop.mode = 'hunt';
    addStars(attacker, 0.35, 18);
    addCrimeRating(attacker, CRIME_WEIGHTS.cop_assault);
  }

  if (cop.health <= 0) {
    killCop(cop, attacker);
  }
}

function awardNpcKill(killerId, x, y) {
  const killer = players.get(killerId);
  if (!killer || killer.health <= 0 || killer.insideShopId) return;

  const reward = randInt(2, 11);
  const witness = policeWitnessReport(x, y);
  if (witness.policeNear) {
    const alreadyInFiveStarPursuit = killer.stars >= 5 || killer.starHeat >= 4.99;
    addStars(killer, 5, 38);
    addCrimeRating(killer, CRIME_WEIGHTS.npc_kill_witnessed);
    killer.starHeat = 5;
    killer.stars = 5;
    for (const copId of witness.witnessCopIds) {
      const cop = cops.get(copId);
      if (!cop || !cop.alive) continue;
      cop.alertTimer = Math.max(cop.alertTimer || 0, COP_ALERT_MARK_SECONDS);
    }
    if (!alreadyInFiveStarPursuit) {
      emitEvent('copWitness', {
        playerId: killer.id,
        x: witness.witnessX,
        y: witness.witnessY,
      });
      killer.copAlertPlayed = true;
    }
  } else {
    addStars(killer, 1.0, 28);
    addCrimeRating(killer, CRIME_WEIGHTS.npc_kill);
  }
  const drop = makeCashDrop(x, y, reward);
  emitEvent('cashDrop', {
    dropId: drop.id,
    amount: reward,
    x: drop.x,
    y: drop.y,
  });
}

function killNpc(npc, killerId = null) {
  if (!npc.alive) return;

  const leaveCorpse = !!killerId;

  npc.alive = false;
  npc.health = 0;
  npc.respawnTimer = 0;
  npc.panicTimer = 0;
  npc.corpseDownTimer = 0;

  if (!leaveCorpse) {
    npc.corpseState = 'none';
    npc.bodyClaimedBy = null;
    npc.bodyCarriedBy = null;
    npc.reviveTimer = 0;
    respawnNpc(npc);
    return;
  }

  npc.corpseState = 'down';
  npc.bodyClaimedBy = null;
  npc.bodyCarriedBy = null;
  npc.reviveTimer = 0;
  npc.corpseDownTimer = 0;
  makeBloodStain(npc.x, npc.y);

  emitEvent('npcDown', {
    npcId: npc.id,
    x: npc.x,
    y: npc.y,
    killerId,
  });

  if (killerId) {
    awardNpcKill(killerId, npc.x, npc.y);
    dispatchAmbulanceForNpc(npc);
  }
}

function defeatPlayer(player) {
  if (player.respawnTimer > 0) return;
  player.health = 0;
  removeCrimeRating(player, 50);
  player.respawnTimer = 2.6;
  player.hitCooldown = 0;
  player.insideShopId = null;

  if (player.inCarId) {
    const car = cars.get(player.inCarId);
    if (car) {
      car.driverId = null;
      car.abandonTimer = 0;
    }
    player.inCarId = null;
  }

  player.starHeat = Math.max(0, player.starHeat - 2.2);
  player.stars = clamp(Math.ceil(player.starHeat - 0.001), 0, 5);
  emitEvent('defeat', { playerId: player.id, x: player.x, y: player.y });
}

function tryRespawn(player) {
  if (player.health > 0) return;
  player.respawnTimer -= DT;
  if (player.respawnTimer > 0) return;

  const spawn = hospitalReleaseSpawn();
  player.x = spawn.x;
  player.y = spawn.y;
  player.health = 100;
  player.respawnTimer = 0;
  player.hitCooldown = 1;
  player.starHeat = 0;
  player.starCooldown = 0;
  player.stars = 0;
  player.shootCooldown = 0;
  player.insideShopId = null;
}

function findNearbyCarForPlayer(player, maxDistance) {
  let best = null;
  let bestSq = maxDistance * maxDistance;
  for (const car of cars.values()) {
    if (car.destroyed) continue;
    if (car.driverId) continue;
    const dx = car.x - player.x;
    const dy = car.y - player.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestSq) {
      best = car;
      bestSq = d2;
    }
  }
  return best;
}

function findSafeExit(car) {
  const sideAngle = car.angle + Math.PI * 0.5;
  const options = [
    { x: car.x + Math.cos(sideAngle) * 20, y: car.y + Math.sin(sideAngle) * 20 },
    { x: car.x - Math.cos(sideAngle) * 20, y: car.y - Math.sin(sideAngle) * 20 },
    { x: car.x - Math.cos(car.angle) * 18, y: car.y - Math.sin(car.angle) * 18 },
    { x: car.x + Math.cos(car.angle) * 18, y: car.y + Math.sin(car.angle) * 18 },
  ];

  for (const p of options) {
    const x = wrapWorldX(p.x);
    const y = wrapWorldY(p.y);
    if (!isSolidForPed(x, y)) {
      return { x, y };
    }
  }

  return randomPedSpawn();
}

function acquireNpcForEjection(x, y) {
  let best = null;
  let bestScore = -Infinity;
  for (const npc of npcs.values()) {
    if (!npc.alive) continue;
    if (npc.corpseState === 'carried') continue;
    const score = wrappedDistanceSq(npc.x, npc.y, x, y);
    if (score > bestScore) {
      best = npc;
      bestScore = score;
    }
  }
  return best || makeNpc();
}

function spawnEjectedOccupantNpc(car, x, y, dir, skinColor, shirtColor, shirtDark = '#2a3342') {
  const npc = acquireNpcForEjection(x, y);
  const spawn = findSafePedSpawnNear(x, y, 56, true) || { x, y };
  npc.x = spawn.x;
  npc.y = spawn.y;
  npc.dir = dir;
  npc.baseSpeed = randRange(30, 48);
  npc.wanderTimer = randRange(0.2, 0.8);
  npc.panicTimer = randRange(2.2, 4.4);
  npc.crossingTimer = 0;
  npc.health = 100;
  npc.alive = true;
  npc.respawnTimer = 0;
  npc.corpseState = 'none';
  npc.bodyClaimedBy = null;
  npc.bodyCarriedBy = null;
  npc.reviveTimer = 0;
  npc.corpseDownTimer = 0;
  npc.skinColor = skinColor;
  npc.shirtColor = shirtColor;
  npc.shirtDark = shirtDark;
  if (!Array.isArray(car.occupantNpcIds)) {
    car.occupantNpcIds = [];
  }
  if (!car.occupantNpcIds.includes(npc.id)) {
    car.occupantNpcIds.push(npc.id);
  }
  return npc;
}

function getLivingOwnerNpcForCar(car) {
  if (!car) return null;
  if (car.ownerNpcId) {
    const owner = npcs.get(car.ownerNpcId);
    if (owner && owner.alive) {
      return owner;
    }
  }
  if (!Array.isArray(car.occupantNpcIds)) {
    return null;
  }
  for (const npcId of car.occupantNpcIds) {
    const npc = npcs.get(npcId);
    if (!npc || !npc.alive) continue;
    car.ownerNpcId = npc.id;
    return npc;
  }
  return null;
}

function ejectNpcFromCar(car) {
  const count = Math.max(1, Number.isFinite(car.npcOccupantCount) ? Math.floor(car.npcOccupantCount) : 1);
  car.occupantNpcIds = [];
  car.ownerNpcId = null;
  for (let i = 0; i < count; i++) {
    const side = count > 1 ? (i % 2 === 0 ? 1 : -1) : Math.random() < 0.5 ? 1 : -1;
    const sideAngle = car.angle + side * Math.PI * 0.5 + randRange(-0.2, 0.2);
    const ex = wrapWorldX(car.x + Math.cos(sideAngle) * randRange(10, 14));
    const ey = wrapWorldY(car.y + Math.sin(sideAngle) * randRange(10, 14));

    let shirtColor = NPC_SHIRT_PALETTE[randInt(0, NPC_SHIRT_PALETTE.length)];
    let shirtDark = '#2a3342';
    let skinColor = NPC_PALETTE[randInt(0, NPC_PALETTE.length)];

    if (car.type === 'cop') {
      shirtColor = '#4a8dff';
      shirtDark = '#1f3157';
      skinColor = '#efc39e';
    } else if (car.type === 'ambulance') {
      shirtColor = '#f4f6fb';
      shirtDark = '#c8343e';
      skinColor = '#efc39e';
    }

    if (car.type !== 'cop') {
      const npc = spawnEjectedOccupantNpc(car, ex, ey, sideAngle, skinColor, shirtColor, shirtDark);
      if (npc && !car.ownerNpcId) {
        car.ownerNpcId = npc.id;
      }
    }

    emitEvent('npcThrown', {
      x: ex,
      y: ey,
      dir: sideAngle,
      speed: randRange(70, 120),
      shirtColor,
      shirtDark,
      skinColor,
    });
  }
}

function reclaimCarAfterPlayerExit(car, player) {
  if (!car || !car.stolenFromNpc) return;

  if (car.type === 'cop') {
    pruneCopCarAssignments(car);
    car.dismountTargetPlayerId = player.id;
    tryDeployCopOfficers(car, player);
    car.sirenOn = Array.isArray(car.dismountCopIds) && car.dismountCopIds.length > 0;
    car.npcDriver = false;
    car.abandonTimer = 0;
    return;
  }

  car.npcDriver = false;
  car.abandonTimer = 0;
  car.speed = 0;
  car.ownerReturnTimer = 0;
  const owner = getLivingOwnerNpcForCar(car);
  if (owner) {
    owner.reclaimCarId = car.id;
    owner.panicTimer = Math.max(owner.panicTimer, 1.1);
    owner.wanderTimer = Math.min(owner.wanderTimer, 0.3);
  }
}

function enterShop(player, shop) {
  player.insideShopId = shop.id;
  player.shopExitX = player.x;
  player.shopExitY = player.y;
  player.input.up = false;
  player.input.down = false;
  player.input.left = false;
  player.input.right = false;
  emitEvent('enterShop', {
    playerId: player.id,
    shopId: shop.id,
    x: player.x,
    y: player.y,
  });
}

function exitShop(player) {
  if (!player.insideShopId) return;
  const shop = findShopById(player.insideShopId);
  player.insideShopId = null;

  let spawn = null;
  const hasStoredExit = Number.isFinite(player.shopExitX) && Number.isFinite(player.shopExitY);

  if (shop && hasStoredExit) {
    const nearShopSq = wrappedDistanceSq(player.shopExitX, player.shopExitY, shop.x, shop.y);
    if (nearShopSq <= 260 * 260) {
      spawn = findSafePedSpawnNear(player.shopExitX, player.shopExitY, 64, true);
    }
  }

  if (!spawn && shop) {
    const anchors = [
      { x: shop.x + 24, y: shop.y },
      { x: shop.x - 24, y: shop.y },
      { x: shop.x, y: shop.y + 24 },
      { x: shop.x, y: shop.y - 24 },
      { x: shop.x + 36, y: shop.y + 12 },
      { x: shop.x - 36, y: shop.y - 12 },
    ];
    for (const anchor of anchors) {
      spawn = findSafePedSpawnNear(anchor.x, anchor.y, 96, true);
      if (spawn) break;
    }
    if (!spawn) {
      spawn = findSafePedSpawnNear(shop.x, shop.y, 200, false);
    }
  }

  if (!spawn && hasStoredExit) {
    spawn = findSafePedSpawnNear(player.shopExitX, player.shopExitY, 140, true);
    if (!spawn) {
      spawn = findSafePedSpawnNear(player.shopExitX, player.shopExitY, 200, false);
    }
  }

  if (!spawn) {
    spawn = randomPedSpawn();
  }

  player.x = spawn.x;
  player.y = spawn.y;

  emitEvent('exitShop', {
    playerId: player.id,
    shopId: shop ? shop.id : null,
    x: player.x,
    y: player.y,
  });
}

function applyWeaponSelection(player) {
  const slot = player.input.weaponSlot;
  if (slot === 1 && player.ownedPistol) {
    player.weapon = 'pistol';
  } else if (slot === 2 && player.ownedShotgun) {
    player.weapon = 'shotgun';
  } else if (slot === 3 && player.ownedMachinegun) {
    player.weapon = 'machinegun';
  } else if (slot === 4 && player.ownedBazooka) {
    player.weapon = 'bazooka';
  }
}

function buyItemForPlayer(player, item) {
  if (!player.insideShopId) {
    return { ok: false, message: 'Enter a gun shop first.' };
  }

  const price = SHOP_STOCK[item];
  if (!price) {
    return { ok: false, message: 'Unknown item.' };
  }

  if (item === 'shotgun' && player.ownedShotgun) {
    return { ok: false, message: 'Shotgun already owned.' };
  }
  if (item === 'machinegun' && player.ownedMachinegun) {
    return { ok: false, message: 'Machinegun already owned.' };
  }
  if (item === 'bazooka' && player.ownedBazooka) {
    return { ok: false, message: 'Bazooka already owned.' };
  }
  if (player.money < price) {
    return { ok: false, message: 'Not enough money.' };
  }

  player.money -= price;
  if (item === 'shotgun') {
    player.ownedShotgun = true;
    player.input.weaponSlot = 2;
  } else if (item === 'machinegun') {
    player.ownedMachinegun = true;
    player.input.weaponSlot = 3;
  } else if (item === 'bazooka') {
    player.ownedBazooka = true;
    player.input.weaponSlot = 4;
  }
  player.weapon = item;

  emitEvent('purchase', {
    playerId: player.id,
    item,
    amount: price,
    x: player.x,
    y: player.y,
  });

  return { ok: true, message: `Purchased ${item}.` };
}

function handleEnterOrExit(player) {
  if (player.health <= 0) return;

  if (player.inCarId) {
    const car = cars.get(player.inCarId);
    if (!car) {
      player.inCarId = null;
      return;
    }

    const point = findSafeExit(car);
    car.driverId = null;
    car.abandonTimer = 0;
    player.inCarId = null;
    player.x = point.x;
    player.y = point.y;
    player.hitCooldown = 0.5;
    reclaimCarAfterPlayerExit(car, player);
    return;
  }

  if (player.insideShopId) {
    exitShop(player);
    return;
  }

  const shop = findNearbyShop(player, 34);
  if (shop) {
    enterShop(player, shop);
    return;
  }

  const candidate = findNearbyCarForPlayer(player, 34);
  if (!candidate) return;

  if (candidate.npcDriver) {
    candidate.npcDriver = false;
    candidate.abandonTimer = 0;
    candidate.stolenFromNpc = true;
    candidate.ownerReturnTimer = 0;
    ejectNpcFromCar(candidate);
    if (candidate.type === 'cop') {
      forceFiveStars(player, 48);
      addCrimeRating(player, CRIME_WEIGHTS.car_theft_cop);
      candidate.dismountTargetPlayerId = player.id;
      tryDeployCopOfficers(candidate, player);
      candidate.sirenOn = true;
    } else if (candidate.type === 'ambulance') {
      addStars(player, 1.0, 28);
      addCrimeRating(player, CRIME_WEIGHTS.car_theft_ambulance);
    } else {
      addStars(player, 0.75, 26);
      addCrimeRating(player, CRIME_WEIGHTS.car_theft_civilian);
    }
  }

  candidate.driverId = player.id;
  player.inCarId = candidate.id;
  player.x = candidate.x;
  player.y = candidate.y;
  player.dir = candidate.angle;

  if (candidate.type === 'cop' && !candidate.stolenFromNpc) {
    addStars(player, 0.8, 30);
    addCrimeRating(player, CRIME_WEIGHTS.car_theft_cop_unattended);
  }

  emitEvent('enterCar', { playerId: player.id, carId: candidate.id, x: player.x, y: player.y });
}

function movePedestrian(player, dt) {
  const input = player.input;
  let mx = 0;
  let my = 0;

  if (input.left) mx -= 1;
  if (input.right) mx += 1;
  if (input.up) my -= 1;
  if (input.down) my += 1;

  if (mx !== 0 || my !== 0) {
    const length = Math.hypot(mx, my);
    mx /= length;
    my /= length;

    const nx = wrapWorldX(player.x + mx * PLAYER_SPEED * dt);
    const ny = wrapWorldY(player.y + my * PLAYER_SPEED * dt);

    if (!isSolidForPed(nx, player.y)) {
      player.x = nx;
    }
    if (!isSolidForPed(player.x, ny)) {
      player.y = ny;
    }
  }

  wrapWorldPosition(player);
}

function carBodyPoints(car) {
  const points = [{ x: car.x, y: car.y }];
  const halfL = car.width * CAR_COLLISION_HALF_LENGTH_SCALE;
  const halfW = car.height * CAR_COLLISION_HALF_WIDTH_SCALE;
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

function enforceCarCollisions(car, prevX = car.x, prevY = car.y) {
  car.x = wrapWorldX(car.x);
  car.y = wrapWorldY(car.y);

  if (carCollidesSolid(car)) {
    let resolved = false;

    if (Number.isFinite(prevX) && Number.isFinite(prevY)) {
      const cx = car.x;
      const cy = car.y;
      for (let i = 1; i <= 8; i++) {
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
      const retreatSteps = [6, 10, 14, 18];
      for (const retreat of retreatSteps) {
        const tx = wrapWorldX(car.x + Math.cos(car.angle + Math.PI) * retreat);
        const ty = wrapWorldY(car.y + Math.sin(car.angle + Math.PI) * retreat);
        car.x = tx;
        car.y = ty;
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
    emitEvent('impact', { x: car.x, y: car.y });
  }

  wrapWorldPosition(car);
}

function carProbeBlocked(car, angle, distance) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const sideX = -s;
  const sideY = c;
  const halfWidth = car.height * 0.62;

  const probeCenterX = wrapWorldX(car.x + c * distance);
  const probeCenterY = wrapWorldY(car.y + s * distance);
  const probeLeftX = wrapWorldX(probeCenterX + sideX * halfWidth);
  const probeLeftY = wrapWorldY(probeCenterY + sideY * halfWidth);
  const probeRightX = wrapWorldX(probeCenterX - sideX * halfWidth);
  const probeRightY = wrapWorldY(probeCenterY - sideY * halfWidth);

  return (
    isSolidForCar(probeCenterX, probeCenterY) ||
    isSolidForCar(probeLeftX, probeLeftY) ||
    isSolidForCar(probeRightX, probeRightY)
  );
}

function chooseAvoidanceHeading(car, desiredAngle) {
  const probes = [20, 30, 42, 58];
  let clearAhead = true;
  for (const dist of probes) {
    if (carProbeBlocked(car, desiredAngle, dist)) {
      clearAhead = false;
      break;
    }
  }
  if (clearAhead) {
    return desiredAngle;
  }

  const options = [0.35, -0.35, 0.62, -0.62, 0.95, -0.95, 1.26, -1.26, 1.45, -1.45];
  let bestAngle = desiredAngle;
  let bestScore = Infinity;

  for (const offset of options) {
    const optionAngle = desiredAngle + offset;
    let blockedCount = 0;
    for (const dist of probes) {
      if (carProbeBlocked(car, optionAngle, dist)) {
        blockedCount += 1;
      }
    }
    const score = blockedCount * 100 + Math.abs(offset);
    if (score < bestScore) {
      bestScore = score;
      bestAngle = optionAngle;
    }
  }

  return bestAngle;
}

function stepDrivenCar(car, input, dt) {
  const throttle = input.up ? 1 : 0;
  const brake = input.down ? 1 : 0;
  const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  const acceleration = throttle * 300 - brake * 260;
  car.speed += acceleration * dt;

  if (!throttle && !brake) {
    car.speed *= Math.pow(0.88, dt * 8);
  }

  const terrain = groundTypeAt(car.x, car.y);
  if (terrain !== 'road') {
    car.speed *= Math.pow(0.92, dt * 12);
  }

  car.speed = clamp(car.speed, -92, car.maxSpeed);

  if (steer !== 0) {
    const steeringStrength = clamp(Math.abs(car.speed) / 90, 0.24, 1.3);
    const reverseFactor = car.speed < 0 ? -1 : 1;
    car.angle += steer * car.turnSpeed * steeringStrength * dt * reverseFactor;
  }

  const prevX = car.x;
  const prevY = car.y;
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  enforceCarCollisions(car, prevX, prevY);
}

function stepTrafficCar(car, dt) {
  car.aiCooldown -= dt;

  const targetCardinal = snapToRightAngle(car.angle);
  const steerCardinal = chooseAvoidanceHeading(car, targetCardinal);
  car.angle = angleApproach(car.angle, steerCardinal, dt * 2.8);

  const movingHorizontal = Math.abs(Math.cos(car.angle)) >= Math.abs(Math.sin(car.angle));
  if (movingHorizontal) {
    const desiredY = laneFor(car.y, Math.cos(car.angle) >= 0);
    car.y = lerp(car.y, desiredY, Math.min(1, dt * 4.4));
  } else {
    // Keep right-hand lane on vertical roads (south uses west lane, north uses east lane).
    const desiredX = laneFor(car.x, Math.sin(car.angle) < 0);
    car.x = lerp(car.x, desiredX, Math.min(1, dt * 4.4));
  }

  if (isIntersection(car.x, car.y) && car.aiCooldown <= 0) {
    const choice = Math.random();
    if (choice < 0.3) {
      car.angle = snapToRightAngle(car.angle + Math.PI * 0.5);
    } else if (choice < 0.6) {
      car.angle = snapToRightAngle(car.angle - Math.PI * 0.5);
    }
    car.aiCooldown = randRange(0.9, 1.5);
  }

  car.speed = approach(car.speed, 78, dt * 58);
  const prevX = car.x;
  const prevY = car.y;
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;

  enforceCarCollisions(car, prevX, prevY);
}

function stepAbandonedCar(car, dt) {
  car.speed *= Math.pow(0.86, dt * 8);
  if (Math.abs(car.speed) < 1) {
    car.speed = 0;
    return;
  }

  const prevX = car.x;
  const prevY = car.y;
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  enforceCarCollisions(car, prevX, prevY);
}

function nearestFiveStarPlayer(x, y) {
  let winner = null;
  let winnerScore = Infinity;

  for (const player of players.values()) {
    if (player.health <= 0 || player.stars < 5 || player.insideShopId) continue;
    const dist2 = wrappedDistanceSq(x, y, player.x, player.y);
    if (dist2 < winnerScore) {
      winner = player;
      winnerScore = dist2;
    }
  }

  return winner;
}

function pruneCopCarAssignments(car) {
  if (!Array.isArray(car.dismountCopIds)) {
    car.dismountCopIds = [];
    return;
  }
  car.dismountCopIds = car.dismountCopIds.filter((copId) => {
    const cop = cops.get(copId);
    if (!cop) return false;
    if (cop.homeCarId && cop.homeCarId !== car.id) return false;
    if (cop.inCarId === car.id) return false;
    return cop.assignedCarId === car.id || cop.rejoinCarId === car.id;
  });
  if (car.dismountCopIds.length === 0) {
    car.dismountTargetPlayerId = null;
  }
}

function availableCopForCar(car, target, alreadySelected) {
  let best = null;
  let bestScore = Infinity;
  const maxPickDistSq = COP_DEPLOY_PICK_RADIUS * COP_DEPLOY_PICK_RADIUS;
  const crew = Array.isArray(car.crewCopIds) ? car.crewCopIds : [];

  for (const copId of crew) {
    const cop = cops.get(copId);
    if (!cop || !cop.alive) continue;
    if (cop.inCarId && cop.inCarId !== car.id) continue;
    if (cop.assignedCarId && cop.assignedCarId !== car.id) continue;
    if (alreadySelected.has(cop.id)) continue;

    let score = -1;
    if (cop.inCarId !== car.id) {
      const distSq = wrappedDistanceSq(cop.x, cop.y, car.x, car.y);
      if (distSq > maxPickDistSq) continue;
      score = distSq;
    }

    if (score < bestScore) {
      best = cop;
      bestScore = score;
    }
  }

  if (!best) return null;
  const side = alreadySelected.size === 0 ? -1 : 1;
  const offset = 12;
  if (best.inCarId === car.id) {
    const sx = Math.sin(car.angle);
    const sy = -Math.cos(car.angle);
    best.x = wrapWorldX(car.x + sx * side * offset);
    best.y = wrapWorldY(car.y + sy * side * offset);
  }
  best.dir = wrappedDirection(best.x, best.y, target.x, target.y);
  best.mode = 'hunt';
  best.targetPlayerId = target.id;
  best.rejoinCarId = null;
  best.assignedCarId = car.id;
  best.inCarId = null;
  best.cooldown = randRange(0.15, 0.42);
  best.patrolTimer = randRange(0.8, 1.6);
  return best;
}

function tryDeployCopOfficers(car, target, forceDeploy = false) {
  if (!target || target.health <= 0 || target.stars < 5 || target.insideShopId) return;
  if (!forceDeploy) {
    if (car.dismountCooldown > 0) return;
    if (
      wrappedDistanceSq(car.x, car.y, target.x, target.y) > COP_CAR_DISMOUNT_RADIUS * COP_CAR_DISMOUNT_RADIUS
    ) {
      return;
    }
  }

  pruneCopCarAssignments(car);
  if (car.dismountCopIds.length > 0) {
    car.dismountTargetPlayerId = target.id;
    return;
  }

  const crew = Array.isArray(car.crewCopIds) ? car.crewCopIds : [];
  const maxDeploy = Math.max(1, Math.min(2, crew.length));
  const selected = new Set();
  for (let i = 0; i < maxDeploy; i++) {
    const cop = availableCopForCar(car, target, selected);
    if (!cop) break;
    selected.add(cop.id);
  }
  if (selected.size === 0) {
    for (const copId of selected) {
      const cop = cops.get(copId);
      if (!cop) continue;
      cop.assignedCarId = null;
      cop.mode = 'patrol';
      cop.targetPlayerId = null;
    }
    return;
  }

  car.dismountCopIds = Array.from(selected);
  car.dismountTargetPlayerId = target.id;
  car.dismountCooldown = randRange(4.2, 6.8);
  car.speed = Math.min(car.speed, 18);
}

function resetCopCarDeployment(car) {
  if (!car || car.type !== 'cop') return;
  if (!Array.isArray(car.dismountCopIds) || car.dismountCopIds.length === 0) {
    car.dismountCopIds = [];
    car.dismountTargetPlayerId = null;
    return;
  }
  for (const copId of car.dismountCopIds) {
    const cop = cops.get(copId);
    if (!cop || !cop.alive || cop.assignedCarId !== car.id) continue;
    cop.assignedCarId = null;
    cop.inCarId = null;
    cop.mode = 'patrol';
    cop.targetPlayerId = null;
  }
  car.dismountCopIds = [];
  car.dismountTargetPlayerId = null;
}

function stepCopCar(car, dt) {
  pruneCopCarAssignments(car);

  if (car.dismountCopIds.length > 0) {
    let target = car.dismountTargetPlayerId ? players.get(car.dismountTargetPlayerId) : null;
    if (
      !target ||
      target.health <= 0 ||
      target.stars < 5 ||
      target.insideShopId ||
      wrappedDistanceSq(car.x, car.y, target.x, target.y) > COP_CAR_RECALL_RADIUS * COP_CAR_RECALL_RADIUS
    ) {
      target = null;
    }

    if (target) {
      car.dismountTargetPlayerId = target.id;
      car.sirenOn = true;
    } else {
      car.dismountTargetPlayerId = null;
      car.sirenOn = false;
    }

    // Officers are out: keep the cop car abandoned/stationary at the deployment point.
    car.speed = approach(car.speed, 0, dt * 120);
    if (Math.abs(car.speed) > 0.2) {
      const prevX = car.x;
      const prevY = car.y;
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      enforceCarCollisions(car, prevX, prevY);
    }
    return;
  }

  const target = nearestFiveStarPlayer(car.x, car.y);
  if (!target) {
    car.sirenOn = false;
    stepTrafficCar(car, dt);
    car.speed = clamp(car.speed, -80, 130);
    return;
  }

  car.sirenOn = true;
  const chase = wrappedVector(car.x, car.y, target.x, target.y);
  const desired = Math.atan2(chase.dy, chase.dx);
  const steerDesired = chooseAvoidanceHeading(car, desired);
  car.angle = angleApproach(car.angle, steerDesired, dt * 2.4);
  const dist = chase.dist;
  const desiredSpeed = dist > 170 ? 120 : 42;
  car.speed = approach(car.speed, desiredSpeed, dt * 88);
  car.speed = clamp(car.speed, -60, 150);

  const prevX = car.x;
  const prevY = car.y;
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  enforceCarCollisions(car, prevX, prevY);

  tryDeployCopOfficers(car, target);
}

function nearestAvailableCorpse(x, y, maxDistance = Infinity) {
  let best = null;
  const bestStart = Number.isFinite(maxDistance) ? maxDistance * maxDistance : Infinity;
  let bestDistSq = bestStart;

  const corpses = tickSpatialContext?.corpses;
  const source = Array.isArray(corpses) ? corpses : [];
  for (const item of source) {
    if (!item || !item.entity || item.entity.alive || item.entity.bodyClaimedBy) continue;
    const d2 = wrappedDistanceSq(x, y, item.entity.x, item.entity.y);
    if (d2 < bestDistSq) {
      best = { type: item.type, id: item.id, entity: item.entity };
      bestDistSq = d2;
    }
  }

  if (!best && !Array.isArray(corpses)) {
    for (const npc of npcs.values()) {
      if (npc.alive || npc.corpseState !== 'down' || npc.bodyClaimedBy) continue;
      const d2 = wrappedDistanceSq(x, y, npc.x, npc.y);
      if (d2 < bestDistSq) {
        best = { type: 'npc', id: npc.id, entity: npc };
        bestDistSq = d2;
      }
    }
    for (const cop of cops.values()) {
      if (cop.alive || cop.corpseState !== 'down' || cop.bodyClaimedBy) continue;
      const d2 = wrappedDistanceSq(x, y, cop.x, cop.y);
      if (d2 < bestDistSq) {
        best = { type: 'cop', id: cop.id, entity: cop };
        bestDistSq = d2;
      }
    }
  }

  return best;
}

function driveAiToward(car, targetX, targetY, dt, farSpeed = 98, nearSpeed = 34) {
  const chase = wrappedVector(car.x, car.y, targetX, targetY);
  const desired = Math.atan2(chase.dy, chase.dx);
  const steerDesired = chooseAvoidanceHeading(car, desired);
  car.angle = angleApproach(car.angle, steerDesired, dt * 2.7);
  const dist = chase.dist;
  const desiredSpeed = dist > 120 ? farSpeed : nearSpeed;
  car.speed = approach(car.speed, desiredSpeed, dt * 84);
  car.speed = clamp(car.speed, -50, farSpeed + 20);

  const prevX = car.x;
  const prevY = car.y;
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  enforceCarCollisions(car, prevX, prevY);
  return dist;
}

function getCorpseEntityByRef(targetType, targetId) {
  if (!targetType || !targetId) return null;
  if (targetType === 'npc') {
    return npcs.get(targetId) || null;
  }
  if (targetType === 'cop') {
    return cops.get(targetId) || null;
  }
  return null;
}

function getAmbulanceTarget(car) {
  if (!car.ambulanceTargetType || !car.ambulanceTargetId) return null;
  const entity = getCorpseEntityByRef(car.ambulanceTargetType, car.ambulanceTargetId);
  if (!entity) return null;
  return { type: car.ambulanceTargetType, id: car.ambulanceTargetId, entity };
}

function ensureAmbulanceLoad(car) {
  if (!Array.isArray(car.ambulanceLoad)) {
    car.ambulanceLoad = [];
  }
  return car.ambulanceLoad;
}

function clearAmbulanceTarget(car) {
  car.ambulanceTargetType = null;
  car.ambulanceTargetId = null;
}

function releaseAmbulanceTargetClaim(car) {
  const targetRef = getAmbulanceTarget(car);
  if (!targetRef) return;
  const target = targetRef.entity;
  if (target.corpseState === 'down' && target.bodyClaimedBy === car.id) {
    target.bodyClaimedBy = null;
  }
}

function pruneAmbulanceLoad(car) {
  const load = ensureAmbulanceLoad(car);
  const keep = [];
  for (const item of load) {
    if (!item || !item.type || !item.id) continue;
    const entity = getCorpseEntityByRef(item.type, item.id);
    if (!entity || entity.alive) continue;
    if (entity.corpseState !== 'carried' || entity.bodyCarriedBy !== car.id) continue;
    keep.push({ type: item.type, id: item.id });
  }
  car.ambulanceLoad = keep;
  return keep;
}

function resetAmbulanceTask(car) {
  releaseAmbulanceTargetClaim(car);
  clearAmbulanceTarget(car);
  const load = pruneAmbulanceLoad(car);
  car.ambulanceMode = load.length > 0 ? 'to_hospital' : 'idle';
}

function assignAmbulanceTarget(car, targetType, targetId) {
  if (!car || !targetType || !targetId) return;
  if (ensureAmbulanceLoad(car).length >= AMBULANCE_CAPACITY) return;

  const target = getCorpseEntityByRef(targetType, targetId);
  if (!target || target.alive || target.corpseState !== 'down') return;
  if (target.bodyClaimedBy && target.bodyClaimedBy !== car.id) return;

  if (
    car.ambulanceTargetType &&
    car.ambulanceTargetId &&
    (car.ambulanceTargetType !== targetType || car.ambulanceTargetId !== targetId)
  ) {
    releaseAmbulanceTargetClaim(car);
  }

  target.bodyClaimedBy = car.id;
  car.ambulanceTargetType = targetType;
  car.ambulanceTargetId = targetId;
  car.ambulanceMode = 'to_body';
  car.aiCooldown = 0;
}

function findAndAssignNearestAmbulanceTarget(car, maxDistance = Infinity) {
  if (ensureAmbulanceLoad(car).length >= AMBULANCE_CAPACITY) return false;
  const targetRef = nearestAvailableCorpse(car.x, car.y, maxDistance);
  if (!targetRef) return false;
  assignAmbulanceTarget(car, targetRef.type, targetRef.id);
  return !!(car.ambulanceTargetType && car.ambulanceTargetId);
}

function dispatchAmbulanceForCorpse(targetType, entity) {
  if (!entity || entity.alive || entity.corpseState !== 'down') return;

  let best = null;
  let bestScore = Infinity;

  for (const car of cars.values()) {
    if (car.type !== 'ambulance' || car.driverId || !car.npcDriver) continue;
    const load = pruneAmbulanceLoad(car);
    if (load.length >= AMBULANCE_CAPACITY) continue;
    if (car.ambulanceMode === 'to_hospital' && load.length > 0) continue;

    const d2 = wrappedDistanceSq(car.x, car.y, entity.x, entity.y);
    const hasTarget = !!(car.ambulanceTargetType && car.ambulanceTargetId);
    const modePenalty = car.ambulanceMode === 'idle' && !hasTarget ? 0 : hasTarget ? 180000 : 70000;
    const loadPenalty = load.length * 45000;
    const score = d2 + modePenalty + loadPenalty;
    if (score < bestScore) {
      best = car;
      bestScore = score;
    }
  }

  if (!best) {
    best = makeCar('ambulance');
  }
  assignAmbulanceTarget(best, targetType, entity.id);
}

function dispatchAmbulanceForNpc(npc) {
  dispatchAmbulanceForCorpse('npc', npc);
}

function dispatchAmbulanceForCop(cop) {
  dispatchAmbulanceForCorpse('cop', cop);
}

function dropAmbulanceLoadAtCar(car) {
  const load = ensureAmbulanceLoad(car);
  for (const item of load) {
    const entity = getCorpseEntityByRef(item.type, item.id);
    if (!entity || entity.alive) continue;
    if (entity.corpseState !== 'carried' || entity.bodyCarriedBy !== car.id) continue;
    entity.corpseState = 'down';
    entity.bodyCarriedBy = null;
    entity.bodyClaimedBy = null;
    entity.x = car.x;
    entity.y = car.y;
    entity.dir = car.angle;
  }
  car.ambulanceLoad = [];
}

function deliverAmbulanceLoadToHospital(car) {
  const load = ensureAmbulanceLoad(car);
  for (const item of load) {
    const entity = getCorpseEntityByRef(item.type, item.id);
    if (!entity || entity.alive) continue;
    if (entity.corpseState !== 'carried' || entity.bodyCarriedBy !== car.id) continue;
    entity.corpseState = 'reviving';
    entity.bodyCarriedBy = null;
    entity.bodyClaimedBy = null;
    entity.reviveTimer = randRange(3.5, 5.2);
    const release = hospitalReleaseSpawn();
    entity.x = release.x;
    entity.y = release.y;
    entity.dir = Math.PI * 0.5;
    const eventType = item.type === 'cop' ? 'copHospital' : 'npcHospital';
    emitEvent(eventType, { x: entity.x, y: entity.y, victimId: item.id });
  }
  car.ambulanceLoad = [];
}

function stepAmbulanceCar(car, dt) {
  const load = pruneAmbulanceLoad(car);
  if (load.length === 0 && car.ambulanceMode === 'to_hospital') {
    car.ambulanceMode = 'idle';
  }

  if (car.ambulanceMode === 'idle') {
    if (load.length > 0) {
      car.ambulanceMode = 'to_hospital';
    } else {
      const targetRef = getAmbulanceTarget(car);
      const target = targetRef ? targetRef.entity : null;
      if (!target || target.alive || target.corpseState !== 'down') {
        clearAmbulanceTarget(car);
        findAndAssignNearestAmbulanceTarget(car);
      } else {
        car.ambulanceMode = 'to_body';
      }
    }
  }

  const hasActiveWork =
    car.ambulanceMode === 'to_body' || car.ambulanceMode === 'to_hospital' || load.length > 0;
  car.sirenOn = hasActiveWork;

  if (car.ambulanceMode === 'to_body') {
    const targetRef = getAmbulanceTarget(car);
    const target = targetRef ? targetRef.entity : null;
    if (
      !target ||
      target.alive ||
      target.corpseState !== 'down' ||
      (target.bodyClaimedBy && target.bodyClaimedBy !== car.id)
    ) {
      resetAmbulanceTask(car);
      stepTrafficCar(car, dt);
      car.speed = clamp(car.speed, -60, 95);
      return;
    }

    target.bodyClaimedBy = car.id;
    const dist = driveAiToward(car, target.x, target.y, dt, 105, 34);
    if (dist < 18) {
      target.corpseState = 'carried';
      target.bodyCarriedBy = car.id;
      target.bodyClaimedBy = car.id;
      if (!ensureAmbulanceLoad(car).some((item) => item.type === targetRef.type && item.id === target.id)) {
        ensureAmbulanceLoad(car).push({ type: targetRef.type, id: target.id });
      }
      const eventType = targetRef.type === 'cop' ? 'copPickup' : 'npcPickup';
      emitEvent(eventType, { x: target.x, y: target.y, carId: car.id, victimId: target.id });
      clearAmbulanceTarget(car);

      if (ensureAmbulanceLoad(car).length >= AMBULANCE_CAPACITY) {
        car.ambulanceMode = 'to_hospital';
      } else if (!findAndAssignNearestAmbulanceTarget(car, 1500)) {
        car.ambulanceMode = 'to_hospital';
      } else {
        car.ambulanceMode = 'to_body';
      }
    }
    return;
  }

  if (car.ambulanceMode === 'to_hospital') {
    if (ensureAmbulanceLoad(car).length === 0) {
      car.ambulanceMode = 'idle';
      clearAmbulanceTarget(car);
      car.sirenOn = false;
      stepTrafficCar(car, dt);
      car.speed = clamp(car.speed, -60, 95);
      return;
    }

    const dist = driveAiToward(car, HOSPITAL.dropX, HOSPITAL.dropY, dt, 96, 30);
    if (dist < 24) {
      deliverAmbulanceLoadToHospital(car);
      car.ambulanceMode = 'idle';
      clearAmbulanceTarget(car);
      car.aiCooldown = randRange(0.25, 0.95);
      car.sirenOn = false;
    }
    return;
  }

  car.sirenOn = false;
  stepTrafficCar(car, dt);
  car.speed = clamp(car.speed, -60, 95);
}

function pointToSegmentDistanceSq(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 0.0001) {
    const dx = px - x1;
    const dy = py - y1;
    return { distSq: dx * dx + dy * dy, t: 0 };
  }

  let t = ((px - x1) * vx + (py - y1) * vy) / lenSq;
  t = clamp(t, 0, 1);
  const cx = x1 + vx * t;
  const cy = y1 + vy * t;
  const dx = px - cx;
  const dy = py - cy;
  return { distSq: dx * dx + dy * dy, t };
}

function rayIntersectCarDistance(sx, sy, dir, maxDist, car, inflate = 1.2) {
  const toCarX = wrapDelta(car.x - sx, WORLD.width);
  const toCarY = wrapDelta(car.y - sy, WORLD.height);
  const carCenterX = sx + toCarX;
  const carCenterY = sy + toCarY;

  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  const ux = Math.cos(dir);
  const uy = Math.sin(dir);

  // Transform ray to car-local space where the car footprint is axis-aligned.
  const relX = sx - carCenterX;
  const relY = sy - carCenterY;
  const rox = relX * c + relY * s;
  const roy = -relX * s + relY * c;
  const rdx = ux * c + uy * s;
  const rdy = -ux * s + uy * c;

  const halfL = car.width * CAR_COLLISION_HALF_LENGTH_SCALE + inflate;
  const halfW = car.height * CAR_COLLISION_HALF_WIDTH_SCALE + inflate;

  let tMin = 0;
  let tMax = maxDist;
  const eps = 0.000001;

  if (Math.abs(rdx) < eps) {
    if (rox < -halfL || rox > halfL) return null;
  } else {
    let t1 = (-halfL - rox) / rdx;
    let t2 = (halfL - rox) / rdx;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMax < tMin) return null;
  }

  if (Math.abs(rdy) < eps) {
    if (roy < -halfW || roy > halfW) return null;
  } else {
    let t1 = (-halfW - roy) / rdy;
    let t2 = (halfW - roy) / rdy;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMax < tMin) return null;
  }

  if (tMax < 0) return null;
  const tHit = tMin >= 0 ? tMin : tMax;
  if (!Number.isFinite(tHit) || tHit < 0 || tHit > maxDist) return null;
  return tHit;
}

function firstCarBlockDistance(sx, sy, dir, maxDist, ignoreCarId = null) {
  let bestCar = null;
  let bestDist = maxDist;
  for (const car of cars.values()) {
    if (car.destroyed) continue;
    if (ignoreCarId && car.id === ignoreCarId) continue;
    const dist = rayIntersectCarDistance(sx, sy, dir, bestDist, car);
    if (dist == null) continue;
    if (dist < bestDist) {
      bestDist = dist;
      bestCar = car;
    }
  }
  if (!bestCar) return null;
  return { car: bestCar, dist: bestDist };
}

function firstSolidDistance(x, y, dir, maxDist) {
  const step = 6;
  const dx = Math.cos(dir);
  const dy = Math.sin(dir);
  let d = step;
  while (d <= maxDist) {
    const tx = x + dx * d;
    const ty = y + dy * d;
    if (isSolidForPed(tx, ty)) {
      return d;
    }
    d += step;
  }
  return maxDist;
}

function damagePlayer(victim, amount, attacker) {
  if (victim.health <= 0 || victim.insideShopId) return;
  victim.health -= amount;
  victim.hitCooldown = Math.max(victim.hitCooldown, 0.2);
  victim.starCooldown = Math.max(victim.starCooldown, 8);
  emitEvent('impact', { x: victim.x, y: victim.y });
  if (victim.health <= 0) {
    defeatPlayer(victim);
    if (attacker && attacker.id !== victim.id) {
      addStars(attacker, 0.8, 26);
      addCrimeRating(attacker, CRIME_WEIGHTS.player_kill);
      emitEvent('pvpKill', {
        killerId: attacker.id,
        victimId: victim.id,
        x: victim.x,
        y: victim.y,
      });
    }
  }
}

function applyExplosionDamage(x, y, attacker, radius = 72, options = {}) {
  const sourceCarId = options && options.sourceCarId ? options.sourceCarId : null;
  const r2 = radius * radius;

  for (const npc of npcs.values()) {
    if (!npc.alive) continue;
    if (wrappedDistanceSq(x, y, npc.x, npc.y) > r2) continue;
    killNpc(npc, attacker ? attacker.id : null);
  }

  for (const cop of cops.values()) {
    if (!cop.alive) continue;
    if (wrappedDistanceSq(x, y, cop.x, cop.y) > r2) continue;
    damageCop(cop, 999, attacker || null);
  }

  for (const other of players.values()) {
    if (other.health <= 0 || other.insideShopId) continue;
    if (wrappedDistanceSq(x, y, other.x, other.y) > r2) continue;
    damagePlayer(other, 220, attacker || null);
  }

  const carEffectRadius = radius * 1.6;
  const carEffectR2 = carEffectRadius * carEffectRadius;
  for (const car of cars.values()) {
    if (car.destroyed) continue;
    if (sourceCarId && car.id === sourceCarId) continue;
    const dx = wrapDelta(car.x - x, WORLD.width);
    const dy = wrapDelta(car.y - y, WORLD.height);
    const d2 = dx * dx + dy * dy;
    if (d2 > carEffectR2) continue;

    const dist = Math.max(0.0001, Math.sqrt(d2));
    const nx = dx / dist;
    const ny = dy / dist;
    const force = 1 - dist / carEffectRadius;
    const shove = 8 + force * 24;
    const prevX = car.x;
    const prevY = car.y;

    car.x = wrapWorldX(car.x + nx * shove);
    car.y = wrapWorldY(car.y + ny * shove);
    car.angle = angleApproach(car.angle, Math.atan2(ny, nx), 0.5 + force * 0.4);
    car.speed = clamp(car.speed + force * 105, -92, car.maxSpeed);
    enforceCarCollisions(car, prevX, prevY);
    const blastDamage = 50;
    damageCar(car, blastDamage, attacker || null);
  }

  emitEvent('explosion', { x, y, radius });
  emitEvent('impact', { x, y });
}

function fireShot(player, clickAimOverride = null) {
  if (player.health <= 0 || player.inCarId || player.insideShopId) return;
  const weapon = WEAPONS[player.weapon] || WEAPONS.fist;
  if (weapon.pellets <= 0) return;
  if (player.shootCooldown > 0) return;

  player.shootCooldown = weapon.cooldown;

  const dir = player.dir;
  const sx = player.x + Math.cos(dir) * 8;
  const sy = player.y + Math.sin(dir) * 8;

  if (player.weapon === 'bazooka') {
    const targetX = clickAimOverride ? clickAimOverride.x : player.input.aimX;
    const targetY = clickAimOverride ? clickAimOverride.y : player.input.aimY;
    const aimDx = wrapDelta(targetX - sx, WORLD.width);
    const aimDy = wrapDelta(targetY - sy, WORLD.height);
    const aimDir = Math.atan2(aimDy, aimDx);
    const rawDistance = Math.hypot(aimDx, aimDy);
    const requestedDistance = Math.min(rawDistance, weapon.range);
    const clearDistance = firstSolidDistance(sx, sy, aimDir, requestedDistance);
    const finalDistance = Math.min(requestedDistance, clearDistance);
    const ex = wrapWorldX(sx + Math.cos(aimDir) * finalDistance);
    const ey = wrapWorldY(sy + Math.sin(aimDir) * finalDistance);

    emitEvent('bullet', {
      playerId: player.id,
      weapon: player.weapon,
      x: sx,
      y: sy,
      toX: ex,
      toY: ey,
    });
    applyExplosionDamage(ex, ey, player, 72);
    return;
  }

  for (let pellet = 0; pellet < weapon.pellets; pellet++) {
    const pelletDir =
      weapon.type === 'melee' ? dir : dir + randRange(-weapon.spread * 0.5, weapon.spread * 0.5);
    let shotLength = firstSolidDistance(sx, sy, pelletDir, weapon.range);
    const carBlock = firstCarBlockDistance(sx, sy, pelletDir, shotLength);
    if (carBlock) {
      shotLength = carBlock.dist;
    }
    let ex = sx + Math.cos(pelletDir) * shotLength;
    let ey = sy + Math.sin(pelletDir) * shotLength;

    let bestHitType = carBlock ? 'car' : null;
    let bestHit = carBlock ? carBlock.car : null;
    let bestDist = shotLength;

    for (const npc of npcs.values()) {
      if (!npc.alive) continue;

      const hit = pointToSegmentDistanceSq(npc.x, npc.y, sx, sy, ex, ey);
      if (hit.distSq > (NPC_RADIUS + 2) * (NPC_RADIUS + 2)) {
        continue;
      }

      const alongDist = hit.t * shotLength;
      if (alongDist < bestDist) {
        bestDist = alongDist;
        bestHitType = 'npc';
        bestHit = npc;
      }
    }

    for (const other of players.values()) {
      if (other.id === player.id || other.health <= 0 || other.insideShopId) continue;
      const hit = pointToSegmentDistanceSq(other.x, other.y, sx, sy, ex, ey);
      if (hit.distSq > (PLAYER_RADIUS + 2) * (PLAYER_RADIUS + 2)) continue;
      const alongDist = hit.t * shotLength;
      if (alongDist < bestDist) {
        bestDist = alongDist;
        bestHitType = 'player';
        bestHit = other;
      }
    }

    for (const cop of cops.values()) {
      if (!cop.alive || cop.inCarId) continue;
      const hit = pointToSegmentDistanceSq(cop.x, cop.y, sx, sy, ex, ey);
      if (hit.distSq > (COP_RADIUS + 2) * (COP_RADIUS + 2)) continue;
      const alongDist = hit.t * shotLength;
      if (alongDist < bestDist) {
        bestDist = alongDist;
        bestHitType = 'cop';
        bestHit = cop;
      }
    }

    if (bestHit) {
      shotLength = bestDist;
      ex = sx + Math.cos(pelletDir) * shotLength;
      ey = sy + Math.sin(pelletDir) * shotLength;
      if (bestHitType === 'npc') {
        bestHit.health -= weapon.damage;
        bestHit.panicTimer = Math.max(bestHit.panicTimer, 2.7);
        if (bestHit.health <= 0) {
          killNpc(bestHit, player.id);
        }
      } else if (bestHitType === 'player') {
        damagePlayer(bestHit, weapon.damage, player);
      } else if (bestHitType === 'cop') {
        damageCop(bestHit, weapon.damage, player);
      } else if (bestHitType === 'car') {
        damageCar(bestHit, carDamageFromWeapon(player.weapon), player);
        emitEvent('impact', { x: ex, y: ey });
      }
    }

    for (const npc of npcs.values()) {
      if (!npc.alive || npc === bestHit) continue;
      const hit = pointToSegmentDistanceSq(npc.x, npc.y, sx, sy, ex, ey);
      if (hit.distSq < 40 * 40) {
        npc.panicTimer = Math.max(npc.panicTimer, 1.8);
        npc.dir = Math.atan2(npc.y - sy, npc.x - sx);
      }
    }

    if (weapon.type === 'melee') {
      emitEvent('melee', {
        playerId: player.id,
        x: sx,
        y: sy,
        toX: ex,
        toY: ey,
      });
    } else {
      emitEvent('bullet', {
        playerId: player.id,
        weapon: player.weapon,
        x: sx,
        y: sy,
        toX: ex,
        toY: ey,
      });
    }
  }
}

function stepPlayers(dt) {
  for (const player of players.values()) {
    if (player.hitCooldown > 0) {
      player.hitCooldown -= dt;
    }
    if (player.shootCooldown > 0) {
      player.shootCooldown -= dt;
    }

    if (player.health <= 0) {
      tryRespawn(player);
      continue;
    }

    if (player.input.enter && !player.prevEnter) {
      handleEnterOrExit(player);
    }
    player.prevEnter = player.input.enter;

    applyWeaponSelection(player);

    if (player.insideShopId) {
      if (player.starCooldown > 0) {
        player.starCooldown -= dt;
      } else {
        player.starHeat = Math.max(0, player.starHeat - dt * STAR_DECAY_PER_SECOND);
      }
      player.stars = clamp(Math.ceil(player.starHeat - 0.001), 0, 5);
      continue;
    }

    if (!player.inCarId) {
      const dx = player.input.aimX - player.x;
      const dy = player.input.aimY - player.y;
      if (dx * dx + dy * dy > 4) {
        player.dir = Math.atan2(dy, dx);
      }

      movePedestrian(player, dt);
    }

    if (!player.inCarId && player.input.shootSeq > player.lastShootSeq) {
      const pendingShots = Math.min(4, player.input.shootSeq - player.lastShootSeq);
      player.lastShootSeq = player.input.shootSeq;
      for (let i = 0; i < pendingShots; i++) {
        fireShot(player, { x: player.input.clickAimX, y: player.input.clickAimY });
      }
    }
    if (!player.inCarId && player.input.shootHeld && player.weapon === 'machinegun') {
      fireShot(player);
    }

    if (player.starCooldown > 0) {
      player.starCooldown -= dt;
    } else {
      player.starHeat = Math.max(0, player.starHeat - dt * STAR_DECAY_PER_SECOND);
    }

    player.stars = clamp(Math.ceil(player.starHeat - 0.001), 0, 5);
  }
}

function isCarStuckRespawnSuppressed(car) {
  if (!car || car.driverId || !car.npcDriver) return true;
  if (car.type === 'cop' && Array.isArray(car.dismountCopIds) && car.dismountCopIds.length > 0) {
    return true;
  }
  return false;
}

function respawnStuckCarNearRoad(car) {
  const spawn = randomRoadSpawnNear(car.x, car.y);
  car.x = spawn.x;
  car.y = spawn.y;
  car.angle = spawn.angle;
  if (carCollidesSolid(car)) {
    const fallback = randomRoadSpawn();
    car.x = fallback.x;
    car.y = fallback.y;
    car.angle = fallback.angle;
  }
  const cruiseSpeed = carCruiseSpeedByType(car.type);
  car.speed = cruiseSpeed;
  car.aiCooldown = randRange(0.25, 1.15);
  car.stuckTimer = 0;
  car.lastMoveX = car.x;
  car.lastMoveY = car.y;
}

function updateCarStuckState(car, dt) {
  if (!Number.isFinite(car.lastMoveX)) car.lastMoveX = car.x;
  if (!Number.isFinite(car.lastMoveY)) car.lastMoveY = car.y;
  if (!Number.isFinite(car.stuckTimer)) car.stuckTimer = 0;

  if (isCarStuckRespawnSuppressed(car)) {
    car.stuckTimer = 0;
    car.lastMoveX = car.x;
    car.lastMoveY = car.y;
    return;
  }

  const progressSq = wrappedDistanceSq(car.lastMoveX, car.lastMoveY, car.x, car.y);
  const requiredProgressSq = 12 * 12;
  if (progressSq >= requiredProgressSq) {
    car.lastMoveX = car.x;
    car.lastMoveY = car.y;
    car.stuckTimer = 0;
    return;
  }

  car.stuckTimer += dt;
  if (car.stuckTimer >= CAR_STUCK_RESPAWN_SECONDS) {
    respawnStuckCarNearRoad(car);
  }
}

function buildTickLodContext() {
  const blocksX = Math.max(1, Math.floor(WORLD.width / BLOCK_PX));
  const blocksY = Math.max(1, Math.floor(WORLD.height / BLOCK_PX));
  if (!OPT_ZONE_LOD) {
    return { enabled: false, blocksX, blocksY, playerBlocks: [] };
  }

  const playerBlocks = [];
  for (const player of players.values()) {
    if (player.health <= 0 || player.insideShopId) continue;
    playerBlocks.push({
      x: mod(Math.floor(player.x / BLOCK_PX), blocksX),
      y: mod(Math.floor(player.y / BLOCK_PX), blocksY),
    });
  }

  return {
    enabled: true,
    blocksX,
    blocksY,
    playerBlocks,
  };
}

function zoneLevelForPosition(x, y) {
  const ctx = tickLodContext;
  if (!ctx || !ctx.enabled) return 'active';
  if (!ctx.playerBlocks || ctx.playerBlocks.length === 0) return 'cold';

  const bx = mod(Math.floor(x / BLOCK_PX), ctx.blocksX);
  const by = mod(Math.floor(y / BLOCK_PX), ctx.blocksY);
  let best = Infinity;

  for (const p of ctx.playerBlocks) {
    const dxRaw = Math.abs(p.x - bx);
    const dyRaw = Math.abs(p.y - by);
    const dx = Math.min(dxRaw, ctx.blocksX - dxRaw);
    const dy = Math.min(dyRaw, ctx.blocksY - dyRaw);
    const d = Math.max(dx, dy);
    if (d < best) best = d;
  }

  if (best <= 2) return 'active';
  if (best <= 4) return 'warm';
  return 'cold';
}

function lodStepDt(entityId, x, y, dt, warmModulo = 2, coldModulo = 4) {
  if (!OPT_ZONE_LOD) return dt;
  const level = zoneLevelForPosition(x, y);
  if (level === 'active') return dt;

  const phase = idPhase(entityId);
  if (level === 'warm') {
    if ((tickCount + phase) % warmModulo !== 0) return 0;
    return dt * warmModulo;
  }

  if ((tickCount + phase) % coldModulo !== 0) return 0;
  return dt * coldModulo;
}

function stepCars(dt) {
  for (const car of cars.values()) {
    if (car.destroyed) {
      car.destroyedTimer = Math.max(0, (car.destroyedTimer || 0) - dt);
      if (car.destroyedTimer <= 0) {
        const spawn = randomRoadSpawnFarFrom(car.destroyedX || car.x, car.destroyedY || car.y);
        resetCarForRespawn(car, spawn);
        car.speed = carCruiseSpeedByType(car.type);
        car.aiCooldown = randRange(0.25, 1.15);
      }
      continue;
    }

    car.hornCooldown -= dt;
    car.bodyHitCooldown = Math.max(0, (car.bodyHitCooldown || 0) - dt);
    car.dismountCooldown = Math.max(0, (car.dismountCooldown || 0) - dt);

    if (car.driverId) {
      if (car.type === 'cop') {
        pruneCopCarAssignments(car);
        const activeDeployment = Array.isArray(car.dismountCopIds) && car.dismountCopIds.length > 0;
        if (!activeDeployment) {
          resetCopCarDeployment(car);
        }
        car.sirenOn = activeDeployment;
      }
      const driver = players.get(car.driverId);
      if (!driver || driver.health <= 0 || driver.inCarId !== car.id) {
        releaseCarDriver(car);
      } else {
        if (car.type === 'ambulance' && (car.ambulanceMode !== 'idle' || ensureAmbulanceLoad(car).length > 0)) {
          dropAmbulanceLoadAtCar(car);
          resetAmbulanceTask(car);
        }
        if (car.type === 'ambulance') {
          car.sirenOn = false;
        }

        stepDrivenCar(car, driver.input, dt);

        driver.x = car.x;
        driver.y = car.y;
        driver.dir = car.angle;

        if (driver.input.horn && car.hornCooldown <= 0) {
          car.hornCooldown = 0.9;
          emitEvent('horn', { x: car.x, y: car.y, sourcePlayerId: driver.id });
        }
      }
      updateCarStuckState(car, dt);
      continue;
    }

    if (car.npcDriver) {
      if (car.type === 'cop') {
        stepCopCar(car, dt);
      } else if (car.type === 'ambulance') {
        stepAmbulanceCar(car, dt);
      } else {
        const trafficDt = lodStepDt(car.id, car.x, car.y, dt);
        if (trafficDt > 0) {
          stepTrafficCar(car, trafficDt);
        }
      }
      updateCarStuckState(car, dt);
      continue;
    }

    if (car.type === 'cop') {
      pruneCopCarAssignments(car);
      const activeDeployment = Array.isArray(car.dismountCopIds) && car.dismountCopIds.length > 0;
      if (!activeDeployment) {
        resetCopCarDeployment(car);
        car.sirenOn = false;
      } else {
        car.sirenOn = !!car.dismountTargetPlayerId;
      }
    }
    const abandonedDt = car.type === 'civilian' ? lodStepDt(car.id, car.x, car.y, dt) : dt;
    if (abandonedDt > 0) {
      stepAbandonedCar(car, abandonedDt);
    }
    car.abandonTimer += dt;
    const activeCopDeployment = car.type === 'cop' && Array.isArray(car.dismountCopIds) && car.dismountCopIds.length > 0;
    const waitingOwnerReturn = car.stolenFromNpc && car.type !== 'cop';
    if (waitingOwnerReturn) {
      const owner = getLivingOwnerNpcForCar(car);
      if (owner) {
        car.ownerReturnTimer = 0;
        owner.reclaimCarId = car.id;
      }
    }
    const canAutoRecover = !activeCopDeployment && !waitingOwnerReturn;
    if (canAutoRecover && car.abandonTimer > 12) {
      car.npcDriver = true;
      car.stolenFromNpc = false;
      car.ownerNpcId = null;
      car.ownerReturnTimer = 0;
      car.abandonTimer = 0;
      car.aiCooldown = randRange(0.3, 1.3);
      car.speed = Math.max(car.speed, 40);
    }
    updateCarStuckState(car, dt);
  }
}

function stepCarHitsByCars(ctx = tickSpatialContext) {
  const list = Array.isArray(ctx?.cars) ? ctx.cars : Array.from(cars.values()).filter((car) => !car.destroyed);
  const grid = ctx?.carGrid || (() => {
    const g = makeSpatialGrid(COLLISION_GRID_CELL);
    for (const car of list) {
      spatialInsert(g, car);
    }
    return g;
  })();

  const pairSeen = new Set();
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const neighbors = spatialQueryNeighbors(grid, a.x, a.y);
    for (const b of neighbors) {
      if (!b || b.id === a.id) continue;
      const aId = String(a.id);
      const bId = String(b.id);
      const pairKey = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
      if (pairSeen.has(pairKey)) continue;
      pairSeen.add(pairKey);

      const dx = wrapDelta(b.x - a.x, WORLD.width);
      const dy = wrapDelta(b.y - a.y, WORLD.height);
      const minDist = (a.width + b.width) * 0.42;
      const distSq = dx * dx + dy * dy;
      if (distSq > minDist * minDist) continue;

      const dist = Math.max(0.0001, Math.sqrt(distSq));
      const nx = dx / dist;
      const ny = dy / dist;
      const penetration = Math.max(0, minDist - dist);

      if (penetration > 0) {
        const push = penetration * 0.55;
        const aPrevX = a.x;
        const aPrevY = a.y;
        const bPrevX = b.x;
        const bPrevY = b.y;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        enforceCarCollisions(a, aPrevX, aPrevY);
        enforceCarCollisions(b, bPrevX, bPrevY);
      }

      const avx = Math.cos(a.angle) * a.speed;
      const avy = Math.sin(a.angle) * a.speed;
      const bvx = Math.cos(b.angle) * b.speed;
      const bvy = Math.sin(b.angle) * b.speed;
      const relAlong = (bvx - avx) * nx + (bvy - avy) * ny;
      if (relAlong >= -6 && penetration < 0.6) continue;

      const hit = Math.abs(relAlong);
      const transfer = clamp(0.26 + hit / 210, 0.26, 0.52);
      const aOldSpeed = a.speed;
      const bOldSpeed = b.speed;
      a.speed = clamp((aOldSpeed * (1 - transfer) + bOldSpeed * transfer) * 0.82, -92, a.maxSpeed);
      b.speed = clamp((bOldSpeed * (1 - transfer) + aOldSpeed * transfer) * 0.82, -92, b.maxSpeed);

      const turn = 0.1 + transfer * 0.18;
      a.angle = angleApproach(a.angle, Math.atan2(-ny, -nx), turn);
      b.angle = angleApproach(b.angle, Math.atan2(ny, nx), turn);

      if (hit > 18 && a.bodyHitCooldown <= 0 && b.bodyHitCooldown <= 0) {
        a.bodyHitCooldown = 0.16;
        b.bodyHitCooldown = 0.16;
        emitEvent('impact', { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 });
      }
    }
  }
}

function stepPlayerHits(ctx = tickSpatialContext) {
  for (const player of players.values()) {
    if (player.health <= 0 || player.inCarId || player.hitCooldown > 0 || player.insideShopId) {
      continue;
    }

    const nearbyCars = ctx?.carGrid ? spatialQueryNeighbors(ctx.carGrid, player.x, player.y) : cars.values();
    for (const car of nearbyCars) {
      if (car.destroyed) continue;
      if (car.type === 'cop' && !car.driverId) {
        continue;
      }
      const impactSpeed = Math.abs(car.speed);
      if (impactSpeed < 38) continue;

      const dx = wrapDelta(car.x - player.x, WORLD.width);
      const dy = wrapDelta(car.y - player.y, WORLD.height);
      const hitRadius = 14;
      if (dx * dx + dy * dy > hitRadius * hitRadius) {
        continue;
      }

      const damage = clamp(impactSpeed * 0.62, 16, 78);
      player.health -= damage;
      player.hitCooldown = 0.7;
      emitEvent('impact', { x: player.x, y: player.y });

      if (car.driverId && car.driverId !== player.id) {
        const offender = players.get(car.driverId);
        if (offender) {
          addStars(offender, 0.45, 20);
          addCrimeRating(offender, CRIME_WEIGHTS.vehicular_assault);
        }
      }

      if (player.health <= 0) {
        defeatPlayer(player);
      }
      break;
    }
  }
}

function stepNpcs(dt) {
  const cardinal = [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5];

  function stepNpcReclaimCar(npc, stepDt) {
    if (!npc.reclaimCarId) return false;

    const car = cars.get(npc.reclaimCarId);
    if (!car || car.destroyed || !car.stolenFromNpc || car.type === 'cop') {
      npc.reclaimCarId = null;
      return false;
    }
    if (car.npcDriver) {
      npc.reclaimCarId = null;
      return false;
    }

    const dx = wrapDelta(car.x - npc.x, WORLD.width);
    const dy = wrapDelta(car.y - npc.y, WORLD.height);
    const dist = Math.hypot(dx, dy);
    const desired = Math.atan2(dy, dx);
    npc.dir = angleApproach(npc.dir, desired, stepDt * 5.8);
    npc.panicTimer = Math.max(npc.panicTimer, 0.2);
    npc.crossingTimer = Math.max(npc.crossingTimer, 0.35);

    const speed = Math.max(npc.baseSpeed + 30, 72);
    const nx = wrapWorldX(npc.x + Math.cos(npc.dir) * speed * stepDt);
    const ny = wrapWorldY(npc.y + Math.sin(npc.dir) * speed * stepDt);

    if (!isSolidForPed(nx, npc.y)) {
      npc.x = nx;
    } else {
      npc.dir += randRange(0.5, 1.25);
      npc.wanderTimer = Math.min(npc.wanderTimer, 0.2);
    }
    if (!isSolidForPed(npc.x, ny)) {
      npc.y = ny;
    } else {
      npc.dir -= randRange(0.5, 1.25);
      npc.wanderTimer = Math.min(npc.wanderTimer, 0.2);
    }

    if (!car.driverId && dist < 18) {
      car.npcDriver = true;
      car.stolenFromNpc = false;
      car.ownerNpcId = null;
      car.ownerReturnTimer = 0;
      car.occupantNpcIds = [];
      car.abandonTimer = 0;
      car.aiCooldown = randRange(0.25, 1.0);
      car.speed = Math.max(car.speed, 38);
      npc.reclaimCarId = null;
      respawnNpc(npc);
      return true;
    }

    return true;
  }

  function chooseCrossingDirection(npc) {
    const info = roadInfoAt(npc.x, npc.y);
    if (info.inVerticalRoad && !info.inHorizontalRoad) {
      return Math.random() < 0.5 ? 0 : Math.PI;
    }
    if (info.inHorizontalRoad && !info.inVerticalRoad) {
      return Math.random() < 0.5 ? Math.PI * 0.5 : -Math.PI * 0.5;
    }

    const localX = mod(npc.x, BLOCK_PX);
    const localY = mod(npc.y, BLOCK_PX);
    const distV = Math.min(Math.abs(localX - ROAD_START), Math.abs(localX - ROAD_END));
    const distH = Math.min(Math.abs(localY - ROAD_START), Math.abs(localY - ROAD_END));
    if (distV < distH) {
      return Math.random() < 0.5 ? 0 : Math.PI;
    }
    return Math.random() < 0.5 ? Math.PI * 0.5 : -Math.PI * 0.5;
  }

  function steerAwayFromRoad(npc) {
    const probes = [16, 28, 40, 56];
    for (const dist of probes) {
      for (const dir of cardinal) {
        const tx = npc.x + Math.cos(dir) * dist;
        const ty = npc.y + Math.sin(dir) * dist;
        if (isPreferredPedGround(groundTypeAt(tx, ty))) {
          npc.dir = dir + randRange(-0.22, 0.22);
          npc.wanderTimer = Math.min(npc.wanderTimer, 0.3);
          return;
        }
      }
    }
    npc.dir += randRange(1.1, 2.4);
  }

  for (const npc of npcs.values()) {
    if (!npc.alive) {
      if (npc.corpseState === 'down') {
        npc.corpseDownTimer = (npc.corpseDownTimer || 0) + dt;
        if (npc.corpseDownTimer >= NPC_HOSPITAL_FALLBACK_SECONDS) {
          const claimedByCar = npc.bodyClaimedBy ? cars.get(npc.bodyClaimedBy) : null;
          if (claimedByCar && claimedByCar.type === 'ambulance') {
            resetAmbulanceTask(claimedByCar);
          }
          npc.bodyClaimedBy = null;
          npc.bodyCarriedBy = null;
          const release = hospitalReleaseSpawn();
          respawnNpc(npc, release);
          emitEvent('npcHospital', {
            x: release.x,
            y: release.y,
            victimId: npc.id,
            fallback: true,
          });
        }
      } else if (npc.corpseState === 'carried') {
        const carrier = npc.bodyCarriedBy ? cars.get(npc.bodyCarriedBy) : null;
        if (carrier && carrier.type === 'ambulance' && !carrier.destroyed) {
          npc.x = carrier.x;
          npc.y = carrier.y;
          npc.dir = carrier.angle;
        } else {
          npc.corpseState = 'down';
          npc.bodyCarriedBy = null;
          npc.bodyClaimedBy = null;
          npc.corpseDownTimer = 0;
        }
      } else if (npc.corpseState === 'reviving') {
        npc.reviveTimer -= dt;
        if (npc.reviveTimer <= 0) {
          respawnNpc(npc, hospitalReleaseSpawn());
        }
      }
      continue;
    }

    const npcDt = lodStepDt(npc.id, npc.x, npc.y, dt);
    if (npcDt <= 0) {
      continue;
    }

    if (stepNpcReclaimCar(npc, npcDt)) {
      wrapWorldPosition(npc);
      continue;
    }

    if (npc.panicTimer > 0) {
      npc.panicTimer -= npcDt;
    }
    if (npc.crossingTimer > 0) {
      npc.crossingTimer -= npcDt;
    }

    npc.wanderTimer -= npcDt;
    if (npc.wanderTimer <= 0) {
      npc.wanderTimer = randRange(0.5, 2.1);
      npc.dir += randRange(-1.2, 1.2);
      npc.baseSpeed = randRange(28, 45);
      if (npc.panicTimer <= 0 && Math.random() < 0.18) {
        npc.crossingTimer = randRange(0.9, 1.5);
        npc.dir = chooseCrossingDirection(npc);
      }
    }

    const speed = npc.baseSpeed + (npc.panicTimer > 0 ? 46 : 0) + (npc.crossingTimer > 0 ? 8 : 0);
    const nx = npc.x + Math.cos(npc.dir) * speed * npcDt;
    const ny = npc.y + Math.sin(npc.dir) * speed * npcDt;

    const nextGround = groundTypeAt(nx, ny);
    if (npc.panicTimer <= 0 && npc.crossingTimer <= 0 && nextGround === 'road') {
      steerAwayFromRoad(npc);
      continue;
    }

    if (!isSolidForPed(nx, npc.y)) {
      npc.x = nx;
    } else {
      npc.dir += randRange(0.8, 1.8);
      npc.wanderTimer = Math.min(npc.wanderTimer, 0.2);
    }

    if (!isSolidForPed(npc.x, ny)) {
      npc.y = ny;
    } else {
      npc.dir -= randRange(0.8, 1.8);
      npc.wanderTimer = Math.min(npc.wanderTimer, 0.2);
    }

    if (npc.panicTimer <= 0 && npc.crossingTimer <= 0 && groundTypeAt(npc.x, npc.y) === 'road') {
      steerAwayFromRoad(npc);
    }

    wrapWorldPosition(npc);
  }
}

function moveCop(cop, dir, speed, dt) {
  cop.dir = angleApproach(cop.dir, dir, dt * 5.4);
  const nx = cop.x + Math.cos(cop.dir) * speed * dt;
  const ny = cop.y + Math.sin(cop.dir) * speed * dt;
  if (!isSolidForPed(nx, cop.y)) cop.x = nx;
  if (!isSolidForPed(cop.x, ny)) cop.y = ny;
  wrapWorldPosition(cop);
}

function moveCopCombat(cop, target, dt) {
  const toTarget = wrappedVector(cop.x, cop.y, target.x, target.y);
  const dist = toTarget.dist;
  if (dist <= 0.001) return;

  const toward = Math.atan2(toTarget.dy, toTarget.dx);
  if (!Number.isFinite(cop.combatStrafeDir) || cop.combatStrafeDir === 0) {
    cop.combatStrafeDir = Math.random() < 0.5 ? -1 : 1;
  }
  cop.combatStrafeTimer = Number.isFinite(cop.combatStrafeTimer) ? cop.combatStrafeTimer - dt : 0;
  if (cop.combatStrafeTimer <= 0) {
    cop.combatStrafeTimer = randRange(0.7, 1.6);
    if (Math.random() < 0.5) {
      cop.combatStrafeDir *= -1;
    }
  }

  if (dist > COP_COMBAT_STANDOFF_MAX) {
    moveCop(cop, toward, 92, dt);
    return;
  }
  if (dist < COP_COMBAT_STANDOFF_MIN) {
    moveCop(cop, angleWrap(toward + Math.PI), 84, dt);
    return;
  }

  const strafeBase = angleWrap(toward + cop.combatStrafeDir * Math.PI * 0.5);
  const rangeBias = clamp((dist - COP_COMBAT_STANDOFF_PIVOT) / 64, -0.22, 0.22);
  const strafeDir = angleWrap(strafeBase + rangeBias + randRange(-0.08, 0.08));
  moveCop(cop, strafeDir, 56, dt);
}

function shootAtTargetFromCop(cop, target) {
  const toTarget = wrappedVector(cop.x, cop.y, target.x, target.y);
  const dist = toTarget.dist;
  if (dist >= 230 || cop.cooldown > 0) return;

  cop.cooldown = randRange(0.52, 0.86);
  const aim = Math.atan2(toTarget.dy, toTarget.dx) + randRange(-0.06, 0.06);
  let maxDist = Math.min(250, firstSolidDistance(cop.x, cop.y, aim, 250));
  const carBlock = firstCarBlockDistance(cop.x, cop.y, aim, maxDist, cop.inCarId || null);
  if (carBlock) {
    maxDist = Math.min(maxDist, carBlock.dist);
  }
  const ex = wrapWorldX(cop.x + Math.cos(aim) * maxDist);
  const ey = wrapWorldY(cop.y + Math.sin(aim) * maxDist);
  const directDist = toTarget.dist;
  if (!target.inCarId && directDist <= maxDist + 4) {
    damagePlayer(target, 15, null);
  }
  if (carBlock && carBlock.dist <= maxDist + 0.01) {
    damageCar(carBlock.car, carDamageFromWeapon('pistol'), null);
    emitEvent('impact', { x: ex, y: ey });
  }
  emitEvent('bullet', {
    playerId: `cop_${cop.id}`,
    weapon: 'pistol',
    x: cop.x,
    y: cop.y,
    toX: ex,
    toY: ey,
  });
}

function stepCops(dt) {
  for (const cop of cops.values()) {
    cop.cooldown -= dt;
    cop.patrolTimer -= dt;
    cop.alertTimer = Math.max(0, (cop.alertTimer || 0) - dt);

    if (!cop.alive) {
      if (cop.corpseState === 'down') {
        cop.corpseDownTimer = (cop.corpseDownTimer || 0) + dt;
        if (cop.corpseDownTimer >= COP_HOSPITAL_FALLBACK_SECONDS) {
          const claimedByCar = cop.bodyClaimedBy ? cars.get(cop.bodyClaimedBy) : null;
          if (claimedByCar && claimedByCar.type === 'ambulance') {
            resetAmbulanceTask(claimedByCar);
          }
          cop.bodyClaimedBy = null;
          cop.bodyCarriedBy = null;
          const release = hospitalReleaseSpawn();
          respawnCop(cop, release, true);
          emitEvent('copHospital', {
            x: release.x,
            y: release.y,
            victimId: cop.id,
            fallback: true,
          });
        }
      } else if (cop.corpseState === 'carried') {
        const carrier = cop.bodyCarriedBy ? cars.get(cop.bodyCarriedBy) : null;
        if (carrier && carrier.type === 'ambulance' && !carrier.destroyed) {
          cop.x = carrier.x;
          cop.y = carrier.y;
          cop.dir = carrier.angle;
        } else {
          cop.corpseState = 'down';
          cop.bodyCarriedBy = null;
          cop.bodyClaimedBy = null;
          cop.corpseDownTimer = 0;
        }
      } else if (cop.corpseState === 'reviving') {
        cop.reviveTimer -= dt;
        if (cop.reviveTimer <= 0) {
          respawnCop(cop, hospitalReleaseSpawn(), true);
        }
      }
      continue;
    }

    if (cop.inCarId) {
      const car = cars.get(cop.inCarId);
      if (!car || car.type !== 'cop' || car.destroyed) {
        cop.inCarId = null;
      } else {
        cop.x = car.x;
        cop.y = car.y;
        cop.dir = car.angle;
        continue;
      }
    }

    if (cop.assignedCarId) {
      const car = cars.get(cop.assignedCarId);
      if (!car || car.type !== 'cop' || car.destroyed) {
        cop.assignedCarId = null;
        cop.mode = 'patrol';
        cop.targetPlayerId = null;
      } else {
        let target = car.dismountTargetPlayerId ? players.get(car.dismountTargetPlayerId) : null;
        if (
          !target ||
          target.health <= 0 ||
          target.stars < 5 ||
          target.insideShopId ||
          wrappedDistanceSq(car.x, car.y, target.x, target.y) > COP_CAR_RECALL_RADIUS * COP_CAR_RECALL_RADIUS
        ) {
          target = null;
        }

        if (target) {
          if (cop.rejoinCarId && cop.assignedCarId === cop.rejoinCarId) {
            cop.mode = 'return';
            cop.targetPlayerId = null;
            moveCop(cop, wrappedDirection(cop.x, cop.y, car.x, car.y), 106, dt);
          } else {
            cop.mode = 'hunt';
            cop.targetPlayerId = target.id;
            moveCopCombat(cop, target, dt);
            shootAtTargetFromCop(cop, target);
          }
        } else {
          cop.mode = 'return';
          cop.targetPlayerId = null;
          moveCop(cop, wrappedDirection(cop.x, cop.y, car.x, car.y), 106, dt);
        }

        const closeToCar = wrappedDistanceSq(cop.x, cop.y, car.x, car.y) < 16 * 16;
        const mustRejoin = !!(cop.rejoinCarId && cop.assignedCarId === cop.rejoinCarId);
        if (closeToCar && (!target || mustRejoin)) {
          cop.inCarId = car.id;
          car.npcDriver = true;
          car.stolenFromNpc = false;
          car.abandonTimer = 0;
          cop.rejoinCarId = null;
          cop.mode = 'in_car';
          cop.targetPlayerId = null;
          cop.cooldown = randRange(0.22, 0.6);
          removeCopFromAssignedCar(cop);
        }

        wrapWorldPosition(cop);
        continue;
      }
    }

    const target = nearestFiveStarPlayer(cop.x, cop.y);
    if (target) {
      cop.mode = 'hunt';
      cop.targetPlayerId = target.id;
      moveCopCombat(cop, target, dt);
      shootAtTargetFromCop(cop, target);
    } else {
      const patrolDt = lodStepDt(cop.id, cop.x, cop.y, dt, 2, 3);
      if (patrolDt <= 0) {
        continue;
      }
      cop.mode = 'patrol';
      cop.targetPlayerId = null;
      if (cop.patrolTimer <= 0) {
        cop.patrolTimer = randRange(0.6, 1.7);
        cop.dir += randRange(-1.3, 1.3);
      }
      moveCop(cop, cop.dir, 56, patrolDt);
    }

    wrapWorldPosition(cop);
  }
}

function maybeEmitCopTriggerAlerts() {
  for (const player of players.values()) {
    if (player.health <= 0 || player.stars < 5) {
      player.copAlertPlayed = false;
      continue;
    }
    if (player.copAlertPlayed) {
      continue;
    }

    let triggerX = player.x;
    let triggerY = player.y;
    let bestDistSq = Infinity;
    let triggered = false;

    for (const cop of cops.values()) {
      if (!cop.alive || cop.inCarId) continue;
      if (cop.mode !== 'hunt' || cop.targetPlayerId !== player.id) continue;
      const d2 = wrappedDistanceSq(cop.x, cop.y, player.x, player.y);
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        triggerX = cop.x;
        triggerY = cop.y;
      }
      triggered = true;
    }

    for (const car of cars.values()) {
      if (car.type !== 'cop' || !!car.driverId || !car.sirenOn) continue;
      let trackingPlayer = false;
      if (car.dismountTargetPlayerId) {
        trackingPlayer = car.dismountTargetPlayerId === player.id;
      } else {
        const target = nearestFiveStarPlayer(car.x, car.y);
        trackingPlayer = !!(target && target.id === player.id);
      }
      if (!trackingPlayer) continue;
      const d2 = wrappedDistanceSq(car.x, car.y, player.x, player.y);
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        triggerX = car.x;
        triggerY = car.y;
      }
      triggered = true;
    }

    if (!triggered) {
      continue;
    }

    emitEvent('copWitness', {
      playerId: player.id,
      x: triggerX,
      y: triggerY,
    });
    player.copAlertPlayed = true;
  }
}

function makeSpatialGrid(cellSize = COLLISION_GRID_CELL) {
  const cellsX = Math.max(1, Math.ceil(WORLD.width / cellSize));
  const cellsY = Math.max(1, Math.ceil(WORLD.height / cellSize));
  return { map: new Map(), cellSize, cellsX, cellsY };
}

function spatialKey(cx, cy, cellsX) {
  return cy * cellsX + cx;
}

function spatialInsert(grid, entity) {
  if (!grid || !entity) return;
  const cx = mod(Math.floor(entity.x / grid.cellSize), grid.cellsX);
  const cy = mod(Math.floor(entity.y / grid.cellSize), grid.cellsY);
  const key = spatialKey(cx, cy, grid.cellsX);
  let bucket = grid.map.get(key);
  if (!bucket) {
    bucket = [];
    grid.map.set(key, bucket);
  }
  bucket.push(entity);
}

function spatialQueryNeighbors(grid, x, y) {
  const result = [];
  if (!grid) return result;
  const baseX = mod(Math.floor(x / grid.cellSize), grid.cellsX);
  const baseY = mod(Math.floor(y / grid.cellSize), grid.cellsY);
  for (let oy = -1; oy <= 1; oy += 1) {
    const cy = mod(baseY + oy, grid.cellsY);
    for (let ox = -1; ox <= 1; ox += 1) {
      const cx = mod(baseX + ox, grid.cellsX);
      const bucket = grid.map.get(spatialKey(cx, cy, grid.cellsX));
      if (!bucket || bucket.length === 0) continue;
      result.push(...bucket);
    }
  }
  return result;
}

function buildTickSpatialContext() {
  const carGrid = makeSpatialGrid(COLLISION_GRID_CELL);
  const impactCarGrid = makeSpatialGrid(COLLISION_GRID_CELL);
  const allCars = [];
  const impactCars = [];

  for (const car of cars.values()) {
    if (car.destroyed) continue;
    allCars.push(car);
    spatialInsert(carGrid, car);
    if (Math.abs(car.speed) >= 46) {
      impactCars.push(car);
      spatialInsert(impactCarGrid, car);
    }
  }

  const corpses = [];
  for (const npc of npcs.values()) {
    if (!npc.alive && npc.corpseState === 'down' && !npc.bodyClaimedBy) {
      corpses.push({ type: 'npc', id: npc.id, entity: npc });
    }
  }
  for (const cop of cops.values()) {
    if (!cop.alive && cop.corpseState === 'down' && !cop.bodyClaimedBy) {
      corpses.push({ type: 'cop', id: cop.id, entity: cop });
    }
  }

  return {
    cars: allCars,
    carGrid,
    impactCars,
    impactCarGrid,
    corpses,
  };
}

function stepNpcHitsByCars(ctx = tickSpatialContext) {
  const impactCars = Array.isArray(ctx?.impactCars) ? ctx.impactCars : [];
  if (impactCars.length === 0) return;
  const impactGrid = ctx?.impactCarGrid;

  for (const npc of npcs.values()) {
    if (!npc.alive) continue;

    const nearbyCars = impactGrid ? spatialQueryNeighbors(impactGrid, npc.x, npc.y) : impactCars;
    for (const car of nearbyCars) {
      const dx = wrapDelta(car.x - npc.x, WORLD.width);
      const dy = wrapDelta(car.y - npc.y, WORLD.height);
      if (dx * dx + dy * dy > 13 * 13) continue;

      if (!car.driverId) {
        npc.panicTimer = Math.max(npc.panicTimer, 1.8);
        npc.dir = Math.atan2(npc.y - car.y, npc.x - car.x);
        emitEvent('impact', { x: npc.x, y: npc.y });
        break;
      }

      killNpc(npc, car.driverId);
      emitEvent('impact', { x: npc.x, y: npc.y });
      break;
    }
  }
}

function stepCopHitsByCars(ctx = tickSpatialContext) {
  const impactCars = Array.isArray(ctx?.impactCars) ? ctx.impactCars : [];
  if (impactCars.length === 0) return;
  const impactGrid = ctx?.impactCarGrid;

  for (const cop of cops.values()) {
    if (!cop.alive || cop.inCarId) continue;

    const nearbyCars = impactGrid ? spatialQueryNeighbors(impactGrid, cop.x, cop.y) : impactCars;
    for (const car of nearbyCars) {
      const dx = wrapDelta(car.x - cop.x, WORLD.width);
      const dy = wrapDelta(car.y - cop.y, WORLD.height);
      if (dx * dx + dy * dy > 13 * 13) continue;

      if (!car.driverId) {
        emitEvent('impact', { x: cop.x, y: cop.y });
        break;
      }

      const driver = players.get(car.driverId) || null;
      killCop(cop, driver);
      emitEvent('impact', { x: cop.x, y: cop.y });
      break;
    }
  }
}

function stepCashDrops(dt) {
  for (const drop of cashDrops.values()) {
    drop.ttl -= dt;
    drop.pickupDelay -= dt;
    if (drop.ttl <= 0) {
      cashDrops.delete(drop.id);
      continue;
    }

    drop.x += drop.vx * dt;
    drop.y += drop.vy * dt;
    drop.vx *= Math.pow(0.55, dt * 8);
    drop.vy *= Math.pow(0.55, dt * 8);
    drop.x = wrapWorldX(drop.x);
    drop.y = wrapWorldY(drop.y);

    if (drop.pickupDelay > 0) {
      continue;
    }

    for (const player of players.values()) {
      if (player.health <= 0 || player.insideShopId) continue;
      const dx = player.x - drop.x;
      const dy = player.y - drop.y;
      if (dx * dx + dy * dy > DROP_PICKUP_RADIUS * DROP_PICKUP_RADIUS) continue;

      player.money += drop.amount;
      emitEvent('cashPickup', {
        playerId: player.id,
        amount: drop.amount,
        total: player.money,
        x: drop.x,
        y: drop.y,
      });
      cashDrops.delete(drop.id);
      break;
    }
  }
}

function stepBloodStains(dt) {
  for (const stain of bloodStains.values()) {
    stain.ttl -= dt;
    if (stain.ttl <= 0) {
      if (OPT_CLIENT_VFX) {
        emitEvent('bloodRemove', { stainId: stain.id, x: stain.x, y: stain.y });
      }
      bloodStains.delete(stain.id);
    }
  }
}

function resetAmbientSceneWhenEmpty() {
  if (players.size > 0) return;

  for (const car of cars.values()) {
    if (car.type === 'ambulance') {
      dropAmbulanceLoadAtCar(car);
      resetAmbulanceTask(car);
      car.sirenOn = false;
    } else if (car.type === 'cop') {
      resetCopCarDeployment(car);
    }
  }

  for (const npc of npcs.values()) {
    if (!npc.alive) {
      respawnNpc(npc);
    }
  }

  for (const cop of cops.values()) {
    if (!cop.alive) {
      respawnCop(cop, hospitalReleaseSpawn(), true);
      continue;
    }
    cop.targetPlayerId = null;
    cop.alertTimer = 0;
    if (cop.inCarId) {
      cop.mode = 'in_car';
      continue;
    }
    if (cop.assignedCarId) {
      cop.mode = 'return';
      continue;
    }
    cop.mode = 'patrol';
  }

  if (bloodStains.size > 0) {
    if (OPT_CLIENT_VFX) {
      for (const stain of bloodStains.values()) {
        emitEvent('bloodRemove', { stainId: stain.id, x: stain.x, y: stain.y });
      }
    }
    bloodStains.clear();
  }
}

function ensureCarPopulation() {
  let civilian = 0;
  let cop = 0;
  let ambulance = 0;
  for (const car of cars.values()) {
    if (car.type === 'cop') {
      cop += 1;
    } else if (car.type === 'ambulance') {
      ambulance += 1;
    } else {
      civilian += 1;
    }
  }

  while (civilian < TRAFFIC_COUNT) {
    makeCar('civilian');
    civilian += 1;
  }
  while (cop < COP_COUNT) {
    makeCar('cop');
    cop += 1;
  }
  while (ambulance < AMBULANCE_COUNT) {
    makeCar('ambulance');
    ambulance += 1;
  }
}

function ensureNpcPopulation() {
  while (npcs.size < NPC_COUNT) {
    makeNpc();
  }
}

function ensureCopPopulation() {
  while (cops.size < COP_OFFICER_COUNT) {
    makeCopUnit();
  }
}

function targetCrewSizePerCopCar(copCarCount) {
  if (copCarCount <= 0 || COP_OFFICER_COUNT <= 0) return 0;
  const desired = clamp(COP_CAR_DEFAULT_CREW_SIZE, 1, 2);
  const byPool = Math.floor(COP_OFFICER_COUNT / copCarCount);
  return clamp(Math.min(desired, Math.max(1, byPool)), 1, 2);
}

function assignCopToHomeCar(cop, car) {
  if (!cop || !car || car.type !== 'cop' || car.destroyed) return false;
  cop.homeCarId = car.id;
  cop.assignedCarId = car.id;
  if (!cop.rejoinCarId && !cop.alive) {
    cop.rejoinCarId = car.id;
  }
  if (cop.alive && !cop.inCarId) {
    if (!car.driverId && car.npcDriver) {
      cop.inCarId = car.id;
      cop.mode = 'in_car';
      cop.targetPlayerId = null;
      cop.x = car.x;
      cop.y = car.y;
      cop.dir = car.angle;
    } else {
      cop.mode = 'return';
      cop.targetPlayerId = null;
    }
  }
  return true;
}

function ensureCopCarCrews() {
  const copCars = [];
  for (const car of cars.values()) {
    if (car.type !== 'cop' || car.destroyed) continue;
    if (!Array.isArray(car.crewCopIds)) {
      car.crewCopIds = [];
    }
    copCars.push(car);
  }
  if (copCars.length === 0) return;

  for (const cop of cops.values()) {
    if (!cop.homeCarId) continue;
    const oldHomeCarId = cop.homeCarId;
    const homeCar = cars.get(cop.homeCarId);
    if (!homeCar || homeCar.type !== 'cop') {
      cop.homeCarId = null;
      if (!cop.assignedCarId || cop.assignedCarId === oldHomeCarId) {
        cop.assignedCarId = null;
      }
      if (cop.rejoinCarId && cop.rejoinCarId === oldHomeCarId) {
        cop.rejoinCarId = null;
      }
    }
  }

  const assigned = new Set();
  for (const car of copCars) {
    const nextCrew = [];
    for (const copId of car.crewCopIds) {
      const cop = cops.get(copId);
      if (!cop) continue;
      if (cop.homeCarId && cop.homeCarId !== car.id) continue;
      if (assigned.has(cop.id)) continue;
      cop.homeCarId = car.id;
      nextCrew.push(cop.id);
      assigned.add(cop.id);
    }
    car.crewCopIds = nextCrew;
  }

  const targetCrewSize = targetCrewSizePerCopCar(copCars.length);
  if (targetCrewSize <= 0) return;

  const freeCops = [];
  for (const cop of cops.values()) {
    if (assigned.has(cop.id)) continue;
    if (cop.homeCarId) continue;
    freeCops.push(cop);
  }

  for (const car of copCars) {
    while (car.crewCopIds.length < targetCrewSize && freeCops.length > 0) {
      const cop = freeCops.shift();
      if (!assignCopToHomeCar(cop, car)) continue;
      car.crewCopIds.push(cop.id);
      assigned.add(cop.id);
    }
  }

  for (const car of copCars) {
    for (const copId of car.crewCopIds) {
      const cop = cops.get(copId);
      if (!cop) continue;
      const isDeployedFromThisCar =
        Array.isArray(car.dismountCopIds) && car.dismountCopIds.includes(cop.id);
      if (cop.homeCarId !== car.id) {
        cop.homeCarId = car.id;
      }
      if (!cop.alive) {
        if (!cop.assignedCarId) cop.assignedCarId = car.id;
        if (!cop.rejoinCarId) cop.rejoinCarId = car.id;
        continue;
      }
      if (cop.inCarId && cop.inCarId !== car.id) {
        cop.inCarId = null;
      }
      const canSeatInReserve = !car.driverId && car.npcDriver;
      const returningToThisCar = cop.rejoinCarId === car.id && cop.mode === 'return';
      const idleReserveCop = !isDeployedFromThisCar && cop.mode !== 'hunt' && !cop.targetPlayerId;
      if (canSeatInReserve && (returningToThisCar || idleReserveCop)) {
        cop.inCarId = car.id;
        cop.mode = 'in_car';
        cop.targetPlayerId = null;
        cop.x = car.x;
        cop.y = car.y;
        cop.dir = car.angle;
        cop.rejoinCarId = null;
        removeCopFromAssignedCar(cop);
        continue;
      }
      if (!cop.assignedCarId && !cop.inCarId) {
        cop.assignedCarId = car.id;
        cop.mode = 'return';
        cop.targetPlayerId = null;
      }
      if (cop.inCarId === car.id) {
        cop.x = car.x;
        cop.y = car.y;
        cop.dir = car.angle;
      }
    }
  }
}

function serializePlayerForSnapshot(player, now) {
  const hasChat = typeof player.chatUntil === 'number' && player.chatUntil > now && !!player.chatText;
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    x: quantized(player.x, 100),
    y: quantized(player.y, 100),
    dir: quantized(player.dir, 1000),
    inCarId: player.inCarId,
    insideShopId: player.insideShopId,
    health: Math.round(player.health),
    stars: player.stars,
    money: player.money,
    crimeRating: clampCrimeRating(player.crimeRating),
    weapon: player.weapon,
    ownedPistol: player.ownedPistol,
    ownedShotgun: player.ownedShotgun,
    ownedMachinegun: player.ownedMachinegun,
    ownedBazooka: player.ownedBazooka,
    chatText: hasChat ? player.chatText : '',
    chatUntil: hasChat ? player.chatUntil : 0,
  };
}

function serializeCarForSnapshot(car) {
  return {
    id: car.id,
    type: car.type,
    x: quantized(car.x, 100),
    y: quantized(car.y, 100),
    angle: quantized(car.angle, 1000),
    speed: quantized(car.speed, 10),
    color: car.color,
    driverId: car.driverId,
    npcDriver: car.npcDriver,
    sirenOn: !!car.sirenOn,
    health: Math.round(car.health || 0),
    smoking: (car.health || 0) > 0 && (car.health || 0) <= CAR_SMOKE_HEALTH,
  };
}

function serializeNpcForSnapshot(npc) {
  return {
    id: npc.id,
    x: quantized(npc.x, 100),
    y: quantized(npc.y, 100),
    dir: quantized(npc.dir, 1000),
    alive: npc.alive,
    corpseState: npc.corpseState,
    skinColor: npc.skinColor,
    shirtColor: npc.shirtColor,
    shirtDark: npc.shirtDark || '#2a3342',
  };
}

function serializeCopForSnapshot(cop) {
  return {
    id: cop.id,
    x: quantized(cop.x, 100),
    y: quantized(cop.y, 100),
    dir: quantized(cop.dir, 1000),
    health: Math.round(cop.health || 0),
    alive: !!cop.alive,
    inCarId: cop.inCarId || null,
    corpseState: cop.corpseState || 'none',
    mode: cop.mode,
    alert: (cop.alertTimer || 0) > 0,
  };
}

function serializeDropForSnapshot(drop) {
  return {
    id: drop.id,
    x: quantized(drop.x, 100),
    y: quantized(drop.y, 100),
    amount: drop.amount,
    ttl: quantized(drop.ttl, 100),
  };
}

function serializeBloodForSnapshot(stain) {
  return {
    id: stain.id,
    x: quantized(stain.x, 100),
    y: quantized(stain.y, 100),
    ttl: quantized(stain.ttl, 100),
  };
}

function isEventAlwaysRelevant(event, player) {
  if (!event || !player) return false;
  if (event.playerId && event.playerId === player.id) return true;
  if (event.killerId && event.killerId === player.id) return true;
  if (event.victimId && event.victimId === player.id) return true;
  if (event.sourcePlayerId && event.sourcePlayerId === player.id) return true;
  return false;
}

function eventLocationRelevant(event, player, radiusSq = AOI_CAR_RADIUS_SQ) {
  if (!event || !player) return false;
  if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return false;
  return wrappedDistanceSq(player.x, player.y, event.x, event.y) <= radiusSq;
}

function filterEventsForPlayer(player, events) {
  if (!Array.isArray(events) || events.length === 0) return [];
  if (!OPT_AOI) return events;

  const filtered = [];
  for (const event of events) {
    if (!event) continue;
    if (isEventAlwaysRelevant(event, player)) {
      filtered.push(event);
      continue;
    }
    if (eventLocationRelevant(event, player)) {
      filtered.push(event);
      continue;
    }
  }
  return filtered;
}

function shouldIncludeCarForPlayer(player, car) {
  if (!player || !car) return false;
  if (car.destroyed) return false;
  if (!OPT_AOI) return true;
  if (car.id === player.inCarId || car.driverId === player.id) return true;
  if (car.type === 'cop' && car.dismountTargetPlayerId === player.id) return true;
  return entityInsidePlayerAoi(player, car.x, car.y, AOI_CAR_RADIUS_SQ);
}

function shouldIncludePlayerForPlayer(player, other) {
  if (!player || !other) return false;
  if (!OPT_AOI) return true;
  if (other.id === player.id) return true;
  return entityInsidePlayerAoi(player, other.x, other.y, AOI_PED_RADIUS_SQ);
}

function shouldIncludeNpcForPlayer(player, npc) {
  if (!player || !npc) return false;
  if (!OPT_AOI) return true;
  return entityInsidePlayerAoi(player, npc.x, npc.y, AOI_PED_RADIUS_SQ);
}

function shouldIncludeCopForPlayer(player, cop) {
  if (!player || !cop) return false;
  if (!OPT_AOI) return true;
  if (cop.targetPlayerId === player.id) return true;
  return entityInsidePlayerAoi(player, cop.x, cop.y, AOI_PED_RADIUS_SQ);
}

function shouldIncludeDropForPlayer(player, drop) {
  if (!player || !drop) return false;
  if (!OPT_AOI) return true;
  return entityInsidePlayerAoi(player, drop.x, drop.y, AOI_PED_RADIUS_SQ);
}

function shouldIncludeBloodForPlayer(player, stain) {
  if (!player || !stain) return false;
  if (!OPT_AOI) return true;
  return entityInsidePlayerAoi(player, stain.x, stain.y, AOI_PED_RADIUS_SQ);
}

function buildGlobalWorldStats() {
  let npcAlive = 0;
  for (const npc of npcs.values()) {
    if (npc.alive) npcAlive += 1;
  }

  let carsCivilian = 0;
  let carsCop = 0;
  let carsAmbulance = 0;
  for (const car of cars.values()) {
    if (car.destroyed) continue;
    if (car.type === 'cop') {
      carsCop += 1;
    } else if (car.type === 'ambulance') {
      carsAmbulance += 1;
    } else {
      carsCivilian += 1;
    }
  }

  let copsAlive = 0;
  for (const cop of cops.values()) {
    if (cop.alive) copsAlive += 1;
  }

  return {
    npcAlive,
    carsCivilian,
    carsCop,
    carsAmbulance,
    copsAlive,
  };
}

function serializeSnapshotForPlayer(player, now, events, globalStats = null) {
  const playersPayload = [];
  for (const entry of players.values()) {
    if (!shouldIncludePlayerForPlayer(player, entry)) continue;
    playersPayload.push(serializePlayerForSnapshot(entry, now));
  }

  const carsPayload = [];
  for (const car of cars.values()) {
    if (!shouldIncludeCarForPlayer(player, car)) continue;
    carsPayload.push(serializeCarForSnapshot(car));
  }

  const npcsPayload = [];
  for (const npc of npcs.values()) {
    if (!shouldIncludeNpcForPlayer(player, npc)) continue;
    npcsPayload.push(serializeNpcForSnapshot(npc));
  }

  const copsPayload = [];
  for (const cop of cops.values()) {
    if (!shouldIncludeCopForPlayer(player, cop)) continue;
    copsPayload.push(serializeCopForSnapshot(cop));
  }

  const dropsPayload = [];
  for (const drop of cashDrops.values()) {
    if (!shouldIncludeDropForPlayer(player, drop)) continue;
    dropsPayload.push(serializeDropForSnapshot(drop));
  }

  const bloodPayload = [];
  if (!OPT_CLIENT_VFX) {
    for (const stain of bloodStains.values()) {
      if (!shouldIncludeBloodForPlayer(player, stain)) continue;
      bloodPayload.push(serializeBloodForSnapshot(stain));
    }
  }

  const payload = {
    type: 'snapshot',
    serverTime: now,
    worldRev: WORLD_REV,
    players: playersPayload,
    cars: carsPayload,
    npcs: npcsPayload,
    cops: copsPayload,
    drops: dropsPayload,
    blood: bloodPayload,
    events: filterEventsForPlayer(player, events),
  };

  if (player.requestStats && globalStats) {
    payload.stats = globalStats;
  }

  if (OPT_AOI) {
    payload.scope = {
      x: quantized(player.x, 10),
      y: quantized(player.y, 10),
      pedRadius: AOI_PED_RADIUS,
      carRadius: AOI_CAR_RADIUS,
    };
  }

  return payload;
}

function toWirePlayerRecord(record, nowWallMs) {
  const chatMsLeft =
    typeof record.chatUntil === 'number' && record.chatUntil > 0
      ? Math.max(0, Math.min(65535, Math.round(record.chatUntil - nowWallMs)))
      : 0;
  return {
    id: protocolIdForEntity(record.id),
    name: record.name || '',
    color: normalizeHexColor(record.color, '#ffffff'),
    x: record.x,
    y: record.y,
    dir: record.dir,
    inCarId: protocolIdForEntityOptional(record.inCarId),
    insideShopIndex: shopIndexById(record.insideShopId),
    health: record.health,
    stars: record.stars,
    money: record.money,
    crimeRating: clampCrimeRating(record.crimeRating),
    weapon: record.weapon || 'fist',
    ownedPistol: !!record.ownedPistol,
    ownedShotgun: !!record.ownedShotgun,
    ownedMachinegun: !!record.ownedMachinegun,
    ownedBazooka: !!record.ownedBazooka,
    chatText: chatMsLeft > 0 ? String(record.chatText || '') : '',
    chatMsLeft,
  };
}

function toWireCarRecord(record) {
  return {
    id: protocolIdForEntity(record.id),
    type: record.type,
    x: record.x,
    y: record.y,
    angle: record.angle,
    speed: record.speed,
    color: normalizeHexColor(record.color, '#5ca1ff'),
    driverId: protocolIdForEntityOptional(record.driverId),
    npcDriver: !!record.npcDriver,
    sirenOn: !!record.sirenOn,
    health: clamp(Math.round(record.health || 0), 0, CAR_MAX_HEALTH),
    smoking: !!record.smoking,
  };
}

function toWireNpcRecord(record) {
  return {
    id: protocolIdForEntity(record.id),
    x: record.x,
    y: record.y,
    dir: record.dir,
    alive: !!record.alive,
    corpseState: record.corpseState || 'none',
    skinColor: normalizeHexColor(record.skinColor, '#f0c39a'),
    shirtColor: normalizeHexColor(record.shirtColor, '#808891'),
    shirtDark: normalizeHexColor(record.shirtDark, '#2a3342'),
  };
}

function toWireCopRecord(record) {
  return {
    id: protocolIdForEntity(record.id),
    x: record.x,
    y: record.y,
    dir: record.dir,
    health: record.health,
    alive: !!record.alive,
    inCarId: protocolIdForEntityOptional(record.inCarId),
    corpseState: record.corpseState || 'none',
    mode: record.mode || 'patrol',
    alert: !!record.alert,
  };
}

function toWireDropRecord(record) {
  return {
    id: protocolIdForEntity(record.id),
    x: record.x,
    y: record.y,
    amount: record.amount,
    ttl: record.ttl,
  };
}

function toWireBloodRecord(record) {
  return {
    id: protocolIdForEntity(record.id),
    x: record.x,
    y: record.y,
    ttl: record.ttl,
  };
}

function toWireEventRecord(event) {
  const wire = {
    id: event.id >>> 0,
    type: event.type,
    x: Number.isFinite(event.x) ? event.x : 0,
    y: Number.isFinite(event.y) ? event.y : 0,
  };

  if (event.playerId) wire.playerId = protocolIdForEntityOptional(event.playerId);
  if (event.killerId) wire.killerId = protocolIdForEntityOptional(event.killerId);
  if (event.victimId) wire.victimId = protocolIdForEntityOptional(event.victimId);
  if (event.sourcePlayerId) wire.sourcePlayerId = protocolIdForEntityOptional(event.sourcePlayerId);
  if (event.carId) wire.carId = protocolIdForEntityOptional(event.carId);
  if (event.npcId) wire.npcId = protocolIdForEntityOptional(event.npcId);
  if (event.dropId) wire.dropId = protocolIdForEntityOptional(event.dropId);
  if (event.stainId) wire.stainId = protocolIdForEntityOptional(event.stainId);

  if (event.type === 'bullet' || event.type === 'melee') {
    wire.toX = Number.isFinite(event.toX) ? event.toX : wire.x;
    wire.toY = Number.isFinite(event.toY) ? event.toY : wire.y;
  }
  if (event.type === 'bullet') {
    wire.weapon = event.weapon || 'pistol';
  }
  if (event.type === 'explosion' && Number.isFinite(event.radius)) {
    wire.radius = event.radius;
  }
  if (event.type === 'npcThrown') {
    wire.dir = Number.isFinite(event.dir) ? event.dir : 0;
    wire.speed = Number.isFinite(event.speed) ? event.speed : 0;
    wire.skinColor = normalizeHexColor(event.skinColor, '#f0c39a');
    wire.shirtColor = normalizeHexColor(event.shirtColor, '#808891');
    wire.shirtDark = normalizeHexColor(event.shirtDark, '#2a3342');
  }
  if (event.type === 'cashDrop' || event.type === 'cashPickup') {
    wire.amount = Number.isFinite(event.amount) ? event.amount : 0;
  }
  if (event.type === 'cashPickup' && Number.isFinite(event.total)) {
    wire.total = event.total;
  }
  if (event.type === 'bloodSpawn' && Number.isFinite(event.ttl)) {
    wire.ttl = event.ttl;
  }
  if (event.type === 'purchase') {
    wire.item = ITEM_TO_CODE[event.item] ? event.item : '';
    wire.amount = Number.isFinite(event.amount) ? event.amount : 0;
  }
  if (event.type === 'enterShop' || event.type === 'exitShop') {
    wire.shopIndex = shopIndexById(event.shopId);
  }

  return wire;
}

function ensureClientSnapshotState(client) {
  if (client.snapshotState) return;
  client.snapshotState = {
    snapshotsSinceKeyframe: SNAPSHOT_KEYFRAME_EVERY,
    snapshotSeq: 0,
    signatures: SNAPSHOT_SECTION_ORDER.reduce((acc, name) => {
      acc[name] = new Map();
      return acc;
    }, {}),
  };
}

function buildSectionDelta(records, previousSignatures, keyframe) {
  const add = [];
  const update = [];
  const remove = [];
  const nextSignatures = new Map();

  for (const record of records) {
    const id = record.id >>> 0;
    const sig = JSON.stringify(record);
    nextSignatures.set(id, sig);
    if (keyframe || !previousSignatures.has(id)) {
      add.push(record);
    } else if (previousSignatures.get(id) !== sig) {
      update.push(record);
    }
  }

  if (!keyframe) {
    for (const id of previousSignatures.keys()) {
      if (!nextSignatures.has(id)) {
        remove.push(id >>> 0);
      }
    }
  }

  return {
    delta: { add, update, remove },
    signatures: nextSignatures,
  };
}

function serializePresencePayloadBinary(serverTimeMs) {
  const playersPayload = [];
  for (const player of players.values()) {
    playersPayload.push({
      id: protocolIdForEntity(player.id),
      color: normalizeHexColor(player.color, '#ffffff'),
      x: player.x,
      y: player.y,
      inCarId: protocolIdForEntityOptional(player.inCarId),
    });
  }
  return {
    serverTime: serverTimeMs >>> 0,
    worldRev: WORLD_REV,
    onlineCount: playersPayload.length,
    players: playersPayload,
  };
}

function broadcastPresence(serverTimeMs = Math.round(performance.now())) {
  if (clients.size === 0) return;
  const payload = encodePresenceFrame(serializePresencePayloadBinary(serverTimeMs));
  const payloadBytes = payload.length;
  for (const ws of clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
      bytesSentSinceReport += payloadBytes;
    }
  }
}

function broadcastSnapshot(nowPerfMs = Math.round(performance.now())) {
  if (clients.size === 0) {
    pendingEvents = [];
    return;
  }
  const nowWallMs = Date.now();
  const events = pendingEvents;
  pendingEvents = [];
  const globalStats = buildGlobalWorldStats();

  for (const [ws, client] of clients.entries()) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    const player = players.get(client.playerId);
    if (!player) continue;
    ensureClientSnapshotState(client);
    const buildStart = performance.now();
    const snapshot = serializeSnapshotForPlayer(player, nowWallMs, events, globalStats);
    const keyframe = client.snapshotState.snapshotsSinceKeyframe >= SNAPSHOT_KEYFRAME_EVERY;
    client.snapshotState.snapshotSeq = (client.snapshotState.snapshotSeq + 1) & 0xffff;

    const fullSections = {
      players: snapshot.players.map((entry) => toWirePlayerRecord(entry, nowWallMs)),
      cars: snapshot.cars.map(toWireCarRecord),
      npcs: snapshot.npcs.map(toWireNpcRecord),
      cops: snapshot.cops.map(toWireCopRecord),
      drops: snapshot.drops.map(toWireDropRecord),
      blood: snapshot.blood.map(toWireBloodRecord),
    };

    const sections = {};
    for (const name of SNAPSHOT_SECTION_ORDER) {
      const previous = client.snapshotState.signatures[name];
      const result = buildSectionDelta(fullSections[name], previous, keyframe);
      sections[name] = result.delta;
      client.snapshotState.signatures[name] = result.signatures;
    }

    const wireEvents = snapshot.events.map(toWireEventRecord);
    const currentProgressSignature = progressSignatureFromPlayer(player);
    let nextProgressTicket = '';
    let progressTicketChanged = false;
    if (currentProgressSignature !== client.lastProgressSignature) {
      nextProgressTicket = createProgressTicketForPlayer(player);
      if (nextProgressTicket) {
        client.lastProgressSignature = currentProgressSignature;
        client.lastProgressTicket = nextProgressTicket;
        progressTicketChanged = true;
      }
    }
    const payload = encodeSnapshotFrame({
      serverTime: nowPerfMs >>> 0,
      worldRev: WORLD_REV,
      snapshotSeq: client.snapshotState.snapshotSeq,
      keyframe,
      ackInputSeq: player.lastInputSeq || 0,
      clientSendTimeEcho: player.lastClientSendTime || 0,
      interpolationDelayMs: SNAPSHOT_INTERP_DELAY_MS,
      sections,
      events: wireEvents,
      stats: snapshot.stats || null,
      scope: snapshot.scope || null,
      progressTicket: progressTicketChanged ? nextProgressTicket : '',
    });
    pushMetricSample(snapshotBuildMsWindow, performance.now() - buildStart, 300);
    bytesSentSinceReport += payload.length;
    ws.send(payload);
    client.snapshotState.snapshotsSinceKeyframe = keyframe
      ? 1
      : Math.min(SNAPSHOT_KEYFRAME_EVERY * 2, client.snapshotState.snapshotsSinceKeyframe + 1);
  }
}

function disconnectClient(ws) {
  const client = clients.get(ws);
  if (!client) return;

  const player = players.get(client.playerId);
  if (player) {
    if (player.inCarId) {
      const car = cars.get(player.inCarId);
      if (car) {
        car.driverId = null;
        car.abandonTimer = 0;
      }
    }
    players.delete(player.id);
    emitEvent('disconnect', { playerId: player.id, x: player.x, y: player.y });
  }

  clients.delete(ws);
  broadcastPresence();
}

function handleJoin(ws, data) {
  if (clients.has(ws)) {
    ws.send(encodeErrorFrame('Already joined.'));
    return;
  }

  const name = sanitizeName(data.name);
  const color = sanitizeColor(data.color);
  const profileTicket = typeof data.profileTicket === 'string' ? data.profileTicket : '';
  const profileId = sanitizeProfileId(data.profileId);

  if (!name) {
    ws.send(encodeErrorFrame('Name must be 2-16 letters/numbers.'));
    return;
  }
  if (!color) {
    ws.send(encodeErrorFrame('Color must be a valid hex value like #44ccff.'));
    return;
  }

  const spawn = randomPedSpawn();
  const id = makeId('p');
  const player = {
    id,
    name,
    color,
    x: spawn.x,
    y: spawn.y,
    dir: 0,
    inCarId: null,
    insideShopId: null,
    shopExitX: spawn.x,
    shopExitY: spawn.y,
    health: 100,
    money: 0,
    crimeRating: 0,
    stars: 0,
    starHeat: 0,
    starCooldown: 0,
    copAlertPlayed: false,
    chatText: '',
    chatUntil: 0,
    respawnTimer: 0,
    hitCooldown: 0,
    shootCooldown: 0,
    lastShootSeq: 0,
    weapon: 'pistol',
    ownedPistol: true,
    ownedShotgun: false,
    ownedMachinegun: false,
    ownedBazooka: false,
    profileId: '',
    requestStats: false,
    lastInputSeq: 0,
    lastClientSendTime: 0,
    prevEnter: false,
    input: {
      up: false,
      down: false,
      left: false,
      right: false,
      enter: false,
      horn: false,
      shootHeld: false,
      shootSeq: 0,
      weaponSlot: 1,
      requestStats: false,
      aimX: spawn.x,
      aimY: spawn.y,
      clickAimX: spawn.x,
      clickAimY: spawn.y,
    },
  };

  restoreProgressForPlayer(player, profileTicket, name);
  attachCrimeReputationToPlayer(player, profileId);
  const initialProgressSignature = progressSignatureFromPlayer(player);
  const initialProgressTicket = createProgressTicketForPlayer(player);

  players.set(id, player);
  clients.set(ws, {
    playerId: id,
    snapshotState: null,
    lastProgressTicket: initialProgressTicket,
    lastProgressSignature: initialProgressSignature,
  });

  const playerProtocolId = protocolIdForEntity(id);
  ws.send(
    encodeJoinedFrame({
      playerId: playerProtocolId,
      tickRate: TICK_RATE,
      worldRev: WORLD_REV,
      world: STATIC_WORLD_PAYLOAD,
      progressTicket: initialProgressTicket,
    })
  );

  emitEvent('join', { playerId: id, x: player.x, y: player.y });
  broadcastPresence();
}

function normalizeShootSeq(raw, prev) {
  if (!Number.isInteger(raw) || raw < 0) {
    return prev;
  }

  if (raw + 2000 < prev) {
    return raw;
  }

  if (raw < prev) {
    return prev;
  }

  return raw;
}

function handleInput(ws, data) {
  const client = clients.get(ws);
  if (!client) return;
  const player = players.get(client.playerId);
  if (!player) return;

  const input = data.input;
  if (!input || typeof input !== 'object') return;
  const seq = Number(data.seq);
  if (Number.isInteger(seq) && seq >= 0) {
    player.lastInputSeq = seq >>> 0;
  }
  const clientSendTime = Number(data.clientSendTime);
  if (Number.isInteger(clientSendTime) && clientSendTime >= 0) {
    player.lastClientSendTime = clientSendTime >>> 0;
  }

  player.input.up = !!input.up;
  player.input.down = !!input.down;
  player.input.left = !!input.left;
  player.input.right = !!input.right;
  player.input.enter = !!input.enter;
  player.input.horn = !!input.horn;
  player.input.shootHeld = !!input.shootHeld;
  player.requestStats = !!input.requestStats;
  player.input.requestStats = player.requestStats;
  const slot = Number(input.weaponSlot);
  if (Number.isInteger(slot) && slot >= 1 && slot <= 4) {
    player.input.weaponSlot = slot;
  }

  const ax = Number(input.aimX);
  const ay = Number(input.aimY);
  if (Number.isFinite(ax) && Number.isFinite(ay)) {
    player.input.aimX = clamp(ax, 0, WORLD.width);
    player.input.aimY = clamp(ay, 0, WORLD.height);
  }

  const cax = Number(input.clickAimX);
  const cay = Number(input.clickAimY);
  if (Number.isFinite(cax) && Number.isFinite(cay)) {
    player.input.clickAimX = clamp(cax, 0, WORLD.width);
    player.input.clickAimY = clamp(cay, 0, WORLD.height);
  }

  player.input.shootSeq = normalizeShootSeq(Number(data.shootSeq), player.input.shootSeq);
}

function handleBuy(ws, data) {
  const client = clients.get(ws);
  if (!client) return;
  const player = players.get(client.playerId);
  if (!player) return;

  const item = typeof data.item === 'string' ? data.item.trim().toLowerCase() : '';
  const result = buyItemForPlayer(player, item);
  ws.send(encodeNoticeFrame(result.ok, result.message));
}

function handleChat(ws, data) {
  const client = clients.get(ws);
  if (!client) return;
  const player = players.get(client.playerId);
  if (!player) return;

  const text = sanitizeChatText(data.text);
  if (text === null) return;

  if (!text) {
    player.chatText = '';
    player.chatUntil = 0;
    return;
  }

  player.chatText = text;
  player.chatUntil = Date.now() + CHAT_DURATION_MS;
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    if (!(raw instanceof Buffer)) {
      ws.send(encodeErrorFrame('Binary protocol required. Refresh the page.'));
      ws.close();
      return;
    }

    if (raw.length > 8192) {
      ws.send(encodeErrorFrame('Payload too large.'));
      return;
    }

    let data;
    try {
      data = decodeClientFrame(raw);
    } catch {
      ws.send(encodeErrorFrame('Invalid packet.'));
      return;
    }

    if (!data || typeof data !== 'object') {
      return;
    }

    if (data.opcode === OPCODES.C2S_JOIN) {
      handleJoin(ws, data);
    } else if (data.opcode === OPCODES.C2S_INPUT) {
      handleInput(ws, data);
    } else if (data.opcode === OPCODES.C2S_BUY) {
      handleBuy(ws, data);
    } else if (data.opcode === OPCODES.C2S_CHAT) {
      handleChat(ws, data);
    }
  });

  ws.on('close', () => {
    disconnectClient(ws);
  });

  ws.on('error', () => {
    disconnectClient(ws);
  });
});

loadCrimeReputationStore();

for (let i = 0; i < TRAFFIC_COUNT; i++) {
  makeCar('civilian');
}
for (let i = 0; i < COP_COUNT; i++) {
  makeCar('cop');
}
for (let i = 0; i < AMBULANCE_COUNT; i++) {
  makeCar('ambulance');
}
for (let i = 0; i < NPC_COUNT; i++) {
  makeNpc();
}
for (let i = 0; i < COP_OFFICER_COUNT; i++) {
  makeCopUnit();
}
ensureCopCarCrews();

function reportServerMetricsIfNeeded(nowMs) {
  if (nowMs < nextMetricsAt) return;
  const reportWindowSec = 5;
  const tickP50 = percentile(tickMsWindow, 0.5);
  const tickP95 = percentile(tickMsWindow, 0.95);
  const snapshotP95 = percentile(snapshotBuildMsWindow, 0.95);
  const kbps = (bytesSentSinceReport / 1024 / reportWindowSec).toFixed(1);
  // eslint-disable-next-line no-console
  console.log(
    [
      `[metrics] tick p50=${tickP50.toFixed(2)}ms p95=${tickP95.toFixed(2)}ms`,
      `snapshotBuild p95=${snapshotP95.toFixed(2)}ms`,
      `net=${kbps}KB/s`,
      `entities players=${players.size} npcs=${npcs.size} cars=${cars.size} cops=${cops.size} drops=${cashDrops.size}`,
    ].join(' | ')
  );
  bytesSentSinceReport = 0;
  nextMetricsAt = nowMs + 5_000;
}

let tickCount = 0;
setInterval(() => {
  const tickStart = performance.now();
  tickCount += 1;
  tickLodContext = buildTickLodContext();
  tickSpatialContext = buildTickSpatialContext();
  stepPlayers(DT);
  stepCars(DT);
  tickSpatialContext = buildTickSpatialContext();
  stepCarHitsByCars(tickSpatialContext);
  stepCops(DT);
  maybeEmitCopTriggerAlerts();
  stepNpcs(DT);
  tickSpatialContext = buildTickSpatialContext();
  stepPlayerHits(tickSpatialContext);
  stepNpcHitsByCars(tickSpatialContext);
  stepCopHitsByCars(tickSpatialContext);
  stepCashDrops(DT);
  stepBloodStains(DT);
  resetAmbientSceneWhenEmpty();
  ensureCarPopulation();
  ensureNpcPopulation();
  ensureCopPopulation();
  ensureCopCarCrews();
  const snapshotStep = 1 / SNAPSHOT_RATE;
  snapshotAccumulator += DT;
  let snapshotLoops = 0;
  while (snapshotAccumulator >= snapshotStep && snapshotLoops < 3) {
    broadcastSnapshot(Math.round(performance.now()));
    snapshotAccumulator -= snapshotStep;
    snapshotLoops += 1;
  }
  if (snapshotLoops >= 3) {
    snapshotAccumulator = 0;
  }

  const presenceStep = 1 / PRESENCE_RATE;
  presenceAccumulator += DT;
  let presenceLoops = 0;
  while (presenceAccumulator >= presenceStep && presenceLoops < 2) {
    broadcastPresence(Math.round(performance.now()));
    presenceAccumulator -= presenceStep;
    presenceLoops += 1;
  }
  if (presenceLoops >= 2) {
    presenceAccumulator = 0;
  }
  pushMetricSample(tickMsWindow, performance.now() - tickStart, 300);
  reportServerMetricsIfNeeded(Date.now());
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Pixel city server running on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(
    `flags AOI=${OPT_AOI ? 1 : 0} ZONE_LOD=${OPT_ZONE_LOD ? 1 : 0} CLIENT_VFX=${OPT_CLIENT_VFX ? 1 : 0}`
  );
});
