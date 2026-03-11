const ClientProtocol = (() => {
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
  garage_sell: 4,
  garage_repaint_random: 5,
  garage_repaint_selected: 6,
});

const CODE_TO_ITEM = Object.freeze({
  1: 'shotgun',
  2: 'machinegun',
  3: 'bazooka',
  4: 'garage_sell',
  5: 'garage_repaint_random',
  6: 'garage_repaint_selected',
});

const WEAPON_TO_CODE = Object.freeze({
  fist: 0,
  pistol: 1,
  shotgun: 2,
  machinegun: 3,
  bazooka: 4,
});

const CODE_TO_WEAPON = Object.freeze({
  0: 'fist',
  1: 'pistol',
  2: 'shotgun',
  3: 'machinegun',
  4: 'bazooka',
});

const CODE_TO_CAR_TYPE = Object.freeze({
  0: 'civilian',
  1: 'cop',
  2: 'ambulance',
});

const CODE_TO_CORPSE_STATE = Object.freeze({
  0: 'none',
  1: 'down',
  2: 'carried',
  3: 'reviving',
});

const CODE_TO_COP_MODE = Object.freeze({
  0: 'patrol',
  1: 'hunt',
  2: 'return',
  3: 'down',
});

const CODE_TO_EVENT = Object.freeze({
  1: 'horn',
  2: 'impact',
  3: 'defeat',
  4: 'bullet',
  5: 'explosion',
  6: 'copWitness',
  7: 'melee',
  8: 'npcThrown',
  9: 'npcDown',
  10: 'cashDrop',
  11: 'bloodSpawn',
  12: 'bloodRemove',
  13: 'cashPickup',
  14: 'purchase',
  15: 'pvpKill',
  16: 'join',
  17: 'disconnect',
  18: 'enterCar',
  19: 'enterShop',
  20: 'exitShop',
  21: 'npcHospital',
  22: 'copHospital',
  23: 'npcPickup',
  24: 'copPickup',
  25: 'questSync',
});

const CODE_TO_QUEST_ACTION = Object.freeze({
  1: 'kill_npc',
  2: 'kill_cop',
  3: 'steal_car_any',
  4: 'steal_car_cop',
  5: 'steal_car_cop_sell_garage',
  6: 'steal_car_ambulance',
  7: 'kill_target_npc',
  8: 'steal_target_car',
  9: 'steal_car_ambulance_sell_garage',
  10: 'steal_car_civilian_sell_garage',
});

const CODE_TO_QUEST_STATUS = Object.freeze({
  0: 'locked',
  1: 'active',
  2: 'completed',
});

const SECTION_ORDER = Object.freeze(['players', 'cars', 'npcs', 'cops', 'drops', 'blood']);
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

class Writer {
  constructor(initial = 128) {
    this.buffer = new ArrayBuffer(initial);
    this.view = new DataView(this.buffer);
    this.offset = 0;
  }

  ensure(size) {
    if (this.offset + size <= this.buffer.byteLength) return;
    let next = this.buffer.byteLength;
    while (this.offset + size > next) next *= 2;
    const grown = new ArrayBuffer(next);
    new Uint8Array(grown).set(new Uint8Array(this.buffer, 0, this.offset));
    this.buffer = grown;
    this.view = new DataView(this.buffer);
  }

  u8(value) {
    this.ensure(1);
    this.view.setUint8(this.offset, value & 0xff);
    this.offset += 1;
  }

  u16(value) {
    this.ensure(2);
    this.view.setUint16(this.offset, value & 0xffff, true);
    this.offset += 2;
  }

  u32(value) {
    this.ensure(4);
    this.view.setUint32(this.offset, value >>> 0, true);
    this.offset += 4;
  }

  color24(hex) {
    const c = colorHexToInt(hex);
    this.u8((c >> 16) & 0xff);
    this.u8((c >> 8) & 0xff);
    this.u8(c & 0xff);
  }

  string8(text) {
    const bytes = TEXT_ENCODER.encode(String(text || ''));
    const len = Math.min(bytes.length, 255);
    this.u8(len);
    this.ensure(len);
    new Uint8Array(this.buffer, this.offset, len).set(bytes.subarray(0, len));
    this.offset += len;
  }

  string16(text) {
    const bytes = TEXT_ENCODER.encode(String(text || ''));
    const len = Math.min(bytes.length, 65535);
    this.u16(len);
    this.ensure(len);
    new Uint8Array(this.buffer, this.offset, len).set(bytes.subarray(0, len));
    this.offset += len;
  }

