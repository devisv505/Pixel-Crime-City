function createPresenceFeature(deps) {
  const {
    players,
    clients,
    WebSocket,
    WORLD_REV,
    normalizeHexColor,
    protocolIdForEntity,
    protocolIdForEntityOptional,
    encodePresenceFrame,
    addBytesSent,
  } = deps;

  function serializePresencePayloadBinary(serverTimeMs) {
    const playersPayload = [];
    for (const player of players.values()) {
      playersPayload.push({
        id: protocolIdForEntity(player.id),
        color: normalizeHexColor(player.color, '#ffffff'),
        x: player.x,
        y: player.y,
        inCarId: protocolIdForEntityOptional(player.inCarId),
      });
    }

    return {
      serverTime: serverTimeMs >>> 0,
      worldRev: WORLD_REV,
      onlineCount: playersPayload.length,
      players: playersPayload,
    };
  }

  function broadcastPresence(serverTimeMs = Math.round(performance.now())) {
    if (clients.size === 0) return;
    const payload = encodePresenceFrame(serializePresencePayloadBinary(serverTimeMs));
    const payloadBytes = payload.length;
    for (const ws of clients.keys()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        addBytesSent(payloadBytes);
      }
    }
  }

  return {
    serializePresencePayloadBinary,
    broadcastPresence,
  };
}

module.exports = {
  createPresenceFeature,
};

