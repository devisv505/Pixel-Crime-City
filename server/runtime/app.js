const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const { envFlag } = require('../core/config');
const { createContext } = require('../core/context');
const { createIdGenerator } = require('../core/ids');
const { createCombatFeature } = require('../features/combat');
const { createCopsFeature } = require('../features/cops');
const { createCrimeFeature } = require('../features/crime');
const { createEconomyFeature } = require('../features/economy');
const { createEventsFeature } = require('../features/events');
const { createNpcsFeature } = require('../features/npcs');
const { createPresenceFeature } = require('../features/presence');
const { createPlayersFeature } = require('../features/players');
const { createSnapshotFeature } = require('../features/snapshot');
const { createSpawningFeature } = require('../features/spawning');
const { createTrafficFeature } = require('../features/traffic');
const { createTransportFeature } = require('../features/transport');
const { createVehiclesFeature } = require('../features/vehicles');
const { createWorldFeature } = require('../features/world');
const { createRuntimeConstants } = require('./constants');
const {
  mod,
  clamp,
  createWorldMath,
  lerp,
  approach,
  angleWrap,
  angleApproach,
  snapToRightAngle,
  randRange,
  randInt,
  hash2D,
  quantized,
  pushMetricSample,
  percentile,
  idPhase,
} = require('../core/math');
const {
  OPCODES,
  ITEM_TO_CODE,
  SNAPSHOT_SECTION_ORDER,
  QUEST_ACTION_TO_CODE,
  QUEST_STATUS_TO_CODE,
  decodeClientFrame,
  encodeErrorFrame,
  encodeNoticeFrame,
  encodeJoinedFrame,
  encodePresenceFrame,
  encodeSnapshotFrame,
} = require('../../server-protocol');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ADS_TXT_FILE_PATH = path.join(PROJECT_ROOT, 'public', 'ads.txt');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
app.use(express.json({ limit: '128kb' }));

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_BASE_URL = normalizePublicBaseUrl(process.env.PUBLIC_BASE_URL);
const ADSENSE_CLIENT = String(process.env.ADSENSE_CLIENT || '').trim();
const ADSENSE_JOIN_SLOT = String(process.env.ADSENSE_JOIN_SLOT || '').trim();
const ADS_TXT_LINES = String(process.env.ADS_TXT_LINES || '').trim();
const GOOGLE_FC_PUBLISHER = String(process.env.GOOGLE_FC_PUBLISHER || '').trim();
const SITE_CONTACT_EMAIL = String(process.env.SITE_CONTACT_EMAIL || 'devisv505@gmail.com').trim();
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
const OPT_NPC_NAV_DEBUG_MAP = envFlag('OPT_NPC_NAV_DEBUG_MAP', false);
const NPC_NAV_DEBUG_MAP_STRIDE = Math.max(
  1,
  Number.parseInt(String(process.env.NPC_NAV_DEBUG_MAP_STRIDE || '1'), 10) || 1
);
const NPC_NAV_DEBUG_MAP_MAX_NODES = Math.max(
  0,
  Number.parseInt(String(process.env.NPC_NAV_DEBUG_MAP_MAX_NODES || '5000'), 10) || 5000
);
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
      : path.join(PROJECT_ROOT, 'data'))
);
const CRIME_REPUTATION_DB_FILE = path.resolve(
  CRIME_REPUTATION_DB_FILE_ENV || path.join(CRIME_REPUTATION_DATA_DIR, 'crime-reputation.sqlite')
);
const CRIME_REPUTATION_LEGACY_JSON_FILE = path.resolve(
  CRIME_REPUTATION_LEGACY_FILE_ENV || path.join(CRIME_REPUTATION_DATA_DIR, 'crime-reputation.json')
);
const RUNTIME_CONSTANTS = createRuntimeConstants({ worldRev: WORLD_REV });
const {
  CRIME_BOARD_DEFAULT_PAGE_SIZE,
  CRIME_BOARD_MAX_PAGE_SIZE,
  REPUTATION_BOARD_DEFAULT_PAGE_SIZE,
  REPUTATION_BOARD_MAX_PAGE_SIZE,
  QUEST_ACTION_TYPES,
  INITIAL_QUEST_SEED_V1,
  QUEST_TARGET_ZONE_RADIUS,
  QUEST_TARGET_ZONE_REFRESH_MS,
  QUEST_TARGET_SKIN_COLOR,
  QUEST_TARGET_SHIRT_COLOR,
  QUEST_TARGET_SHIRT_DARK,
  QUEST_JSON_MAX_BYTES,
  QUEST_KEY_MAX_LENGTH,
  QUEST_SCHEMA_MIGRATION_LATEST,
  CRIME_WEIGHTS,
  WORLD,
  BLOCK_PX,
  ROAD_START,
  ROAD_END,
  LANE_A,
  LANE_B,
  PLAYER_SPEED,
  PLAYER_RADIUS,
  DROP_LIFETIME,
  DROP_PICKUP_RADIUS,
  STAR_DECAY_PER_SECOND,
  NPC_COUNT,
  NPC_RADIUS,
  NPC_NAV_REACH_RADIUS,
  NPC_IDLE_MIN_SECONDS,
  NPC_IDLE_MAX_SECONDS,
  NPC_PANIC_MIN_SECONDS,
  NPC_PANIC_MAX_SECONDS,
  NPC_RETURN_SPEED_BONUS,
  NPC_PANIC_SPEED_BONUS,
  NPC_FOLLOW_SPEED_BONUS,
  NPC_FOLLOW_CATCHUP_SPEED,
  NPC_CROSS_WAIT_MIN_SECONDS,
  NPC_CROSS_WAIT_MAX_SECONDS,
  NPC_CROSS_BLOCK_TIMEOUT_SECONDS,
  NPC_CROSS_SAFE_GAP_SECONDS,
  NPC_CROSS_MIN_CAR_SPEED,
  NPC_GROUP_DENSITY,
  NPC_GROUP_MIN_SIZE,
  NPC_GROUP_MAX_SIZE,
  NPC_GROUP_JOIN_RADIUS,
  NPC_GROUP_FOLLOW_RESUME_DIST,
  NPC_GROUP_FOLLOW_BREAK_DIST,
  COP_RADIUS,
  COP_HEALTH,
  COP_CAR_DISMOUNT_RADIUS,
  COP_CAR_RECALL_RADIUS,
  COP_DEPLOY_PICK_RADIUS,
  COP_CAR_DEFAULT_CREW_SIZE,
  COP_COMBAT_STANDOFF_MIN,
  COP_COMBAT_STANDOFF_MAX,
  COP_COMBAT_STANDOFF_PIVOT,
  COP_SHOT_HIT_CHANCE_NEAR,
  COP_SHOT_HIT_CHANCE_FAR,
  COP_SHOT_HIT_AIM_JITTER,
  COP_SHOT_MISS_AIM_OFFSET_MIN,
  COP_SHOT_MISS_AIM_OFFSET_MAX,
  COP_SHOT_TARGET_RADIUS,
  POLICE_GUNFIRE_REPORT_COOLDOWN,
  COP_HUNT_JOIN_RADIUS,
  COP_HUNT_LEASH_RADIUS,
  COP_HUNT_LOST_TIMEOUT,
  COP_MAX_HUNTERS_PER_PLAYER,
  COP_CAR_HUNT_JOIN_RADIUS,
  COP_CAR_HUNT_LEASH_RADIUS,
  COP_CAR_HUNT_LOST_TIMEOUT,
  COP_MAX_HUNTER_CARS_PER_PLAYER,
  COP_HUNT_JOIN_RADIUS_SQ,
  COP_HUNT_LEASH_RADIUS_SQ,
  COP_CAR_HUNT_JOIN_RADIUS_SQ,
  COP_CAR_HUNT_LEASH_RADIUS_SQ,
  TRAFFIC_COUNT,
  COP_COUNT,
  COP_OFFICER_COUNT,
  AMBULANCE_COUNT,
  AMBULANCE_CAPACITY,
  CAR_STUCK_RESPAWN_SECONDS,
  CAR_MAX_HEALTH,
  CAR_SMOKE_HEALTH,
  CAR_RESPAWN_SECONDS,
  MAX_NAME_LENGTH,
  POLICE_WITNESS_RADIUS,
  COP_ALERT_MARK_SECONDS,
  NPC_HOSPITAL_FALLBACK_SECONDS,
  COP_HOSPITAL_FALLBACK_SECONDS,
  CHAT_DURATION_MS,
  CHAT_MAX_LENGTH,
  BLOOD_STAIN_LIFETIME,
  CAR_PALETTE,
  NPC_PALETTE,
  NPC_SHIRT_PALETTE,
  SHOP_STOCK,
  EMPTY_SHOP_STOCK,
  GARAGE_SELL_PRICE,
  GARAGE_REPAINT_RANDOM_PRICE,
  GARAGE_REPAINT_SELECTED_PRICE,
  GARAGE_REPAINT_SELECTED_KEY,
  GARAGE_REPAINT_SELECTED_PREFIX,
  GARAGE_REPAINT_SELECTED_PRESET_COLORS,
  SHOPS,
  GARAGES,
  INTERIORS,
  INTERIOR_INDEX_BY_ID,
  HOSPITALS,
  HOSPITAL,
  STATIC_WORLD_PAYLOAD,
  CAR_COLLISION_HALF_LENGTH_SCALE,
  CAR_COLLISION_HALF_WIDTH_SCALE,
  CAR_BUILDING_COLLISION_INSET_X_PX,
  CAR_BUILDING_COLLISION_INSET_Y_PX,
  BUILDING_COLLIDER_TOP_OFFSET_PX,
  WEAPONS,
} = RUNTIME_CONSTANTS;
const SERVER_BOOT_TIME_MS = Date.now();
const NODE_ENV = String(process.env.NODE_ENV || '').trim().toLowerCase();
const ADMIN_LOCAL_DEFAULTS = NODE_ENV !== 'production' && envFlag('ADMIN_LOCAL_DEFAULTS', true);
const ADMIN_USER = String(process.env.ADMIN_USER || '').trim();
const ADMIN_PASS = String(process.env.ADMIN_PASS || '').trim();
const ADMIN_AUTH_USER = ADMIN_USER || (ADMIN_LOCAL_DEFAULTS ? 'admin' : '');
const ADMIN_AUTH_PASS = ADMIN_PASS || (ADMIN_LOCAL_DEFAULTS ? 'change_me' : '');
const ADMIN_AUTH_ENABLED = ADMIN_AUTH_USER.length > 0 && ADMIN_AUTH_PASS.length > 0;
const ADMIN_USING_LOCAL_DEFAULTS =
  ADMIN_LOCAL_DEFAULTS &&
  (!ADMIN_USER || !ADMIN_PASS) &&
  ADMIN_AUTH_USER === 'admin' &&
  ADMIN_AUTH_PASS === 'change_me';
const ADMIN_SESSION_COOKIE = 'pcc_admin_session';
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const ADMIN_PLAYER_STATS_DEFAULT_PAGE_SIZE = 100;
const ADMIN_PLAYER_STATS_MAX_PAGE_SIZE = 500;
const NPC_PLAYER_CAR_FEAR_MIN_SPEED = 14;
const NPC_PLAYER_CAR_FEAR_RADIUS_BASE = 26;
const NPC_PLAYER_CAR_FEAR_RADIUS_MAX = 76;
const NPC_PLAYER_CAR_FEAR_RADIUS_PER_SPEED = 0.62;
const NPC_PLAYER_CAR_FEAR_AHEAD_DOT_MIN = -0.2;
const NPC_PLAYER_CAR_FEAR_SIDE_DISTANCE = 24;
const NPC_PLAYER_CAR_FEAR_PANIC_MIN_SECONDS = 0.9;
const NPC_PLAYER_CAR_FEAR_PANIC_BASE_MAX_SECONDS = 1.9;
const NPC_PLAYER_CAR_FEAR_PANIC_MAX_SECONDS = 3.4;
const {
  wrapCoord,
  wrapWorldX,
  wrapWorldY,
  wrapWorldPosition,
  wrapDelta,
  wrappedLerp,
  wrappedDistanceSq,
  wrappedVector,
  wrappedDirection,
} = createWorldMath(WORLD);

const clients = new Map();
const players = new Map();
const cars = new Map();
const npcs = new Map();
const npcGroups = new Map();
const cops = new Map();
const cashDrops = new Map();
const bloodStains = new Map();
let crimeReputationDb = null;
const crimeReputationSql = {};
const questSql = {};
const playerStatsSql = {};
let activeQuestCatalog = [];
const adminSessions = new Map();
const questTargetAssignmentsByKey = new Map();
const questTargetOwnerByNpcId = new Map();
const questTargetCarAssignmentsByKey = new Map();
const questTargetCarOwnerByCarId = new Map();
let nextNpcGroupId = 1;

const makeId = createIdGenerator(1);
const eventState = { nextEventId: 1, pending: [] };
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
const runtimeContext = createContext({
  clients,
  players,
  cars,
  npcs,
  cops,
  cashDrops,
  bloodStains,
  eventState,
});
const { emitEvent, drainPendingEvents, clearPendingEvents } = createEventsFeature(eventState);

function entityInsidePlayerAoi(player, x, y, radiusSq) {
  return wrappedDistanceSq(player.x, player.y, x, y) <= radiusSq;
}

function normalizePublicBaseUrl(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function firstHeaderValue(headerValue) {
  if (Array.isArray(headerValue)) {
    for (const item of headerValue) {
      const text = String(item || '').trim();
      if (text) return text.split(',')[0].trim();
    }
    return '';
  }
  const text = String(headerValue || '').trim();
  if (!text) return '';
  return text.split(',')[0].trim();
}

function resolvePublicBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const forwardedProto = firstHeaderValue(req?.headers?.['x-forwarded-proto']);
  const forwardedHost = firstHeaderValue(req?.headers?.['x-forwarded-host']);
  const host = forwardedHost || req.get('host') || `localhost:${PORT}`;
  let protocol = String(forwardedProto || req.protocol || 'http').trim().toLowerCase();
  if (protocol.includes(':')) {
    protocol = protocol.split(':')[0];
  }
  if (protocol !== 'http' && protocol !== 'https') {
    protocol = 'http';
  }
  return `${protocol}://${host}`;
}

function absolutePublicUrl(req, pathname = '/') {
  const safePath = String(pathname || '/').startsWith('/') ? String(pathname || '/') : `/${pathname}`;
  return `${resolvePublicBaseUrl(req)}${safePath}`;
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeAdSensePublisherForAdsTxt(clientValue) {
  const raw = String(clientValue || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('ca-pub-')) {
    const body = raw.slice('ca-pub-'.length);
    return /^\d{10,24}$/.test(body) ? `pub-${body}` : '';
  }
  if (raw.startsWith('pub-')) {
    const body = raw.slice('pub-'.length);
    return /^\d{10,24}$/.test(body) ? `pub-${body}` : '';
  }
  return '';
}

function normalizeAdSenseClient(clientValue) {
  const value = String(clientValue || '').trim().toLowerCase();
  if (!/^ca-pub-\d{10,24}$/.test(value)) return '';
  return value;
}

function splitAdsTxtLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function loadAdsTxtFileLines() {
  try {
    const raw = fs.readFileSync(ADS_TXT_FILE_PATH, 'utf8');
    return splitAdsTxtLines(raw);
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      // eslint-disable-next-line no-console
      console.warn(`[ads] failed to read ads.txt file: ${error.message}`);
    }
    return [];
  }
}

function safeContactEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return 'devisv505@gmail.com';
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
    return 'devisv505@gmail.com';
  }
  return email;
}

let indexHtmlTemplateCache = null;
let indexHtmlTemplateLoadAttempted = false;

function getIndexHtmlTemplate() {
  if (indexHtmlTemplateLoadAttempted) return indexHtmlTemplateCache;
  indexHtmlTemplateLoadAttempted = true;
  try {
    const filePath = path.join(PROJECT_ROOT, 'public', 'index.html');
    indexHtmlTemplateCache = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[seo] failed to load index template: ${error.message}`);
    indexHtmlTemplateCache = null;
  }
  return indexHtmlTemplateCache;
}

function buildAdSenseVerifyScriptTag() {
  const client = normalizeAdSenseClient(ADSENSE_CLIENT);
  if (!client) return '';
  return `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}" crossorigin="anonymous"></script>`;
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
  const index = INTERIOR_INDEX_BY_ID.get(id);
  return Number.isInteger(index) ? index : null;
}

function isPreferredPedGround(ground) {
  return ground === 'sidewalk' || ground === 'park';
}

const {
  plotIndexForLocalCoord,
  centeredBuildingRectForPlot,
  groundTypeAt,
  roadInfoAt,
  isSolidForPed,
  isSolidForCar,
  isIntersection,
  laneFor,
  randomRoadSpawn,
  randomRoadSpawnNear,
  randomPedSpawn,
  randomCurbSpawn,
  randomRoadSpawnFarFrom,
  npcNavGraph,
  neighborNodeIdsByNode,
  componentIdByNodeId,
  nearestNavNode,
} = createWorldFeature({
  WORLD,
  BLOCK_PX,
  ROAD_START,
  ROAD_END,
  LANE_A,
  LANE_B,
  HOSPITALS,
  GARAGES,
  INTERIORS,
  BUILDING_COLLIDER_TOP_OFFSET_PX,
  CAR_BUILDING_COLLISION_INSET_X_PX,
  CAR_BUILDING_COLLISION_INSET_Y_PX,
  mod,
  clamp,
  hash2D,
  wrapWorldX,
  wrapWorldY,
  wrapDelta,
  wrappedDistanceSq,
  randRange,
  randInt,
  isPreferredPedGround,
});

if (OPT_NPC_NAV_DEBUG_MAP && Array.isArray(npcNavGraph?.nodes) && npcNavGraph.nodes.length > 0) {
  const stride = Math.max(1, NPC_NAV_DEBUG_MAP_STRIDE);
  const maxNodes = Math.max(0, NPC_NAV_DEBUG_MAP_MAX_NODES);
  let emitted = 0;
  for (let i = 0; i < npcNavGraph.nodes.length && emitted < maxNodes; i += stride) {
    const node = npcNavGraph.nodes[i];
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
    STATIC_WORLD_PAYLOAD.npcNavNodes.push(
      Object.freeze({
        x: Math.round(node.x),
        y: Math.round(node.y),
      })
    );
    emitted += 1;
  }
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

function sanitizeQuestKey(raw) {
  if (typeof raw !== 'string') return '';
  let cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '');
  if (!cleaned) return '';
  if (cleaned.length > QUEST_KEY_MAX_LENGTH) {
    cleaned = cleaned.slice(0, QUEST_KEY_MAX_LENGTH).replace(/^[_\-.]+|[_\-.]+$/g, '');
  }
  return cleaned;
}

function questKeyFromTitle(title) {
  const fromTitle = sanitizeQuestKey(String(title || '').replace(/\s+/g, '_'));
  if (fromTitle) return fromTitle;
  return 'quest';
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

function normalizeCrimeBoardSearchQuery(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .slice(0, MAX_NAME_LENGTH);
}

function escapeSqlLikePattern(raw) {
  return String(raw || '').replace(/[\\%_]/g, '\\$&');
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

function normalizePlayerStatsRow(row) {
  if (!row || typeof row !== 'object') return null;
  const profileId = sanitizeProfileId(row.profileId);
  if (!profileId) return null;
  const safeName = sanitizeName(row.name) || `Profile ${crimeProfileTag(profileId)}`;
  const lastEnteredAt = Math.max(0, Math.round(Number(row.lastEnteredAt) || 0));
  const longestSessionMs = Math.max(0, Math.round(Number(row.longestSessionMs) || 0));
  const updatedAt = Math.max(0, Math.round(Number(row.updatedAt) || 0));
  return {
    profileId,
    name: safeName,
    lastEnteredAt,
    longestSessionMs,
    updatedAt,
  };
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sortObjectKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectKeysDeep(item));
  }
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortObjectKeysDeep(value[key]);
  }
  return out;
}

function normalizeQuestJsonObject(raw, fallback = {}) {
  let value = raw;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      value = fallback;
    } else {
      try {
        value = JSON.parse(trimmed);
      } catch {
        value = fallback;
      }
    }
  } else if (value == null) {
    value = fallback;
  }

  if (!isPlainObject(value)) {
    value = fallback;
  }

  try {
    const canonical = sortObjectKeysDeep(value);
    const text = JSON.stringify(canonical);
    if (Buffer.byteLength(text, 'utf8') > QUEST_JSON_MAX_BYTES) {
      return sortObjectKeysDeep(isPlainObject(fallback) ? fallback : {});
    }
    return canonical;
  } catch {
    return sortObjectKeysDeep(isPlainObject(fallback) ? fallback : {});
  }
}

function stringifyQuestJsonObject(raw, fallback = {}) {
  const normalized = normalizeQuestJsonObject(raw, fallback);
  return JSON.stringify(normalized);
}

function normalizeQuestRewardPayloadObject(payload, rewardMoney, rewardReputation, rewardUnlockGunShop) {
  const base = normalizeQuestJsonObject(payload, {});
  base.money = clamp(Math.round(Number(rewardMoney) || 0), 0, 0xffffffff);
  base.reputation = clamp(Math.round(Number(rewardReputation) || 0), 0, 0xffffffff);
  base.unlockGunShop = !!rewardUnlockGunShop;
  return base;
}

function tableColumnSet(db, tableName) {
  if (!db || !tableName) return new Set();
  try {
    return new Set(
      db
        .prepare(`PRAGMA table_info(${tableName})`)
        .all()
        .map((column) => String(column?.name || '').trim().toLowerCase())
    );
  } catch {
    return new Set();
  }
}

