function createEncodePresenceFrame(deps) {
  const { Writer, OPCODES, clamp, packCoord } = deps;

  return function encodePresenceFrame(payload) {
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
  };
}

module.exports = {
  createEncodePresenceFrame,
};
