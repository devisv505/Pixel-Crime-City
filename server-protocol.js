const OPCODES = Object.freeze({
  C2S_JOIN: 0x01,
  C2S_INPUT: 0x02,
  C2S_BUY: 0x03,
  C2S_CHAT: 0x04,
  S2C_JOINED: 0x11,
  S2C_SNAPSHOT: 0x12,
  S2C_PRESENCE: 0x13,
  S2C_NOTICE: 0x14,
  S2C_ERROR: 0x15,
});

const ITEM_TO_CODE = Object.freeze({
  shotgun: 1,
  machinegun: 2,
  bazooka: 3,
});

const CODE_TO_ITEM = Object.freeze({
  1: 'shotgun',
  2: 'machinegun',
  3: 'bazooka',
});

const WEAPON_TO_CODE = Object.freeze({
  fist: 0,
  pistol: 1,
  shotgun: 2,
  machinegun: 3,
  bazooka: 4,
});

const CAR_TYPE_TO_CODE = Object.freeze({
  civilian: 0,
  cop: 1,
  ambulance: 2,
});

const CORPSE_STATE_TO_CODE = Object.freeze({
  none: 0,
  down: 1,
  carried: 2,
  reviving: 3,
});

const COP_MODE_TO_CODE = Object.freeze({
  patrol: 0,
  hunt: 1,
  return: 2,
  down: 3,
});

const EVENT_TO_CODE = Object.freeze({
  horn: 1,
  impact: 2,
  defeat: 3,
  bullet: 4,
  explosion: 5,
  copWitness: 6,
  melee: 7,
  npcThrown: 8,
  npcDown: 9,
  cashDrop: 10,
  bloodSpawn: 11,
  bloodRemove: 12,
  cashPickup: 13,
  purchase: 14,
  pvpKill: 15,
  join: 16,
  disconnect: 17,
  enterCar: 18,
  enterShop: 19,
  exitShop: 20,
  npcHospital: 21,
  copHospital: 22,
  npcPickup: 23,
  copPickup: 24,
});

const SNAPSHOT_SECTION_ORDER = Object.freeze(['players', 'cars', 'npcs', 'cops', 'drops', 'blood']);

class Writer {
  constructor(initial = 1024) {
    this.buffer = Buffer.allocUnsafe(initial);
    this.offset = 0;
  }

  ensure(size) {
    if (this.offset + size <= this.buffer.length) return;
    let next = this.buffer.length;
    while (this.offset + size > next) next *= 2;
    const grown = Buffer.allocUnsafe(next);
    this.buffer.copy(grown, 0, 0, this.offset);
    this.buffer = grown;
  }

  u8(value) {
    this.ensure(1);
    this.buffer.writeUInt8(value & 0xff, this.offset);
    this.offset += 1;
  }

  u16(value) {
    this.ensure(2);
    this.buffer.writeUInt16LE(value & 0xffff, this.offset);
    this.offset += 2;
  }

  i16(value) {
    this.ensure(2);
    this.buffer.writeInt16LE(value | 0, this.offset);
    this.offset += 2;
  }

  u32(value) {
    this.ensure(4);
    this.buffer.writeUInt32LE(value >>> 0, this.offset);
    this.offset += 4;
  }

  bytes(buf) {
    if (!buf || buf.length === 0) return;
    this.ensure(buf.length);
    buf.copy(this.buffer, this.offset, 0, buf.length);
    this.offset += buf.length;
  }

  string8(text) {
    const buf = Buffer.from(String(text || ''), 'utf8');
    const len = Math.min(buf.length, 255);
    this.u8(len);
    if (len > 0) this.bytes(buf.subarray(0, len));
  }

  string16(text) {
    const buf = Buffer.from(String(text || ''), 'utf8');
    const len = Math.min(buf.length, 65535);
    this.u16(len);
    if (len > 0) this.bytes(buf.subarray(0, len));
  }

  color24(hex) {
    const c = colorHexToInt(hex);
    this.u8((c >> 16) & 0xff);
    this.u8((c >> 8) & 0xff);
    this.u8(c & 0xff);
  }

  toBuffer() {
    return this.buffer.subarray(0, this.offset);
  }
}

class Reader {
  constructor(raw) {
    this.buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    this.offset = 0;
  }

  ensure(size) {
    if (this.offset + size > this.buffer.length) throw new Error('Frame too short.');
  }

  u8() {
    this.ensure(1);
    const v = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }

  u16() {
    this.ensure(2);
    const v = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return v;
  }

  u32() {
    this.ensure(4);
    const v = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return v >>> 0;
  }