function runCrimeReputationMigrations(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
  const selectApplied = db.prepare('SELECT version FROM schema_migrations WHERE version = @version LIMIT 1');
  const markApplied = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (@version, @name, @appliedAt)'
  );

  const migrations = [
    {
      version: 1,
      name: 'quest_reset_on_death',
      up() {
        const questColumns = tableColumnSet(db, 'quests');
        if (!questColumns.has('reset_on_death')) {
          db.exec('ALTER TABLE quests ADD COLUMN reset_on_death INTEGER NOT NULL DEFAULT 0');
        }
      },
    },
    {
      version: 2,
      name: 'quest_action_params_json',
      up() {
        const questColumns = tableColumnSet(db, 'quests');
        if (!questColumns.has('action_params_json')) {
          db.exec("ALTER TABLE quests ADD COLUMN action_params_json TEXT NOT NULL DEFAULT '{}'");
        }
        const rows = db.prepare('SELECT id, action_params_json AS actionParamsJson FROM quests').all();
        const update = db.prepare('UPDATE quests SET action_params_json = @actionParamsJson WHERE id = @id');
        for (const row of rows) {
          const normalized = stringifyQuestJsonObject(row?.actionParamsJson, {});
          if (String(row?.actionParamsJson || '').trim() !== normalized) {
            update.run({
              id: Number(row.id) >>> 0,
              actionParamsJson: normalized,
            });
          }
        }
      },
    },
    {
      version: 3,
      name: 'quest_reward_payload_json',
      up() {
        const questColumns = tableColumnSet(db, 'quests');
        if (!questColumns.has('reward_payload_json')) {
          db.exec("ALTER TABLE quests ADD COLUMN reward_payload_json TEXT NOT NULL DEFAULT '{}'");
        }
        const rows = db
          .prepare(`
            SELECT
              id,
              reward_money AS rewardMoney,
              reward_reputation AS rewardReputation,
              reward_unlock_gun_shop AS rewardUnlockGunShop,
              reward_payload_json AS rewardPayloadJson
            FROM quests
          `)
          .all();
        const update = db.prepare('UPDATE quests SET reward_payload_json = @rewardPayloadJson WHERE id = @id');
        for (const row of rows) {
          const normalizedPayload = normalizeQuestRewardPayloadObject(
            row?.rewardPayloadJson,
            row?.rewardMoney,
            row?.rewardReputation,
            !!Number(row?.rewardUnlockGunShop)
          );
          const normalized = JSON.stringify(normalizedPayload);
          if (String(row?.rewardPayloadJson || '').trim() !== normalized) {
            update.run({
              id: Number(row.id) >>> 0,
              rewardPayloadJson: normalized,
            });
          }
        }
      },
    },
    {
      version: 4,
      name: 'quest_key',
      up() {
        const questColumns = tableColumnSet(db, 'quests');
        if (!questColumns.has('quest_key')) {
          db.exec('ALTER TABLE quests ADD COLUMN quest_key TEXT');
        }
        const rows = db.prepare('SELECT id, quest_key AS questKey FROM quests ORDER BY id ASC').all();
        const usedKeys = new Set();
        const update = db.prepare('UPDATE quests SET quest_key = @questKey WHERE id = @id');
        for (const row of rows) {
          const id = Number(row?.id) >>> 0;
          if (!id) continue;
          const rawCurrent = String(row?.questKey || '').trim();
          let nextKey = sanitizeQuestKey(rawCurrent);
          if (!nextKey || usedKeys.has(nextKey)) {
            nextKey = sanitizeQuestKey(`legacy_${id}`) || `legacy_${id}`;
            let suffix = 2;
            while (usedKeys.has(nextKey)) {
              nextKey = sanitizeQuestKey(`legacy_${id}_${suffix}`) || `legacy_${id}_${suffix}`;
              suffix += 1;
            }
          }
          usedKeys.add(nextKey);
          if (rawCurrent !== nextKey) {
            update.run({ id, questKey: nextKey });
          }
        }
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_quests_quest_key ON quests (quest_key)');
      },
    },
    {
      version: 5,
      name: 'initial_quest_seed_v1',
      up() {
        const totalRow = db.prepare('SELECT COUNT(1) AS total FROM quests').get();
        const total = Math.max(0, Math.round(Number(totalRow?.total) || 0));
        if (total > 0) return;
        const insert = db.prepare(`
          INSERT INTO quests (
            quest_key,
            title,
            description,
            action_type,
            action_params_json,
            target_count,
            sort_order,
            reward_money,
            reward_reputation,
            reward_unlock_gun_shop,
            reward_payload_json,
            reset_on_death,
            is_active,
            created_at,
            updated_at
          ) VALUES (
            @questKey,
            @title,
            @description,
            @actionType,
            @actionParamsJson,
            @targetCount,
            @sortOrder,
            @rewardMoney,
            @rewardReputation,
            @rewardUnlockGunShop,
            @rewardPayloadJson,
            @resetOnDeath,
            @isActive,
            @createdAt,
            @updatedAt
          )
        `);
        const usedKeys = new Set();
        const now = Date.now();
        let fallbackSortOrder = 10;
        for (const seed of INITIAL_QUEST_SEED_V1) {
          const title = String(seed?.title || '').trim().slice(0, 80);
          const actionType = normalizeQuestActionType(seed?.actionType);
          if (!title || !actionType) continue;
          const targetCount = clamp(Math.round(Number(seed?.targetCount) || 0), 1, 65535);
          const rewardMoney = clamp(Math.round(Number(seed?.rewardMoney) || 0), 0, 0xffffffff);
          const rewardReputation = clamp(Math.round(Number(seed?.rewardReputation) || 0), 0, 0xffffffff);
          const rewardUnlockGunShop = !!seed?.rewardUnlockGunShop;
          const rewardPayload = normalizeQuestRewardPayloadObject(
            seed?.rewardPayload,
            rewardMoney,
            rewardReputation,
            rewardUnlockGunShop
          );
          const actionParams = normalizeQuestJsonObject(seed?.actionParams, {});
          let questKey = sanitizeQuestKey(seed?.questKey) || questKeyFromTitle(title);
          if (usedKeys.has(questKey)) {
            let suffix = 2;
            let candidate = questKey;
            while (usedKeys.has(candidate)) {
              const suffixText = `_${suffix}`;
              const base = questKey.slice(0, Math.max(1, QUEST_KEY_MAX_LENGTH - suffixText.length));
              candidate = `${base}${suffixText}`;
              suffix += 1;
            }
            questKey = candidate;
          }
          usedKeys.add(questKey);
          const sortOrder = clamp(
            Math.round(Number.isFinite(Number(seed?.sortOrder)) ? Number(seed.sortOrder) : fallbackSortOrder),
            -2147483648,
            2147483647
          );
          insert.run({
            questKey,
            title,
            description: String(seed?.description || '').trim().slice(0, 400),
            actionType,
            actionParamsJson: stringifyQuestJsonObject(actionParams, {}),
            targetCount,
            sortOrder,
            rewardMoney,
            rewardReputation,
            rewardUnlockGunShop: rewardUnlockGunShop ? 1 : 0,
            rewardPayloadJson: stringifyQuestJsonObject(rewardPayload, {}),
            resetOnDeath: seed?.resetOnDeath ? 1 : 0,
            isActive: seed?.isActive === false ? 0 : 1,
            createdAt: now,
            updatedAt: now,
          });
          fallbackSortOrder += 10;
        }
      },
    },
  ];

  for (const migration of migrations) {
    const version = Number(migration?.version) || 0;
    if (version <= 0 || version > QUEST_SCHEMA_MIGRATION_LATEST) continue;
    const applied = selectApplied.get({ version });
    if (applied) continue;
    const tx = db.transaction(() => {
      migration.up();
      markApplied.run({
        version,
        name: String(migration.name || `migration_${version}`),
        appliedAt: Date.now(),
      });
    });
    tx();
  }
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
      CREATE TABLE IF NOT EXISTS quests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quest_key TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        action_type TEXT NOT NULL,
        action_params_json TEXT NOT NULL DEFAULT '{}',
        target_count INTEGER NOT NULL,
        sort_order INTEGER NOT NULL,
        reward_money INTEGER NOT NULL DEFAULT 0,
        reward_reputation INTEGER NOT NULL DEFAULT 0,
        reward_unlock_gun_shop INTEGER NOT NULL DEFAULT 0,
        reward_payload_json TEXT NOT NULL DEFAULT '{}',
        reset_on_death INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_quests_order
        ON quests (is_active DESC, sort_order ASC, id ASC);
      CREATE TABLE IF NOT EXISTS player_quest_progress (
        profile_id TEXT NOT NULL,
        quest_id INTEGER NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        completed_at INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, quest_id)
      );
      CREATE INDEX IF NOT EXISTS idx_player_quest_progress_profile
        ON player_quest_progress (profile_id);
      CREATE TABLE IF NOT EXISTS player_quest_profile (
        profile_id TEXT PRIMARY KEY,
        reputation INTEGER NOT NULL DEFAULT 0,
        gun_shop_unlocked INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_player_quest_profile_reputation
        ON player_quest_profile (reputation DESC, updated_at DESC, profile_id ASC);
      CREATE TABLE IF NOT EXISTS player_quest_target (
        profile_id TEXT NOT NULL,
        quest_id INTEGER NOT NULL,
        target_npc_id TEXT NOT NULL,
        zone_x REAL NOT NULL,
        zone_y REAL NOT NULL,
        zone_radius REAL NOT NULL,
        assigned_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, quest_id)
      );
      CREATE INDEX IF NOT EXISTS idx_player_quest_target_npc
        ON player_quest_target (target_npc_id);
      CREATE TABLE IF NOT EXISTS player_quest_target_car (
        profile_id TEXT NOT NULL,
        quest_id INTEGER NOT NULL,
        target_car_id TEXT NOT NULL,
        zone_x REAL NOT NULL,
        zone_y REAL NOT NULL,
        zone_radius REAL NOT NULL,
        assigned_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, quest_id)
      );
      CREATE INDEX IF NOT EXISTS idx_player_quest_target_car_id
        ON player_quest_target_car (target_car_id);
      CREATE TABLE IF NOT EXISTS player_stats (
        profile_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        last_entered_at INTEGER NOT NULL,
        longest_session_ms INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_player_stats_last_entered
        ON player_stats (last_entered_at DESC, profile_id ASC);
      CREATE INDEX IF NOT EXISTS idx_player_stats_name
        ON player_stats (name COLLATE NOCASE);
    `);
    runCrimeReputationMigrations(crimeReputationDb);
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
    crimeReputationSql.countByName = crimeReputationDb.prepare(`
      SELECT COUNT(1) AS total
      FROM crime_reputation
      WHERE name LIKE @nameLike ESCAPE '\\' COLLATE NOCASE
    `);
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
    crimeReputationSql.listPageByName = crimeReputationDb.prepare(`
      SELECT
        profile_id AS profileId,
        name,
        crime_rating AS crimeRating,
        last_color AS lastColor,
        updated_at AS updatedAt
      FROM crime_reputation
      WHERE name LIKE @nameLike ESCAPE '\\' COLLATE NOCASE
      ORDER BY crime_rating DESC, updated_at DESC, name ASC
      LIMIT @limit OFFSET @offset
    `);
    questSql.listActive = crimeReputationDb.prepare(`
      SELECT
        id,
        quest_key AS questKey,
        title,
        description,
        action_type AS actionType,
        action_params_json AS actionParamsJson,
        target_count AS targetCount,
        sort_order AS sortOrder,
        reward_money AS rewardMoney,
        reward_reputation AS rewardReputation,
        reward_unlock_gun_shop AS rewardUnlockGunShop,
        reward_payload_json AS rewardPayloadJson,
        reset_on_death AS resetOnDeath,
        is_active AS isActive,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM quests
      WHERE is_active = 1
      ORDER BY sort_order ASC, id ASC
    `);
    questSql.listAll = crimeReputationDb.prepare(`
      SELECT
        id,
        quest_key AS questKey,
        title,
        description,
        action_type AS actionType,
        action_params_json AS actionParamsJson,
        target_count AS targetCount,
        sort_order AS sortOrder,
        reward_money AS rewardMoney,
        reward_reputation AS rewardReputation,
        reward_unlock_gun_shop AS rewardUnlockGunShop,
        reward_payload_json AS rewardPayloadJson,
        reset_on_death AS resetOnDeath,
        is_active AS isActive,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM quests
      ORDER BY sort_order ASC, id ASC
    `);
    questSql.getById = crimeReputationDb.prepare(`
      SELECT
        id,
        quest_key AS questKey,
        title,
        description,
        action_type AS actionType,
        action_params_json AS actionParamsJson,
        target_count AS targetCount,
        sort_order AS sortOrder,
        reward_money AS rewardMoney,
        reward_reputation AS rewardReputation,
        reward_unlock_gun_shop AS rewardUnlockGunShop,
        reward_payload_json AS rewardPayloadJson,
        reset_on_death AS resetOnDeath,
        is_active AS isActive,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM quests
      WHERE id = @id
      LIMIT 1
    `);
    questSql.insert = crimeReputationDb.prepare(`
      INSERT INTO quests (
        quest_key,
        title,
        description,
        action_type,
        action_params_json,
        target_count,
        sort_order,
        reward_money,
        reward_reputation,
        reward_unlock_gun_shop,
        reward_payload_json,
        reset_on_death,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        @questKey,
        @title,
        @description,
        @actionType,
        @actionParamsJson,
        @targetCount,
        @sortOrder,
        @rewardMoney,
        @rewardReputation,
        @rewardUnlockGunShop,
        @rewardPayloadJson,
        @resetOnDeath,
        @isActive,
        @createdAt,
        @updatedAt
      )
    `);
    questSql.update = crimeReputationDb.prepare(`
      UPDATE quests
      SET
        quest_key = @questKey,
        title = @title,
        description = @description,
        action_type = @actionType,
        action_params_json = @actionParamsJson,
        target_count = @targetCount,
        sort_order = @sortOrder,
        reward_money = @rewardMoney,
        reward_reputation = @rewardReputation,
        reward_unlock_gun_shop = @rewardUnlockGunShop,
        reward_payload_json = @rewardPayloadJson,
        reset_on_death = @resetOnDeath,
        is_active = @isActive,
        updated_at = @updatedAt
      WHERE id = @id
    `);
    questSql.selectIdByQuestKey = crimeReputationDb.prepare(`
      SELECT id
      FROM quests
      WHERE quest_key = @questKey
      LIMIT 1
    `);
    questSql.delete = crimeReputationDb.prepare('DELETE FROM quests WHERE id = @id');
    questSql.deleteProgressByQuestId = crimeReputationDb.prepare(
      'DELETE FROM player_quest_progress WHERE quest_id = @questId'
    );
    questSql.deleteTargetsByQuestId = crimeReputationDb.prepare(
      'DELETE FROM player_quest_target WHERE quest_id = @questId'
    );
    questSql.deleteCarTargetsByQuestId = crimeReputationDb.prepare(
      'DELETE FROM player_quest_target_car WHERE quest_id = @questId'
    );
    questSql.updateSortOrder = crimeReputationDb.prepare(`
      UPDATE quests
      SET sort_order = @sortOrder, updated_at = @updatedAt
      WHERE id = @id
    `);
    questSql.upsertPlayerQuestProfile = crimeReputationDb.prepare(`
      INSERT INTO player_quest_profile (profile_id, reputation, gun_shop_unlocked, updated_at)
      VALUES (@profileId, @reputation, @gunShopUnlocked, @updatedAt)
      ON CONFLICT(profile_id) DO UPDATE SET
        reputation = excluded.reputation,
        gun_shop_unlocked = excluded.gun_shop_unlocked,
        updated_at = excluded.updated_at
    `);
    questSql.selectPlayerQuestProfile = crimeReputationDb.prepare(`
      SELECT
        profile_id AS profileId,
        reputation,
        gun_shop_unlocked AS gunShopUnlocked,
        updated_at AS updatedAt
      FROM player_quest_profile
      WHERE profile_id = @profileId
      LIMIT 1
    `);
    questSql.listProgressByProfileId = crimeReputationDb.prepare(`
      SELECT
        quest_id AS questId,
        progress,
        completed_at AS completedAt,
        updated_at AS updatedAt
      FROM player_quest_progress
      WHERE profile_id = @profileId
    `);
    questSql.upsertProgress = crimeReputationDb.prepare(`
      INSERT INTO player_quest_progress (profile_id, quest_id, progress, completed_at, updated_at)
      VALUES (@profileId, @questId, @progress, @completedAt, @updatedAt)
      ON CONFLICT(profile_id, quest_id) DO UPDATE SET
        progress = excluded.progress,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
    `);
    questSql.selectTargetByProfileQuest = crimeReputationDb.prepare(`
      SELECT
        profile_id AS profileId,
        quest_id AS questId,
        target_npc_id AS targetNpcId,
        zone_x AS zoneX,
        zone_y AS zoneY,
        zone_radius AS zoneRadius,
        assigned_at AS assignedAt,
        updated_at AS updatedAt
      FROM player_quest_target
      WHERE profile_id = @profileId AND quest_id = @questId
      LIMIT 1
    `);
    questSql.listTargetsByProfileId = crimeReputationDb.prepare(`
      SELECT
        profile_id AS profileId,
        quest_id AS questId,
        target_npc_id AS targetNpcId,
        zone_x AS zoneX,
        zone_y AS zoneY,
        zone_radius AS zoneRadius,
        assigned_at AS assignedAt,
        updated_at AS updatedAt
      FROM player_quest_target
      WHERE profile_id = @profileId
    `);
    questSql.upsertTarget = crimeReputationDb.prepare(`
      INSERT INTO player_quest_target (
        profile_id,
        quest_id,
        target_npc_id,
        zone_x,
        zone_y,
        zone_radius,
        assigned_at,
        updated_at
      ) VALUES (
        @profileId,
        @questId,
        @targetNpcId,
        @zoneX,
        @zoneY,
        @zoneRadius,
        @assignedAt,
        @updatedAt
      )
      ON CONFLICT(profile_id, quest_id) DO UPDATE SET
        target_npc_id = excluded.target_npc_id,
        zone_x = excluded.zone_x,
        zone_y = excluded.zone_y,
        zone_radius = excluded.zone_radius,
        assigned_at = excluded.assigned_at,
        updated_at = excluded.updated_at
    `);
    questSql.deleteTargetByProfileQuest = crimeReputationDb.prepare(
      'DELETE FROM player_quest_target WHERE profile_id = @profileId AND quest_id = @questId'
    );
    questSql.selectCarTargetByProfileQuest = crimeReputationDb.prepare(`
      SELECT
        profile_id AS profileId,
        quest_id AS questId,
        target_car_id AS targetCarId,
        zone_x AS zoneX,
        zone_y AS zoneY,
        zone_radius AS zoneRadius,
        assigned_at AS assignedAt,
        updated_at AS updatedAt
      FROM player_quest_target_car
      WHERE profile_id = @profileId AND quest_id = @questId
      LIMIT 1
    `);
    questSql.listCarTargetsByProfileId = crimeReputationDb.prepare(`
      SELECT
        profile_id AS profileId,
        quest_id AS questId,
        target_car_id AS targetCarId,
        zone_x AS zoneX,
        zone_y AS zoneY,
        zone_radius AS zoneRadius,
        assigned_at AS assignedAt,
        updated_at AS updatedAt
      FROM player_quest_target_car
      WHERE profile_id = @profileId
    `);
    questSql.upsertCarTarget = crimeReputationDb.prepare(`
      INSERT INTO player_quest_target_car (
        profile_id,
        quest_id,
        target_car_id,
        zone_x,
        zone_y,
        zone_radius,
        assigned_at,
        updated_at
      ) VALUES (
        @profileId,
        @questId,
        @targetCarId,
        @zoneX,
        @zoneY,
        @zoneRadius,
        @assignedAt,
        @updatedAt
      )
      ON CONFLICT(profile_id, quest_id) DO UPDATE SET
        target_car_id = excluded.target_car_id,
        zone_x = excluded.zone_x,
        zone_y = excluded.zone_y,
        zone_radius = excluded.zone_radius,
        assigned_at = excluded.assigned_at,
        updated_at = excluded.updated_at
    `);
    questSql.deleteCarTargetByProfileQuest = crimeReputationDb.prepare(
      'DELETE FROM player_quest_target_car WHERE profile_id = @profileId AND quest_id = @questId'
    );
    questSql.countQuestProfileAll = crimeReputationDb.prepare('SELECT COUNT(1) AS total FROM player_quest_profile');
    questSql.countQuestProfileByName = crimeReputationDb.prepare(`
      SELECT COUNT(1) AS total
      FROM player_quest_profile qp
      LEFT JOIN crime_reputation cr ON cr.profile_id = qp.profile_id
      WHERE cr.name LIKE @nameLike ESCAPE '\\' COLLATE NOCASE
    `);
    questSql.listQuestProfilePage = crimeReputationDb.prepare(`
      SELECT
        qp.profile_id AS profileId,
        qp.reputation AS reputation,
        qp.gun_shop_unlocked AS gunShopUnlocked,
        qp.updated_at AS updatedAt,
        cr.name AS name,
        cr.last_color AS lastColor
      FROM player_quest_profile qp
      LEFT JOIN crime_reputation cr ON cr.profile_id = qp.profile_id
      ORDER BY qp.reputation DESC, qp.updated_at DESC, qp.profile_id ASC
      LIMIT @limit OFFSET @offset
    `);
    questSql.listQuestProfilePageByName = crimeReputationDb.prepare(`
      SELECT
        qp.profile_id AS profileId,
        qp.reputation AS reputation,
        qp.gun_shop_unlocked AS gunShopUnlocked,
        qp.updated_at AS updatedAt,
        cr.name AS name,
        cr.last_color AS lastColor
      FROM player_quest_profile qp
      LEFT JOIN crime_reputation cr ON cr.profile_id = qp.profile_id
      WHERE cr.name LIKE @nameLike ESCAPE '\\' COLLATE NOCASE
      ORDER BY qp.reputation DESC, qp.updated_at DESC, qp.profile_id ASC
      LIMIT @limit OFFSET @offset
    `);
    playerStatsSql.upsertOnJoin = crimeReputationDb.prepare(`
      INSERT INTO player_stats (profile_id, name, last_entered_at, longest_session_ms, updated_at)
      VALUES (@profileId, @name, @lastEnteredAt, @longestSessionMs, @updatedAt)
      ON CONFLICT(profile_id) DO UPDATE SET
        name = excluded.name,
        last_entered_at = excluded.last_entered_at,
        updated_at = excluded.updated_at
    `);
    playerStatsSql.upsertSessionDuration = crimeReputationDb.prepare(`
      INSERT INTO player_stats (profile_id, name, last_entered_at, longest_session_ms, updated_at)
      VALUES (@profileId, @name, @lastEnteredAt, @sessionMs, @updatedAt)
      ON CONFLICT(profile_id) DO UPDATE SET
        name = excluded.name,
        longest_session_ms = CASE
          WHEN excluded.longest_session_ms > player_stats.longest_session_ms
            THEN excluded.longest_session_ms
          ELSE player_stats.longest_session_ms
        END,
        updated_at = excluded.updated_at
    `);
    playerStatsSql.countAll = crimeReputationDb.prepare('SELECT COUNT(1) AS total FROM player_stats');
    playerStatsSql.countByName = crimeReputationDb.prepare(`
      SELECT COUNT(1) AS total
      FROM player_stats
      WHERE name LIKE @nameLike ESCAPE '\\' COLLATE NOCASE
    `);
    playerStatsSql.listPage = crimeReputationDb.prepare(`
      SELECT
        profile_id AS profileId,
        name,
        last_entered_at AS lastEnteredAt,
        longest_session_ms AS longestSessionMs,
        updated_at AS updatedAt
      FROM player_stats
      ORDER BY last_entered_at DESC, profile_id ASC
      LIMIT @limit OFFSET @offset
    `);
    playerStatsSql.listPageByName = crimeReputationDb.prepare(`
      SELECT
        profile_id AS profileId,
        name,
        last_entered_at AS lastEnteredAt,
        longest_session_ms AS longestSessionMs,
        updated_at AS updatedAt
      FROM player_stats
      WHERE name LIKE @nameLike ESCAPE '\\' COLLATE NOCASE
      ORDER BY last_entered_at DESC, profile_id ASC
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
    for (const key of Object.keys(questSql)) {
      delete questSql[key];
    }
    for (const key of Object.keys(playerStatsSql)) {
      delete playerStatsSql[key];
    }
    questTargetAssignmentsByKey.clear();
    questTargetOwnerByNpcId.clear();
    questTargetCarAssignmentsByKey.clear();
    questTargetCarOwnerByCarId.clear();
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
  reloadActiveQuestCatalog();
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
  for (const key of Object.keys(questSql)) {
    delete questSql[key];
  }
  for (const key of Object.keys(playerStatsSql)) {
    delete playerStatsSql[key];
  }
  questTargetAssignmentsByKey.clear();
  questTargetOwnerByNpcId.clear();
  questTargetCarAssignmentsByKey.clear();
  questTargetCarOwnerByCarId.clear();
}

function normalizeQuestActionType(raw) {
  const value = String(raw || '')
    .trim()
    .toLowerCase();
  return QUEST_ACTION_TYPES.includes(value) ? value : '';
}

function isQuestKeyTaken(questKey, excludeQuestId = 0) {
  const safeQuestKey = sanitizeQuestKey(questKey);
  if (!safeQuestKey) return false;
  if (!ensureCrimeReputationDb()) return false;
  if (!questSql.selectIdByQuestKey) return false;
  try {
    const row = questSql.selectIdByQuestKey.get({ questKey: safeQuestKey });
    const foundId = Number(row?.id) >>> 0;
    if (!foundId) return false;
    const excludedId = Number(excludeQuestId) >>> 0;
    return foundId !== excludedId;
  } catch {
    return false;
  }
}

function buildUniqueQuestKey(rawQuestKey, fallbackTitle, excludeQuestId = 0) {
  const excludedId = Number(excludeQuestId) >>> 0;
  const base = sanitizeQuestKey(rawQuestKey) || questKeyFromTitle(fallbackTitle);
  let candidate = base;
  if (!isQuestKeyTaken(candidate, excludedId)) return candidate;
  let suffix = 2;
  while (suffix < 100000) {
    const suffixText = `_${suffix}`;
    const prefix = base.slice(0, Math.max(1, QUEST_KEY_MAX_LENGTH - suffixText.length));
    candidate = `${prefix}${suffixText}`;
    if (!isQuestKeyTaken(candidate, excludedId)) return candidate;
    suffix += 1;
  }
  const fallbackSuffix = `_${Date.now().toString(36).slice(-6)}`;
  return `${base.slice(0, Math.max(1, QUEST_KEY_MAX_LENGTH - fallbackSuffix.length))}${fallbackSuffix}`;
}

function clampQuestProgress(value, targetCount) {
  return clamp(Math.round(Number(value) || 0), 0, Math.max(0, targetCount));
}

function normalizeQuestRow(row) {
  if (!row || typeof row !== 'object') return null;
  const id = Number(row.id) >>> 0;
  if (!id) return null;
  const actionType = normalizeQuestActionType(row.actionType);
  const title = String(row.title || '').trim().slice(0, 80);
  if (!actionType || !title) return null;
  const questKey = sanitizeQuestKey(row.questKey) || sanitizeQuestKey(`legacy_${id}`) || `legacy_${id}`;
  const targetCount = clamp(Math.round(Number(row.targetCount) || 0), 1, 65535);
  const rewardMoney = clamp(Math.round(Number(row.rewardMoney) || 0), 0, 0xffffffff);
  const rewardReputation = clamp(Math.round(Number(row.rewardReputation) || 0), 0, 0xffffffff);
  const rewardUnlockGunShop = !!Number(row.rewardUnlockGunShop);
  const actionParams = normalizeQuestJsonObject(row.actionParamsJson, {});
  const rewardPayload = normalizeQuestRewardPayloadObject(
    row.rewardPayloadJson,
    rewardMoney,
    rewardReputation,
    rewardUnlockGunShop
  );
  return {
    id,
    questKey,
    title,
    description: String(row.description || '').trim().slice(0, 400),
    actionType,
    actionParams,
    targetCount,
    sortOrder: clamp(Math.round(Number(row.sortOrder) || 0), -2147483648, 2147483647),
    rewardMoney,
    rewardReputation,
    rewardUnlockGunShop,
    rewardPayload,
    resetOnDeath: !!Number(row.resetOnDeath),
    isActive: !!Number(row.isActive),
    createdAt: Math.max(0, Math.round(Number(row.createdAt) || 0)),
    updatedAt: Math.max(0, Math.round(Number(row.updatedAt) || 0)),
  };
}

