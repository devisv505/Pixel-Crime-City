function createDecodeClientFrame(deps) {
  const { Reader, OPCODES, CODE_TO_ITEM, unpackCoord } = deps;

  return function decodeClientFrame(raw) {
    const reader = new Reader(raw);
    const opcode = reader.u8();

    if (opcode === OPCODES.C2S_JOIN) {
      const name = reader.string8();
      const color = reader.color24();
      const profileTicket = reader.string16();
      const profileId = reader.offset < reader.buffer.length ? reader.string16() : '';
      return {
        opcode,
        name,
        color,
        profileTicket,
        profileId,
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
  };
}

module.exports = {
  createDecodeClientFrame,
};