  color24() {
    const r = this.u8();
    const g = this.u8();
    const b = this.u8();
    return intToColorHex((r << 16) | (g << 8) | b);
  }

  string8() {
    const len = this.u8();
    if (len === 0) return '';
    this.ensure(len);
    const text = this.buffer.toString('utf8', this.offset, this.offset + len);
    this.offset += len;
    return text;
  }

  string16() {
    const len = this.u16();
    if (len === 0) return '';
    this.ensure(len);
    const text = this.buffer.toString('utf8', this.offset, this.offset + len);
    this.offset += len;
    return text;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngle(value) {
  let angle = Number.isFinite(value) ? value : 0;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function packCoord(value) {
  return clamp(Math.round(Number(value || 0) * 10), 0, 65535);
}

function unpackCoord(value) {
  return value / 10;
}

function packAngle(value) {
  const normalized = normalizeAngle(value);
  return clamp(Math.round(normalized * 10000), -32768, 32767);
}

function packSpeed(value) {
  return clamp(Math.round(Number(value || 0) * 10), -32768, 32767);
}

function packTtl(value) {
  return clamp(Math.round(Number(value || 0) * 100), 0, 65535);
}

function colorHexToInt(value) {
  if (typeof value !== 'string') return 0;
  const normalized = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(normalized)) return 0;
  return Number.parseInt(normalized.slice(1), 16) >>> 0;
}

function intToColorHex(value) {
  const safe = (value >>> 0) & 0xffffff;
  return `#${safe.toString(16).padStart(6, '0')}`;
}

function packShopIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index > 254) return 255;
  return index;
}

function decodeClientFrame(raw) {
  const reader = new Reader(raw);
  const opcode = reader.u8();

  if (opcode === OPCODES.C2S_JOIN) {
    return {
      opcode,
      name: reader.string8(),
      color: reader.color24(),
      profileTicket: reader.string16(),
    };
  }

  if (opcode === OPCODES.C2S_INPUT) {
    const seq = reader.u32();
    const shootSeq = reader.u32();
    const clientSendTime = reader.u32();
    const mask = reader.u8();
    const weaponSlot = reader.u8();
    return {
      opcode,
      seq,
      shootSeq,
      clientSendTime,
      input: {
        up: !!(mask & 1),
        down: !!(mask & 2),
        left: !!(mask & 4),
        right: !!(mask & 8),
        enter: !!(mask & 16),
        horn: !!(mask & 32),
        shootHeld: !!(mask & 64),
        requestStats: !!(mask & 128),
        weaponSlot,
        aimX: unpackCoord(reader.u16()),
        aimY: unpackCoord(reader.u16()),
        clickAimX: unpackCoord(reader.u16()),
        clickAimY: unpackCoord(reader.u16()),
      },
    };
  }

  if (opcode === OPCODES.C2S_BUY) {
    return {
      opcode,
      item: CODE_TO_ITEM[reader.u8()] || '',
    };
  }

  if (opcode === OPCODES.C2S_CHAT) {
    return {
      opcode,
      text: reader.string8(),
    };
  }

  throw new Error('Unknown opcode.');
}

function encodeErrorFrame(message) {
  const writer = new Writer(64);
  writer.u8(OPCODES.S2C_ERROR);
  writer.string16(message || 'Server error.');
  return writer.toBuffer();
}

function encodeNoticeFrame(ok, message) {
  const writer = new Writer(64);
  writer.u8(OPCODES.S2C_NOTICE);
  writer.u8(ok ? 1 : 0);
  writer.string16(message || '');
  return writer.toBuffer();
}