function normalizeQuestBoardSearchQuery(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .slice(0, MAX_NAME_LENGTH);
}

function normalizeQuestProfileRow(row, profileId = '') {
  const safeProfileId = sanitizeProfileId(profileId) || sanitizeProfileId(row?.profileId) || '';
  if (!safeProfileId) return null;
  return {
    profileId: safeProfileId,
    reputation: clamp(Math.round(Number(row?.reputation) || 0), 0, 0xffffffff),
    gunShopUnlocked: !!Number(row?.gunShopUnlocked),
    updatedAt: Math.max(0, Math.round(Number(row?.updatedAt) || 0)),
  };
}

function defaultQuestProfile(profileId) {
  const safeProfileId = sanitizeProfileId(profileId) || '';
  return {
    profileId: safeProfileId,
    reputation: 0,
    gunShopUnlocked: false,
    updatedAt: Date.now(),
  };
}

function questTargetKey(profileId, questId) {
  const safeProfileId = sanitizeProfileId(profileId);
  const safeQuestId = Number(questId) >>> 0;
  if (!safeProfileId || !safeQuestId) return '';
  return `${safeProfileId}:${safeQuestId}`;
}

function parseQuestTargetKey(key) {
  const raw = String(key || '');
  const idx = raw.lastIndexOf(':');
  if (idx <= 0) return null;
  const profileId = sanitizeProfileId(raw.slice(0, idx));
  const questId = Number.parseInt(raw.slice(idx + 1), 10) >>> 0;
  if (!profileId || !questId) return null;
  return { profileId, questId };
}

function normalizeQuestTargetRow(row, fallbackProfileId = '', fallbackQuestId = 0) {
  const profileId = sanitizeProfileId(row?.profileId) || sanitizeProfileId(fallbackProfileId);
  const questId = (Number(row?.questId) >>> 0) || (Number(fallbackQuestId) >>> 0);
  const targetNpcId = String(row?.targetNpcId || '').trim();
  if (!profileId || !questId || !targetNpcId) return null;
  return {
    profileId,
    questId,
    targetNpcId,
    zoneX: wrapWorldX(Number(row?.zoneX) || 0),
    zoneY: wrapWorldY(Number(row?.zoneY) || 0),
    zoneRadius: clamp(Math.round(Number(row?.zoneRadius) || QUEST_TARGET_ZONE_RADIUS), 40, 900),
    assignedAt: Math.max(0, Math.round(Number(row?.assignedAt) || Date.now())),
    updatedAt: Math.max(0, Math.round(Number(row?.updatedAt) || Date.now())),
  };
}

function cacheQuestTargetAssignment(assignment) {
  const normalized = normalizeQuestTargetRow(assignment);
  if (!normalized) return null;
  const key = questTargetKey(normalized.profileId, normalized.questId);
  if (!key) return null;
  const ownerKey = questTargetOwnerByNpcId.get(normalized.targetNpcId);
  if (ownerKey && ownerKey !== key) {
    return null;
  }
  questTargetAssignmentsByKey.set(key, normalized);
  questTargetOwnerByNpcId.set(normalized.targetNpcId, key);
  return normalized;
}

function uncacheQuestTargetAssignment(profileId, questId) {
  const key = questTargetKey(profileId, questId);
  if (!key) return;
  const existing = questTargetAssignmentsByKey.get(key);
  if (existing?.targetNpcId) {
    const ownerKey = questTargetOwnerByNpcId.get(existing.targetNpcId);
    if (ownerKey === key) {
      questTargetOwnerByNpcId.delete(existing.targetNpcId);
    }
  }
  questTargetAssignmentsByKey.delete(key);
}

function readQuestTargetAssignment(profileId, questId) {
  const parsed = parseQuestTargetKey(questTargetKey(profileId, questId));
  if (!parsed) return null;
  const key = questTargetKey(parsed.profileId, parsed.questId);
  const cached = questTargetAssignmentsByKey.get(key);
  if (cached) return cached;
  if (!ensureCrimeReputationDb()) return null;
  try {
    const row = questSql.selectTargetByProfileQuest.get({
      profileId: parsed.profileId,
      questId: parsed.questId,
    });
    const normalized = normalizeQuestTargetRow(row, parsed.profileId, parsed.questId);
    if (!normalized) return null;
    return cacheQuestTargetAssignment(normalized);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[quest] failed to read quest target assignment: ${error.message}`);
    return null;
  }
}

function listQuestTargetAssignmentsByProfile(profileId) {
  const safeProfileId = sanitizeProfileId(profileId);
  if (!safeProfileId) return [];
  if (!ensureCrimeReputationDb()) return [];
  try {
    return questSql.listTargetsByProfileId
      .all({ profileId: safeProfileId })
      .map((row) => normalizeQuestTargetRow(row, safeProfileId))
      .filter(Boolean)
      .map((assignment) => cacheQuestTargetAssignment(assignment) || assignment);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[quest] failed to list quest target assignments: ${error.message}`);
    return [];
  }
}

function persistQuestTargetAssignment(assignment) {
  const normalized = normalizeQuestTargetRow(assignment);
  if (!normalized) return null;
  if (!ensureCrimeReputationDb()) return null;
  try {
    questSql.upsertTarget.run({
      profileId: normalized.profileId,
      questId: normalized.questId,
      targetNpcId: normalized.targetNpcId,
      zoneX: normalized.zoneX,
      zoneY: normalized.zoneY,
      zoneRadius: normalized.zoneRadius,
      assignedAt: normalized.assignedAt,
      updatedAt: normalized.updatedAt,
    });
    return cacheQuestTargetAssignment(normalized);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[quest] failed to persist quest target assignment: ${error.message}`);
    return null;
  }
}

function deleteQuestTargetAssignment(profileId, questId) {
  const parsed = parseQuestTargetKey(questTargetKey(profileId, questId));
  if (!parsed) return;
  if (ensureCrimeReputationDb()) {
    try {
      questSql.deleteTargetByProfileQuest.run({
        profileId: parsed.profileId,
        questId: parsed.questId,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`[quest] failed to delete quest target assignment: ${error.message}`);
    }
  }
  uncacheQuestTargetAssignment(parsed.profileId, parsed.questId);
}

function normalizeQuestTargetCarRow(row, fallbackProfileId = '', fallbackQuestId = 0) {
  const profileId = sanitizeProfileId(row?.profileId) || sanitizeProfileId(fallbackProfileId);
  const questId = (Number(row?.questId) >>> 0) || (Number(fallbackQuestId) >>> 0);
  const targetCarId = String(row?.targetCarId || '').trim();
  if (!profileId || !questId || !targetCarId) return null;
  return {
    profileId,
    questId,
    targetCarId,
    zoneX: wrapWorldX(Number(row?.zoneX) || 0),
    zoneY: wrapWorldY(Number(row?.zoneY) || 0),
    zoneRadius: clamp(Math.round(Number(row?.zoneRadius) || QUEST_TARGET_ZONE_RADIUS), 40, 900),
    assignedAt: Math.max(0, Math.round(Number(row?.assignedAt) || Date.now())),
    updatedAt: Math.max(0, Math.round(Number(row?.updatedAt) || Date.now())),
  };
}

function cacheQuestTargetCarAssignment(assignment) {
  const normalized = normalizeQuestTargetCarRow(assignment);
  if (!normalized) return null;
  const key = questTargetKey(normalized.profileId, normalized.questId);
  if (!key) return null;
  const ownerKey = questTargetCarOwnerByCarId.get(normalized.targetCarId);
  if (ownerKey && ownerKey !== key) {
    return null;
  }
  questTargetCarAssignmentsByKey.set(key, normalized);
  questTargetCarOwnerByCarId.set(normalized.targetCarId, key);
  return normalized;
}

function uncacheQuestTargetCarAssignment(profileId, questId) {
  const key = questTargetKey(profileId, questId);
  if (!key) return;
  const existing = questTargetCarAssignmentsByKey.get(key);
  if (existing?.targetCarId) {
    const ownerKey = questTargetCarOwnerByCarId.get(existing.targetCarId);
    if (ownerKey === key) {
      questTargetCarOwnerByCarId.delete(existing.targetCarId);
    }
  }
  questTargetCarAssignmentsByKey.delete(key);
}

function uncacheQuestAssignmentsByQuestId(questId) {
  const safeQuestId = Number(questId) >>> 0;
  if (!safeQuestId) return;

  for (const key of Array.from(questTargetAssignmentsByKey.keys())) {
    const parsed = parseQuestTargetKey(key);
    if (!parsed || parsed.questId !== safeQuestId) continue;
    uncacheQuestTargetAssignment(parsed.profileId, parsed.questId);
  }

  for (const key of Array.from(questTargetCarAssignmentsByKey.keys())) {
    const parsed = parseQuestTargetKey(key);
    if (!parsed || parsed.questId !== safeQuestId) continue;
    uncacheQuestTargetCarAssignment(parsed.profileId, parsed.questId);
  }
}

function readQuestTargetCarAssignment(profileId, questId) {
  const parsed = parseQuestTargetKey(questTargetKey(profileId, questId));
  if (!parsed) return null;
  const key = questTargetKey(parsed.profileId, parsed.questId);
  const cached = questTargetCarAssignmentsByKey.get(key);
  if (cached) return cached;
  if (!ensureCrimeReputationDb()) return null;
  try {
    const row = questSql.selectCarTargetByProfileQuest.get({
      profileId: parsed.profileId,
      questId: parsed.questId,
    });
    const normalized = normalizeQuestTargetCarRow(row, parsed.profileId, parsed.questId);
    if (!normalized) return null;
    return cacheQuestTargetCarAssignment(normalized);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[quest] failed to read quest target car assignment: ${error.message}`);
    return null;
  }
}

function listQuestTargetCarAssignmentsByProfile(profileId) {
  const safeProfileId = sanitizeProfileId(profileId);
  if (!safeProfileId) return [];
  if (!ensureCrimeReputationDb()) return [];
  try {
    return questSql.listCarTargetsByProfileId
      .all({ profileId: safeProfileId })
      .map((row) => normalizeQuestTargetCarRow(row, safeProfileId))
      .filter(Boolean)
      .map((assignment) => cacheQuestTargetCarAssignment(assignment) || assignment);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[quest] failed to list quest target car assignments: ${error.message}`);
    return [];
  }
}

function persistQuestTargetCarAssignment(assignment) {
  const normalized = normalizeQuestTargetCarRow(assignment);
  if (!normalized) return null;
  if (!ensureCrimeReputationDb()) return null;
  try {
    questSql.upsertCarTarget.run({
      profileId: normalized.profileId,
      questId: normalized.questId,
      targetCarId: normalized.targetCarId,
      zoneX: normalized.zoneX,
      zoneY: normalized.zoneY,
      zoneRadius: normalized.zoneRadius,
      assignedAt: normalized.assignedAt,
      updatedAt: normalized.updatedAt,
    });
    return cacheQuestTargetCarAssignment(normalized);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[quest] failed to persist quest target car assignment: ${error.message}`);
    return null;
  }
}

function deleteQuestTargetCarAssignment(profileId, questId) {
  const parsed = parseQuestTargetKey(questTargetKey(profileId, questId));
  if (!parsed) return;
  if (ensureCrimeReputationDb()) {
    try {
      questSql.deleteCarTargetByProfileQuest.run({
        profileId: parsed.profileId,
        questId: parsed.questId,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`[quest] failed to delete quest target car assignment: ${error.message}`);
    }
  }
  uncacheQuestTargetCarAssignment(parsed.profileId, parsed.questId);
}

function pickAvailableQuestTargetNpc() {
  const candidates = [];
  for (const npc of npcs.values()) {
    if (!npc?.alive) continue;
    if (npc.corpseState !== 'none') continue;
    if (questTargetOwnerByNpcId.has(npc.id)) continue;
    candidates.push(npc);
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)] || null;
}

function pickOrCreateQuestTargetNpc() {
  const existing = pickAvailableQuestTargetNpc();
  if (existing) return existing;
  const created = makeNpc();
  if (!created) return null;
  return created;
}

function pickQuestTargetCar() {
  const available = [];
  const fallback = [];
  for (const car of cars.values()) {
    if (!car || car.destroyed) continue;
    if (car.driverId) continue;
    fallback.push(car);
    if (!questTargetCarOwnerByCarId.has(car.id)) {
      available.push(car);
    }
  }
  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)] || null;
  }
  if (fallback.length > 0) {
    return fallback[Math.floor(Math.random() * fallback.length)] || null;
  }
  return null;
}

function buildQuestTargetZone(npc) {
  return {
    zoneX: wrapWorldX(npc.x),
    zoneY: wrapWorldY(npc.y),
    zoneRadius: QUEST_TARGET_ZONE_RADIUS,
  };
}

function buildQuestTargetCarZone(car) {
  return {
    zoneX: wrapWorldX(car.x),
    zoneY: wrapWorldY(car.y),
    zoneRadius: QUEST_TARGET_ZONE_RADIUS,
  };
}

function findOnlinePlayerByProfileId(profileId) {
  const safeProfileId = sanitizeProfileId(profileId);
  if (!safeProfileId) return null;
  for (const player of players.values()) {
    if (sanitizeProfileId(player.profileId) === safeProfileId) {
      return player;
    }
  }
  return null;
}

function pruneQuestTargetAssignmentsForPlayer(profileId, expectedActiveQuestId = 0) {
  const safeProfileId = sanitizeProfileId(profileId);
  if (!safeProfileId) return;
  const assignments = listQuestTargetAssignmentsByProfile(safeProfileId);
  for (const assignment of assignments) {
    if ((assignment.questId >>> 0) === (Number(expectedActiveQuestId) >>> 0)) continue;
    deleteQuestTargetAssignment(assignment.profileId, assignment.questId);
  }
}

function pruneQuestTargetCarAssignmentsForPlayer(profileId, expectedActiveQuestId = 0) {
  const safeProfileId = sanitizeProfileId(profileId);
  if (!safeProfileId) return;
  const assignments = listQuestTargetCarAssignmentsByProfile(safeProfileId);
  for (const assignment of assignments) {
    if ((assignment.questId >>> 0) === (Number(expectedActiveQuestId) >>> 0)) continue;
    deleteQuestTargetCarAssignment(assignment.profileId, assignment.questId);
  }
}

function releaseQuestTargetReservationsForProfile(profileId) {
  const safeProfileId = sanitizeProfileId(profileId);
  if (!safeProfileId) return;
  const assignments = listQuestTargetAssignmentsByProfile(safeProfileId);
  for (const assignment of assignments) {
    uncacheQuestTargetAssignment(assignment.profileId, assignment.questId);
  }
  const carAssignments = listQuestTargetCarAssignmentsByProfile(safeProfileId);
  for (const assignment of carAssignments) {
    uncacheQuestTargetCarAssignment(assignment.profileId, assignment.questId);
  }
}

function ensureQuestTargetForActiveEntry(player, activeEntry) {
  if (!player || !activeEntry) return null;
  if (activeEntry.actionType !== 'kill_target_npc' || activeEntry.status !== 'active') return null;
  const safeProfileId = sanitizeProfileId(player.profileId);
  if (!safeProfileId) return null;
  const questId = activeEntry.id >>> 0;
  if (!questId) return null;

  const existing = readQuestTargetAssignment(safeProfileId, questId);
  if (existing) {
    // Force a fresh target after each server restart so stale persisted assignments do not pin old zones.
    if ((Number(existing.assignedAt) || 0) < SERVER_BOOT_TIME_MS) {
      deleteQuestTargetAssignment(safeProfileId, questId);
    } else {
    const ownerKey = questTargetOwnerByNpcId.get(existing.targetNpcId);
    const key = questTargetKey(safeProfileId, questId);
    const npc = npcs.get(existing.targetNpcId);
    if (npc && (!ownerKey || ownerKey === key)) {
      if (!npc.alive || npc.corpseState !== 'none') {
        respawnNpc(npc);
      }
      questTargetOwnerByNpcId.set(npc.id, key);
      const zone = buildQuestTargetZone(npc);
      const refreshed = persistQuestTargetAssignment({
        ...existing,
        targetNpcId: npc.id,
        zoneX: zone.zoneX,
        zoneY: zone.zoneY,
        zoneRadius: zone.zoneRadius,
        updatedAt: Date.now(),
      });
      if (refreshed) return refreshed;
      return {
        ...existing,
        targetNpcId: npc.id,
        zoneX: zone.zoneX,
        zoneY: zone.zoneY,
        zoneRadius: zone.zoneRadius,
      };
    }
    deleteQuestTargetAssignment(safeProfileId, questId);
    }
  }

  const npc = pickOrCreateQuestTargetNpc();
  if (!npc) return null;
  if (!npc.alive || npc.corpseState !== 'none') {
    respawnNpc(npc);
  }
  const zone = buildQuestTargetZone(npc);
  const now = Date.now();
  return persistQuestTargetAssignment({
    profileId: safeProfileId,
    questId,
    targetNpcId: npc.id,
    zoneX: zone.zoneX,
    zoneY: zone.zoneY,
    zoneRadius: zone.zoneRadius,
    assignedAt: now,
    updatedAt: now,
  });
}

function ensureQuestTargetCarForActiveEntry(player, activeEntry) {
  if (!player || !activeEntry) return null;
  if (activeEntry.actionType !== 'steal_target_car' || activeEntry.status !== 'active') return null;
  const safeProfileId = sanitizeProfileId(player.profileId);
  if (!safeProfileId) return null;
  const questId = activeEntry.id >>> 0;
  if (!questId) return null;

  const existing = readQuestTargetCarAssignment(safeProfileId, questId);
  if (existing) {
    if ((Number(existing.assignedAt) || 0) < SERVER_BOOT_TIME_MS) {
      deleteQuestTargetCarAssignment(safeProfileId, questId);
    } else {
      const ownerKey = questTargetCarOwnerByCarId.get(existing.targetCarId);
      const key = questTargetKey(safeProfileId, questId);
      const car = cars.get(existing.targetCarId);
      if (car && !car.destroyed && (!ownerKey || ownerKey === key)) {
        questTargetCarOwnerByCarId.set(car.id, key);
        const zone = buildQuestTargetCarZone(car);
        const refreshed = persistQuestTargetCarAssignment({
          ...existing,
          targetCarId: car.id,
          zoneX: zone.zoneX,
          zoneY: zone.zoneY,
          zoneRadius: zone.zoneRadius,
          updatedAt: Date.now(),
        });
        if (refreshed) return refreshed;
        return {
          ...existing,
          targetCarId: car.id,
          zoneX: zone.zoneX,
          zoneY: zone.zoneY,
          zoneRadius: zone.zoneRadius,
        };
      }
      deleteQuestTargetCarAssignment(safeProfileId, questId);
    }
  }

  const car = pickQuestTargetCar();
  if (!car) return null;
  const zone = buildQuestTargetCarZone(car);
  const now = Date.now();
  return persistQuestTargetCarAssignment({
    profileId: safeProfileId,
    questId,
    targetCarId: car.id,
    zoneX: zone.zoneX,
    zoneY: zone.zoneY,
    zoneRadius: zone.zoneRadius,
    assignedAt: now,
    updatedAt: now,
  });
}

function applyQuestTargetDataToEntries(player, entries) {
  const out = Array.isArray(entries)
    ? entries.map((entry) => ({
        ...entry,
        targetNpcId: '',
        targetCarId: '',
        targetZoneX: null,
        targetZoneY: null,
        targetZoneRadius: null,
      }))
    : [];
  player.activeQuestTargetNpcId = '';
  player.activeQuestTargetQuestId = 0;
  player.activeQuestTargetCarId = '';
  player.activeQuestTargetCarQuestId = 0;
  if (out.length === 0) return out;

  const activeTargetEntry = out.find((entry) => entry.status === 'active' && entry.actionType === 'kill_target_npc');
  const activeTargetCarEntry = out.find((entry) => entry.status === 'active' && entry.actionType === 'steal_target_car');
  pruneQuestTargetAssignmentsForPlayer(player.profileId, activeTargetEntry ? activeTargetEntry.id : 0);
  pruneQuestTargetCarAssignmentsForPlayer(player.profileId, activeTargetCarEntry ? activeTargetCarEntry.id : 0);

  if (activeTargetEntry) {
    const assignment = ensureQuestTargetForActiveEntry(player, activeTargetEntry);
    if (assignment) {
      activeTargetEntry.targetNpcId = assignment.targetNpcId;
      activeTargetEntry.targetZoneX = assignment.zoneX;
      activeTargetEntry.targetZoneY = assignment.zoneY;
      activeTargetEntry.targetZoneRadius = assignment.zoneRadius;
      player.activeQuestTargetNpcId = assignment.targetNpcId;
      player.activeQuestTargetQuestId = assignment.questId >>> 0;
    }
  }

  if (activeTargetCarEntry) {
    const assignment = ensureQuestTargetCarForActiveEntry(player, activeTargetCarEntry);
    if (assignment) {
      activeTargetCarEntry.targetCarId = assignment.targetCarId;
      activeTargetCarEntry.targetZoneX = assignment.zoneX;
      activeTargetCarEntry.targetZoneY = assignment.zoneY;
      activeTargetCarEntry.targetZoneRadius = assignment.zoneRadius;
      player.activeQuestTargetCarId = assignment.targetCarId;
      player.activeQuestTargetCarQuestId = assignment.questId >>> 0;
    }
  }
  return out;
}

function reloadActiveQuestCatalog() {
  if (!ensureCrimeReputationDb()) {
    activeQuestCatalog = [];
    return activeQuestCatalog;
  }
  try {
    const rows = questSql.listActive.all();
    activeQuestCatalog = rows.map(normalizeQuestRow).filter(Boolean);
    return activeQuestCatalog;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[quest] failed to load active quest catalog: ${error.message}`);
    activeQuestCatalog = [];
    return activeQuestCatalog;
  }
}

function listAllQuestDefinitions() {
  if (!ensureCrimeReputationDb()) return [];
  try {
    return questSql.listAll.all().map(normalizeQuestRow).filter(Boolean);
  } catch {
    return [];
  }
}

function ensurePlayerQuestProfile(profileId) {
  if (!ensureCrimeReputationDb()) return defaultQuestProfile(profileId);
  const safeProfileId = sanitizeProfileId(profileId);
  if (!safeProfileId) return defaultQuestProfile(profileId);
  const now = Date.now();
  try {
    const row = questSql.selectPlayerQuestProfile.get({ profileId: safeProfileId });
    const existing = normalizeQuestProfileRow(row, safeProfileId);
    if (existing) return existing;
    const next = defaultQuestProfile(safeProfileId);
    questSql.upsertPlayerQuestProfile.run({
      profileId: safeProfileId,
      reputation: next.reputation,
      gunShopUnlocked: next.gunShopUnlocked ? 1 : 0,
      updatedAt: now,
    });
    return { ...next, updatedAt: now };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[quest] failed to ensure quest profile for ${safeProfileId}: ${error.message}`);
    return defaultQuestProfile(safeProfileId);
  }
}

