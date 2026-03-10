function createEncodeSnapshotFrame(deps) {
  const {
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
  } = deps;

  return function encodeSnapshotFrame(payload) {
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
          writer.u32(clamp(Math.round(record.crimeRating || 0), 0, 0xffffffff));
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
  };
}

module.exports = {
  createEncodeSnapshotFrame,
};