  finish() {
    return this.buffer.slice(0, this.offset);
  }
}

class Reader {
  constructor(raw) {
    this.buffer = raw instanceof ArrayBuffer ? raw : raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    this.view = new DataView(this.buffer);
    this.offset = 0;
  }

  ensure(size) {
    if (this.offset + size > this.buffer.byteLength) throw new Error('Frame too short.');
  }

  u8() {
    this.ensure(1);
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  u16() {
    this.ensure(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  i16() {
    this.ensure(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32() {
    this.ensure(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v >>> 0;
  }

  bytes(len) {
    this.ensure(len);
    const out = this.buffer.slice(this.offset, this.offset + len);
    this.offset += len;
    return out;
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
    return TEXT_DECODER.decode(this.bytes(len));
  }

  string16() {
    const len = this.u16();
    if (len === 0) return '';
    return TEXT_DECODER.decode(this.bytes(len));
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function packCoord(value) {
  return clamp(Math.round(Number(value || 0) * 10), 0, 65535);
}

function unpackCoord(value) {
  return value / 10;
}

function unpackAngle(value) {
  return value / 10000;
}

function unpackSpeed(value) {
  return value / 10;
}

function unpackTtl(value) {
  return value / 100;
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

function unpackShopIndex(index) {
  return index === 255 ? null : index;
}

function decodeEvent(type, reader) {
  const event = {
    type,
    x: unpackCoord(reader.u16()),
    y: unpackCoord(reader.u16()),
  };
  switch (type) {
    case 'horn':
      event.sourcePlayerId = reader.u32() || null;
      break;
    case 'defeat':
      event.playerId = reader.u32() || null;
      break;
    case 'bullet':
      event.weapon = CODE_TO_WEAPON[reader.u8()] || 'pistol';
      event.toX = unpackCoord(reader.u16());
      event.toY = unpackCoord(reader.u16());
      break;
    case 'melee':
      event.toX = unpackCoord(reader.u16());
      event.toY = unpackCoord(reader.u16());
      break;
    case 'explosion':
      event.radius = reader.u16();
      break;
    case 'copWitness':
      event.playerId = reader.u32() || null;
      break;
    case 'npcThrown':
      event.dir = unpackAngle(reader.i16());
      event.speed = unpackSpeed(reader.i16());
      event.skinColor = reader.color24();
      event.shirtColor = reader.color24();
      event.shirtDark = reader.color24();
      break;
    case 'npcDown':
      event.killerId = reader.u32() || null;
      event.npcId = reader.u32() || null;
      break;
    case 'cashDrop':
      event.dropId = reader.u32() || null;
      event.amount = reader.u16();
      break;
    case 'bloodSpawn':
      event.stainId = reader.u32() || null;
      event.ttl = unpackTtl(reader.u16());
      break;
    case 'bloodRemove':
      event.stainId = reader.u32() || null;
      break;
    case 'cashPickup':
      event.playerId = reader.u32() || null;
      event.amount = reader.u16();
      event.total = reader.u32();
      break;
    case 'purchase':
      event.playerId = reader.u32() || null;
      event.item = CODE_TO_ITEM[reader.u8()] || '';
      event.amount = reader.u16();
      break;
    case 'pvpKill':
      event.killerId = reader.u32() || null;
      event.victimId = reader.u32() || null;
      break;
    case 'join':
    case 'disconnect':
      event.playerId = reader.u32() || null;
      break;
    case 'enterCar':
      event.playerId = reader.u32() || null;
      event.carId = reader.u32() || null;
      break;
    case 'enterShop':
    case 'exitShop':
      event.playerId = reader.u32() || null;
      event.shopIndex = unpackShopIndex(reader.u8());
      break;
    case 'npcHospital':
    case 'copHospital':
      event.victimId = reader.u32() || null;
      break;
    case 'npcPickup':
    case 'copPickup':
      event.victimId = reader.u32() || null;
      event.carId = reader.u32() || null;
      break;
    case 'questSync': {
      event.playerId = reader.u32() || null;
      event.reputation = reader.u32();
      event.gunShopUnlocked = !!reader.u8();
      const questCount = reader.u16();
      event.quests = [];
      for (let i = 0; i < questCount; i += 1) {
        const id = reader.u32();
        const progress = reader.u16();
        const statusCode = reader.u8();
        const targetZoneX = unpackCoord(reader.u16());
        const targetZoneY = unpackCoord(reader.u16());
        const targetZoneRadius = reader.u16();
        event.quests.push({
          id,
          progress,
          statusCode,
          status: CODE_TO_QUEST_STATUS[statusCode] || 'locked',
          targetZoneX,
          targetZoneY,
          targetZoneRadius,
        });
      }
      break;
    }
    default:
      break;
  }
  return event;
}

function decodeServerFrame(raw) {
  const reader = new Reader(raw);
  const opcode = reader.u8();

  if (opcode === OPCODES.S2C_ERROR) {
    return { type: 'error', message: reader.string16() };
  }

  if (opcode === OPCODES.S2C_NOTICE) {
    const ok = !!reader.u8();
    const message = reader.string16();
    return { type: 'notice', ok, message };
  }

  if (opcode === OPCODES.S2C_JOINED) {
    const playerId = reader.u32();
    const tickRate = reader.u8();
    const worldRev = reader.u16();
    const world = {
      width: reader.u16(),
      height: reader.u16(),
      tileSize: reader.u16(),
      blockPx: reader.u16(),
      roadStart: reader.u16(),
      roadEnd: reader.u16(),
      laneA: reader.u16(),
      laneB: reader.u16(),
      shops: [],
      hospital: null,
      hospitals: [],
      worldRev,
    };
    const shopCount = reader.u8();
    for (let i = 0; i < shopCount; i += 1) {
      const id = reader.string8();
      const name = reader.string8();
      const x = unpackCoord(reader.u16());
      const y = unpackCoord(reader.u16());
      const radius = reader.u16();
      const stock = {
        shotgun: reader.u16(),
        machinegun: reader.u16(),
        bazooka: reader.u16(),
      };
      world.shops.push({ id, name, x, y, radius, stock });
    }
    if (reader.u8() === 1) {
      world.hospital = {
        id: reader.string8(),
        name: reader.string8(),
        x: unpackCoord(reader.u16()),
        y: unpackCoord(reader.u16()),
        radius: reader.u16(),
      };
    }
    const progressTicket = reader.string16();
    if (reader.offset < reader.buffer.byteLength) {
      const hospitalCount = reader.u8();
      for (let i = 0; i < hospitalCount; i += 1) {
        world.hospitals.push({
          id: reader.string8(),
          name: reader.string8(),
          x: unpackCoord(reader.u16()),
          y: unpackCoord(reader.u16()),
          radius: reader.u16(),
        });
      }
    }
    if (world.hospitals.length === 0 && world.hospital) {
      world.hospitals.push({ ...world.hospital });
    }
    if (!world.hospital && world.hospitals.length > 0) {
      world.hospital = { ...world.hospitals[0] };
    }
    let quest = null;
    if (reader.offset < reader.buffer.byteLength) {
      const hasQuest = reader.u8() === 1;
      if (hasQuest) {
        const reputation = reader.u32();
        const gunShopUnlocked = !!reader.u8();
        const questCount = reader.u16();
        const quests = [];
        for (let i = 0; i < questCount; i += 1) {
          const id = reader.u32();
          const actionCode = reader.u8();
          const title = reader.string8();
          const description = reader.string16();
          const targetCount = reader.u16();
          const progress = reader.u16();
          const statusCode = reader.u8();
          const rewardMoney = reader.u32();
          const rewardReputation = reader.u32();
          const rewardUnlockGunShop = !!reader.u8();
          const resetOnDeath = !!reader.u8();
          const targetZoneX = unpackCoord(reader.u16());
          const targetZoneY = unpackCoord(reader.u16());
          const targetZoneRadius = reader.u16();
          quests.push({
            id,
            actionType: CODE_TO_QUEST_ACTION[actionCode] || '',
            title,
            description,
            targetCount,
            progress,
            statusCode,
            status: CODE_TO_QUEST_STATUS[statusCode] || 'locked',
            rewardMoney,
            rewardReputation,
            rewardUnlockGunShop,
            resetOnDeath,
            targetZoneX,
            targetZoneY,
            targetZoneRadius,
          });
        }
        quest = {
          reputation,
          gunShopUnlocked,
          quests,
        };
      }
    }
    return { type: 'joined', playerId, tickRate, worldRev, world, progressTicket, quest };
  }

  if (opcode === OPCODES.S2C_PRESENCE) {
    const serverTime = reader.u32();
    const worldRev = reader.u16();
    const onlineCount = reader.u16();
    const count = reader.u16();
    const players = [];
    for (let i = 0; i < count; i += 1) {
      players.push({
        id: reader.u32(),
        color: reader.color24(),
        x: unpackCoord(reader.u16()),
        y: unpackCoord(reader.u16()),
        inCarId: reader.u32() || null,
      });
    }
    return { type: 'presence', serverTime, worldRev, onlineCount, players };
  }

  if (opcode === OPCODES.S2C_SNAPSHOT) {
    const serverTime = reader.u32();
    const worldRev = reader.u16();
    const snapshotSeq = reader.u16();
    const flags = reader.u8();
    const keyframe = !!(flags & 1);
    const hasStats = !!(flags & 2);
    const hasScope = !!(flags & 4);
    const hasProgressTicket = !!(flags & 8);
    const ackInputSeq = reader.u32();
    const clientSendTimeEcho = reader.u32();
    const interpolationDelayMs = reader.u16();
    const progressTicket = hasProgressTicket ? reader.string16() : '';

    const sections = {};
    for (const name of SECTION_ORDER) {
      const addCount = reader.u16();
      const updateCount = reader.u16();
      const removeCount = reader.u16();
      const add = [];
      const update = [];
      const remove = [];

      const parseRecord = () => {
        if (name === 'players') {
          const id = reader.u32();
          const nameValue = reader.string8();
          const color = reader.color24();
          const x = unpackCoord(reader.u16());
          const y = unpackCoord(reader.u16());
          const dir = unpackAngle(reader.i16());
          const inCarId = reader.u32() || null;
          const insideShopIndex = unpackShopIndex(reader.u8());
          const health = reader.u8();
          const stars = reader.u8();
          const money = reader.u32();
          const crimeRating = reader.u32();
          const weapon = CODE_TO_WEAPON[reader.u8()] || 'fist';
          const owned = reader.u8();
          const chatMsLeft = reader.u16();
          const chatText = reader.string8();
          return {
            id,
            name: nameValue,
            color,
            x,
            y,
            dir,
            inCarId,
            insideShopIndex,
            health,
            stars,
            money,
            crimeRating,
            weapon,
            ownedPistol: !!(owned & 1),
            ownedShotgun: !!(owned & 2),
            ownedMachinegun: !!(owned & 4),
            ownedBazooka: !!(owned & 8),
            chatMsLeft,
            chatText,
          };
        }
        if (name === 'cars') {
          const id = reader.u32();
          const type = CODE_TO_CAR_TYPE[reader.u8()] || 'civilian';
          const x = unpackCoord(reader.u16());
          const y = unpackCoord(reader.u16());
          const angle = unpackAngle(reader.i16());
          const speed = unpackSpeed(reader.i16());
          const color = reader.color24();
          const driverId = reader.u32() || null;
          const health = reader.u8();
          const flagsCar = reader.u8();
          return {
            id,
            type,
            x,
            y,
            angle,
            speed,
            color,
            driverId,
            health,
            npcDriver: !!(flagsCar & 1),
            sirenOn: !!(flagsCar & 2),
            smoking: !!(flagsCar & 4),
            questTarget: !!(flagsCar & 8),
          };
        }
        if (name === 'npcs') {
          return {
            id: reader.u32(),
            x: unpackCoord(reader.u16()),
            y: unpackCoord(reader.u16()),
            dir: unpackAngle(reader.i16()),
            alive: !!reader.u8(),
            corpseState: CODE_TO_CORPSE_STATE[reader.u8()] || 'none',
            skinColor: reader.color24(),
            shirtColor: reader.color24(),
            shirtDark: reader.color24(),
            questTarget: !!(reader.u8() & 1),
          };
        }
        if (name === 'cops') {
          const id = reader.u32();
          const x = unpackCoord(reader.u16());
          const y = unpackCoord(reader.u16());
          const dir = unpackAngle(reader.i16());
          const health = reader.u16();
          const flagsCop = reader.u8();
          const inCarId = reader.u32() || null;
          const corpseState = CODE_TO_CORPSE_STATE[reader.u8()] || 'none';
          const mode = CODE_TO_COP_MODE[reader.u8()] || 'patrol';
          return {
            id,
            x,
            y,
            dir,
            health,
            alive: !!(flagsCop & 1),
            alert: !!(flagsCop & 2),
            inCarId,
            corpseState,
            mode,
          };
        }
        if (name === 'drops') {
          return {
            id: reader.u32(),
            x: unpackCoord(reader.u16()),
            y: unpackCoord(reader.u16()),
            amount: reader.u16(),
            ttl: unpackTtl(reader.u16()),
          };
        }
        return {
          id: reader.u32(),
          x: unpackCoord(reader.u16()),
          y: unpackCoord(reader.u16()),
          ttl: unpackTtl(reader.u16()),
        };
      };

      for (let i = 0; i < addCount; i += 1) add.push(parseRecord());
      for (let i = 0; i < updateCount; i += 1) update.push(parseRecord());
      for (let i = 0; i < removeCount; i += 1) remove.push(reader.u32());
      sections[name] = { add, update, remove };
    }

    const eventCount = reader.u16();
    const events = [];
    for (let i = 0; i < eventCount; i += 1) {
      const id = reader.u32();
      const typeCode = reader.u8();
      const payloadLen = reader.u16();
      const type = CODE_TO_EVENT[typeCode] || 'impact';
      const evReader = new Reader(reader.bytes(payloadLen));
      const event = decodeEvent(type, evReader);
      event.id = id;
      events.push(event);
    }

    let stats = null;
    if (hasStats) {
      stats = {
        npcAlive: reader.u16(),
        carsCivilian: reader.u16(),
        carsCop: reader.u16(),
        carsAmbulance: reader.u16(),
        copsAlive: reader.u16(),
      };
    }

    let scope = null;
    if (hasScope) {
      scope = {
        x: unpackCoord(reader.u16()),
        y: unpackCoord(reader.u16()),
        pedRadius: reader.u16(),
        carRadius: reader.u16(),
      };
    }

    return {
      type: 'snapshot',
      serverTime,
      worldRev,
      snapshotSeq,
      keyframe,
      ackInputSeq,
      clientSendTimeEcho,
      interpolationDelayMs,
      progressTicket,
      sections,
      events,
      stats,
      scope,
    };
  }

  throw new Error('Unknown opcode.');
}

function encodeJoinFrame(name, color, profileTicket = '', profileId = '') {
  const writer = new Writer(64);
  writer.u8(OPCODES.C2S_JOIN);
  writer.string8(name || '');
  writer.color24(color || '#ffffff');
  writer.string16(profileTicket || '');
  writer.string16(profileId || '');
  return writer.finish();
}

function encodeInputFrame(payload) {
  const writer = new Writer(48);
  writer.u8(OPCODES.C2S_INPUT);
  writer.u32(payload?.seq >>> 0);
  writer.u32(payload?.shootSeq >>> 0);
  writer.u32(payload?.clientSendTime >>> 0);
  let mask = 0;
  if (payload?.up) mask |= 1;
  if (payload?.down) mask |= 2;
  if (payload?.left) mask |= 4;
  if (payload?.right) mask |= 8;
  if (payload?.enter) mask |= 16;
  if (payload?.horn) mask |= 32;
  if (payload?.shootHeld) mask |= 64;
  if (payload?.requestStats) mask |= 128;
  writer.u8(mask);
  writer.u8(clamp(Math.round(payload?.weaponSlot || 1), 1, 4));
  writer.u16(packCoord(payload?.aimX || 0));
  writer.u16(packCoord(payload?.aimY || 0));
  writer.u16(packCoord(payload?.clickAimX || 0));
  writer.u16(packCoord(payload?.clickAimY || 0));
  return writer.finish();
}

function encodeBuyFrame(item) {
  const writer = new Writer(4);
  writer.u8(OPCODES.C2S_BUY);
  writer.u8(ITEM_TO_CODE[item] ?? 0);
  return writer.finish();
}

function encodeChatFrame(text) {
  const writer = new Writer(128);
  writer.u8(OPCODES.C2S_CHAT);
  writer.string8(text || '');
  return writer.finish();
}

const codecUtils = Object.freeze({
  Writer,
  Reader,
  clamp,
  packCoord,
  unpackCoord,
  unpackAngle,
  unpackSpeed,
  unpackTtl,
  colorHexToInt,
  intToColorHex,
  unpackShopIndex,
});

const eventCodec = Object.freeze({
  decodeEvent,
});

const decodeCodec = Object.freeze({
  decodeServerFrame,
});

const encodeCodec = Object.freeze({
  encodeJoinFrame,
  encodeInputFrame,
  encodeBuyFrame,
  encodeChatFrame,
});

return {
  OPCODES,
  codecUtils,
  eventCodec,
  decodeServerFrame: decodeCodec.decodeServerFrame,
  encodeJoinFrame: encodeCodec.encodeJoinFrame,
  encodeInputFrame: encodeCodec.encodeInputFrame,
  encodeBuyFrame: encodeCodec.encodeBuyFrame,
  encodeChatFrame: encodeCodec.encodeChatFrame,
};
})();

if (typeof window !== 'undefined') {
  window.ClientProtocol = ClientProtocol;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ClientProtocol;
}