function upsertPlayerQuestProfile(profileId, reputation, gunShopUnlocked) {
  if (!ensureCrimeReputationDb()) return defaultQuestProfile(profileId);
  const safeProfileId = sanitizeProfileId(profileId);
  if (!safeProfileId) return defaultQuestProfile(profileId);
  const now = Date.now();
  const normalized = {
    profileId: safeProfileId,
    reputation: clamp(Math.round(Number(reputation) || 0), 0, 0xffffffff),
    gunShopUnlocked: !!gunShopUnlocked,
    updatedAt: now,
  };
  try {
    questSql.upsertPlayerQuestProfile.run({
      profileId: normalized.profileId,
      reputation: normalized.reputation,
      gunShopUnlocked: normalized.gunShopUnlocked ? 1 : 0,
      updatedAt: now,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[quest] failed to upsert quest profile for ${safeProfileId}: ${error.message}`);
  }
  return normalized;
}

function listQuestProgressByProfileId(profileId) {
  if (!ensureCrimeReputationDb()) return new Map();
  const safeProfileId = sanitizeProfileId(profileId);
  if (!safeProfileId) return new Map();
  const map = new Map();
  try {
    const rows = questSql.listProgressByProfileId.all({ profileId: safeProfileId });
    for (const row of rows) {
      const questId = Number(row.questId) >>> 0;
      if (!questId) continue;
      map.set(questId, {
        progress: clamp(Math.round(Number(row.progress) || 0), 0, 65535),
        completedAt: Number.isFinite(Number(row.completedAt)) ? Math.max(0, Math.round(Number(row.completedAt))) : 0,
      });
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[quest] failed to load quest progress for ${safeProfileId}: ${error.message}`);
  }
  return map;
}

function deriveQuestEntries(profileId) {
  const quests = Array.isArray(activeQuestCatalog) ? activeQuestCatalog : [];
  if (quests.length === 0) return [];
  const progressMap = listQuestProgressByProfileId(profileId);
  let activeAssigned = false;
  const out = [];
  for (const quest of quests) {
    const progressRow = progressMap.get(quest.id) || { progress: 0, completedAt: 0 };
    const progress = clampQuestProgress(progressRow.progress, quest.targetCount);
    const completed = !!progressRow.completedAt || progress >= quest.targetCount;
    let status = 'locked';
    if (completed) {
      status = 'completed';
    } else if (!activeAssigned) {
      status = 'active';
      activeAssigned = true;
    }
    out.push({
      id: quest.id,
      title: quest.title,
      description: quest.description,
      actionType: quest.actionType,
      targetCount: quest.targetCount,
      progress,
      status,
      statusCode: QUEST_STATUS_TO_CODE[status] ?? 0,
      rewardMoney: quest.rewardMoney,
      rewardReputation: quest.rewardReputation,
      rewardUnlockGunShop: quest.rewardUnlockGunShop,
      resetOnDeath: !!quest.resetOnDeath,
      completedAt: progressRow.completedAt || 0,
    });
  }
  return out;
}

function syncQuestStateToPlayer(player) {
  if (!player) return;
  const safeProfileId = sanitizeProfileId(player.profileId);
  if (!safeProfileId) {
    player.questReputation = 0;
    player.gunShopUnlocked = false;
    player.questEntries = [];
    player.activeQuestTargetNpcId = '';
    player.activeQuestTargetQuestId = 0;
    player.activeQuestTargetCarId = '';
    player.activeQuestTargetCarQuestId = 0;
    return;
  }
  const profile = ensurePlayerQuestProfile(safeProfileId);
  player.questReputation = profile.reputation;
  player.gunShopUnlocked = profile.gunShopUnlocked;
  player.questEntries = applyQuestTargetDataToEntries(player, deriveQuestEntries(safeProfileId));
}

function attachQuestStateToPlayer(player) {
  if (!player) return;
  if (!Array.isArray(activeQuestCatalog)) {
    activeQuestCatalog = [];
  }
  syncQuestStateToPlayer(player);
}

function hasActiveQuestsConfigured() {
  return Array.isArray(activeQuestCatalog) && activeQuestCatalog.length > 0;
}

function createQuestBootstrapForPlayer(player) {
  if (!player) return null;
  const entries = Array.isArray(player.questEntries) ? player.questEntries : [];
  return {
    reputation: clamp(Math.round(Number(player.questReputation) || 0), 0, 0xffffffff),
    gunShopUnlocked: !!player.gunShopUnlocked,
    quests: entries.map((entry) => ({
      id: entry.id >>> 0,
      actionType: entry.actionType,
      title: entry.title,
      description: entry.description,
      targetCount: clamp(Math.round(entry.targetCount || 0), 0, 65535),
      progress: clamp(Math.round(entry.progress || 0), 0, 65535),
      status: entry.status,
      rewardMoney: clamp(Math.round(entry.rewardMoney || 0), 0, 0xffffffff),
      rewardReputation: clamp(Math.round(entry.rewardReputation || 0), 0, 0xffffffff),
      rewardUnlockGunShop: !!entry.rewardUnlockGunShop,
      resetOnDeath: !!entry.resetOnDeath,
      targetZoneX: Number.isFinite(entry.targetZoneX) ? wrapWorldX(entry.targetZoneX) : 0,
      targetZoneY: Number.isFinite(entry.targetZoneY) ? wrapWorldY(entry.targetZoneY) : 0,
      targetZoneRadius: clamp(Math.round(Number(entry.targetZoneRadius) || 0), 0, 65535),
    })),
  };
}

function emitQuestSyncForPlayer(player) {
  if (!player || !player.id) return;
  emitEvent('questSync', {
    playerId: player.id,
    x: player.x,
    y: player.y,
    reputation: clamp(Math.round(Number(player.questReputation) || 0), 0, 0xffffffff),
    gunShopUnlocked: !!player.gunShopUnlocked,
    quests: (Array.isArray(player.questEntries) ? player.questEntries : []).map((entry) => ({
      id: entry.id >>> 0,
      progress: clamp(Math.round(entry.progress || 0), 0, 65535),
      statusCode: QUEST_STATUS_TO_CODE[entry.status] ?? 0,
      targetZoneX: Number.isFinite(entry.targetZoneX) ? wrapWorldX(entry.targetZoneX) : 0,
      targetZoneY: Number.isFinite(entry.targetZoneY) ? wrapWorldY(entry.targetZoneY) : 0,
      targetZoneRadius: clamp(Math.round(Number(entry.targetZoneRadius) || 0), 0, 65535),
    })),
  });
}

function rewardQuestCompletion(player, questEntry) {
  if (!player || !questEntry) return;
  const rewardMoney = clamp(Math.round(Number(questEntry.rewardMoney) || 0), 0, 0xffffffff);
  const rewardReputation = clamp(Math.round(Number(questEntry.rewardReputation) || 0), 0, 0xffffffff);
  if (rewardMoney > 0) {
    player.money = clamp(Math.round(Number(player.money) || 0) + rewardMoney, 0, 0xffffffff);
  }
  const currentReputation = clamp(Math.round(Number(player.questReputation) || 0), 0, 0xffffffff);
  const nextReputation = clamp(currentReputation + rewardReputation, 0, 0xffffffff);
  const nextUnlock = !!player.gunShopUnlocked || !!questEntry.rewardUnlockGunShop;
  const profile = upsertPlayerQuestProfile(player.profileId, nextReputation, nextUnlock);
  player.questReputation = profile.reputation;
  player.gunShopUnlocked = profile.gunShopUnlocked;
}

function incrementQuestAction(player, actionType, amount = 1) {
  if (!player || player.health <= 0) return;
  if (!ensureCrimeReputationDb()) return;
  if (!hasActiveQuestsConfigured()) return;
  if (!sanitizeProfileId(player.profileId)) return;
  const safeAction = normalizeQuestActionType(actionType);
  if (!safeAction) return;
  if (!Array.isArray(player.questEntries) || player.questEntries.length === 0) {
    syncQuestStateToPlayer(player);
  }
  const activeEntry = (player.questEntries || []).find((entry) => entry.status === 'active');
  if (!activeEntry || activeEntry.actionType !== safeAction) return;
  const gain = Math.max(1, Math.round(Number(amount) || 0));
  const targetCount = clamp(Math.round(activeEntry.targetCount || 0), 1, 65535);
  const previousProgress = clampQuestProgress(activeEntry.progress, targetCount);
  if (previousProgress >= targetCount) return;
  const nextProgress = clampQuestProgress(previousProgress + gain, targetCount);
  if (nextProgress === previousProgress) return;
  const completedAt = nextProgress >= targetCount ? Date.now() : 0;
  try {
    questSql.upsertProgress.run({
      profileId: player.profileId,
      questId: activeEntry.id >>> 0,
      progress: nextProgress,
      completedAt: completedAt || null,
      updatedAt: Date.now(),
    });
    if (completedAt) {
      rewardQuestCompletion(player, activeEntry);
    }
    syncQuestStateToPlayer(player);
    emitQuestSyncForPlayer(player);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[quest] failed to update quest progress: ${error.message}`);
  }
}

function resetQuestProgressOnDeath(player) {
  if (!player) return;
  if (!ensureCrimeReputationDb()) return;
  if (!hasActiveQuestsConfigured()) return;
  if (!sanitizeProfileId(player.profileId)) return;

  if (!Array.isArray(player.questEntries) || player.questEntries.length === 0) {
    syncQuestStateToPlayer(player);
  }
  const activeEntry = (player.questEntries || []).find((entry) => entry.status === 'active');
  if (!activeEntry || !activeEntry.resetOnDeath) return;

  const targetCount = clamp(Math.round(activeEntry.targetCount || 0), 1, 65535);
  const currentProgress = clampQuestProgress(activeEntry.progress, targetCount);
  if (currentProgress <= 0) return;

  try {
    questSql.upsertProgress.run({
      profileId: player.profileId,
      questId: activeEntry.id >>> 0,
      progress: 0,
      completedAt: null,
      updatedAt: Date.now(),
    });
    syncQuestStateToPlayer(player);
    emitQuestSyncForPlayer(player);
    sendNoticeToPlayer(player.id, false, `Quest reset on death: ${activeEntry.title}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[quest] failed to reset quest progress on death: ${error.message}`);
  }
}

function handleQuestTargetNpcDeath(npc, killerId = null) {
  if (!npc?.id) return;
  const ownerKey = questTargetOwnerByNpcId.get(npc.id);
  if (!ownerKey) return;
  const parsed = parseQuestTargetKey(ownerKey);
  if (!parsed) {
    questTargetOwnerByNpcId.delete(npc.id);
    return;
  }

  deleteQuestTargetAssignment(parsed.profileId, parsed.questId);
  const ownerPlayer = findOnlinePlayerByProfileId(parsed.profileId);
  if (!ownerPlayer) return;

  if (killerId && ownerPlayer.id === killerId) {
    incrementQuestAction(ownerPlayer, 'kill_target_npc', 1);
    return;
  }

  syncQuestStateToPlayer(ownerPlayer);
  emitQuestSyncForPlayer(ownerPlayer);
  sendNoticeToPlayer(ownerPlayer.id, false, 'Target eliminated by someone else. New area marked.');
}

function handleQuestTargetCarUnavailable(car, actorPlayerId = null) {
  if (!car?.id) return;
  const ownerKey = questTargetCarOwnerByCarId.get(car.id);
  if (!ownerKey) return;
  const parsed = parseQuestTargetKey(ownerKey);
  if (!parsed) {
    questTargetCarOwnerByCarId.delete(car.id);
    return;
  }

  deleteQuestTargetCarAssignment(parsed.profileId, parsed.questId);
  const ownerPlayer = findOnlinePlayerByProfileId(parsed.profileId);
  if (!ownerPlayer) return;

  syncQuestStateToPlayer(ownerPlayer);
  emitQuestSyncForPlayer(ownerPlayer);
  if (!(actorPlayerId && ownerPlayer.id === actorPlayerId)) {
    sendNoticeToPlayer(ownerPlayer.id, false, 'Target car changed. New area marked.');
  }
}

function handleQuestTargetCarEntered(car, driverPlayer) {
  if (!car?.id || !driverPlayer) return;
  const ownerKey = questTargetCarOwnerByCarId.get(car.id);
  if (!ownerKey) return;
  const parsed = parseQuestTargetKey(ownerKey);
  if (!parsed) {
    questTargetCarOwnerByCarId.delete(car.id);
    return;
  }

  const ownerPlayer = findOnlinePlayerByProfileId(parsed.profileId);
  if (ownerPlayer && ownerPlayer.id === driverPlayer.id) {
    incrementQuestAction(ownerPlayer, 'steal_target_car', 1);
    return;
  }
  handleQuestTargetCarUnavailable(car, driverPlayer.id);
}

function refreshQuestTargetCarZoneIfDue(assignment, car, nowMs) {
  if (!assignment || !car) return assignment;
  const lastUpdatedAt = Math.max(0, Math.round(Number(assignment.updatedAt) || 0));
  if (nowMs - lastUpdatedAt < QUEST_TARGET_ZONE_REFRESH_MS) return assignment;

  const next = persistQuestTargetCarAssignment({
    ...assignment,
    zoneX: wrapWorldX(car.x),
    zoneY: wrapWorldY(car.y),
    zoneRadius: Math.max(24, Number(assignment.zoneRadius) || QUEST_TARGET_ZONE_RADIUS),
    updatedAt: nowMs,
  });
  if (!next) return assignment;

  const ownerPlayer = findOnlinePlayerByProfileId(next.profileId);
  if (ownerPlayer && Array.isArray(ownerPlayer.questEntries)) {
    const entry = ownerPlayer.questEntries.find((item) => (item.id >>> 0) === (next.questId >>> 0));
    if (entry) {
      entry.targetCarId = next.targetCarId;
      entry.targetZoneX = next.zoneX;
      entry.targetZoneY = next.zoneY;
      entry.targetZoneRadius = next.zoneRadius;
    }
    emitQuestSyncForPlayer(ownerPlayer);
  }
  return next;
}

function stepQuestTargetCarTracking() {
  const nowMs = Date.now();
  for (const [key, assignment] of questTargetCarAssignmentsByKey.entries()) {
    const parsed = parseQuestTargetKey(key);
    if (!parsed) continue;
    const car = cars.get(assignment.targetCarId);
    if (!car || car.destroyed) {
      deleteQuestTargetCarAssignment(parsed.profileId, parsed.questId);
      const ownerPlayer = findOnlinePlayerByProfileId(parsed.profileId);
      if (ownerPlayer) {
        syncQuestStateToPlayer(ownerPlayer);
        emitQuestSyncForPlayer(ownerPlayer);
      }
      continue;
    }
    refreshQuestTargetCarZoneIfDue(assignment, car, nowMs);
  }
}

function refreshAllOnlinePlayerQuestState(emitSync = false) {
  for (const player of players.values()) {
    syncQuestStateToPlayer(player);
    if (emitSync) {
      emitQuestSyncForPlayer(player);
    }
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

function trackPlayerSessionJoin(player) {
  if (!player) return;
  const profileId = resolveCrimeProfileIdForJoin(player.name, player.profileId);
  if (!profileId) return;
  const safeName = sanitizeName(player.name) || `Profile ${crimeProfileTag(profileId)}`;
  const now = Date.now();
  player.sessionStartedAt = now;
  if (!ensureCrimeReputationDb() || !playerStatsSql.upsertOnJoin) return;
  try {
    playerStatsSql.upsertOnJoin.run({
      profileId,
      name: safeName,
      lastEnteredAt: now,
      longestSessionMs: 0,
      updatedAt: now,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[stats] failed to mark join for ${profileId}: ${error.message}`);
  }
}

function trackPlayerSessionDisconnect(player) {
  if (!player) return;
  const profileId = resolveCrimeProfileIdForJoin(player.name, player.profileId);
  if (!profileId) return;
  const safeName = sanitizeName(player.name) || `Profile ${crimeProfileTag(profileId)}`;
  const now = Date.now();
  const sessionStartedAt = Math.max(0, Math.round(Number(player.sessionStartedAt) || 0));
  const sessionMs = sessionStartedAt > 0 ? Math.max(0, now - sessionStartedAt) : 0;
  player.sessionStartedAt = 0;
  if (!ensureCrimeReputationDb() || !playerStatsSql.upsertSessionDuration) return;
  try {
    playerStatsSql.upsertSessionDuration.run({
      profileId,
      name: safeName,
      lastEnteredAt: sessionStartedAt > 0 ? sessionStartedAt : now,
      sessionMs,
      updatedAt: now,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[stats] failed to store session for ${profileId}: ${error.message}`);
  }
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

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseBasicAuthHeader(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const trimmed = headerValue.trim();
  if (!trimmed.toLowerCase().startsWith('basic ')) return null;
  const encoded = trimmed.slice(6).trim();
  if (!encoded) return null;
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx <= 0) return null;
    return {
      user: decoded.slice(0, idx),
      pass: decoded.slice(idx + 1),
    };
  } catch {
    return null;
  }
}

function parseCookieHeader(headerValue) {
  if (typeof headerValue !== 'string' || !headerValue.trim()) return {};
  const out = {};
  for (const pair of headerValue.split(';')) {
    const item = String(pair || '').trim();
    if (!item) continue;
    const idx = item.indexOf('=');
    if (idx <= 0) continue;
    const key = item.slice(0, idx).trim();
    const value = item.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function cleanupExpiredAdminSessions(now = Date.now()) {
  for (const [token, record] of adminSessions.entries()) {
    if (!record || !Number.isFinite(record.expiresAt) || record.expiresAt <= now) {
      adminSessions.delete(token);
    }
  }
}

function issueAdminSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  adminSessions.set(token, {
    user: String(user || ''),
    expiresAt: Date.now() + ADMIN_SESSION_TTL_MS,
  });
  return token;
}

function setAdminSessionCookie(res, token) {
  const maxAgeSec = Math.max(1, Math.round(ADMIN_SESSION_TTL_MS / 1000));
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`
  );
}

function clearAdminSessionCookie(res) {
  res.setHeader('Set-Cookie', `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function validateAdminCredentials(user, pass) {
  if (!ADMIN_AUTH_ENABLED) return false;
  const userOk = timingSafeEqualText(user, ADMIN_AUTH_USER);
  const passOk = timingSafeEqualText(pass, ADMIN_AUTH_PASS);
  return userOk && passOk;
}

function resolveAdminAuthState(req) {
  cleanupExpiredAdminSessions();
  const cookies = parseCookieHeader(req.headers.cookie);
  const token = String(cookies[ADMIN_SESSION_COOKIE] || '').trim();
  if (token) {
    const session = adminSessions.get(token);
    if (session && session.expiresAt > Date.now()) {
      return {
        ok: true,
        user: session.user || 'admin',
        token,
      };
    }
    if (session) adminSessions.delete(token);
  }

  const parsedBasic = parseBasicAuthHeader(req.headers.authorization);
  if (parsedBasic && validateAdminCredentials(parsedBasic.user, parsedBasic.pass)) {
    const newToken = issueAdminSession(parsedBasic.user);
    return {
      ok: true,
      user: parsedBasic.user,
      token: newToken,
      freshSession: true,
    };
  }

  return { ok: false };
}

function requireAdminPageAuth(req, res, next) {
  if (!ADMIN_AUTH_ENABLED) {
    res.status(503).send('Admin panel disabled: set ADMIN_USER and ADMIN_PASS.');
    return;
  }

  const authState = resolveAdminAuthState(req);
  if (!authState.ok) {
    res.redirect('/admin');
    return;
  }

  if (authState.freshSession && authState.token) {
    setAdminSessionCookie(res, authState.token);
  }
  next();
}

function requireAdminApiAuth(req, res, next) {
  if (!ADMIN_AUTH_ENABLED) {
    res.status(503).json({ ok: false, error: 'Admin panel disabled: set ADMIN_USER and ADMIN_PASS.' });
    return;
  }

  const authState = resolveAdminAuthState(req);
  if (!authState.ok) {
    res.status(401).json({ ok: false, error: 'Authentication required' });
    return;
  }

  if (authState.freshSession && authState.token) {
    setAdminSessionCookie(res, authState.token);
  }
  next();
}

function normalizeQuestInput(payload, fallbackSortOrder = 0) {
  if (!payload || typeof payload !== 'object') return null;
  const rawQuestKey = payload.questKey;
  const questKeyProvided = rawQuestKey !== undefined && rawQuestKey !== null;
  const questKey = questKeyProvided ? sanitizeQuestKey(String(rawQuestKey || '')) : '';
  if (questKeyProvided && !questKey) return null;
  const title = String(payload.title || '').trim().slice(0, 80);
  const description = String(payload.description || '').trim().slice(0, 400);
  const actionType = normalizeQuestActionType(payload.actionType);
  const actionParamsSource =
    payload.actionParamsJson !== undefined ? payload.actionParamsJson : payload.actionParams;
  const actionParams = normalizeQuestJsonObject(actionParamsSource, {});
  const rawTargetCount = Number(payload.targetCount);
  if (!Number.isFinite(rawTargetCount)) return null;
  const targetCount = Math.round(rawTargetCount);
  if (!Number.isInteger(targetCount) || targetCount <= 0 || targetCount > 65535) return null;
  const sortOrder = clamp(
    Math.round(Number.isFinite(Number(payload.sortOrder)) ? Number(payload.sortOrder) : fallbackSortOrder),
    -2147483648,
    2147483647
  );
  const rawRewardPayload =
    payload.rewardPayloadJson !== undefined ? payload.rewardPayloadJson : payload.rewardPayload;
  const parsedRewardPayload = normalizeQuestJsonObject(rawRewardPayload, {});
  const rawRewardMoney = Number.isFinite(Number(payload.rewardMoney))
    ? Number(payload.rewardMoney)
    : Number(parsedRewardPayload.money || 0);
  const rewardMoney = Math.round(rawRewardMoney);
  if (!Number.isInteger(rewardMoney) || rewardMoney < 0 || rewardMoney > 0xffffffff) return null;
  const rawRewardReputation = Number.isFinite(Number(payload.rewardReputation))
    ? Number(payload.rewardReputation)
    : Number(parsedRewardPayload.reputation || 0);
  const rewardReputation = Math.round(rawRewardReputation);
  if (!Number.isInteger(rewardReputation) || rewardReputation < 0 || rewardReputation > 0xffffffff) return null;
  const rewardUnlockGunShop =
    payload.rewardUnlockGunShop == null ? !!parsedRewardPayload.unlockGunShop : !!payload.rewardUnlockGunShop;
  const rewardPayload = normalizeQuestRewardPayloadObject(
    parsedRewardPayload,
    rewardMoney,
    rewardReputation,
    rewardUnlockGunShop
  );
  const resetOnDeath = !!payload.resetOnDeath;
  const isActive = payload.isActive == null ? true : !!payload.isActive;
  if (!title || !actionType) return null;
  return {
    questKey,
    title,
    description,
    actionType,
    actionParams,
    actionParamsJson: stringifyQuestJsonObject(actionParams, {}),
    targetCount,
    sortOrder,
    rewardMoney,
    rewardReputation,
    rewardUnlockGunShop,
    rewardPayload,
    rewardPayloadJson: stringifyQuestJsonObject(rewardPayload, {}),
    resetOnDeath,
    isActive,
  };
}

function questCoreDefinitionChanged(previousQuest, nextQuestInput) {
  if (!previousQuest || !nextQuestInput) return false;
  if (String(previousQuest.actionType || '') !== String(nextQuestInput.actionType || '')) return true;
  if ((Number(previousQuest.targetCount) >>> 0) !== (Number(nextQuestInput.targetCount) >>> 0)) return true;
  const prevActionParams = stringifyQuestJsonObject(previousQuest.actionParams, {});
  const nextActionParams = stringifyQuestJsonObject(nextQuestInput.actionParams, {});
  return prevActionParams !== nextActionParams;
}

function serializeQuestForAdmin(quest) {
  if (!quest) return null;
  return {
    id: quest.id >>> 0,
    questKey: String(quest.questKey || ''),
    title: quest.title,
    description: quest.description,
    actionType: quest.actionType,
    actionParams: normalizeQuestJsonObject(quest.actionParams, {}),
    targetCount: quest.targetCount,
    sortOrder: quest.sortOrder,
    rewardMoney: quest.rewardMoney,
    rewardReputation: quest.rewardReputation,
    rewardUnlockGunShop: !!quest.rewardUnlockGunShop,
    rewardPayload: normalizeQuestRewardPayloadObject(
      quest.rewardPayload,
      quest.rewardMoney,
      quest.rewardReputation,
      !!quest.rewardUnlockGunShop
    ),
    resetOnDeath: !!quest.resetOnDeath,
    isActive: !!quest.isActive,
    createdAt: quest.createdAt || 0,
    updatedAt: quest.updatedAt || 0,
  };
}

function sendNoticeToPlayer(playerId, ok, message) {
  if (!playerId) return;
  for (const [ws, client] of clients.entries()) {
    if (!client || client.playerId !== playerId) continue;
    if (ws.readyState !== WebSocket.OPEN) continue;
    ws.send(encodeNoticeFrame(!!ok, String(message || '')));
    break;
  }
}

function applyQuestCatalogReloadAndResync() {
  reloadActiveQuestCatalog();
  refreshAllOnlinePlayerQuestState(true);
}

app.get('/runtime-config.js', (_req, res) => {
  const consentPublisher = normalizeAdSensePublisherForAdsTxt(GOOGLE_FC_PUBLISHER);
  const payload = {
    adsense: {
      client: ADSENSE_CLIENT,
      joinSlot: ADSENSE_JOIN_SLOT,
      enabled: ADSENSE_CLIENT.length > 0 && ADSENSE_JOIN_SLOT.length > 0,
    },
    consent: {
      googleFcPublisher: consentPublisher,
      enabled: consentPublisher.length > 0,
    },
    contactEmail: safeContactEmail(SITE_CONTACT_EMAIL),
  };
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(`window.__PCC_RUNTIME_CONFIG__ = ${JSON.stringify(payload)};\n`);
});

app.use(['/admin', '/api/admin'], (_req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
});

app.get('/ads.txt', (_req, res) => {
  const lines = [];
  const pushUniqueLine = (line) => {
    if (!line) return;
    if (lines.includes(line)) return;
    lines.push(line);
  };
  const fileLines = loadAdsTxtFileLines();
  fileLines.forEach(pushUniqueLine);
  const normalizedPub = normalizeAdSensePublisherForAdsTxt(ADSENSE_CLIENT);
  if (normalizedPub) {
    pushUniqueLine(`google.com, ${normalizedPub}, DIRECT, f08c47fec0942fa0`);
  }
  const extraLines = splitAdsTxtLines(ADS_TXT_LINES);
  if (extraLines.length > 0) {
    extraLines.forEach(pushUniqueLine);
  }
  if (lines.length === 0) {
    lines.push('# Configure public/ads.txt, ADSENSE_CLIENT, or ADS_TXT_LINES to publish ads.txt records.');
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=1800');
  res.send(`${lines.join('\n')}\n`);
});

app.get('/robots.txt', (req, res) => {
  const sitemapUrl = absolutePublicUrl(req, '/sitemap.xml');
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /admin/',
    'Disallow: /api/admin',
    'Disallow: /api/admin/',
    `Sitemap: ${sitemapUrl}`,
    '',
  ];
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=1800');
  res.send(lines.join('\n'));
});

app.get('/sitemap.xml', (req, res) => {
  const pages = ['/', '/privacy-policy', '/terms', '/contact'];
  const lastModified = new Date(SERVER_BOOT_TIME_MS).toISOString();
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...pages.flatMap((pathname, index) => {
      const priority = index === 0 ? '1.0' : '0.4';
      const changefreq = index === 0 ? 'daily' : 'monthly';
      return [
        '  <url>',
        `    <loc>${escapeXml(absolutePublicUrl(req, pathname))}</loc>`,
        `    <lastmod>${lastModified}</lastmod>`,
        `    <changefreq>${changefreq}</changefreq>`,
        `    <priority>${priority}</priority>`,
        '  </url>',
      ];
    }),
    '</urlset>',
    '',
  ].join('\n');
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=1800');
  res.send(xml);
});

app.get('/privacy-policy', (_req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, 'public', 'privacy-policy.html'));
});

app.get('/terms', (_req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, 'public', 'terms.html'));
});

app.get('/contact', (_req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, 'public', 'contact.html'));
});

app.get('/admin', (req, res) => {
  if (!ADMIN_AUTH_ENABLED) {
    res.status(503).send('Admin panel disabled: set ADMIN_USER and ADMIN_PASS.');
    return;
  }
  const authState = resolveAdminAuthState(req);
  if (authState.ok) {
    if (authState.freshSession && authState.token) {
      setAdminSessionCookie(res, authState.token);
    }
    res.redirect('/admin/quests');
    return;
  }
  res.sendFile(path.join(PROJECT_ROOT, 'public', 'admin-login.html'));
});

app.get('/admin/quests', requireAdminPageAuth, (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, 'public', 'admin-quests.html'));
});

app.get('/admin/player-stats', requireAdminPageAuth, (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, 'public', 'admin-player-stats.html'));
});

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_AUTH_ENABLED) {
    res.status(503).json({ ok: false, error: 'Admin panel disabled: set ADMIN_USER and ADMIN_PASS.' });
    return;
  }
  const user = String(req.body?.user || '').trim();
  const pass = String(req.body?.pass || '');
  if (!validateAdminCredentials(user, pass)) {
    res.status(401).json({ ok: false, error: 'Invalid credentials' });
    return;
  }
  const token = issueAdminSession(user);
  setAdminSessionCookie(res, token);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  const cookies = parseCookieHeader(req.headers.cookie);
  const token = String(cookies[ADMIN_SESSION_COOKIE] || '').trim();
  if (token) {
    adminSessions.delete(token);
  }
  clearAdminSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  if (!ADMIN_AUTH_ENABLED) {
    res.status(503).json({ ok: false, enabled: false, authenticated: false });
    return;
  }
  const authState = resolveAdminAuthState(req);
  if (authState.ok && authState.freshSession && authState.token) {
    setAdminSessionCookie(res, authState.token);
  }
  res.json({ ok: true, enabled: true, authenticated: !!authState.ok });
});

app.get('/api/admin/player-stats', requireAdminApiAuth, (req, res) => {
  if (!ensureCrimeReputationDb()) {
    res.status(503).json({
      page: 1,
      pageSize: ADMIN_PLAYER_STATS_DEFAULT_PAGE_SIZE,
      total: 0,
      totalPages: 1,
      query: '',
      players: [],
      error: 'Player stats store unavailable',
    });
    return;
  }

  const requestedPage = Number.parseInt(String(req.query.page || '1'), 10);
  const requestedPageSize = Number.parseInt(String(req.query.pageSize || ADMIN_PLAYER_STATS_DEFAULT_PAGE_SIZE), 10);
  const searchQuery = normalizeCrimeBoardSearchQuery(String(req.query.q || ''));
  const hasSearch = searchQuery.length > 0;
  const nameLike = `%${escapeSqlLikePattern(searchQuery)}%`;
  const pageSize = clamp(
    Number.isFinite(requestedPageSize) ? requestedPageSize : ADMIN_PLAYER_STATS_DEFAULT_PAGE_SIZE,
    1,
    ADMIN_PLAYER_STATS_MAX_PAGE_SIZE
  );

  try {
    const total = Number(
      hasSearch ? playerStatsSql.countByName.get({ nameLike })?.total : playerStatsSql.countAll.get()?.total
    ) || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = clamp(Number.isFinite(requestedPage) ? requestedPage : 1, 1, totalPages);
    const start = (page - 1) * pageSize;
    const rows =
      total > 0
        ? hasSearch
          ? playerStatsSql.listPageByName.all({ nameLike, limit: pageSize, offset: start })
          : playerStatsSql.listPage.all({ limit: pageSize, offset: start })
        : [];

    res.json({
      page,
      pageSize,
      total,
      totalPages,
      query: searchQuery,
      players: rows.map((row) => normalizePlayerStatsRow(row)).filter(Boolean),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[stats] failed to query admin player stats: ${error.message}`);
    res.status(500).json({
      page: 1,
      pageSize,
      total: 0,
      totalPages: 1,
      query: searchQuery,
      players: [],
      error: 'Player stats query failed',
    });
  }
});

