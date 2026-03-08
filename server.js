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

const NPC_COUNT = 132;
const NPC_RADIUS = 6;

const TRAFFIC_COUNT = 78;
const COP_COUNT = 10;
const COP_OFFICER_COUNT = 12;
const MAX_NAME_LENGTH = 16;

const clients = new Map();
const players = new Map();
const cars = new Map();
const npcs = new Map();
const cops = new Map();
const cashDrops = new Map();

let nextId = 1;
let nextEventId = 1;
let pendingEvents = [];

const CAR_PALETTE = ['#f9ce4e', '#ff7a5e', '#83d3ff', '#8eff92', '#d9a5ff', '#f2f2f2', '#a6ffef'];
const NPC_PALETTE = ['#f0c39a', '#f5d0b2', '#d2a67f', '#efba9f', '#c78f6f', '#e9c09a'];
const NPC_SHIRT_PALETTE = ['#5a8ad6', '#66b47a', '#c46060', '#b085d8', '#dfa04f', '#61b8b7', '#808891'];
const SHOP_STOCK = {
  pistol: 260,
  shotgun: 720,
};
const SHOPS = [
  { id: 'shop_north', name: 'North Arms', x: BLOCK_PX * 8 + 228, y: BLOCK_PX * 2 + 236, radius: 34 },
  { id: 'shop_south', name: 'South Arms', x: BLOCK_PX * 4 + 236, y: BLOCK_PX * 9 + 234, radius: 34 },
  { id: 'shop_east', name: 'East Arms', x: BLOCK_PX * 10 + 236, y: BLOCK_PX * 4 + 228, radius: 34 },
  { id: 'shop_west', name: 'West Arms', x: BLOCK_PX * 1 + 236, y: BLOCK_PX * 7 + 232, radius: 34 },
  { id: 'shop_mid', name: 'Midtown Arms', x: BLOCK_PX * 6 + 232, y: BLOCK_PX * 6 + 236, radius: 34 },
  { id: 'shop_dock', name: 'Dock Arms', x: BLOCK_PX * 10 + 232, y: BLOCK_PX * 10 + 232, radius: 34 },
];
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
};

app.use(express.static(path.join(__dirname, 'public')));

