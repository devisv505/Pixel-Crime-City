const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = Number(process.env.PORT || 3000);
const TICK_RATE = 30;
const DT = 1 / TICK_RATE;

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

const TRAFFIC_COUNT = 254;
const COP_COUNT = 32;
const COP_OFFICER_COUNT = 32;
const AMBULANCE_COUNT = 8;
const AMBULANCE_CAPACITY = 3;
const CAR_STUCK_RESPAWN_SECONDS = 5;
const MAX_NAME_LENGTH = 16;
const POLICE_WITNESS_RADIUS = 190;
const COP_ALERT_MARK_SECONDS = 2.4;
const NPC_HOSPITAL_FALLBACK_SECONDS = 60;
const BLOOD_STAIN_LIFETIME = 240;

const clients = new Map();
const players = new Map();
const cars = new Map();
const npcs = new Map();
const cops = new Map();
const cashDrops = new Map();
const bloodStains = new Map();

let nextId = 1;
let nextEventId = 1;
let pendingEvents = [];

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

app.use(express.static(path.join(__dirname, 'public')));

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

function makeId(prefix) {
  return `${prefix}_${nextId++}`;
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
    if (car.type !== 'cop') continue;
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
  const car = {
    id: makeId('car'),
    type,
    x: spawn.x,
    y: spawn.y,
    angle: spawn.angle,
    speed: isCop ? 75 : isAmbulance ? 60 : 55,
    maxSpeed: isCop ? 190 : isAmbulance ? 165 : 145,
    turnSpeed: isCop ? 3.1 : isAmbulance ? 2.6 : 2.2,
    width: 24,
    height: 14,
    driverId: null,
    npcDriver: true,
    abandonTimer: 0,
    aiCooldown: randRange(0.35, 1.35),
    hornCooldown: randRange(0, 1),
    bodyHitCooldown: 0,
    dismountCooldown: 0,
    dismountCopIds: [],
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
    rejoinCarId: null,
    assignedCarId: null,
    inCarId: null,
    mode: 'patrol',
    targetPlayerId: null,
    alertTimer: 0,
  };
  cops.set(cop.id, cop);
  return cop;
}

function respawnCop(cop, spawnOverride = null, rejoinPreviousCar = false) {
  const spawn = spawnOverride || randomCurbSpawn();
  const desiredCarId = rejoinPreviousCar ? cop.rejoinCarId : null;
  const desiredCar = desiredCarId ? cars.get(desiredCarId) : null;
  const canRejoin = !!(desiredCar && desiredCar.type === 'cop');

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
  cop.rejoinCarId = canRejoin ? desiredCarId : null;
  cop.assignedCarId = canRejoin ? desiredCarId : null;
  cop.inCarId = null;
  cop.mode = canRejoin ? 'return' : 'patrol';
  cop.targetPlayerId = null;
  cop.alertTimer = 0;
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

  const recoveryCarId = cop.assignedCarId || cop.inCarId || cop.rejoinCarId || null;
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
  cop.targetPlayerId = null;
  cop.cooldown = 0;
  cop.inCarId = null;
  makeBloodStain(cop.x, cop.y);

  if (killer && killer.health > 0) {
    addStars(killer, 1.25, 34);
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
      candidate.dismountTargetPlayerId = player.id;
      tryDeployCopOfficers(candidate, player);
      candidate.sirenOn = true;
    } else if (candidate.type === 'ambulance') {
      addStars(player, 1.0, 28);
    } else {
      addStars(player, 0.75, 26);
    }
  }

  candidate.driverId = player.id;
  player.inCarId = candidate.id;
  player.x = candidate.x;
  player.y = candidate.y;
  player.dir = candidate.angle;

  if (candidate.type === 'cop' && !candidate.stolenFromNpc) {
    addStars(player, 0.8, 30);
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
    const dx = player.x - x;
    const dy = player.y - y;
    const dist2 = dx * dx + dy * dy;
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

  for (const cop of cops.values()) {
    if (!cop.alive) continue;
    if (cop.assignedCarId && cop.assignedCarId !== car.id) continue;
    if (cop.inCarId && cop.inCarId !== car.id) continue;
    if (alreadySelected.has(cop.id)) continue;
    const score =
      cop.inCarId === car.id ? -1 : (cop.x - car.x) * (cop.x - car.x) + (cop.y - car.y) * (cop.y - car.y);
    if (score < bestScore) {
      best = cop;
      bestScore = score;
    }
  }

  if (!best) return null;
  const side = alreadySelected.size === 0 ? -1 : 1;
  const offset = 12;
  const sx = Math.sin(car.angle);
  const sy = -Math.cos(car.angle);
  best.x = wrapWorldX(car.x + sx * side * offset);
  best.y = wrapWorldY(car.y + sy * side * offset);
  best.dir = Math.atan2(target.y - best.y, target.x - best.x);
  best.mode = 'hunt';
  best.targetPlayerId = target.id;
  best.rejoinCarId = null;
  best.assignedCarId = car.id;
  best.inCarId = null;
  best.cooldown = randRange(0.15, 0.42);
  best.patrolTimer = randRange(0.8, 1.6);
  return best;
}