app.get('/api/admin/quests', requireAdminApiAuth, (req, res) => {
  if (!ensureCrimeReputationDb()) {
    res.status(503).json({ error: 'Quest store unavailable', quests: [] });
    return;
  }
  const quests = listAllQuestDefinitions().map(serializeQuestForAdmin).filter(Boolean);
  res.json({ quests });
});

app.post('/api/admin/quests', requireAdminApiAuth, (req, res) => {
  if (!ensureCrimeReputationDb()) {
    res.status(503).json({ ok: false, error: 'Quest store unavailable' });
    return;
  }
  const quests = listAllQuestDefinitions();
  const fallbackSortOrder = quests.length > 0 ? quests[quests.length - 1].sortOrder + 10 : 10;
  const input = normalizeQuestInput(req.body, fallbackSortOrder);
  if (!input) {
    res.status(400).json({ ok: false, error: 'Invalid quest payload' });
    return;
  }
  const now = Date.now();
  try {
    const questKey = buildUniqueQuestKey(input.questKey, input.title);
    const result = questSql.insert.run({
      questKey,
      title: input.title,
      description: input.description,
      actionType: input.actionType,
      actionParamsJson: input.actionParamsJson,
      targetCount: input.targetCount,
      sortOrder: input.sortOrder,
      rewardMoney: input.rewardMoney,
      rewardReputation: input.rewardReputation,
      rewardUnlockGunShop: input.rewardUnlockGunShop ? 1 : 0,
      rewardPayloadJson: input.rewardPayloadJson,
      resetOnDeath: input.resetOnDeath ? 1 : 0,
      isActive: input.isActive ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
    applyQuestCatalogReloadAndResync();
    const created = normalizeQuestRow(questSql.getById.get({ id: Number(result.lastInsertRowid) }));
    res.json({ ok: true, quest: serializeQuestForAdmin(created) });
  } catch (error) {
    res.status(500).json({ ok: false, error: `Create failed: ${error.message}` });
  }
});

app.put('/api/admin/quests/:id', requireAdminApiAuth, (req, res) => {
  if (!ensureCrimeReputationDb()) {
    res.status(503).json({ ok: false, error: 'Quest store unavailable' });
    return;
  }
  const id = Number.parseInt(String(req.params.id || '0'), 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ ok: false, error: 'Invalid quest id' });
    return;
  }
  const existing = normalizeQuestRow(questSql.getById.get({ id }));
  if (!existing) {
    res.status(404).json({ ok: false, error: 'Quest not found' });
    return;
  }
  const input = normalizeQuestInput(
    {
      title: req.body?.title ?? existing.title,
      questKey: req.body?.questKey ?? existing.questKey,
      description: req.body?.description ?? existing.description,
      actionType: req.body?.actionType ?? existing.actionType,
      actionParams: req.body?.actionParams ?? existing.actionParams,
      targetCount: req.body?.targetCount ?? existing.targetCount,
      sortOrder: req.body?.sortOrder ?? existing.sortOrder,
      rewardMoney: req.body?.rewardMoney ?? existing.rewardMoney,
      rewardReputation: req.body?.rewardReputation ?? existing.rewardReputation,
      rewardUnlockGunShop: req.body?.rewardUnlockGunShop ?? existing.rewardUnlockGunShop,
      rewardPayload: req.body?.rewardPayload ?? existing.rewardPayload,
      resetOnDeath: req.body?.resetOnDeath ?? existing.resetOnDeath,
      isActive: req.body?.isActive ?? existing.isActive,
    },
    existing.sortOrder
  );
  if (!input) {
    res.status(400).json({ ok: false, error: 'Invalid quest payload' });
    return;
  }
  const shouldResetProgress = questCoreDefinitionChanged(existing, input);
  try {
    const questKey = buildUniqueQuestKey(input.questKey || existing.questKey, input.title, id);
    const tx = crimeReputationDb.transaction((questId) => {
      questSql.update.run({
        id: questId,
        questKey,
        title: input.title,
        description: input.description,
        actionType: input.actionType,
        actionParamsJson: input.actionParamsJson,
        targetCount: input.targetCount,
        sortOrder: input.sortOrder,
        rewardMoney: input.rewardMoney,
        rewardReputation: input.rewardReputation,
        rewardUnlockGunShop: input.rewardUnlockGunShop ? 1 : 0,
        rewardPayloadJson: input.rewardPayloadJson,
        resetOnDeath: input.resetOnDeath ? 1 : 0,
        isActive: input.isActive ? 1 : 0,
        updatedAt: Date.now(),
      });
      if (shouldResetProgress) {
        questSql.deleteProgressByQuestId.run({ questId });
        questSql.deleteTargetsByQuestId.run({ questId });
        questSql.deleteCarTargetsByQuestId.run({ questId });
        uncacheQuestAssignmentsByQuestId(questId);
      }
    });
    tx(id);
    applyQuestCatalogReloadAndResync();
    const updated = normalizeQuestRow(questSql.getById.get({ id }));
    res.json({ ok: true, quest: serializeQuestForAdmin(updated), progressReset: shouldResetProgress });
  } catch (error) {
    res.status(500).json({ ok: false, error: `Update failed: ${error.message}` });
  }
});

app.delete('/api/admin/quests/:id', requireAdminApiAuth, (req, res) => {
  if (!ensureCrimeReputationDb()) {
    res.status(503).json({ ok: false, error: 'Quest store unavailable' });
    return;
  }
  const id = Number.parseInt(String(req.params.id || '0'), 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ ok: false, error: 'Invalid quest id' });
    return;
  }
  try {
    const tx = crimeReputationDb.transaction((questId) => {
      questSql.deleteProgressByQuestId.run({ questId });
      questSql.deleteTargetsByQuestId.run({ questId });
      questSql.deleteCarTargetsByQuestId.run({ questId });
      uncacheQuestAssignmentsByQuestId(questId);
      questSql.delete.run({ id: questId });
    });
    tx(id);
    applyQuestCatalogReloadAndResync();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: `Delete failed: ${error.message}` });
  }
});

app.post('/api/admin/quests/reorder', requireAdminApiAuth, (req, res) => {
  if (!ensureCrimeReputationDb()) {
    res.status(503).json({ ok: false, error: 'Quest store unavailable' });
    return;
  }
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (ids.length === 0) {
    res.status(400).json({ ok: false, error: 'ids array is required' });
    return;
  }
  const normalizedIds = ids
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isInteger(value) && value > 0);
  if (normalizedIds.length !== ids.length) {
    res.status(400).json({ ok: false, error: 'ids must be positive integers' });
    return;
  }
  try {
    const tx = crimeReputationDb.transaction((orderedIds) => {
      const now = Date.now();
      let order = 10;
      for (const id of orderedIds) {
        questSql.updateSortOrder.run({ id, sortOrder: order, updatedAt: now });
        order += 10;
      }
    });
    tx(normalizedIds);
    applyQuestCatalogReloadAndResync();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: `Reorder failed: ${error.message}` });
  }
});

