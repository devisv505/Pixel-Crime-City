const {
  OPCODES,
  ITEM_TO_CODE,
  CODE_TO_ITEM,
  WEAPON_TO_CODE,
  CAR_TYPE_TO_CODE,
  CORPSE_STATE_TO_CODE,
  COP_MODE_TO_CODE,
  EVENT_TO_CODE,
  SNAPSHOT_SECTION_ORDER,
  QUEST_ACTION_TO_CODE,
  CODE_TO_QUEST_ACTION,
  QUEST_STATUS_TO_CODE,
  CODE_TO_QUEST_STATUS,
} = require('./server/protocol/constants');
const {
  Writer,
  Reader,
  clamp,
  packCoord,
  unpackCoord,
  packAngle,
  packSpeed,
  packTtl,
  colorHexToInt,
  packShopIndex,
} = require('./server/protocol/codec-utils');
const { createDecodeClientFrame } = require('./server/protocol/decode-client');
const { createEncodeGenericFrames } = require('./server/protocol/encode-generic');
const { createEncodeJoinedFrame } = require('./server/protocol/encode-joined');
const { createEncodePresenceFrame } = require('./server/protocol/encode-presence');
const { createEncodeSnapshotFrame } = require('./server/protocol/encode-snapshot');

const decodeClientFrame = createDecodeClientFrame({
  Reader,
  OPCODES,
  CODE_TO_ITEM,
  unpackCoord,
});

const { encodeErrorFrame, encodeNoticeFrame } = createEncodeGenericFrames({
  Writer,
  OPCODES,
});

const encodeJoinedFrame = createEncodeJoinedFrame({
  Writer,
  OPCODES,
  clamp,
  packCoord,
  QUEST_ACTION_TO_CODE,
  QUEST_STATUS_TO_CODE,
});

const encodePresenceFrame = createEncodePresenceFrame({
  Writer,
  OPCODES,
  clamp,
  packCoord,
});

const encodeSnapshotFrame = createEncodeSnapshotFrame({
  Writer,
  OPCODES,
  SNAPSHOT_SECTION_ORDER,
  WEAPON_TO_CODE,
  CAR_TYPE_TO_CODE,
  CORPSE_STATE_TO_CODE,
  COP_MODE_TO_CODE,
  EVENT_TO_CODE,
  ITEM_TO_CODE,
  clamp,
  packCoord,
  packAngle,
  packSpeed,
  packTtl,
  packShopIndex,
});

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
  QUEST_ACTION_TO_CODE,
  CODE_TO_QUEST_ACTION,
  QUEST_STATUS_TO_CODE,
  CODE_TO_QUEST_STATUS,
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