function encodeJoinedFrame(payload) {
  const writer = new Writer(1024);
  const world = payload?.world || {};
  const shops = Array.isArray(world.shops) ? world.shops : [];
  const hospital = world.hospital && typeof world.hospital === 'object' ? world.hospital : null;

  writer.u8(OPCODES.S2C_JOINED);
  writer.u32(payload.playerId >>> 0);
  writer.u8(clamp(Math.round(payload.tickRate || 30), 1, 255));
  writer.u16(clamp(Math.round(payload.worldRev || 0), 0, 65535));
  writer.u16(clamp(Math.round(world.width || 0), 0, 65535));
  writer.u16(clamp(Math.round(world.height || 0), 0, 65535));
  writer.u16(clamp(Math.round(world.tileSize || 0), 0, 65535));
  writer.u16(clamp(Math.round(world.blockPx || 0), 0, 65535));
  writer.u16(clamp(Math.round(world.roadStart || 0), 0, 65535));
  writer.u16(clamp(Math.round(world.roadEnd || 0), 0, 65535));
  writer.u16(clamp(Math.round(world.laneA || 0), 0, 65535));
  writer.u16(clamp(Math.round(world.laneB || 0), 0, 65535));

  writer.u8(clamp(shops.length, 0, 255));
  for (const shop of shops) {
    writer.string8(shop?.id || '');
    writer.string8(shop?.name || '');
    writer.u16(packCoord(shop?.x || 0));
    writer.u16(packCoord(shop?.y || 0));
    writer.u16(clamp(Math.round(shop?.radius || 0), 0, 65535));
    const stock = shop?.stock || {};
    writer.u16(clamp(Math.round(stock.shotgun || 0), 0, 65535));
    writer.u16(clamp(Math.round(stock.machinegun || 0), 0, 65535));
    writer.u16(clamp(Math.round(stock.bazooka || 0), 0, 65535));
  }

  writer.u8(hospital ? 1 : 0);
  if (hospital) {
    writer.string8(hospital.id || '');
    writer.string8(hospital.name || '');
    writer.u16(packCoord(hospital.x || 0));
    writer.u16(packCoord(hospital.y || 0));
    writer.u16(clamp(Math.round(hospital.radius || 0), 0, 65535));
  }

  writer.string16(payload?.progressTicket || '');

  return writer.toBuffer();
}

function encodePresenceFrame(payload) {
  const writer = new Writer(512);
  const markers = Array.isArray(payload?.players) ? payload.players : [];
  writer.u8(OPCODES.S2C_PRESENCE);
  writer.u32(payload?.serverTime >>> 0);
  writer.u16(clamp(Math.round(payload?.worldRev || 0), 0, 65535));
  writer.u16(clamp(Math.round(payload?.onlineCount || markers.length), 0, 65535));
  writer.u16(clamp(markers.length, 0, 65535));
  for (const marker of markers) {
    writer.u32(marker?.id >>> 0);
    writer.color24(marker?.color || '#ffffff');
    writer.u16(packCoord(marker?.x || 0));
    writer.u16(packCoord(marker?.y || 0));
    writer.u32(marker?.inCarId ? marker.inCarId >>> 0 : 0);
  }
  return writer.toBuffer();
}