function mod(value, by) {
  return ((value % by) + by) % by;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

function groundTypeAt(x, y) {
  if (x < 0 || y < 0 || x >= WORLD.width || y >= WORLD.height) {
    return 'void';
  }

  const localX = mod(x, BLOCK_PX);
  const localY = mod(y, BLOCK_PX);
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

  const blockX = Math.floor(x / BLOCK_PX);
  const blockY = Math.floor(y / BLOCK_PX);
  const profile = hash2D(blockX, blockY);
  if (profile < 0.2) {
    return 'park';
  }

  const margin = 42 + Math.floor(hash2D(blockX + 11, blockY - 7) * 12);
  if (
    localX > margin &&
    localX < BLOCK_PX - margin &&
    localY > margin &&
    localY < BLOCK_PX - margin
  ) {
    return 'building';
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
  const g = groundTypeAt(x, y);
  return g === 'building' || g === 'void';
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
  const car = {
    id: makeId('car'),
    type,
    x: spawn.x,
    y: spawn.y,
    angle: spawn.angle,
    speed: type === 'cop' ? 75 : 55,
    maxSpeed: type === 'cop' ? 190 : 145,
    turnSpeed: type === 'cop' ? 3.1 : 2.2,
    width: 24,
    height: 14,
    driverId: null,
    npcDriver: true,
    abandonTimer: 0,
    aiCooldown: randRange(0.35, 1.35),
    hornCooldown: randRange(0, 1),
    color: type === 'cop' ? '#5ca1ff' : CAR_PALETTE[randInt(0, CAR_PALETTE.length)],
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
    skinColor: NPC_PALETTE[randInt(0, NPC_PALETTE.length)],
    shirtColor: NPC_SHIRT_PALETTE[randInt(0, NPC_SHIRT_PALETTE.length)],
  };
  npcs.set(npc.id, npc);
  return npc;
}

function respawnNpc(npc) {
  const spawn = randomPedSpawn();
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
    mode: 'patrol',
    targetPlayerId: null,
  };
  cops.set(cop.id, cop);
  return cop;
}

function awardNpcKill(killerId, x, y) {
  const killer = players.get(killerId);
  if (!killer || killer.health <= 0 || killer.insideShopId) return;

  const reward = randInt(2, 11);
  addStars(killer, 1.0, 28);
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

  npc.alive = false;
  npc.health = 0;
  npc.respawnTimer = randRange(6, 12);
  npc.panicTimer = 0;

  emitEvent('npcDown', {
    npcId: npc.id,
    x: npc.x,
    y: npc.y,
    killerId,
  });

  if (killerId) {
    awardNpcKill(killerId, npc.x, npc.y);
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

  const spawn = randomPedSpawn();
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
    const x = clamp(p.x, 12, WORLD.width - 12);
    const y = clamp(p.y, 12, WORLD.height - 12);
    if (!isSolidForPed(x, y)) {
      return { x, y };
    }
  }

  return randomPedSpawn();
}

function ejectNpcFromCar(car) {
  const sideAngle = car.angle + (Math.random() < 0.5 ? Math.PI * 0.5 : -Math.PI * 0.5);
  const ex = car.x + Math.cos(sideAngle) * 12;
  const ey = car.y + Math.sin(sideAngle) * 12;
  emitEvent('npcThrown', {
    x: ex,
    y: ey,
    dir: sideAngle,
    speed: randRange(70, 120),
  });
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

  if (shop) {
    player.x = clamp(shop.x + 24, 16, WORLD.width - 16);
    player.y = clamp(shop.y, 16, WORLD.height - 16);
  } else {
    player.x = clamp(player.shopExitX || player.x, 16, WORLD.width - 16);
    player.y = clamp(player.shopExitY || player.y, 16, WORLD.height - 16);
  }

  if (isSolidForPed(player.x, player.y)) {
    const spawn = randomPedSpawn();
    player.x = spawn.x;
    player.y = spawn.y;
  }

  emitEvent('exitShop', {
    playerId: player.id,
    shopId: shop ? shop.id : null,
    x: player.x,
    y: player.y,
  });
}

function applyWeaponSelection(player) {
  const slot = player.input.weaponSlot;
  if (slot === 1) {
    player.weapon = 'fist';
  } else if (slot === 2 && player.ownedPistol) {
    player.weapon = 'pistol';
  } else if (slot === 3 && player.ownedShotgun) {
    player.weapon = 'shotgun';
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

  if (item === 'pistol' && player.ownedPistol) {
    return { ok: false, message: 'Pistol already owned.' };
  }
  if (item === 'shotgun' && player.ownedShotgun) {
    return { ok: false, message: 'Shotgun already owned.' };
  }
  if (player.money < price) {
    return { ok: false, message: 'Not enough money.' };
  }

  player.money -= price;
  if (item === 'pistol') {
    player.ownedPistol = true;
    player.input.weaponSlot = 2;
  } else if (item === 'shotgun') {
    player.ownedShotgun = true;
    player.input.weaponSlot = 3;
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
    ejectNpcFromCar(candidate);
    addStars(player, candidate.type === 'cop' ? 1.6 : 0.75, 26);
  }

  candidate.driverId = player.id;
  player.inCarId = candidate.id;
  player.x = candidate.x;
  player.y = candidate.y;
  player.dir = candidate.angle;

  if (candidate.type === 'cop') {
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

    const nx = player.x + mx * PLAYER_SPEED * dt;
    const ny = player.y + my * PLAYER_SPEED * dt;

    if (!isSolidForPed(nx, player.y)) {
      player.x = nx;
    }
    if (!isSolidForPed(player.x, ny)) {
      player.y = ny;
    }
  }

  player.x = clamp(player.x, PLAYER_RADIUS + 2, WORLD.width - PLAYER_RADIUS - 2);
  player.y = clamp(player.y, PLAYER_RADIUS + 2, WORLD.height - PLAYER_RADIUS - 2);
}

function carBodyPoints(car) {
  const points = [{ x: car.x, y: car.y }];
  const halfL = car.width * 0.52;
  const halfW = car.height * 0.52;
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

function enforceCarCollisions(car) {
  car.x = clamp(car.x, 12, WORLD.width - 12);
  car.y = clamp(car.y, 12, WORLD.height - 12);

  if (carCollidesSolid(car)) {
    car.speed *= -0.35;
    car.angle = snapToRightAngle(car.angle + Math.PI * 0.5 * (Math.random() < 0.5 ? -1 : 1));
    const retreat = 7;
    car.x = clamp(car.x + Math.cos(car.angle + Math.PI) * retreat, 12, WORLD.width - 12);
    car.y = clamp(car.y + Math.sin(car.angle + Math.PI) * retreat, 12, WORLD.height - 12);
    emitEvent('impact', { x: car.x, y: car.y });
  }
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

  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  enforceCarCollisions(car);
}

function stepTrafficCar(car, dt) {
  car.aiCooldown -= dt;

  const targetCardinal = snapToRightAngle(car.angle);
  car.angle = angleApproach(car.angle, targetCardinal, dt * 2.8);

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
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;

  if (car.x <= 10 || car.x >= WORLD.width - 10) {
    car.angle = snapToRightAngle(Math.PI - car.angle);
  }
  if (car.y <= 10 || car.y >= WORLD.height - 10) {
    car.angle = snapToRightAngle(-car.angle);
  }

  enforceCarCollisions(car);
}

function stepAbandonedCar(car, dt) {
  car.speed *= Math.pow(0.86, dt * 8);
  if (Math.abs(car.speed) < 1) {
    car.speed = 0;
    return;
  }

  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  enforceCarCollisions(car);
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

function stepCopCar(car, dt) {
  const target = nearestFiveStarPlayer(car.x, car.y);
  if (!target) {
    stepTrafficCar(car, dt);
    car.speed = clamp(car.speed, -80, 130);
    return;
  }

  const desired = Math.atan2(target.y - car.y, target.x - car.x);
  car.angle = angleApproach(car.angle, desired, dt * 2.4);
  const dist = Math.hypot(target.x - car.x, target.y - car.y);
  const desiredSpeed = dist > 170 ? 120 : 42;
  car.speed = approach(car.speed, desiredSpeed, dt * 88);
  car.speed = clamp(car.speed, -60, 150);

  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  enforceCarCollisions(car);
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

function fireShot(player) {
  if (player.health <= 0 || player.inCarId || player.insideShopId) return;
  const weapon = WEAPONS[player.weapon] || WEAPONS.fist;
  if (weapon.pellets <= 0) return;
  if (player.shootCooldown > 0) return;

  player.shootCooldown = weapon.cooldown;

  const dir = player.dir;
  const sx = player.x + Math.cos(dir) * 8;
  const sy = player.y + Math.sin(dir) * 8;

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
        fireShot(player);
      }
    }

    if (player.starCooldown > 0) {
      player.starCooldown -= dt;
    } else {
      player.starHeat = Math.max(0, player.starHeat - dt * STAR_DECAY_PER_SECOND);
    }

    player.stars = clamp(Math.ceil(player.starHeat - 0.001), 0, 5);
  }
}

function stepCars(dt) {
  for (const car of cars.values()) {
    car.hornCooldown -= dt;

    if (car.driverId) {
      const driver = players.get(car.driverId);
      if (!driver || driver.health <= 0 || driver.inCarId !== car.id) {
        releaseCarDriver(car);
      } else {
        stepDrivenCar(car, driver.input, dt);

        driver.x = car.x;
        driver.y = car.y;
        driver.dir = car.angle;

        if (driver.input.horn && car.hornCooldown <= 0) {
          car.hornCooldown = 0.9;
          emitEvent('horn', { x: car.x, y: car.y, sourcePlayerId: driver.id });
        }
      }
      continue;
    }

    if (car.npcDriver) {
      if (car.type === 'cop') {
        stepCopCar(car, dt);
      } else {
        stepTrafficCar(car, dt);
      }
      continue;
    }

    stepAbandonedCar(car, dt);
    car.abandonTimer += dt;
    if (car.abandonTimer > 12) {
      car.npcDriver = true;
      car.abandonTimer = 0;
      car.aiCooldown = randRange(0.3, 1.3);
      car.speed = Math.max(car.speed, 40);
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
      npc.respawnTimer -= dt;
      if (npc.respawnTimer <= 0) {
        respawnNpc(npc);
      }
      continue;
    }

    if (npc.panicTimer > 0) {
      npc.panicTimer -= dt;
    }
    if (npc.crossingTimer > 0) {
      npc.crossingTimer -= dt;
    }

    let threat = null;
    let threatDistSq = 38 * 38;
    for (const player of players.values()) {
      if (player.health <= 0 || player.insideShopId) continue;
      const dx = npc.x - player.x;
      const dy = npc.y - player.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < threatDistSq) {
        threat = player;
        threatDistSq = d2;
      }
    }
    if (threat) {
      npc.panicTimer = Math.max(npc.panicTimer, 1.4);
      npc.dir = Math.atan2(npc.y - threat.y, npc.x - threat.x);
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

    npc.x = clamp(npc.x, 12, WORLD.width - 12);
    npc.y = clamp(npc.y, 12, WORLD.height - 12);
  }
}

function stepCops(dt) {
  for (const cop of cops.values()) {
    const target = nearestFiveStarPlayer(cop.x, cop.y);
    cop.cooldown -= dt;
    cop.patrolTimer -= dt;

    if (target) {
      cop.mode = 'hunt';
      cop.targetPlayerId = target.id;
      const toTarget = Math.atan2(target.y - cop.y, target.x - cop.x);
      cop.dir = angleApproach(cop.dir, toTarget, dt * 5.2);
      const speed = 94;
      const nx = cop.x + Math.cos(cop.dir) * speed * dt;
      const ny = cop.y + Math.sin(cop.dir) * speed * dt;
      if (!isSolidForPed(nx, cop.y)) cop.x = nx;
      if (!isSolidForPed(cop.x, ny)) cop.y = ny;

      const dist = Math.hypot(target.x - cop.x, target.y - cop.y);
      if (dist < 230 && cop.cooldown <= 0) {
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
    } else {
      cop.mode = 'patrol';
      cop.targetPlayerId = null;
      if (cop.patrolTimer <= 0) {
        cop.patrolTimer = randRange(0.6, 1.7);
        cop.dir += randRange(-1.3, 1.3);
      }
      const speed = 56;
      const nx = cop.x + Math.cos(cop.dir) * speed * dt;
      const ny = cop.y + Math.sin(cop.dir) * speed * dt;
      if (!isSolidForPed(nx, cop.y)) cop.x = nx;
      if (!isSolidForPed(cop.x, ny)) cop.y = ny;
    }

    cop.x = clamp(cop.x, 12, WORLD.width - 12);
    cop.y = clamp(cop.y, 12, WORLD.height - 12);
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

      if (car.driverId) {
        killNpc(npc, car.driverId);
      } else {
        killNpc(npc, null);
      }

      emitEvent('impact', { x: npc.x, y: npc.y });
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
    drop.x = clamp(drop.x, 10, WORLD.width - 10);
    drop.y = clamp(drop.y, 10, WORLD.height - 10);

    if (drop.pickupDelay > 0) {
      continue;
    }

    for (const player of players.values()) {
      if (player.health <= 0 || player.inCarId || player.insideShopId) continue;
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

function ensureCarPopulation() {
  let civilian = 0;
  let cop = 0;
  for (const car of cars.values()) {
    if (car.type === 'cop') {
      cop += 1;
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
      skinColor: npc.skinColor,
      shirtColor: npc.shirtColor,
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
      mode: cop.mode,
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
    },
    players: playersPayload,
    cars: carsPayload,
    npcs: npcsPayload,
    cops: copsPayload,
    drops: dropsPayload,
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
    respawnTimer: 0,
    hitCooldown: 0,
    shootCooldown: 0,
    lastShootSeq: 0,
    weapon: 'fist',
    ownedPistol: false,
    ownedShotgun: false,
    prevEnter: false,
    input: {
      up: false,
      down: false,
      left: false,
      right: false,
      enter: false,
      horn: false,
      shootSeq: 0,
      weaponSlot: 1,
      aimX: spawn.x,
      aimY: spawn.y,
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
  const slot = Number(input.weaponSlot);
  if (Number.isInteger(slot) && slot >= 1 && slot <= 3) {
    player.input.weaponSlot = slot;
  }

  const ax = Number(input.aimX);
  const ay = Number(input.aimY);
  if (Number.isFinite(ax) && Number.isFinite(ay)) {
    player.input.aimX = clamp(ax, 0, WORLD.width);
    player.input.aimY = clamp(ay, 0, WORLD.height);
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
for (let i = 0; i < NPC_COUNT; i++) {
  makeNpc();
}
for (let i = 0; i < COP_OFFICER_COUNT; i++) {
  makeCopUnit();
}

setInterval(() => {
  stepPlayers(DT);
  stepCars(DT);
  stepCops(DT);
  stepNpcs(DT);
  stepPlayerHits();
  stepNpcHitsByCars();
  stepCashDrops(DT);
  ensureCarPopulation();
  ensureNpcPopulation();
  ensureCopPopulation();
  broadcastSnapshot();
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Pixel city server running on http://localhost:${PORT}`);
});
