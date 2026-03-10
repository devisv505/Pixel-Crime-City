function createEncodeGenericFrames(deps) {
  const { Writer, OPCODES } = deps;

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

  return {
    encodeErrorFrame,
    encodeNoticeFrame,
  };
}

module.exports = {
  createEncodeGenericFrames,
};