function encodeSnapshotFrame(payload) {
  const writer = new Writer(4096);
  const flags =
    (payload?.keyframe ? 1 : 0) |
    (payload?.stats ? 2 : 0) |
    (payload?.scope ? 4 : 0) |
    (payload?.progressTicket ? 8 : 0);

  writer.u8(OPCODES.S2C_SNAPSHOT);
  writer.u32(payload?.serverTime >>> 0);
  writer.u16(clamp(Math.round(payload?.worldRev || 0), 0, 65535));
  writer.u16(clamp(Math.round(payload?.snapshotSeq || 0), 0, 65535));
  writer.u8(flags);
  writer.u32(payload?.ackInputSeq >>> 0);
  writer.u32(payload?.clientSendTimeEcho >>> 0);
  writer.u16(clamp(Math.round(payload?.interpolationDelayMs || 90), 0, 65535));
  if (payload?.progressTicket) {
    writer.string16(payload.progressTicket);
  }

  const sections = payload?.sections || {};
  for (const name of SNAPSHOT_SECTION_ORDER) {
    const section = sections[name] || {};
    const add = Array.isArray(section.add) ? section.add : [];
    const update = Array.isArray(section.update) ? section.update : [];
    const remove = Array.isArray(section.remove) ? section.remove : [];
    writer.u16(clamp(add.length, 0, 65535));
    writer.u16(clamp(update.length, 0, 65535));
    writer.u16(clamp(remove.length, 0, 65535));

    const encodeRecord = (record) => {
      if (name === 'players') {
        writer.u32(record.id >>> 0);
        writer.string8(record.name || '');
        writer.color24(record.color || '#ffffff');
        writer.u16(packCoord(record.x || 0));
        writer.u16(packCoord(record.y || 0));
        writer.i16(packAngle(record.dir || 0));
        writer.u32(record.inCarId ? record.inCarId >>> 0 : 0);
        writer.u8(packShopIndex(record.insideShopIndex));
        writer.u8(clamp(Math.round(record.health || 0), 0, 255));
        writer.u8(clamp(Math.round(record.stars || 0), 0, 255));
        writer.u32(clamp(Math.round(record.money || 0), 0, 0xffffffff));
        writer.u8(WEAPON_TO_CODE[record.weapon] ?? 0);
        let owned = 0;
        if (record.ownedPistol) owned |= 1;
        if (record.ownedShotgun) owned |= 2;
        if (record.ownedMachinegun) owned |= 4;
        if (record.ownedBazooka) owned |= 8;
        writer.u8(owned);
        writer.u16(clamp(Math.round(record.chatMsLeft || 0), 0, 65535));
        writer.string8(record.chatText || '');
        return;
      }
      if (name === 'cars') {
        writer.u32(record.id >>> 0);
        writer.u8(CAR_TYPE_TO_CODE[record.type] ?? 0);
        writer.u16(packCoord(record.x || 0));
        writer.u16(packCoord(record.y || 0));
        writer.i16(packAngle(record.angle || 0));
        writer.i16(packSpeed(record.speed || 0));
        writer.color24(record.color || '#ffffff');
        writer.u32(record.driverId ? record.driverId >>> 0 : 0);
        writer.u8(clamp(Math.round(record.health || 0), 0, 255));
        let flagsCar = 0;
        if (record.npcDriver) flagsCar |= 1;
        if (record.sirenOn) flagsCar |= 2;
        if (record.smoking) flagsCar |= 4;
        writer.u8(flagsCar);
        return;
      }
      if (name === 'npcs') {
        writer.u32(record.id >>> 0);
        writer.u16(packCoord(record.x || 0));
        writer.u16(packCoord(record.y || 0));
        writer.i16(packAngle(record.dir || 0));
        writer.u8(record.alive ? 1 : 0);
        writer.u8(CORPSE_STATE_TO_CODE[record.corpseState] ?? 0);
        writer.color24(record.skinColor || '#f0c39a');
        writer.color24(record.shirtColor || '#808891');
        writer.color24(record.shirtDark || '#2a3342');
        return;
      }
      if (name === 'cops') {
        writer.u32(record.id >>> 0);
        writer.u16(packCoord(record.x || 0));
        writer.u16(packCoord(record.y || 0));
        writer.i16(packAngle(record.dir || 0));
        writer.u16(clamp(Math.round(record.health || 0), 0, 65535));
        let flagsCop = 0;
        if (record.alive) flagsCop |= 1;
        if (record.alert) flagsCop |= 2;
        writer.u8(flagsCop);
        writer.u32(record.inCarId ? record.inCarId >>> 0 : 0);
        writer.u8(CORPSE_STATE_TO_CODE[record.corpseState] ?? 0);
        writer.u8(COP_MODE_TO_CODE[record.mode] ?? 0);
        return;
      }
      if (name === 'drops') {
        writer.u32(record.id >>> 0);
        writer.u16(packCoord(record.x || 0));
        writer.u16(packCoord(record.y || 0));
        writer.u16(clamp(Math.round(record.amount || 0), 0, 65535));
        writer.u16(packTtl(record.ttl || 0));
        return;
      }
      writer.u32(record.id >>> 0);
      writer.u16(packCoord(record.x || 0));
      writer.u16(packCoord(record.y || 0));
      writer.u16(packTtl(record.ttl || 0));
    };

    for (const record of add) encodeRecord(record);
    for (const record of update) encodeRecord(record);
    for (const id of remove) writer.u32(id >>> 0);
  }

  const events = Array.isArray(payload?.events) ? payload.events : [];
  writer.u16(clamp(events.length, 0, 65535));
  for (const event of events) {
    const typeCode = EVENT_TO_CODE[event?.type] ?? 0;
    const eventWriter = new Writer(96);
    eventWriter.u16(packCoord(event?.x || 0));
    eventWriter.u16(packCoord(event?.y || 0));
    switch (event.type) {
      case 'horn':
        eventWriter.u32(event.sourcePlayerId ? event.sourcePlayerId >>> 0 : 0);
        break;
      case 'defeat':
        eventWriter.u32(event.playerId ? event.playerId >>> 0 : 0);
        break;
      case 'bullet':
        eventWriter.u8(WEAPON_TO_CODE[event.weapon] ?? 0);
        eventWriter.u16(packCoord(event.toX || event.x || 0));
        eventWriter.u16(packCoord(event.toY || event.y || 0));
        break;
      case 'melee':
        eventWriter.u16(packCoord(event.toX || event.x || 0));
        eventWriter.u16(packCoord(event.toY || event.y || 0));
        break;
      case 'explosion':
        eventWriter.u16(clamp(Math.round(event.radius || 0), 0, 65535));
        break;
      case 'copWitness':
        eventWriter.u32(event.playerId ? event.playerId >>> 0 : 0);
        break;
      case 'npcThrown':
        eventWriter.i16(packAngle(event.dir || 0));
        eventWriter.i16(packSpeed(event.speed || 0));
        eventWriter.color24(event.skinColor || '#f0c39a');
        eventWriter.color24(event.shirtColor || '#808891');
        eventWriter.color24(event.shirtDark || '#2a3342');
        break;
      case 'npcDown':
        eventWriter.u32(event.killerId ? event.killerId >>> 0 : 0);
        eventWriter.u32(event.npcId ? event.npcId >>> 0 : 0);
        break;
      case 'cashDrop':
        eventWriter.u32(event.dropId ? event.dropId >>> 0 : 0);
        eventWriter.u16(clamp(Math.round(event.amount || 0), 0, 65535));
        break;
      case 'bloodSpawn':
        eventWriter.u32(event.stainId ? event.stainId >>> 0 : 0);
        eventWriter.u16(packTtl(event.ttl || 0));
        break;
      case 'bloodRemove':
        eventWriter.u32(event.stainId ? event.stainId >>> 0 : 0);
        break;
      case 'cashPickup':
        eventWriter.u32(event.playerId ? event.playerId >>> 0 : 0);
        eventWriter.u16(clamp(Math.round(event.amount || 0), 0, 65535));
        eventWriter.u32(clamp(Math.round(event.total || 0), 0, 0xffffffff));
        break;
      case 'purchase':
        eventWriter.u32(event.playerId ? event.playerId >>> 0 : 0);
        eventWriter.u8(ITEM_TO_CODE[event.item] ?? 0);
        eventWriter.u16(clamp(Math.round(event.amount || 0), 0, 65535));
        break;
      case 'pvpKill':
        eventWriter.u32(event.killerId ? event.killerId >>> 0 : 0);
        eventWriter.u32(event.victimId ? event.victimId >>> 0 : 0);
        break;
      case 'join':
      case 'disconnect':
        eventWriter.u32(event.playerId ? event.playerId >>> 0 : 0);
        break;
      case 'enterCar':
        eventWriter.u32(event.playerId ? event.playerId >>> 0 : 0);
        eventWriter.u32(event.carId ? event.carId >>> 0 : 0);
        break;
      case 'enterShop':
      case 'exitShop':
        eventWriter.u32(event.playerId ? event.playerId >>> 0 : 0);
        eventWriter.u8(packShopIndex(event.shopIndex));
        break;
      case 'npcHospital':
      case 'copHospital':
        eventWriter.u32(event.victimId ? event.victimId >>> 0 : 0);
        break;
      case 'npcPickup':
      case 'copPickup':
        eventWriter.u32(event.victimId ? event.victimId >>> 0 : 0);
        eventWriter.u32(event.carId ? event.carId >>> 0 : 0);
        break;
      default:
        break;
    }
    const payloadBytes = eventWriter.toBuffer();
    writer.u32(event?.id >>> 0);
    writer.u8(typeCode);
    writer.u16(clamp(payloadBytes.length, 0, 65535));
    writer.bytes(payloadBytes);
  }

  if (payload?.stats) {
    writer.u16(clamp(Math.round(payload.stats.npcAlive || 0), 0, 65535));
    writer.u16(clamp(Math.round(payload.stats.carsCivilian || 0), 0, 65535));
    writer.u16(clamp(Math.round(payload.stats.carsCop || 0), 0, 65535));
    writer.u16(clamp(Math.round(payload.stats.carsAmbulance || 0), 0, 65535));
    writer.u16(clamp(Math.round(payload.stats.copsAlive || 0), 0, 65535));
  }

  if (payload?.scope) {
    writer.u16(packCoord(payload.scope.x || 0));
    writer.u16(packCoord(payload.scope.y || 0));
    writer.u16(clamp(Math.round(payload.scope.pedRadius || 0), 0, 65535));
    writer.u16(clamp(Math.round(payload.scope.carRadius || 0), 0, 65535));
  }

  return writer.toBuffer();
}

module.exports = {
  OPCODES,
  ITEM_TO_CODE,
  CODE_TO_ITEM,
  WEAPON_TO_CODE,
  CAR_TYPE_TO_CODE,
  CORPSE_STATE_TO_CODE,
  COP_MODE_TO_CODE,
  EVENT_TO_CODE,
  SNAPSHOT_SECTION_ORDER,
  packCoord,
  packAngle,
  packSpeed,
  packTtl,
  colorHexToInt,
  decodeClientFrame,
  encodeErrorFrame,
  encodeNoticeFrame,
  encodeJoinedFrame,
  encodePresenceFrame,
  encodeSnapshotFrame,
};