app.get('/api/crime-leaderboard', (req, res) => {
  if (!ensureCrimeReputationDb()) {
    res.status(503).json({
      page: 1,
      pageSize: CRIME_BOARD_DEFAULT_PAGE_SIZE,
      total: 0,
      totalPages: 1,
      query: '',
      players: [],
      error: 'Crime store unavailable',
    });
    return;
  }

  const requestedPage = Number.parseInt(String(req.query.page || '1'), 10);
  const requestedPageSize = Number.parseInt(String(req.query.pageSize || CRIME_BOARD_DEFAULT_PAGE_SIZE), 10);
  const searchQuery = normalizeCrimeBoardSearchQuery(String(req.query.q || ''));
  const hasSearch = searchQuery.length > 0;
  const nameLike = `%${escapeSqlLikePattern(searchQuery)}%`;
  const pageSize = clamp(
    Number.isFinite(requestedPageSize) ? requestedPageSize : CRIME_BOARD_DEFAULT_PAGE_SIZE,
    1,
    CRIME_BOARD_MAX_PAGE_SIZE
  );

  try {
    const total = Number(
      hasSearch
        ? crimeReputationSql.countByName.get({ nameLike })?.total
        : crimeReputationSql.countAll.get()?.total
    ) || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = clamp(Number.isFinite(requestedPage) ? requestedPage : 1, 1, totalPages);
    const start = (page - 1) * pageSize;
    const onlineIds = onlineCrimeProfileIds();
    const rows =
      total > 0
        ? hasSearch
          ? crimeReputationSql.listPageByName.all({ nameLike, limit: pageSize, offset: start })
          : crimeReputationSql.listPage.all({ limit: pageSize, offset: start })
        : [];

    res.json({
      page,
      pageSize,
      total,
      totalPages,
      query: searchQuery,
      players: rows
        .map((row, index) => {
          const record = crimeRecordFromRow(row, row.profileId);
          if (!record) return null;
          return {
            rank: start + index + 1,
            name: record.name,
            crimeRating: clampCrimeRating(record.crimeRating),
            score: clampCrimeRating(record.crimeRating),
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
      query: searchQuery,
      players: [],
      error: 'Crime leaderboard query failed',
    });
  }
});

app.get('/api/reputation-leaderboard', (req, res) => {
  if (!ensureCrimeReputationDb()) {
    res.status(503).json({
      page: 1,
      pageSize: REPUTATION_BOARD_DEFAULT_PAGE_SIZE,
      total: 0,
      totalPages: 1,
      query: '',
      players: [],
      error: 'Reputation store unavailable',
    });
    return;
  }

  const requestedPage = Number.parseInt(String(req.query.page || '1'), 10);
  const requestedPageSize = Number.parseInt(String(req.query.pageSize || REPUTATION_BOARD_DEFAULT_PAGE_SIZE), 10);
  const searchQuery = normalizeQuestBoardSearchQuery(String(req.query.q || ''));
  const hasSearch = searchQuery.length > 0;
  const nameLike = `%${escapeSqlLikePattern(searchQuery)}%`;
  const pageSize = clamp(
    Number.isFinite(requestedPageSize) ? requestedPageSize : REPUTATION_BOARD_DEFAULT_PAGE_SIZE,
    1,
    REPUTATION_BOARD_MAX_PAGE_SIZE
  );

  try {
    const total = Number(
      hasSearch
        ? questSql.countQuestProfileByName.get({ nameLike })?.total
        : questSql.countQuestProfileAll.get()?.total
    ) || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = clamp(Number.isFinite(requestedPage) ? requestedPage : 1, 1, totalPages);
    const start = (page - 1) * pageSize;
    const onlineIds = onlineCrimeProfileIds();
    const rows =
      total > 0
        ? hasSearch
          ? questSql.listQuestProfilePageByName.all({ nameLike, limit: pageSize, offset: start })
          : questSql.listQuestProfilePage.all({ limit: pageSize, offset: start })
        : [];

    res.json({
      page,
      pageSize,
      total,
      totalPages,
      query: searchQuery,
      players: rows
        .map((row, index) => {
          const profileId = sanitizeProfileId(row.profileId);
          if (!profileId) return null;
          const name = sanitizeName(row.name) || `Profile ${crimeProfileTag(profileId)}`;
          const color = normalizeHexColor(row.lastColor, '#58d2ff');
          const reputation = clamp(Math.round(Number(row.reputation) || 0), 0, 0xffffffff);
          return {
            rank: start + index + 1,
            name,
            reputation,
            score: reputation,
            color,
            profileTag: crimeProfileTag(profileId),
            online: onlineIds.has(profileId),
          };
        })
        .filter(Boolean),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[quest] failed to query reputation leaderboard: ${error.message}`);
    res.status(500).json({
      page: 1,
      pageSize,
      total: 0,
      totalPages: 1,
      query: searchQuery,
      players: [],
      error: 'Reputation leaderboard query failed',
    });
  }
});

process.on('exit', () => {
  closeCrimeReputationStore();
});

app.get('/', (_req, res, next) => {
  const template = getIndexHtmlTemplate();
  if (!template) {
    next();
    return;
  }
  const adSenseVerifyScript = buildAdSenseVerifyScriptTag();
  let html = template;
  if (html.includes('<!-- ADSENSE_VERIFY_SCRIPT -->')) {
    html = html.replace('<!-- ADSENSE_VERIFY_SCRIPT -->', adSenseVerifyScript);
  } else if (adSenseVerifyScript) {
    html = html.replace('</head>', `  ${adSenseVerifyScript}\n  </head>`);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.use(express.static(path.join(PROJECT_ROOT, 'public')));

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

function findGarageById(id) {
  if (!id) return null;
  for (const garage of GARAGES) {
    if (garage.id === id) return garage;
  }
  return null;
}

function findInteriorById(id) {
  return findShopById(id) || findGarageById(id);
}

function isGarageId(id) {
  return typeof id === 'string' && id.startsWith('garage_');
}

function interiorBuildingRectCenterAndHalfSize(interior) {
  if (!interior || !Number.isFinite(interior.x) || !Number.isFinite(interior.y)) return null;
  const worldX = wrapWorldX(interior.x);
  const worldY = wrapWorldY(interior.y);
  const blockX = Math.floor(worldX / BLOCK_PX);
  const blockY = Math.floor(worldY / BLOCK_PX);
  const localX = mod(worldX, BLOCK_PX);
  const localY = mod(worldY, BLOCK_PX);
  const plotIndex = plotIndexForLocalCoord(localX, localY);
  if (plotIndex === null) return null;
  const rect = centeredBuildingRectForPlot(blockX, blockY, plotIndex);
  if (!rect) return null;
  const halfW = Math.max(1, (rect.x1 - rect.x0) * 0.5);
  const halfH = Math.max(1, (rect.y1 - rect.y0) * 0.5);
  return {
    centerX: blockX * BLOCK_PX + (rect.x0 + rect.x1) * 0.5,
    centerY: blockY * BLOCK_PX + (rect.y0 + rect.y1) * 0.5,
    halfW,
    halfH,
  };
}

function distanceSqToInteriorBuildingRect(x, y, interior) {
  const rect = interiorBuildingRectCenterAndHalfSize(interior);
  if (!rect) return Infinity;
  const relX = wrapDelta(x - rect.centerX, WORLD.width);
  const relY = wrapDelta(y - rect.centerY, WORLD.height);
  const dx = Math.max(0, Math.abs(relX) - rect.halfW);
  const dy = Math.max(0, Math.abs(relY) - rect.halfH);
  return dx * dx + dy * dy;
}

function findNearbyShop(player, maxDistance) {
  const maxDistSq = maxDistance * maxDistance;
  for (const shop of SHOPS) {
    const nearBuildingSq = distanceSqToInteriorBuildingRect(player.x, player.y, shop);
    if (nearBuildingSq <= maxDistSq) {
      return shop;
    }
  }
  return null;
}

function findNearbyGarageEntrance(player, maxDistance = 88, requireBottomApproach = false) {
  const maxDistSq = maxDistance * maxDistance;
  for (const garage of GARAGES) {
    const entryX = garage.x;
    const entryY = garage.y + 58;
    const dx = player.x - entryX;
    const dy = player.y - entryY;
    if (dx * dx + dy * dy > maxDistSq) continue;
    if (requireBottomApproach) {
      if (dy < -24) continue;
      if (Math.abs(dx) > 84) continue;
    }
    return garage;
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

function orderedHospitalsByDistance(x, y) {
  const hospitals = Array.isArray(HOSPITALS) && HOSPITALS.length > 0 ? HOSPITALS.slice() : HOSPITAL ? [HOSPITAL] : [];
  if (!Number.isFinite(x) || !Number.isFinite(y) || hospitals.length <= 1) {
    return hospitals;
  }
  hospitals.sort(
    (a, b) => wrappedDistanceSq(x, y, a.x, a.y) - wrappedDistanceSq(x, y, b.x, b.y)
  );
  return hospitals;
}

function nearestHospitalTo(x, y) {
  const hospitals = orderedHospitalsByDistance(x, y);
  return hospitals.length > 0 ? hospitals[0] : null;
}

function hospitalSpawnAnchors(hospital) {
  if (!hospital) return [];
  const releaseX = Number.isFinite(hospital.releaseX) ? hospital.releaseX : hospital.x;
  const releaseY = Number.isFinite(hospital.releaseY) ? hospital.releaseY : hospital.y;
  const dropX = Number.isFinite(hospital.dropX) ? hospital.dropX : hospital.x;
  const dropY = Number.isFinite(hospital.dropY) ? hospital.dropY : hospital.y;
  return [
    { x: releaseX, y: releaseY },
    { x: dropX, y: dropY },
    { x: hospital.x, y: hospital.y },
  ];
}

function hospitalReleaseSpawn(nearX = null, nearY = null) {
  const hospitals = orderedHospitalsByDistance(nearX, nearY);
  if (hospitals.length === 0) {
    return randomPedSpawn();
  }
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

  for (const hospital of hospitals) {
    const anchors = hospitalSpawnAnchors(hospital);
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
  }

  for (const hospital of hospitals) {
    const anchors = hospitalSpawnAnchors(hospital);
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
  }
  return randomPedSpawn();
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

function alertWitnessCopsForPlayer(playerId, witnessCopIds) {
  const targetId = String(playerId || '');
  if (!targetId || !Array.isArray(witnessCopIds) || witnessCopIds.length === 0) return;
  for (const copId of witnessCopIds) {
    const cop = cops.get(copId);
    if (!cop || !cop.alive) continue;
    cop.alertTimer = Math.max(cop.alertTimer || 0, COP_ALERT_MARK_SECONDS);
    if (cop.inCarId) continue;
    cop.mode = 'hunt';
    cop.targetPlayerId = targetId;
    cop.huntLostTimer = 0;
  }
}

function alertNearbyCopCarsForPlayer(player, x, y, radius = POLICE_WITNESS_RADIUS) {
  if (!player || player.health <= 0) return;
  const r2 = radius * radius;
  for (const car of cars.values()) {
    if (!car || car.type !== 'cop' || car.destroyed) continue;
    if (wrappedDistanceSq(car.x, car.y, x, y) > r2) continue;
    car.huntTargetPlayerId = player.id;
    car.dismountTargetPlayerId = player.id;
    car.sirenOn = true;
    tryDeployCopOfficers(car, player, true);
  }
}

function reportWitnessedGunfire(player, x, y) {
  if (!player || player.health <= 0 || player.insideShopId) return;
  if (!Number.isFinite(player.gunfireWitnessCooldown)) {
    player.gunfireWitnessCooldown = 0;
  }
  if (player.gunfireWitnessCooldown > 0) return;

  const witness = policeWitnessReport(x, y);
  if (!witness.policeNear) return;

  player.gunfireWitnessCooldown = POLICE_GUNFIRE_REPORT_COOLDOWN;
  const alreadyInFiveStarPursuit = player.stars >= 5 || player.starHeat >= 4.99;
  forceFiveStars(player, 34);
  addCrimeRating(player, CRIME_WEIGHTS.gunfire_witnessed);
  alertWitnessCopsForPlayer(player.id, witness.witnessCopIds);
  alertNearbyCopCarsForPlayer(player, x, y, POLICE_WITNESS_RADIUS * 1.15);

  if (!alreadyInFiveStarPursuit) {
    emitEvent('copWitness', {
      playerId: player.id,
      x: witness.witnessX,
      y: witness.witnessY,
    });
    player.copAlertPlayed = true;
  }
}

function reportWitnessedCarTheft(player, x, y) {
  if (!player || player.health <= 0 || player.insideShopId) return;
  const witness = policeWitnessReport(x, y);
  if (!witness.policeNear) return;

  const alreadyInFiveStarPursuit = player.stars >= 5 || player.starHeat >= 4.99;
  forceFiveStars(player, 38);
  addCrimeRating(player, CRIME_WEIGHTS.car_theft_witnessed);
  alertWitnessCopsForPlayer(player.id, witness.witnessCopIds);
  alertNearbyCopCarsForPlayer(player, x, y, POLICE_WITNESS_RADIUS * 1.2);

  if (!alreadyInFiveStarPursuit) {
    emitEvent('copWitness', {
      playerId: player.id,
      x: witness.witnessX,
      y: witness.witnessY,
    });
    player.copAlertPlayed = true;
  }
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
    huntTargetPlayerId: null,
    huntLostTimer: 0,
    dismountTargetPlayerId: null,
    sirenOn: false,
    ambulanceMode: 'idle',
    ambulanceTargetType: null,
    ambulanceTargetId: null,
    ambulanceLoad: [],
    stuckTimer: 0,
    lastMoveX: spawn.x,
    lastMoveY: spawn.y,
    followBlockedTimer: 0,
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
  car.huntTargetPlayerId = null;
  car.huntLostTimer = 0;
  car.sirenOn = false;
  car.stuckTimer = 0;
  car.lastMoveX = spawn.x;
  car.lastMoveY = spawn.y;
  car.followBlockedTimer = 0;
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
  car.huntTargetPlayerId = null;
  car.huntLostTimer = 0;
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

  handleQuestTargetCarUnavailable(car, killer ? killer.id : null);
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

function isQuestTargetNpcId(npcId) {
  return !!(npcId && questTargetOwnerByNpcId.has(npcId));
}

function groupedNpcRatio() {
  if (npcs.size <= 0) return 0;
  let grouped = 0;
  for (const npc of npcs.values()) {
    if (npc && npc.groupId) grouped += 1;
  }
  return grouped / Math.max(1, npcs.size);
}

function clearNpcGroupFields(npc) {
  if (!npc) return;
  npc.groupId = null;
  npc.groupRole = 'solo';
  npc.groupLeaderId = null;
  npc.groupOffsetX = 0;
  npc.groupOffsetY = 0;
}

function disbandNpcGroup(groupId) {
  const group = npcGroups.get(groupId);
  if (!group) return;
  const ids = Array.isArray(group.memberIds) ? group.memberIds.slice() : [];
  for (const memberId of ids) {
    const member = npcs.get(memberId);
    if (member) clearNpcGroupFields(member);
  }
  npcGroups.delete(groupId);
}

function promoteNpcGroupLeader(group) {
  if (!group || !Array.isArray(group.memberIds) || group.memberIds.length === 0) return;
  let best = null;
  for (const memberId of group.memberIds) {
    const member = npcs.get(memberId);
    if (!member || !member.alive) continue;
    if (isQuestTargetNpcId(member.id) || member.reclaimCarId) continue;
    best = member;
    break;
  }
  if (!best) {
    disbandNpcGroup(group.id);
    return;
  }
  group.leaderId = best.id;
  for (const memberId of group.memberIds) {
    const member = npcs.get(memberId);
    if (!member) continue;
    member.groupLeaderId = best.id;
    member.groupRole = member.id === best.id ? 'leader' : 'follower';
  }
}

function removeNpcFromGroup(npc) {
  if (!npc || !npc.groupId) {
    clearNpcGroupFields(npc);
    return;
  }
  const group = npcGroups.get(npc.groupId);
  const groupId = npc.groupId;
  clearNpcGroupFields(npc);
  if (!group) return;
  group.memberIds = Array.isArray(group.memberIds) ? group.memberIds.filter((id) => id !== npc.id) : [];
  if (group.memberIds.length < NPC_GROUP_MIN_SIZE) {
    disbandNpcGroup(groupId);
    return;
  }
  if (group.leaderId === npc.id) {
    promoteNpcGroupLeader(group);
  }
}

function attachNpcToGroupLeader(npc, group, asLeader = false) {
  if (!npc || !group) return false;
  removeNpcFromGroup(npc);
  if (!Array.isArray(group.memberIds)) group.memberIds = [];
  if (!group.memberIds.includes(npc.id)) group.memberIds.push(npc.id);
  npc.groupId = group.id;
  npc.groupLeaderId = asLeader ? npc.id : group.leaderId;
  npc.groupRole = asLeader ? 'leader' : 'follower';
  if (asLeader) {
    npc.groupOffsetX = 0;
    npc.groupOffsetY = 0;
  } else {
    const dist = randRange(8, 16);
    const angle = randRange(-Math.PI, Math.PI);
    npc.groupOffsetX = Math.cos(angle) * dist;
    npc.groupOffsetY = Math.sin(angle) * dist;
  }
  return true;
}

function pruneNpcGroups() {
  for (const [groupId, group] of npcGroups.entries()) {
    if (!group || !Array.isArray(group.memberIds)) {
      npcGroups.delete(groupId);
      continue;
    }
    group.memberIds = group.memberIds.filter((memberId) => {
      const member = npcs.get(memberId);
      return !!(member && member.alive && member.groupId === groupId);
    });
    if (group.memberIds.length < NPC_GROUP_MIN_SIZE) {
      disbandNpcGroup(groupId);
      continue;
    }
    if (!group.memberIds.includes(group.leaderId)) {
      promoteNpcGroupLeader(group);
      continue;
    }
    const leader = npcs.get(group.leaderId);
    if (!leader || !leader.alive || isQuestTargetNpcId(leader.id) || leader.reclaimCarId) {
      promoteNpcGroupLeader(group);
    }
  }
}

function findJoinableNpcGroup(npc) {
  let best = null;
  let bestDistSq = NPC_GROUP_JOIN_RADIUS * NPC_GROUP_JOIN_RADIUS;
  for (const group of npcGroups.values()) {
    if (!group || !Array.isArray(group.memberIds)) continue;
    if (group.memberIds.length >= Math.max(NPC_GROUP_MIN_SIZE, Number(group.desiredSize) || NPC_GROUP_MAX_SIZE)) {
      continue;
    }
    const leader = npcs.get(group.leaderId);
    if (!leader || !leader.alive) continue;
    if (isQuestTargetNpcId(leader.id) || leader.reclaimCarId) continue;
    const d2 = wrappedDistanceSq(npc.x, npc.y, leader.x, leader.y);
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      best = group;
    }
  }
  return best;
}

function tryAssignNpcToGroup(npc) {
  if (!npc || !npc.alive) return;
  if (isQuestTargetNpcId(npc.id) || npc.reclaimCarId) {
    removeNpcFromGroup(npc);
    return;
  }
  if (npc.groupId) return;
  const currentRatio = groupedNpcRatio();
  const joinable = findJoinableNpcGroup(npc);
  if (joinable && currentRatio < NPC_GROUP_DENSITY + 0.04 && Math.random() < 0.82) {
    attachNpcToGroupLeader(npc, joinable, false);
    return;
  }
  if (currentRatio >= NPC_GROUP_DENSITY) return;
  if (Math.random() >= 0.5) return;

  const groupId = `ng_${nextNpcGroupId}`;
  nextNpcGroupId += 1;
  const desiredSize = randInt(NPC_GROUP_MIN_SIZE, NPC_GROUP_MAX_SIZE + 1);
  const group = {
    id: groupId,
    leaderId: npc.id,
    desiredSize,
    memberIds: [],
  };
  npcGroups.set(groupId, group);
  attachNpcToGroupLeader(npc, group, true);
}

function clearNpcPath(npc) {
  if (!npc) return;
  npc.navPath = [];
  npc.pathIndex = 0;
  npc.navTargetNodeId = null;
}

function setNpcNavNode(npc, nodeOrId = null) {
  if (!npc) return null;
  const node =
    nodeOrId && typeof nodeOrId === 'object'
      ? nodeOrId
      : Number.isInteger(nodeOrId)
        ? npcNavGraph.nodesById.get(nodeOrId) || null
        : null;
  if (!node) {
    npc.navNodeId = null;
    npc.navComponentId = null;
    return null;
  }
  const componentMap = componentIdByNodeId || npcNavGraph.componentIdByNodeId;
  npc.navNodeId = node.id;
  npc.navComponentId = componentMap ? componentMap.get(node.id) || null : null;
  return node;
}

function resetNpcAiRuntime(npc, spawnX = null, spawnY = null) {
  if (!npc) return;
  clearNpcPath(npc);
  const px = Number.isFinite(spawnX) ? spawnX : npc.x;
  const py = Number.isFinite(spawnY) ? spawnY : npc.y;
  const anchor = nearestNavNode(px, py, 5);
  setNpcNavNode(npc, anchor || null);
  npc.navPrevNodeId = null;
  npc.poiNodeId = null;
  npc.idleUntil = 0;
  npc.aiState = 'calm';
  npc.panicUntil = 0;
  npc.threatX = Number.isFinite(px) ? px : npc.x;
  npc.threatY = Number.isFinite(py) ? py : npc.y;
  npc.returnPoiNodeId = null;
  npc.crossState = 'none';
  npc.crossDir = npc.dir || 0;
  npc.crossWaitUntil = 0;
  npc.crossBlockTimer = 0;
  npc.panicTimer = Math.max(0, Number(npc.panicTimer) || 0);
  npc.crossingTimer = 0;
  npc.vehicleFearUntil = 0;
  npc.wanderTimer = Number.isFinite(npc.wanderTimer) ? npc.wanderTimer : randRange(0.5, 2.1);
  npc.navStuckTimer = 0;
  npc.navLastX = Number.isFinite(px) ? px : npc.x;
  npc.navLastY = Number.isFinite(py) ? py : npc.y;
  npc.navRoamBiasDir = Number.isFinite(npc.dir) ? npc.dir : randRange(-Math.PI, Math.PI);
  if (!npc.groupId) clearNpcGroupFields(npc);
}

function ensureNpcNavNode(npc) {
  if (!npc) return null;
  if (Number.isInteger(npc.navNodeId)) {
    const existing = npcNavGraph.nodesById.get(npc.navNodeId);
    if (existing) return setNpcNavNode(npc, existing);
  }
  const nearest = nearestNavNode(npc.x, npc.y, 5);
  return setNpcNavNode(npc, nearest || null);
}

function resolveNpcNeighborIds(nodeId) {
  if (!Number.isInteger(nodeId)) return [];
  const cached = neighborNodeIdsByNode?.get(nodeId) || npcNavGraph.neighborNodeIdsByNode?.get(nodeId);
  if (Array.isArray(cached)) return cached;
  const edges = npcNavGraph.edgesByNode.get(nodeId) || [];
  const fallback = [];
  for (const edge of edges) {
    if (!edge || !Number.isInteger(edge.to)) continue;
    fallback.push(edge.to);
  }
  return fallback;
}

function pickNpcDirectionalNextNode(npc, headingDir = null) {
  if (!npc) return null;
  const currentNode = ensureNpcNavNode(npc);
  if (!currentNode) return null;
  const neighbors = resolveNpcNeighborIds(currentNode.id);
  if (!Array.isArray(neighbors) || neighbors.length === 0) return null;

  const desiredHeading = Number.isFinite(headingDir)
    ? headingDir
    : Number.isFinite(npc.dir)
      ? npc.dir
      : randRange(-Math.PI, Math.PI);
  const previousNodeId = Number.isInteger(npc.navPrevNodeId) ? npc.navPrevNodeId : null;
  let bestNode = null;
  let bestScore = -Infinity;
  for (const neighborId of neighbors) {
    const neighborNode = npcNavGraph.nodesById.get(neighborId);
    if (!neighborNode) continue;
    const dirToNeighbor = wrappedDirection(currentNode.x, currentNode.y, neighborNode.x, neighborNode.y);
    const headingAlign = Math.cos(angleWrap(dirToNeighbor - desiredHeading));
    const backtrackPenalty = neighborId === previousNodeId ? 1.35 : 0;
    const randomBias = randRange(-0.35, 0.35);
    const score = headingAlign * 1.9 + randomBias - backtrackPenalty;
    if (!bestNode || score > bestScore) {
      bestNode = neighborNode;
      bestScore = score;
    }
  }
  return bestNode;
}

function ensureNpcDirectionalTarget(npc, headingDir = null) {
  if (!npc) return null;
  const currentNode = ensureNpcNavNode(npc);
  if (!currentNode) return null;

  if (Number.isInteger(npc.navTargetNodeId)) {
    const existingTarget = npcNavGraph.nodesById.get(npc.navTargetNodeId);
    const sameComponent = !npc.navComponentId || !componentIdByNodeId
      ? true
      : componentIdByNodeId.get(existingTarget?.id) === npc.navComponentId;
    if (existingTarget && sameComponent) {
      const neighbors = resolveNpcNeighborIds(currentNode.id);
      if (neighbors.includes(existingTarget.id)) {
        return existingTarget;
      }
    }
    npc.navTargetNodeId = null;
  }

  const nextNode = pickNpcDirectionalNextNode(npc, headingDir);
  if (!nextNode) return null;
  npc.navTargetNodeId = nextNode.id;
  return nextNode;
}

function moveNpcWithCollision(npc, desiredDir, speed, dt) {
  const safeSpeed = Math.max(0, Number(speed) || 0);
  npc.dir = angleApproach(npc.dir, desiredDir, dt * 5.8);
  const nx = wrapWorldX(npc.x + Math.cos(npc.dir) * safeSpeed * dt);
  const ny = wrapWorldY(npc.y + Math.sin(npc.dir) * safeSpeed * dt);
  if (!isSolidForPed(nx, npc.y)) {
    npc.x = nx;
  }
  if (!isSolidForPed(npc.x, ny)) {
    npc.y = ny;
  }
  wrapWorldPosition(npc);
}

function stepNpcDirectionalRoam(npc, stepDt, speedBonus = 0, headingDir = null) {
  if (!npc || stepDt <= 0) return false;
  const targetNode = ensureNpcDirectionalTarget(npc, headingDir);
  if (!targetNode) {
    const fallbackDir = angleWrap(
      (Number.isFinite(npc.navRoamBiasDir) ? npc.navRoamBiasDir : Number(npc.dir) || 0) + randRange(-0.42, 0.42)
    );
    npc.navRoamBiasDir = fallbackDir;
    moveNpcWithCollision(npc, fallbackDir, Math.max(22, (Number(npc.baseSpeed) || 32) - 6), Math.min(stepDt, 0.16));
    return false;
  }

  const prevX = npc.x;
  const prevY = npc.y;
  const speed = Math.max(24, (Number(npc.baseSpeed) || 32) + speedBonus);
  const desiredDir = wrappedDirection(npc.x, npc.y, targetNode.x, targetNode.y);
  moveNpcWithCollision(npc, desiredDir, speed, stepDt);
  npc.navRoamBiasDir = desiredDir;

  const movedSq = wrappedDistanceSq(prevX, prevY, npc.x, npc.y);
  if (movedSq <= 0.85 * 0.85) {
    npc.navStuckTimer = (Number(npc.navStuckTimer) || 0) + stepDt;
    if (npc.navStuckTimer >= 1.35) {
      npc.navTargetNodeId = null;
      npc.navPrevNodeId = null;
      npc.navStuckTimer = 0;
      npc.navRoamBiasDir = angleWrap(desiredDir + randRange(-1.2, 1.2));
    }
  } else {
    npc.navStuckTimer = 0;
    npc.navLastX = npc.x;
    npc.navLastY = npc.y;
  }

  const d2 = wrappedDistanceSq(npc.x, npc.y, targetNode.x, targetNode.y);
  if (d2 > NPC_NAV_REACH_RADIUS * NPC_NAV_REACH_RADIUS) {
    return false;
  }

  if (d2 <= 2 * 2) {
    npc.x = targetNode.x;
    npc.y = targetNode.y;
  } else {
    const settleAlpha = 0.18;
    npc.x = wrapWorldX(npc.x + wrapDelta(targetNode.x - npc.x, WORLD.width) * settleAlpha);
    npc.y = wrapWorldY(npc.y + wrapDelta(targetNode.y - npc.y, WORLD.height) * settleAlpha);
  }

  npc.navPrevNodeId = Number.isInteger(npc.navNodeId) ? npc.navNodeId : null;
  setNpcNavNode(npc, targetNode);
  npc.navTargetNodeId = null;
  npc.navStuckTimer = 0;
  npc.navLastX = npc.x;
  npc.navLastY = npc.y;
  return true;
}

function triggerNpcPanic(npc, sourceX, sourceY, minSeconds = NPC_PANIC_MIN_SECONDS, maxSeconds = NPC_PANIC_MAX_SECONDS) {
  if (!npc || !npc.alive) return;
  const nowSec = Date.now() / 1000;
  const duration = randRange(Math.max(0.5, minSeconds), Math.max(minSeconds + 0.1, maxSeconds));
  npc.aiState = 'panic';
  npc.panicUntil = Math.max(Number(npc.panicUntil) || 0, nowSec + duration);
  npc.panicTimer = Math.max(Number(npc.panicTimer) || 0, duration);
  if (Number.isFinite(sourceX) && Number.isFinite(sourceY)) {
    npc.threatX = sourceX;
    npc.threatY = sourceY;
  }
  clearNpcPath(npc);
  npc.navPrevNodeId = null;
  npc.navStuckTimer = 0;
  npc.crossState = 'none';
}

function recoverNpcFromRoad(npc, stepDt, maxDistance = 160) {
  if (!npc) return;
  if (groundTypeAt(npc.x, npc.y) !== 'road') return;
  // Do not snap while the NPC is intentionally traversing to an active nav target.
  if (Number.isInteger(npc.navTargetNodeId)) return;
  const nearest = nearestNavNode(npc.x, npc.y, 5);
  if (!nearest) return;

  const maxDistSq = Math.max(24, Number(maxDistance) || 160);
  const d2 = wrappedDistanceSq(npc.x, npc.y, nearest.x, nearest.y);
  if (d2 > maxDistSq * maxDistSq) return;

  setNpcNavNode(npc, nearest);
  npc.navTargetNodeId = null;
  if (d2 <= NPC_NAV_REACH_RADIUS * NPC_NAV_REACH_RADIUS) {
    npc.x = nearest.x;
    npc.y = nearest.y;
    return;
  }

  const dir = wrappedDirection(npc.x, npc.y, nearest.x, nearest.y);
  const nudgeDt = Math.min(stepDt, 0.14);
  const speed = Math.max((Number(npc.baseSpeed) || 32) + 12, 46);
  moveNpcWithCollision(npc, dir, speed, nudgeDt);
}

function stepNpcPanicFlee(npc, stepDt) {
  if (!npc || stepDt <= 0) return;
  const away = wrappedVector(
    Number.isFinite(npc.threatX) ? npc.threatX : npc.x,
    Number.isFinite(npc.threatY) ? npc.threatY : npc.y,
    npc.x,
    npc.y
  );
  const baseDir = away.dist > 0.001 ? Math.atan2(away.dy, away.dx) : randRange(-Math.PI, Math.PI);
  const desiredDir = angleWrap(baseDir + randRange(-0.28, 0.28));
  const speed = Math.max((Number(npc.baseSpeed) || 32) + NPC_PANIC_SPEED_BONUS, 78);
  moveNpcWithCollision(npc, desiredDir, speed, stepDt);
  npc.navTargetNodeId = null;
}

function stepNpcReturnToNav(npc, stepDt) {
  if (!npc || stepDt <= 0) return true;
  const nearest = nearestNavNode(npc.x, npc.y, 5);
  if (!nearest) {
    npc.aiState = 'calm';
    return true;
  }
  const d2 = wrappedDistanceSq(npc.x, npc.y, nearest.x, nearest.y);
  if (d2 <= NPC_NAV_REACH_RADIUS * NPC_NAV_REACH_RADIUS) {
    npc.x = nearest.x;
    npc.y = nearest.y;
    setNpcNavNode(npc, nearest);
    npc.navPrevNodeId = null;
    npc.navTargetNodeId = null;
    npc.navStuckTimer = 0;
    npc.aiState = 'calm';
    return true;
  }
  const dir = wrappedDirection(npc.x, npc.y, nearest.x, nearest.y);
  const speed = Math.max((Number(npc.baseSpeed) || 32) + NPC_RETURN_SPEED_BONUS, 60);
  moveNpcWithCollision(npc, dir, speed, stepDt);
  return false;
}

function stepNpcColdTier(npc, stepDt, nowSec, allowDecisions) {
  if (!npc) return;
  if (npc.aiState === 'panic' && nowSec >= (Number(npc.panicUntil) || 0)) {
    npc.aiState = 'return';
  }

  npc.wanderTimer = (Number(npc.wanderTimer) || 0) - stepDt;
  if (allowDecisions && npc.wanderTimer <= 0) {
    npc.wanderTimer = randRange(1.4, 3.4);
    npc.baseSpeed = randRange(27, 43);
  }

  if (npc.aiState === 'panic') {
    stepNpcPanicFlee(npc, stepDt);
    return;
  }

  if (npc.aiState === 'return') {
    stepNpcReturnToNav(npc, stepDt);
    if (npc.aiState !== 'calm') return;
  }

  if (!allowDecisions && !Number.isInteger(npc.navTargetNodeId)) {
    recoverNpcFromRoad(npc, stepDt, 240);
    return;
  }

  stepNpcDirectionalRoam(npc, stepDt, 0);
  recoverNpcFromRoad(npc, stepDt, 240);
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
    aiState: 'calm',
    navNodeId: null,
    navComponentId: null,
    navPrevNodeId: null,
    navTargetNodeId: null,
    navStuckTimer: 0,
    navLastX: spawn.x,
    navLastY: spawn.y,
    navRoamBiasDir: randRange(-Math.PI, Math.PI),
    navPath: [],
    pathIndex: 0,
    poiNodeId: null,
    idleUntil: 0,
    panicUntil: 0,
    threatX: spawn.x,
    threatY: spawn.y,
    returnPoiNodeId: null,
    crossState: 'none',
    crossDir: 0,
    crossWaitUntil: 0,
    crossBlockTimer: 0,
    vehicleFearUntil: 0,
    groupId: null,
    groupRole: 'solo',
    groupLeaderId: null,
    groupOffsetX: 0,
    groupOffsetY: 0,
  };
  npcs.set(npc.id, npc);
  resetNpcAiRuntime(npc, spawn.x, spawn.y);
  clearNpcGroupFields(npc);
  return npc;
}

function respawnNpc(npc, spawnOverride = null) {
  const spawn = spawnOverride || randomPedSpawn();
  clearNpcGroupFields(npc);
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
  resetNpcAiRuntime(npc, spawn.x, spawn.y);
  clearNpcGroupFields(npc);
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
    huntLostTimer: 0,
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
  cop.huntLostTimer = 0;
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
  cop.huntLostTimer = 0;
  cop.cooldown = 0;
  cop.inCarId = null;
  makeBloodStain(cop.x, cop.y);

  if (killer && killer.health > 0) {
    addStars(killer, 1.25, 34);
    addCrimeRating(killer, CRIME_WEIGHTS.cop_kill);
    incrementQuestAction(killer, 'kill_cop', 1);
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
    cop.huntLostTimer = 0;
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
  incrementQuestAction(killer, 'kill_npc', 1);
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
  removeNpcFromGroup(npc);
  clearNpcPath(npc);

  const leaveCorpse = !!killerId;

  npc.alive = false;
  npc.health = 0;
  npc.respawnTimer = 0;
  npc.panicTimer = 0;
  npc.corpseDownTimer = 0;

  if (!leaveCorpse) {
    handleQuestTargetNpcDeath(npc, null);
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
  handleQuestTargetNpcDeath(npc, killerId);

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
  resetQuestProgressOnDeath(player);
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

  const spawn = hospitalReleaseSpawn(player.x, player.y);
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
    if (isQuestTargetNpcId(npc.id)) continue;
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
  removeNpcFromGroup(npc);
  const spawn = findSafePedSpawnNear(x, y, 56, true) || { x, y };
  npc.x = spawn.x;
  npc.y = spawn.y;
  npc.dir = dir;
  npc.baseSpeed = randRange(30, 48);
  npc.wanderTimer = randRange(0.2, 0.8);
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
  npc.skinColor = skinColor;
  npc.shirtColor = shirtColor;
  npc.shirtDark = shirtDark;
  resetNpcAiRuntime(npc, spawn.x, spawn.y);
  triggerNpcPanic(npc, x, y, 2.2, 4.4);
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
    triggerNpcPanic(owner, car.x, car.y, 1.1, 1.8);
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
  const interior = findInteriorById(player.insideShopId);
  const isGarage = isGarageId(player.insideShopId);
  player.insideShopId = null;

  if (isGarage && player.inCarId) {
    const car = cars.get(player.inCarId);
    if (car && !car.destroyed && car.driverId === player.id) {
      player.x = car.x;
      player.y = car.y;
      player.dir = car.angle;
      player.hitCooldown = Math.max(player.hitCooldown || 0, 0.2);
      emitEvent('exitShop', {
        playerId: player.id,
        shopId: interior ? interior.id : null,
        x: player.x,
        y: player.y,
      });
      return;
    }
  }

  let spawn = null;
  const hasStoredExit = Number.isFinite(player.shopExitX) && Number.isFinite(player.shopExitY);

  if (interior && hasStoredExit) {
    const nearShopSq = wrappedDistanceSq(player.shopExitX, player.shopExitY, interior.x, interior.y);
    if (nearShopSq <= 260 * 260) {
      spawn = findSafePedSpawnNear(player.shopExitX, player.shopExitY, 64, true);
    }
  }

  if (!spawn && interior) {
    const anchors = [
      { x: interior.x + 24, y: interior.y },
      { x: interior.x - 24, y: interior.y },
      { x: interior.x, y: interior.y + 24 },
      { x: interior.x, y: interior.y - 24 },
      { x: interior.x + 36, y: interior.y + 12 },
      { x: interior.x - 36, y: interior.y - 12 },
    ];
    for (const anchor of anchors) {
      spawn = findSafePedSpawnNear(anchor.x, anchor.y, 96, true);
      if (spawn) break;
    }
    if (!spawn) {
      spawn = findSafePedSpawnNear(interior.x, interior.y, 200, false);
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
    shopId: interior ? interior.id : null,
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

function clearPolicePursuitForPlayer(player) {
  if (!player) return;
  player.starHeat = 0;
  player.starCooldown = 0;
  player.stars = 0;
  player.copAlertPlayed = false;

  for (const car of cars.values()) {
    if (car.type !== 'cop') continue;
    if (car.dismountTargetPlayerId !== player.id && car.huntTargetPlayerId !== player.id) continue;
    resetCopCarDeployment(car);
    car.sirenOn = false;
  }

  for (const cop of cops.values()) {
    if (cop.targetPlayerId !== player.id) continue;
    cop.targetPlayerId = null;
    cop.huntLostTimer = 0;
    if (cop.assignedCarId) {
      cop.mode = 'return';
      cop.rejoinCarId = cop.assignedCarId;
    } else {
      cop.mode = 'patrol';
      cop.patrolTimer = Math.min(cop.patrolTimer || 0, 0.4);
    }
  }
}

function chooseRandomCarColor(currentColor) {
  const normalizedCurrent = normalizeHexColor(currentColor, '');
  const pool = CAR_PALETTE.filter((value) => normalizeHexColor(value, '') !== normalizedCurrent);
  const source = pool.length > 0 ? pool : CAR_PALETTE;
  if (source.length === 0) return '#f2f2f2';
  return source[randInt(0, source.length)];
}

function isCarQuestTargetForPlayer(carId, playerProfileId) {
  if (!carId || !playerProfileId) return false;
  const ownerKey = questTargetCarOwnerByCarId.get(carId);
  if (!ownerKey) return false;
  const parsed = parseQuestTargetKey(ownerKey);
  return !!(parsed && parsed.profileId === playerProfileId);
}

function trySellGarageCar(player) {
  if (!player.inCarId) {
    return { ok: false, message: 'Drive a car into the garage first.' };
  }
  const car = cars.get(player.inCarId);
  if (!car || car.destroyed || car.driverId !== player.id) {
    return { ok: false, message: 'No valid car to sell.' };
  }

  const wasTargetCar = isCarQuestTargetForPlayer(car.id, player.profileId);
  player.money = clamp(Math.round(Number(player.money) || 0) + GARAGE_SELL_PRICE, 0, 0xffffffff);
  incrementQuestAction(player, 'steal_car_any', 1);
  if (car.type === 'cop') {
    incrementQuestAction(player, 'steal_car_cop_sell_garage', 1);
  } else if (car.type === 'ambulance') {
    incrementQuestAction(player, 'steal_car_ambulance_sell_garage', 1);
  } else if (car.type === 'civilian') {
    incrementQuestAction(player, 'steal_car_civilian_sell_garage', 1);
  }
  if (wasTargetCar) {
    incrementQuestAction(player, 'steal_target_car', 1);
  }

  handleQuestTargetCarUnavailable(car, player.id);

  car.driverId = null;
  car.abandonTimer = 0;
  player.inCarId = null;

  const spawn = randomRoadSpawnFarFrom(car.x, car.y);
  resetCarForRespawn(car, spawn);
  car.speed = carCruiseSpeedByType(car.type);
  car.aiCooldown = randRange(0.25, 1.15);

  emitEvent('purchase', {
    playerId: player.id,
    item: 'garage_sell',
    amount: GARAGE_SELL_PRICE,
    x: player.x,
    y: player.y,
  });

  // Selling a car finishes the garage interaction immediately.
  exitShop(player);
  return { ok: true, message: `Car sold for $${GARAGE_SELL_PRICE}. Leaving garage.` };
}

function tryRepaintGarageCar(player, selectedColor = null) {
  if (!player.inCarId) {
    return { ok: false, message: 'Drive a car into the garage first.' };
  }
  const car = cars.get(player.inCarId);
  if (!car || car.destroyed || car.driverId !== player.id) {
    return { ok: false, message: 'No valid car to repaint.' };
  }
  if (car.type !== 'civilian') {
    return { ok: false, message: 'Only civilian cars can be repainted. Sell this vehicle instead.' };
  }

  const customColor = selectedColor ? sanitizeColor(selectedColor) : null;
  if (selectedColor && !customColor) {
    return { ok: false, message: 'Invalid color format.' };
  }
  const selectedMode = !!customColor;
  const price = selectedMode ? GARAGE_REPAINT_SELECTED_PRICE : GARAGE_REPAINT_RANDOM_PRICE;
  if (player.money < price) {
    return { ok: false, message: 'Not enough money.' };
  }

  const nextColor = selectedMode ? customColor : chooseRandomCarColor(car.color);
  player.money -= price;
  car.color = nextColor;
  clearPolicePursuitForPlayer(player);

  emitEvent('purchase', {
    playerId: player.id,
    item: selectedMode ? 'garage_repaint_selected' : 'garage_repaint_random',
    amount: price,
    x: player.x,
    y: player.y,
  });

  // Repaint actions should finish the garage interaction immediately.
  exitShop(player);
  if (selectedMode) {
    return { ok: true, message: `Car repainted for $${price}. Leaving garage.` };
  }
  return { ok: true, message: `Random repaint for $${price}. Leaving garage.` };
}

function buyItemForPlayer(player, item) {
  if (!player.insideShopId) {
    return { ok: false, message: 'Enter a gun shop first.' };
  }

  const safeItem = typeof item === 'string' ? item : '';

  if (isGarageId(player.insideShopId)) {
    if (safeItem === 'garage_sell') {
      return trySellGarageCar(player);
    }
    if (safeItem === 'garage_repaint_random') {
      return tryRepaintGarageCar(player, null);
    }
    if (safeItem === GARAGE_REPAINT_SELECTED_KEY) {
      return tryRepaintGarageCar(player, player.color);
    }
    const presetColor = GARAGE_REPAINT_SELECTED_PRESET_COLORS[safeItem];
    if (presetColor) {
      return tryRepaintGarageCar(player, presetColor);
    }
    if (safeItem.startsWith(GARAGE_REPAINT_SELECTED_PREFIX)) {
      return tryRepaintGarageCar(player, safeItem.slice(GARAGE_REPAINT_SELECTED_PREFIX.length));
    }
    return { ok: false, message: 'Unknown garage action.' };
  }

  const price = SHOP_STOCK[safeItem];
  if (!price) {
    return { ok: false, message: 'Unknown item.' };
  }

  if (safeItem === 'shotgun' && player.ownedShotgun) {
    return { ok: false, message: 'Shotgun already owned.' };
  }
  if (safeItem === 'machinegun' && player.ownedMachinegun) {
    return { ok: false, message: 'Machinegun already owned.' };
  }
  if (safeItem === 'bazooka' && player.ownedBazooka) {
    return { ok: false, message: 'Bazooka already owned.' };
  }
  if (player.money < price) {
    return { ok: false, message: 'Not enough money.' };
  }

  player.money -= price;
  if (safeItem === 'shotgun') {
    player.ownedShotgun = true;
    player.input.weaponSlot = 2;
  } else if (safeItem === 'machinegun') {
    player.ownedMachinegun = true;
    player.input.weaponSlot = 3;
  } else if (safeItem === 'bazooka') {
    player.ownedBazooka = true;
    player.input.weaponSlot = 4;
  }
  player.weapon = safeItem;

  emitEvent('purchase', {
    playerId: player.id,
    item: safeItem,
    amount: price,
    x: player.x,
    y: player.y,
  });

  return { ok: true, message: `Purchased ${safeItem}.` };
}

function handleEnterOrExit(player) {
  if (player.health <= 0) return;

  if (player.insideShopId) {
    exitShop(player);
    return;
  }

  if (player.inCarId) {
    const car = cars.get(player.inCarId);
    if (!car) {
      player.inCarId = null;
      return;
    }

    const garage = findNearbyGarageEntrance(player, 88, true);
    if (garage) {
      car.speed = 0;
      enterShop(player, garage);
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

  const shop = findNearbyShop(player, 34);
  if (shop) {
    if (hasActiveQuestsConfigured() && !player.gunShopUnlocked) {
      sendNoticeToPlayer(player.id, false, 'Gun shop locked. Complete quests to unlock access.');
      return;
    }
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
      reportWitnessedCarTheft(player, candidate.x, candidate.y);
      } else {
        addStars(player, 0.75, 26);
        addCrimeRating(player, CRIME_WEIGHTS.car_theft_civilian);
        reportWitnessedCarTheft(player, candidate.x, candidate.y);
      }
      incrementQuestAction(player, 'steal_car_any', 1);
      if (candidate.type === 'cop') {
        incrementQuestAction(player, 'steal_car_cop', 1);
      } else if (candidate.type === 'ambulance') {
        incrementQuestAction(player, 'steal_car_ambulance', 1);
      }
    }

  candidate.driverId = player.id;
  player.inCarId = candidate.id;
  player.x = candidate.x;
  player.y = candidate.y;
  player.dir = candidate.angle;
  handleQuestTargetCarEntered(candidate, player);

  if (candidate.type === 'cop' && !candidate.stolenFromNpc) {
    addStars(player, 0.8, 30);
    addCrimeRating(player, CRIME_WEIGHTS.car_theft_cop_unattended);
    incrementQuestAction(player, 'steal_car_any', 1);
    incrementQuestAction(player, 'steal_car_cop', 1);
  } else if (candidate.type === 'ambulance' && !candidate.stolenFromNpc) {
    incrementQuestAction(player, 'steal_car_any', 1);
    incrementQuestAction(player, 'steal_car_ambulance', 1);
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

function speedAlongHeading(car, headingAngle) {
  if (!car) return 0;
  const hx = Math.cos(headingAngle);
  const hy = Math.sin(headingAngle);
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  return (Number(car.speed) || 0) * (fx * hx + fy * hy);
}

function nearestCarAheadInHeading(car, headingAngle, maxDistance, lateralPadding = 8) {
  if (!car) return null;
  const hx = Math.cos(headingAngle);
  const hy = Math.sin(headingAngle);
  const sx = -hy;
  const sy = hx;
  const maxDist = Math.max(24, Number(maxDistance) || 0);
  const lanePadding = Math.max(0, Number(lateralPadding) || 0);

  let best = null;
  let bestForwardDist = maxDist + 1;
  for (const other of cars.values()) {
    if (!other || other.id === car.id || other.destroyed) continue;
    const dx = wrapDelta(other.x - car.x, WORLD.width);
    const dy = wrapDelta(other.y - car.y, WORLD.height);
    const forwardDist = dx * hx + dy * hy;
    if (forwardDist <= 0 || forwardDist > maxDist) continue;
    const lateralDist = Math.abs(dx * sx + dy * sy);
    const laneHalfWidth = (car.height + other.height) * 0.5 + lanePadding;
    if (lateralDist > laneHalfWidth) continue;

    // Ignore clearly oncoming traffic farther away.
    const headingDot = Math.cos(other.angle) * hx + Math.sin(other.angle) * hy;
    if (headingDot < -0.2 && forwardDist > 26) continue;

    if (forwardDist < bestForwardDist) {
      best = other;
      bestForwardDist = forwardDist;
    }
  }

  if (!best) return null;
  return { car: best, forwardDist: bestForwardDist };
}

function applyAiCarFollowSpeed(car, desiredSpeed, dt, headingAngle = car.angle, options = null) {
  const opts = options || {};
  const ignoreLeadCars = !!opts.ignoreLeadCars;
  const minGap = Math.max(2, Number(opts.minGap) || 8);
  const timeGap = Math.max(0.2, Number(opts.timeGap) || 0.5);
  const brakeRate = Math.max(1, Number(opts.brakeRate) || 160);
  const accelRate = Math.max(1, Number(opts.accelRate) || 58);
  const lateralPadding = Math.max(0, Number(opts.lateralPadding) || 8);
  const lookAheadBase = Math.max(20, Number(opts.lookAheadBase) || 38);
  const lookAheadPerSpeed = Math.max(0.1, Number(opts.lookAheadPerSpeed) || 1);
  const lookAheadMax = Math.max(lookAheadBase + 10, Number(opts.lookAheadMax) || 150);
  const lookAhead = clamp(lookAheadBase + Math.max(0, car.speed) * lookAheadPerSpeed, lookAheadBase + 10, lookAheadMax);

  let cappedSpeed = Math.max(0, Number(desiredSpeed) || 0);
  const lead = ignoreLeadCars ? null : nearestCarAheadInHeading(car, headingAngle, lookAhead, lateralPadding);
  let followConstraint = false;
  if (lead) {
    const leadForwardSpeed = Math.max(0, speedAlongHeading(lead.car, headingAngle));
    const bumperGap = (car.width + lead.car.width) * 0.5 + minGap;
    const freeGap = Math.max(0, lead.forwardDist - bumperGap);
    const desiredClearGap = minGap + Math.max(0, car.speed) * timeGap;
    if (freeGap <= 2) {
      cappedSpeed = 0;
      followConstraint = true;
    } else if (freeGap < desiredClearGap) {
      cappedSpeed = Math.min(cappedSpeed, Math.max(0, leadForwardSpeed - 6));
      followConstraint = true;
    } else if (freeGap < desiredClearGap + 18) {
      cappedSpeed = Math.min(cappedSpeed, leadForwardSpeed + 4);
      followConstraint = true;
    }
  }

  if (followConstraint && cappedSpeed <= Math.max(14, (Number(desiredSpeed) || 0) * 0.5)) {
    car.followBlockedTimer = Math.max(Number(car.followBlockedTimer) || 0, 0.9);
  }

  car.speed = approach(car.speed, cappedSpeed, dt * (cappedSpeed < car.speed ? brakeRate : accelRate));
  return lead;
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

  applyAiCarFollowSpeed(car, 78, dt, car.angle, {
    minGap: 8,
    timeGap: 0.52,
    brakeRate: 168,
    accelRate: 58,
    lateralPadding: 8,
    lookAheadBase: 40,
    lookAheadPerSpeed: 1.1,
    lookAheadMax: 156,
  });
  car.speed = clamp(car.speed, 0, Math.min(car.maxSpeed, 95));
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

function isFiveStarTrackablePlayer(player) {
  return !!(player && player.health > 0 && player.stars >= 5 && !player.insideShopId);
}

function activeCopHunterCountsByPlayer() {
  const counts = new Map();
  for (const cop of cops.values()) {
    if (!cop || !cop.alive || cop.inCarId) continue;
    if (cop.mode !== 'hunt') continue;
    const targetId = String(cop.targetPlayerId || '');
    if (!targetId) continue;
    const target = players.get(targetId);
    if (!isFiveStarTrackablePlayer(target)) continue;
    counts.set(targetId, (counts.get(targetId) || 0) + 1);
  }
  return counts;
}

function activeCopCarHunterCountsByPlayer() {
  const counts = new Map();
  for (const car of cars.values()) {
    if (!car || car.type !== 'cop' || car.destroyed || !car.npcDriver) continue;
    const targetId = String(car.huntTargetPlayerId || '');
    if (!targetId) continue;
    const target = players.get(targetId);
    if (!isFiveStarTrackablePlayer(target)) continue;
    counts.set(targetId, (counts.get(targetId) || 0) + 1);
  }
  return counts;
}

function nearestFiveStarPlayer(x, y, options = null) {
  const maxDistanceSq = Number.isFinite(Number(options?.maxDistanceSq))
    ? Math.max(0, Number(options.maxDistanceSq))
    : Infinity;
  const capPerPlayer = Number.isFinite(Number(options?.capPerPlayer))
    ? Math.max(0, Math.round(Number(options.capPerPlayer)))
    : Infinity;
  const countsByPlayer = options?.countsByPlayer instanceof Map ? options.countsByPlayer : null;
  const keepTargetId = String(options?.keepTargetId || '');
  let winner = null;
  let winnerScore = Infinity;

  for (const player of players.values()) {
    if (!isFiveStarTrackablePlayer(player)) continue;
    if (countsByPlayer && Number.isFinite(capPerPlayer) && capPerPlayer >= 0) {
      const currentCount = countsByPlayer.get(player.id) || 0;
      if (currentCount >= capPerPlayer && player.id !== keepTargetId) continue;
    }
    const dist2 = wrappedDistanceSq(x, y, player.x, player.y);
    if (dist2 > maxDistanceSq) continue;
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
  best.huntLostTimer = 0;
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
  car.huntTargetPlayerId = null;
  car.huntLostTimer = 0;
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
  if (!Number.isFinite(car.huntLostTimer)) {
    car.huntLostTimer = 0;
  }

  if (car.dismountCopIds.length > 0) {
    const trackedTargetId = String(car.huntTargetPlayerId || car.dismountTargetPlayerId || '');
    let target = trackedTargetId ? players.get(trackedTargetId) : null;
    if (!isFiveStarTrackablePlayer(target)) {
      target = null;
    }
    if (target && wrappedDistanceSq(car.x, car.y, target.x, target.y) > COP_CAR_RECALL_RADIUS * COP_CAR_RECALL_RADIUS) {
      target = null;
    }
    if (!target) {
      const carHunterCounts = activeCopCarHunterCountsByPlayer();
      target = nearestFiveStarPlayer(car.x, car.y, {
        maxDistanceSq: COP_CAR_HUNT_JOIN_RADIUS_SQ,
        countsByPlayer: carHunterCounts,
        capPerPlayer: COP_MAX_HUNTER_CARS_PER_PLAYER,
        keepTargetId: trackedTargetId,
      });
    }

    if (target) {
      car.huntTargetPlayerId = target.id;
      car.dismountTargetPlayerId = target.id;
      car.huntLostTimer = 0;
      car.sirenOn = true;
    } else {
      car.huntLostTimer += dt;
      if (car.huntLostTimer >= COP_CAR_HUNT_LOST_TIMEOUT) {
        car.huntTargetPlayerId = null;
        car.dismountTargetPlayerId = null;
      }
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

  const currentTargetId = String(car.huntTargetPlayerId || '');
  let target = currentTargetId ? players.get(currentTargetId) : null;
  if (!isFiveStarTrackablePlayer(target)) {
    target = null;
  }
  if (target && wrappedDistanceSq(car.x, car.y, target.x, target.y) > COP_CAR_HUNT_LEASH_RADIUS_SQ) {
    target = null;
  }
  if (!target) {
    const carHunterCounts = activeCopCarHunterCountsByPlayer();
    target = nearestFiveStarPlayer(car.x, car.y, {
      maxDistanceSq: COP_CAR_HUNT_JOIN_RADIUS_SQ,
      countsByPlayer: carHunterCounts,
      capPerPlayer: COP_MAX_HUNTER_CARS_PER_PLAYER,
      keepTargetId: currentTargetId,
    });
  }
  if (!target) {
    car.huntLostTimer += dt;
    if (car.huntLostTimer >= COP_CAR_HUNT_LOST_TIMEOUT) {
      car.huntTargetPlayerId = null;
    }
    car.sirenOn = false;
    stepTrafficCar(car, dt);
    car.speed = clamp(car.speed, -80, 130);
    return;
  }

  car.huntLostTimer = 0;
  car.huntTargetPlayerId = target.id;
  car.sirenOn = true;
  const chase = wrappedVector(car.x, car.y, target.x, target.y);
  const desired = Math.atan2(chase.dy, chase.dx);
  const steerDesired = chooseAvoidanceHeading(car, desired);
  car.angle = angleApproach(car.angle, steerDesired, dt * 2.4);
  const dist = chase.dist;
  const desiredSpeed = dist > 170 ? 120 : 42;
  applyAiCarFollowSpeed(car, desiredSpeed, dt, car.angle, {
    minGap: 6,
    timeGap: 0.4,
    brakeRate: 188,
    accelRate: 88,
    lateralPadding: 7,
    lookAheadBase: 38,
    lookAheadPerSpeed: 1.05,
    lookAheadMax: 170,
    ignoreLeadCars: true,
  });
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

function deliverAmbulanceLoadToHospital(car, destinationHospital = null) {
  const hospital = destinationHospital || nearestHospitalTo(car.x, car.y);
  const releaseNearX = hospital ? hospital.x : car.x;
  const releaseNearY = hospital ? hospital.y : car.y;
  const load = ensureAmbulanceLoad(car);
  for (const item of load) {
    const entity = getCorpseEntityByRef(item.type, item.id);
    if (!entity || entity.alive) continue;
    if (entity.corpseState !== 'carried' || entity.bodyCarriedBy !== car.id) continue;
    entity.corpseState = 'reviving';
    entity.bodyCarriedBy = null;
    entity.bodyClaimedBy = null;
    entity.reviveTimer = randRange(3.5, 5.2);
    const release = hospitalReleaseSpawn(releaseNearX, releaseNearY);
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

    const hospital = nearestHospitalTo(car.x, car.y) || HOSPITAL;
    const dist = driveAiToward(car, hospital.dropX, hospital.dropY, dt, 96, 30);
    if (dist < 24) {
      deliverAmbulanceLoadToHospital(car, hospital);
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

function nearbyAliveNpcsForShotSegment(sx, sy, ex, ey, ctx = tickSpatialContext) {
  if (!ctx?.npcGrid) return npcs.values();
  const seg = wrappedVector(sx, sy, ex, ey);
  const sampleCount = Math.max(3, Math.min(14, Math.ceil(seg.dist / Math.max(24, COLLISION_GRID_CELL * 0.7)) + 1));
  const seen = new Set();
  const nearby = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const t = sampleCount <= 1 ? 0 : i / (sampleCount - 1);
    const x = wrappedLerp(sx, ex, t, WORLD.width);
    const y = wrappedLerp(sy, ey, t, WORLD.height);
    const candidates = spatialQueryNeighbors(ctx.npcGrid, x, y);
    for (const npc of candidates) {
      if (!npc || !npc.alive) continue;
      if (seen.has(npc.id)) continue;
      seen.add(npc.id);
      nearby.push(npc);
    }
  }
  return nearby;
}

function panicNpcsNearPoint(x, y, radius, sourceX, sourceY, minSeconds, maxSeconds, skipNpc = null, ctx = tickSpatialContext) {
  const r = Math.max(12, Number(radius) || 0);
  const r2 = r * r;
  const candidates = ctx?.npcGrid ? spatialQueryNeighbors(ctx.npcGrid, x, y) : npcs.values();
  for (const npc of candidates) {
    if (!npc || !npc.alive) continue;
    if (skipNpc && npc === skipNpc) continue;
    if (wrappedDistanceSq(x, y, npc.x, npc.y) > r2) continue;
    triggerNpcPanic(npc, sourceX, sourceY, minSeconds, maxSeconds);
  }
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

  if (weapon.type !== 'melee') {
    reportWitnessedGunfire(player, sx, sy);
    panicNpcsNearPoint(sx, sy, 132, sx, sy, 1.4, 2.6, null, tickSpatialContext);
  }

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
        triggerNpcPanic(bestHit, sx, sy, 2.0, 3.2);
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

    const panicCandidates = nearbyAliveNpcsForShotSegment(sx, sy, ex, ey, tickSpatialContext);
    for (const npc of panicCandidates) {
      if (!npc.alive || npc === bestHit) continue;
      const hit = pointToSegmentDistanceSq(npc.x, npc.y, sx, sy, ex, ey);
      if (hit.distSq < 56 * 56) {
        triggerNpcPanic(npc, sx, sy, 1.2, 2.2);
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
    if (!Number.isFinite(player.gunfireWitnessCooldown)) {
      player.gunfireWitnessCooldown = 0;
    } else if (player.gunfireWitnessCooldown > 0) {
      player.gunfireWitnessCooldown = Math.max(0, player.gunfireWitnessCooldown - dt);
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
  if ((Number(car.followBlockedTimer) || 0) > 0) return true;
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
  if (!Number.isFinite(car.followBlockedTimer)) car.followBlockedTimer = 0;
  car.followBlockedTimer = Math.max(0, car.followBlockedTimer - dt);

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
        car.sirenOn = !!(car.dismountTargetPlayerId || car.huntTargetPlayerId);
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
      if (hit > 22) {
        if (a.type === 'cop' && b.driverId) {
          const offender = players.get(b.driverId);
          if (offender && offender.health > 0 && !offender.insideShopId) {
            triggerCopCarAggroOnAttack(a, offender);
          }
        }
        if (b.type === 'cop' && a.driverId) {
          const offender = players.get(a.driverId);
          if (offender && offender.health > 0 && !offender.insideShopId) {
            triggerCopCarAggroOnAttack(b, offender);
          }
        }
      }
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

    const desired = wrappedDirection(npc.x, npc.y, car.x, car.y);
    npc.aiState = 'return';
    npc.navTargetNodeId = null;
    npc.panicTimer = Math.max(npc.panicTimer || 0, 0.2);
    moveNpcWithCollision(npc, desired, Math.max((npc.baseSpeed || 32) + 30, 72), stepDt);

    if (!car.driverId && wrappedDistanceSq(npc.x, npc.y, car.x, car.y) < 18 * 18) {
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

  function refreshQuestTargetZoneIfDue(assignment, npc, nowMs) {
    if (!assignment || !npc) return assignment;
    const lastUpdatedAt = Math.max(0, Math.round(Number(assignment.updatedAt) || 0));
    if (nowMs - lastUpdatedAt < QUEST_TARGET_ZONE_REFRESH_MS) return assignment;

    const next = persistQuestTargetAssignment({
      ...assignment,
      zoneX: wrapWorldX(npc.x),
      zoneY: wrapWorldY(npc.y),
      zoneRadius: Math.max(24, Number(assignment.zoneRadius) || QUEST_TARGET_ZONE_RADIUS),
      updatedAt: nowMs,
    });
    if (!next) return assignment;

    const ownerPlayer = findOnlinePlayerByProfileId(next.profileId);
    if (ownerPlayer && Array.isArray(ownerPlayer.questEntries)) {
      const entry = ownerPlayer.questEntries.find((item) => (item.id >>> 0) === (next.questId >>> 0));
      if (entry) {
        entry.targetNpcId = next.targetNpcId;
        entry.targetZoneX = next.zoneX;
        entry.targetZoneY = next.zoneY;
        entry.targetZoneRadius = next.zoneRadius;
      }
      emitQuestSyncForPlayer(ownerPlayer);
    }
    return next;
  }

  function stepQuestTargetTracking(npc) {
    const ownerKey = questTargetOwnerByNpcId.get(npc.id);
    if (!ownerKey) return;

    let assignment = questTargetAssignmentsByKey.get(ownerKey) || null;
    if (!assignment || assignment.targetNpcId !== npc.id) {
      const parsedOwner = parseQuestTargetKey(ownerKey);
      if (!parsedOwner) {
        questTargetOwnerByNpcId.delete(npc.id);
        return;
      }
      assignment = readQuestTargetAssignment(parsedOwner.profileId, parsedOwner.questId);
      if (!assignment || assignment.targetNpcId !== npc.id) {
        questTargetOwnerByNpcId.delete(npc.id);
        return;
      }
    }
    refreshQuestTargetZoneIfDue(assignment, npc, Date.now());
  }

  for (const npc of npcs.values()) {
    if (!npc.alive) {
      removeNpcFromGroup(npc);
      if (npc.corpseState === 'down') {
        npc.corpseDownTimer = (npc.corpseDownTimer || 0) + dt;
        if (npc.corpseDownTimer >= NPC_HOSPITAL_FALLBACK_SECONDS) {
          const claimedByCar = npc.bodyClaimedBy ? cars.get(npc.bodyClaimedBy) : null;
          if (claimedByCar && claimedByCar.type === 'ambulance') {
            resetAmbulanceTask(claimedByCar);
          }
          npc.bodyClaimedBy = null;
          npc.bodyCarriedBy = null;
          const release = hospitalReleaseSpawn(npc.x, npc.y);
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
          respawnNpc(npc, hospitalReleaseSpawn(npc.x, npc.y));
        }
      }
      continue;
    }
    const tier = OPT_ZONE_LOD ? zoneLevelForPosition(npc.x, npc.y) : 'active';
    const npcDt = lodStepDt(npc.id, npc.x, npc.y, dt, 4, 8);
    stepQuestTargetTracking(npc);
    if (npcDt <= 0) {
      continue;
    }

    if (stepNpcReclaimCar(npc, npcDt)) {
      wrapWorldPosition(npc);
      continue;
    }

    const nowSec = Date.now() / 1000;
    if (npc.panicTimer > 0) {
      npc.aiState = 'panic';
      npc.panicUntil = Math.max(Number(npc.panicUntil) || 0, nowSec + npc.panicTimer);
      npc.panicTimer = Math.max(0, npc.panicTimer - npcDt);
    }
    if (npc.aiState === 'panic' && nowSec >= (Number(npc.panicUntil) || 0)) {
      npc.aiState = 'return';
    }

    const allowDecisions =
      tier === 'active' || ((tickCount + idPhase(npc.id)) % (tier === 'warm' ? 3 : 5) === 0);

    if (tier === 'cold') {
      stepNpcColdTier(npc, npcDt, nowSec, allowDecisions);
      wrapWorldPosition(npc);
      continue;
    }

    npc.wanderTimer = (Number(npc.wanderTimer) || 0) - npcDt;
    if (npc.wanderTimer <= 0 && allowDecisions) {
      npc.wanderTimer = randRange(0.8, 2.4);
      npc.baseSpeed = randRange(28, 45);
    }

    if (npc.aiState === 'panic') {
      stepNpcPanicFlee(npc, npcDt);
      wrapWorldPosition(npc);
      continue;
    }

    if (npc.aiState === 'return') {
      stepNpcReturnToNav(npc, npcDt);
      recoverNpcFromRoad(npc, npcDt, 180);
      wrapWorldPosition(npc);
      continue;
    }

    stepNpcDirectionalRoam(npc, npcDt, 0);
    recoverNpcFromRoad(npc, npcDt, 140);

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

function moveCopCombat(cop, target, dt, options = null) {
  const holdGround = !!(options && options.holdGround);
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
    if (holdGround) {
      cop.dir = angleApproach(cop.dir, toward, dt * 7.2);
      if (Math.random() < 0.24) {
        const sidestep = angleWrap(toward + cop.combatStrafeDir * Math.PI * 0.5 + randRange(-0.05, 0.05));
        moveCop(cop, sidestep, 30, dt);
      }
      return;
    }
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
  const toward = Math.atan2(toTarget.dy, toTarget.dx);
  const distT = clamp(dist / 230, 0, 1);
  const hitChance = COP_SHOT_HIT_CHANCE_NEAR + (COP_SHOT_HIT_CHANCE_FAR - COP_SHOT_HIT_CHANCE_NEAR) * distT;
  const shouldHit = Math.random() < hitChance;
  let aimOffset = randRange(-COP_SHOT_HIT_AIM_JITTER, COP_SHOT_HIT_AIM_JITTER);
  if (!shouldHit) {
    const side = Math.random() < 0.5 ? -1 : 1;
    aimOffset = side * randRange(COP_SHOT_MISS_AIM_OFFSET_MIN, COP_SHOT_MISS_AIM_OFFSET_MAX);
  }
  const aim = toward + aimOffset;
  let maxDist = Math.min(250, firstSolidDistance(cop.x, cop.y, aim, 250));
  const carBlock = firstCarBlockDistance(cop.x, cop.y, aim, maxDist, cop.inCarId || null);
  if (carBlock) {
    maxDist = Math.min(maxDist, carBlock.dist);
  }
  const ex = wrapWorldX(cop.x + Math.cos(aim) * maxDist);
  const ey = wrapWorldY(cop.y + Math.sin(aim) * maxDist);
  const rayDx = Math.cos(aim);
  const rayDy = Math.sin(aim);
  const along = toTarget.dx * rayDx + toTarget.dy * rayDy;
  const perp = Math.abs(toTarget.dx * -rayDy + toTarget.dy * rayDx);
  const hitsTargetRay =
    !target.inCarId &&
    along > 0 &&
    along <= maxDist + COP_SHOT_TARGET_RADIUS &&
    perp <= COP_SHOT_TARGET_RADIUS;
  if (hitsTargetRay) {
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
    if (!Number.isFinite(cop.huntLostTimer)) {
      cop.huntLostTimer = 0;
    }

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
          const release = hospitalReleaseSpawn(cop.x, cop.y);
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
          respawnCop(cop, hospitalReleaseSpawn(cop.x, cop.y), true);
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
        const trackedTargetId = String(car.huntTargetPlayerId || car.dismountTargetPlayerId || '');
        let target = trackedTargetId ? players.get(trackedTargetId) : null;
        if (!isFiveStarTrackablePlayer(target)) {
          target = null;
        }
        if (target && wrappedDistanceSq(car.x, car.y, target.x, target.y) > COP_CAR_RECALL_RADIUS * COP_CAR_RECALL_RADIUS) {
          target = null;
        }

        if (target) {
          car.huntTargetPlayerId = target.id;
          car.dismountTargetPlayerId = target.id;
          cop.huntLostTimer = 0;
          if (cop.rejoinCarId && cop.assignedCarId === cop.rejoinCarId) {
            cop.mode = 'return';
            cop.targetPlayerId = null;
            moveCop(cop, wrappedDirection(cop.x, cop.y, car.x, car.y), 106, dt);
          } else {
            cop.mode = 'hunt';
            cop.targetPlayerId = target.id;
            moveCopCombat(cop, target, dt, { holdGround: true });
            shootAtTargetFromCop(cop, target);
          }
        } else {
          cop.huntLostTimer += dt;
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
          cop.huntLostTimer = 0;
          cop.cooldown = randRange(0.22, 0.6);
          removeCopFromAssignedCar(cop);
        }

        wrapWorldPosition(cop);
        continue;
      }
    }

    const previousTargetId = String(cop.targetPlayerId || '');
    let target = previousTargetId ? players.get(previousTargetId) : null;
    if (!isFiveStarTrackablePlayer(target)) {
      target = null;
    }
    if (target && wrappedDistanceSq(cop.x, cop.y, target.x, target.y) > COP_HUNT_LEASH_RADIUS_SQ) {
      target = null;
    }
    if (!target) {
      cop.huntLostTimer += dt;
      const hunterCounts = activeCopHunterCountsByPlayer();
      target = nearestFiveStarPlayer(cop.x, cop.y, {
        maxDistanceSq: COP_HUNT_JOIN_RADIUS_SQ,
        countsByPlayer: hunterCounts,
        capPerPlayer: COP_MAX_HUNTERS_PER_PLAYER,
        keepTargetId: previousTargetId,
      });
    }
    if (target) {
      cop.mode = 'hunt';
      cop.targetPlayerId = target.id;
      cop.huntLostTimer = 0;
      moveCopCombat(cop, target, dt);
      shootAtTargetFromCop(cop, target);
    } else {
      const inLeashGrace = previousTargetId && cop.huntLostTimer < COP_HUNT_LOST_TIMEOUT;
      if (inLeashGrace) {
        cop.mode = 'hunt';
        cop.targetPlayerId = previousTargetId;
        moveCop(cop, cop.dir, 62, dt);
        wrapWorldPosition(cop);
        continue;
      }
      const patrolDt = lodStepDt(cop.id, cop.x, cop.y, dt, 2, 3);
      if (patrolDt <= 0) {
        continue;
      }
      cop.mode = 'patrol';
      cop.targetPlayerId = null;
      cop.huntLostTimer = 0;
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
      if (car.huntTargetPlayerId) {
        trackingPlayer = car.huntTargetPlayerId === player.id;
      } else if (car.dismountTargetPlayerId) {
        trackingPlayer = car.dismountTargetPlayerId === player.id;
      } else {
        const target = nearestFiveStarPlayer(car.x, car.y, { maxDistanceSq: COP_CAR_HUNT_JOIN_RADIUS_SQ });
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
  const npcGrid = makeSpatialGrid(COLLISION_GRID_CELL);
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
    if (npc.alive) {
      spatialInsert(npcGrid, npc);
      continue;
    }
    if (npc.corpseState === 'down' && !npc.bodyClaimedBy) {
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
    npcGrid,
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
        triggerNpcPanic(npc, car.x, car.y, 1.3, 2.4);
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

function stepNpcFearByPlayerCars(ctx = tickSpatialContext) {
  const allCars = Array.isArray(ctx?.cars) ? ctx.cars : [];
  if (allCars.length === 0) return;
  const npcGrid = ctx?.npcGrid || null;
  const nowSec = Date.now() / 1000;

  for (const car of allCars) {
    if (!car || car.destroyed || !car.driverId) continue;
    const driver = players.get(car.driverId);
    if (!driver || driver.health <= 0 || driver.insideShopId) continue;

    const speed = Math.abs(Number(car.speed) || 0);
    if (speed < NPC_PLAYER_CAR_FEAR_MIN_SPEED) continue;

    const fearRadius = clamp(
      NPC_PLAYER_CAR_FEAR_RADIUS_BASE + speed * NPC_PLAYER_CAR_FEAR_RADIUS_PER_SPEED,
      NPC_PLAYER_CAR_FEAR_RADIUS_BASE,
      NPC_PLAYER_CAR_FEAR_RADIUS_MAX
    );
    const fearRadiusSq = fearRadius * fearRadius;
    const panicMax = clamp(
      NPC_PLAYER_CAR_FEAR_PANIC_BASE_MAX_SECONDS + speed * 0.02,
      NPC_PLAYER_CAR_FEAR_PANIC_BASE_MAX_SECONDS,
      NPC_PLAYER_CAR_FEAR_PANIC_MAX_SECONDS
    );
    const forwardX = Math.cos(Number(car.angle) || 0);
    const forwardY = Math.sin(Number(car.angle) || 0);
    const candidates = npcGrid ? spatialQueryNeighbors(npcGrid, car.x, car.y) : npcs.values();

    for (const npc of candidates) {
      if (!npc || !npc.alive) continue;
      if (Number(npc.vehicleFearUntil) > nowSec) continue;

      const dx = wrapDelta(npc.x - car.x, WORLD.width);
      const dy = wrapDelta(npc.y - car.y, WORLD.height);
      const d2 = dx * dx + dy * dy;
      if (d2 > fearRadiusSq) continue;

      const dist = Math.sqrt(Math.max(0.0001, d2));
      const nx = dx / dist;
      const ny = dy / dist;
      const aheadDot = nx * forwardX + ny * forwardY;
      if (dist > NPC_PLAYER_CAR_FEAR_SIDE_DISTANCE && aheadDot < NPC_PLAYER_CAR_FEAR_AHEAD_DOT_MIN) continue;

      triggerNpcPanic(npc, car.x, car.y, NPC_PLAYER_CAR_FEAR_PANIC_MIN_SECONDS, panicMax);
      npc.vehicleFearUntil = nowSec + randRange(0.45, 0.95);
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
      if (driver && driver.health > 0 && !driver.insideShopId) {
        const alreadyInFiveStarPursuit = driver.stars >= 5 || driver.starHeat >= 4.99;
        forceFiveStars(driver, 42);
        alertNearbyCopCarsForPlayer(driver, cop.x, cop.y, POLICE_WITNESS_RADIUS * 1.2);
        if (!alreadyInFiveStarPursuit) {
          emitEvent('copWitness', {
            playerId: driver.id,
            x: cop.x,
            y: cop.y,
          });
          driver.copAlertPlayed = true;
        }
      }
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
      respawnCop(cop, hospitalReleaseSpawn(cop.x, cop.y), true);
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

function serializeCarForSnapshot(car, highlightedTargetCarId = '') {
  const isQuestTarget = highlightedTargetCarId && car.id === highlightedTargetCarId;
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
    questTarget: !!isQuestTarget,
  };
}

function serializeNpcForSnapshot(npc, highlightedTargetNpcId = '') {
  const isQuestTarget = highlightedTargetNpcId && npc.id === highlightedTargetNpcId;
  return {
    id: npc.id,
    x: quantized(npc.x, 100),
    y: quantized(npc.y, 100),
    dir: quantized(npc.dir, 1000),
    alive: npc.alive,
    corpseState: npc.corpseState,
    skinColor: isQuestTarget ? QUEST_TARGET_SKIN_COLOR : npc.skinColor,
    shirtColor: isQuestTarget ? QUEST_TARGET_SHIRT_COLOR : npc.shirtColor,
    shirtDark: isQuestTarget ? QUEST_TARGET_SHIRT_DARK : npc.shirtDark || '#2a3342',
    questTarget: !!isQuestTarget,
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
    if (event.type === 'questSync') {
      if (event.playerId === player.id) {
        filtered.push(event);
      }
      continue;
    }
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
  if (car.type === 'cop' && (car.dismountTargetPlayerId === player.id || car.huntTargetPlayerId === player.id)) {
    return true;
  }
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
  const highlightedTargetCarId = String(player.activeQuestTargetCarId || '');
  for (const car of cars.values()) {
    if (!shouldIncludeCarForPlayer(player, car)) continue;
    carsPayload.push(serializeCarForSnapshot(car, highlightedTargetCarId));
  }

  const npcsPayload = [];
  const highlightedTargetNpcId = String(player.activeQuestTargetNpcId || '');
  for (const npc of npcs.values()) {
    if (!shouldIncludeNpcForPlayer(player, npc)) continue;
    npcsPayload.push(serializeNpcForSnapshot(npc, highlightedTargetNpcId));
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
    questTarget: !!record.questTarget,
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
    questTarget: !!record.questTarget,
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
  if (event.type === 'questSync') {
    wire.reputation = clamp(Math.round(Number(event.reputation) || 0), 0, 0xffffffff);
    wire.gunShopUnlocked = !!event.gunShopUnlocked;
    wire.quests = Array.isArray(event.quests)
      ? event.quests.map((entry) => ({
          id: (entry?.id >>> 0) || 0,
          progress: clamp(Math.round(Number(entry?.progress) || 0), 0, 65535),
          statusCode: clamp(Math.round(Number(entry?.statusCode) || 0), 0, 255),
          targetZoneX: Number.isFinite(entry?.targetZoneX) ? wrapWorldX(entry.targetZoneX) : 0,
          targetZoneY: Number.isFinite(entry?.targetZoneY) ? wrapWorldY(entry.targetZoneY) : 0,
          targetZoneRadius: clamp(Math.round(Number(entry?.targetZoneRadius) || 0), 0, 65535),
        }))
      : [];
  }

  return wire;
}

const { ensureClientSnapshotState, buildSectionDelta } = createSnapshotFeature({
  SNAPSHOT_KEYFRAME_EVERY,
  SNAPSHOT_SECTION_ORDER,
});

const { serializePresencePayloadBinary, broadcastPresence } = createPresenceFeature({
  players,
  clients,
  WebSocket,
  WORLD_REV,
  normalizeHexColor,
  protocolIdForEntity,
  protocolIdForEntityOptional,
  encodePresenceFrame,
  addBytesSent: (amount) => {
    bytesSentSinceReport += amount;
  },
});

function broadcastSnapshot(nowPerfMs = Math.round(performance.now())) {
  if (clients.size === 0) {
    clearPendingEvents();
    return;
  }
  const nowWallMs = Date.now();
  const events = drainPendingEvents();
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

const transportFeature = createTransportFeature({
  clients,
  players,
  cars,
  emitEvent,
  broadcastPresence,
  sanitizeName,
  sanitizeColor,
  sanitizeProfileId,
  sanitizeChatText,
  randomPedSpawn,
  makeId,
  restoreProgressForPlayer,
  attachCrimeReputationToPlayer,
  attachQuestStateToPlayer,
  releaseQuestTargetReservationsForProfile,
  createQuestBootstrapForPlayer,
  progressSignatureFromPlayer,
  createProgressTicketForPlayer,
  protocolIdForEntity,
  clamp,
  buyItemForPlayer,
  onPlayerJoin: trackPlayerSessionJoin,
  onPlayerDisconnect: trackPlayerSessionDisconnect,
  decodeClientFrame,
  encodeErrorFrame,
  encodeNoticeFrame,
  encodeJoinedFrame,
  WORLD,
  TICK_RATE,
  WORLD_REV,
  STATIC_WORLD_PAYLOAD,
  CHAT_DURATION_MS,
  OPCODES,
});

transportFeature.attachSocketServerHandlers(wss);

const serverFeatures = {
  combat: createCombatFeature({
    fireShot,
    applyExplosionDamage,
    damagePlayer,
    damageCop,
    killNpc,
    stepPlayerHits,
  }),
  cops: createCopsFeature({
    makeCopUnit,
    respawnCop,
    stepCops,
    stepCopHitsByCars,
    stepCopCar,
    tryDeployCopOfficers,
  }),
  crime: createCrimeFeature({
    addCrimeRating,
    removeCrimeRating,
    addStars,
    forceFiveStars,
    policeWitnessReport,
    attachCrimeReputationToPlayer,
    loadCrimeReputationStore,
    closeCrimeReputationStore,
    onlineCrimeProfileIds,
  }),
  economy: createEconomyFeature({
    buyItemForPlayer,
    enterShop,
    exitShop,
    makeCashDrop,
    stepCashDrops,
    stepBloodStains,
  }),
  npcs: createNpcsFeature({
    makeNpc,
    respawnNpc,
    stepNpcs,
    stepNpcHitsByCars,
  }),
  players: createPlayersFeature({
    stepPlayers,
    tryRespawn,
    handleEnterOrExit,
    applyWeaponSelection,
  }),
  spawning: createSpawningFeature({
    ensureCarPopulation,
    ensureNpcPopulation,
    ensureCopPopulation,
    ensureCopCarCrews,
    resetAmbientSceneWhenEmpty,
    hospitalReleaseSpawn,
    randomPedSpawn,
    randomRoadSpawn,
  }),
  traffic: createTrafficFeature({
    stepTrafficCar,
  }),
  vehicles: createVehiclesFeature({
    makeCar,
    stepCars,
    stepCarHitsByCars,
    destroyCar,
    damageCar,
    resetCarForRespawn,
    stepDrivenCar,
    stepAbandonedCar,
  }),
};

serverFeatures.crime.loadCrimeReputationStore();

for (let i = 0; i < TRAFFIC_COUNT; i++) {
  serverFeatures.vehicles.makeCar('civilian');
}
for (let i = 0; i < COP_COUNT; i++) {
  serverFeatures.vehicles.makeCar('cop');
}
for (let i = 0; i < AMBULANCE_COUNT; i++) {
  serverFeatures.vehicles.makeCar('ambulance');
}
for (let i = 0; i < NPC_COUNT; i++) {
  serverFeatures.npcs.makeNpc();
}
for (let i = 0; i < COP_OFFICER_COUNT; i++) {
  serverFeatures.cops.makeCopUnit();
}
serverFeatures.spawning.ensureCopCarCrews();

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
  serverFeatures.players.stepPlayers(DT);
  serverFeatures.vehicles.stepCars(DT);
  stepQuestTargetCarTracking();
  tickSpatialContext = buildTickSpatialContext();
  serverFeatures.vehicles.stepCarHitsByCars(tickSpatialContext);
  serverFeatures.cops.stepCops(DT);
  maybeEmitCopTriggerAlerts();
  stepNpcFearByPlayerCars(tickSpatialContext);
  serverFeatures.npcs.stepNpcs(DT);
  tickSpatialContext = buildTickSpatialContext();
  serverFeatures.combat.stepPlayerHits(tickSpatialContext);
  serverFeatures.npcs.stepNpcHitsByCars(tickSpatialContext);
  serverFeatures.cops.stepCopHitsByCars(tickSpatialContext);
  serverFeatures.economy.stepCashDrops(DT);
  serverFeatures.economy.stepBloodStains(DT);
  serverFeatures.spawning.resetAmbientSceneWhenEmpty();
  serverFeatures.spawning.ensureCarPopulation();
  serverFeatures.spawning.ensureNpcPopulation();
  serverFeatures.spawning.ensureCopPopulation();
  serverFeatures.spawning.ensureCopCarCrews();
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
    `flags AOI=${OPT_AOI ? 1 : 0} ZONE_LOD=${OPT_ZONE_LOD ? 1 : 0} CLIENT_VFX=${OPT_CLIENT_VFX ? 1 : 0} NAV_DEBUG_MAP=${OPT_NPC_NAV_DEBUG_MAP ? 1 : 0}`
  );
  if (OPT_NPC_NAV_DEBUG_MAP) {
    // eslint-disable-next-line no-console
    console.log(
      `[nav] map nodes=${STATIC_WORLD_PAYLOAD.npcNavNodes.length} stride=${NPC_NAV_DEBUG_MAP_STRIDE} max=${NPC_NAV_DEBUG_MAP_MAX_NODES}`
    );
  }
  if (ADMIN_USING_LOCAL_DEFAULTS) {
    // eslint-disable-next-line no-console
    console.log('[admin] local defaults active (ADMIN_USER=admin, ADMIN_PASS=change_me)');
  }
});
