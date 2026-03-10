function createTransportFeature(deps) {
  const {
    clients,
    players,
    cars,
    emitEvent,
    broadcastPresence,
    sanitizeName,
    sanitizeColor,
    sanitizeProfileId,
    sanitizeChatText,
    randomPedSpawn,
    makeId,
    restoreProgressForPlayer,
    attachCrimeReputationToPlayer,
    attachQuestStateToPlayer,
    releaseQuestTargetReservationsForProfile,
    createQuestBootstrapForPlayer,
    progressSignatureFromPlayer,
    createProgressTicketForPlayer,
    protocolIdForEntity,
    clamp,
    buyItemForPlayer,
    decodeClientFrame,
    encodeErrorFrame,
    encodeNoticeFrame,
    encodeJoinedFrame,
    WORLD,
    TICK_RATE,
    WORLD_REV,
    STATIC_WORLD_PAYLOAD,
    CHAT_DURATION_MS,
    OPCODES,
  } = deps;

  function disconnectClient(ws) {
    const client = clients.get(ws);
    if (!client) return;

    const player = players.get(client.playerId);
    if (player) {
      releaseQuestTargetReservationsForProfile(player.profileId);
      if (player.inCarId) {
        const car = cars.get(player.inCarId);
        if (car) {
          car.driverId = null;
          car.abandonTimer = 0;
        }
      }
      players.delete(player.id);
      emitEvent('disconnect', { playerId: player.id, x: player.x, y: player.y });
    }

    clients.delete(ws);
    broadcastPresence();
  }

  function handleJoin(ws, data) {
    if (clients.has(ws)) {
      ws.send(encodeErrorFrame('Already joined.'));
      return;
    }

    const name = sanitizeName(data.name);
    const color = sanitizeColor(data.color);
    const profileTicket = typeof data.profileTicket === 'string' ? data.profileTicket : '';
    const profileId = sanitizeProfileId(data.profileId);

    if (!name) {
      ws.send(encodeErrorFrame('Name must be 2-16 letters/numbers.'));
      return;
    }
    if (!color) {
      ws.send(encodeErrorFrame('Color must be a valid hex value like #44ccff.'));
      return;
    }

    const spawn = randomPedSpawn();
    const id = makeId('p');
    const player = {
      id,
      name,
      color,
      x: spawn.x,
      y: spawn.y,
      dir: 0,
      inCarId: null,
      insideShopId: null,
      shopExitX: spawn.x,
      shopExitY: spawn.y,
      health: 100,
      money: 0,
      crimeRating: 0,
      stars: 0,
      starHeat: 0,
      starCooldown: 0,
      copAlertPlayed: false,
      chatText: '',
      chatUntil: 0,
      respawnTimer: 0,
      hitCooldown: 0,
      shootCooldown: 0,
      lastShootSeq: 0,
      weapon: 'pistol',
      ownedPistol: true,
      ownedShotgun: false,
      ownedMachinegun: false,
      ownedBazooka: false,
      profileId: '',
      questReputation: 0,
      gunShopUnlocked: false,
      questEntries: [],
      activeQuestTargetNpcId: '',
      activeQuestTargetQuestId: 0,
      activeQuestTargetCarId: '',
      activeQuestTargetCarQuestId: 0,
      requestStats: false,
      lastInputSeq: 0,
      lastClientSendTime: 0,
      prevEnter: false,
      input: {
        up: false,
        down: false,
        left: false,
        right: false,
        enter: false,
        horn: false,
        shootHeld: false,
        shootSeq: 0,
        weaponSlot: 1,
        requestStats: false,
        aimX: spawn.x,
        aimY: spawn.y,
        clickAimX: spawn.x,
        clickAimY: spawn.y,
      },
    };

    restoreProgressForPlayer(player, profileTicket, name);
    attachCrimeReputationToPlayer(player, profileId);
    attachQuestStateToPlayer(player);
    const initialProgressSignature = progressSignatureFromPlayer(player);
    const initialProgressTicket = createProgressTicketForPlayer(player);

    players.set(id, player);
    clients.set(ws, {
      playerId: id,
      snapshotState: null,
      lastProgressTicket: initialProgressTicket,
      lastProgressSignature: initialProgressSignature,
    });

    const playerProtocolId = protocolIdForEntity(id);
    ws.send(
      encodeJoinedFrame({
        playerId: playerProtocolId,
        tickRate: TICK_RATE,
        worldRev: WORLD_REV,
        world: STATIC_WORLD_PAYLOAD,
        progressTicket: initialProgressTicket,
        quest: createQuestBootstrapForPlayer(player),
      })
    );

    emitEvent('join', { playerId: id, x: player.x, y: player.y });
    broadcastPresence();
  }

  function normalizeShootSeq(raw, prev) {
    if (!Number.isInteger(raw) || raw < 0) {
      return prev;
    }

    if (raw + 2000 < prev) {
      return raw;
    }

    if (raw < prev) {
      return prev;
    }

    return raw;
  }

  function handleInput(ws, data) {
    const client = clients.get(ws);
    if (!client) return;
    const player = players.get(client.playerId);
    if (!player) return;

    const input = data.input;
    if (!input || typeof input !== 'object') return;
    const seq = Number(data.seq);
    if (Number.isInteger(seq) && seq >= 0) {
      player.lastInputSeq = seq >>> 0;
    }
    const clientSendTime = Number(data.clientSendTime);
    if (Number.isInteger(clientSendTime) && clientSendTime >= 0) {
      player.lastClientSendTime = clientSendTime >>> 0;
    }

    player.input.up = !!input.up;
    player.input.down = !!input.down;
    player.input.left = !!input.left;
    player.input.right = !!input.right;
    player.input.enter = !!input.enter;
    player.input.horn = !!input.horn;
    player.input.shootHeld = !!input.shootHeld;
    player.requestStats = !!input.requestStats;
    player.input.requestStats = player.requestStats;
    const slot = Number(input.weaponSlot);
    if (Number.isInteger(slot) && slot >= 1 && slot <= 4) {
      player.input.weaponSlot = slot;
    }

    const ax = Number(input.aimX);
    const ay = Number(input.aimY);
    if (Number.isFinite(ax) && Number.isFinite(ay)) {
      player.input.aimX = clamp(ax, 0, WORLD.width);
      player.input.aimY = clamp(ay, 0, WORLD.height);
    }

    const cax = Number(input.clickAimX);
    const cay = Number(input.clickAimY);
    if (Number.isFinite(cax) && Number.isFinite(cay)) {
      player.input.clickAimX = clamp(cax, 0, WORLD.width);
      player.input.clickAimY = clamp(cay, 0, WORLD.height);
    }

    player.input.shootSeq = normalizeShootSeq(Number(data.shootSeq), player.input.shootSeq);
  }

  function handleBuy(ws, data) {
    const client = clients.get(ws);
    if (!client) return;
    const player = players.get(client.playerId);
    if (!player) return;

    const item = typeof data.item === 'string' ? data.item.trim().toLowerCase() : '';
    const result = buyItemForPlayer(player, item);
    ws.send(encodeNoticeFrame(result.ok, result.message));
  }

  function handleChat(ws, data) {
    const client = clients.get(ws);
    if (!client) return;
    const player = players.get(client.playerId);
    if (!player) return;

    const text = sanitizeChatText(data.text);
    if (text === null) return;

    if (!text) {
      player.chatText = '';
      player.chatUntil = 0;
      return;
    }

    player.chatText = text;
    player.chatUntil = Date.now() + CHAT_DURATION_MS;
  }

  function handleClientMessage(ws, raw) {
    if (!(raw instanceof Buffer)) {
      ws.send(encodeErrorFrame('Binary protocol required. Refresh the page.'));
      ws.close();
      return;
    }

    if (raw.length > 8192) {
      ws.send(encodeErrorFrame('Payload too large.'));
      return;
    }

    let data;
    try {
      data = decodeClientFrame(raw);
    } catch {
      ws.send(encodeErrorFrame('Invalid packet.'));
      return;
    }

    if (!data || typeof data !== 'object') {
      return;
    }

    if (data.opcode === OPCODES.C2S_JOIN) {
      handleJoin(ws, data);
    } else if (data.opcode === OPCODES.C2S_INPUT) {
      handleInput(ws, data);
    } else if (data.opcode === OPCODES.C2S_BUY) {
      handleBuy(ws, data);
    } else if (data.opcode === OPCODES.C2S_CHAT) {
      handleChat(ws, data);
    }
  }

  function attachSocketServerHandlers(wss) {
    wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        handleClientMessage(ws, raw);
      });

      ws.on('close', () => {
        disconnectClient(ws);
      });

      ws.on('error', () => {
        disconnectClient(ws);
      });
    });
  }

  return {
    disconnectClient,
    handleJoin,
    normalizeShootSeq,
    handleInput,
    handleBuy,
    handleChat,
    handleClientMessage,
    attachSocketServerHandlers,
  };
}

module.exports = {
  createTransportFeature,
};