function tryDeployCopOfficers(car, target) {
  if (!target || target.health <= 0 || target.stars < 5 || target.insideShopId) return;
  if (car.dismountCooldown > 0) return;
  if (Math.hypot(target.x - car.x, target.y - car.y) > COP_CAR_DISMOUNT_RADIUS) return;

  pruneCopCarAssignments(car);
  if (car.dismountCopIds.length > 0) {
    car.dismountTargetPlayerId = target.id;
    return;
  }

  const selected = new Set();
  for (let i = 0; i < 2; i++) {
    const cop = availableCopForCar(car, target, selected);
    if (!cop) break;
    selected.add(cop.id);
  }
  if (selected.size < 2) {
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
      Math.hypot(target.x - car.x, target.y - car.y) > COP_CAR_RECALL_RADIUS
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
  const desired = Math.atan2(target.y - car.y, target.x - car.x);
  const steerDesired = chooseAvoidanceHeading(car, desired);
  car.angle = angleApproach(car.angle, steerDesired, dt * 2.4);
  const dist = Math.hypot(target.x - car.x, target.y - car.y);
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

  for (const npc of npcs.values()) {
    if (npc.alive || npc.corpseState !== 'down' || npc.bodyClaimedBy) continue;
    const dx = npc.x - x;
    const dy = npc.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDistSq) {
      best = { type: 'npc', id: npc.id, entity: npc };
      bestDistSq = d2;
    }
  }

  for (const cop of cops.values()) {
    if (cop.alive || cop.corpseState !== 'down' || cop.bodyClaimedBy) continue;
    const dx = cop.x - x;
    const dy = cop.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDistSq) {
      best = { type: 'cop', id: cop.id, entity: cop };
      bestDistSq = d2;
    }
  }

  return best;
}

function driveAiToward(car, targetX, targetY, dt, farSpeed = 98, nearSpeed = 34) {
  const desired = Math.atan2(targetY - car.y, targetX - car.x);
  const steerDesired = chooseAvoidanceHeading(car, desired);
  car.angle = angleApproach(car.angle, steerDesired, dt * 2.7);
  const dist = Math.hypot(targetX - car.x, targetY - car.y);
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

    const dx = car.x - entity.x;
    const dy = car.y - entity.y;
    const d2 = dx * dx + dy * dy;
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
      emitEvent('pvpKill', {
        killerId: attacker.id,
        victimId: victim.id,
        x: victim.x,
        y: victim.y,
      });
    }
  }
}

