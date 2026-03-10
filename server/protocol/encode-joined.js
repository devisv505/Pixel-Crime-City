function createEncodeJoinedFrame(deps) {
  const { Writer, OPCODES, clamp, packCoord } = deps;

  return function encodeJoinedFrame(payload) {
    const writer = new Writer(1024);
    const world = payload?.world || {};
    const shops = Array.isArray(world.shops) ? world.shops : [];
    const hospital = world.hospital && typeof world.hospital === 'object' ? world.hospital : null;
    const hospitalList = Array.isArray(world.hospitals)
      ? world.hospitals.filter((item) => item && typeof item === 'object')
      : [];
    const hospitals = hospitalList.length > 0 ? hospitalList : hospital ? [hospital] : [];
    const primaryHospital = hospital || hospitals[0] || null;

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

    writer.u8(primaryHospital ? 1 : 0);
    if (primaryHospital) {
      writer.string8(primaryHospital.id || '');
      writer.string8(primaryHospital.name || '');
      writer.u16(packCoord(primaryHospital.x || 0));
      writer.u16(packCoord(primaryHospital.y || 0));
      writer.u16(clamp(Math.round(primaryHospital.radius || 0), 0, 65535));
    }

    writer.string16(payload?.progressTicket || '');
    writer.u8(clamp(hospitals.length, 0, 255));
    for (const item of hospitals) {
      writer.string8(item?.id || '');
      writer.string8(item?.name || '');
      writer.u16(packCoord(item?.x || 0));
      writer.u16(packCoord(item?.y || 0));
      writer.u16(clamp(Math.round(item?.radius || 0), 0, 65535));
    }

    return writer.toBuffer();
  };
}

module.exports = {
  createEncodeJoinedFrame,
};
