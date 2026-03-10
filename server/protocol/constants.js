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
};