function applyExplosionDamage(x, y, attacker, radius = 72) {
  const r2 = radius * radius;

  for (const npc of npcs.values()) {
    if (!npc.alive) continue;
    if (wrappedDistanceSq(x, y, npc.x, npc.y) > r2) continue;
    killNpc(npc, attacker ? attacker.id : null);
  }

  for (const cop of cops.values()) {
    if (!cop.alive || cop.inCarId) continue;
    if (wrappedDistanceSq(x, y, cop.x, cop.y) > r2) continue;
    damageCop(cop, 999, attacker || null);
  }

  for (const other of players.values()) {
    if (other.health <= 0 || other.insideShopId) continue;
    if (attacker && other.id === attacker.id) continue;
    if (wrappedDistanceSq(x, y, other.x, other.y) > r2) continue;
    damagePlayer(other, 220, attacker || null);
  }

  const carEffectRadius = radius * 1.6;
  const carEffectR2 = carEffectRadius * carEffectRadius;
  for (const car of cars.values()) {
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
    let ex = sx + Math.cos(pelletDir) * shotLength;
    let ey = sy + Math.sin(pelletDir) * shotLength;

    let bestHitType = null;
    let bestHit = null;
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
  const cruiseSpeed = car.type === 'cop' ? 88 : car.type === 'ambulance' ? 72 : 62;
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

function stepCars(dt) {
  for (const car of cars.values()) {
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
        stepTrafficCar(car, dt);
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
    stepAbandonedCar(car, dt);
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

function stepCarHitsByCars() {
  const list = Array.from(cars.values());
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];

      const dx = b.x - a.x;
      const dy = b.y - a.y;
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

function stepPlayerHits() {
  for (const player of players.values()) {
    if (player.health <= 0 || player.inCarId || player.hitCooldown > 0 || player.insideShopId) {
      continue;
    }

    for (const car of cars.values()) {
      if (car.type === 'cop' && !car.driverId) {
        continue;
      }
      const impactSpeed = Math.abs(car.speed);
      if (impactSpeed < 38) continue;

      const dx = car.x - player.x;
      const dy = car.y - player.y;
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

  function stepNpcReclaimCar(npc) {
    if (!npc.reclaimCarId) return false;

    const car = cars.get(npc.reclaimCarId);
    if (!car || !car.stolenFromNpc || car.type === 'cop') {
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
    npc.dir = angleApproach(npc.dir, desired, dt * 5.8);
    npc.panicTimer = Math.max(npc.panicTimer, 0.2);
    npc.crossingTimer = Math.max(npc.crossingTimer, 0.35);

    const speed = Math.max(npc.baseSpeed + 30, 72);
    const nx = wrapWorldX(npc.x + Math.cos(npc.dir) * speed * dt);
    const ny = wrapWorldY(npc.y + Math.sin(npc.dir) * speed * dt);

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
        if (carrier && carrier.type === 'ambulance') {
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

    if (stepNpcReclaimCar(npc)) {
      wrapWorldPosition(npc);
      continue;
    }

    if (npc.panicTimer > 0) {
      npc.panicTimer -= dt;
    }
    if (npc.crossingTimer > 0) {
      npc.crossingTimer -= dt;
    }

    npc.wanderTimer -= dt;
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
    const nx = npc.x + Math.cos(npc.dir) * speed * dt;
    const ny = npc.y + Math.sin(npc.dir) * speed * dt;

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

function shootAtTargetFromCop(cop, target) {
  const dist = Math.hypot(target.x - cop.x, target.y - cop.y);
  if (dist >= 230 || cop.cooldown > 0) return;

  cop.cooldown = randRange(0.52, 0.86);
  const aim = Math.atan2(target.y - cop.y, target.x - cop.x) + randRange(-0.06, 0.06);
  const maxDist = Math.min(250, firstSolidDistance(cop.x, cop.y, aim, 250));
  const ex = cop.x + Math.cos(aim) * maxDist;
  const ey = cop.y + Math.sin(aim) * maxDist;
  const directDist = Math.hypot(target.x - cop.x, target.y - cop.y);
  if (directDist <= maxDist + 4) {
    damagePlayer(target, 15, null);
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
      if (cop.corpseState === 'carried') {
        const carrier = cop.bodyCarriedBy ? cars.get(cop.bodyCarriedBy) : null;
        if (carrier && carrier.type === 'ambulance') {
          cop.x = carrier.x;
          cop.y = carrier.y;
          cop.dir = carrier.angle;
        } else {
          cop.corpseState = 'down';
          cop.bodyCarriedBy = null;
          cop.bodyClaimedBy = null;
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
      if (!car || car.type !== 'cop') {
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
      if (!car || car.type !== 'cop') {
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
          Math.hypot(target.x - car.x, target.y - car.y) > COP_CAR_RECALL_RADIUS
        ) {
          target = null;
        }

        if (target) {
          if (cop.rejoinCarId && cop.assignedCarId === cop.rejoinCarId) {
            cop.mode = 'return';
            cop.targetPlayerId = null;
            moveCop(cop, Math.atan2(car.y - cop.y, car.x - cop.x), 106, dt);
          } else {
            cop.mode = 'hunt';
            cop.targetPlayerId = target.id;
            moveCop(cop, Math.atan2(target.y - cop.y, target.x - cop.x), 98, dt);
            shootAtTargetFromCop(cop, target);
          }
        } else {
          cop.mode = 'return';
          cop.targetPlayerId = null;
          moveCop(cop, Math.atan2(car.y - cop.y, car.x - cop.x), 106, dt);
        }

        const closeToCar = Math.hypot(car.x - cop.x, car.y - cop.y) < 16;
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
      moveCop(cop, Math.atan2(target.y - cop.y, target.x - cop.x), 94, dt);
      shootAtTargetFromCop(cop, target);
    } else {
      cop.mode = 'patrol';
      cop.targetPlayerId = null;
      if (cop.patrolTimer <= 0) {
        cop.patrolTimer = randRange(0.6, 1.7);
        cop.dir += randRange(-1.3, 1.3);
      }
      moveCop(cop, cop.dir, 56, dt);
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

function stepNpcHitsByCars() {
  for (const npc of npcs.values()) {
    if (!npc.alive) continue;

    for (const car of cars.values()) {
      const impactSpeed = Math.abs(car.speed);
      if (impactSpeed < 46) continue;

      const dx = car.x - npc.x;
      const dy = car.y - npc.y;
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

function stepCopHitsByCars() {
  for (const cop of cops.values()) {
    if (!cop.alive || cop.inCarId) continue;

    for (const car of cars.values()) {
      const impactSpeed = Math.abs(car.speed);
      if (impactSpeed < 46) continue;

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
    if (!cop.alive || cop.inCarId || cop.assignedCarId) {
      respawnCop(cop);
    } else {
      cop.mode = 'patrol';
      cop.targetPlayerId = null;
    }
  }

  if (bloodStains.size > 0) {
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

function serializeSnapshot() {
  const playersPayload = [];
  for (const player of players.values()) {
    playersPayload.push({
      id: player.id,
      name: player.name,
      color: player.color,
      x: Math.round(player.x * 100) / 100,
      y: Math.round(player.y * 100) / 100,
      dir: Math.round(player.dir * 1000) / 1000,
      inCarId: player.inCarId,
      insideShopId: player.insideShopId,
      health: Math.round(player.health),
      stars: player.stars,
      money: player.money,
      weapon: player.weapon,
      ownedPistol: player.ownedPistol,
      ownedShotgun: player.ownedShotgun,
      ownedMachinegun: player.ownedMachinegun,
      ownedBazooka: player.ownedBazooka,
    });
  }

  const carsPayload = [];
  for (const car of cars.values()) {
    carsPayload.push({
      id: car.id,
      type: car.type,
      x: Math.round(car.x * 100) / 100,
      y: Math.round(car.y * 100) / 100,
      angle: Math.round(car.angle * 1000) / 1000,
      speed: Math.round(car.speed * 10) / 10,
      color: car.color,
      driverId: car.driverId,
      npcDriver: car.npcDriver,
      sirenOn: !!car.sirenOn,
    });
  }

  const npcsPayload = [];
  for (const npc of npcs.values()) {
    npcsPayload.push({
      id: npc.id,
      x: Math.round(npc.x * 100) / 100,
      y: Math.round(npc.y * 100) / 100,
      dir: Math.round(npc.dir * 1000) / 1000,
      alive: npc.alive,
      corpseState: npc.corpseState,
      skinColor: npc.skinColor,
      shirtColor: npc.shirtColor,
      shirtDark: npc.shirtDark || '#2a3342',
    });
  }

  const dropsPayload = [];
  for (const drop of cashDrops.values()) {
    dropsPayload.push({
      id: drop.id,
      x: Math.round(drop.x * 100) / 100,
      y: Math.round(drop.y * 100) / 100,
      amount: drop.amount,
      ttl: Math.round(drop.ttl * 100) / 100,
    });
  }

  const copsPayload = [];
  for (const cop of cops.values()) {
    copsPayload.push({
      id: cop.id,
      x: Math.round(cop.x * 100) / 100,
      y: Math.round(cop.y * 100) / 100,
      dir: Math.round(cop.dir * 1000) / 1000,
      health: Math.round(cop.health || 0),
      alive: !!cop.alive,
      inCarId: cop.inCarId || null,
      corpseState: cop.corpseState || 'none',
      mode: cop.mode,
      alert: (cop.alertTimer || 0) > 0,
    });
  }

  const bloodPayload = [];
  for (const stain of bloodStains.values()) {
    bloodPayload.push({
      id: stain.id,
      x: Math.round(stain.x * 100) / 100,
      y: Math.round(stain.y * 100) / 100,
      ttl: Math.round(stain.ttl * 100) / 100,
    });
  }

  return {
    type: 'snapshot',
    serverTime: Date.now(),
    world: {
      width: WORLD.width,
      height: WORLD.height,
      tileSize: WORLD.tileSize,
      blockPx: BLOCK_PX,
      roadStart: ROAD_START,
      roadEnd: ROAD_END,
      laneA: LANE_A,
      laneB: LANE_B,
      shops: SHOPS.map((shop) => ({
        id: shop.id,
        name: shop.name,
        x: shop.x,
        y: shop.y,
        radius: shop.radius,
        stock: SHOP_STOCK,
      })),
      hospital: {
        id: HOSPITAL.id,
        name: HOSPITAL.name,
        x: HOSPITAL.x,
        y: HOSPITAL.y,
        radius: HOSPITAL.radius,
      },
    },
    players: playersPayload,
    cars: carsPayload,
    npcs: npcsPayload,
    cops: copsPayload,
    drops: dropsPayload,
    blood: bloodPayload,
    events: pendingEvents,
  };
}

function broadcastSnapshot() {
  const payload = JSON.stringify(serializeSnapshot());
  pendingEvents = [];

  for (const ws of clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
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
}

function handleJoin(ws, data) {
  if (clients.has(ws)) {
    ws.send(JSON.stringify({ type: 'error', message: 'Already joined.' }));
    return;
  }

  const name = sanitizeName(data.name);
  const color = sanitizeColor(data.color);

  if (!name) {
    ws.send(JSON.stringify({ type: 'error', message: 'Name must be 2-16 letters/numbers.' }));
    return;
  }
  if (!color) {
    ws.send(JSON.stringify({ type: 'error', message: 'Color must be a valid hex value like #44ccff.' }));
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
    stars: 0,
    starHeat: 0,
    starCooldown: 0,
    copAlertPlayed: false,
    respawnTimer: 0,
    hitCooldown: 0,
    shootCooldown: 0,
    lastShootSeq: 0,
    weapon: 'pistol',
    ownedPistol: true,
    ownedShotgun: true,
    ownedMachinegun: true,
    ownedBazooka: true,
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
      aimX: spawn.x,
      aimY: spawn.y,
      clickAimX: spawn.x,
      clickAimY: spawn.y,
    },
  };

  players.set(id, player);
  clients.set(ws, { playerId: id });

  ws.send(
    JSON.stringify({
      type: 'joined',
      playerId: id,
      tickRate: TICK_RATE,
      world: {
        width: WORLD.width,
        height: WORLD.height,
        tileSize: WORLD.tileSize,
        blockPx: BLOCK_PX,
        roadStart: ROAD_START,
        roadEnd: ROAD_END,
        laneA: LANE_A,
        laneB: LANE_B,
        shops: SHOPS.map((shop) => ({
          id: shop.id,
          name: shop.name,
          x: shop.x,
          y: shop.y,
          radius: shop.radius,
          stock: SHOP_STOCK,
        })),
        hospital: {
          id: HOSPITAL.id,
          name: HOSPITAL.name,
          x: HOSPITAL.x,
          y: HOSPITAL.y,
          radius: HOSPITAL.radius,
        },
      },
    })
  );

  emitEvent('join', { playerId: id, x: player.x, y: player.y });
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

  player.input.up = !!input.up;
  player.input.down = !!input.down;
  player.input.left = !!input.left;
  player.input.right = !!input.right;
  player.input.enter = !!input.enter;
  player.input.horn = !!input.horn;
  player.input.shootHeld = !!input.shootHeld;
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

  player.input.shootSeq = normalizeShootSeq(Number(input.shootSeq), player.input.shootSeq);
}

function handleBuy(ws, data) {
  const client = clients.get(ws);
  if (!client) return;
  const player = players.get(client.playerId);
  if (!player) return;

  const item = typeof data.item === 'string' ? data.item.trim().toLowerCase() : '';
  const result = buyItemForPlayer(player, item);
  ws.send(
    JSON.stringify({
      type: 'notice',
      ok: result.ok,
      message: result.message,
    })
  );
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    if (typeof raw !== 'string' && !(raw instanceof Buffer)) {
      return;
    }

    const text = String(raw);
    if (text.length > 8_000) {
      ws.send(JSON.stringify({ type: 'error', message: 'Payload too large.' }));
      return;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON.' }));
      return;
    }

    if (!data || typeof data !== 'object') {
      return;
    }

    if (data.type === 'join') {
      handleJoin(ws, data);
    } else if (data.type === 'input') {
      handleInput(ws, data);
    } else if (data.type === 'buy') {
      handleBuy(ws, data);
    }
  });

  ws.on('close', () => {
    disconnectClient(ws);
  });

  ws.on('error', () => {
    disconnectClient(ws);
  });

  ws.send(JSON.stringify({ type: 'hello', message: 'Connected. Send join payload.' }));
});

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

setInterval(() => {
  stepPlayers(DT);
  stepCars(DT);
  stepCarHitsByCars();
  stepCops(DT);
  maybeEmitCopTriggerAlerts();
  stepNpcs(DT);
  stepPlayerHits();
  stepNpcHitsByCars();
  stepCopHitsByCars();
  stepCashDrops(DT);
  stepBloodStains(DT);
  resetAmbientSceneWhenEmpty();
  ensureCarPopulation();
  ensureNpcPopulation();
  ensureCopPopulation();
  broadcastSnapshot();
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Pixel city server running on http://localhost:${PORT}`);
});
